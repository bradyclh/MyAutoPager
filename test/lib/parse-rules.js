'use strict';

// 從兩個 userscript 中把規則物件抽出來。
//
// 這兩個檔案是給油猴執行的 IIFE，沒有模組出口，也不能直接 require
// （它們一載入就會去碰 GM_* / location / document）。所以這裡只做一件事：
// 用括號配對切出規則物件的字面量，再單獨 eval 那一段。
// 規則裡的 function 只是被定義、不會被呼叫，因此不需要真的 DOM。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP = path.join(ROOT, 'MyAutoPager.user.js');
const IPHONE = path.join(ROOT, 'MyAutoPager-iPhone.user.js');

// 從 openIdx 的 '{' 開始做括號配對，回傳結尾 '}' 的索引。
// 需要跳過字串、範本字串、註解與正則字面量，否則規則裡的
// '{display:none}' 或 /\d+/ 會把配對算歪。
function matchBrace(src, openIdx) {
    let depth = 0;
    let prev = '';
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];

        if (c === '/' && n === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && n === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i++;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            i++;
            while (i < src.length) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === quote) break;
                i++;
            }
            prev = quote;
            continue;
        }
        // 正則字面量：前一個有意義的字元是運算子或分隔符時，'/' 才是 regex 開頭
        if (c === '/' && /[=(,:[!&|?{};+\-*%~^]/.test(prev)) {
            i++;
            let inClass = false;
            while (i < src.length) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '[') inClass = true;
                else if (src[i] === ']') inClass = false;
                else if (src[i] === '/' && !inClass) break;
                else if (src[i] === '\n') break;
                i++;
            }
            prev = '/';
            continue;
        }

        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return i;
        }
        if (!/\s/.test(c)) prev = c;
    }
    return -1;
}

function extractObject(src, anchor, label) {
    const at = src.indexOf(anchor);
    if (at < 0) throw new Error(`找不到 ${label} 的錨點：${anchor}`);
    const open = src.indexOf('{', at);
    const close = matchBrace(src, open);
    if (close < 0) throw new Error(`${label} 括號配對失敗`);
    return src.slice(open, close + 1);
}

// 規則裡的 function 引用了腳本內的輔助函式。函式本體不會被呼叫，
// 但有些屬性是直接引用（例如 bF: src_bF），求值當下就需要那個名字存在。
// 與其逐一列舉，用 Proxy 讓任何未知識別字都解析成 stub，並記錄下來供診斷。
function makeSandbox(seen) {
    const noop = function () {};
    const base = {
        getAll: () => [],
        getOne: () => null,
        getCSS: () => null,
        getAllCSS: () => [],
        getXpath: () => null,
        getAllXpath: () => [],
        cleanContent: (x) => x,
        insStyle: noop,
        insScript: noop,
        isMobile: () => false,
        console: { info: noop, warn: noop, error: noop, log: noop },
        unsafeWindow: {},
        location: { hostname: '', pathname: '', search: '', href: '' },
        document: { querySelector: () => null, querySelectorAll: () => [] },
        window: {},
        DBSite: {},
        curSite: null,
        urlC: false,
        lp: '',
    };

    const handler = {
        has: () => true,
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop === 'symbol') return undefined;
            // Symbol.unscopables 等內部查詢不算未定義引用
            if (prop === 'Symbol' || prop === 'undefined') return undefined;
            seen.add(String(prop));
            return noop;
        },
    };

    return vm.createContext(new Proxy(base, handler));
}

function evalObject(literal, label) {
    const seen = new Set();
    try {
        const value = vm.runInContext('(' + literal + ')', makeSandbox(seen), { timeout: 5000 });
        return { value, stubbed: [...seen] };
    } catch (e) {
        throw new Error(`${label} eval 失敗：${e.message}`);
    }
}

function readMeta(src) {
    const version = (src.match(/^\/\/ @version\s+(.+)$/m) || [])[1];
    const matches = [...src.matchAll(/^\/\/ @match\s+(.+)$/gm)].map((m) => m[1].trim());
    const excludes = [...src.matchAll(/^\/\/ @exclude\s+(.+)$/gm)].map((m) => m[1].trim());
    return { version: version ? version.trim() : null, matches, excludes };
}

function checkSyntax(src, label) {
    try {
        new vm.Script(src, { filename: label });
        return null;
    } catch (e) {
        return e.message;
    }
}

function load() {
    const desktopSrc = fs.readFileSync(DESKTOP, 'utf8');
    const iphoneSrc = fs.readFileSync(IPHONE, 'utf8');

    const desktopEval = evalObject(extractObject(desktopSrc, 'DBSite = {', 'DBSite'), 'DBSite');
    const iphoneEval = evalObject(extractObject(iphoneSrc, 'var rules = {', 'rules'), 'rules');

    return {
        desktop: {
            label: 'MyAutoPager.user.js',
            src: desktopSrc,
            meta: readMeta(desktopSrc),
            syntaxError: checkSyntax(desktopSrc, 'MyAutoPager.user.js'),
            rules: desktopEval.value,
            stubbed: desktopEval.stubbed,
        },
        iphone: {
            label: 'MyAutoPager-iPhone.user.js',
            src: iphoneSrc,
            meta: readMeta(iphoneSrc),
            syntaxError: checkSyntax(iphoneSrc, 'MyAutoPager-iPhone.user.js'),
            rules: iphoneEval.value,
            stubbed: iphoneEval.stubbed,
        },
    };
}

// ---- 比對邏輯：必須與兩個腳本內的實作保持一致 ----

// 桌面版 matchSingleHost / matchHost：字串前後包 '/' 視為正則，否則字面相等
function desktopMatchHost(host, hostname) {
    const one = (h) => {
        if (typeof h === 'string' && h.charAt(0) === '/' && h.charAt(h.length - 1) === '/') {
            return new RegExp(h.slice(1, -1)).test(hostname);
        }
        return hostname === h;
    };
    if (!host) return false;
    if (typeof host === 'string') return one(host);
    if (Array.isArray(host)) return host.some(one);
    return false;
}

// 桌面版 matchUrl：字串包 '/' 視為正則，比對 pathname + search；
// 函式形式無法在靜態環境判定，回傳 null 代表「不可判定」。
function desktopMatchUrl(url, pathAndSearch) {
    if (url === undefined) return true;
    if (typeof url === 'string') {
        if (url.charAt(0) === '/' && url.charAt(url.length - 1) === '/') {
            return new RegExp(url.slice(1, -1)).test(pathAndSearch);
        }
        return null;
    }
    if (typeof url === 'function') return null;
    if (url instanceof RegExp) return url.test(pathAndSearch);
    return null;
}

function desktopMatch(rules, hostname, pathAndSearch) {
    for (const key of Object.keys(rules)) {
        const rule = rules[key];
        if (!desktopMatchHost(rule.host, hostname)) continue;
        const urlOk = desktopMatchUrl(rule.url, pathAndSearch);
        if (urlOk === false) continue;
        if (urlOk === null) return { key, undecidable: true };
        return { key, undecidable: false };
    }
    return null;
}

// iPhone 版 matchRule：host 字面相等或為子網域；url 是真正的 RegExp
function iphoneMatch(rules, hostname, pathAndSearch) {
    for (const key of Object.keys(rules)) {
        const rule = rules[key];
        const hosts = Array.isArray(rule.host) ? rule.host : [rule.host];
        const hostOk = hosts.some((h) => hostname === h || hostname.indexOf('.' + h) !== -1);
        if (!hostOk) continue;
        if (rule.url && !rule.url.test(pathAndSearch)) continue;
        return { key, undecidable: false };
    }
    return null;
}

// @match 樣式（*://host/*）是否涵蓋某個 hostname
function matchPatternCovers(pattern, hostname) {
    const m = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)?$/);
    if (!m) return false;
    const hostPart = m[2];
    if (hostPart === '*') return true;
    if (hostPart.startsWith('*.')) {
        const base = hostPart.slice(2);
        return hostname === base || hostname.endsWith('.' + base);
    }
    return hostname === hostPart;
}

module.exports = {
    load,
    desktopMatch,
    desktopMatchHost,
    iphoneMatch,
    matchPatternCovers,
    DESKTOP,
    IPHONE,
};
