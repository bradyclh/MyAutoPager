// ==UserScript==
// @name         MyAutoPager (iPhone)
// @version      1.6.0
// @updateURL    https://raw.githubusercontent.com/bradyclh/MyAutoPager/main/MyAutoPager-iPhone.user.js
// @downloadURL  https://raw.githubusercontent.com/bradyclh/MyAutoPager/main/MyAutoPager-iPhone.user.js
// @author       clh (based on AutoPager by X.I.U)
// @description  iPhone Safari 小說自動翻頁 — 支援 Safari Userscripts App
// @copyright    Original AutoPager (c) X.I.U (https://github.com/XIU2/UserScript) GPL-3.0
// @license      GPL-3.0
// @inject-into  content
// @run-at       document-start
// @weight       999
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @match        *://look.thisiscm.com/*
// @match        *://look.twword.com/*
// @match        *://uukanshu.cc/*
// @match        *://*.uukanshu.cc/*
// @match        *://69shuba.tw/*
// @match        *://*.69shuba.tw/*
// @match        *://69shuba.com/*
// @match        *://*.69shuba.com/*
// @match        *://uuread.tw/*
// @match        *://*.uuread.tw/*
// @match        *://qimao.com/*
// @match        *://*.qimao.com/*
// @match        *://tw.hjwzw.com/*
// @match        *://www.hjwzw.com/*
// @match        *://ixdzs.hk/*
// @match        *://*.ixdzs.hk/*
// @match        *://ixdzs.tw/*
// @match        *://*.ixdzs.tw/*
// @match        *://ixdzs8.com/*
// @match        *://*.ixdzs8.com/*
// @match        *://ttks.tw/*
// @match        *://*.ttks.tw/*
// @match        *://twkan.com/*
// @match        *://*.twkan.com/*
// @match        *://novels.com.tw/*
// @match        *://*.novels.com.tw/*
// @match        *://oop.tw/*
// @match        *://*.oop.tw/*
// @match        *://*.workers.dev/*
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // 在自己的雲端閱讀器（Cloudflare Workers）網頁上：只做配對，不翻頁、不攔彈窗。見 dlPairFromReader()
    // （@match 因此涵蓋 *.workers.dev；沒有閱讀器標記的頁面什麼都不做）
    if (/\.workers\.dev$/i.test(location.hostname)) {
        dlPairFromReader(
            function(k, d) { try { return Promise.resolve(GM.getValue(k, d)); } catch (e) { return Promise.resolve(d); } },
            function(k, v) { try { return Promise.resolve(GM.setValue(k, v)); } catch (e) { return Promise.resolve(); } }
        );
        return;
    }

    // ========== 彈窗攔截（第一層：頁面世界的 window.open 鎖） ==========
    // @inject-into content 讓這支腳本跑在隔離世界：DOM 與頁面共用，JS 全域卻是
    // 分開的。在這裡覆寫 window.open 只改到自己世界的物件，頁面腳本看到的
    // window.open 完全沒動 —— 1.4.0 在真機上仍擋不住廣告分頁就是這個原因
    //（單一世界的測試環境會給出假的通過）。真正的鎖必須塞成 <script> 讓它在
    // 頁面世界執行。下面這個函式是被 toString() 後整段搬過去跑的，所以不能
    // 引用任何外部變數，也只能用頁面一定有的 API。
    // ==== guard-shared-begin ====
    // 兩版逐字相同（static.test.js 檢查）
    function apPageGuardMain() {
        if (window.__apPageGuard) return;
        var root = document.documentElement;
        // 回報給 content 世界：資料放 DOM 屬性而不是 CustomEvent.detail，
        // detail 物件跨世界不一定讀得到，DOM 屬性一定可以
        function report(kind, url) {
            try {
                root.setAttribute('data-ap-blocked', kind + ' ' + String(url || '').slice(0, 200));
                root.dispatchEvent(new Event('ap-blocked'));
            } catch (e) {}
        }
        function blockedOpen(url) { report('open', url); return null; }
        // 鎖成不可寫、不可重設，頁面腳本改不回去
        function lock(win) {
            try {
                if (!win || win.__apOpenLocked) return;
                Object.defineProperty(win, 'open', { value: blockedOpen, writable: false, configurable: false });
                Object.defineProperty(win, '__apOpenLocked', { value: true });
            } catch (e) { try { win.open = blockedOpen; } catch (e2) {} }
        }
        lock(window);

        // 同源 iframe（about:blank / srcdoc）的 contentWindow.open 是乾淨的，
        // 「插一個 iframe 再呼叫它的 open」是繞過覆寫的經典手法。兩個入口都堵：
        // 一插進 DOM 就鎖（frames[0] 這條路也走這裡），取 contentWindow 時再鎖一次
        //（導航後 Window 物件可能換新）。跨域的存取 document 會丟例外 → 略過，
        // 那些交給 content 世界的 sandbox。
        function lockFrame(f) {
            try {
                var w = f.contentWindow;
                if (w && w.document) lock(w);
                // 導航後 Window 物件可能換新，載入完再鎖一次
                if (!f.__apLoadHooked) { f.__apLoadHooked = true; f.addEventListener('load', function() { lockFrame(f); }); }
            } catch (e) {}
        }
        function lockTree(n) {
            try {
                if (!n || n.nodeType !== 1) return;
                if (n.tagName === 'IFRAME') { lockFrame(n); return; }
                if (!n.querySelectorAll) return;
                var fs = n.querySelectorAll('iframe');
                for (var k = 0; k < fs.length; k++) lockFrame(fs[k]);
            } catch (e) {}
        }
        // MutationObserver 是 microtask，來不及應付「插入 iframe → 同一行就拿
        // frames[n].open」這種同步寫法（frames[] 不經 contentWindow getter）。
        // 所以插入 DOM 的常用方法也包一層，在插入的當下就鎖。
        function wrapInsert(proto, name) {
            try {
                var orig = proto[name];
                if (typeof orig !== 'function') return;
                Object.defineProperty(proto, name, {
                    value: function() {
                        var r = orig.apply(this, arguments);
                        for (var i = 0; i < arguments.length; i++) {
                            var a = arguments[i];
                            // DocumentFragment 插入後已清空，改掃目標節點
                            if (a && a.nodeType === 11) lockTree(this); else lockTree(a);
                        }
                        return r;
                    },
                    writable: true, configurable: true
                });
            } catch (e) {}
        }
        wrapInsert(Node.prototype, 'appendChild');
        wrapInsert(Node.prototype, 'insertBefore');
        wrapInsert(Element.prototype, 'append');
        wrapInsert(Element.prototype, 'prepend');
        // 其餘插入路徑（innerHTML、parser 解析出來的）由觀察器補上
        try {
            new MutationObserver(function(muts) {
                for (var i = 0; i < muts.length; i++) {
                    var added = muts[i].addedNodes;
                    for (var j = 0; j < added.length; j++) lockTree(added[j]);
                }
            }).observe(document, { childList: true, subtree: true });
        } catch (e) {}
        try {
            var d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
            if (d && d.get) {
                Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                    get: function() {
                        var w = d.get.call(this);
                        try { if (w && w.document) lock(w); } catch (e) {}
                        return w;
                    },
                    configurable: true
                });
            }
        } catch (e) {}

        // 程式化點擊：a.click() 若錨點還沒進 DOM，事件傳不到 document，
        // 點擊守衛攔不到，瀏覽器卻照樣開新分頁。只影響腳本呼叫的 .click()。
        try {
            var nativeClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function() {
                var raw = '', tgt = null;
                try { raw = this.getAttribute('href') || ''; tgt = this.getAttribute('target'); } catch (e) {}
                var isJs = raw.toLowerCase().replace(/\s/g, '').indexOf('javascript:') === 0;
                if (isJs || tgt === '_blank' || tgt === '_new') { report('click', raw); return; }
                return nativeClick.apply(this, arguments);
            };
        } catch (e) {}

        // 外站廣告腳本（如 uuread 的 popunder）在 window／document 掛 click、touchend 等監聽器：
        // 捕獲階段吞掉整頁點擊（連腳本面板的按鈕都按不到），再趁使用者點擊開廣告分頁。
        // 呼叫堆疊裡「全是外站網址」的這類註冊直接不掛；站方自己的程式（堆疊裡有本站網址）照常。
        // 注入時帶 sourceURL，守衛自己的堆疊框沒有 http 網址，不會被當成本站。
        try {
            var siteOf = function(h) {
                var p = String(h).toLowerCase().split('.');
                var n = p.length > 2 && /^(com|net|org|edu|gov|co)$/.test(p[p.length - 2]) ? 3 : 2;
                return p.slice(-n).join('.');
            };
            var mySite = siteOf(location.hostname);
            var GUARD_EVT = /^(click|auxclick|dblclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|contextmenu)$/;
            var fromOtherSite = function() {
                var lim = Error.stackTraceLimit, st = '';
                try { Error.stackTraceLimit = 50; st = String(new Error().stack || ''); } catch (e) {}
                try { Error.stackTraceLimit = lim; } catch (e) {}
                var urls = st.match(/https?:\/\/[^\/\s:)]+/g);
                if (!urls) return false;
                for (var i = 0; i < urls.length; i++) if (siteOf(urls[i].replace(/^https?:\/\//, '')) === mySite) return false;
                return true;
            };
            var nativeAdd = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function(type, fn, opt) {
                if ((this === window || this === document || this === document.documentElement || this === document.body) &&
                    GUARD_EVT.test(String(type)) && fromOtherSite()) {
                    root.setAttribute('data-ap-listener-blocked', String(+(root.getAttribute('data-ap-listener-blocked') || 0) + 1));
                    return;
                }
                return nativeAdd.apply(this, arguments);
            };
        } catch (e) {}

        try { Object.defineProperty(window, '__apPageGuard', { value: true }); } catch (e) {}
        // 這個標記讓 content 世界知道守衛真的跑起來了（被 CSP 擋掉就不會有）
        root.setAttribute('data-ap-pageguard', '1');
    }
    // ==== guard-shared-end ====

    var pageGuardOk = false;

    // document-start 有機會早到連 <html> 都還沒建出來；需要根節點的動作都走這裡
    function whenRoot(fn) {
        if (document.documentElement) { fn(); return; }
        try {
            var mo = new MutationObserver(function() {
                if (document.documentElement) { mo.disconnect(); fn(); }
            });
            mo.observe(document, { childList: true });
        } catch (e) {}
    }

    function installPageGuard() {
        whenRoot(function() {
            try {
                var sc = document.createElement('script');
                sc.textContent = '(' + apPageGuardMain.toString() + ')();\n//# sourceURL=myautopager-guard.js';
                (document.head || document.documentElement).appendChild(sc);
                if (sc.parentNode) sc.parentNode.removeChild(sc);
            } catch (e) {}
            // 內嵌 <script> 是同步執行的：到這裡標記不是已經在、就是被 CSP 擋掉了
            pageGuardOk = document.documentElement.getAttribute('data-ap-pageguard') === '1';
            if (!pageGuardOk) console.warn('[MyAutoPager] 頁面守衛未生效（多半是網站 CSP 擋掉內嵌 script），只剩 DOM 層攔截');
        });
    }

    // 攔截回饋：iPhone 上沒 console，擋掉了什麼要畫在畫面上，使用者才分得清
    // 「有擋、但另有漏網之魚」和「根本沒在擋」
    var apBlockedCount = 0;
    function apReportBlocked(kind) {
        apBlockedCount++;
        apNotice('已攔截 ' + apBlockedCount + ' 次彈窗（' + kind + '）', 3000);
    }
    function installBlockFeedback() {
        whenRoot(function() {
            document.documentElement.addEventListener('ap-blocked', function() {
                var what = '';
                try { what = (document.documentElement.getAttribute('data-ap-blocked') || '').split(' ')[0]; } catch (e) {}
                apReportBlocked(what || 'open');
            });
        });
    }

    // 第一層之二：跨域 iframe。腳本帶 @noframes，不會注入到廣告 iframe 裡，
    // 那裡的 window.open 是乾淨的，contentWindow 也碰不到，改用 sandbox：
    // 少了 allow-popups / allow-top-navigation，瀏覽器自己就會擋掉彈窗。
    // 同源 iframe 交給頁面世界的守衛。
    var AP_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

    function guardIframe(f) {
        try {
            var src = f.getAttribute('src') || '';
            if (!src || !isCrossOrigin(src)) return;
            // 只在頁面沒自己設過 sandbox 時才加，免得放寬既有限制
            if (f.getAttribute('sandbox') !== null) return;
            f.setAttribute('sandbox', AP_IFRAME_SANDBOX);
            // sandbox 要到下一次導航才生效，而 iframe 一插進 DOM 就開始載入，
            // 觀察器接手時可能已經在載了：重設 src 強制它在 sandbox 下重載
            f.setAttribute('src', src);
        } catch (e) {}
    }

    // ========== DOM 選擇器 ==========

    function getCSS(css, ctx) { return (ctx || document).querySelector(css); }
    function getAllCSS(css, ctx) { return [].slice.call((ctx || document).querySelectorAll(css)); }

    function getXpath(xpath, ctx, doc) {
        doc = doc || document; ctx = ctx || doc;
        try {
            var r = doc.evaluate(xpath, ctx, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return r.singleNodeValue && r.singleNodeValue.nodeType === 1 && r.singleNodeValue;
        } catch (e) { return null; }
    }

    function getAllXpath(xpath, ctx, doc) {
        doc = doc || document; ctx = ctx || doc;
        var result = [];
        try {
            var q = doc.evaluate(xpath, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (var i = 0; i < q.snapshotLength; i++) {
                var n = q.snapshotItem(i);
                if (n.nodeType === 1) result.push(n);
            }
        } catch (e) {}
        return result;
    }

    function getOne(s, ctx, doc) {
        if (!s) return;
        doc = doc || document; ctx = ctx || doc;
        return (s[0] === '/' || s.slice(0,2) === './' || s.slice(0,2) === '(/' || s.slice(0,3) === 'id(')
            ? getXpath(s, ctx, doc) : getCSS(s, ctx);
    }

    function getAll(s, ctx, doc) {
        if (!s) return [];
        doc = doc || document; ctx = ctx || doc;
        return (s[0] === '/' || s.slice(0,2) === './' || s.slice(0,2) === '(/' || s.slice(0,3) === 'id(')
            ? getAllXpath(s, ctx, doc) : getAllCSS(s, ctx);
    }

    // ========== 工具函數 ==========

    function createDoc(html) {
        if (!html) return;
        try { return (new DOMParser()).parseFromString(html, 'text/html'); } catch (e) {}
        var t = document.implementation.createHTMLDocument('');
        t.body.innerHTML = html;
        return t;
    }

    function insStyle(css) {
        if (css.indexOf('{') === -1) css += '{display:none!important}';
        document.documentElement.appendChild(document.createElement('style')).textContent = css;
    }

    // ========== 畫面提示 ==========
    // iPhone 上看不到 console（要接 Mac 開 Web Inspector），所以原本每個失敗
    // 都是靜默的，出問題時使用者只知道「不會動」。這裡把關鍵狀態畫到頁面上。
    var noticeHost = null, noticeTimer = null, noNextNotified = false;

    function apNotice(msg, ms) {
        try {
            if (!noticeHost) {
                noticeHost = document.createElement('div');
                noticeHost.id = 'Autopage_notice';
                noticeHost.style.cssText = 'position:fixed!important;left:0!important;right:0!important;' +
                    'bottom:0!important;z-index:9999999!important';
                document.documentElement.appendChild(noticeHost);
                var sr = noticeHost.attachShadow({ mode: 'open' });
                sr.innerHTML = '<style>#n{margin:8px;padding:10px 12px;border-radius:8px;' +
                    'background:rgba(20,20,20,.92);color:#fff;font:14px/1.5 system-ui;' +
                    'box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;' +
                    '-webkit-tap-highlight-color:transparent;touch-action:manipulation}</style>' +
                    '<div id="n" role="status"></div>';
                noticeHost._n = sr.querySelector('#n');
            }
            noticeHost.style.display = '';
            noticeHost._n.textContent = '[MyAutoPager] ' + msg;
            clearTimeout(noticeTimer);
            // ms === 0 代表常駐（需要使用者自己點掉或點擊執行動作）
            if (ms !== 0) {
                noticeTimer = setTimeout(function() {
                    if (noticeHost) noticeHost.style.display = 'none';
                }, ms || 8000);
            }
            return noticeHost._n;
        } catch (e) { return null; }
    }

    function toE5pop(a) {
        if (!a.length) return;
        var b = a.pop();
        return (b.tagName === 'SCRIPT' || b.tagName === 'STYLE' || b.tagName === 'LINK') ? toE5pop(a) : b;
    }

    // ========== 清除非文字內容 ==========

    var REMOVE_TAGS = 'iframe,img,script,style,link,ins,noscript,ad,video,audio,canvas,svg,object,embed,form,input,button,select,textarea';
    var PROMO_KEYWORDS = ['溫馨提示', 'VIP', '免廣告', '加入書架', '搜書名'];
    var AD_CLASS_RE = /\b(gadBlock|clickforce|cfad|ad[-_]?wrap)/i;
    var INLINE_EVENT_ATTRS = ['onclick', 'onmousedown', 'onmouseup', 'ontouchstart', 'ontouchend', 'onpointerdown', 'onauxclick', 'onsubmit', 'oncontextmenu'];

    // 站方閱讀設定控制項的判斷字樣（見 apIsSiteUiControl）
    // 函式名稱：字級、夜間、配色、書架等設定類動作
    var SITE_UI_FN_RE = /(size|font|zoom|night|dark|day|light|theme|skin|color|colour|bg|background|mode|cog|setting|config|style|width|line|spacing|bookmark|shelf)/i;
    // 按鈕語境（class／id／title／文字）：空的 javascript: 只能靠這個判斷
    var SITE_UI_CTX_RE = /(set|cog|control|tool|font|size|theme|skin|night|dark|day|color|bg|read[-_]?set|reader|字|夜|日間|白天|背景|主題|護眼|設定|設置|字號|字体|字體)/i;
    // 廣告特徵：補 AD_CLASS_RE 沒涵蓋的常見命名
    var SITE_UI_AD_RE = /\b(ad|ads|advert|banner|sponsor|promo|gpt|taboola|clickforce|onead)\b|(^|[^a-z])ad[-_]/i;
    // 程式碼含這些字樣就代表會導向或開新頁，一律不放行
    var SITE_UI_BAD_RE = /open|location|href|window\.|document\.|eval|http/i;

    // 判斷 URL 是否為跨域（相對基礎域名；假設兩段式 TLD，對當前支援站點有效）
    function getBaseDomain() {
        var parts = location.hostname.split('.');
        return parts.length >= 2 ? parts.slice(-2).join('.') : location.hostname;
    }

    function isCrossOrigin(url) {
        try {
            var host = new URL(url, location.href).hostname;
            if (!host || host === location.hostname) return false;
            return host.indexOf(getBaseDomain()) === -1;
        } catch (e) { return false; }
    }

    // 第二層：清除內聯事件屬性 + 中和危險連結
    function stripPopupTriggers(el) {
        if (!el || el.nodeType !== 1) return;
        INLINE_EVENT_ATTRS.forEach(function(a) { el.removeAttribute(a); });
        var sel = '[' + INLINE_EVENT_ATTRS.join('],[') + ']';
        try {
            el.querySelectorAll(sel).forEach(function(n) {
                INLINE_EVENT_ATTRS.forEach(function(a) { n.removeAttribute(a); });
            });
        } catch (e) {}
        el.querySelectorAll('a[href]').forEach(function(a) {
            var raw = a.getAttribute('href') || '';
            var isJs = raw.toLowerCase().replace(/\s/g, '').indexOf('javascript:') === 0;
            // 用原始 href 字串餵 isCrossOrigin，避免 DOMParser 文件無 baseURI 時 a.href 畸形
            if (isJs || isCrossOrigin(raw)) {
                a.setAttribute('data-blocked-href', raw);
                a.removeAttribute('href');
                a.removeAttribute('target');
                a.style.setProperty('pointer-events', 'none', 'important');
            }
        });
    }

    // ---- 站方閱讀設定控制項的放行判斷（apDefuseAnchor 與點擊守衛共用） ----
    // 站方常把字級、夜間模式寫成 <a href="javascript:isnight();">，整頁一律拆彈會把
    // 它們一起弄壞。這裡只放行「長得就是設定按鈕」的錨點，而且判斷從嚴：任何一條不確定
    // 就照擋。放行的只是站方自己的 handler；window.open 鎖與 iframe 守衛完全不動，
    // 所以放行的程式碼即使想偷開分頁，也會被頁面世界的 window.open 鎖擋下。

    // 從錨點往上走（含自己），最多 maxDepth 層，到 body 為止；任一節點的指定屬性命中 re 就回傳 true
    function apChainMatches(a, maxDepth, re, attrs) {
        for (var n = a, d = 0; n && d <= maxDepth && n !== document.body && n !== document.documentElement; n = n.parentElement, d++) {
            for (var i = 0; i < attrs.length; i++) {
                if (re.test(n.getAttribute(attrs[i]) || '')) return true;
            }
        }
        return false;
    }

    // 條件 1：錨點不在正文範圍內。curSite 還沒決定（document-start）時正文範圍未知，
    // 依規格視為範圍外；規則有 curSite 卻讀不出正文範圍，則從嚴視為在正文內
    function apOutsideContent(a) {
        if (!curSite) return true;
        try {
            if (!curSite.pager || !curSite.pager.pageE) return false;
            var els = getAll(curSite.pager.pageE);
            for (var i = 0; i < els.length; i++) {
                if (els[i].contains(a)) return false;
            }
            return true;
        } catch (e) { return false; }
    }

    // 條件 3b 的語境：錨點本身或祖先（最多 4 層）的標記，或錨點的文字
    function apCtxMarked(a) {
        if (apChainMatches(a, 4, SITE_UI_CTX_RE, ['class', 'id', 'title', 'aria-label'])) return true;
        // 文字只看短標籤：長文字多半是包住大段內容的容器，裡面隨便一個「夜」「字」就會誤中
        var txt = (a.textContent || '').replace(/\s+/g, '');
        return txt.length > 0 && txt.length <= 20 && SITE_UI_CTX_RE.test(txt);
    }

    function apIsSiteUiControl(a) {
        try {
            if (!a || a.nodeType !== 1) return false;
            // 條件 1：不在正文範圍（正文裡的 javascript: 一律照擋）
            if (!apOutsideContent(a)) return false;
            // 條件 2：錨點與祖先（最多 6 層）都沒有廣告特徵
            if (apChainMatches(a, 6, AD_CLASS_RE, ['class', 'id']) ||
                apChainMatches(a, 6, SITE_UI_AD_RE, ['class', 'id'])) return false;
            // 額外條件：target=_blank 會開新分頁，那條路 window.open 鎖管不到，不放行
            var tgt = a.getAttribute('target');
            if (tgt === '_blank' || tgt === '_new') return false;

            // 去掉開頭的 javascript:、結尾的分號與空白，剩下的才是要判斷的程式碼
            var code = (a.getAttribute('href') || '')
                .replace(/^\s*javascript\s*:/i, '').replace(/[\s;]+$/, '').replace(/^\s+/, '');

            // 條件 3a：單純的函式呼叫，函式名稱像設定，程式碼裡沒有開頁／導向的字樣
            if (/^[A-Za-z_$][\w$.]*\s*\([^()]*\)$/.test(code) &&
                SITE_UI_FN_RE.test(code.replace(/\s*\(.*$/, '')) &&
                !SITE_UI_BAD_RE.test(code)) return true;

            // 條件 3b：空的 javascript:（多半只是為了讓 jQuery 綁事件），靠周圍的設定語彙判斷
            var lower = code.toLowerCase();
            if ((lower === '' || lower === 'void(0)' || lower === 'void 0') && apCtxMarked(a)) return true;
            return false;
        } catch (e) { return false; }
    }

    // 第二層之二：整頁（非只有正文）的輕量拆彈，給觀察器與初始掃描共用。
    // 比 stripPopupTriggers 保守：只拔 inline 事件、只中和 javascript: 與
    // 跨域 _blank 錨點，不動一般跨域連結 —— 整頁套用 stripPopupTriggers 會
    // 連站內導覽都拔掉 href，萬一「下一章」是跨域連結就直接把翻頁弄壞。
    function apDefuseAnchor(a) {
        var raw = a.getAttribute('href') || '';
        var isJs = raw.toLowerCase().replace(/\s/g, '').indexOf('javascript:') === 0;
        var tgt = a.getAttribute('target');
        if (isJs) {
            // 站方設定控制項保留 href：拆掉之後字級、夜間按鈕就完全失效
            // 注意這裡可能在 curSite 決定之前（document-start）就被呼叫，apIsSiteUiControl 已處理
            if (apIsSiteUiControl(a)) {
                console.info('[MyAutoPager] 放行站方設定控制項:', raw);
                return;
            }
            a.setAttribute('data-blocked-href', raw);
            a.removeAttribute('href');
            a.removeAttribute('target');
            a.style.setProperty('pointer-events', 'none', 'important');
            return;
        }
        if ((tgt === '_blank' || tgt === '_new') && raw) {
            if (isCrossOrigin(raw)) {
                a.setAttribute('data-blocked-href', raw);
                a.removeAttribute('href');
                a.removeAttribute('target');
                a.style.setProperty('pointer-events', 'none', 'important');
            } else {
                // 站內連結不必弄死，改成同分頁開啟就好
                a.removeAttribute('target');
            }
        }
    }

    // 站方自己的 UI（字級、夜間模式、書籤）很常用 inline onclick，全頁一律拔
    // 會把那些按鈕一起弄壞。所以正文以外只對兩種節點拔：錨點，以及 class/id
    // 看起來就是廣告的容器 —— 開新分頁的載體實際上就是這些。
    // 正文範圍本來就由 cleanContent → stripPopupTriggers 全部拔掉，不重複處理。
    function apShouldStripInline(n) {
        // 放行的站方設定錨點連 inline onclick 一起保留，否則 href 留著、handler 卻沒了，按鈕照樣失效
        if (n.tagName === 'A') return !apIsSiteUiControl(n);
        var cls = n.className;
        if (cls && typeof cls !== 'string' && cls.baseVal !== undefined) cls = cls.baseVal;
        if (typeof cls === 'string' && AD_CLASS_RE.test(cls)) return true;
        return !!(n.id && AD_CLASS_RE.test(n.id));
    }

    function apDefuse(root) {
        if (!root || root.nodeType !== 1) return;
        try {
            if (apShouldStripInline(root)) {
                INLINE_EVENT_ATTRS.forEach(function(a) { root.removeAttribute(a); });
            }
            if (root.children && root.children.length) {
                var sel = '[' + INLINE_EVENT_ATTRS.join('],[') + ']';
                root.querySelectorAll(sel).forEach(function(n) {
                    if (!apShouldStripInline(n)) return;
                    INLINE_EVENT_ATTRS.forEach(function(a) { n.removeAttribute(a); });
                });
            }
        } catch (e) {}
        try {
            if (root.tagName === 'A') apDefuseAnchor(root);
            if (root.children && root.children.length) {
                root.querySelectorAll('a[href]').forEach(apDefuseAnchor);
            }
        } catch (e) {}
    }

    // 廣告是非同步注入的，初始化時掃一次不夠。這個觀察器讓後來才插進來的廣告
    // 同樣被拆彈 —— 也順帶修好雙擊手勢：正文被廣告錨點與 onclick 容器鋪滿時，
    // 手勢會被判成「點在互動元素上」而整片失效。
    var apStripQueue = [], apStripScheduled = false;

    function apFlushStrip() {
        apStripScheduled = false;
        var batch = apStripQueue;
        apStripQueue = [];
        for (var i = 0; i < batch.length; i++) apDefuse(batch[i]);
    }

    function apQueueStrip(node) {
        if (!node || node.nodeType !== 1) return;
        // 跳過腳本自己的 UI
        if (node.id === 'Autopage_number' || node.id === 'Autopage_notice') return;
        apStripQueue.push(node);
        if (apStripScheduled) return;
        apStripScheduled = true;
        if (window.requestAnimationFrame) requestAnimationFrame(apFlushStrip);
        else setTimeout(apFlushStrip, 16);
    }

    function installDomGuard() {
        // 觀察目標刻意是 document 而不是 document.documentElement：
        // @run-at document-start 有機會早到連 <html> 都還沒建出來，那時
        // documentElement 是 null，observe() 會丟例外並被 catch 吞掉 ——
        // 結果就是觀察器靜默地從沒裝上，延遲注入的廣告完全沒人管。
        // document 節點一定存在，且 subtree 同樣涵蓋之後長出來的整棵樹。
        try {
            new MutationObserver(function(muts) {
                for (var i = 0; i < muts.length; i++) {
                    var added = muts[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var n = added[j];
                        if (!n || n.nodeType !== 1) continue;
                        if (n.tagName === 'IFRAME') guardIframe(n);
                        else if (n.querySelectorAll) {
                            var fs = n.querySelectorAll('iframe');
                            for (var k = 0; k < fs.length; k++) guardIframe(fs[k]);
                        }
                        apQueueStrip(n);
                    }
                }
            }).observe(document, { childList: true, subtree: true });
        } catch (e) {
            console.warn('[MyAutoPager] DOM 守衛安裝失敗:', e && e.message);
        }
    }

    function cleanContent(elements, opts) {
        var keepText = opts && opts.keepText;
        // keepImg：圖片本身即內容的站點（如書籍封面）保留 <img>
        var removeTags = (opts && opts.keepImg)
            ? REMOVE_TAGS.split(',').filter(function(t) { return t !== 'img'; }).join(',')
            : REMOVE_TAGS;
        elements.forEach(function(el) {
            el.querySelectorAll(removeTags).forEach(function(n) { n.remove(); });
            stripPopupTriggers(el);
            el.querySelectorAll('div, p').forEach(function(node) {
                if (node.className && AD_CLASS_RE.test(node.className)) { node.remove(); return; }
                var txt = node.textContent.trim();
                if (!txt && node.children.length === 0) { node.remove(); return; }
                // 正文容器內的節點不套用推廣關鍵字刪除（保護純文字正文）
                if (keepText && node.closest && node.closest(keepText)) return;
                if (txt.length < 200) {
                    for (var i = 0; i < PROMO_KEYWORDS.length; i++) {
                        if (txt.indexOf(PROMO_KEYWORDS[i]) > -1) { node.remove(); return; }
                    }
                }
            });
        });
        return elements;
    }

    // novels.com.tw 正文以 AES-CBC 加密放在 <script>window.encryptedContent = "..."</script>，
    // 由站方 gfncgd.js 在 DOMContentLoaded 時解密；XHR 取回的頁面不會執行 script，只拿得到密文。
    // 金鑰寫死在該 js 的字串表內（跨書通用），IV 全零。WebCrypto 只有非同步 API，而 beforePage 是
    // 同步呼叫，所以先把 <article> 換成佔位文字讓插入照常進行，解密完成後再填回同一個節點。
    // 必須填 <article> 而非內層 #chapter-content：清空的 div 會被 cleanContent 當成空元素移除。
    var NOVELS_TW_KEY = 'WZc0cbzgY3lhz3X6';
    function novelsTwDecrypt(pageE) {
        pageE.forEach(function(el) {
            if (el.id !== 'article') return;
            var src = getAllCSS('script', el).map(function(s) { return s.textContent; })
                .filter(function(t) { return t.indexOf('encryptedContent') > -1; })[0];
            var m = src && src.match(/encryptedContent\s*=\s*("(?:[^"\\]|\\.)*")/);
            if (!m) return;
            var b64 = JSON.parse(m[1]);
            el.innerHTML = '<p>（MyAutoPager：正文解密中…）</p>';
            var raw = Uint8Array.from(atob(b64), function(c) { return c.charCodeAt(0); });
            // 下載到閱讀器時要等解密完成才能取文字（見 dlParsePage）
            el.__apDecrypt = crypto.subtle.importKey('raw', new TextEncoder().encode(NOVELS_TW_KEY), {name: 'AES-CBC'}, false, ['decrypt'])
                .then(function(key) { return crypto.subtle.decrypt({name: 'AES-CBC', iv: new Uint8Array(16)}, key, raw); })
                .then(function(buf) {
                    var html = new TextDecoder().decode(buf);
                    // 明文通常已是 <p> 段落；舊格式是純文字換行，比照站方逐行包 <p>
                    if (html.indexOf('<p') === -1) {
                        html = html.split('\n').map(function(l) { return l.trim() ? '<p>' + l + '</p>' : '<p><br></p>'; }).join('');
                    }
                    el.innerHTML = html;
                })
                .catch(function(e) {
                    console.error('[MyAutoPager] novels.com.tw 正文解密失敗（站方可能已換金鑰）', e);
                    el.innerHTML = '<p>（MyAutoPager：正文解密失敗，站方可能已更換金鑰，請重新整理此頁閱讀）</p>';
                });
        });
        return pageE;
    }

    // oop.tw 反爬：#article 的 data-ct=N 表示最後 N 個 <p> 的文字是倒序存放，由站方 JS 於載入後轉正；
    // XHR 取回的頁面不會執行站方 JS，這裡自行轉正。另移除站方混在正文的推廣句（「oop.tw 無錯章節」等）。
    // 一章拆成多頁時，站方按字數切頁，切點常落在句子中間（「不」｜「過眨眼的功夫…」）：
    // 同章續頁（新頁 h1 章號與畫面上最後一個相同）就把被切開的段落接回上一段，並丟掉重複的 h1。
    var OOP_PROMO_RE = /ｏｏｐ|𝗼𝗼𝗽|𝐨𝐨𝐩|oop\s*[.．]\s*tw|無錯章節|記住我們的域名/i;
    // 推廣句會變形躲關鍵字：全形、數學粗體、小型大寫（ᴏᴏᴘ.ᴛᴡ）、字母間加空白（o o p . t w）。
    // 比對前先 NFKC（全形與數學字母轉回 ASCII）、去空白，再把 NFKC 不處理的小型大寫轉回來
    var OOP_SMALLCAPS = { 'ᴏ': 'o', 'ᴘ': 'p', 'ᴛ': 't', 'ᴡ': 'w' };
    function oopFold(t) {
        try { t = t.normalize('NFKC'); } catch (e) {}
        return t.replace(/\s+/g, '').replace(/[ᴏᴘᴛᴡ]/g, function(c) { return OOP_SMALLCAPS[c]; });
    }
    function oopDropPromo(ps) {
        for (var i = 0; i < ps.length; i++) {
            var t = ps[i].textContent.trim();
            if (t.length < 40 && OOP_PROMO_RE.test(oopFold(t))) ps[i].remove();
        }
    }
    function oopFix(pageE) {
        var arts = pageE.filter(function(el) { return el.id === 'article'; });
        arts.forEach(function(art) {
            var ct = parseInt(art.getAttribute('data-ct'), 10) || 0;
            var ps = art.querySelectorAll('p');
            for (var i = Math.max(0, ps.length - ct); i < ps.length; i++) {
                ps[i].textContent = Array.from(ps[i].textContent).reverse().join('');
            }
            art.removeAttribute('data-ct');
            oopDropPromo(art.querySelectorAll('p'));
        });
        // 下載到閱讀器時頁面是抓來的、沒有插進畫面：後面的同章續頁合併會去改畫面上的 DOM，不可執行
        //（下載端自己用 dlJoinLines 合併同章分頁）
        if (dlHookMode) return pageE;
        // 首頁由站方 JS 插入的推廣句也一併清掉
        oopDropPromo(document.querySelectorAll('#article p'));

        var newH1 = pageE.filter(function(el) { return el.matches && el.matches('h1.chapter-title'); })[0];
        var h1s = document.querySelectorAll('h1.chapter-title');
        var lastH1 = h1s[h1s.length - 1];
        if (!newH1 || !lastH1 || newH1.textContent.trim() !== lastH1.textContent.trim()) return pageE;
        // 同章續頁
        pageE.splice(pageE.indexOf(newH1), 1);
        var docArts = document.querySelectorAll('#article');
        var prevArt = docArts[docArts.length - 1];
        // 每頁 #article 結尾有個 <br>，續頁接上時會在接縫多出一行空白
        while (prevArt && prevArt.lastChild && (prevArt.lastChild.nodeName === 'BR' || (prevArt.lastChild.nodeType === 3 && !prevArt.lastChild.textContent.trim()))) {
            prevArt.removeChild(prevArt.lastChild);
        }
        var prevPs = prevArt ? prevArt.querySelectorAll('p') : [];
        var prevP = prevPs[prevPs.length - 1];
        var firstP = arts[0] && arts[0].querySelector('p');
        if (prevP && firstP) {
            var prevT = prevP.textContent.replace(/\s+$/, ''), nextT = firstP.textContent.replace(/^\s+/, '');
            // 上一段沒以句末標點結尾，或下一段以標點開頭 → 視為同一段被切開
            if (!/[。！？!?…”」』）)]$/.test(prevT) || /^[，。、！？；：,.!?;:”」』）)]/.test(nextT)) {
                prevP.textContent = prevT + nextT;
                firstP.remove();
            }
        }
        return pageE;
    }

    // 第三層：攔截 document 級別的點擊劫持
    function installClickGuard() {
        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t || t.nodeType !== 1) return;

            // 放行腳本自身 UI
            if (t.id === 'Autopage_number' || (t.closest && t.closest('#Autopage_number'))) return;
            if (t.id === 'Autopage_notice' || (t.closest && t.closest('#Autopage_notice'))) return;

            // 是否落在正文範圍（下面 A、B 都要用）
            var inContent = false;
            if (curSite && curSite.pager.pageE) {
                try {
                    var contentEls = getAll(curSite.pager.pageE);
                    for (var i = 0; i < contentEls.length; i++) {
                        if (contentEls[i].contains(t)) { inContent = true; break; }
                    }
                } catch (err) {}
            }

            // A. 無條件攔截危險錨點（javascript: 協議 / 跨域 target=_blank）
            var anchor = t.closest ? t.closest('a') : null;
            if (anchor) {
                var rawHref = anchor.getAttribute('href') || '';
                if (rawHref.toLowerCase().replace(/\s/g, '').indexOf('javascript:') === 0) {
                    // 站方設定控制項放行：不攔截，讓站方的 handler 跑（window.open 鎖仍在）
                    if (apIsSiteUiControl(anchor)) {
                        console.info('[MyAutoPager] 放行站方設定控制項:', rawHref);
                        return;
                    }
                    console.warn('[MyAutoPager] 攔截 javascript: 連結');
                    e.stopPropagation(); e.preventDefault();
                    apReportBlocked('javascript:');
                    return;
                }
                var tgt = anchor.getAttribute('target');
                if (tgt === '_blank' || tgt === '_new') {
                    if (anchor.href && isCrossOrigin(anchor.href)) {
                        console.warn('[MyAutoPager] 攔截跨域 _blank 連結:', anchor.href);
                        e.stopPropagation(); e.preventDefault();
                        apReportBlocked('_blank');
                        return;
                    }
                    if (inContent) {
                        // 正文裡沒有任何正當理由開新分頁；站內網址常是廣告的跳轉頁
                        console.warn('[MyAutoPager] 攔截正文內 _blank 連結:', anchor.href);
                        e.stopPropagation(); e.preventDefault();
                        apReportBlocked('_blank');
                        return;
                    }
                    // 正文以外的站內 _blank：不擋死，改成同分頁開啟。預設行為要等
                    // 事件派發結束才決定，所以在捕獲階段拔掉 target 仍然來得及。
                    anchor.removeAttribute('target');
                }
                // 已被拆彈的錨點（href 被拔掉）不該再有任何動作
                if (anchor.hasAttribute('data-blocked-href')) {
                    e.stopPropagation(); e.preventDefault();
                    apReportBlocked('已拆彈錨點');
                    return;
                }
            }

            // B. 放行 pageE 內容範圍
            if (inContent) return;

            // C. 偵測可疑全頁/半頁固定覆蓋層
            var rect = t.getBoundingClientRect();
            var vw = window.innerWidth, vh = window.innerHeight;
            if (rect.width >= vw * 0.7 && rect.height >= vh * 0.5) {
                var style = getComputedStyle(t);
                var pos = style.position;
                if (pos === 'fixed' || pos === 'absolute') {
                    var zIdx = parseInt(style.zIndex) || 0;
                    if (zIdx >= 100) {
                        console.warn('[MyAutoPager] 攔截可疑覆蓋層點擊', t);
                        e.stopPropagation();
                        e.preventDefault();
                        apReportBlocked('覆蓋層');
                    }
                }
            }
        }, true);

        // 攔截可疑 form 提交（target=_blank 或跨域 action）
        document.addEventListener('submit', function(e) {
            var f = e.target;
            if (!f || f.tagName !== 'FORM') return;
            if (f.getAttribute('target') === '_blank') {
                console.warn('[MyAutoPager] 攔截 target=_blank form 提交');
                e.stopPropagation(); e.preventDefault();
                return;
            }
            var action = f.getAttribute('action') || '';
            if (action && isCrossOrigin(action)) {
                console.warn('[MyAutoPager] 攔截跨域 form 提交:', action);
                e.stopPropagation(); e.preventDefault();
            }
        }, true);
    }

    // ========== 小說規則 ==========

    var rules = {
        novel543: {
            host: ['look.thisiscm.com', 'look.twword.com'],
            url: /\d+_\d+/,
            style: 'ins.clickforceads, iframe.cfadif, div[id*="tam-ad"], div[id*="cfad"], ad {display:none!important}',
            pager: { nextL: '(//a[contains(text(),"下一章")])[last()]', pageE: '.chapter-content', replaceE: '.foot-nav', scrollD: 3000 },
            afterPage: function() {
                var first = document.querySelector('.chapter-content .content');
                if (first && first.style.fontSize) {
                    document.querySelectorAll('.chapter-content .content').forEach(function(c, i) {
                        if (i > 0) c.style.fontSize = first.style.fontSize;
                    });
                }
            }
        },
        uukanshu: {
            host: 'uukanshu.cc',
            style: '.▶, iframe[src*="political-effort"], script[src*="political-effort"], script[src*="grown-mouth"]',
            pager: { nextL: '#linkNext', pageE: '.readcotent', replaceE: '.mulu-box', scrollD: 3000 },
            afterPage: function() {
                var els = document.querySelectorAll('.readcotent');
                if (els.length > 1) els[els.length - 1].className = els[0].className;
            }
        },
        '69shuba': {
            host: '69shuba.tw',
            style: 'div[id*="pf-"], script[src*="novelapis"], script[src*="pubfuture"], .ad, iframe {display:none!important} #nr1, #nr1 * {text-align:center!important; font-size:36px!important; line-height:1.8!important; color:#999!important} .nr_title {text-align:center!important; font-size:24px!important; color:#ddd!important; display:block!important; margin:20px 0!important}',
            pager: { nextL: '#pb_next', pageE: '.nr_title, .nr_nr', replaceE: '.nr_page', scrollD: 3000 }
        },
        '69shuba_com': {
            host: '69shuba.com',
            style: '.yueduad1, div[id*="ad-"], script[src*="novelapis"], script[src*="pubfuture"], .ad, iframe {display:none!important} .txtnav {text-align:center!important; font-size:36px!important; line-height:1.8!important; color:#999!important} h1.hide720 {text-align:center!important; font-size:24px!important; color:#ddd!important; display:block!important; margin:20px 0!important}',
            pager: { nextL: '.page1 a:last-child', pageE: '.txtnav', replaceE: '.page1', scrollD: 3000 }
        },
        uuread: {
            host: 'uuread.tw',
            url: /\/chapter\//,
            pager: { nextL: "(//div[contains(@class,'operate')]//a[contains(text(),'下一頁') or contains(text(),'下一章')])[last()]", pageE: '.play-title, #nr', replaceE: '.operate', scrollD: 2000 },
            afterPage: function() {
                // uuread 字體大小由客戶端 JS 套 inline style，XHR 取得的新頁沒有，
                // 把首個 #nr 的 font-size 複製到後續插入的內容。
                var all = document.querySelectorAll('.txt_tcontent');
                if (all.length > 1 && all[0].style.fontSize) {
                    for (var i = 1; i < all.length; i++) all[i].style.fontSize = all[0].style.fontSize;
                }
            }
        },
        qimao: {
            host: 'qimao.com',
            // 只匹配真正的章節閱讀頁，避免在書庫/書籍詳情頁無謂啟用
            url: /^\/(reader\/index\/\d+|shuku\/\d+-)/,
            pager: { nextL: "(//div[contains(@class,'reader-footer')]//a[contains(text(),'下一章') or contains(text(),'下一页') or contains(text(),'下一頁')])[last()]", pageE: '.chapter-title, .chapter-detail-article', replaceE: '.reader-footer', scrollD: 2000 },
            afterPage: function() {
                var all = document.querySelectorAll('.chapter-detail-article');
                if (!all.length) return;
                var last = all[all.length - 1];
                // 付費牆偵測：免費試讀範圍外的章節以 <div class="qm-canvas-txt"> 渲染，正文無 <p>，
                // 但標題與下一章連結仍在，會導致無限附加空章節。偵測到即移除空章節並停止翻頁。
                if (last.querySelector('.qm-canvas-txt') || last.querySelectorAll('p').length === 0) {
                    if (all.length > 1) last.remove();
                    var titles = document.querySelectorAll('.chapter-title');
                    if (titles.length > 1) titles[titles.length - 1].remove();
                    document.querySelectorAll('.reader-footer a').forEach(function(a) {
                        if (/下一章|下一页|下一頁/.test(a.textContent)) a.remove();
                    });
                    return;
                }
                // 正常頁：把首章的 font-XX class 同步到後續插入的內容
                if (all.length > 1) {
                    var fontClass = (all[0].className.match(/font-\d+/) || [])[0];
                    if (fontClass) {
                        for (var i = 1; i < all.length; i++) {
                            all[i].className = all[i].className.replace(/\bfont-\d+\b/, '').trim() + ' ' + fontClass;
                        }
                    }
                }
                // 章節標題的大標樣式來自站方 CSS 的
                // .chapter-detail-wrap-info .chapter-title，但插入的章節落在
                // .chapter-detail-wrap-content 底下，選擇器不再命中，標題會縮成
                // 14px 細體靠左。把首章標題的實際樣式複製過去 —— 值取自
                // computed style 而非寫死，站方改版時會自動跟隨。
                var titleEls = getAll('.chapter-title');
                if (titleEls.length > 1) {
                    var titleBase = getComputedStyle(titleEls[0]);
                    var titleProps = ['fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'color'];
                    for (var t = 1; t < titleEls.length; t++) {
                        if (titleEls[t].dataset.apTitleSynced) continue;
                        for (var q = 0; q < titleProps.length; q++) {
                            titleEls[t].style[titleProps[q]] = titleBase[titleProps[q]];
                        }
                        titleEls[t].dataset.apTitleSynced = '1';
                    }
                }
            }
        },
        hjwzw: {
            // 黃金屋中文桌面版（tw. / www.）。手機站 t. / m. 的下一章只存在於頁面 JS 變數，
            // 版面也不同，不在此規則範圍；url 條件同時把那兩個子網域排除在外。
            host: 'hjwzw.com',
            url: /^\/Book\/Read\/\d+,\d+/,
            pager: {
                // 最後一章底部是純文字「末頁」而非連結，取不到 href 即自然停止翻頁
                nextL: "(//a[contains(text(),'下一章')])[last()]",
                // 版面全用 inline style，正文容器無 class/id：標題取唯一的 <h1>，
                // 正文取帶 text-indent 的 div；同款 style 的第二個 div 只有「請記住本站域名」
                // 頁尾，以字數門檻排除（不能用 [1]，否則插入後插入點會固定在首章而錯位）。
                pageE: "//h1 | //div[contains(@style,'text-indent: 2em') and string-length(normalize-space(.)) > 100]",
                replaceE: "//div[contains(@style,'width: 1000px') and contains(@style,'font-size: 20px')]",
                scrollD: 2000
            },
            // 正文一句一個 <p>，短句若含「VIP」等字樣會被推廣關鍵字規則誤刪
            cleanOpts: { keepText: 'div[style*="text-indent"]' },
            beforePage: function(pageE) {
                pageE.forEach(function(el) {
                    if (!el.getAttribute || (el.getAttribute('style') || '').indexOf('text-indent') === -1) return;
                    // 每章正文開頭固定重複「請記住本站域名: 黃金屋」與「書名 章節名」兩行，移除之
                    if (!el.querySelector('p')) return;   // 無 <p> 的異常版面不動，避免整章被清空
                    while (el.firstChild && !(el.firstChild.nodeType === 1 && el.firstChild.tagName === 'P')) {
                        el.firstChild.remove();
                    }
                    var first = el.querySelector('p');
                    if (first && first.querySelector('a[href*="/Book/"]')) first.remove();
                });
            }
        },
        ixdzs: {
            // 愛下電子書（繁中 .hk/.tw、簡中 ixdzs8.com，同一平台）
            host: ['ixdzs.hk', 'ixdzs.tw', 'ixdzs8.com'],
            url: /^\/read\/\d+\/p\d+\.html/,
            pager: {
                // 末章的下一章連結指向 end.html（完本頁），[href*="/p"] 排除之
                nextL: 'a.chapter-next[href*="/p"]',
                pageE: 'article.page-content',
                replaceE: '.page-turn',
                scrollD: 2000
            },
            // 正文一句一個 <p>，keepText 防推廣關鍵字誤刪
            cleanOpts: { keepText: '.page-content section' }
        },
        ttks: {
            // 天天看小說（AMP 頁面，正文與上下章導航各自是一個 .content）
            host: 'ttks.tw',
            url: /^\/novel\/chapters\/[^\/]+\/\d+\.html/,
            // 段落間插入的文字廣告與版面廣告槽
            style: '.txtad, ins.pubadx-slot, div[id^="supr-ad-container"] {display:none!important}',
            pager: {
                // 末章的下一章連結指向目錄 index.html，:not 排除之 → nextL 落空即乾淨停止
                nextL: '#linkNext:not([href*="index.html"])',
                // .frame_body 下有兩個 .content（正文、上下章導航），用 :has 區分；
                // .title 內是章節標題 <h1>
                pageE: '.frame_body > .title, .frame_body > .content:not(:has(.next_page))',
                replaceE: '.frame_body > .content:has(.next_page)',
                scrollD: 2000
            },
            // 正文一句一個 <p>，keepText 防推廣關鍵字誤刪
            cleanOpts: { keepText: '.content' },
            beforePage: function(pageE) {
                // 正文尾端的功能列（添加書籤／返回目錄／分享）每章都有，不移除就會逐章重複堆疊
                pageE.forEach(function(el) {
                    el.querySelectorAll('.div_feedback, .social_share_frame, .txtad').forEach(function(n) { n.remove(); });
                });
            },
            afterPage: function() {
                // 站方以 inline color 控制配色：正文 <p> 的 color 由伺服器輸出，但章節標題
                // <h1> 的 color 是客戶端 JS 載入後才補上的，XHR 取得的新頁沒有，插入的標題
                // 會掉回站方 CSS 預設色，與首章不一致。
                var h1s = getAll('.frame_body > .title h1');
                var titleColor = h1s.length ? h1s[0].style.color : '';
                if (titleColor) {
                    for (var i = 1; i < h1s.length; i++) h1s[i].style.color = titleColor;
                }
                // 使用者切換配色後才插入的章節，正文仍是伺服器預設色，一併同步
                var bodies = getAll('.frame_body > .content:not(:has(.next_page))');
                var firstP = bodies.length ? bodies[0].querySelector('p') : null;
                var textColor = firstP ? firstP.style.color : '';
                if (!textColor) return;
                for (var j = 1; j < bodies.length; j++) {
                    if (bodies[j].dataset.apColorSynced === textColor) continue;
                    bodies[j].querySelectorAll('p').forEach(function(p) { p.style.color = textColor; });
                    bodies[j].dataset.apColorSynced = textColor;
                }
            }
        },
        twkan: {
            // 台灣小說網（與 69shuba 同模板：.txtnav 章節區塊、.page1 上下章導航）
            host: 'twkan.com',
            url: /^\/txt\/\d+\/\d+/,
            // 正文中夾的文字廣告與版位（皆為 script + ins/div 的空殼）
            style: '.txtad, .txtcenter, ins.pubadx-slot {display:none!important}',
            pager: {
                // 末章的「下一章」指向完本頁 end.html，:not 排除之 → nextL 落空即乾淨停止；
                // [href*="/txt/"] 另擋掉導航列缺「下一章」時 last-child 落到「目錄」的情況
                nextL: '.page1 a:last-child[href*="/txt/"]:not([href*="end.html"])',
                // .txtnav 一塊涵蓋 h1 章節標題、.txtinfo 章節資訊與正文
                pageE: '.txtnav',
                replaceE: '.page1',
                scrollD: 2000
            }
            // 正文是純文字節點 + <br>，不是 <p>，不會被推廣關鍵字規則掃到，故不需 cleanOpts
        },
        novelstw: {
            // 繁體小說（novels.com.tw）：一章拆成多頁（206331926.html → _2.html → _3.html），
            // 正文加密下發，見 novelsTwDecrypt()
            host: 'novels.com.tw',
            url: /^\/novels\/[^\/]+\/\d+(_\d+)?\.html/,
            // 首頁正文中夾的廣告版位（插入的頁面由 cleanContent 清掉）
            style: '#article ins, #article iframe, #article [id^="div-gpt-ad"], #article [id^="div-tam-ad"], #mys-wrapper {display:none!important}',
            pager: {
                // 末章末頁的「沒有了」指回書頁（/ 結尾），[href$=".html"] 排除之 → nextL 落空即乾淨停止
                nextL: 'a#next_url[href$=".html"]',
                // .text_title 含 h1（「第N章 …（2 / 3）」）與書名作者資訊列，#article 是正文
                pageE: '.section_style > .text_title, #article',
                replaceE: '.read_nav',
                scrollD: 2000
            },
            // 正文一句一個 <p>，keepText 防推廣關鍵字誤刪
            cleanOpts: { keepText: '#article' },
            beforePage: function(pageE) {
                // 書名／作者／字數資訊列每頁都有，只留首頁那份
                pageE.forEach(function(el) { getAllCSS('.text_info', el).forEach(function(n) { n.remove(); }); });
                // beforePage 在 cleanContent 之前執行，裝著密文的 <script> 此時還在
                novelsTwDecrypt(pageE);
            }
        },
        oop: {
            // oop.tw（短篇小說）：一章拆成多頁（a22487a.html → a22487_2a.html），
            // 章內「下一頁」與跨章「下一章」都是 #next_url
            host: 'oop.tw',
            url: /^\/areada\/[^\/]+\/a\d+(_\d+)?a\.html/,
            // 首頁正文中夾的廣告版位（插入的頁面由 cleanContent 清掉）；
            // 首頁 h1 靠 .chapter-header 置中，插入的 h1 不在其內，故統一指定置中；
            // 大螢幕上正文區塊會撐滿整個寬度、文字全擠在左側，故限寬 40em（約 40 字一行）並水平置中
            style: '#article .mid-content-ad, #article [id^="onead"], #article ins, #article iframe, .ss-vip-ad {display:none!important} h1.chapter-title {text-align:center!important} #article {max-width:40em; margin-left:auto!important; margin-right:auto!important}',
            pager: {
                // 末章末頁的「沒有了」指回書頁（/ 結尾），[href$=".html"] 排除之 → nextL 落空即乾淨停止
                nextL: 'a#next_url[href$=".html"]',
                // h1 只有章號（同章各頁相同），「第N章 標題」在 #article 第一段
                pageE: 'h1.chapter-title, #article',
                replaceE: '.reading-nav',
                scrollD: 2000
            },
            // 正文一句一個 <p>，keepText 防推廣關鍵字誤刪
            cleanOpts: { keepText: '#article' },
            // 倒序段落轉正、推廣句移除、同章續頁接回切開的段落，見 oopFix()
            beforePage: function(pageE) { oopFix(pageE); }
        }
        // thepaperbooks（8book 系小說站）：真實內文由站方混淆 script 在瀏覽器
        // 渲染（伺服器對非瀏覽器請求偽裝成關鍵字農場頁），需要 iframe 擷取
        // （桌面版 type 6）。本引擎僅支援 XHR 模式，暫不支援此站。
    };

    // ========== 規則匹配 ==========

    var curSite = null, matchedKey = '';
    // 翻頁閘門由兩個獨立旗標組成，不可再合併為一個：
    //   userPaused — 使用者意圖（頁碼按鈕點擊切換），只有使用者能改
    //   pagerBusy  — 機器狀態（interval 節流窗），只有流程能改
    // 兩者混用時，節流計時器會擦掉使用者的暫停、使用者點擊也會解開機器鎖。
    var userPaused = false;
    var pagerBusy = false;
    var pageNum = 1;

    function matchRule() {
        var host = location.hostname;
        var path = location.pathname + location.search;
        for (var key in rules) {
            var rule = rules[key];
            // host 支援字串或陣列（同一平台多網域，如 ixdzs 三站）
            var hosts = Array.isArray(rule.host) ? rule.host : [rule.host];
            var hostOk = hosts.some(function(h) { return host === h || host.indexOf('.' + h) !== -1; });
            if (!hostOk) continue;
            if (rule.url && !rule.url.test(path)) continue;
            curSite = rule;
            curSite.pageUrl = '';
            matchedKey = key;
            console.info('[MyAutoPager] 匹配:', key);
            return;
        }
    }

    // ========== 禁用管理（GM.getValue/setValue） ==========

    var disabledKey = 'disabled_' + location.hostname;

    async function isDisabled() {
        try { return await GM.getValue(disabledKey, false); } catch (e) { return false; }
    }

    async function toggleDisable() {
        try {
            var current = await GM.getValue(disabledKey, false);
            await GM.setValue(disabledKey, !current);
            location.reload();
        } catch (e) {}
    }

    // ========== 翻頁引擎 ==========

    function getNextUrl() {
        // 支援函數形式的 nextL（不依賴 live DOM 的站點，如 thepaperbooks）
        if (typeof curSite.pager.nextL === 'function') {
            var u = '';
            try { u = curSite.pager.nextL() || ''; } catch (e) {}
            return (u && u.slice(0, 4) === 'http' && u !== curSite.pageUrl) ? u : '';
        }
        var next = getOne(curSite.pager.nextL);
        if (!next || !next.href || next.href.slice(0, 4) !== 'http') return '';
        if (next.getAttribute('href')[0] === '#') return '';
        return next.href === curSite.pageUrl ? '' : next.href;
    }


    // 失敗時務必解除去重標記：getNextUrl() 以 curSite.pageUrl 判斷「這個
    // URL 抓過了」，不清就等於把它永久標記成已抓，翻頁從此停擺（桌面版
    // onXhrError 早已有同樣處理）。延遲後才清，避免固定失敗的 URL 密集重試。
    // quiet：呼叫端已經顯示更具體的提示時，不要再用通用訊息蓋掉它
    function releaseUrl(url, why, quiet) {
        console.log('[MyAutoPager] 載入失敗（' + why + '）:', url);
        if (!quiet) {
            apNotice('下一頁失敗（' + why + '），' + Math.round(((curSite.pager && curSite.pager.retry) || 3000) / 1000) +
                     ' 秒後可再滾動重試', 10000);
        }
        setTimeout(function() {
            if (curSite && curSite.pageUrl === url) curSite.pageUrl = '';
        }, (curSite.pager && curSite.pager.retry) || 3000);
    }

    // 把 GM_xmlhttpRequest 的回應轉成 HTML 字串。
    // 各家 userscript 管理器對 responseType 的支援差異很大：Safari 的
    // Userscripts App 常無視 'arraybuffer' 而直接給字串，此時
    // TextDecoder.decode() 會拋 TypeError，整頁內容就靜默消失。
    // 所以這裡對「實際拿到什麼」照單全收，真的拿不到才回空字串。
    function respToHtml(resp) {
        if (!resp) return '';
        var body = resp.response;
        if (typeof body === 'string' && body) return body;
        if (body && (body instanceof ArrayBuffer || body.buffer instanceof ArrayBuffer)) {
            try {
                return new TextDecoder(document.characterSet || 'utf-8').decode(body);
            } catch (e) { /* 落到 responseText */ }
        }
        if (typeof resp.responseText === 'string' && resp.responseText) return resp.responseText;
        return '';
    }

    function fetchNextPage(url) {
        curSite.pageUrl = url;

        // 同源一律走原生 XHR。原生請求由頁面 context 發出，帶得到站方用 JS
        // 設的第一方 cookie（novel543 系的 web-id）；GM_xmlhttpRequest 由
        // userscript App 端發出、用不同的 cookie jar，該站因此只回一段 JS
        // 轉向殼層（無 .chapter-content），症狀就是「取到回應但插不進去、
        // 內容元素 0 個」。桌面版早就為此在 Chrome 偏好原生 XHR，iPhone 版
        // 之前沒跟上，這是本站在 iPhone 上載不到下一篇的真正原因。
        if (!isCrossOrigin(url)) {
            nativeFetchNextPage(url);
            return;
        }

        // 跨域才需要 GM_xmlhttpRequest（原生會被 CORS 擋）
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                url: url,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml' },
                timeout: 8000,
                onload: function(resp) {
                    var html = respToHtml(resp);
                    if (!html) {
                        // 管理器沒給可用內容（例如無視 responseType）→ 改用
                        // 原生 XHR 死馬當活馬醫；跨域會被 CORS 擋，但至少
                        // 會走到 releaseUrl 而不是靜默卡死。
                        console.log('[MyAutoPager] GM 回應無法解讀，改用原生 XHR:', url);
                        apNotice('GM 回應無法解讀，改用原生 XHR 重試', 6000);
                        nativeFetchNextPage(url);
                        return;
                    }
                    try { processElements(createDoc(html)); }
                    catch (e) {
                        console.error('[MyAutoPager] 處理錯誤:', e);
                        releaseUrl(url, '處理錯誤');
                    }
                },
                onerror: function() { releaseUrl(url, 'GM onerror'); },
                ontimeout: function() { releaseUrl(url, 'GM 逾時'); }
            });
        } else {
            nativeFetchNextPage(url);
        }
    }

    // 原生 XMLHttpRequest 路徑：同源的主要路徑（帶得到第一方 cookie），
    // 同時作為 GM 回應不可用時的退路
    function nativeFetchNextPage(url) {
        curSite.pageUrl = url;
        var xhr = new XMLHttpRequest();
        try { xhr.open('GET', url, true); }
        catch (e) { releaseUrl(url, 'XHR open'); return; }
        try { xhr.overrideMimeType('text/html; charset=' + (document.characterSet || 'utf-8')); } catch (e) {}
        xhr.timeout = 8000;
        xhr.onload = function() {
            if (xhr.status && (xhr.status < 200 || xhr.status >= 400)) {
                releaseUrl(url, 'HTTP ' + xhr.status);
                return;
            }
            if (!xhr.responseText) { releaseUrl(url, '空回應'); return; }
            try { processElements(createDoc(xhr.responseText)); }
            catch (e) {
                console.error('[MyAutoPager] 處理錯誤:', e);
                releaseUrl(url, '處理錯誤');
            }
        };
        xhr.onerror = function() { releaseUrl(url, 'XHR error'); };
        xhr.ontimeout = function() { releaseUrl(url, 'XHR 逾時'); };
        xhr.send();
    }

    function processElements(response) {
        var insertP = curSite.pager.insertP || [curSite.pager.pageE, 5];
        var pageE = getAll(curSite.pager.pageE, response, response);
        var toE = (insertP[1] === 5) ? toE5pop(getAll(insertP[0])) : getOne(insertP[0]);

        if (pageE.length > 0 && toE) {
            if (curSite.beforePage) curSite.beforePage(pageE);
            cleanContent(pageE, curSite.cleanOpts);

            var addTo = (function(n) {
                switch(n) { case 1: return 'beforebegin'; case 2: return 'afterbegin'; case 3: case 6: return 'beforeend'; default: return 'afterend'; }
            })(insertP[1]);

            if (insertP[1] === 6) {
                var html = '';
                pageE.forEach(function(one) { html += one.innerHTML; });
                toE.insertAdjacentHTML(addTo, html);
            } else {
                if (insertP[1] === 2 || insertP[1] === 4 || insertP[1] === 5) pageE.reverse();
                pageE.forEach(function(one) { toE.insertAdjacentElement(addTo, one); });
            }

            pageNum++;
            updatePageNumber();

            // 更新瀏覽器歷史
            try {
                var titleEl = response.querySelector('title');
                var title = titleEl ? titleEl.textContent : document.title;
                history.pushState(null, title, curSite.pageUrl);
                document.title = title;
            } catch (e) {}

            // 替換導航
            if (curSite.pager.replaceE) {
                var oldE = getAll(curSite.pager.replaceE);
                var newE = getAll(curSite.pager.replaceE, response, response);
                if (oldE.length === newE.length) {
                    for (var i = 0; i < oldE.length; i++) oldE[i].outerHTML = newE[i].outerHTML;
                }
            }

            // 清理所有章節（含原始頁）
            cleanContent(getAll(curSite.pager.pageE), curSite.cleanOpts);

            noNextNotified = false;
            if (curSite.afterPage) curSite.afterPage();
            // 新頁插入後補標背景祖先（CSS 本來就涵蓋新節點，這裡主要是重新標記）
            applyReadingStyle();
        } else {
            // 取到回應卻插不進去。最常見原因是伺服器對 XHR 回的不是真正的
            // 章節頁（例如先回一段 JS 轉向殼層），於是 pageE 抓不到任何元素。
            // 原本只有規則設了 retry 才清 pageUrl，而 novel543 等規則沒設，
            // 等於插入失敗一次就把該 URL 永久標記成已抓，翻頁從此停擺。
            var raw = (response && response.documentElement) ? response.documentElement.innerHTML.length : 0;
            console.error('[MyAutoPager] 插入失敗：pageE=' + pageE.length + ' 插入點=' + !!toE + ' 回應長度=' + raw);
            apNotice('取到回應但插不進去：內容元素 ' + pageE.length + ' 個、插入點 ' +
                     (toE ? '有' : '無') + '、回應 ' + raw + ' 字。內容元素為 0 代表伺服器回的不是章節頁。', 15000);
            releaseUrl(curSite.pageUrl, '插入失敗', true);
        }
    }

    // ========== 頁碼按鈕（觸控優化） ==========

    var pageNumBtn = null;

    function createPageNumber() {
        var host = document.createElement('div');
        host.id = 'Autopage_number';
        host.style.cssText = 'display:flex!important;position:fixed!important;z-index:9999998!important';
        document.documentElement.appendChild(host);

        var shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML =
            '<style>' +
            // #btn 與 #rs 共用外觀，只差垂直位置
            '#btn,#rs{' +
                'left:0;' +
                'width:36px;height:36px;padding:8px;' +
                'display:flex;position:fixed;' +
                'opacity:0.4;transition:.2s;z-index:9999998;' +
                'cursor:pointer;user-select:none;' +
                'flex-direction:column;align-items:center;justify-content:center;' +
                'box-sizing:content-box;border-radius:0 50% 50% 0;' +
                'transform-origin:center;transform:translateX(-10px);' +
                'background-color:#eee;' +
                '-webkit-tap-highlight-color:transparent;' +
                'box-shadow:1px 1px 3px 0px #aaa;' +
                'color:#000;font-size:16px;font-family:system-ui;' +
                'touch-action:manipulation;' +
            '}' +
            '#btn{top:calc(80vh)}' +
            // 垂直間距取 56px 而非規格的 48px：#btn 實高 52px（36 + padding 8×2，content-box），
            // 48px 會和它重疊 4px
            '#rs{top:calc(80vh + 56px)}' +
            '#btn:active,#rs:active{opacity:0.9;transform:translateX(0)}' +
            // 閱讀樣式面板：貼在 Aa 按鈕右側，預設收起
            '#rsPanel{display:none;position:fixed;left:48px;top:calc(80vh - 40px);z-index:9999998;' +
                'width:208px;box-sizing:border-box;padding:10px;border-radius:12px;' +
                'background:rgba(20,20,20,.92);color:#fff;font:14px/1.5 system-ui;' +
                'box-shadow:0 2px 8px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent}' +
            '#rsPanel .row{display:flex;align-items:center;justify-content:space-between;margin:8px 0}' +
            '#rsPanel button{font:inherit;color:#fff;background:#3a3a3a;border:0;border-radius:8px;' +
                'height:36px;padding:0 10px;cursor:pointer;touch-action:manipulation;' +
                '-webkit-tap-highlight-color:transparent}' +
            '#rsPanel .fbtn{width:56px}' +
            '#rsPanel #rsSize{flex:1;text-align:center;font-size:16px;font-variant-numeric:tabular-nums}' +
            '#rsPanel .rsSw{width:36px;height:36px;padding:0;border-radius:50%;border:1px solid #777}' +
            '#rsPanel #rsAuto{width:64px}' +
            '#rsPanel #rsToggle{flex:1;margin-left:8px}' +
            '#rsPanel .dlb{flex:1}#rsPanel .dlb+.dlb{margin-left:8px}' +
            '</style>' +
            '<div id="btn" role="button" aria-label="頁碼/暫停翻頁">1</div>' +
            '<div id="rs" role="button" aria-label="閱讀樣式">Aa</div>' +
            '<div id="rsPanel" role="dialog" aria-label="閱讀樣式設定">' + rsPanelHtml() + '</div>';

        pageNumBtn = shadow.querySelector('#btn');

        // 單擊＝暫停／恢復翻頁；快速點兩下＝啟動／停止自動捲頁。
        // 第二擊會還原第一擊的暫停切換，所以單擊不需要 debounce、暫停仍是
        // 即時反應，代價只是雙擊時暫停指示會閃一下。
        var lastTapAt = 0, tapPrevPaused = false;
        pageNumBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var now = performance.now();
            if (now - lastTapAt < 320) {
                lastTapAt = 0;
                userPaused = tapPrevPaused;
                paintPauseState(this);
                asToggle();
                return;
            }
            lastTapAt = now;
            tapPrevPaused = userPaused;
            userPaused = !userPaused;
            paintPauseState(this);
        });

        // 長按可禁用當前網站；自動捲頁中在按鈕上垂直滑動可調速
        var holdTimer = null, swipeY = null;
        pageNumBtn.addEventListener('touchstart', function(e) {
            swipeY = (e.touches && e.touches[0]) ? e.touches[0].clientY : null;
            holdTimer = setTimeout(function() {
                if (confirm('要對 ' + location.hostname + ' 禁用自動翻頁嗎？')) toggleDisable();
            }, 1500);
        });
        pageNumBtn.addEventListener('touchend', function() { clearTimeout(holdTimer); swipeY = null; });
        pageNumBtn.addEventListener('touchmove', function(e) {
            clearTimeout(holdTimer);
            if (!autoScroll || swipeY === null) return;
            var y = (e.touches && e.touches[0]) ? e.touches[0].clientY : null;
            if (y === null) return;
            var d = swipeY - y;
            // 上滑加速、下滑減速；每滿 AS_SWIPE px 調一階並重設基準
            if (Math.abs(d) >= AS_SWIPE) {
                asSetSpeed(d > 0 ? AS_STEP : -AS_STEP);
                swipeY = y;
            }
        });

        // 閱讀樣式：Aa 按鈕與面板。click／touch 全部在 shadow root 內攔下，不讓它們落到
        // 雙擊手勢（asInstallPageTap）與正文點擊的路徑上：點 Aa 不能啟動自動捲頁，
        // 也不該被當成一次正文點擊
        rsBtnEl = shadow.querySelector('#rs');
        rsPanelEl = shadow.querySelector('#rsPanel');
        rsRenderPanel();
        rsBtnEl.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            rsSetPanelOpen(!rsPanelOpen);
        });
        rsPanelEl.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            var b = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!b) return;
            var act = b.getAttribute('data-act'), th = b.getAttribute('data-theme');
            if (act === 'dl') { rsSetPanelOpen(false); dlOpenDialog(); }
            else if (act === 'shelf') { rsSetPanelOpen(false); dlOpenReader(); }
            else if (act === 'down') rsSetFont(-READING_FS_STEP);
            else if (act === 'up') rsSetFont(READING_FS_STEP);
            else if (act === 'auto') rsSetAuto();
            else if (act === 'toggle') rsSetOn(!rsOn);
            else if (th) rsSetTheme(th);
        });
        ['touchstart', 'touchend'].forEach(function(n) {
            rsBtnEl.addEventListener(n, function(e) { e.stopPropagation(); });
            rsPanelEl.addEventListener(n, function(e) { e.stopPropagation(); });
        });
        // 點面板外（含頁碼鈕與正文）就收起。用 capture 階段：正文的 click 若已被別處
        // stopPropagation，冒泡階段就看不到了
        document.addEventListener('click', function(e) {
            if (!rsPanelOpen) return;
            var path = (e.composedPath && e.composedPath()) || [];
            if (path.indexOf(rsPanelEl) !== -1 || path.indexOf(rsBtnEl) !== -1) return;
            rsSetPanelOpen(false);
        }, true);
    }

    function updatePageNumber() {
        if (pageNumBtn) pageNumBtn.textContent = pageNum;
    }

    // ========== 自動捲頁 ==========
    // 與翻頁解耦：本模組只負責平滑捲動。捲動產生的 scroll 事件照常餵給
    // startScrollWatch 的閘門，所以捲到頁底時會自然接續既有的無縫翻頁。

    var AS_KEY = 'autoScrollSpeed';
    var AS_MIN = 10, AS_MAX = 200, AS_STEP = 10, AS_SWIPE = 24, AS_IDLE_STOP = 30000;
    var AS_TAP_MS = 350, AS_TAP_DIST = 20;
    var autoScroll = false, asSpeed = 40, asRaf = null, asLastTs = 0, asAcc = 0,
        asIdleMs = 0, asLastY = -1, asLastH = -1;

    function asClampSpeed(v) {
        v = parseInt(v, 10);
        if (isNaN(v)) return 40;
        return v < AS_MIN ? AS_MIN : (v > AS_MAX ? AS_MAX : v);
    }

    function asLoadSpeed() {
        try {
            return GM.getValue(AS_KEY, 40).then(function(v) { asSpeed = asClampSpeed(v); })
                .catch(function() {});
        } catch (e) { return Promise.resolve(); }
    }

    function asSaveSpeed() { try { GM.setValue(AS_KEY, asSpeed); } catch (e) {} }

    // 只動 backgroundColor，避免與暫停指示（color / fontStyle）互相蓋掉
    function asIndicate() {
        if (!pageNumBtn) return;
        pageNumBtn.style.backgroundColor = autoScroll ? '#A5D6A7' : '';
    }

    function paintPauseState(btn) {
        btn.style.color = userPaused ? '#FF5722' : '';
        btn.style.fontStyle = userPaused ? 'italic' : '';
    }

    function asStep(ts) {
        if (!autoScroll) { asRaf = null; return; }
        if (!asLastTs) asLastTs = ts;
        var dt = ts - asLastTs;
        asLastTs = ts;
        // 分頁切回前景或長時間停頓（rAF 在背景分頁被凍結）：丟棄該幀的位移，
        // 否則會一次跳掉一大段
        if (dt < 0 || dt > 250) dt = 0;

        // 亞像素累積：低速時仍平順，不用 setInterval + scrollBy(0,1) 那種抖動做法
        asAcc += asSpeed * dt / 1000;
        var px = Math.floor(asAcc);
        if (px >= 1) { asAcc -= px; window.scrollBy(0, px); }

        // 停滯＝位置與文件高度都不變（既沒捲動、也沒有新內容進來）。
        // 只看位置無法區分「在頁底等下一頁」和「讀完了」，但下一頁落地時
        // scrollHeight 會變，所以加上高度就能讓等待中的抓取繼續延命。
        // 門檻取 30 秒，遠大於本引擎 GM_xmlhttpRequest 的 8 秒逾時與重試
        // 延遲，免得把慢速網路誤判成讀完。y 取整：頁面縮放下 pageYOffset
        // 可能帶小數，逐幀抖動會讓計時永遠歸零、rAF 在書末永久空轉。
        var y = Math.round(window.pageYOffset || document.documentElement.scrollTop || 0);
        var h = document.documentElement.scrollHeight;
        if (y === asLastY && h === asLastH) {
            asIdleMs += dt;
            if (asIdleMs >= AS_IDLE_STOP) { asStop('停滯 ' + (AS_IDLE_STOP / 1000) + ' 秒'); return; }
        } else { asIdleMs = 0; asLastY = y; asLastH = h; }

        asRaf = requestAnimationFrame(asStep);
    }

    function asStart() {
        if (autoScroll) return;
        autoScroll = true;
        asLastTs = 0; asAcc = 0; asIdleMs = 0; asLastY = -1; asLastH = -1;
        asIndicate();
        console.info('[MyAutoPager] 自動捲頁開始：' + asSpeed + ' px/秒');
        asRaf = requestAnimationFrame(asStep);
    }

    function asStop(reason) {
        if (!autoScroll) return;
        autoScroll = false;
        if (asRaf) { cancelAnimationFrame(asRaf); asRaf = null; }
        asIndicate();
        console.info('[MyAutoPager] 自動捲頁停止' + (reason ? '：' + reason : ''));
    }

    function asToggle() { autoScroll ? asStop('使用者') : asStart(); }

    function asSetSpeed(delta) {
        var v = asClampSpeed(asSpeed + delta);
        if (v === asSpeed) return;
        asSpeed = v;
        asSaveSpeed();
        console.info('[MyAutoPager] 自動捲頁速度：' + asSpeed + ' px/秒');
    }

    // 手動捲動（拖動／滾輪）刻意不再停止自動捲頁：使用者拖到想看的位置後，
    // 捲動會從新位置繼續。停止方式是再點兩下。
    function asInstallInterrupt() {
        window.addEventListener('keydown', function(e) {
            if (autoScroll && e.key === 'Escape') asStop('Esc');
        }, true);
    }

    // 互動元素不當手勢起點：小說站正文裡常夾廣告錨點，雙擊等於連點兩次，
    // 我們至少不把它認成啟動手勢。
    // 刻意不再列入 [onclick]：廣告腳本會把 onclick 掛在包住整段正文的容器上，
    // 一併排除等於整片正文都無法雙擊 —— 這是「點兩下沒反應」的主因之一。
    // inline 事件已由 apDefuse 全頁拔除，這裡只要認真正的控制項。
    function asIsInteractive(t) {
        if (!t || t.nodeType !== 1 || !t.closest) return false;
        if (t.closest('button,input,select,textarea,label,summary,[role="button"],[contenteditable]')) return true;
        var a = t.closest('a');
        // 已被拆彈的錨點（href 被拔掉）不算互動元素，否則廣告錨點照樣擋住手勢
        return !!(a && a.getAttribute('href') && !a.hasAttribute('data-blocked-href'));
    }

    // 判斷這一擊是否落在既有的選取範圍上
    function asPointInSelection(x, y) {
        try {
            var s = window.getSelection();
            if (!s || s.isCollapsed || !s.rangeCount) return false;
            var rects = s.getRangeAt(0).getClientRects();
            for (var i = 0; i < rects.length; i++) {
                var r = rects[i];
                if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return true;
            }
        } catch (e) {}
        return false;
    }

    // 手勢命中後，吞掉這一擊接下來的所有事件。
    // 不這樣做的話，「點兩下開始自動捲動」同時也是在正文上實實在在點了兩下，
    // 底下只要壓著廣告錨點或 click 劫持就會開新分頁 —— 正是使用者回報的
    // 「點擊兩次跳出廣告分頁」。
    function asSwallowTap() {
        var evts = ['click', 'auxclick', 'mousedown', 'mouseup', 'pointerup', 'touchend'];
        var done = false;
        function teardown() {
            if (done) return;
            done = true;
            evts.forEach(function(n) { document.removeEventListener(n, kill, true); });
        }
        function kill(ev) {
            try {
                ev.preventDefault();
                ev.stopPropagation();
                ev.stopImmediatePropagation();
            } catch (e) {}
            if (ev.type === 'click') teardown();
        }
        evts.forEach(function(n) {
            // touchend 等在 Safari 可能被當成 passive，明寫 passive:false 才能 preventDefault
            document.addEventListener(n, kill, { capture: true, passive: false });
        });
        setTimeout(teardown, 700);
    }

    // 頁面任意處點兩下＝啟動／停止自動捲頁。
    // 自行以 pointerdown 計時而非監聽 dblclick，才能同時覆蓋觸控與滑鼠，
    // 且不必攔截第一擊的預設行為（選字、點連結都照常）。
    function asInstallPageTap() {
        var lastT = 0, lastX = 0, lastY = 0;

        function onDown(x, y, target, ev) {
            // 腳本自身 UI 有自己的處理器（含調速手勢）
            if (target && target.nodeType === 1 && target.closest && target.closest('#Autopage_number')) return;
            // 點在真正的控制項上：忽略這一擊，但不重設計時 —— 先前會歸零，
            // 於是正文夾雜廣告錨點時常常要點三、四下才會啟動
            if (asIsInteractive(target)) return;

            var now = performance.now();
            if (now - lastT < AS_TAP_MS &&
                Math.abs(x - lastX) < AS_TAP_DIST &&
                Math.abs(y - lastY) < AS_TAP_DIST) {
                lastT = 0;
                // 正在選字時不搶手勢。只在這一擊真的落在選取範圍上才讓開：
                // 先前是「頁面上有任何反白就放棄」，殘留的反白會讓雙擊永遠失效。
                if (asPointInSelection(x, y)) return;
                try { if (ev && ev.cancelable) ev.preventDefault(); } catch (err) {}
                asSwallowTap();
                asToggle();
                return;
            }
            lastT = now; lastX = x; lastY = y;
        }

        if (window.PointerEvent) {
            document.addEventListener('pointerdown', function(e) {
                if (e.isPrimary === false) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                onDown(e.clientX, e.clientY, e.target, e);
            }, { capture: true, passive: false });
        } else {
            // 舊版 Safari / Userscripts 沒有 Pointer Events 時的退路
            document.addEventListener('touchstart', function(e) {
                if (!e.touches || e.touches.length !== 1) return;
                var t = e.touches[0];
                onDown(t.clientX, t.clientY, e.target, e);
            }, { capture: true, passive: false });
        }

        // 雙擊在 iOS Safari 原生是「放大」，不抑制的話會同時縮放頁面。
        // manipulation 只關掉雙擊放大，pinch 縮放不受影響。
        insStyle('body {touch-action: manipulation;}');
    }

    // ========== 滾動偵測 ==========

    function startScrollWatch() {
        var scrollD = curSite.pager.scrollD || 2000;
        var interval = curSite.pager.interval || 500;
        var prevST = 0;

        setTimeout(function() {
            // 內容太少時撐高頁面
            if (document.documentElement.scrollHeight <= window.innerHeight) {
                insStyle('html,body{min-height:' + (window.innerHeight + 10) + 'px}');
            }

            window.addEventListener('scroll', function() {
                var st = window.pageYOffset || document.documentElement.scrollTop || 0;
                if (st <= prevST || userPaused || pagerBusy) { prevST = st; return; }
                prevST = st;

                var vh = window.innerHeight;
                var docH = document.documentElement.scrollHeight;
                // 觸發基準：正文底部，而非整頁底部。小說站正文下方常有很長的推薦書單、留言區
                // （如 oop.tw），以頁底為準時讀完正文還得再捲一大段才會載入下一章。
                // scrollE 指定基準元素，未指定時以 pageE 最後一個元素（畫面上最後一段正文）為準
                var baseSel = curSite.pager.scrollE || curSite.pager.pageE, baseAll = [];
                try { baseAll = getAll(baseSel); } catch (e) {}
                var baseE = baseAll[baseAll.length - 1];
                var dist = baseE ? baseE.getBoundingClientRect().bottom - vh : docH - (vh + st);

                if (dist <= scrollD) {
                    pagerBusy = true;
                    setTimeout(function() { pagerBusy = false; }, interval);
                    var url = getNextUrl();
                    if (url) {
                        fetchNextPage(url);
                    } else if (!noNextNotified) {
                        // 到了觸發線卻找不到下一頁連結。滾動事件每秒數十次，
                        // 所以只提示一次，成功插入後才重新武裝（processElements）。
                        noNextNotified = true;
                        console.warn('[MyAutoPager] 找不到下一頁連結，nextL:', curSite.pager.nextL);
                        apNotice('找不到「下一章」連結：可能已是最後一頁，或規則的 nextL 沒命中', 12000);
                    }
                }
            }, { passive: true });
        }, 1000);
    }

    // ========== 閱讀樣式（Part B，預設開啟） ==========
    // 只在命中規則時啟用（curSite 非 null）。站方正文常帶 inline color／font-size，
    // 一般樣式表蓋不過，所以這裡的規則一律 !important（!important 的樣式表規則會
    // 贏過非 important 的 inline style）。主題表與桌面版完全相同，改色請兩邊一起改。
    var READING_THEMES = {
        paper: { name: '米黃', bg: '#f6f1e3', fg: '#2b2b2b' },
        white: { name: '純白', bg: '#ffffff', fg: '#222222' },
        green: { name: '護眼綠', bg: '#cce8cf', fg: '#1f2d1f' },
        night: { name: '夜間', bg: '#1e1e1e', fg: '#c8c8c8' }
    };
    var READING_THEME_ORDER = ['paper', 'white', 'green', 'night'];
    var READING_FS_MIN = 14, READING_FS_MAX = 60, READING_FS_STEP = 2, READING_FS_DEFAULT = 20;
    // 行高固定，不提供 UI、也不存設定
    var READING_LINE_HEIGHT = 1.8;
    var RS_KEY_ON = 'readingStyleOn', RS_KEY_FS = 'readingFontSize', RS_KEY_THEME = 'readingTheme',
        RS_KEY_AUTO = 'readingFontAuto';

    // rsFontAuto：字級依視窗寬度自動決定（預設）；按過 A−／A+ 就改用手動的 rsFontSize
    var rsOn = true, rsFontSize = READING_FS_DEFAULT, rsFontAuto = true, rsTheme = 'night';
    var rsLastAutoSize = 0;

    // 自動字級：同一個字級在手機上太大、在大螢幕上又太小，所以依視窗寬度分三段。
    // 斷點與桌面版相同（iPhone 直式 < 480 → 18，橫式／iPad → 20）
    function rsAutoFontSize() {
        var w = window.innerWidth || document.documentElement.clientWidth || 390;
        return w < 480 ? 18 : (w < 1600 ? 20 : 22);
    }

    function rsEffectiveFontSize() {
        return rsFontAuto ? rsAutoFontSize() : rsFontSize;
    }
    // 使用者在儲存值讀回來之前已經改過的欄位：讀取完成時不覆蓋它
    var rsTouched = {};
    var rsBtnEl = null, rsPanelEl = null, rsPanelOpen = false;

    function rsClampFont(v) {
        v = parseInt(v, 10);
        if (isNaN(v)) return READING_FS_DEFAULT;
        return v < READING_FS_MIN ? READING_FS_MIN : (v > READING_FS_MAX ? READING_FS_MAX : v);
    }

    function rsValidTheme(name) {
        return (typeof name === 'string' && Object.prototype.hasOwnProperty.call(READING_THEMES, name)) ? name : 'night';
    }

    // 比照 asLoadSpeed／asSaveSpeed 的 GM.getValue／GM.setValue Promise 寫法。
    // 讀取完成前已用預設值套過，這裡讀到值後再套一次，頁面不必等 storage。
    function rsLoadSettings() {
        try {
            return Promise.all([
                GM.getValue(RS_KEY_ON, true),
                GM.getValue(RS_KEY_FS, READING_FS_DEFAULT),
                GM.getValue(RS_KEY_THEME, 'night'),   // 預設夜間
                GM.getValue(RS_KEY_AUTO, true)
            ]).then(function(v) {
                if (!rsTouched.on) rsOn = v[0] !== false;
                if (!rsTouched.fs) { rsFontSize = rsClampFont(v[1]); rsFontAuto = v[3] !== false; }
                if (!rsTouched.theme) rsTheme = rsValidTheme(v[2]);
                applyReadingStyle();
                rsRenderPanel();
            }).catch(function() {});
        } catch (e) { return Promise.resolve(); }
    }

    // 每個欄位各自寫入，不整組覆寫：若讀取還沒完成，整組寫回會把別的欄位洗回預設值
    function rsSave(key, value) {
        try { Promise.resolve(GM.setValue(key, value)).catch(function() {}); } catch (e) {}
    }

    // 套用閱讀樣式。同一個 <style id="ap-reading-style"> 反覆更新，不重複插入。
    // 翻頁後正文節點會換新，所以每次都重新標記背景，並先清掉舊標記，免得殘留的祖先被誤染色。
    function applyReadingStyle() {
        try {
            var t = READING_THEMES[rsTheme] || READING_THEMES.paper;
            var on = !!(rsOn && curSite);
            var sel = (on && curSite.pager && typeof curSite.pager.pageE === 'string') ? curSite.pager.pageE : '';
            var css = '';
            getAllCSS('[data-ap-bg]').forEach(function(n) { n.removeAttribute('data-ap-bg'); });
            if (on) {
                // XPath 規則（以 / 或 ( 開頭）寫不出可靠的 CSS 選擇器，只套背景
                // :is() 包住整串選擇器（與桌面版一致）：不必自己切逗號，選擇器內的
                // :not(:has(a, b)) 不會被切壞；:is() 是容錯清單，其中一段寫壞也不會整條失效
                var sels = (!sel.trim() || /^[\/(]/.test(sel.trim())) ? [] : [':is(' + sel.trim() + ')'];
                css += 'html, body { background: ' + t.bg + ' !important; }\n' +
                       '[data-ap-bg] { background: ' + t.bg + ' !important; }\n';
                var fs = rsEffectiveFontSize();
                rsLastAutoSize = rsAutoFontSize();
                sels.forEach(function(s) {
                    css += s + ', ' + s + ' * { color: ' + t.fg + ' !important; font-size: ' + fs +
                           'px !important; line-height: ' + READING_LINE_HEIGHT +
                           ' !important; background-color: transparent !important; }\n' +
                           s + ' :is(h1,h2,h3), ' + s + ':is(h1,h2,h3) { font-size: ' +
                           Math.round(fs * 1.3) + 'px !important; }\n';
                });
                // 正文元素本身改成透明，底色改由它的祖先（標成 data-ap-bg）畫出來
                try {
                    var first = sel ? getAll(sel)[0] : null;
                    for (var n = first ? first.parentElement : null;
                         n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
                        n.setAttribute('data-ap-bg', '1');
                    }
                } catch (e) {}
            }
            var el = document.getElementById('ap-reading-style');
            if (!el) {
                el = document.createElement('style');
                el.id = 'ap-reading-style';
                (document.head || document.documentElement).appendChild(el);
            }
            el.textContent = css;
        } catch (e) {}
    }

    // 面板的字級、主題外框與切換鈕文字隨設定即時更新（面板還沒建立時只更新 Aa 按鈕的狀態）
    function rsRenderPanel() {
        if (rsBtnEl) rsBtnEl.style.color = rsOn ? '' : '#888';
        if (!rsPanelEl) return;
        var size = rsPanelEl.querySelector('#rsSize');
        if (size) size.textContent = rsEffectiveFontSize();
        var autoBtn = rsPanelEl.querySelector('#rsAuto');
        if (autoBtn) {
            autoBtn.style.outline = rsFontAuto ? '2px solid #FF9800' : '';
            autoBtn.style.outlineOffset = rsFontAuto ? '-2px' : '';
        }
        var sws = rsPanelEl.querySelectorAll('.rsSw');
        for (var i = 0; i < sws.length; i++) {
            var cur = sws[i].getAttribute('data-theme') === rsTheme;
            sws[i].style.outline = cur ? '2px solid #FF9800' : '';
            sws[i].style.outlineOffset = cur ? '2px' : '';
        }
        var tg = rsPanelEl.querySelector('#rsToggle');
        if (tg) tg.textContent = rsOn ? '改用原網站' : '套用閱讀樣式';
    }

    function rsSetPanelOpen(open) {
        rsPanelOpen = !!open;
        if (rsPanelEl) rsPanelEl.style.display = rsPanelOpen ? 'block' : 'none';
    }

    // 所有設定變動的共同出口：套用並更新面板；存檔由各自的 rsSetXxx 負責（只存該欄位）
    function rsChanged(field) {
        rsTouched[field] = true;
        applyReadingStyle();
        rsRenderPanel();
    }

    // A−／A+ 以「目前看到的字級」為起點（自動模式下就是自動值），按下後改為手動
    function rsSetFont(delta) {
        var v = rsClampFont(rsEffectiveFontSize() + delta);
        if (v === rsFontSize && !rsFontAuto) return;
        rsFontSize = v;
        rsFontAuto = false;
        rsSave(RS_KEY_FS, v);
        rsSave(RS_KEY_AUTO, false);
        rsChanged('fs');
    }

    function rsSetAuto() {
        if (rsFontAuto) return;
        rsFontAuto = true;
        rsSave(RS_KEY_AUTO, true);
        rsChanged('fs');
    }

    // 自動字級模式下，旋轉螢幕、分割畫面都會改變寬度；只在跨過斷點時才重套樣式
    var rsResizeInstalled = false, rsResizeRaf = 0;
    function rsInstallResize() {
        if (rsResizeInstalled) return;
        rsResizeInstalled = true;
        window.addEventListener('resize', function() {
            if (rsResizeRaf) return;
            rsResizeRaf = requestAnimationFrame(function() {
                rsResizeRaf = 0;
                if (!rsFontAuto || !rsOn || !curSite) return;
                if (rsAutoFontSize() === rsLastAutoSize) return;
                applyReadingStyle();
                rsRenderPanel();
            });
        });
    }

    function rsSetTheme(name) {
        if (name === rsTheme || !Object.prototype.hasOwnProperty.call(READING_THEMES, name)) return;
        rsTheme = name;
        rsSave(RS_KEY_THEME, name);
        rsChanged('theme');
    }

    function rsSetOn(on) {
        rsOn = !!on;
        rsSave(RS_KEY_ON, rsOn);
        rsChanged('on');
    }

    // 面板內容：A− ／字級 ／ A+、四個主題色塊、原網站切換鈕。樣式寫在 createPageNumber 的 <style>
    function rsPanelHtml() {
        var sw = '';
        READING_THEME_ORDER.forEach(function(k) {
            sw += '<button class="rsSw" data-theme="' + k + '" aria-label="' + READING_THEMES[k].name +
                  '" style="background:' + READING_THEMES[k].bg + '"></button>';
        });
        return '<div class="row">' +
                   '<button class="fbtn" data-act="down" aria-label="字級縮小">A−</button>' +
                   '<span id="rsSize"></span>' +
                   '<button class="fbtn" data-act="up" aria-label="字級放大">A+</button>' +
               '</div>' +
               '<div class="row">' + sw + '</div>' +
               '<div class="row"><button id="rsAuto" data-act="auto" aria-label="依視窗寬度自動決定字級">自動</button>' +
                   '<button id="rsToggle" data-act="toggle"></button></div>' +
               '<div class="row"><button class="dlb" data-act="dl" aria-label="下載到雲端閱讀器">⬇ 下載</button>' +
                   '<button class="dlb" data-act="shelf" aria-label="開啟雲端閱讀器書架">📚 書架</button></div>';
    }

    // 規則命中、DOM 就緒時呼叫：先用預設值套上，讀回儲存值後再套一次
    function rsInit() {
        applyReadingStyle();
        rsLoadSettings();
        rsInstallResize();
    }

    // ========== 下載到雲端閱讀器：iPhone 版平台介面（dlEnv） ==========
    var dlEnv = {
        rule: function() { return curSite; },
        ruleKey: function() { return matchedKey; },
        eligible: function() { return true; },
        // 與翻頁插入時相同的處理：beforePage（站方修正）→ cleanContent（清廣告）
        prepare: function(pageE) {
            if (curSite.beforePage) curSite.beforePage(pageE);
            cleanContent(pageE, curSite.cleanOpts);
            return pageE;
        },
        get: function(k, d) {
            try { return Promise.resolve(GM.getValue(k, d)).catch(function() { return d; }); } catch (e) { return Promise.resolve(d); }
        },
        set: function(k, v) {
            try { return Promise.resolve(GM.setValue(k, v)).catch(function() {}); } catch (e) { return Promise.resolve(); }
        },
        notice: function(msg) { apNotice(msg, 4000); },
        // 隔離世界的 window.open 沒被鎖（鎖只裝在頁面世界），開不了就同分頁前往
        openTab: function(url) {
            var w = null;
            try { w = window.open(url, '_blank'); } catch (e) {}
            if (!w) location.href = url;
        },
        xhr: function(o) {
            return new Promise(function(resolve, reject) {
                GM_xmlhttpRequest({
                    method: o.method, url: o.url, headers: o.headers || {}, data: o.data, timeout: 30000,
                    responseType: o.html ? 'arraybuffer' : undefined,
                    onload: function(r) { resolve({ status: r.status, text: o.html ? respToHtml(r) : (r.responseText || '') }); },
                    onerror: function() { reject(new Error('網路錯誤')); },
                    ontimeout: function() { reject(new Error('逾時')); }
                });
            });
        }
    };

    // ==== dl-shared-begin ====
    // ========== 下載到雲端閱讀器（桌面版與 iPhone 版共用，改這段請兩邊一起改） ==========
    // 手動觸發：從目前這章、或從第一章（整本）開始，沿著規則的 nextL 逐頁抓取，
    // 用規則的 pageE ＋站方 hook 取出正文，轉成純文字、同章分頁合併後分批上傳到
    // reader/ 的 Cloudflare Worker。閱讀與跨裝置進度同步都在那個網頁上，不必再開小說站。
    // static.test.js 會檢查兩個腳本中 dl-shared-begin～end 之間逐字相同；
    // 平台差異（儲存、跨域請求、開分頁、站方 hook）一律透過 dlEnv，由各版本在這段之前定義。
    var DL_KEY_SERVER = 'apdl_server', DL_KEY_TOKEN = 'apdl_token';
    // 節奏：基準間隔 × 隨機 0.8–1.7 × 減速倍率。被限流（403／429／503）時倍率翻倍、最高 8 倍，
    // 之後每順利抓一頁回落 10%；每 40 頁長休息一次。固定間隔太像機器人，也不給站方喘息
    var DL_PAGE_DELAY = 900, DL_SLOW_MAX = 8, DL_REST_EVERY = 40, DL_REST_MS = [15000, 30000];
    var DL_BATCH_MAX = 20, DL_BATCH_CHARS = 300000;
    var DL_RETRY_WAIT = [2000, 5000, 12000];     // 抓頁／上傳失敗的重試間隔
    // 下載中呼叫站方 hook 時為 true：hook 不可改動畫面上的 DOM（oopFix 的同章續頁合併就會）
    var dlHookMode = false;
    var dlJob = null, dlUi = null;

    // 背景分頁的計時器會被瀏覽器節流（Chrome 分頁隱藏 5 分鐘後，連鎖的 setTimeout 約一分鐘才醒一次），
    // 下載就會慢到一分鐘一頁。Dedicated Worker 裡的計時器不受這個限制，所以優先用它計時；
    // 一般的 setTimeout 同時掛著當保底 —— 站方 CSP 擋掉 blob Worker 時照樣會醒（只是在背景會變慢）
    var dlTimer = null, dlTimerSeq = 0, dlTimerCbs = {};
    function dlTimerWorker() {
        if (dlTimer !== null) return dlTimer;
        dlTimer = false;
        try {
            var src = 'onmessage=function(e){setTimeout(function(){postMessage(e.data.id)},e.data.ms)}';
            var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
            w.onmessage = function(e) { var f = dlTimerCbs[e.data]; delete dlTimerCbs[e.data]; if (f) f(); };
            w.onerror = function() { dlTimer = false; };
            dlTimer = w;
        } catch (e) {}
        return dlTimer;
    }
    function dlSleep(ms) {
        return new Promise(function(resolve) {
            var done = false, fin = function() { if (!done) { done = true; resolve(); } };
            setTimeout(fin, ms);
            var w = dlTimerWorker();
            if (w) {
                var id = ++dlTimerSeq;
                dlTimerCbs[id] = fin;
                try { w.postMessage({ id: id, ms: ms }); } catch (e) { delete dlTimerCbs[id]; }
            }
        });
    }

    function dlPace(job) {
        var ms = DL_PAGE_DELAY * (0.8 + Math.random() * 0.9) * (job.slow || 1);
        if (job.pages && job.pages % DL_REST_EVERY === 0) {
            var rest = DL_REST_MS[0] + Math.random() * (DL_REST_MS[1] - DL_REST_MS[0]);
            ms += rest;
            dlStatus('已抓 ' + job.pages + ' 頁，休息 ' + Math.round(rest / 1000) + ' 秒，避免被站方限流…');
        }
        return dlSleep(ms);
    }

    function dlAbsUrl(href, base) {
        if (!href) return '';
        href = String(href).trim();
        if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return '';
        try {
            var u = new URL(href, base);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
            u.hash = '';
            return u.href;
        } catch (e) { return ''; }
    }

    // ---- 書本識別 ----
    function dlNormHost(h) { return String(h || '').toLowerCase().replace(/^(www|m|wap|tw)\./, ''); }

    // 網址「形狀」：數字一律換成 #、去掉同章分頁的 _#。用來在目錄頁挑出章節連結
    function dlShape(u) {
        try { u = new URL(u); } catch (e) { return ''; }
        return u.pathname.replace(/\d+/g, '#').replace(/_#/g, '');
    }

    // 路徑中最後一段數字（章節序號或 id），挑第一章時取最小者
    function dlLastNum(u) {
        try { u = new URL(u); } catch (e) { return Infinity; }
        var m = u.pathname.match(/\d+/g);
        return m ? parseInt(m[m.length - 1], 10) : Infinity;
    }

    var DL_TOC_RE = /^(章節)?目[錄录](列表)?$|^(返回|回到?)(章節)?目[錄录]$|^章節列表$|^全部章節$|^(返回)?書頁$|^(返回)?书页$/;
    function dlFindToc(doc, base) {
        var as = doc.querySelectorAll('a[href]');
        for (var i = 0; i < as.length; i++) {
            var t = as[i].textContent.replace(/[\s　]+/g, '');
            if (t.length > 8 || !DL_TOC_RE.test(t)) continue;
            var u = dlAbsUrl(as[i].getAttribute('href'), base);
            if (u && new URL(u).hostname === new URL(base).hostname) return u;
        }
        return '';
    }

    // 書本 id：優先用目錄頁網址（每本書唯一），找不到才用章節網址的目錄部分。
    // 去掉 www./m./tw. 前綴，電腦與手機開的網域略有不同時仍對得上同一本書
    function dlBookId(tocUrl, pageUrl) {
        var u = new URL(tocUrl || pageUrl);
        var path = tocUrl ? u.pathname : u.pathname.replace(/[^\/]*$/, '');
        return dlNormHost(u.hostname) + path;
    }

    function dlLooksLikeChapter(s) {
        return /^\s*(第\s*[0-9０-９零〇一二兩两三四五六七八九十百千萬万]+\s*[章回節节話话卷集篇]|chapter\s*\d|ch\.?\s*\d)/i.test(s || '');
    }
    function dlGuessTitle(doc) {
        var m = doc.querySelector('meta[property="og:novel:book_name"], meta[name="og:novel:book_name"]');
        if (m && m.getAttribute('content')) return m.getAttribute('content').trim();
        // 「《書名》 第N章 … - 站名」：有書名號就取書名號內（用分隔符切常切到站名）
        var bm = /《([^》]{1,100})》/.exec(doc.title || '');
        if (bm) return bm[1].trim();
        var parts = (doc.title || '').split(/\s*[_|｜\-–—]\s*/).filter(Boolean);
        // 標題可能是「章名_書名_站名」或「書名_章名_…_站名」（如 uuread）：先剔除像章名的段，取剩下的第一段
        var rest = parts.filter(function(p) { return !dlLooksLikeChapter(p); });
        if (rest.length && rest.length < parts.length) return rest[0].trim().slice(0, 100);
        return (parts.length >= 2 ? parts[1] : parts[0] || '').trim().slice(0, 100);
    }

    // ---- 正文轉純文字 ----
    var DL_BLOCK_RE = /^(P|DIV|H[1-6]|LI|SECTION|ARTICLE|BLOCKQUOTE|TR|DD|DT|PRE|HEADER|FOOTER)$/;
    var DL_SKIP_RE = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BUTTON|SELECT|TEXTAREA|IFRAME)$/;
    function dlText(el) {
        var out = [], buf = '';
        (function walk(n) {
            for (var c = n.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3) { buf += c.nodeValue; continue; }
                if (c.nodeType !== 1) continue;
                var tag = c.tagName.toUpperCase();
                if (tag === 'BR') { out.push(buf); buf = ''; continue; }
                if (DL_SKIP_RE.test(tag)) continue;
                // 站方反爬常塞 display:none 的干擾字
                if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(c.getAttribute('style') || '')) continue;
                var block = DL_BLOCK_RE.test(tag);
                if (block) { out.push(buf); buf = ''; }
                walk(c);
                if (block) { out.push(buf); buf = ''; }
            }
        })(el);
        out.push(buf);
        return out.map(function(s) { return s.replace(/[\s　 ]+/g, ' ').trim(); }).filter(Boolean);
    }

    // 同章分頁的標題常帶頁碼：「第12章 xxx（2/3）」「第12章(2)」「第12章_2」
    function dlTitleKey(t) {
        return String(t || '').replace(/[\s　]+/g, '')
            .replace(/[（(\[【]\d+[\/／]\d+[)）\]】]$/, '')
            .replace(/[（(\[【](第?\d+頁?|第?[一二三四五六七八九十]+頁?)[)）\]】]$/, '')
            .replace(/[-_]\d+$/, '');
    }

    // 站方按字數切頁，切點常在句子中間：上一頁末段沒有句末標點、或下一頁首段以標點開頭，就接回同一段
    function dlJoinLines(prev, next) {
        if (!prev.length || !next.length) return prev.concat(next);
        var a = prev[prev.length - 1], b = next[0];
        if (!/[。！？!?…”」』）)～~]$/.test(a) || /^[，。、！？；：,.!?;:”」』）)]/.test(b)) {
            return prev.slice(0, -1).concat([a + b], next.slice(1));
        }
        return prev.concat(next);
    }

    function dlIsTitleEl(el) {
        if (/^H[1-3]$/i.test(el.tagName)) return true;
        var len = dlText(el).join('').length;
        if (len > 150) return false;
        return !!(el.querySelector && el.querySelector('h1, h2, h3')) || /title/i.test((el.className || '') + ' ' + (el.id || ''));
    }

    function dlNextUrl(doc, pageUrl) {
        var r = dlEnv.rule();
        var a = getOne(r.pager.nextL, doc, doc);
        if (!a || a.nodeType !== 1) return '';
        var u = dlAbsUrl(a.getAttribute('href'), pageUrl);
        return u && u !== pageUrl ? u : '';
    }

    // 解析一頁：回傳 { key, title, lines, next }；抓不到正文回傳 null
    function dlParsePage(doc, url) {
        var r = dlEnv.rule();
        var next = dlNextUrl(doc, url);   // 先取：hook 與清理可能會動到導覽列
        var pageE = getAll(r.pager.pageE, doc, doc);
        if (!pageE.length) return Promise.resolve(null);
        dlHookMode = true;
        try { pageE = dlEnv.prepare(pageE); } finally { dlHookMode = false; }
        if (!pageE || !pageE.length) return Promise.resolve(null);
        // novels.com.tw 的正文是非同步解密後才填回（見 novelsTwDecrypt）
        var waits = pageE.map(function(e) { return e.__apDecrypt; }).filter(Boolean);
        return Promise.all(waits).then(function() {
            var key = '', title = '', lines = [];
            pageE.forEach(function(el) {
                if (dlIsTitleEl(el)) {
                    if (!title) {
                        var h = (el.matches && el.matches('h1, h2, h3')) ? el : (el.querySelector('h1, h2, h3') || el);
                        title = dlText(h).join(' ');
                    }
                    return;
                }
                lines = lines.concat(dlText(el));
            });
            key = dlTitleKey(title);
            if (!title) title = (doc.title || '').split(/\s*[_|｜\-–—]\s*/)[0].trim();
            // 正文第一行常是完整標題（oop 的 h1 只有章號，「第N章 標題」在第一段）
            if (lines.length && lines[0].length <= 60 && title && dlTitleKey(lines[0]).indexOf(dlTitleKey(title)) === 0) {
                title = lines.shift();
            } else if (lines.length && lines[0].length <= 40 && /^第[\d一二三四五六七八九十百千零〇两兩]+[章節节回卷]/.test(lines[0])) {
                // 標題元素只有編號（oop 的 h1 是「002」），正文首行才是「第2章 …」
                title = lines.shift();
            }
            if (!lines.length) return null;
            return { key: key, title: title || '（無標題）', lines: lines, next: next };
        });
    }

    // ---- 網路 ----
    // 站方的人機驗證頁（Cloudflare 等）。只在「HTTP 錯誤」或「找不到正文」時才拿來判斷，
    // 正常章節頁裡就算有 captcha 字樣也不會誤判。碰到就停，請使用者自己在分頁裡完成驗證
    var DL_CHALLENGE_RE = /cf-chl|challenge-platform|cf_chl_opt|Just a moment|Attention Required|請稍候|verify you are human|captcha|turnstile/i;
    function dlChallengeError() {
        var e = new Error('站方要求人機驗證');
        e.challenge = true;
        return e;
    }
    function dlHttpError(status, retryAfter, body) {
        if (body && DL_CHALLENGE_RE.test(body.slice(0, 20000))) return dlChallengeError();
        var e = new Error('HTTP ' + status);
        e.status = status;
        var ra = parseInt(retryAfter, 10);
        if (ra > 0) e.retryAfter = Math.min(ra, 600) * 1000;
        return e;
    }

    function dlFetchHtml(url) {
        var same = false;
        try { same = new URL(url).origin === location.origin; } catch (e) {}
        // 同源走原生 fetch：帶得到站方用 JS 設的第一方 cookie（見 fetchNextPage 的說明）
        if (same) {
            // fetch 沒有預設逾時：站方卡住不回時，整個下載會無聲停在這裡、也不回報。逾時就中止，交給 dlRetry 重試
            var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            if (ctrl) dlSleep(DL_FETCH_TIMEOUT).then(function() { ctrl.abort(); });
            return fetch(url, { credentials: 'include', headers: { 'Accept': 'text/html,application/xhtml+xml' }, signal: ctrl ? ctrl.signal : undefined }).catch(function(e) {
                if (e && e.name === 'AbortError') throw new Error('逾時（' + DL_FETCH_TIMEOUT / 1000 + ' 秒沒有回應）');
                throw e;
            }).then(function(res) {
                if (!res.ok) {
                    return res.text().catch(function() { return ''; }).then(function(t) {
                        throw dlHttpError(res.status, res.headers.get('retry-after'), t);
                    });
                }
                return res.arrayBuffer();
            }).then(function(buf) {
                return new TextDecoder(document.characterSet || 'utf-8').decode(buf);
            });
        }
        return dlEnv.xhr({ method: 'GET', url: url, html: true }).then(function(r) {
            if (r.status && (r.status < 200 || r.status >= 400)) throw dlHttpError(r.status, '', r.text);
            return r.text;
        });
    }

    function dlParseDoc(html) {
        var d = (new DOMParser()).parseFromString(html, 'text/html');
        return d;
    }

    function dlApi(cfg, method, path, body) {
        return dlEnv.xhr({
            method: method,
            url: cfg.server + '/api' + path,
            headers: { 'authorization': 'Bearer ' + cfg.token, 'content-type': 'application/json' },
            data: body === undefined ? undefined : JSON.stringify(body)
        }).then(function(r) {
            var d = {};
            try { d = JSON.parse(r.text || '{}'); } catch (e) {}
            var err;
            if (r.status === 401) err = new Error('TOKEN 錯誤（到「設定」重新輸入）');
            else if (!(r.status >= 200 && r.status < 300)) err = new Error(d.error || ('HTTP ' + r.status));
            if (err) { err.status = r.status; throw err; }
            return d;
        });
    }

    async function dlRetry(fn, what) {
        for (var i = 0; ; i++) {
            try { return await fn(); }
            catch (e) {
                // 人機驗證重試也沒用，只會讓站方更確定這是機器人
                if (e.challenge || i >= DL_RETRY_WAIT.length || (dlJob && dlJob.stop)) throw e;
                if (e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 429) throw e;
                // 403／429／503 多半是站方限流：之後每頁都放慢，這次也等久一點；站方有給 Retry-After 就照它
                var limited = e.status === 403 || e.status === 429 || e.status === 503;
                if (limited && dlJob) dlJob.slow = Math.min(DL_SLOW_MAX, (dlJob.slow || 1) * 2);
                var wait = e.retryAfter || DL_RETRY_WAIT[i] * (limited ? 3 : 1);
                dlStatus(what + '失敗（' + (e.message || e) + '），' + Math.round(wait / 1000) + ' 秒後重試…');
                await dlSleep(wait);
            }
        }
    }

    async function dlLoadCfg() {
        var s = await dlEnv.get(DL_KEY_SERVER, '');
        var t = await dlEnv.get(DL_KEY_TOKEN, '');
        return { server: String(s || '').replace(/\/+$/, ''), token: String(t || '') };
    }

    // ---- 下載紀錄（閱讀器書架顯示「下載中 120 / 約 350 章」） ----
    // 回報失敗不影響下載：舊版伺服器沒有這支 API、或網路一時不通，都只是書架上看不到進度
    var DL_REPORT_EVERY = 15000, DL_FETCH_TIMEOUT = 30000;
    function dlDevice() {
        var ua = navigator.userAgent;
        if (/iPhone/.test(ua)) return 'iPhone';
        if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
        if (/Android/.test(ua)) return 'Android';
        return '電腦';
    }
    function dlReport(cfg, bp, job, state, message) {
        if (!job.runId) return Promise.resolve();
        job.reportedAt = Date.now();
        return dlApi(cfg, 'PUT', bp + '/runs/' + job.runId, {
            state: state, chapters: job.chapters, est: job.est, message: message || null
        }).catch(function() {});
    }

    // 心跳用 Worker 計時（dlSleep），背景分頁也照常送出；只在下載還在跑時送
    async function dlHeartbeat(cfg, bp, job) {
        while (dlJob === job) {
            await dlSleep(DL_REPORT_EVERY);
            if (dlJob === job && Date.now() - (job.reportedAt || 0) >= DL_REPORT_EVERY - 500) {
                dlReport(cfg, bp, job, 'running', job.lastStatus);
            }
        }
    }

    // 下載期間持有一把 Web Lock：Chrome 比較不會凍結或丟棄持有鎖的背景分頁（不保證，電腦休眠仍會停）
    function dlHoldLock(job) {
        try {
            if (!navigator.locks || !navigator.locks.request) return;
            navigator.locks.request('myautopager-download', function() {
                return new Promise(function(release) { job.releaseLock = release; });
            }).catch(function() {});
        } catch (e) {}
    }

    // ---- 下載流程 ----
    function dlEligible() {
        var r = dlEnv.rule();
        return !!(r && r.pager && typeof r.pager.nextL === 'string' && r.pager.pageE && dlEnv.eligible());
    }

    // 讀目錄頁：網址形狀與本章相同的連結就是章節（依序號排序，用來估算總章數），
    // 第一章優先取「開始閱讀／第一章」連結，沒有就取序號最小的那個
    async function dlTocInfo(tocUrl) {
        var doc = dlParseDoc(await dlRetry(function() { return dlFetchHtml(tocUrl); }, '讀取目錄'));
        var shape = dlShape(location.href), host = location.hostname;
        var as = doc.querySelectorAll('a[href]'), seen = {}, list = [], first = '';
        for (var i = 0; i < as.length; i++) {
            var u = dlAbsUrl(as[i].getAttribute('href'), tocUrl);
            if (!u || new URL(u).hostname !== host || dlShape(u) !== shape) continue;
            var t = as[i].textContent.replace(/\s+/g, '');
            if (!first && /^(開始閱讀|从头阅读|從頭閱讀|開始閲讀|第[一1０0]+章|第0*1章)/.test(t)) first = u;
            if (!seen[u]) { seen[u] = true; list.push(u); }
        }
        list.sort(function(a, b) { return dlLastNum(a) - dlLastNum(b); });
        // 目錄常分頁或只列最新幾章，連結數會比實際少；站方寫明的「共 N 章」「目錄（N章）」比較準
        var txt = ((doc.body && doc.body.textContent) || '').replace(/\s+/g, '');
        var declared = 0, re = /(?:共|全|目[錄录][（(]?)(\d{1,5})[章回]/g, m;
        while ((m = re.exec(txt))) declared = Math.max(declared, parseInt(m[1], 10));
        return { first: first || list[0] || '', list: list, total: Math.max(list.length, declared) };
    }

    // 估計還有幾章：總章數減去本章在目錄清單中的位置；本章不在清單裡（目錄只列一部分）就不估
    function dlEstimate(toc, fromUrl) {
        if (!toc || !toc.list.length) return 0;
        var i = toc.list.indexOf(fromUrl);
        return i >= 0 ? toc.total - i : 0;
    }

    function dlProgressText(job, title) {
        var t = '已抓 ' + job.chapters + ' 章';
        if (job.est > job.chapters) {
            t += ' / 約 ' + job.est + ' 章';
            var left = job.est - job.chapters;
            if (job.chapters >= 3 && left > 0) {
                var per = (Date.now() - job.t0) / job.chapters;
                var min = Math.ceil(per * left / 60000);
                t += '，約剩 ' + (min >= 60 ? Math.floor(min / 60) + ' 小時 ' + (min % 60) + ' 分' : min + ' 分鐘');
            }
        }
        if (job.slow > 1.05) t += '（站方限流中，已放慢 ' + job.slow.toFixed(1) + ' 倍）';
        return t + (title ? '：' + title : '');
    }

    // mode：'here' 從本章到最後；'all' 整本 = 先跑一次 'here'（讓正在讀的這章馬上能讀），
    // 成功後自動接著跑 'front'（從第一章補到本章之前，碰到已存的就停）；'resume' 從上次結尾續抓新章節
    async function dlStart(mode) {
        if (dlJob) return;
        var cfg = await dlLoadCfg();
        if (!cfg.server || !cfg.token) { dlShowSettings(true); dlStatus('請先設定閱讀器網址與 TOKEN'); return; }
        var title = (dlUi && dlUi.q('#dlTitle').value.trim()) || dlGuessTitle(document);
        if (!title) { dlStatus('請輸入書名'); return; }
        var job = dlJob = { stop: false, chapters: 0, pages: 0, slow: 1, t0: Date.now(), est: 0 };
        window.addEventListener('beforeunload', dlBeforeUnload);
        dlRender();
        try {
            var tocUrl = dlFindToc(document, location.href);
            var id = dlBookId(tocUrl, location.href);
            job.bookId = id;
            var bp = '/books/' + encodeURIComponent(id);
            dlStatus('連線閱讀器…');
            // 先查再建：還沒下載過的書按「續抓」時直接提示，不在書架上留下一本 0 章的空書
            var info = null;
            try { info = await dlRetry(function() { return dlApi(cfg, 'GET', bp); }, '讀取書本'); }
            catch (e) { if (e.status !== 404) throw e; }
            if (mode === 'resume' && !(info && info.chapters.length)) {
                throw new Error('這本書還沒下載過，請先按「從本章開始」或「整本」');
            }
            await dlRetry(function() { return dlApi(cfg, 'PUT', bp, { title: title, site: dlEnv.ruleKey(), sourceUrl: tocUrl || location.href }); }, '建立書本');
            if (!info) info = { book: { next_url: null, next_skip: 0 }, chapters: [] };
            // 下載紀錄一開始就建立：之後任何一步失敗，書架的「下載紀錄」都看得到原因
            try {
                var run = await dlApi(cfg, 'POST', bp + '/runs', { mode: mode, device: dlDevice(), est: 0 });
                job.runId = run.run && run.run.id;
                job.reportedAt = Date.now();
            } catch (e) {}
            if (job.runId) dlHeartbeat(cfg, bp, job);
            dlHoldLock(job);
            var known = {};
            info.chapters.forEach(function(c) { known[c.url] = true; });
            var stored = info.chapters.length;
            var tailUrl = stored ? info.chapters[stored - 1].url : null;

            var url, skipFirst = false, start = false, prevUrl = tailUrl;
            // atTail：這次抓的內容接在全書最後。只有這時候才更新伺服器的續抓點；
            // 在書的前段補抓時中途停止，不能把指向書尾的續抓點改寫成中段
            var atTail = mode === 'resume' || !stored;
            if (mode === 'resume') {
                if (info.book.next_url) { url = info.book.next_url; skipFirst = !!info.book.next_skip; }
                // 沒記到續抓點（例如上次在書的前段補抓）：重讀已存的最後一章，從它的「下一章」接著抓
                else { url = tailUrl; skipFirst = true; }
            } else if (mode === 'front') {
                if (!tocUrl) throw new Error('這頁找不到「目錄」連結，沒辦法補前面的章節；可到第一章按「從本章開始」');
                dlStatus('從目錄找第一章…');
                var tocAll = await dlTocInfo(tocUrl);
                url = tocAll.first;
                if (!url) throw new Error('目錄頁裡找不到章節連結，沒辦法補前面的章節；可到第一章按「從本章開始」');
                // 要補的章數 ≈ 本章在目錄中的位置
                job.est = Math.max(0, tocAll.list.indexOf(location.href));
                start = true; prevUrl = null;
            } else {
                url = location.href;
                // 本章沒存過、這本書卻已有章節：不知道本章該排在已存範圍的前面還是後面，問使用者
                if (stored && !known[url]) {
                    var before = confirm('《' + title + '》已存 ' + stored + ' 章（「' + info.chapters[0].title + '」～「' + info.chapters[stored - 1].title +
                        '」）。\n\n本章在已存範圍「之前」嗎？\n確定＝插在最前面；取消＝接在最後面');
                    if (before) { start = true; prevUrl = null; }
                }
                if (!start) atTail = true;
            }
            // 估算總章數只是錦上添花：目錄讀不到就不顯示，不影響下載
            if (!job.est && tocUrl) {
                try { job.est = dlEstimate(await dlTocInfo(tocUrl), url); } catch (e) {}
            }

            if (job.est) dlReport(cfg, bp, job, 'running');

            var visited = {}, batch = [], batchChars = 0, cur = null, jumped = false, ended = false, skipKey = '';
            var upload = async function(next) {
                if (!batch.length && !next) return;
                var body = { chapters: batch };
                if (next && atTail) body.next = next;
                if (start) body.start = true; else if (prevUrl) body.prevUrl = prevUrl;
                dlStatus('上傳 ' + batch.length + ' 章…');
                var res = await dlRetry(function() { return dlApi(cfg, 'POST', bp + '/chapters', body); }, '上傳');
                if (batch.length) { prevUrl = batch[batch.length - 1].url; start = false; }
                job.total = res.total;
                batch = []; batchChars = 0;
            };
            var finish = function(c) {
                var ch = { url: c.url, title: c.title, content: c.lines.join('\n') };
                batch.push(ch);
                batchChars += ch.content.length;
                job.chapters++;
                job.lastTitle = c.title;
            };

            while (url && !job.stop) {
                if (visited[url]) break;          // 防呆：nextL 繞回已抓過的頁面
                // 碰到已存過的章節：後面那段也存過了，直接跳到上次的結尾續抓。
                // 已存的網址一定是某章的第一頁，所以手上暫存的那章到此已完整
                if (known[url] && !skipFirst) {
                    if (cur) { finish(cur); cur = null; }
                    await upload();
                    prevUrl = tailUrl;
                    start = false;
                    if (jumped || !info.book.next_url || mode === 'front') { ended = true; url = ''; break; }
                    jumped = true;
                    atTail = true;
                    dlStatus('「' + (job.lastTitle || '本章') + '」之後已存過，跳到上次的結尾續抓…');
                    url = info.book.next_url; skipFirst = !!info.book.next_skip;
                    continue;
                }
                visited[url] = true;
                var pageUrl = url;
                var page;
                try {
                    page = await dlRetry(function() {
                        return dlFetchHtml(pageUrl).then(function(html) {
                            return dlParsePage(dlParseDoc(html), pageUrl).then(function(p) {
                                if (p) return p;
                                throw DL_CHALLENGE_RE.test(html.slice(0, 20000)) ? dlChallengeError() : new Error('頁面裡找不到正文');
                            });
                        });
                    }, '抓取');
                } catch (e) {
                    // 抓頁失敗不直接丟出去：已抓的章節先上傳、記好續抓點，下次能從這裡接著抓
                    job.error = e;
                    break;
                }
                job.pages++;
                job.slow = Math.max(1, job.slow * 0.9);
                if (skipFirst || (skipKey && page.key === skipKey)) {
                    if (skipFirst) skipKey = page.key;
                    skipFirst = false; url = page.next; await dlPace(job); continue;
                }
                skipKey = '';
                if (cur && page.key && page.key === cur.key) {
                    cur.lines = dlJoinLines(cur.lines, page.lines);
                    cur.lastUrl = pageUrl;
                } else {
                    if (cur) finish(cur);
                    cur = { url: pageUrl, lastUrl: pageUrl, key: page.key, title: page.title, lines: page.lines };
                }
                dlStatus(dlProgressText(job, page.title));
                if (Date.now() - (job.reportedAt || 0) > DL_REPORT_EVERY) dlReport(cfg, bp, job, 'running', job.lastStatus);
                // 未完成的那章不上傳；續抓位置指向它的第一頁，下次從頭抓這章
                if (batch.length >= DL_BATCH_MAX || batchChars >= DL_BATCH_CHARS) await upload({ url: cur.url, skip: false });
                url = page.next;
                if (url) await dlPace(job);
            }

            if (job.stop || job.error) {
                // 未完成的那章不存，續抓點指向它的第一頁（失敗在新的一章時，就是失敗的那一頁）
                await upload({ url: cur ? cur.url : url, skip: false });
                var again = atTail ? '「續抓新章節」' : '「整本」（已存的會跳過）';
                var e2 = job.error;
                job.endState = e2 ? 'error' : 'stopped';
                job.endMsg = !e2 ? '已停止。存了 ' + job.chapters + ' 章，可用' + again + '接著抓。'
                    : e2.challenge ? '站方要求人機驗證，已暫停並保存 ' + job.chapters + ' 章。請重新整理這一頁、自己完成驗證，再按' + again + '。'
                    : '抓取失敗（' + (e2.message || e2) + '），已保存 ' + job.chapters + ' 章。稍後再按' + again + '。';
                dlStatus(job.endMsg);
            } else if (ended) {
                await upload();
            } else {
                if (cur) finish(cur);
                // 抓到最後一頁：續抓時重新讀這頁找新的「下一章」，但不重存它
                await upload({ url: cur ? cur.lastUrl : null, skip: true });
            }
            if (!job.endState) {
                job.endState = 'done';
                job.endMsg = mode === 'all'
                    ? '本章到最後已完成（新增 ' + job.chapters + ' 章），接著回頭補前面的章節…'
                    : '完成：新增 ' + job.chapters + ' 章，全書共 ' + (job.total || stored) + ' 章。';
                dlStatus(job.endMsg);
            }
            job.done = true;
        } catch (e) {
            job.endState = 'error';
            job.endMsg = '下載中斷：' + (e.message || e) + (job.chapters ? '（已存 ' + job.chapters + ' 章之前的部分）' : '');
            dlStatus(job.endMsg);
        } finally {
            if (job.releaseLock) job.releaseLock();
            if (job.runId) await dlReport(cfg, bp, job, job.endState || 'error', job.endMsg);
            window.removeEventListener('beforeunload', dlBeforeUnload);
            dlJob = null;
            dlLastBookId = job.bookId || dlLastBookId;
            if (dlUi && job.chapters) dlUi.canResume = true;
            dlRender();
            if (mode === 'all' && job.endState === 'done') setTimeout(function() { dlStart('front'); }, 1500);
        }
    }

    // 下載中關掉或離開分頁會中斷下載：先跳瀏覽器的確認（iPhone Safari 不一定會跳）
    function dlBeforeUnload(e) {
        if (!dlJob) return;
        e.preventDefault();
        e.returnValue = '';
    }

    var dlLastBookId = '';
    async function dlOpenReader(bookId) {
        var cfg = await dlLoadCfg();
        if (!cfg.server || !cfg.token) { dlOpenDialog(); dlShowSettings(true); return; }
        var url = cfg.server + '/#t=' + encodeURIComponent(cfg.token) + (bookId ? '&b=' + encodeURIComponent(bookId) : '');
        dlEnv.openTab(url);
    }

    // ---- 面板 ----
    function dlStatus(msg) {
        if (dlJob) dlJob.lastStatus = msg;
        if (!dlUi) return;
        dlUi.q('#dlStatus').textContent = msg;
        if (dlJob) dlUi.q('#mini').textContent = '⬇ ' + dlJob.chapters + (dlJob.est > dlJob.chapters ? ' / ' + dlJob.est : '') + ' 章' + (dlJob.slow > 1.05 ? ' · 放慢中' : '');
    }

    function dlRender() {
        if (!dlUi) return;
        var busy = !!dlJob;
        ['#dlHere', '#dlAll'].forEach(function(s) { dlUi.q(s).disabled = busy; });
        dlUi.q('#dlResume').disabled = busy || dlUi.canResume === false;
        dlUi.q('#dlStop').style.display = busy ? '' : 'none';
        dlUi.q('#dlRead').textContent = dlLastBookId ? '📚 開啟這本' : '📚 開啟書架';
        // 面板關著、下載還在跑：角落留一個進度小標籤，點它打開面板
        dlUi.q('#mini').hidden = !(busy && dlUi.q('#p').hidden);
    }

    function dlShowSettings(open) {
        if (!dlUi) return;
        dlUi.q('#dlCfg').style.display = open ? 'block' : 'none';
        if (open) dlLoadCfg().then(function(c) { dlUi.q('#dlServer').value = c.server; dlUi.q('#dlToken').value = c.token; });
    }

    function dlOpenDialog() {
        if (!dlEligible()) { dlEnv.notice('這個網站的規則不支援下載'); return; }
        if (dlUi) { dlUi.q('#p').hidden = false; dlRender(); return; }
        var host = document.createElement('div');
        host.id = 'Autopage_dl';
        host.style.cssText = 'all:initial;position:fixed!important;z-index:2147483000!important;left:0;top:0';
        document.documentElement.appendChild(host);
        var sh = host.attachShadow({ mode: 'open' });
        sh.innerHTML = '<style>' +
            '#p{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;' +
                'padding:14px 16px;border-radius:14px;background:rgba(20,20,20,.95);color:#fff;font:14px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.4);-webkit-tap-highlight-color:transparent}' +
            'h3{margin:0 0 10px;font-size:16px;display:flex;justify-content:space-between;align-items:center}' +
            'label{display:block;color:#bbb;font-size:12px;margin:8px 0 2px}' +
            'input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:8px;border-radius:8px;border:1px solid #555;background:#2a2a2a;color:#fff}' +
            'button{font:inherit;color:#fff;background:#3a3a3a;border:0;border-radius:8px;min-height:38px;padding:0 12px;cursor:pointer;touch-action:manipulation}' +
            'button:disabled{opacity:.4;cursor:default}button.pri{background:#c46a1b}' +
            '.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.row button{flex:1}' +
            '#dlStatus{margin-top:10px;min-height:1.5em;color:#ddd;word-break:break-all}' +
            '.hint{color:#999;font-size:12px;margin-top:8px}#x{background:none;min-height:0;padding:0 4px;font-size:20px}' +
            '#dlCfg{display:none;border-top:1px solid #444;margin-top:12px;padding-top:4px}' +
            '[hidden]{display:none!important}' +
            '#mini{position:fixed;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));' +
                'padding:6px 12px;border-radius:999px;background:rgba(20,20,20,.9);color:#fff;font:13px/1.4 system-ui,-apple-system,sans-serif;' +
                'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
            '</style>' +
            '<div id="mini" role="button" aria-label="下載進度，點一下打開面板" hidden></div>' +
            '<div id="p" role="dialog" aria-label="下載到閱讀器">' +
              '<h3><span>⬇ 下載到閱讀器</span><button id="x" aria-label="關閉">×</button></h3>' +
              '<label for="dlTitle">書名</label><input id="dlTitle">' +
              '<div class="row"><button id="dlHere" class="pri">從本章開始</button><button id="dlAll">整本</button></div>' +
              '<div class="row"><button id="dlResume">續抓新章節</button><button id="dlStop">停止</button></div>' +
              '<div id="dlStatus"></div>' +
              '<div class="hint">整本＝先從本章抓到最後（馬上能接著讀），再回頭從第一章補到本章之前。</div>' +
              '<div class="hint">下載在背景進行，可以關掉面板繼續閱讀，右下角會顯示進度。請讓這個分頁開著（iPhone 請留在前景，Safari 會暫停背景分頁）。已存過的章節會自動跳過。</div>' +
              '<div class="row"><button id="dlRead">📚 開啟書架</button><button id="dlSet">設定</button></div>' +
              '<div id="dlCfg">' +
                '<label for="dlServer">閱讀器網址（Cloudflare Worker）</label><input id="dlServer" placeholder="https://myautopager-reader.xxx.workers.dev" autocomplete="off" autocapitalize="off">' +
                '<label for="dlToken">TOKEN</label><input id="dlToken" type="password" autocomplete="off">' +
                '<div class="row"><button id="dlSave" class="pri">儲存並測試</button></div>' +
              '</div>' +
            '</div>';
        dlUi = { host: host, q: function(s) { return sh.querySelector(s); } };
        dlUi.q('#dlTitle').value = dlGuessTitle(document);
        // 點擊與觸控都攔在面板內，不讓它們落到雙擊自動捲動與正文點擊守衛
        ['click', 'touchstart', 'touchend', 'dblclick'].forEach(function(n) { host.addEventListener(n, function(e) { e.stopPropagation(); }); });
        // 有些站（如 uuread）的廣告腳本在 window 捕獲階段吞掉所有 click／touchend，面板按鈕收不到；
        // 按鈕改由 pointerup 觸發（按下與放開在同一顆才算），click 只在 pointerup 沒觸發時才處理（鍵盤 Enter／空白鍵）
        var tapBtn = null, tapAt = 0;
        function dlTapTarget(e) { var t = e.target; return t && t.closest ? t.closest('button, [role="button"]') : null; }
        sh.addEventListener('pointerdown', function(e) { tapBtn = dlTapTarget(e); }, true);
        sh.addEventListener('pointercancel', function() { tapBtn = null; }, true);
        sh.addEventListener('pointerup', function(e) {
            var b = dlTapTarget(e);
            if (!b || b !== tapBtn || b.disabled || !b.onclick) return;
            tapBtn = null; tapAt = Date.now();
            b.onclick.call(b, e);
        }, true);
        sh.addEventListener('click', function(e) { if (Date.now() - tapAt < 800) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        dlUi.q('#x').onclick = function() { dlUi.q('#p').hidden = true; dlRender(); };
        dlUi.q('#mini').onclick = function() { dlUi.q('#p').hidden = false; dlRender(); };
        dlUi.q('#dlHere').onclick = function() { dlStart('here'); };
        dlUi.q('#dlAll').onclick = function() { dlStart('all'); };
        dlUi.q('#dlResume').onclick = function() { dlStart('resume'); };
        dlUi.q('#dlStop').onclick = function() { if (dlJob) { dlJob.stop = true; dlStatus('停止中（目前這頁抓完就停）…'); } };
        dlUi.q('#dlRead').onclick = function() { dlOpenReader(dlLastBookId); };
        dlUi.q('#dlSet').onclick = function() { dlShowSettings(dlUi.q('#dlCfg').style.display !== 'block'); };
        dlUi.q('#dlSave').onclick = async function() {
            var server = dlUi.q('#dlServer').value.trim().replace(/\/+$/, ''), token = dlUi.q('#dlToken').value.trim();
            if (!/^https:\/\/[^\/]+/.test(server)) { dlStatus('閱讀器網址要以 https:// 開頭'); return; }
            await dlEnv.set(DL_KEY_SERVER, server);
            await dlEnv.set(DL_KEY_TOKEN, token);
            dlStatus('測試連線…');
            try { await dlApi({ server: server, token: token }, 'GET', '/ping'); dlStatus('連線成功 ✓'); dlShowSettings(false); }
            catch (e) { dlStatus('連線失敗：' + (e.message || e)); }
        };
        dlRender();
        // 這頁所屬的書若已存過，帶出已存章數與書名
        dlLoadCfg().then(function(cfg) {
            if (!cfg.server || !cfg.token) { dlShowSettings(true); dlStatus('第一次使用：填入閱讀器網址與 TOKEN'); return; }
            var id = dlBookId(dlFindToc(document, location.href), location.href);
            return dlApi(cfg, 'GET', '/books/' + encodeURIComponent(id)).then(function(d) {
                dlLastBookId = id;
                dlUi.canResume = d.chapters.length > 0;
                // 舊版曾把章名存成書名：存的書名像章名、這頁又猜得到別的書名時，改帶猜到的，下次下載就會寫回書架
                var guess = dlGuessTitle(document), fixTitle = dlLooksLikeChapter(d.book.title) && guess && !dlLooksLikeChapter(guess);
                dlUi.q('#dlTitle').value = fixTitle ? guess : d.book.title;
                dlStatus('已存 ' + d.chapters.length + ' 章' + (d.book.next_url ? '，可續抓新章節' : '') + '。' +
                    (fixTitle ? '書名已更正，下次下載時更新到書架。' : ''));
                dlRender();
            }).catch(function(e) {
                if (e.status === 404) { dlUi.canResume = false; dlStatus('這本書還沒下載過，請按「從本章開始」或「整本」。'); dlRender(); }
                else dlStatus('連不到閱讀器：' + (e.message || e));
            });
        });
    }
    // ---- 配對：在自己的雲端閱讀器網頁上，自動把網址與 TOKEN 存進下載設定 ----
    // 腳本在閱讀器網頁上一開頭就 return（不翻頁、不攔彈窗），後面的 var 常數與 dlEnv 都還沒賦值，
    // 所以這個函式自給自足：設定的 key 寫死，存取方式由呼叫端傳入（桌面同步、iPhone 非同步）。
    // 閱讀器用配對 QR code 或 TOKEN 登入後會存在 localStorage 的 apr_token；
    // 已經連到別的書架時先問過才覆蓋，免得任何長得像閱讀器的網頁都能把下載導走
    function dlPairFromReader(get, set) {
        var tries = 0, timer = 0;
        var check = function() {
            if (!document.querySelector('meta[name="myautopager-reader"]')) { clearInterval(timer); return; }
            var token = '';
            try { token = JSON.parse(localStorage.getItem('apr_token') || '""'); } catch (e) {}
            if (++tries > 100) clearInterval(timer);   // 開著頁面約 5 分鐘內登入都算數
            if (!token || typeof token !== 'string') return;
            clearInterval(timer);
            var server = location.origin;
            Promise.all([get('apdl_server', ''), get('apdl_token', '')]).then(function(v) {
                if (v[0] === server && v[1] === token) return;
                if (v[0] && v[0] !== server &&
                    !confirm('MyAutoPager：要把下載改存到這個書架嗎？\n\n目前：' + v[0] + '\n改成：' + server)) return;
                return Promise.all([set('apdl_server', server), set('apdl_token', token)]).then(function() {
                    var n = document.createElement('div');
                    n.textContent = 'MyAutoPager：這台裝置的下載設定已連到這個書架';
                    n.style.cssText = 'position:fixed;z-index:2147483000;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);' +
                        'max-width:calc(100vw - 32px);padding:10px 14px;border-radius:12px;background:rgba(20,20,20,.92);color:#fff;font:14px/1.5 system-ui,sans-serif';
                    document.documentElement.appendChild(n);
                    setTimeout(function() { n.remove(); }, 5000);
                });
            }).catch(function() {});
        };
        var go = function() { timer = setInterval(check, 3000); check(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { setTimeout(go, 300); });
        else setTimeout(go, 300);
    }
    // ==== dl-shared-end ====

    // ========== 初始化 ==========

    matchRule();

    // 彈窗攔截先裝，而且刻意不受兩件事影響：
    //  1. 不等 GM.getValue —— 那是非同步的，廣告腳本不會等我們；
    //  2. 不看「停用本站」—— 使用者關掉的是自動翻頁，不是廣告防護，
    //     沒道理因為關掉翻頁就把廣告分頁放回來。
    installPageGuard();
    installBlockFeedback();
    installClickGuard();
    installDomGuard();

    if (!curSite) return;

    // @run-at 改成 document-start 之後，以下都需要 DOM 才能動
    function whenReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    whenReady(function() {

    // 首次進站的整頁拆彈：document-start 時 body 還是空的，要等 DOM 就緒才掃得到
    try { apDefuse(document.documentElement); } catch (e) {}
    try {
        var initFrames = document.querySelectorAll('iframe');
        for (var fi = 0; fi < initFrames.length; fi++) guardIframe(initFrames[fi]);
    } catch (e) {}

    // 檢查是否被禁用。
    // 採「失敗即放行」：整個啟動流程都掛在這個 then 裡，若 GM.getValue 不 resolve
    // （某些 Safari / Userscripts 版本會如此）或拋錯，樣式、頁碼按鈕、翻頁監聽
    // 全都不會執行 —— 在沒有 console 的 iPhone 上就是「腳本完全沒反應」且無從查起。
    // 逾時與 catch 讓非同步儲存 API 的問題不會拖死整個腳本。
    Promise.race([
        isDisabled(),
        new Promise(function(resolve) { setTimeout(function() { resolve(false); }, 3000); })
    ]).catch(function() { return false; }).then(function(disabled) {
        if (disabled) {
            console.info('[MyAutoPager] 已禁用:', location.hostname);
            // 原本這裡直接 return，連頁碼按鈕都不建立；而「停用本站」的唯一
            // 入口就是那顆按鈕的長按 —— 於是在 iPhone 上停用之後，再也沒有
            // 任何 UI 可以重新啟用，等於永久死掉。留一個常駐提示當復原入口。
            var n = apNotice('已對 ' + location.hostname + ' 停用自動翻頁。點此重新啟用。', 0);
            if (n) n.addEventListener('click', function() { toggleDisable(); });
            return;
        }

        // 頁碼按鈕最先建立：它是使用者在 iPhone 上判斷「腳本到底有沒有在跑」的
        // 唯一可見標記，後面任何一步出錯都不該讓它跟著消失。
        try { createPageNumber(); } catch (e) {}

        // 閱讀樣式：先用預設值套上，儲存值讀回後再套一次。放在停用檢查之後 ——
        // 停用本站時不建立 Aa 按鈕，若仍套樣式，使用者就沒有任何 UI 能關掉它
        try { rsInit(); } catch (e) {}

        // 啟用確認：iPhone 沒有 console，這行是使用者唯一能確認
        // 「腳本有在跑、跑的是哪一版、命中哪條規則」的方式
        var ver = '';
        try { ver = (GM.info && GM.info.script && GM.info.script.version) || ''; } catch (e) {}
        // 頁面守衛狀態一起顯示：被 CSP 擋掉時使用者才知道彈窗攔截只剩 DOM 層
        apNotice('已啟用' + (ver ? ' v' + ver : '') + '（規則：' + matchedKey + '）' +
            (pageGuardOk ? '｜頁面守衛 OK' : '｜頁面守衛被擋（CSP）'), pageGuardOk ? 4000 : 10000);

        try {
            if (curSite.style) insStyle(curSite.style);
            try { cleanContent(getAll(curSite.pager.pageE)); } catch (e) {}
            // installClickGuard / installDomGuard 已在 document-start 階段裝好
            asLoadSpeed();
            asInstallInterrupt();
            asInstallPageTap();
            startScrollWatch();
        } catch (e) {
            // 沒有 console 可看，把錯誤直接顯示在畫面上，否則只會表現為「沒反應」
            apNotice('啟動失敗：' + ((e && e.message) || e), 0);
        }
    });

    });

})();
