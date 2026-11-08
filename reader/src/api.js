// MyAutoPager 閱讀器 API（Cloudflare Worker + D1）
//
// 所有 /api/* 都要 Authorization: Bearer <TOKEN>（wrangler secret put TOKEN）。
// 這個檔案不 import 任何 Worker 專屬模組，node 測試可以直接載入（見 test/api.test.mjs）。

import qrcode from 'qrcode-generator';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
};
const MAX_BATCH = 200;              // 每次上傳最多幾章
const MAX_CONTENT = 1024 * 1024;    // 單章上限 1MB（D1 單列上限 2MB）

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS } });
}

// 常數時間比較，避免以回應時間逐字猜 token
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function checkAuth(request, env) {
    if (!env.TOKEN) throw new HttpError(500, '伺服器尚未設定 TOKEN（wrangler secret put TOKEN）');
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
    if (!m || !safeEqual(m[1].trim(), env.TOKEN)) throw new HttpError(401, 'token 錯誤');
}

async function readJson(request) {
    try { return await request.json(); } catch (e) { throw new HttpError(400, 'JSON 格式錯誤'); }
}

function str(v, name, max = 2048) {
    if (typeof v !== 'string' || !v || v.length > max) throw new HttpError(400, name + ' 缺少或過長');
    return v;
}

// ---- 配對新裝置 ----
// 配對網址把 TOKEN 放在 # 之後：瀏覽器不會把 # 後面送到伺服器，閱讀器讀到後存起來並立刻從網址列抹掉。
// QR code 在這裡產生（呼叫端已用同一個 TOKEN 驗證過），閱讀器頁面不必載入任何程式庫
function pairLink(url, env) {
    const link = url.origin + '/#t=' + encodeURIComponent(env.TOKEN);
    const qr = qrcode(0, 'M');
    qr.addData(link, 'Byte');
    qr.make();
    return json({ url: link, svg: qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true }) });
}

// ---- books ----

async function listBooks(env) {
    const { results } = await env.DB.prepare(
        `SELECT b.id, b.title, b.site, b.source_url, b.next_url, b.updated_at,
                (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count,
                p.chapter_url AS progress_url, p.ratio AS progress_ratio, p.device AS progress_device,
                p.updated_at AS progress_at,
                (SELECT idx FROM chapters c WHERE c.book_id = b.id AND c.url = p.chapter_url) AS progress_idx,
                (SELECT title FROM chapters c WHERE c.book_id = b.id AND c.url = p.chapter_url) AS progress_title,
                r.state AS dl_state, r.chapters AS dl_chapters, r.est AS dl_est, r.device AS dl_device,
                r.message AS dl_message, r.updated_at AS dl_at
           FROM books b
           LEFT JOIN progress p ON p.book_id = b.id
           LEFT JOIN download_runs r ON r.id = (SELECT MAX(id) FROM download_runs x WHERE x.book_id = b.id)
          ORDER BY COALESCE(p.updated_at, b.updated_at) DESC`
    ).all();
    return json({ books: results });
}

// ---- 下載紀錄 ----

const RUN_STATES = ['running', 'done', 'stopped', 'error'];
const RUN_KEEP = 20;   // 每本書只留最近 20 筆

function intOr0(v) { v = parseInt(v, 10); return v > 0 ? v : 0; }

async function listRuns(env, id) {
    const { results } = await env.DB.prepare(
        'SELECT * FROM download_runs WHERE book_id = ? ORDER BY id DESC LIMIT ?'
    ).bind(id, RUN_KEEP).all();
    return json({ runs: results });
}

async function startRun(env, id, body) {
    if (!(await getBookRow(env, id))) throw new HttpError(404, '找不到這本書，請先建立');
    const now = Date.now();
    const mode = ['here', 'all', 'front', 'resume'].indexOf(body.mode) >= 0 ? body.mode : null;
    const device = typeof body.device === 'string' ? body.device.slice(0, 64) : null;
    await env.DB.batch([
        // 同一本書上一筆還掛著 running（分頁被關掉、沒來得及回報），新的開始時標成中斷
        env.DB.prepare("UPDATE download_runs SET state = 'stopped', message = COALESCE(message, '分頁關閉或中斷') WHERE book_id = ? AND state = 'running'").bind(id),
        env.DB.prepare('INSERT INTO download_runs (book_id, mode, device, state, chapters, est, started_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)')
            .bind(id, mode, device, 'running', intOr0(body.est), now, now),
        env.DB.prepare('DELETE FROM download_runs WHERE book_id = ? AND id NOT IN (SELECT id FROM download_runs WHERE book_id = ? ORDER BY id DESC LIMIT ?)')
            .bind(id, id, RUN_KEEP),
    ]);
    const run = await env.DB.prepare('SELECT * FROM download_runs WHERE book_id = ? ORDER BY id DESC LIMIT 1').bind(id).first();
    return json({ run });
}

async function updateRun(env, id, rid, body) {
    const state = RUN_STATES.indexOf(body.state) >= 0 ? body.state : 'running';
    const message = typeof body.message === 'string' ? body.message.slice(0, 300) : null;
    await env.DB.prepare(
        'UPDATE download_runs SET state = ?, chapters = ?, est = ?, message = ?, updated_at = ? WHERE id = ? AND book_id = ?'
    ).bind(state, intOr0(body.chapters), intOr0(body.est), message, Date.now(), rid, id).run();
    const run = await env.DB.prepare('SELECT * FROM download_runs WHERE id = ? AND book_id = ?').bind(rid, id).first();
    if (!run) throw new HttpError(404, '找不到這筆下載紀錄');
    return json({ run });
}

async function getBookRow(env, id) {
    return env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(id).first();
}

async function getBook(env, id) {
    const book = await getBookRow(env, id);
    if (!book) throw new HttpError(404, '找不到這本書');
    const { results } = await env.DB.prepare(
        'SELECT idx, title, url, chars FROM chapters WHERE book_id = ? ORDER BY idx'
    ).bind(id).all();
    return json({ book, chapters: results });
}

async function putBook(env, id, body) {
    const now = Date.now();
    const title = str(body.title, 'title', 200);
    const site = typeof body.site === 'string' ? body.site.slice(0, 64) : null;
    const source = typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 2048) : null;
    await env.DB.prepare(
        `INSERT INTO books (id, title, site, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title,
             site = COALESCE(excluded.site, books.site),
             source_url = COALESCE(excluded.source_url, books.source_url),
             updated_at = excluded.updated_at`
    ).bind(id, title, site, source, now, now).run();
    return json({ book: await getBookRow(env, id) });
}

async function deleteBook(env, id) {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM chapters WHERE book_id = ?').bind(id),
        env.DB.prepare('DELETE FROM progress WHERE book_id = ?').bind(id),
        env.DB.prepare('DELETE FROM download_runs WHERE book_id = ?').bind(id),
        env.DB.prepare('DELETE FROM books WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
}

// ---- chapters ----

// 上傳一批「已完整」的章節（同章分頁已在 userscript 端合併）。
//
// body = { chapters: [{url, title, content}], start?: bool, prevUrl?: string,
//          next?: {url: string|null, skip: bool} }
//
// 插入位置：start=true 表示這批從全書開頭接起（整本下載）；否則接在 prevUrl 之後；
// 都沒給就接在最後。已存在的章節（同 url）就地更新內容，並把游標移到它那裡 ——
// 所以「先從第 300 章下載、之後再下載整本」時，第 1–299 章會插到第 300 章之前，
// 後面整段往後移。
async function putChapters(env, id, body) {
    const book = await getBookRow(env, id);
    if (!book) throw new HttpError(404, '找不到這本書，請先建立');
    const list = Array.isArray(body.chapters) ? body.chapters : [];
    if (list.length > MAX_BATCH) throw new HttpError(400, '一次最多 ' + MAX_BATCH + ' 章');
    const chapters = list.map(function(c, i) {
        if (!c || typeof c !== 'object') throw new HttpError(400, '第 ' + i + ' 章格式錯誤');
        const content = typeof c.content === 'string' ? c.content : '';
        if (content.length > MAX_CONTENT) throw new HttpError(400, '第 ' + i + ' 章內容過長');
        return { url: str(c.url, 'url'), title: (typeof c.title === 'string' && c.title.trim()) ? c.title.trim().slice(0, 200) : '（無標題）', content };
    });

    const { results } = await env.DB.prepare('SELECT url, idx FROM chapters WHERE book_id = ? ORDER BY idx').bind(id).all();
    const pos = new Map(results.map(function(r) { return [r.url, r.idx]; }));
    let count = results.length;
    let cursor = count - 1;
    if (body.start === true) cursor = -1;
    else if (typeof body.prevUrl === 'string' && pos.has(body.prevUrl)) cursor = pos.get(body.prevUrl);

    const stmts = [];
    let group = [], inserted = 0, updated = 0;
    const flush = function() {
        if (!group.length) return;
        const at = cursor + 1, k = group.length;
        if (at < count) {
            stmts.push(env.DB.prepare('UPDATE chapters SET idx = idx + ? WHERE book_id = ? AND idx >= ?').bind(k, id, at));
            for (const [u, i] of pos) if (i >= at) pos.set(u, i + k);
        }
        group.forEach(function(c, i) {
            stmts.push(env.DB.prepare(
                'INSERT INTO chapters (book_id, idx, url, title, content, chars) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(id, at + i, c.url, c.title, c.content, c.content.length));
            pos.set(c.url, at + i);
        });
        cursor = at + k - 1;
        count += k;
        inserted += k;
        group = [];
    };
    const inGroup = new Set();
    for (const c of chapters) {
        if (pos.has(c.url)) {
            flush();
            stmts.push(env.DB.prepare(
                'UPDATE chapters SET title = ?, content = ?, chars = ? WHERE book_id = ? AND url = ?'
            ).bind(c.title, c.content, c.content.length, id, c.url));
            cursor = pos.get(c.url);
            updated++;
        } else if (!inGroup.has(c.url)) {
            inGroup.add(c.url);
            group.push(c);
        }
    }
    flush();

    const now = Date.now();
    if (body.next && typeof body.next === 'object') {
        const nu = typeof body.next.url === 'string' && body.next.url ? body.next.url.slice(0, 2048) : null;
        stmts.push(env.DB.prepare('UPDATE books SET next_url = ?, next_skip = ?, updated_at = ? WHERE id = ?')
            .bind(nu, body.next.skip ? 1 : 0, now, id));
    } else {
        stmts.push(env.DB.prepare('UPDATE books SET updated_at = ? WHERE id = ?').bind(now, id));
    }
    // D1 的 batch 是單一交易：移位與插入要嘛全成、要嘛全不成
    await env.DB.batch(stmts);
    return json({ inserted, updated, total: count });
}

async function getChapter(env, id, idx) {
    const row = await env.DB.prepare(
        'SELECT idx, url, title, content FROM chapters WHERE book_id = ? AND idx = ?'
    ).bind(id, idx).first();
    if (!row) throw new HttpError(404, '找不到這一章');
    return json({ chapter: row });
}

// ---- progress ----

async function getProgress(env, id) {
    const row = await env.DB.prepare(
        `SELECT p.*, (SELECT idx FROM chapters c WHERE c.book_id = p.book_id AND c.url = p.chapter_url) AS idx
           FROM progress p WHERE p.book_id = ?`
    ).bind(id).first();
    return json({ progress: row || null });
}

// 以 updatedAt 做「新的蓋舊的」：離線裝置晚送到的舊進度不會覆蓋別台較新的進度
async function putProgress(env, id, body) {
    const url = str(body.chapterUrl, 'chapterUrl');
    let ratio = Number(body.ratio);
    if (!isFinite(ratio)) ratio = 0;
    ratio = Math.min(1, Math.max(0, ratio));
    const device = typeof body.device === 'string' ? body.device.slice(0, 64) : null;
    let at = Number(body.updatedAt);
    if (!isFinite(at) || at <= 0) at = Date.now();
    await env.DB.prepare(
        `INSERT INTO progress (book_id, chapter_url, ratio, device, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET chapter_url = excluded.chapter_url, ratio = excluded.ratio,
             device = excluded.device, updated_at = excluded.updated_at
         WHERE excluded.updated_at >= progress.updated_at`
    ).bind(id, url, ratio, device, at).run();
    return getProgress(env, id);
}

// ---- router ----

export async function handleApi(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
        // 一定要 await：直接 return 一個會 reject 的 promise 會繞過下面的 catch
        return await route(request, env);
    } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: '伺服器錯誤：' + (e && e.message || e) }, 500);
    }
}

async function route(request, env) {
    checkAuth(request, env);
    const url = new URL(request.url);
    // 書本 id 含 '/'，呼叫端以 encodeURIComponent 傳入；pathname 不會自動解碼 %2F
    const parts = url.pathname.split('/').filter(Boolean).map(function(p) {
        try { return decodeURIComponent(p); } catch (e) { throw new HttpError(400, '網址編碼錯誤'); }
    });
    const m = request.method;
    // parts[0] === 'api'
    if (parts[1] === 'ping' && parts.length === 2) return json({ ok: true });
    if (parts[1] === 'pair' && parts.length === 2 && request.method === 'GET') return pairLink(url, env);
    if (parts[1] !== 'books') throw new HttpError(404, '未知的 API');
    if (parts.length === 2 && m === 'GET') return listBooks(env);
    const id = parts[2];
    if (!id || id.length > 512) throw new HttpError(400, '書本 id 錯誤');
    if (parts.length === 3) {
        if (m === 'GET') return getBook(env, id);
        if (m === 'PUT') return putBook(env, id, await readJson(request));
        if (m === 'DELETE') return deleteBook(env, id);
    }
    if (parts[3] === 'chapters') {
        if (parts.length === 4 && m === 'POST') return putChapters(env, id, await readJson(request));
        if (parts.length === 5 && m === 'GET') {
            const idx = parseInt(parts[4], 10);
            if (!(idx >= 0)) throw new HttpError(400, '章節序號錯誤');
            return getChapter(env, id, idx);
        }
    }
    if (parts[3] === 'progress' && parts.length === 4) {
        if (m === 'GET') return getProgress(env, id);
        if (m === 'PUT') return putProgress(env, id, await readJson(request));
    }
    if (parts[3] === 'runs') {
        if (parts.length === 4 && m === 'GET') return listRuns(env, id);
        if (parts.length === 4 && m === 'POST') return startRun(env, id, await readJson(request));
        if (parts.length === 5 && m === 'PUT') {
            const rid = parseInt(parts[4], 10);
            if (!(rid > 0)) throw new HttpError(400, '紀錄編號錯誤');
            return updateRun(env, id, rid, await readJson(request));
        }
    }
    throw new HttpError(405, '不支援的操作');
}
