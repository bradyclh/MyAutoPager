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

console.log(`\n${failed ? '✗ 失敗' : '✓ 全數通過'} — ${passed} 項通過、${failed} 項失敗`);

if (failed) {
    console.log('\n失敗項目：');
    failures.forEach((f) => console.log(`  - ${f.name}（${f.problems.length} 個問題）`));
}

process.exit(failed ? 1 : 0);
