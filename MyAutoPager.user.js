// ==UserScript==
// @name         MyAutoPager
// @version      1.0.0
// @author       clh
// @description  自動無縫翻頁 — 將下一頁內容無縫載入至網頁底部
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
// @exclude      https://*.1688.com/*
// @exclude      https://*.jd.com/*
// @exclude      https://*.vip.com/*
// @exclude      https://*.suning.com/*
// @exclude      https://*.aliexpress.com/*
// @exclude      https://*.paypal.com/*
// @exclude      https://*.iqiyi.com/*
// @exclude      https://*.youku.com/*
// @exclude      https://m.v.qq.com/*
// @exclude      https://v.qq.com/*
// @exclude      https://*.acfun.cn/*
// @exclude      https://t.bilibili.com/*
// @exclude      https://www.bilibili.com/*
// @exclude      https://live.bilibili.com/*
// @exclude      https://space.bilibili.com/*
// @exclude      https://manga.bilibili.com/*
// @exclude      https://member.bilibili.com/*
// @exclude      https://message.bilibili.com/*
// @exclude      https://*.youtube.com/*
// @exclude      https://*.youtube-nocookie.com/*
// @exclude      https://*.cnki.net/*
// @exclude      https://mail.qq.com/*
// @exclude      https://weread.qq.com/*
// @exclude      https://*.weread.qq.com/*
// @exclude      https://www.qidian.com/chapter/*
// @exclude      https://bz.zzzmh.cn/*
// @exclude      https://wallhaven.cc/*
// @exclude      https://chrome.zzzmh.cn/*
// @exclude      https://*.guazi.com/*
// @exclude      https://*.liepin.com/*
// @exclude      https://*.58.com/*
// ==/UserScript==

(function() {
    'use strict';

    // ========== 相容性 polyfill ==========

    // 相容不支援 GM_openInTab 的使用者腳本管理器
    if (typeof GM_openInTab !== 'function') {
        GM_openInTab = function(url) {
            window.open(url);
        };
    }

    // 相容不支援 structuredClone 的瀏覽器（Chromium 98 以下）
    if (typeof structuredClone !== 'function') {
        structuredClone = function(obj) {
            return JSON.parse(JSON.stringify(obj));
        };
    }

    // ========== DOM 選擇器 ==========

    // 取得元素（CSS/Xpath），來源：https://github.com/machsix/Super-preloader

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
            // 應該總是回傳一個元素節點
            return result.singleNodeValue && result.singleNodeValue.nodeType === 1 && result.singleNodeValue;
        } catch (err) {
            throw new Error(`無效 Xpath: ${xpath}`);
        }
    }

    function getAllXpath(xpath, contextNode, doc = document) {
        contextNode = contextNode || doc;
        const result = [];
        try {
            const query = doc.evaluate(xpath, contextNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < query.snapshotLength; i++) {
                const node = query.snapshotItem(i);
                // 如果是 Element 節點
                if (node.nodeType === 1) result.push(node);
            }
        } catch (err) {
            throw new Error(`無效 Xpath: ${xpath}`);
        }
        return result;
    }

    function getOne(selector, contextNode = undefined, doc = document) {
        if (!selector) return;
        contextNode = contextNode || doc;
        if (selector.slice(0,1) === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getXpath(selector, contextNode, doc);
        } else {
            return getCSS(selector, contextNode);
        }
    }

    function getAll(selector, contextNode = undefined, doc = document) {
        if (!selector) return [];
        contextNode = contextNode || doc;
        if (selector.slice(0,1) === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getAllXpath(selector, contextNode, doc);
        } else {
            return getAllCSS(selector, contextNode);
        }
    }

    // 取得所有父元素
    function getAllParentElement(selector, contextNode = undefined, doc = document) {
        contextNode = contextNode || doc;
        const parents = [];
        getAll(selector, contextNode, doc).forEach((next) => {
            const parent = next.parentElement;
            if (!parents.includes(parent)) {
                parents.push(parent);
            }
        });
        return parents;
    }

    // ========== DOM 解析 ==========

    function createDocumentByString(e) {
        if (e) {
            if ('HTML' !== document.documentElement.nodeName) return (new DOMParser).parseFromString(e, 'application/xhtml+xml');
            var t;
            try { t = (new DOMParser).parseFromString(e, 'text/html'); } catch (e) {}
            if (t) return t;
            if (document.implementation.createHTMLDocument) {
                t = document.implementation.createHTMLDocument('ADocument');
            } else {
                try {
                    t = document.cloneNode(!1);
                    t.appendChild(t.importNode(document.documentElement, !1));
                    t.documentElement.appendChild(t.createElement('head'));
                    t.documentElement.appendChild(t.createElement('body'));
                } catch (e) {}
            }
            if (t) {
                var r = document.createRange(),
                    n = r.createContextualFragment(e);
                r.selectNodeContents(document.body);
                t.body.appendChild(n);
                for (var a, o = { TITLE: !0, META: !0, LINK: !0, STYLE: !0, BASE: !0 }, i = t.body, s = i.childNodes, c = s.length - 1; c >= 0; c--) o[(a = s[c]).nodeName] && i.removeChild(a);
                return t;
            }
        } else console.error('[MyAutoPager] createDocumentByString: empty input');
    }

    // ========== DOM 操作工具 ==========

    // 插入 <script>
    function insScript(selector, contextNode = document, toE = document.body) {
        let scriptElems = contextNode;
        if (selector) {
            if (contextNode instanceof Array) {
                scriptElems = [];
                contextNode.forEach(function(one) {
                    scriptElems = scriptElems.concat(getAll(selector, one, one));
                });
            } else {
                scriptElems = getAll(selector, contextNode, contextNode);
            }
        }
        scriptElems.forEach(function(one) {
            if (one.tagName === 'SCRIPT') {
                if (one.src) {
                    toE.appendChild(document.createElement('script')).src = one.src;
                } else {
                    toE.appendChild(document.createElement('script')).textContent = one.textContent;
                }
            }
        });
    }

    // 插入 <style>
    function insStyle(style) {
        if (style.indexOf('{') === -1) { style += '{display: none !important;}'; }
        document.documentElement.appendChild(document.createElement('style')).textContent = style;
    }

    // ========== URL / 環境判斷工具 ==========

    // 判斷 URL 是否存在指定文字
    function indexOF(e, l = 'p', low = true) {
        switch (l) {
            case 'h':
                l = location.href; break;
            case 'p':
                l = location.pathname; break;
            case 's':
                l = location.search; break;
        }
        if (e instanceof RegExp) {
            if (e.test(l)) return true;
        } else {
            if (low) { e = e.toLowerCase(); l = l.toLowerCase(); }
            if (l.indexOf(e) !== -1) return true;
        }
        return false;
    }

    // 判斷是否為手機版（是則回傳 true）
    function isMobile() {
        return (/(phone|pad|pod|iPhone|iPod|ios|iPad|Android|Mobile|BlackBerry|MicroMessenger|IEMobile|MQQBrowser|JUC|Fennec|wOSBrowser|BrowserNG|WebOS|Symbian|Windows Phone)/i.test(navigator.userAgent) || (window.screen.width < 500 && window.screen.height < 800));
    }

    // 判斷元素是否隱藏（隱藏回傳 true）
    function isHidden(el) {
        return el.offsetParent === null;
    }

    // 判斷網站標題是否包含指定文字
    function isTitle(title) {
        return document.title.indexOf(title) > -1;
    }

    // 取得 URL 查詢參數的值
    function getSearch(variable) {
        let query = window.location.search.substring(1),
            vars = query.split('&');
        for (let i = 0; i < vars.length; i++) {
            let pair = vars[i].split('=');
            if (pair[0] === variable) return pair[1];
        }
        return '';
    }

    // 取得 Cookie 值
    function getCookie(name) {
        if (!name) return '';
        let arr = document.cookie.split(';');
        name += '=';
        for (let i = 0; i < arr.length; i++) {
            let now = arr[i].trim();
            if (now.indexOf(name) === 0) return now.substring(name.length, now.length);
        }
        return '';
    }

    // 取得 insertAdjacentElement 插入位置字串
    function getAddTo(num) {
        switch (num) {
            case 1:
                return 'beforebegin'; break;
            case 2:
                return 'afterbegin'; break;
            case 3:
            case 6:
                return 'beforeend'; break;
            case 4:
            case 5:
                return 'afterend'; break;
        }
    }

    // 插入位置 5 時，排除 <script> <style> <link> 標籤（從陣列尾部取出）
    function toE5pop(a) {
        if (a.length === 0) return;
        let b = a.pop();
        if (b.tagName === 'SCRIPT' || b.tagName === 'STYLE' || b.tagName === 'LINK') {
            return toE5pop(a);
        }
        return b;
    }

    // ========== 全域狀態 ==========

    var menuAll = [
        ['menu_disable', '✅ 已啟用 (點擊對當前網站禁用)', '❌ 已禁用 (點擊對當前網站啟用)', []],
        ['menu_page_number', '顯示當前頁碼及點擊暫停翻頁', '顯示當前頁碼及點擊暫停翻頁', true],
        ['menu_history', '添加歷史記錄+修改地址/標題', '添加歷史記錄+修改地址/標題', true],
        ['menu_customRules', '自定義翻頁規則', '自定義翻頁規則', {}]
    ];
    var menuId = [], curSite = {SiteTypeID: 0}, DBSite, DBSite2, DBSiteNow,
        pausePage = true, pageNum = {now: 1, _now: 1},
        urlC = false, nowLocation = '', lp = location.pathname;

    // 初始化 GM 存儲
    for (let i = 0; i < menuAll.length; i++) {
        if (GM_getValue(menuAll[i][0]) == null) GM_setValue(menuAll[i][0], menuAll[i][3]);
    }

    function isUrlC() { urlC = true; }

    // ========== 內建規則 ==========

    function setDBSite() {
        DBSite = {
            // 規則將在 Task 8 填入
        };
    }
    setDBSite();

    // ========== 規則合併 ==========

    function mergeRules() {
        let _customRules = GM_getValue('menu_customRules', {});
        if (Object.prototype.toString.call(_customRules) !== '[object Object]') _customRules = {};
        let _customKeys = Object.keys(_customRules);

        if (_customKeys.length === 0) {
            DBSite2 = structuredClone(DBSite);
        } else {
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

    // ========== 暴露 API ==========

    window.autoPage = {
        lp: () => location.pathname, indexOF, isMobile, isUrlC,
        isPager: function() { return false; },
        isTitle, getAll, getOne, getAllXpath, getXpath, getAllCSS, getCSS,
        getNextE: function() { return ''; }, getNextEP: function() { return ''; },
        getNextSP: function() { return ''; }, getNextEPN: function() { return ''; },
        getNextUPN: function() { return ''; }, getNextUP: function() { return ''; },
        getNextF: function() { return ''; }, getSearch, getCookie,
        insStyle, insScript, cleanuEvent: function() {},
        src_bF: function(p) { return p; }, xs_bF: function(p) { return p; },
        pageNumIncrement: function() {}
    };

    // ========== 規則匹配 ==========

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
            return host.some(h => {
                if (typeof h === 'string' && h.charAt(0) === '/' && h.charAt(h.length - 1) === '/') {
                    return new RegExp(h.slice(1, -1)).test(location.hostname);
                }
                return location.hostname === h;
            });
        }
        return false;
    }

    function matchUrl(url, rule) {
        if (typeof url === 'string') {
            if (url.charAt(0) === '/' && url.charAt(url.length - 1) === '/') {
                return new RegExp(url.slice(1, -1)).test(location.pathname + location.search);
            }
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

    function isPager(type) {
        if (!type) {
            if (!DBSiteNow || !DBSiteNow.pager) return false;
            let pType = DBSiteNow.pager.type;
            if (pType === undefined || pType === 1 || pType === 6) {
                if (typeof DBSiteNow.pager.nextL === 'string' && !DBSiteNow.pager.nextL.match(/^js;/i)) {
                    type = DBSiteNow.pager.pageE ? 'n,p' : 'n';
                } else if (DBSiteNow.pager.pageE) {
                    type = 'p';
                }
            } else if (pType === 2) {
                if (typeof DBSiteNow.pager.nextL === 'string' && !DBSiteNow.pager.nextL.match(/^js;/i)) type = 'n';
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

    window.autoPage.isPager = isPager;

    // ========== 核心翻頁引擎 ==========

    // 滾動事件監聽（延遲 1 秒啟動，避免頁面載入時立即觸發）
    function windowScroll(fn1) {
        var beforeScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
            fn = fn1 || function () {};
        setTimeout(function () {
            // 避免網頁內容太少，高度撐不起滾動條而無法觸發翻頁
            let scrollTop = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                scrollHeight = window.innerHeight || document.documentElement.clientHeight;
            if (scrollTop === 0 && document.documentElement.scrollHeight === scrollHeight) {
                insStyle(`html, body {min-height: ${document.documentElement.scrollHeight + 10}px;}`);
            }

            window.addEventListener('scroll', function (e) {
                var afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
                    delta = afterScrollTop - beforeScrollTop;
                if (delta == 0) return false;
                fn(delta > 0 ? 'down' : 'up', e);
                beforeScrollTop = afterScrollTop;
            }, false);
        }, 1000);
    }

    // 主入口：設定預設值並綁定滾動處理器
    function pageLoading() {
        if (curSite.SiteTypeID === 0 || !curSite.pager) return;
        if (curSite.pager.type === undefined) curSite.pager.type = 1;
        if (curSite.pager.scrollD === undefined) curSite.pager.scrollD = 2000;
        if (curSite.pager.interval === undefined) curSite.pager.interval = 500;
        curSite.pageUrl = '';

        windowScroll(function (direction, e) {
            // 僅在向下滾動、未暫停、且 SiteTypeID > 0 時觸發
            if (direction != 'down' || !pausePage || curSite.SiteTypeID == 0) return;

            let scrollTop = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                scrollHeight = window.innerHeight || document.documentElement.clientHeight,
                scrollD = curSite.pager.scrollD,
                triggered = false;

            // 如果指定了 scrollE 基準元素，根據元素位置判斷觸發
            if (curSite.pager.scrollE) {
                let scrollE = getOne(curSite.pager.scrollE);
                if (scrollE && scrollE.offsetTop - (scrollTop + scrollHeight) <= scrollD) {
                    triggered = true;
                }
            } else if (document.documentElement.scrollHeight <= scrollHeight + scrollTop + scrollD) {
                // 否則根據頁面底部距離判斷觸發
                triggered = true;
            }

            if (!triggered) return;

            // 依類型分派
            if (curSite.pager.type === 1) {
                intervalPause(); checkURL(fetchNextPage);
            } else if (curSite.pager.type === 2) {
                clickNextButton();
            } else if (curSite.pager.type === 6) {
                checkURL(iframeExtract);
            }
        });

        function intervalPause() {
            if (curSite.pager.interval) {
                pausePage = false;
                setTimeout(function(){ pausePage = true; }, curSite.pager.interval);
            }
        }
    }

    // Type 2 按鈕點擊（Task 5 實作）
    function clickNextButton() {
        let btn = getOne(curSite.pager.nextL);
        if (!btn) return;
        if (curSite.pager.isHidden && isHidden(btn)) return;
        if (curSite.pager.nextText) {
            if (btn.innerText === curSite.pager.nextText) { btn.click(); pageNumIncrement(); }
        } else if (curSite.pager.nextTextOf) {
            if (btn.innerText.indexOf(curSite.pager.nextTextOf) > -1) { btn.click(); pageNumIncrement(); }
        } else if (curSite.pager.nextHTML) {
            if (btn.innerHTML === curSite.pager.nextHTML) { btn.click(); pageNumIncrement(); }
        } else {
            // 沒指定文字條件，直接點擊
            pausePage = false;
            if (curSite.pager.interval) setTimeout(function() { pausePage = true; }, curSite.pager.interval);
            btn.click(); pageNumIncrement();
        }
    }
    // Type 6 iframe 擷取（Task 5 實作）
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

        // 插入或更新 iframe
        if (document.getElementById('Autopage_iframe')) {
            iframe.src = src.replace(/#.+$/, '');
        } else {
            document.documentElement.appendChild(iframe);
        }
    }
    // 強制新分頁開啟連結（Task 8 實作）
    function forceTarget(pageE) { return pageE; }

    // 檢查下一頁 URL 並呼叫回呼函數
    function checkURL(func) {
        if (!curSite.pager.nextL) return;
        if (typeof curSite.pager.nextL == 'function') {
            let tempUrl = curSite.pager.nextL();
            if (!tempUrl || tempUrl === curSite.pageUrl || tempUrl.slice(0, 4) !== 'http') return;
            curSite.pageUrl = tempUrl;
            func(curSite.pageUrl);
        } else if (curSite.pager.nextL.search(/^js;/i) === 0) {
            // 自訂規則中執行 JavaScript 代碼
            try {
                let tempUrl = new Function('fun', curSite.pager.nextL.slice(3))(window.autoPage);
                if (!tempUrl || tempUrl === curSite.pageUrl || tempUrl.slice(0, 4) !== 'http') return;
                curSite.pageUrl = tempUrl;
                func(curSite.pageUrl);
            } catch (e) {
                console.error('[MyAutoPager] nextL JS 代碼有誤：\n', curSite.pager.nextL + '\n\n', e);
            }
        } else if (getNextE_()) {
            func(curSite.pageUrl);
        }
    }

    // ---- getNext* URL 輔助函數 ----

    // 內部用：從元素取得下一頁 URL，設定 curSite.pageUrl，回傳 boolean
    function getNextE_(css) {
        if (!css) css = curSite.pager.nextL;
        let next = getOne(css);
        if (next && next.nodeType === 1 && next.href && next.href.slice(0, 4) === 'http' && next.getAttribute('href').slice(0, 1) !== '#') {
            if (next.href != curSite.pageUrl) {
                if (curSite.pager.forceHTTPS && location.protocol === 'https:') {
                    if (next.href.replace(/^http:/, 'https:') === curSite.pageUrl) { return false; }
                    curSite.pageUrl = next.href.replace(/^http:/, 'https:');
                } else {
                    curSite.pageUrl = next.href;
                }
            } else {
                return false;
            }
            return true;
        }
        return false;
    }

    // 外部 API：從元素取得下一頁 URL，回傳 URL 字串
    function getNextE(css) {
        if (!css) {
            if (typeof curSite.pager.nextL == 'string' && curSite.pager.nextL.match(/^js;/i) === null) {
                css = curSite.pager.nextL;
            } else { return ''; }
        }
        let next = getOne(css);
        if (next && next.nodeType === 1 && next.href && next.href.slice(0, 4) === 'http' && next.getAttribute('href').slice(0, 1) !== '#') {
            if (next.href != curSite.pageUrl) {
                if (curSite.pager.forceHTTPS && location.protocol === 'https:') {
                    if (next.href.replace(/^http:/, 'https:') === curSite.pageUrl) { return ''; }
                    return next.href.replace(/^http:/, 'https:');
                } else {
                    return next.href;
                }
            } else {
                return '';
            }
        }
        return '';
    }

    // 從元素文字取得頁碼，替換 URL search 參數
    function getNextEP(css, pf, reg) {
        let nextNum = getOne(css), url = '';
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ', '');
            if (location.search) {
                if (indexOF(pf, 's')) {
                    url = location.search.replace(reg, pf + nextNum);
                } else {
                    url = location.search + '&' + pf + nextNum;
                }
            } else {
                url = '?' + pf + nextNum;
            }
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
            if (indexOF(pf, 's')) {
                url = location.search.replace(reg, pf + page);
            } else {
                url = location.search + '&' + pf + page;
            }
        } else {
            url = '?' + pf + page;
        }
        return (location.origin + location.pathname + url);
    }

    // 從元素文字取得頁碼，替換 URL pathname 路徑
    function getNextEPN(css, reg, a, b = '') {
        let nextNum = getOne(css), url = '';
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ', '');
            if (location.pathname) {
                if (indexOF(reg)) {
                    url = location.pathname.replace(reg, a + nextNum + b);
                } else {
                    url = location.pathname + a + nextNum + b;
                }
            } else {
                url = location.pathname + a + nextNum + b;
            }
            url = location.origin + url + location.search;
        }
        return url;
    }

    // 從 URL pathname 取得頁碼並 +1，替換 pathname 路徑
    function getNextUPN(urlReg, reg, a, b = '', initP = '2', endP) {
        let nextNum = urlReg.exec(location.pathname);
        if (nextNum) {
            if (nextNum.length > 1) {
                nextNum = String(parseInt(nextNum[1]) + 1);
            } else {
                nextNum = String(parseInt(nextNum[0]) + 1);
            }
            if (endP && (parseInt(nextNum) > parseInt(endP))) return '';
        } else {
            nextNum = initP;
            if (endP && (parseInt(nextNum) > parseInt(endP))) return '';
        }
        let url = '';
        if (location.pathname) {
            if (indexOF(reg)) {
                url = location.pathname.replace(reg, a + nextNum + b);
            } else {
                url = location.pathname + a + nextNum + b;
            }
        } else {
            url = location.pathname + a + nextNum + b;
        }
        url = location.origin + url + location.search;
        return url;
    }

    // 從 URL search 取得頁碼並 +1，替換 search 參數
    function getNextUP(pf, reg, lp_ = location.pathname, initP = '2', endP) {
        let nextNum = getSearch(pf.replace('=', ''));
        if (nextNum) {
            nextNum = String(parseInt(nextNum) + 1);
            if (endP && (parseInt(nextNum) > parseInt(endP))) return '';
        } else {
            nextNum = initP;
            if (endP && (parseInt(nextNum) > parseInt(endP))) return '';
        }
        let url = '';
        if (location.search) {
            if (indexOF(pf, 's')) {
                url = location.search.replace(reg, pf + nextNum);
            } else {
                url = location.search + '&' + pf + nextNum;
            }
        } else {
            url = '?' + pf + nextNum;
        }
        url = location.origin + lp_ + url;
        return url;
    }

    // 從 form input 取得參數，組成 GET URL
    function getNextF(css) {
        let form = getOne(css), value = '';
        if (form) {
            form.querySelectorAll('input[name]').forEach(function(input) {
                value += input.name + '=' + input.value + '&';
            });
            value = encodeURI(value.replace(/&$/, ''));
            if (form.action && value) return (form.action + '?' + value);
        }
        return '';
    }

    // ---- XHR 取得下一頁 ----

    // Type 1：XHR 取得下一頁內容（Chrome/Firefox 雙路徑）
    function fetchNextPage(url) {
        // Firefox 或規則指定 gmxhr 時使用 GM_xmlhttpRequest + cookiePartition
        // Chrome 使用原生 XMLHttpRequest 以保留跨域 cookie
        if (curSite.gmxhr || navigator.userAgent.includes('Firefox')) {
            let headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            };
            if (curSite.xRequestedWith === true) headers['x-requested-with'] = 'XMLHttpRequest';
            if (curSite.noReferer !== true) headers['Referer'] = location.href;

            GM_xmlhttpRequest({
                url: url,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: headers,
                cookiePartition: {
                    topLevelSite: location.origin
                },
                timeout: 5000,
                onload: function (response) {
                    try {
                        processElements(createDocumentByString(
                            (new TextDecoder((document.characterSet || document.charset || document.inputEncoding))).decode(response.response)
                        ));
                    } catch (e) {
                        console.error('[MyAutoPager] 處理下一頁內容時出錯\n', e, '\nURL：' + url, '\n最終 URL：' + response.finalUrl, '\n狀態：' + response.statusText);
                    }
                },
                onerror: function (response) {
                    console.log('[MyAutoPager] XHR 失敗 URL：' + url, response);
                    GM_notification({text: '❌ 取得下一頁失敗...', timeout: 5000});
                },
                ontimeout: function (response) {
                    setTimeout(function(){ curSite.pageUrl = ''; }, 3000);
                    console.log('[MyAutoPager] XHR 逾時 URL：' + url, response);
                    GM_notification({text: '❌ 取得下一頁逾時，可 3 秒後再次滾動重試...', timeout: 5000});
                }
            });
        } else {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.overrideMimeType('text/html; charset=' + (document.characterSet || document.charset || document.inputEncoding));

            if (curSite.xRequestedWith === true) { xhr.setRequestHeader('x-requested-with', 'XMLHttpRequest'); }
            xhr.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml');

            xhr.timeout = 5000;
            xhr.onload = function() {
                try {
                    processElements(createDocumentByString(xhr.responseText));
                } catch (e) {
                    console.error('[MyAutoPager] 處理下一頁內容時出錯\n', e, '\nURL：' + url, '\n最終 URL：' + xhr.responseURL, '\n狀態：' + xhr.statusText);
                }
            };
            xhr.onerror = function() {
                console.log('[MyAutoPager] XHR 失敗 URL：' + url, xhr.statusText);
                GM_notification({text: '❌ 取得下一頁失敗...', timeout: 5000});
            };
            xhr.ontimeout = function() {
                setTimeout(function(){ curSite.pageUrl = ''; }, 3000);
                console.log('[MyAutoPager] XHR 逾時 URL：' + url, xhr.statusText);
                GM_notification({text: '❌ 取得下一頁逾時，可 3 秒後再次滾動重試...', timeout: 5000});
            };
            xhr.send();
        }
    }

    // ---- DOM 插入管線 ----

    // 處理並插入下一頁元素
    function processElements(response) {
        // 1. 預設 insertP
        if (!curSite.pager.insertP) { curSite.pager.insertP = [curSite.pager.pageE, 5]; }

        // 2. 從 response 取得 pageE 元素，以及插入目標 toE
        let pageE = getAll(curSite.pager.pageE, response, response), toE;
        if (curSite.pager.insertP[1] === 5) {
            toE = toE5pop(getAll(curSite.pager.insertP[0]));
        } else {
            toE = getOne(curSite.pager.insertP[0]);
        }

        if (pageE.length > 0 && toE) {
            // 5. 執行 bF 插入前函數
            if (curSite.function && curSite.function.bF) {
                if (curSite.function.bFp) {
                    if (typeof(curSite.function.bF) == 'string') {
                        pageE = new Function('pageE', 'bFp', 'fun', curSite.function.bF)(pageE, curSite.function.bFp, window.autoPage);
                    } else {
                        pageE = curSite.function.bF(pageE, curSite.function.bFp);
                    }
                } else {
                    if (typeof(curSite.function.bF) == 'string') {
                        pageE = new Function('pageE', 'fun', curSite.function.bF)(pageE, window.autoPage);
                    } else {
                        pageE = curSite.function.bF(pageE);
                    }
                }
            }

            // 強制新分頁開啟連結（blank 4/5/6）
            if (curSite.blank === 4 || curSite.blank === 5 || curSite.blank === 6) {
                pageE = forceTarget(pageE);
            }

            // 6. 插入元素
            let addTo = getAddTo(curSite.pager.insertP[1]);

            if (curSite.pager.insertP[1] === 6) {
                // 位置 6：插入到目標內部末尾（文字類，如小說）
                let afterend = '';
                if (curSite.pager.insertP6Br === false) {
                    // 通用規則：需偵測是否加 <br>
                    if (unsafeWindow.insertP6Br === true) {
                        afterend += '<br/><br/>';
                    } else if (unsafeWindow.insertP6Br === undefined) {
                        if (getAll('br', getOne(curSite.pager.pageE)).length > 10) {
                            if (!checkLastBr(getOne(curSite.pager.pageE))) {
                                unsafeWindow.insertP6Br = true;
                                afterend += '<br/><br/>';
                            } else {
                                unsafeWindow.insertP6Br = false;
                            }
                        }
                    }
                } else if (curSite.pager.insertP6Br) {
                    afterend += '<br/><br/>';
                }
                pageE.forEach(function (one) { afterend += one.innerHTML; });
                toE.insertAdjacentHTML(addTo, afterend);
            } else {
                // 位置 2/4/5 需反轉順序
                if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse();
                pageE.forEach(function (one) { toE.insertAdjacentElement(addTo, one); });
            }

            // 8. 頁碼 +1
            pageNumIncrement();

            // 9. 新增歷史記錄
            if (curSite.history === undefined) {
                if (GM_getValue('menu_history', true)) addHistory(response);
            } else {
                if (curSite.history) addHistory(response);
            }

            // 10. 替換元素
            if (curSite.pager.replaceE !== '') replaceElems(response);

            // 11. 處理 scriptT
            if (curSite.pager.scriptT || curSite.pager.scriptT == 0) {
                switch (curSite.pager.scriptT) {
                    case 0: // 下一頁所有 <script>
                        insScript('script', response); break;
                    case 1: // 下一頁所有 <script>（不含 src）
                        insScript('script:not([src])', response); break;
                    case 2: // pageE 同級 <script>
                        if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse();
                        insScript(null, pageE); break;
                    case 3: // pageE 子元素 <script>
                        if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse();
                        insScript('script:not([src])', pageE); break;
                }
            }

            // 12. 執行 aF 插入後函數
            if (curSite.function && curSite.function.aF) {
                if (curSite.function.aFp) {
                    if (typeof(curSite.function.aF) == 'string') {
                        new Function('aFp', 'fun', curSite.function.aF)(curSite.function.aFp, window.autoPage);
                    } else {
                        curSite.function.aF(curSite.function.aFp);
                    }
                } else {
                    if (typeof(curSite.function.aF) == 'string') {
                        new Function('fun', curSite.function.aF)(window.autoPage);
                    } else {
                        curSite.function.aF();
                    }
                }
            }
        } else {
            // 13. 取得主體元素失敗
            console.log(curSite.pager.pageE, pageE, curSite.pager.insertP, toE, response);
            if (curSite.retry) {
                console.warn('[MyAutoPager] 取得主體元素失敗，' + curSite.retry + ' 毫秒後可重試...');
                setTimeout(function(){ curSite.pageUrl = ''; }, curSite.retry);
            } else {
                console.error('[MyAutoPager] 取得主體元素失敗...');
            }
        }
    }

    // 替換元素（含自動推斷邏輯）
    function replaceElems(response, o, r) {
        if (o === undefined) o = curSite.pager.replaceE;
        if (r === undefined) r = curSite.pager.replaceE;
        let oE, rE;

        if (curSite.pager.replaceE === undefined && curSite.pager.nextL && curSite.pager.nextL.search(/^js;/i) !== 0) {
            // replaceE 未定義，nextL 存在且非 js 代碼：自動推斷
            let a = getOne(curSite.pager.nextL);
            if (a && ((a.nextElementSibling && a.nextElementSibling.tagName === a.tagName) || (a.previousElementSibling && a.previousElementSibling.tagName === a.tagName))) {
                // nextL 元素前後有同類型相鄰兄弟元素 → 替換父元素
                if (curSite.pager.nextL.slice(0, 1) === '/' || curSite.pager.nextL.slice(0, 2) === './' || curSite.pager.nextL.slice(0, 2) === '(/' || curSite.pager.nextL.slice(0, 3) === 'id(') {
                    o = r = curSite.pager.nextL + '/..';
                } else {
                    oE = getAllParentElement(curSite.pager.nextL);
                    rE = getAllParentElement(curSite.pager.nextL, response, response);
                }
            } else if (a) {
                // 無同類型相鄰兄弟元素 → 替換 nextL 本身
                o = r = curSite.pager.nextL;
            }
        }

        if (!oE && !rE && o && r) {
            oE = getAll(o);
            rE = getAll(r, response, response);
        }

        if (oE && rE && oE.length != 0 && rE.length != 0 && oE.length === rE.length) {
            for (let i = 0; i < oE.length; i++) {
                oE[i].outerHTML = rE[i].outerHTML;
            }
            return true;
        } else if (curSite.pager.replaceE !== undefined) {
            console.log(response, oE, rE);
        }
        return false;
    }

    // 新增瀏覽器歷史記錄
    function addHistory(pageE, title, url) {
        if (!curSite.pageUrl) return;
        // 對於自帶類似功能或覆蓋了 history 的網站，跳過
        if (window.top.history.toString() !== '[object History]') return;
        title = title || ((pageE.querySelector('title')) ? pageE.querySelector('title').textContent : window.top.document.title);
        url = url || curSite.pageUrl;
        window.top.document.Autopage_nowUrl = curSite.pageUrl;
        // 下一頁 URL 與當前網頁 URL 協議不同時，以當前網頁協議為準
        if (url.indexOf(window.top.location.protocol) === -1) url = url.replace(/^https?:/, window.top.location.protocol);
        window.top.history.pushState('Autopage_history', title, url);
        window.top.document.title = title;
    }

    // 頁碼遞增
    function pageNumIncrement(num = 1) {
        pageNum.now = pageNum._now + num;
    }

    // ---- 輔助函數 ----

    // 修復懶載入圖片
    function src_bF(pageE, css = [0, 'img[data-original], img[data-src]', 'data-original']) {
        if (css[2] === undefined) css[2] = 'data-original';
        pageE.forEach(function (one) {
            if (css[0] == 0) {
                // src 圖片
                if (one.tagName === 'IMG') {
                    if (one.getAttribute(css[2])) { one.src = one.getAttribute(css[2]); } else if (one.dataset.src) { one.src = one.dataset.src; }
                } else {
                    one.querySelectorAll(css[1]).forEach(function (now) {
                        if (now.getAttribute(css[2])) { now.src = now.getAttribute(css[2]); } else if (now.dataset.src) { now.src = now.dataset.src; }
                    });
                }
            } else if (css[0] == 1) {
                // 背景圖片
                if (one.tagName === 'IMG') {
                    if (one.getAttribute(css[2])) { one.style.backgroundImage = 'url("' + one.getAttribute(css[2]) + '")'; } else if (one.dataset.src) { one.style.backgroundImage = 'url("' + one.dataset.src + '")'; }
                } else {
                    one.querySelectorAll(css[1]).forEach(function (now) {
                        if (now.getAttribute(css[2])) { now.style.backgroundImage = 'url("' + now.getAttribute(css[2]) + '")'; } else if (now.dataset.src) { now.style.backgroundImage = 'url("' + now.dataset.src + '")'; }
                    });
                }
            }
        });
        return pageE;
    }

    // 正則文字過濾
    function xs_bF(pageE, reg) {
        pageE.forEach(function (one) { one.innerHTML = one.innerHTML.replace(reg[0], reg[1]); });
        return pageE;
    }

    // 清除 DOM 事件（克隆元素）
    function cleanuEvent(css, delay = 0, mode = -1) {
        setTimeout(() => {
            getAll(css).forEach(function (a) {
                const clonedLink = a.cloneNode(true);
                if (mode == 0 || mode == 1) { if (clonedLink.getAttribute('onclick') != undefined) { clonedLink.removeAttribute('onclick'); } }
                if (mode == 0 || mode == 2) clonedLink.addEventListener('click', function(e) { e.stopPropagation(); });
                a.insertAdjacentElement('afterend', clonedLink);
                a.remove();
            }, delay);
        });
    }

    // 檢查元素末尾是否為 <br>（用於 insertP6Br 判斷）
    function checkLastBr(e) {
        const children = Array.from(e.childNodes).filter(node => {
            return node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
        });
        const lastElement = children[children.length - 1];
        if (lastElement.tagName === 'BR') {
            return true;
        } else if (lastElement.tagName === 'P' && lastElement.classList.contains('readinline')) {
            return children[children.length - 2].tagName === 'BR';
        }
        return false;
    }

    // 更新 window.autoPage 公開 API
    Object.assign(window.autoPage, {
        getNextE, getNextEP, getNextSP, getNextEPN, getNextUPN, getNextUP, getNextF,
        src_bF, xs_bF, cleanuEvent, pageNumIncrement
    });

    // ========== 後續 Task 將在此添加 ==========

})();
