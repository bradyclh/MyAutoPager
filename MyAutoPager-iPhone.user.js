// ==UserScript==
// @name         MyAutoPager (iPhone)
// @version      1.3.20
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
// @match        *://look.twword.com/*
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
// @match        *://ttks.tw/*
// @match        *://*.ttks.tw/*
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
            if (t.id === 'Autopage_notice' || (t.closest && t.closest('#Autopage_notice'))) return;

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
    // 我們至少不把它認成啟動手勢
    function asIsInteractive(t) {
        if (!t || t.nodeType !== 1 || !t.closest) return false;
        return !!t.closest('a,button,input,select,textarea,label,summary,[role="button"],[onclick],[contenteditable]');
    }

    // 頁面任意處點兩下＝啟動／停止自動捲頁。
    // 自行以 pointerdown 計時而非監聽 dblclick，才能同時覆蓋觸控與滑鼠，
    // 且不必攔截第一擊的預設行為（選字、點連結都照常）。
    function asInstallPageTap() {
        var lastT = 0, lastX = 0, lastY = 0;
        document.addEventListener('pointerdown', function(e) {
            if (e.isPrimary === false) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            var t = e.target;
            // 腳本自身 UI 有自己的處理器（含調速手勢）
            if (t && t.nodeType === 1 && t.closest && t.closest('#Autopage_number')) return;
            if (asIsInteractive(t)) { lastT = 0; return; }

            var now = performance.now();
            if (now - lastT < AS_TAP_MS &&
                Math.abs(e.clientX - lastX) < AS_TAP_DIST &&
                Math.abs(e.clientY - lastY) < AS_TAP_DIST) {
                lastT = 0;
                // 正在選字（含雙擊選詞）時不搶手勢
                try { var s = window.getSelection(); if (s && !s.isCollapsed) return; } catch (err) {}
                asToggle();
                return;
            }
            lastT = now; lastX = e.clientX; lastY = e.clientY;
        }, true);

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

                if (docH <= vh + st + scrollD) {
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

    // ========== 初始化 ==========

    matchRule();
    if (!curSite) return;

    // 檢查是否被禁用
    isDisabled().then(function(disabled) {
        if (disabled) {
            console.info('[MyAutoPager] 已禁用:', location.hostname);
            // 原本這裡直接 return，連頁碼按鈕都不建立；而「停用本站」的唯一
            // 入口就是那顆按鈕的長按 —— 於是在 iPhone 上停用之後，再也沒有
            // 任何 UI 可以重新啟用，等於永久死掉。留一個常駐提示當復原入口。
            var n = apNotice('已對 ' + location.hostname + ' 停用自動翻頁。點此重新啟用。', 0);
            if (n) n.addEventListener('click', function() { toggleDisable(); });
            return;
        }

        // 啟用確認：iPhone 沒有 console，這行是使用者唯一能確認
        // 「腳本有在跑、跑的是哪一版」的方式
        var ver = '';
        try { ver = (GM.info && GM.info.script && GM.info.script.version) || ''; } catch (e) {}
        apNotice('已啟用' + (ver ? ' v' + ver : '') + '（規則：' + matchedKey + '）', 4000);

        if (curSite.style) insStyle(curSite.style);
        try { cleanContent(getAll(curSite.pager.pageE)); } catch (e) {}
        installClickGuard();
        createPageNumber();
        asLoadSpeed();
        asInstallInterrupt();
        asInstallPageTap();
        startScrollWatch();
    });

})();
