// ==UserScript==
// @name         MyAutoPager (iPhone)
// @version      1.3.11
// @updateURL    https://raw.githubusercontent.com/bradyclh/MyAutoPager/main/MyAutoPager-iPhone.user.js
// @downloadURL  https://raw.githubusercontent.com/bradyclh/MyAutoPager/main/MyAutoPager-iPhone.user.js
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
// @match        *://uuread.tw/*
// @match        *://*.uuread.tw/*
// @match        *://tw.hjwzw.com/*
// @match        *://www.hjwzw.com/*
// @match        *://ixdzs.hk/*
// @match        *://*.ixdzs.hk/*
// @match        *://ixdzs.tw/*
// @match        *://*.ixdzs.tw/*
// @match        *://ixdzs8.com/*
// @match        *://*.ixdzs8.com/*
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
        }
        // thepaperbooks（8book 系小說站）：真實內文由站方混淆 script 在瀏覽器
        // 渲染（伺服器對非瀏覽器請求偽裝成關鍵字農場頁），需要 iframe 擷取
        // （桌面版 type 6）。本引擎僅支援 XHR 模式，暫不支援此站。
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
            // host 支援字串或陣列（同一平台多網域，如 ixdzs 三站）
            var hosts = Array.isArray(rule.host) ? rule.host : [rule.host];
            var hostOk = hosts.some(function(h) { return host === h || host.indexOf('.' + h) !== -1; });
            if (!hostOk) continue;
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
