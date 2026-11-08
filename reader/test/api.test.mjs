// 閱讀器 API 測試 —— 零依賴：node --no-warnings test/api.test.mjs
// 用 node:sqlite 模擬 D1（prepare/bind/first/all/run/batch），跑真正的 schema.sql 與 api.js。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.js';

function makeD1() {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    function stmt(sql, args = []) {
        return {
            sql, args,
            bind(...a) { return stmt(sql, a); },
            async first() { return db.prepare(sql).get(...args) || null; },
            async all() { return { results: db.prepare(sql).all(...args) }; },
            async run() { db.prepare(sql).run(...args); return { success: true }; },
        };
    }
    return {
        prepare: (sql) => stmt(sql),
        // D1 batch 是單一交易
        async batch(list) {
            db.exec('BEGIN');
            try { list.forEach((s) => db.prepare(s.sql).run(...s.args)); db.exec('COMMIT'); }
            catch (e) { db.exec('ROLLBACK'); throw e; }
        },
    };
}

const env = { TOKEN: 'secret-token', DB: makeD1() };
const BOOK = encodeURIComponent('oop.tw/areada/abc/');

async function call(method, path, body, token = env.TOKEN) {
    const init = { method, headers: { authorization: 'Bearer ' + token } };
    if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const res = await handleApi(new Request('https://r.example' + path, init), env);
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

let passed = 0, failed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log('✓ ' + name); }
    catch (e) { failed++; console.log('✗ ' + name + '\n    ' + (e && e.stack || e)); }
}
function eq(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error((msg || '不相等') + '\n      實際 ' + sa + '\n      預期 ' + sb);
}
const ch = (n) => ({ url: 'https://oop.tw/areada/abc/a' + n + 'a.html', title: '第' + n + '章', content: '段落' + n + '\n第二段' });
async function order() {
    const r = await call('GET', '/api/books/' + BOOK);
    return r.data.chapters.map((c) => c.title);
}

await test('沒帶 token 或 token 錯誤 → 401', async () => {
    eq((await call('GET', '/api/books', undefined, 'wrong')).status, 401);
    const res = await handleApi(new Request('https://r.example/api/books'), env);
    eq(res.status, 401);
});

await test('伺服器沒設 TOKEN → 500 並說明原因', async () => {
    const res = await handleApi(new Request('https://r.example/api/books', { headers: { authorization: 'Bearer x' } }), { DB: env.DB });
    eq(res.status, 500);
});

await test('OPTIONS 預檢不需要 token', async () => {
    const res = await handleApi(new Request('https://r.example/api/books', { method: 'OPTIONS' }), env);
    eq(res.status, 204);
});

await test('上傳章節前必須先建立書本', async () => {
    eq((await call('POST', '/api/books/' + BOOK + '/chapters', { chapters: [ch(1)] })).status, 404);
});

await test('建立書本後出現在書架', async () => {
    eq((await call('PUT', '/api/books/' + BOOK, { title: '測試書', site: 'oop', sourceUrl: 'https://oop.tw/areada/abc/' })).status, 200);
    const r = await call('GET', '/api/books');
    eq(r.data.books.map((b) => [b.id, b.title, b.chapter_count]), [['oop.tw/areada/abc/', '測試書', 0]]);
});

await test('從中間章節開始下載：依序附加在最後', async () => {
    let r = await call('POST', '/api/books/' + BOOK + '/chapters', { chapters: [ch(5), ch(6)] });
    eq([r.data.inserted, r.data.total], [2, 2]);
    r = await call('POST', '/api/books/' + BOOK + '/chapters', { chapters: [ch(7)], prevUrl: ch(6).url, next: { url: ch(8).url, skip: false } });
    eq(await order(), ['第5章', '第6章', '第7章']);
    const b = (await call('GET', '/api/books/' + BOOK)).data.book;
    eq([b.next_url, b.next_skip], [ch(8).url, 0]);
});

await test('整本下載（start）：前面的章節插到已存章節之前，碰到已存的就地更新', async () => {
    const r = await call('POST', '/api/books/' + BOOK + '/chapters', {
        start: true,
        chapters: [ch(1), ch(2), ch(3), ch(4), { ...ch(5), content: '改過的內容' }],
    });
    eq([r.data.inserted, r.data.updated, r.data.total], [4, 1, 7]);
    eq(await order(), ['第1章', '第2章', '第3章', '第4章', '第5章', '第6章', '第7章']);
    const c = (await call('GET', '/api/books/' + BOOK + '/chapters/4')).data.chapter;
    eq([c.title, c.content], ['第5章', '改過的內容']);
});

await test('同一批重複的網址只存一次；idx 連續無洞', async () => {
    await call('POST', '/api/books/' + BOOK + '/chapters', { prevUrl: ch(7).url, chapters: [ch(8), ch(8)] });
    const r = await call('GET', '/api/books/' + BOOK);
    eq(r.data.chapters.map((c) => c.idx), [0, 1, 2, 3, 4, 5, 6, 7]);
});

await test('接在 prevUrl 之後插入到中間', async () => {
    await call('POST', '/api/books/' + BOOK + '/chapters', { prevUrl: ch(2).url, chapters: [{ ...ch(2.5), title: '番外' }] });
    eq((await order()).slice(0, 4), ['第1章', '第2章', '番外', '第3章']);
});

await test('進度：新的蓋舊的，舊的不覆蓋新的；回傳目前章節序號', async () => {
    let r = await call('PUT', '/api/books/' + BOOK + '/progress', { chapterUrl: ch(6).url, ratio: 0.5, device: '電腦', updatedAt: 2000 });
    eq([r.data.progress.idx, r.data.progress.ratio, r.data.progress.device], [6, 0.5, '電腦']);
    r = await call('PUT', '/api/books/' + BOOK + '/progress', { chapterUrl: ch(1).url, ratio: 0.1, device: 'iPhone', updatedAt: 1000 });
    eq(r.data.progress.device, '電腦', '舊進度不該覆蓋');
    r = await call('PUT', '/api/books/' + BOOK + '/progress', { chapterUrl: ch(7).url, ratio: 2, device: 'iPhone', updatedAt: 3000 });
    eq([r.data.progress.idx, r.data.progress.ratio, r.data.progress.device], [7, 1, 'iPhone']);
});

await test('章節移位後進度仍指向同一章（以網址記錄）', async () => {
    await call('POST', '/api/books/' + BOOK + '/chapters', { start: true, chapters: [{ ...ch(0), title: '序章' }] });
    const r = await call('GET', '/api/books/' + BOOK + '/progress');
    eq(r.data.progress.idx, 8);
    const list = await call('GET', '/api/books');
    eq([list.data.books[0].progress_idx, list.data.books[0].progress_title, list.data.books[0].chapter_count], [8, '第7章', 10]);
});

await test('格式錯誤與越界都回 4xx 而不是 500', async () => {
    eq((await call('POST', '/api/books/' + BOOK + '/chapters', { chapters: [{ title: 'x' }] })).status, 400);
    eq((await call('GET', '/api/books/' + BOOK + '/chapters/999')).status, 404);
    eq((await call('GET', '/api/books/' + BOOK + '/chapters/-1')).status, 400);
    eq((await call('PUT', '/api/books/' + BOOK, { title: '' })).status, 400);
    eq((await call('GET', '/api/nope')).status, 404);
});

await test('下載紀錄：開始、回報、書架顯示最新一筆', async () => {
    let r = await call('POST', '/api/books/' + BOOK + '/runs', { mode: 'all', device: '電腦', est: 350 });
    eq([r.status, r.data.run.state, r.data.run.est], [200, 'running', 350]);
    const rid = r.data.run.id;
    r = await call('PUT', '/api/books/' + BOOK + '/runs/' + rid, { state: 'running', chapters: 120, est: 350 });
    eq([r.data.run.chapters, r.data.run.state], [120, 'running']);
    const b = (await call('GET', '/api/books')).data.books[0];
    eq([b.dl_state, b.dl_chapters, b.dl_est, b.dl_device], ['running', 120, 350, '電腦']);
});

await test('下載紀錄：上一筆還掛著 running 時，新的一筆把它標成中斷', async () => {
    await call('POST', '/api/books/' + BOOK + '/runs', { mode: 'resume', device: 'iPhone' });
    const runs = (await call('GET', '/api/books/' + BOOK + '/runs')).data.runs;
    eq(runs.map((x) => [x.mode, x.state]), [['resume', 'running'], ['all', 'stopped']]);
    eq(runs[1].message, '分頁關閉或中斷');
    eq((await call('PUT', '/api/books/' + BOOK + '/runs/99999', { state: 'done' })).status, 404);
    eq((await call('POST', '/api/books/' + encodeURIComponent('nope/') + '/runs', {})).status, 404);
});

await test('刪除書本連同章節與進度', async () => {
    eq((await call('DELETE', '/api/books/' + BOOK)).status, 200);
    eq((await call('GET', '/api/books')).data.books.length, 0);
    eq((await call('GET', '/api/books/' + BOOK)).status, 404);
});

console.log('\n' + passed + ' 通過，' + failed + ' 失敗');
process.exit(failed ? 1 : 0);
