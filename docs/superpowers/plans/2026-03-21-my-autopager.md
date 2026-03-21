# MyAutoPager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Tampermonkey auto-pager userscript with rule-driven architecture, 3 paging modes, and ~15 built-in rules.

**Architecture:** Single IIFE in one `.user.js` file, organized into 8 sections (metadata, config, rules, core, DOM, rules engine, UI, init). Each task adds a complete section, producing a progressively more functional script.

**Tech Stack:** Vanilla JavaScript (ES6+), Tampermonkey GM_* APIs, Shadow DOM for UI isolation.

**Testing note:** This is a Tampermonkey userscript — no unit test framework. Each task's verification is: install in Tampermonkey → navigate to test site → check browser DevTools console + visual behavior.

**Spec:** `docs/superpowers/specs/2026-03-21-autopager-rewrite-design.md`

**Original for reference:** `AutoPager-6.6.73.user.js` (port relevant functions, do not copy wholesale)

---

### Task 1: Metadata + IIFE Shell + DOM Utilities

**Files:**
- Create: `MyAutoPager.user.js`

This task creates the foundation: metadata block, IIFE wrapper, and all DOM utility functions that every other section depends on.

- [ ] **Step 1: Create file with UserScript metadata**

Write the full `// ==UserScript==` block. Include all `@grant`, `@match`, `@exclude` directives. The `@exclude` list comes from the original script (lines 56-88).

```javascript
// ==UserScript==
// @name         MyAutoPager
// @name:zh-TW   自動無縫翻頁
// @version      1.0.0
// @author       clh
// @description  自動無縫翻頁 — 無需手動點擊下一頁
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_info
// @grant        GM.info
// @grant        window.onurlchange
// @grant        unsafeWindow
// @sandbox      JavaScript
// @license      MIT
// @run-at       document-end
// @exclude      https://*.taobao.com/*
// @exclude      https://*.tmall.com/*
// ... (copy full @exclude list from original lines 56-88)
// ==/UserScript==
```

- [ ] **Step 2: Add IIFE wrapper and DOM utility functions**

After the metadata, add the IIFE and all DOM selector/utility functions. Port these directly from original:

- `getCSS(css, contextNode)` — original line 2342
- `getAllCSS(css, contextNode)` — original line 2345
- `getXpath(xpath, contextNode, doc)` — original line 2348
- `getAllXpath(xpath, contextNode, doc)` — original line 2358
- `getOne(selector, contextNode, doc)` — original line 2373
- `getAll(selector, contextNode, doc)` — original line 2382
- `getAllParentElement(selector, contextNode, doc)` — original line 2392
- `createDocumentByString(e)` — original line 2403

```javascript
(function() {
    'use strict';

    // ========== DOM 選擇器 ==========

    function getCSS(css, contextNode = document) {
        return contextNode.querySelector(css);
    }
    function getAllCSS(css, contextNode = document) {
        return [].slice.call(contextNode.querySelectorAll(css));
    }
    function getXpath(xpath, contextNode, doc = document) {
        contextNode = contextNode || doc;
        try {
            const result = doc.evaluate(xpath, contextNode, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return result.singleNodeValue && result.singleNodeValue.nodeType === 1 && result.singleNodeValue;
        } catch (err) {
            throw new Error(`Invalid Xpath: ${xpath}`);
        }
    }
    function getAllXpath(xpath, contextNode, doc = document) {
        contextNode = contextNode || doc;
        const result = [];
        try {
            const query = doc.evaluate(xpath, contextNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < query.snapshotLength; i++) {
                const node = query.snapshotItem(i);
                if (node.nodeType === 1) result.push(node);
            }
        } catch (err) {
            throw new Error(`Invalid Xpath: ${xpath}`);
        }
        return result;
    }
    function getOne(selector, contextNode = undefined, doc = document) {
        if (!selector) return;
        contextNode = contextNode || doc;
        if (selector.slice(0,1) === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getXpath(selector, contextNode, doc);
        }
        return getCSS(selector, contextNode);
    }
    function getAll(selector, contextNode = undefined, doc = document) {
        if (!selector) return [];
        contextNode = contextNode || doc;
        if (selector.slice(0,1) === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getAllXpath(selector, contextNode, doc);
        }
        return getAllCSS(selector, contextNode);
    }
    function getAllParentElement(selector, contextNode = undefined, doc = document) {
        contextNode = contextNode || doc;
        const parents = [];
        getAll(selector, contextNode, doc).forEach((next) => {
            const parent = next.parentElement;
            if (!parents.includes(parent)) parents.push(parent);
        });
        return parents;
    }
    function createDocumentByString(e) {
        if (e) {
            if ('HTML' !== document.documentElement.nodeName) return (new DOMParser).parseFromString(e, 'application/xhtml+xml');
            var t;
            try { t = (new DOMParser).parseFromString(e, 'text/html'); } catch (e) {}
            if (t) return t;
            if (document.implementation.createHTMLDocument) {
                t = document.implementation.createHTMLDocument('ADocument');
            } else {
                try { t = document.cloneNode(!1); t.appendChild(t.importNode(document.documentElement, !1)); t.documentElement.appendChild(t.createElement('head')); t.documentElement.appendChild(t.createElement('body')); } catch (e) {}
            }
            if (t) {
                var r = document.createRange(), n = r.createContextualFragment(e);
                r.selectNodeContents(document.body);
                t.body.appendChild(n);
                for (var a, o = {TITLE:!0,META:!0,LINK:!0,STYLE:!0,BASE:!0}, i = t.body, s = i.childNodes, c = s.length - 1; c >= 0; c--) o[(a = s[c]).nodeName] && i.removeChild(a);
                return t;
            }
        } else console.error('[MyAutoPager] createDocumentByString: empty input');
    }

    // placeholder: more sections will be added here

})();
```

- [ ] **Step 3: Add injection and general utility functions**

Add these functions inside the IIFE, after DOM selectors:

- `insStyle(style)` — original line 2335 (auto-append `{display:none!important}` if no `{`)
- `insScript(selector, contextNode, toE)` — original line 2314
- `indexOF(e, l, low)` — original line 2518 (URL path/search/href matching)
- `isMobile()` — original line 2510
- `isHidden(el)` — original line 2506
- `isTitle(title)` — original line 2537
- `getSearch(variable)` — original line 2576
- `getCookie(name)` — original line 2900
- `getAddTo(num)` — original line 2911 (insertP position to insertAdjacentElement position string)
- `toE5pop(a)` — original line 2926 (exclude script/style/link from position 5 target)
- `openInTab(url)` — original line 2427 (GM_openInTab fallback)

```javascript
    // ========== 工具函數 ==========

    function insStyle(style) {
        if (style.indexOf('{') === -1) style += '{display: none !important;}';
        document.documentElement.appendChild(document.createElement('style')).textContent = style;
    }

    function insScript(selector, contextNode = document, toE = document.body) {
        let scriptElems = contextNode;
        if (selector) {
            if (contextNode instanceof Array) {
                scriptElems = []; contextNode.forEach(function(one) { scriptElems = scriptElems.concat(getAll(selector, one, one)); });
            } else {
                scriptElems = getAll(selector, contextNode, contextNode);
            }
        }
        scriptElems.forEach(function(one) {
            if (one.tagName === 'SCRIPT') {
                if (one.src) { toE.appendChild(document.createElement('script')).src = one.src; }
                else { toE.appendChild(document.createElement('script')).textContent = one.textContent; }
            }
        });
    }

    function indexOF(e, l = 'p', low = true) {
        switch (l) {
            case 'h': l = location.href; break;
            case 'p': l = location.pathname; break;
            case 's': l = location.search; break;
        }
        if (e instanceof RegExp) { if (e.test(l)) return true; }
        else {
            if (low) { e = e.toLowerCase(); l = l.toLowerCase(); }
            if (l.indexOf(e) !== -1) return true;
        }
        return false;
    }

    function getSearch(variable) {
        let query = window.location.search.substring(1), vars = query.split('&');
        for (let i = 0; i < vars.length; i++) {
            let pair = vars[i].split('=');
            if (pair[0] === variable) return pair[1];
        }
        return '';
    }

    function getCookie(name) {
        if (!name) return '';
        let arr = document.cookie.split(';'); name += '=';
        for (let i = 0; i < arr.length; i++) {
            let now = arr[i].trim();
            if (now.indexOf(name) === 0) return now.substring(name.length, now.length);
        }
        return '';
    }

    function isMobile() {
        return (/(phone|pad|pod|iPhone|iPod|ios|iPad|Android|Mobile|BlackBerry|MicroMessenger|IEMobile|MQQBrowser|JUC|Fennec|wOSBrowser|BrowserNG|WebOS|Symbian|Windows Phone)/i.test(navigator.userAgent) || (window.screen.width < 500 && window.screen.height < 800));
    }

    function isHidden(el) { return el.offsetParent === null; }
    function isTitle(title) { return document.title.indexOf(title) > -1; }

    function getSearch(variable) {
        // Port from original line 2576-2583
    }

    function getCookie(name) {
        // Port from original line 2900-2908
    }

    function getAddTo(num) {
        switch (num) {
            case 1: return 'beforebegin';
            case 2: return 'afterbegin';
            case 3: case 6: return 'beforeend';
            case 4: case 5: return 'afterend';
        }
    }

    function toE5pop(a) {
        if (a.length === 0) return;
        let b = a.pop();
        if (b.tagName === 'SCRIPT' || b.tagName === 'STYLE' || b.tagName === 'LINK') return toE5pop(a);
        return b;
    }

    if (typeof GM_openInTab !== 'function') { GM_openInTab = function(url) { window.open(url); }; }
    if (typeof structuredClone !== 'function') { structuredClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }; }
```

- [ ] **Step 4: Install in Tampermonkey and verify**

Install the script in Tampermonkey. Navigate to any page. Open DevTools console.

Expected: No errors. Script loads silently.

- [ ] **Step 5: Commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: create MyAutoPager skeleton with DOM utilities"
```

---

### Task 2: Config + GM Storage + Rule Merging

**Files:**
- Modify: `MyAutoPager.user.js`

Add global state variables, GM storage initialization, and the rule merging system (custom rules overlay on built-in rules, with `inherits` support).

- [ ] **Step 1: Add global state and GM storage init**

Insert after utility functions, before the closing `})()`:

```javascript
    // ========== 全域狀態 ==========

    var menuAll = [
        ['menu_disable', '✅ 已啟用 (點擊對當前網站禁用)', '❌ 已禁用 (點擊對當前網站啟用)', []],
        ['menu_page_number', '顯示當前頁碼及點擊暫停翻頁', '顯示當前頁碼及點擊暫停翻頁', true],
        ['menu_history', '添加歷史記錄+修改地址/標題', '添加歷史記錄+修改地址/標題', true],
        ['menu_customRules', '自定義翻頁規則', '自定義翻頁規則', {}]
    ];
    var menuId = [], curSite = {SiteTypeID: 0}, DBSite, DBSite2,
        pausePage = true, pageNum = {now: 1, _now: 1},
        urlC = false, nowLocation = '', lp = location.pathname;

    // 初始化 GM 存儲
    for (let i = 0; i < menuAll.length; i++) {
        if (GM_getValue(menuAll[i][0]) == null) GM_setValue(menuAll[i][0], menuAll[i][3]);
    }

    function isUrlC() { urlC = true; }
```

- [ ] **Step 2: Add setDBSite() with empty rules placeholder**

```javascript
    // ========== 內建規則 ==========

    function setDBSite() {
        DBSite = {
            // 規則將在 Task 7 填入
        };
    }
    setDBSite();
```

- [ ] **Step 3: Add rule merging logic**

Port the merging logic from original lines 1107-1134. Custom rules override built-in; `inherits: true` triggers deep merge of pager sub-object.

```javascript
    // ========== 規則合併 ==========

    function mergeRules() {
        let _customRules = GM_getValue('menu_customRules', {});
        if (Object.prototype.toString.call(_customRules) !== '[object Object]') _customRules = {};
        let _customKeys = Object.keys(_customRules);

        if (_customKeys.length === 0) {
            // 無自定義規則，直接用內建
            DBSite2 = structuredClone(DBSite);
        } else {
            // 處理 inherits 合併
            let _builtinKeys = Object.keys(DBSite);
            for (let i = 0; i < _customKeys.length; i++) {
                let key = _customKeys[i];
                if (_builtinKeys.indexOf(key) !== -1) {
                    if (_customRules[key].inherits === true) {
                        if (_customRules[key].pager && DBSite[key].pager) {
                            _customRules[key].pager = Object.assign({}, DBSite[key].pager, _customRules[key].pager);
                        }
                        _customRules[key] = Object.assign({}, DBSite[key], _customRules[key]);
                    }
                    delete DBSite[key];
                }
            }
            DBSite = Object.assign({}, _customRules, DBSite);
            DBSite2 = Object.assign({}, structuredClone(_customRules), structuredClone(DBSite));
        }

        // 生成 SiteTypeID
        let num = 0;
        for (let val in DBSite) { DBSite[val].SiteTypeID = ++num; }
    }
    mergeRules();
```

- [ ] **Step 4: Add window.autoPage exposure**

```javascript
    // ========== 暴露 API ==========

    window.autoPage = {
        lp: () => location.pathname, indexOF, isMobile, isUrlC, isPager: function(){return false;},
        isTitle, getAll, getOne, getAllXpath, getXpath, getAllCSS, getCSS,
        getNextE: function(){return '';}, getNextEP: function(){return '';},
        getNextSP: function(){return '';}, getNextEPN: function(){return '';},
        getNextUPN: function(){return '';}, getNextUP: function(){return '';},
        getNextF: function(){return '';}, getSearch, getCookie,
        insStyle, insScript, cleanuEvent: function(){},
        src_bF: function(p){return p;}, xs_bF: function(p){return p;},
        pageNumIncrement: function(){}
    };
```

Note: Placeholder functions will be replaced with real implementations in later tasks.

- [ ] **Step 5: Verify in Tampermonkey**

Install updated script. Open console. Run: `window.autoPage` — should return the object with all function keys.

- [ ] **Step 6: Commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: add config, GM storage init, and rule merging"
```

---

### Task 3: Rule Matching Engine

**Files:**
- Modify: `MyAutoPager.user.js`

Implement the rule matching engine: iterate merged rules, match host → url → disable check, set `curSite`.

- [ ] **Step 1: Add matchRule() function**

Insert after `mergeRules()`:

```javascript
    // ========== 規則匹配 ==========

    var DBSiteNow; // 當前正在檢查的規則（供 isPager 使用）

    function matchRule() {
        curSite = {SiteTypeID: 0};
        urlC = false;

        for (let key in DBSite) {
            let rule = DBSite[key];
            DBSiteNow = rule;

            // 1. host 匹配
            if (!matchHost(rule.host)) continue;

            // 2. url 匹配（可選）
            if (rule.url !== undefined && !matchUrl(rule.url, rule)) continue;

            // 3. 禁用清單
            let disableList = GM_getValue('menu_disable', []);
            if (disableList.indexOf(location.hostname) !== -1) {
                curSite = {SiteTypeID: 0};
                return;
            }

            curSite = rule;
            console.info('[MyAutoPager] 匹配規則:', key);
            return;
        }
    }

    function matchHost(host) {
        if (!host) return false;
        if (typeof host === 'string') {
            if (host.charAt(0) === '/' && host.charAt(host.length - 1) === '/') {
                return new RegExp(host.slice(1, -1)).test(location.hostname);
            }
            return location.hostname === host;
        }
        if (Array.isArray(host)) {
            return host.some(h => location.hostname === h);
        }
        return false;
    }

    function matchUrl(url, rule) {
        if (typeof url === 'string') {
            if (url.charAt(0) === '/' && url.charAt(url.length - 1) === '/') {
                return new RegExp(url.slice(1, -1)).test(location.pathname + location.search);
            }
            // 函數字串
            try {
                return new Function('fun', 'rule', url)(window.autoPage, rule);
            } catch (e) {
                console.error('[MyAutoPager] url 規則執行錯誤:', url, e);
                return false;
            }
        }
        if (typeof url === 'function') {
            return url(window.autoPage, rule);
        }
        return false;
    }
```

- [ ] **Step 2: Add isPager() function**

Port from original line 2541-2573. This is used by rules' `url` functions to check if pager elements exist on the page.

```javascript
    function isPager(type) {
        if (!type) {
            if (!DBSiteNow.pager) return false;
            let pType = DBSiteNow.pager.type;
            if (pType === undefined || pType === 1 || pType === 6) {
                if (typeof DBSiteNow.pager.nextL == 'string' && !DBSiteNow.pager.nextL.match(/^js;/i)) {
                    type = DBSiteNow.pager.pageE ? 'n,p' : 'n';
                } else if (DBSiteNow.pager.pageE) {
                    type = 'p';
                }
            } else if (pType === 2) {
                if (typeof DBSiteNow.pager.nextL == 'string' && !DBSiteNow.pager.nextL.match(/^js;/i)) type = 'n';
            }
            if (!type) return false;
        }
        const typeArr = type.split(',');
        for (let i = 0; i < typeArr.length; i++) {
            switch (typeArr[i]) {
                case 'n': if (!getOne(DBSiteNow.pager.nextL)) return false; break;
                case 'p': if (!getOne(DBSiteNow.pager.pageE)) return false; break;
                case 'i': if (!getOne(DBSiteNow.pager.insertP[0])) return false; break;
                case 'r': if (!getOne(DBSiteNow.pager.replaceE)) return false; break;
            }
        }
        return true;
    }
```

Update `window.autoPage.isPager` to point to the real function.

- [ ] **Step 3: Test with a temporary rule**

Temporarily add to `setDBSite()`:

```javascript
        DBSite = {
            _test: {
                host: location.hostname, // 匹配當前網站
                pager: { nextL: 'a' }
            }
        };
```

Call `matchRule()` at the end of the script. Check console for `[MyAutoPager] 匹配規則: _test`.

- [ ] **Step 4: Remove test rule, commit**

Remove `_test` rule. Keep `matchRule()` call.

```bash
git add MyAutoPager.user.js
git commit -m "feat: add rule matching engine with host/url/disable support"
```

---

### Task 4: Core Paging Engine — Type 1 (XHR)

**Files:**
- Modify: `MyAutoPager.user.js`

This is the largest task. Implement the scroll watcher, URL resolution, XHR fetching, and DOM insertion pipeline.

- [ ] **Step 1: Add windowScroll() and pageLoading() shell**

```javascript
    // ========== 核心翻頁引擎 ==========

    function windowScroll(fn) {
        var beforeScrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        setTimeout(function() {
            // 避免內容太少無滾動條
            let st = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                sh = window.innerHeight || document.documentElement.clientHeight;
            if (st === 0 && document.documentElement.scrollHeight === sh) {
                insStyle(`html, body {min-height: ${document.documentElement.scrollHeight + 10}px;}`);
            }

            window.addEventListener('scroll', function(e) {
                var afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
                    delta = afterScrollTop - beforeScrollTop;
                if (delta === 0) return false;
                fn(delta > 0 ? 'down' : 'up', e);
                beforeScrollTop = afterScrollTop;
            }, false);
        }, 1000); // 延遲 1 秒避免初始觸發
    }

    function pageLoading() {
        if (curSite.SiteTypeID === 0 || !curSite.pager) return;
        if (curSite.pager.type === undefined) curSite.pager.type = 1;
        if (curSite.pager.scrollD === undefined) curSite.pager.scrollD = 2000;
        if (curSite.pager.interval === undefined) curSite.pager.interval = 500;
        curSite.pageUrl = '';

        windowScroll(function(direction, e) {
            if (direction !== 'down' || !pausePage || curSite.SiteTypeID === 0) return;

            let scrollTop = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                scrollHeight = window.innerHeight || document.documentElement.clientHeight,
                scrollD = curSite.pager.scrollD;

            // 判斷是否達到觸發線
            let triggered = false;
            if (curSite.pager.scrollE) {
                // scrollE 模式：距基準元素的距離
                let scrollE = getOne(curSite.pager.scrollE);
                if (scrollE && scrollE.offsetTop - (scrollTop + scrollHeight) <= scrollD) triggered = true;
            } else if (document.documentElement.scrollHeight <= scrollHeight + scrollTop + scrollD) {
                // 頁底模式：距頁面底部的距離
                triggered = true;
            }

            // 達到觸發線後依 type 分流
            if (triggered) {
                if (curSite.pager.type === 1) {
                    intervalPause();
                    checkURL(fetchNextPage);
                } else if (curSite.pager.type === 2) {
                    clickNextButton();
                } else if (curSite.pager.type === 6) {
                    checkURL(iframeExtract);
                }
            }
        });

        function intervalPause() {
            if (curSite.pager.interval) {
                pausePage = false;
                setTimeout(function() { pausePage = true; }, curSite.pager.interval);
            }
        }
    }
```

- [ ] **Step 2: Add checkURL() — resolveNextURL**

Port from original line 2246-2265. Handle 3 nextL formats + forceHTTPS.

```javascript
    function checkURL(func) {
        if (!curSite.pager.nextL) return;
        if (typeof curSite.pager.nextL === 'function') {
            let url = curSite.pager.nextL();
            if (!url || url === curSite.pageUrl || url.slice(0, 4) !== 'http') return;
            curSite.pageUrl = url;
            func(curSite.pageUrl);
        } else if (curSite.pager.nextL.search(/^js;/i) === 0) {
            try {
                let url = new Function('fun', curSite.pager.nextL.slice(3))(window.autoPage);
                if (!url || url === curSite.pageUrl || url.slice(0, 4) !== 'http') return;
                curSite.pageUrl = url;
                func(curSite.pageUrl);
            } catch (e) {
                console.error('[MyAutoPager] nextL JS 執行錯誤:', curSite.pager.nextL, e);
            }
        } else if (getNextE_()) {
            func(curSite.pageUrl);
        }
    }
```

- [ ] **Step 3: Add getNextE_() and all getNext* URL helpers**

Implement all 8 URL helper functions. `getNextE_` is the core one called by `checkURL`; the rest are API functions called by rules via `fun.getNextE()` etc.

```javascript
    // 內部用：取下一頁 URL，設定 curSite.pageUrl，回傳 boolean
    function getNextE_(css) {
        if (!css) css = curSite.pager.nextL;
        let next = getOne(css);
        if (next && next.nodeType === 1 && next.href && next.href.slice(0,4) === 'http' && next.getAttribute('href').slice(0,1) !== '#') {
            if (next.href !== curSite.pageUrl) {
                if (curSite.pager.forceHTTPS && location.protocol === 'https:') {
                    if (next.href.replace(/^http:/,'https:') === curSite.pageUrl) return false;
                    curSite.pageUrl = next.href.replace(/^http:/,'https:');
                } else {
                    curSite.pageUrl = next.href;
                }
            } else { return false; }
            return true;
        }
        return false;
    }

    // 外部 API：回傳 URL 字串（供規則 fun.getNextE() 呼叫）
    function getNextE(css) {
        if (!css) {
            if (typeof curSite.pager.nextL === 'string' && !curSite.pager.nextL.match(/^js;/i)) css = curSite.pager.nextL;
            else return '';
        }
        let next = getOne(css);
        if (next && next.nodeType === 1 && next.href && next.href.slice(0,4) === 'http' && next.getAttribute('href').slice(0,1) !== '#') {
            if (next.href !== curSite.pageUrl) {
                if (curSite.pager.forceHTTPS && location.protocol === 'https:') {
                    if (next.href.replace(/^http:/,'https:') === curSite.pageUrl) return '';
                    return next.href.replace(/^http:/,'https:');
                }
                return next.href;
            }
            return '';
        }
        return '';
    }

    // 從元素文字取頁碼，替換 URL search 參數
    function getNextEP(css, pf, reg) {
        let nextNum = getOne(css), url = '';
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ','');
            if (location.search) {
                url = indexOF(pf, 's') ? location.search.replace(reg, pf + nextNum) : location.search + '&' + pf + nextNum;
            } else { url = '?' + pf + nextNum; }
            url = location.origin + location.pathname + url;
        }
        return url;
    }

    // 直接給定頁碼，替換 URL search 參數
    function getNextSP(page, pf, reg) {
        let url = '';
        if (!page) return url;
        if (typeof page === 'number') page = page.toString();
        if (location.search) {
            url = indexOF(pf, 's') ? location.search.replace(reg, pf + page) : location.search + '&' + pf + page;
        } else { url = '?' + pf + page; }
        return location.origin + location.pathname + url;
    }

    // 從元素文字取頁碼，替換 URL pathname
    function getNextEPN(css, reg, a, b = '') {
        let nextNum = getOne(css), url = '';
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ','');
            url = indexOF(reg) ? location.pathname.replace(reg, a + nextNum + b) : location.pathname + a + nextNum + b;
            url = location.origin + url + location.search;
        }
        return url;
    }

    // 從 URL pathname 取頁碼 +1，替換 pathname
    function getNextUPN(urlReg, reg, a, b = '', initP = '2', endP) {
        let nextNum = urlReg.exec(location.pathname);
        if (nextNum) {
            nextNum = String(parseInt(nextNum.length > 1 ? nextNum[1] : nextNum[0]) + 1);
            if (endP && parseInt(nextNum) > parseInt(endP)) return '';
        } else {
            nextNum = initP;
            if (endP && parseInt(nextNum) > parseInt(endP)) return '';
        }
        let url = indexOF(reg) ? location.pathname.replace(reg, a + nextNum + b) : location.pathname + a + nextNum + b;
        return location.origin + url + location.search;
    }

    // 從 URL search 取頁碼 +1，替換 search 參數
    function getNextUP(pf, reg, lp_ = location.pathname, initP = '2', endP) {
        let nextNum = getSearch(pf.replace('=',''));
        if (nextNum) {
            nextNum = String(parseInt(nextNum) + 1);
            if (endP && parseInt(nextNum) > parseInt(endP)) return '';
        } else {
            nextNum = initP;
            if (endP && parseInt(nextNum) > parseInt(endP)) return '';
        }
        let url = '';
        if (location.search) {
            url = indexOF(pf, 's') ? location.search.replace(reg, pf + nextNum) : location.search + '&' + pf + nextNum;
        } else { url = '?' + pf + nextNum; }
        return location.origin + lp_ + url;
    }

    // 從 form input 取得 GET URL
    function getNextF(css) {
        let form = getOne(css), value = '';
        if (form) {
            form.querySelectorAll('input[name]').forEach(function(input) { value += input.name + '=' + input.value + '&'; });
            value = encodeURI(value.replace(/&$/, ''));
            if (form.action && value) return form.action + '?' + value;
        }
        return '';
    }
```

After implementing, update `window.autoPage` to point to real functions:

```javascript
    Object.assign(window.autoPage, {
        getNextE, getNextEP, getNextSP, getNextEPN, getNextUPN, getNextUP, getNextF, isPager
    });
```

- [ ] **Step 4: Add fetchNextPage() — XHR with Chrome/Firefox dual path**

Port from original `getPageE()` at line 1683-1749. Chrome path uses native XMLHttpRequest; Firefox path uses GM_xmlhttpRequest with cookiePartition + arraybuffer + TextDecoder.

```javascript
    function fetchNextPage(url) {
        if (curSite.gmxhr || navigator.userAgent.includes('Firefox')) {
            let gmHeaders = {'Accept': 'text/html,application/xhtml+xml,application/xml'};
            if (curSite.xRequestedWith) gmHeaders['x-requested-with'] = 'XMLHttpRequest';
            if (!curSite.noReferer) gmHeaders['Referer'] = location.href;
            GM_xmlhttpRequest({
                url: url,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: gmHeaders,
                cookiePartition: { topLevelSite: location.origin },
                timeout: 5000,
                onload: function(response) {
                    try {
                        let charset = document.characterSet || document.charset || document.inputEncoding;
                        processElements(createDocumentByString(new TextDecoder(charset).decode(response.response)));
                    } catch (e) {
                        console.error('[MyAutoPager] 處理下一頁內容錯誤:', e, url);
                    }
                },
                onerror: function() { GM_notification({text: '❌ 獲取下一頁失敗...', timeout: 3000}); },
                ontimeout: function() {
                    setTimeout(function() { curSite.pageUrl = ''; }, 3000);
                    GM_notification({text: '❌ 獲取下一頁超時...', timeout: 3000});
                }
            });
        } else {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            let charset = document.characterSet || document.charset || document.inputEncoding;
            xhr.overrideMimeType('text/html; charset=' + charset);
            if (curSite.xRequestedWith) xhr.setRequestHeader('x-requested-with', 'XMLHttpRequest');
            xhr.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml');
            xhr.timeout = 5000;
            xhr.onload = function() {
                try { processElements(createDocumentByString(xhr.responseText)); }
                catch (e) { console.error('[MyAutoPager] 處理下一頁內容錯誤:', e, url); }
            };
            xhr.onerror = function() { GM_notification({text: '❌ 獲取下一頁失敗...', timeout: 3000}); };
            xhr.ontimeout = function() {
                setTimeout(function() { curSite.pageUrl = ''; }, 3000);
                GM_notification({text: '❌ 獲取下一頁超時...', timeout: 3000});
            };
            xhr.send();
        }
    }
```

- [ ] **Step 5: Add processElements() — the DOM insertion pipeline**

Port from original line 1926-2062. This is the central function: extract pageE from response, run bF hook, insert into DOM (6 position types), update history, replace elements, run script tags, run aF hook.

```javascript
    function processElements(response) {
        if (!curSite.pager.insertP) curSite.pager.insertP = [curSite.pager.pageE, 5];
        let pageE = getAll(curSite.pager.pageE, response, response), toE;

        if (curSite.pager.insertP[1] === 5) {
            toE = toE5pop(getAll(curSite.pager.insertP[0]));
        } else {
            toE = getOne(curSite.pager.insertP[0]);
        }

        if (pageE.length > 0 && toE) {
            // bF 鉤子
            if (curSite.function && curSite.function.bF) {
                if (curSite.function.bFp) {
                    pageE = (typeof curSite.function.bF === 'string')
                        ? new Function('pageE', 'bFp', 'fun', curSite.function.bF)(pageE, curSite.function.bFp, window.autoPage)
                        : curSite.function.bF(pageE, curSite.function.bFp);
                } else {
                    pageE = (typeof curSite.function.bF === 'string')
                        ? new Function('pageE', 'fun', curSite.function.bF)(pageE, window.autoPage)
                        : curSite.function.bF(pageE);
                }
            }

            // 強制新分頁
            if (curSite.blank === 4 || curSite.blank === 5 || curSite.blank === 6) pageE = forceTarget(pageE);

            // 插入
            let addTo = getAddTo(curSite.pager.insertP[1]);
            if (curSite.pager.insertP[1] === 6) {
                // 文字型插入 (innerHTML)
                let afterend = '';
                if (curSite.pager.insertP6Br === false) {
                    // 自動偵測是否需要 <br>
                    if (unsafeWindow.insertP6Br === true) {
                        afterend += '<br/><br/>';
                    } else if (unsafeWindow.insertP6Br === undefined) {
                        if (getAll('br', getOne(curSite.pager.pageE)).length > 10) {
                            // 檢查末尾是否有 <br>
                            let lastCheck = checkLastBr(getOne(curSite.pager.pageE));
                            if (!lastCheck) { unsafeWindow.insertP6Br = true; afterend += '<br/><br/>'; }
                            else { unsafeWindow.insertP6Br = false; }
                        }
                    }
                } else if (curSite.pager.insertP6Br) {
                    afterend += '<br/><br/>';
                }
                pageE.forEach(function(one) { afterend += one.innerHTML; });
                toE.insertAdjacentHTML(addTo, afterend);
            } else {
                if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse();
                pageE.forEach(function(one) { toE.insertAdjacentElement(addTo, one); });
            }

            pageNumIncrement();

            // 歷史記錄
            if (curSite.history === undefined) {
                if (GM_getValue('menu_history', true)) addHistory(response);
            } else {
                if (curSite.history) addHistory(response);
            }

            // 替換元素
            if (curSite.pager.replaceE !== '') replaceElems(response);

            // script 標籤
            if (curSite.pager.scriptT !== undefined) {
                switch (curSite.pager.scriptT) {
                    case 0: insScript('script', response); break;
                    case 1: insScript('script:not([src])', response); break;
                    case 2:
                        if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse();
                        insScript(null, pageE); break;
                    case 3:
                        if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse();
                        insScript('script:not([src])', pageE); break;
                }
            }

            // aF 鉤子
            if (curSite.function && curSite.function.aF) {
                if (curSite.function.aFp) {
                    (typeof curSite.function.aF === 'string')
                        ? new Function('aFp', 'fun', curSite.function.aF)(curSite.function.aFp, window.autoPage)
                        : curSite.function.aF(curSite.function.aFp);
                } else {
                    (typeof curSite.function.aF === 'string')
                        ? new Function('fun', curSite.function.aF)(window.autoPage)
                        : curSite.function.aF();
                }
            }
        } else {
            // pageE 提取失敗
            if (curSite.retry) {
                console.warn('[MyAutoPager] 獲取主體元素失敗，' + curSite.retry + 'ms 後可重試...');
                setTimeout(function() { curSite.pageUrl = ''; }, curSite.retry);
            } else {
                console.error('[MyAutoPager] 獲取主體元素失敗');
            }
        }
    }

    function checkLastBr(e) {
        const children = Array.from(e.childNodes).filter(node =>
            node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '')
        );
        const last = children[children.length - 1];
        if (last && last.tagName === 'BR') return true;
        if (last && last.tagName === 'P' && last.classList.contains('readinline')) {
            return children[children.length - 2] && children[children.length - 2].tagName === 'BR';
        }
        return false;
    }
```

- [ ] **Step 6: Add replaceElems() and addHistory()**

```javascript
    function replaceElems(response, o = curSite.pager.replaceE, r = curSite.pager.replaceE) {
        let oE, rE;

        // replaceE 未定義時自動推斷
        if (curSite.pager.replaceE === undefined && curSite.pager.nextL && typeof curSite.pager.nextL === 'string' && !curSite.pager.nextL.match(/^js;/i)) {
            let a = getOne(curSite.pager.nextL);
            if (a && ((a.nextElementSibling && a.nextElementSibling.tagName === a.tagName) || (a.previousElementSibling && a.previousElementSibling.tagName === a.tagName))) {
                // nextL 有同 tagName 相鄰兄弟 → 替換父元素
                if (curSite.pager.nextL.slice(0,1) === '/' || curSite.pager.nextL.slice(0,2) === './' || curSite.pager.nextL.slice(0,2) === '(/' || curSite.pager.nextL.slice(0,3) === 'id(') {
                    o = r = curSite.pager.nextL + '/..';
                } else {
                    oE = getAllParentElement(curSite.pager.nextL);
                    rE = getAllParentElement(curSite.pager.nextL, response, response);
                }
            } else {
                o = r = curSite.pager.nextL;
            }
        }

        if (!oE && !rE && o && r) {
            oE = getAll(o);
            rE = getAll(r, response, response);
        }

        if (oE && rE && oE.length !== 0 && rE.length !== 0 && oE.length === rE.length) {
            for (let i = 0; i < oE.length; i++) { oE[i].outerHTML = rE[i].outerHTML; }
            return true;
        }
        return false;
    }

    function addHistory(pageE, title, url) {
        if (!curSite.pageUrl) return;
        if (window.top.history.toString() !== '[object History]') return;
        title = title || (pageE.querySelector && pageE.querySelector('title') ? pageE.querySelector('title').textContent : window.top.document.title);
        url = url || curSite.pageUrl;
        window.top.document.Autopage_nowUrl = curSite.pageUrl;
        if (url.indexOf(window.top.location.protocol) === -1) url = url.replace(/^https?:/, window.top.location.protocol);
        window.top.history.pushState('Autopage_history', title, url);
        window.top.document.title = title;
    }

    function pageNumIncrement(num = 1) {
        pageNum.now = pageNum._now + num;
    }
```

Update `window.autoPage.pageNumIncrement` to point to real function.

- [ ] **Step 7: Add src_bF, xs_bF, cleanuEvent helper functions**

Port from original:
- `src_bF(pageE, css)` — line 2065 (fix lazy-loaded images)
- `xs_bF(pageE, reg)` — line 2085 (regex text filter)
- `cleanuEvent(css, delay, mode)` — line 2489 (clean DOM events)

Update `window.autoPage` references.

- [ ] **Step 8: Test Type 1 on GreasyFork**

Temporarily add a rule for GreasyFork scripts list:

```javascript
            greasyfork: {
                host: 'greasyfork.org',
                pager: {
                    nextL: '.pagination .next_page',
                    pageE: '#browse-script-list > li',
                    replaceE: '.pagination',
                    scrollD: 2000
                }
            },
```

Add `matchRule()` and `pageLoading()` calls at end of script. Navigate to `https://greasyfork.org/scripts`. Scroll down.

Expected: Next page content auto-loads. Console shows `[MyAutoPager] 匹配規則: greasyfork`.

- [ ] **Step 9: Commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: implement core paging engine with Type 1 XHR support"
```

---

### Task 5: Core Type 2 (Button Click) + Type 6 (iframe Extract)

**Files:**
- Modify: `MyAutoPager.user.js`

- [ ] **Step 1: Add clickNextButton() inside pageLoading()**

Add Type 2 logic in the `pageLoading` scroll handler (the `else if (curSite.pager.type === 2)` branch):

```javascript
    function clickNextButton() {
        let btn = getOne(curSite.pager.nextL);
        if (!btn) return;
        if (curSite.pager.isHidden && isHidden(btn)) return;
        if (curSite.pager.nextText) {
            if (btn.innerText === curSite.pager.nextText) { btn.click(); pageNumIncrement(); }
        } else if (curSite.pager.nextTextOf) {
            if (btn.innerText.indexOf(curSite.pager.nextTextOf) > -1) { btn.click(); pageNumIncrement(); }
        } else if (curSite.pager.nextHTML) { // 原版向後相容欄位，匹配按鈕 innerHTML
            if (btn.innerHTML === curSite.pager.nextHTML) { btn.click(); pageNumIncrement(); }
        } else {
            intervalPause();
            btn.click(); pageNumIncrement();
        }
    }
```

Note: `intervalPause` needs to be accessible — extract it from `pageLoading` to module scope or use a closure variable.

- [ ] **Step 2: Add iframeExtract() — Type 6**

Port from original `insIframe_()` at line 1884-1921. Hidden iframe with segmented scrolling simulation.

```javascript
    function iframeExtract(src) {
        if (!pausePage) return;
        pausePage = false;

        let iframe = document.getElementById('Autopage_iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'Autopage_iframe';
            iframe.src = src.replace(/#.+$/, '');
            insStyle('iframe#Autopage_iframe {position: absolute !important; top: -9999px !important; left: -9999px !important; width: 100% !important; height: 100% !important; border: none !important; z-index: -999 !important;}');
        }

        iframe.onload = function() {
            if (!curSite.pager.loadTime) curSite.pager.loadTime = 300;
            let step = 0, timer = setInterval(function() {
                let sh = (iframe.contentWindow.document.documentElement.scrollHeight || iframe.contentWindow.document.body.scrollHeight) / 10;
                iframe.contentWindow.scrollTo(0, 999999);
                iframe.contentWindow.scrollTo(0, sh * step);
                if (++step === 12) {
                    clearInterval(timer);
                    processElements(iframe.contentWindow.document);
                    pausePage = true;
                }
            }, curSite.pager.loadTime / 10);
        };

        if (document.getElementById('Autopage_iframe')) {
            iframe.src = src.replace(/#.+$/, '');
        } else {
            document.documentElement.appendChild(iframe);
        }
    }
```

- [ ] **Step 3: Verify Type 2 works**

Add a test rule with `type: 2` for a site with a "load more" button. Verify auto-clicking works.

- [ ] **Step 4: Commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: add Type 2 (click button) and Type 6 (iframe extract) paging modes"
```

---

### Task 6: UI — Page Number Button + Menu System

**Files:**
- Modify: `MyAutoPager.user.js`

- [ ] **Step 1: Add pageNumber() with Shadow DOM**

Port from original line 2801-2860. Shadow DOM isolation, floating button, click-to-pause, right-click-to-top, Object.defineProperty for auto-update.

```javascript
    // ========== UI：頁碼按鈕 ==========

    function pageNumber(type) {
        if (curSite.SiteTypeID === 0) {
            // 隱藏按鈕
            let existing = getCSS('#Autopage_number');
            if (existing && existing.shadowRoot) {
                getCSS('#Autopage_number_button', existing.shadowRoot).style.display = 'none';
            }
            return;
        }
        let status;
        let existing = getCSS('#Autopage_number');
        if (existing && existing.shadowRoot) status = getCSS('#Autopage_number_button', existing.shadowRoot);

        switch (type) {
            case 'add': add(); break;
            case 'del': del(); break;
            case 'set': set(); break;
        }

        function add() {
            if (status) {
                if (status.style.display === 'none') status.style.display = 'flex';
                return;
            }
            // Port the Shadow DOM creation from original line 2819-2845
            // Style: fixed left bottom, round button, opacity 0.3, hover 0.8
            // Events: left click toggle pause, right click scroll to top
            let _style = `<style>/* port from original line 2820 */</style>`;
            let _html = `<div id="Autopage_number_button" title="...">${pageNum._now}</div>`;

            document.documentElement.insertAdjacentHTML('beforeend',
                '<div id="Autopage_number" style="display:flex!important;position:fixed!important;z-index:9999998!important;"></div>');
            let container = getCSS('#Autopage_number');
            let shadowRoot = container.attachShadow({ mode: 'open' });
            shadowRoot.innerHTML = _style + _html;

            status = getCSS('#Autopage_number_button', shadowRoot);
            status.onclick = function(e) {
                if (pausePage) { this.style.color = '#FF5722'; this.style.fontStyle = 'italic'; }
                else { this.style = ''; }
                pausePage = !pausePage;
                e.preventDefault(); e.stopPropagation(); return false;
            };
            status.oncontextmenu = function(e) {
                window.scrollTo(0, 0);
                e.preventDefault(); e.stopPropagation(); return false;
            };
            set();
        }

        function set() {
            Object.defineProperty(pageNum, 'now', {
                set: function(value) { this._now = value; if (status) status.textContent = value; },
                configurable: true
            });
        }

        function del() { if (status) status.style.display = 'none'; }
    }
```

- [ ] **Step 2: Add registerMenuCommand() and menu functions**

```javascript
    // ========== UI：菜單 ==========

    function registerMenuCommand() {
        // 先清除舊的
        menuId.forEach(id => { try { GM_unregisterMenuCommand(id); } catch(e){} });
        menuId = [];

        // 1. 啟用/禁用
        let isDisabled = GM_getValue('menu_disable', []).indexOf(location.hostname) !== -1;
        menuId.push(GM_registerMenuCommand(isDisabled ? menuAll[0][2] : menuAll[0][1], function() {
            isDisabled ? menu_disable('del') : menu_disable('add');
            location.reload();
        }));

        // 2. 顯示頁碼
        let showPageNum = GM_getValue('menu_page_number', true);
        menuId.push(GM_registerMenuCommand((showPageNum ? '✅ ' : '❌ ') + menuAll[1][1], function() {
            menu_switch(showPageNum, 'menu_page_number');
        }));

        // 3. 歷史記錄
        let showHistory = GM_getValue('menu_history', true);
        menuId.push(GM_registerMenuCommand((showHistory ? '✅ ' : '❌ ') + menuAll[2][1], function() {
            menu_switch(showHistory, 'menu_history');
        }));

        // 4. 自定義規則
        menuId.push(GM_registerMenuCommand('#️⃣ ' + menuAll[3][1], function() {
            customRules();
        }));
    }

    function menu_switch(status, name) {
        GM_setValue(name, !status);
        if (name === 'menu_page_number') {
            status ? pageNumber('del') : pageNumber('add');
            registerMenuCommand();
        } else {
            location.reload();
        }
    }

    function menu_disable(type) {
        let list = GM_getValue('menu_disable', []);
        if (type === 'add') {
            if (list.indexOf(location.hostname) === -1) list.push(location.hostname);
        } else if (type === 'del') {
            list = list.filter(h => h !== location.hostname);
        }
        GM_setValue('menu_disable', list);
    }
```

- [ ] **Step 3: Verify UI**

Install updated script. Navigate to any supported page (or with a test rule).

Expected:
- Page number button appears bottom-left (if rule matches)
- Tampermonkey menu shows 4 items
- Click page number → turns red italic, paging stops
- Right-click page number → scrolls to top

- [ ] **Step 4: Commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: add page number button and menu system"
```

---

### Task 7: UI — Rule Editor

**Files:**
- Modify: `MyAutoPager.user.js`

- [ ] **Step 1: Add customRules() function**

Port from original line 2600-2756. Shadow DOM popup with textarea, JSON validation, error positioning.

Key components:
- HTML template with examples panel, all-rules panel, textarea, save/cancel buttons
- `customStringify()` for readable JSON display (original line 2793)
- `calculatePositionFromLineColumn()` for error positioning (original line 2765)
- Save handler: JSON.parse validation → GM_setValue → reload
- Error handler: highlight error position in textarea

```javascript
    // ========== UI：規則編輯器 ==========

    function customRules() {
        let customRulesStr = JSON.stringify(GM_getValue('menu_customRules', {}), null, 4);
        if (customRulesStr === '{}') customRulesStr = '';

        // Port the full HTML template from original line 2600-2722
        // Adapt the example rules to match our simplified format
        let _html = `<div style="...">
            <h3>自定義翻頁規則</h3>
            <details><summary>規則格式範例</summary><pre>...</pre></details>
            <details><summary>所有規則</summary><pre id="Autopage_customRules_all">...</pre></details>
            <textarea id="Autopage_customRules_textarea" ...></textarea>
            <button id="Autopage_customRules_save">保存並刷新</button>
            <button id="Autopage_customRules_cancel">取消修改</button>
        </div>`;

        // Create Shadow DOM container
        document.documentElement.insertAdjacentHTML('beforeend',
            '<div id="Autopage_customRules" style="display:initial!important;position:fixed!important;z-index:9999999!important;"></div>');
        let container = getCSS('#Autopage_customRules');
        let shadowRoot = container.attachShadow({ mode: 'open' });
        shadowRoot.innerHTML = _html;
        document.documentElement.style.overflow = document.body.style.overflow = 'hidden';

        // 填入內容
        getCSS('#Autopage_customRules_textarea', shadowRoot).textContent = customRulesStr;
        getCSS('#Autopage_customRules_all', shadowRoot).textContent = customStringify(DBSite2);

        // 保存
        getCSS('#Autopage_customRules_save', shadowRoot).onclick = function() {
            let val = getCSS('#Autopage_customRules_textarea', shadowRoot).value;
            if (!val) val = '{}';
            try {
                let parsed = JSON.parse(val);
                GM_setValue('menu_customRules', parsed);
                location.reload();
            } catch (e) {
                // Port error positioning from original line 2741-2752
                let match = e.message.match(/at position (\d+)/), position;
                if (match) { position = parseInt(match[1]); }
                else {
                    match = e.message.match(/line (\d+) column (\d+)/i);
                    if (match) position = calculatePositionFromLineColumn(val, match[1], match[2]);
                }
                console.error('自定義規則格式錯誤:', e.message);
                window.alert('自定義規則格式錯誤:\n' + e.message);
                if (position !== undefined) {
                    let ta = getCSS('#Autopage_customRules_textarea', shadowRoot);
                    ta.selectionStart = position - 1;
                    ta.selectionEnd = position;
                    ta.focus();
                }
            }
        };

        // 取消
        getCSS('#Autopage_customRules_cancel', shadowRoot).onclick = function() {
            document.documentElement.style.overflow = document.body.style.overflow = '';
            getCSS('#Autopage_customRules').remove();
        };
    }

    function customStringify(obj) {
        return JSON.stringify(obj, null, 4).replace(/(: \[)([\s\S]*?)(\],?\n)/g, (match, p1, p2, p3) => {
            return p1 + p2.replace(/\n/g, '').replace(/\s{4}/g, '') + p3;
        });
    }

    function calculatePositionFromLineColumn(text, line, column) {
        if (!text || line < 1 || column < 1) return -1;
        const lines = text.split('\n');
        if (line > lines.length) return -1;
        let position = 0;
        for (let i = 0; i < line - 1; i++) position += lines[i].length + 1;
        return position + Math.min(column - 1, lines[line - 1].length);
    }
```

- [ ] **Step 2: Test the editor**

Click Tampermonkey menu → "自定義翻頁規則". Editor popup should appear. Add a test rule, save, page reloads. Open again — rule should persist.

Test error handling: save malformed JSON → should show error and highlight position.

- [ ] **Step 3: Commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: add custom rules JSON editor with error positioning"
```

---

### Task 8: Built-in Rules + forceTarget + SPA + Init

**Files:**
- Modify: `MyAutoPager.user.js`

This final task fills in the built-in rules, adds forceTarget, SPA support, and wires up the init sequence.

- [ ] **Step 1: Add forceTarget() function**

Port from original line 2432-2482. All 6 blank modes.

```javascript
    function forceTarget(pageE) {
        // Port all 6 blank modes from original
        // blank 1: <base target="_blank">
        // blank 2: body event delegation
        // blank 3: pageE parent event delegation
        // blank 4: direct target="_blank" on <a>
        // blank 5: clone <a> with target="_blank"
        // blank 6: clone + stopPropagation
    }
```

- [ ] **Step 2: Add SPA/PJAX URL change detection**

```javascript
    // ========== SPA 支援 ==========

    function addUrlChangeEvent() {
        history.pushState = (f => function pushState() {
            var ret = f.apply(this, arguments);
            window.dispatchEvent(new Event('pushstate'));
            window.dispatchEvent(new Event('urlchange'));
            return ret;
        })(history.pushState);

        history.replaceState = (f => function replaceState() {
            var ret = f.apply(this, arguments);
            window.dispatchEvent(new Event('replacestate'));
            window.dispatchEvent(new Event('urlchange'));
            return ret;
        })(history.replaceState);

        window.addEventListener('popstate', () => {
            window.dispatchEvent(new Event('urlchange'));
        });
    }
```

- [ ] **Step 3: Fill in all ~15 built-in rules in setDBSite()**

Add rules to the `DBSite` object inside `setDBSite()`. For each rule, port the selectors from the original script (look up each site's rule in the original `setDBSite()` function at lines 555-1105).

**Personal rules** — port from `autoPager-custom.js` (the optimized version):

```javascript
        uukanshu: {
            host: 'uukanshu.cc',
            style: '.▶, iframe[src*="political-effort"], script[src*="political-effort"], script[src*="grown-mouth"]',
            history: true, retry: 3000,
            pager: { nextL: '#linkNext', pageE: '.readcotent', replaceE: '.mulu-box', scrollD: 3000 },
            function: {
                aF: "const els = document.querySelectorAll('.readcotent'); if (els.length > 1) els[els.length - 1].className = els[0].className;"
            }
        },
        '69shuba': {
            host: '69shuba.tw',
            style: 'div[id*="pf-"], script[src*="novelapis"], script[src*="pubfuture"], .ad, iframe {display: none !important;} #nr1, #nr1 * {text-align: center !important; font-size: 36px !important; line-height: 1.8 !important; color: #999 !important;} .nr_title {text-align: center !important; font-size: 24px !important; color: #ddd !important; display: block !important; margin: 20px 0 !important;}',
            history: true, retry: 3000,
            pager: { nextL: '#pb_next', pageE: '.nr_title, .nr_nr', replaceE: '.nr_page', scrollD: 3000 }
        },
```

**Search engines** — look up Google, Bing, Baidu, Sogou, DuckDuckGo rules in original script's `setDBSite()`. Port each rule's host, url, pager config.

**CMS templates** — port WordPress and Discuz rules. For WordPress, the original uses url functions to detect `<meta name="generator" content="WordPress">` or `wp-content` in page resources. Port this detection logic into the rule's `url` field as a function string.

**Common sites** — port zhihu, github, greasyfork, stackoverflow, v2ex rules from original. Each needs its specific selectors.

Reference: search the original file for each site name to find its rule definition.

- [ ] **Step 4: Wire up the init sequence**

At the bottom of the IIFE (before closing `})()`):

```javascript
    // ========== 初始化 ==========

    // 匹配規則
    matchRule();

    // 註冊菜單
    registerMenuCommand();

    // 顯示頁碼
    if (GM_getValue('menu_page_number')) { pageNumber('add'); } else { pageNumber('set'); }

    // 強制新分頁
    if (curSite.blank !== undefined) setTimeout(forceTarget, 1000);

    // 注入 CSS
    if (curSite.style) insStyle(curSite.style);

    // 啟動翻頁
    pageLoading();

    // SPA/PJAX 支援
    if (urlC) {
        nowLocation = location.href;
        if (window.onurlchange === undefined) addUrlChangeEvent();

        window.addEventListener('urlchange', function() {
            lp = location.pathname;
            if (curSite.history !== false && window.top.document.Autopage_nowUrl === location.href) {
                nowLocation = location.href; return;
            }
            if (nowLocation === location.href) return;

            nowLocation = location.href;
            curSite = {SiteTypeID: 0};
            pageNum.now = 1;

            // 重新匹配
            setDBSite();
            mergeRules();
            matchRule();
            registerMenuCommand();

            if (curSite.blank !== undefined) setTimeout(forceTarget, 1000);
            if (curSite.style) insStyle(curSite.style);
            if (GM_getValue('menu_page_number')) { pageNumber('add'); } else { pageNumber('set'); }

            pageLoading();
        });
    }
```

- [ ] **Step 5: Full integration test**

Test on multiple sites:

1. **uukanshu.cc** — 小說閱讀，Type 1 XHR，確認翻頁 + className 歸一化
2. **69shuba.tw** — 小說閱讀，Type 1 XHR，確認翻頁 + CSS 樣式生效
3. **google.com** — 搜尋結果翻頁
4. **greasyfork.org** — 腳本列表翻頁
5. **菜單功能** — 啟用/禁用、頁碼開關、歷史記錄開關
6. **規則編輯器** — 新增/修改/刪除自定義規則
7. **頁碼按鈕** — 暫停/恢復、右鍵回頂

Fix any issues found during testing.

- [ ] **Step 6: Final commit**

```bash
git add MyAutoPager.user.js
git commit -m "feat: add built-in rules, forceTarget, SPA support, and init sequence"
```

---

## Post-Implementation

After all 8 tasks complete:

1. Remove the old `autoPager-custom.js` (rules are now built into the script)
2. Update `CLAUDE.md` to document the new `MyAutoPager.user.js`
3. Clean up any test/debug `console.log` statements
