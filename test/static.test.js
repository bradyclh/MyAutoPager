#!/usr/bin/env node
'use strict';

// 靜態一致性檢查 — 零依賴，離線可跑：node test/static.test.js
//
// 抓的是「改完沒發現」那一類低級但致命的錯：規則沒真的註冊進物件、
// iPhone 版忘了加 @match、兩個版本的選擇器改到不同步、規則寫太寬會在
// 目錄頁誤啟用、必要欄位漏掉。這些在瀏覽器裡都表現為「整個沒反應」，
// 而在 iPhone 上沒有 console，等於無從查起。

const parse = require('./lib/parse-rules');
const sites = require('./fixtures/sites');

let failed = 0;
let passed = 0;
const failures = [];

function check(name, fn) {
    let problems;
    try {
        problems = fn();
    } catch (e) {
        problems = [`拋出例外：${e.message}`];
    }
    problems = (problems || []).filter(Boolean);
    if (problems.length) {
        failed++;
        failures.push({ name, problems });
        console.log(`✗ ${name}`);
        problems.forEach((p) => console.log(`    ${p}`));
    } else {
        passed++;
        console.log(`✓ ${name}`);
    }
}

const db = parse.load();

// 桌面版規則分成「個人自訂（小說站）」與其後的通用規則（搜尋引擎、CMS…）。
// 只有小說站區塊需要和 iPhone 版對照。
function desktopNovelKeys() {
    const src = db.desktop.src;
    const from = src.indexOf('// ---- 個人自訂規則 ----');
    const to = src.indexOf('// ---- 搜尋引擎 ----');
    if (from < 0 || to < 0) throw new Error('找不到小說站區塊的註解標記');
    return Object.keys(db.desktop.rules).filter((k) => {
        const ident = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : `'${k}'`;
        const at = src.indexOf(`\n            ${ident}: {`);
        return at > from && at < to;
    });
}

// 桌面版有、iPhone 版刻意沒有的規則，連同原因。
const IPHONE_EXEMPT = {
    thepaperbooks: '需要 iframe 擷取（桌面 type 6），iPhone 引擎僅支援 XHR',
};

console.log('\n== 語法與中繼資料 ==');

check('兩個腳本語法正確', () => [
    db.desktop.syntaxError && `${db.desktop.label}: ${db.desktop.syntaxError}`,
    db.iphone.syntaxError && `${db.iphone.label}: ${db.iphone.syntaxError}`,
]);

check('版本號格式為 x.y.z', () =>
    [db.desktop, db.iphone]
        .filter((s) => !/^\d+\.\d+\.\d+$/.test(s.meta.version || ''))
        .map((s) => `${s.label} 的 @version 是 ${JSON.stringify(s.meta.version)}`)
);

check('規則物件解析出內容', () => {
    const out = [];
    if (Object.keys(db.desktop.rules).length === 0) out.push('DBSite 是空的');
    if (Object.keys(db.iphone.rules).length === 0) out.push('iPhone rules 是空的');
    return out;
});

console.log('\n== 規則結構 ==');

check('小說站規則都有 pager.nextL 與 pager.pageE', () => {
    // 只查小說站：搜尋引擎與 CMS 那批通用規則會在 url 函式或 webTypeIf 裡
    // 動態補上 pager，靜態看不到，拿同一把尺量會誤報。
    const out = [];
    const targets = [
        ['桌面', db.desktop.rules, desktopNovelKeys()],
        ['iPhone', db.iphone.rules, Object.keys(db.iphone.rules)],
    ];
    for (const [label, rules, keys] of targets) {
        for (const key of keys) {
            const pager = rules[key].pager;
            if (!pager) { out.push(`${label} ${key}: 沒有 pager`); continue; }
            if (!pager.nextL) out.push(`${label} ${key}: pager.nextL 缺少`);
            if (!pager.pageE) out.push(`${label} ${key}: pager.pageE 缺少`);
        }
    }
    return out;
});

check('小說站規則兩個版本都有（例外需登記）', () => {
    const desktopKeys = desktopNovelKeys();
    const iphoneKeys = Object.keys(db.iphone.rules);
    const out = [];
    for (const k of desktopKeys) {
        if (iphoneKeys.includes(k)) continue;
        if (IPHONE_EXEMPT[k]) continue;
        out.push(`桌面有 ${k}，iPhone 版沒有（若是刻意的，請登記到 IPHONE_EXEMPT）`);
    }
    for (const k of iphoneKeys) {
        if (!desktopKeys.includes(k)) out.push(`iPhone 有 ${k}，桌面版沒有`);
    }
    return out;
});

check('兩版同名規則的選擇器一致', () => {
    const out = [];
    for (const key of Object.keys(db.iphone.rules)) {
        const d = db.desktop.rules[key];
        const i = db.iphone.rules[key];
        if (!d || !d.pager || !i.pager) continue;
        for (const field of ['nextL', 'pageE', 'replaceE']) {
            const dv = d.pager[field];
            const iv = i.pager[field];
            // 函式形式（如 thepaperbooks）無從字面比對，略過
            if (typeof dv === 'function' || typeof iv === 'function') continue;
            if (String(dv) !== String(iv)) {
                out.push(`${key}.pager.${field} 不同步：\n      桌面   ${JSON.stringify(dv)}\n      iPhone ${JSON.stringify(iv)}`);
            }
        }
    }
    return out;
});

console.log('\n== iPhone @match 涵蓋範圍 ==');

check('每個章節頁樣本的網域都被 @match 涵蓋', () => {
    // 用實際會造訪的網域來檢查，而不是規則裡的 host 字串本身：
    // iPhone 的 host 比對含子網域（'hjwzw.com' 會匹配 tw.hjwzw.com），
    // 但 @match 是逐網域列舉的，兩者語意不同。漏一條 @match 的後果是
    // 腳本完全不會注入 —— 症狀和「規則寫錯」一模一樣，卻更難察覺。
    const out = [];
    const patterns = db.iphone.meta.matches;
    for (const site of sites) {
        if (!db.iphone.rules[site.key]) continue;
        for (const [host] of site.chapter) {
            if (!patterns.some((p) => parse.matchPatternCovers(p, host))) {
                out.push(`${site.key}: ${host} 沒有對應的 @match（腳本根本不會被注入）`);
            }
        }
    }
    return out;
});

console.log('\n== 網址比對 ==');

check('每條 iPhone 規則都有比對樣本', () => {
    const covered = new Set(sites.map((s) => s.key));
    return Object.keys(db.iphone.rules)
        .filter((k) => !covered.has(k))
        .map((k) => `${k} 沒有樣本，請補到 test/fixtures/sites.js`);
});

check('章節頁能匹配到預期規則', () => {
    const out = [];
    for (const site of sites) {
        for (const [host, path] of site.chapter) {
            const d = parse.desktopMatch(db.desktop.rules, host, path);
            const i = parse.iphoneMatch(db.iphone.rules, host, path);
            if (!d || d.key !== site.key) {
                out.push(`桌面 ${host}${path} → ${d ? d.key : '無匹配'}（預期 ${site.key}）`);
            }
            if (!i || i.key !== site.key) {
                out.push(`iPhone ${host}${path} → ${i ? i.key : '無匹配'}（預期 ${site.key}）`);
            }
        }
    }
    return out;
});

check('非章節頁不會誤匹配', () => {
    const out = [];
    for (const site of sites) {
        for (const [host, path] of site.notChapter || []) {
            const d = parse.desktopMatch(db.desktop.rules, host, path);
            const i = parse.iphoneMatch(db.iphone.rules, host, path);
            if (d && d.key === site.key && !d.undecidable) {
                out.push(`桌面 ${host}${path} 誤匹配到 ${site.key}`);
            }
            if (i && i.key === site.key) {
                out.push(`iPhone ${host}${path} 誤匹配到 ${site.key}`);
            }
        }
    }
    return out;
});

console.log('\n== 下載到閱讀器（共用區塊） ==');

const fs = require('fs');
const vm = require('vm');
function sharedBlock(src) {
    const a = src.indexOf('// ==== dl-shared-begin ====');
    const b = src.indexOf('// ==== dl-shared-end ====');
    if (a < 0 || b < 0) return null;
    return src.slice(a, b);
}
const dlDesktop = sharedBlock(fs.readFileSync(require.resolve('../MyAutoPager.user.js'), 'utf8'));
const dlIphone = sharedBlock(fs.readFileSync(require.resolve('../MyAutoPager-iPhone.user.js'), 'utf8'));

check('兩版的下載共用區塊逐字相同', () => {
    if (!dlDesktop) return ['桌面版找不到 dl-shared-begin／end 標記'];
    if (!dlIphone) return ['iPhone 版找不到 dl-shared-begin／end 標記'];
    if (dlDesktop === dlIphone) return [];
    const la = dlDesktop.split('\n'), lb = dlIphone.split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        if (la[i] !== lb[i]) return [`第 ${i + 1} 行起不同：\n      桌面   ${la[i]}\n      iPhone ${lb[i]}`];
    }
    return ['內容不同'];
});

// 共用區塊只定義函式與常數，可以單獨在 vm 裡求值，測其中不碰 DOM 的純函式
const dl = (() => {
    const ctx = { URL, console };
    vm.createContext(ctx);
    vm.runInContext(dlDesktop + '\nthis.api = { dlTitleKey, dlJoinLines, dlShape, dlLastNum, dlBookId, dlAbsUrl, dlNormHost, dlEstimate, dlProgressText, dlGuessTitle };', ctx);
    return ctx.api;
})();

function same(out, label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        out.push(`${label}：得到 ${JSON.stringify(actual)}，預期 ${JSON.stringify(expected)}`);
    }
}

check('同章分頁的標題去掉頁碼後相同（才會合併）', () => {
    const out = [];
    same(out, '（2 / 3）', dl.dlTitleKey('第12章 風起（2 / 3）'), dl.dlTitleKey('第12章 風起'));
    same(out, '(2/3)', dl.dlTitleKey('第12章 風起(2/3)'), '第12章風起');
    same(out, '（2）', dl.dlTitleKey('第12章（2）'), '第12章');
    same(out, '_2', dl.dlTitleKey('第12章_2'), '第12章');
    // 不同章不能被當成同一章
    if (dl.dlTitleKey('第12章') === dl.dlTitleKey('第13章')) out.push('第12章 與 第13章 被視為同一章');
    if (dl.dlTitleKey('第1章') === dl.dlTitleKey('第11章')) out.push('第1章 與 第11章 被視為同一章');
    same(out, '空標題', dl.dlTitleKey(''), '');
    return out;
});

check('分頁切在句子中間時接回同一段', () => {
    const out = [];
    same(out, '沒有句末標點', dl.dlJoinLines(['他說不'], ['過眨眼的功夫。', '下一段']), ['他說不過眨眼的功夫。', '下一段']);
    same(out, '下一頁以標點開頭', dl.dlJoinLines(['他說完了。'], ['」然後走了。']), ['他說完了。」然後走了。']);
    same(out, '正常換段不接', dl.dlJoinLines(['第一段。'], ['第二段。']), ['第一段。', '第二段。']);
    same(out, '空的一邊', dl.dlJoinLines([], ['a']), ['a']);
    return out;
});

check('目錄頁挑章節連結用的網址形狀', () => {
    const out = [];
    same(out, 'oop 續頁與首頁同形', dl.dlShape('https://oop.tw/areada/x/a22487_2a.html'), dl.dlShape('https://oop.tw/areada/x/a1a.html'));
    same(out, 'novels 續頁', dl.dlShape('https://novels.com.tw/novels/x/206331926_2.html'), '/novels/x/#.html');
    if (dl.dlShape('https://uukanshu.cc/b/123/') === dl.dlShape('https://uukanshu.cc/b/123/456.html')) out.push('書頁與章節頁形狀相同');
    same(out, '最後一段數字', dl.dlLastNum('https://www.qimao.com/shuku/195958-47540682/'), 47540682);
    return out;
});

check('進度估計：站方寫明的總章數優先；實際超過估計就不顯示總數', () => {
    const out = [];
    const list = Array.from({ length: 42 }, (_, i) => 'https://a.tw/b/' + (i + 1) + '.html');
    same(out, '目錄只列 42 章、站方寫共 120 章', dl.dlEstimate({ list, total: 120 }, list[0]), 120);
    same(out, '從第 10 章開始', dl.dlEstimate({ list, total: 42 }, list[9]), 33);
    same(out, '本章不在目錄清單裡就不估', dl.dlEstimate({ list, total: 120 }, 'https://a.tw/b/99.html'), 0);
    const t = dl.dlProgressText({ chapters: 48, est: 42, slow: 1, t0: 0 }, '049');
    if (/約 42/.test(t)) out.push('實際 48 章超過估計 42 仍顯示：' + t);
    same(out, '超過估計時的文字', t, '已抓 48 章：049');
    return out;
});

check('書本 id：電腦與手機網域前綴不同仍是同一本', () => {
    const out = [];
    same(out, '目錄網址', dl.dlBookId('https://www.twkan.com/book/112514/index.html', 'https://www.twkan.com/txt/112514/1'), 'twkan.com/book/112514/index.html');
    same(out, 'm. 前綴', dl.dlBookId('https://m.twkan.com/book/112514/index.html', ''), 'twkan.com/book/112514/index.html');
    same(out, '沒有目錄時用章節目錄', dl.dlBookId('', 'https://ttks.tw/novel/chapters/abc/16.html'), 'ttks.tw/novel/chapters/abc/');
    same(out, 'javascript: 連結不算', dl.dlAbsUrl('javascript:void(0)', 'https://a.com/'), '');
    same(out, '相對網址以來源頁解析', dl.dlAbsUrl('17.html#top', 'https://a.com/x/16.html'), 'https://a.com/x/17.html');
    return out;
});

check('書名猜測：不能把章名當書名', () => {
    const out = [];
    const doc = (title, meta) => ({ title, querySelector: () => meta ? { getAttribute: () => meta } : null });
    same(out, 'uuread：書名_章名_…_站名', dl.dlGuessTitle(doc('鬥破：全圖最強，我永遠在你之上_第1章 九星大斗師！三品煉藥師！_免費小說閱讀_uu看書')), '鬥破：全圖最強，我永遠在你之上');
    same(out, '章名_書名_站名', dl.dlGuessTitle(doc('第十二章 出山_劍來_某某小說網')), '劍來');
    same(out, '書名號優先', dl.dlGuessTitle(doc('第3章 下山 - 《劍來》 - 站名')), '劍來');
    same(out, 'og:novel:book_name 最優先', dl.dlGuessTitle(doc('第1章_錯的', '對的書名')), '對的書名');
    same(out, '沒有章名時沿用第二段', dl.dlGuessTitle(doc('序言_某書_站名')), '某書');
    return out;
});

console.log(`\n${failed ? '✗ 失敗' : '✓ 全數通過'} — ${passed} 項通過、${failed} 項失敗`);

if (failed) {
    console.log('\n失敗項目：');
    failures.forEach((f) => console.log(`  - ${f.name}（${f.problems.length} 個問題）`));
}

process.exit(failed ? 1 : 0);
