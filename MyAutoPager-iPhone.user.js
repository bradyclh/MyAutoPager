// ==UserScript==
// @name         MyAutoPager (iPhone)
// @version      1.2.0
// @author       clh (based on AutoPager by X.I.U)
// @description  iPhone Safari 小說自動翻頁 — 支援 Safari Userscripts App
// @copyright    Original AutoPager (c) X.I.U (https://github.com/XIU2/UserScript) GPL-3.0
// @license      GPL-3.0
// @inject-into  content
// @run-at       document-end
// @weight       999
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @match        *://look.thisiscm.com/*
// @match        *://uukanshu.cc/*
// @match        *://*.uukanshu.cc/*
// @match        *://69shuba.tw/*
// @match        *://*.69shuba.tw/*
// @match        *://69shuba.com/*
// @match        *://*.69shuba.com/*
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // ========== 彈窗攔截（第一層：覆寫 window.open） ==========
    // 盡早執行，防止頁面腳本保存原始參考
    try {
        Object.defineProperty(window, 'open', {
            value: function(url) {
                console.warn('[MyAutoPager] 攔截 window.open:', url);
                return null;
            },
            writable: false,
            configurable: false
        });
    } catch (e) {
        try { window.open = function(url) { console.warn('[MyAutoPager] 攔截 window.open:', url); return null; }; } catch (e2) {}
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

    function cleanContent(elements) {
        elements.forEach(function(el) {
            el.querySelectorAll(REMOVE_TAGS).forEach(function(n) { n.remove(); });
            stripPopupTriggers(el);
            el.querySelectorAll('div, p').forEach(function(node) {
                if (node.className && AD_CLASS_RE.test(node.className)) { node.remove(); return; }
                var txt = node.textContent.trim();
                if (!txt && node.children.length === 0) { node.remove(); return; }
                if (txt.length < 200) {
                    for (var i = 0; i < PROMO_KEYWORDS.length; i++) {
                        if (txt.indexOf(PROMO_KEYWORDS[i]) > -1) { node.remove(); return; }
                    }
                }
            });
        });
        return elements;
    }

    // 第三層：攔截 document 級別的點擊劫持
    function installClickGuard() {
        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t || t.nodeType !== 1) return;

            // 放行腳本自身 UI
            if (t.id === 'Autopage_number' || (t.closest && t.closest('#Autopage_number'))) return;

            // A. 無條件攔截危險錨點（javascript: 協議 / 跨域 target=_blank）
            var anchor = t.closest ? t.closest('a') : null;
            if (anchor) {
                var rawHref = anchor.getAttribute('href') || '';
                if (rawHref.toLowerCase().replace(/\s/g, '').indexOf('javascript:') === 0) {
                    console.warn('[MyAutoPager] 攔截 javascript: 連結');
                    e.stopPropagation(); e.preventDefault();
                    return;
                }
                if (anchor.getAttribute('target') === '_blank' && anchor.href && isCrossOrigin(anchor.href)) {
                    console.warn('[MyAutoPager] 攔截跨域 _blank 連結:', anchor.href);
                    e.stopPropagation(); e.preventDefault();
                    return;
                }
            }

            // B. 放行 pageE 內容範圍
            if (curSite && curSite.pager.pageE) {
                try {
                    var contentEls = getAll(curSite.pager.pageE);
                    for (var i = 0; i < contentEls.length; i++) {
                        if (contentEls[i].contains(t)) return;
                    }
                } catch (err) {}
            }

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
            host: 'look.thisiscm.com',
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
        }
    };

    // ========== 規則匹配 ==========

    var curSite = null;
    var pausePage = true;
    var pageNum = 1;

    function matchRule() {
        var host = location.hostname;
        var path = location.pathname + location.search;
        for (var key in rules) {
            var rule = rules[key];
            if (host !== rule.host && host.indexOf('.' + rule.host) === -1) continue;
            if (rule.url && !rule.url.test(path)) continue;
            curSite = rule;
            curSite.pageUrl = '';
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
        var next = getOne(curSite.pager.nextL);
        if (!next || !next.href || next.href.slice(0, 4) !== 'http') return '';
        if (next.getAttribute('href')[0] === '#') return '';
        return next.href === curSite.pageUrl ? '' : next.href;
    }

    function fetchNextPage(url) {
        curSite.pageUrl = url;

        // 優先使用 GM_xmlhttpRequest（更好的 cookie 處理）
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                url: url,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml' },
                timeout: 8000,
                onload: function(resp) {
                    try {
                        var charset = document.characterSet || 'utf-8';
                        var html = new TextDecoder(charset).decode(resp.response);
                        processElements(createDoc(html));
                    } catch (e) { console.error('[MyAutoPager] 處理錯誤:', e); }
                },
                onerror: function() { console.log('[MyAutoPager] 載入失敗:', url); },
                ontimeout: function() { curSite.pageUrl = ''; }
            });
        } else {
            // 回退到原生 XMLHttpRequest（同域名可用）
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.overrideMimeType('text/html; charset=' + (document.characterSet || 'utf-8'));
            xhr.timeout = 8000;
            xhr.onload = function() {
                try { processElements(createDoc(xhr.responseText)); }
                catch (e) { console.error('[MyAutoPager] 處理錯誤:', e); }
            };
            xhr.onerror = function() { console.log('[MyAutoPager] 載入失敗:', url); };
            xhr.ontimeout = function() { curSite.pageUrl = ''; };
            xhr.send();
        }
    }

    function processElements(response) {
        var insertP = curSite.pager.insertP || [curSite.pager.pageE, 5];
        var pageE = getAll(curSite.pager.pageE, response, response);
        var toE = (insertP[1] === 5) ? toE5pop(getAll(insertP[0])) : getOne(insertP[0]);

        if (pageE.length > 0 && toE) {
            cleanContent(pageE);

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
            cleanContent(getAll(curSite.pager.pageE));

            if (curSite.afterPage) curSite.afterPage();
        } else if (curSite.pager.retry) {
            setTimeout(function() { curSite.pageUrl = ''; }, curSite.pager.retry);
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
            '#btn{' +
                'top:calc(80vh);left:0;' +
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
            '#btn:active{opacity:0.9;transform:translateX(0)}' +
            '</style>' +
            '<div id="btn" role="button" aria-label="頁碼/暫停翻頁">1</div>';

        pageNumBtn = shadow.querySelector('#btn');

        pageNumBtn.addEventListener('click', function(e) {
            pausePage = !pausePage;
            this.style.color = pausePage ? '' : '#FF5722';
            this.style.fontStyle = pausePage ? '' : 'italic';
            e.preventDefault();
            e.stopPropagation();
        });

        // 長按可禁用當前網站
        var holdTimer = null;
        pageNumBtn.addEventListener('touchstart', function() {
            holdTimer = setTimeout(function() {
                if (confirm('要對 ' + location.hostname + ' 禁用自動翻頁嗎？')) toggleDisable();
            }, 1500);
        });
        pageNumBtn.addEventListener('touchend', function() { clearTimeout(holdTimer); });
        pageNumBtn.addEventListener('touchmove', function() { clearTimeout(holdTimer); });
    }

    function updatePageNumber() {
        if (pageNumBtn) pageNumBtn.textContent = pageNum;
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
                if (st <= prevST || !pausePage) { prevST = st; return; }
                prevST = st;

                var vh = window.innerHeight;
                var docH = document.documentElement.scrollHeight;

                if (docH <= vh + st + scrollD) {
                    pausePage = false;
                    setTimeout(function() { pausePage = true; }, interval);
                    var url = getNextUrl();
                    if (url) fetchNextPage(url);
                }
            }, { passive: true });
        }, 1000);
    }

    // ========== 初始化 ==========

    matchRule();
    if (!curSite) return;

    // 檢查是否被禁用
    isDisabled().then(function(disabled) {
        if (disabled) { console.info('[MyAutoPager] 已禁用:', location.hostname); return; }

        if (curSite.style) insStyle(curSite.style);
        try { cleanContent(getAll(curSite.pager.pageE)); } catch (e) {}
        installClickGuard();
        createPageNumber();
        startScrollWatch();
    });

})();
