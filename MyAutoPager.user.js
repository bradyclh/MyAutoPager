// ==UserScript==
// @name         MyAutoPager
// @version      1.2.21
// @updateURL    https://raw.githubusercontent.com/bradyclh/MyAutoPager/main/MyAutoPager.user.js
// @downloadURL  https://raw.githubusercontent.com/bradyclh/MyAutoPager/main/MyAutoPager.user.js
// @author       clh (based on AutoPager by X.I.U)
// @description  自動無縫翻頁 — 將下一頁內容無縫載入至網頁底部
// @copyright    Original AutoPager (c) X.I.U (https://github.com/XIU2/UserScript) GPL-3.0
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
// @connect      thepaperbooks.com
// @license      GPL-3.0
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

    // 不在自身的擷取 iframe（type 6）內運作：Tampermonkey 會把腳本注入
    // 子框架，而擷取流程會捲動 iframe 內容，觸發框內實例自我翻頁——
    // 造成巢狀 iframe、章節跳號與互相干擾。
    try {
        if (window.name === 'Autopage_iframe') return;
        if (window.frameElement && window.frameElement.id === 'Autopage_iframe') return;
    } catch (e) { /* 跨域 frameElement 取用失敗可忽略，window.name 已涵蓋 */ }


    // ========== 彈窗攔截：條件式閘道 ==========
    // 此腳本 @match */*，攔截僅在匹配到帶 popupBlock 旗標的規則後啟用，避免破壞一般站點（如 OAuth popup）。
    // 限制：@run-at document-end，覆寫僅能攔截本腳本執行後才發生的 window.open 呼叫；
    //       頁面 <head> 中同步 inline 腳本保存的原始參考不受影響（結構性限制）。
    // 另一限制：SPA 離開小說站後，先前被中和過的錨點（data-blocked-href）不會自動還原 —
    //         當前四個小說站皆全頁刷新，非 SPA，此情境不觸發。
    var popupBlockEnabled = false;

    (function earlyOpenOverride() {
        var orig = window.open;
        try {
            Object.defineProperty(window, 'open', {
                value: function(url, target, features) {
                    if (popupBlockEnabled) {
                        console.warn('[MyAutoPager] 攔截 window.open:', url);
                        return null;
                    }
                    try { return orig.apply(window, arguments); } catch (e) { return null; }
                },
                writable: false,
                configurable: true // 允許後續清理或換手段，不鎖死
            });
        } catch (e) {
            try {
                window.open = function(url) {
                    if (popupBlockEnabled) { console.warn('[MyAutoPager] 攔截 window.open:', url); return null; }
                    return orig.apply(window, arguments);
                };
            } catch (e2) {}
        }
    })();


    // ========== 相容性 polyfill ==========

    // 相容不支援 GM_openInTab 的使用者腳本管理器
    if (typeof GM_openInTab === 'undefined') {
        window.GM_openInTab = function(url) { window.open(url); };
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
        ['menu_customRules', '自定義翻頁規則', '自定義翻頁規則', {}],
        ['menu_autoScrollSpeed', '自動捲頁速度', '自動捲頁速度', 40]
    ];
    // 翻頁閘門由兩個獨立旗標組成，不可再合併為一個：
    //   userPaused — 使用者意圖（頁碼按鈕左鍵切換），只有使用者能改
    //   pagerBusy  — 機器狀態（interval 節流窗、type 6 iframe 擷取互斥），只有流程能改
    // 兩者混用時，節流計時器會擦掉使用者的暫停、使用者點擊也會解開機器鎖。
    var menuId = [], curSite = {SiteTypeID: 0}, DBSite, DBSite2, DBSiteNow,
        userPaused = false, pagerBusy = false, pageNum = {now: 1, _now: 1},
        urlC = false, nowLocation = '', lp = location.pathname;

    // 初始化 GM 存儲
    for (let i = 0; i < menuAll.length; i++) {
        if (GM_getValue(menuAll[i][0]) == null) GM_setValue(menuAll[i][0], menuAll[i][3]);
    }

    function isUrlC() { urlC = true; }

    // ========== 內建規則 ==========

    function setDBSite() {
        DBSite = {
            // ---- 個人自訂規則 ----
            novel543: {
                host: ['look.thisiscm.com', 'look.twword.com'],
                url: "/\\d+_\\d+/",
                style: 'ins.clickforceads, iframe.cfadif, div[id*="tam-ad"], div[id*="cfad"], ad {display: none !important;}',
                history: true, popupBlock: true,
                pager: {
                    nextL: '(//a[contains(text(),"下一章")])[last()]',
                    pageE: '.chapter-content',
                    replaceE: '.foot-nav',
                    scrollD: 3000
                },
                function: {
                    bF: function(pageE) { return cleanContent(pageE); },
                    aF: function() { cleanContent(getAll('.chapter-content')); var first = document.querySelector('.chapter-content .content'); if (first && first.style.fontSize) { var all = document.querySelectorAll('.chapter-content .content'); for (var i = 1; i < all.length; i++) { all[i].style.fontSize = first.style.fontSize; } } }
                }
            },
            uukanshu: {
                host: 'uukanshu.cc',
                style: '.▶, iframe[src*="political-effort"], script[src*="political-effort"], script[src*="grown-mouth"]',
                history: true, retry: 3000, popupBlock: true,
                pager: { nextL: '#linkNext', pageE: '.readcotent', replaceE: '.mulu-box', scrollD: 3000 },
                function: {
                    bF: function(pageE) { return cleanContent(pageE); },
                    aF: "const els = document.querySelectorAll('.readcotent'); if (els.length > 1) els[els.length - 1].className = els[0].className;"
                }
            },
            '69shuba': {
                host: '69shuba.tw',
                style: 'div[id*="pf-"], script[src*="novelapis"], script[src*="pubfuture"], .ad, iframe {display: none !important;} #nr1, #nr1 * {text-align: center !important; font-size: 36px !important; line-height: 1.8 !important; color: #999 !important;} .nr_title {text-align: center !important; font-size: 24px !important; color: #ddd !important; display: block !important; margin: 20px 0 !important;}',
                history: true, retry: 3000, popupBlock: true,
                pager: { nextL: '#pb_next', pageE: '.nr_title, .nr_nr', replaceE: '.nr_page', scrollD: 3000 },
                function: {
                    bF: function(pageE) { return cleanContent(pageE); }
                }
            },
            '69shuba_com': {
                host: '/69shuba\\.com/',
                style: '.yueduad1, div[id*="ad-"], script[src*="novelapis"], script[src*="pubfuture"], .ad, iframe {display: none !important;} .txtnav {text-align: center !important; font-size: 36px !important; line-height: 1.8 !important; color: #999 !important;} h1.hide720 {text-align: center !important; font-size: 24px !important; color: #ddd !important; display: block !important; margin: 20px 0 !important;}',
                history: true, retry: 3000, popupBlock: true,
                pager: { nextL: '.page1 a:last-child', pageE: '.txtnav', replaceE: '.page1', scrollD: 3000 },
                function: {
                    bF: function(pageE) { return cleanContent(pageE); }
                }
            },
            uuread: {
                host: '/(^|\\.)uuread\\.tw$/',
                url: "/\\/chapter\\//",
                history: true, retry: 3000, popupBlock: true,
                pager: {
                    nextL: "(//div[contains(@class,'operate')]//a[contains(text(),'下一頁') or contains(text(),'下一章')])[last()]",
                    pageE: '.play-title, #nr',
                    replaceE: '.operate',
                    scrollD: 2000
                },
                function: {
                    bF: function(pageE) { return cleanContent(pageE); },
                    aF: function() {
                        // uuread 字體大小由客戶端 JS 套 inline style，XHR 取得的新頁沒有，
                        // 把首個 #nr 的 font-size 複製到後續插入的內容。
                        var all = document.querySelectorAll('.txt_tcontent');
                        if (all.length > 1 && all[0].style.fontSize) {
                            for (var i = 1; i < all.length; i++) all[i].style.fontSize = all[0].style.fontSize;
                        }
                    }
                }
            },
            qimao: {
                host: '/(^|\\.)qimao\\.com$/',
                // 只匹配真正的章節閱讀頁（reader/index/<書號> 或 shuku/<書號>-<章號>），
                // 避免在書庫 /shuku/ 或書籍詳情 /shuku/<書號>/ 頁無謂啟用 popupBlock。
                url: "/^\\/(reader\\/index\\/\\d+|shuku\\/\\d+-)/",
                // initSite 清理原始頁時同樣保護正文短句
                cleanOpts: { keepText: '.article' },
                history: true, retry: 3000, popupBlock: true,
                pager: {
                    // 下一章按鈕位於 .reader-footer，連結到 /shuku/ 路徑
                    nextL: "(//div[contains(@class,'reader-footer')]//a[contains(text(),'下一章') or contains(text(),'下一页') or contains(text(),'下一頁')])[last()]",
                    // 載入章節標題（.chapter-title）與正文（.chapter-detail-article，含字體 class）
                    pageE: '.chapter-title, .chapter-detail-article',
                    replaceE: '.reader-footer',
                    scrollD: 2000
                },
                function: {
                    // keepText: '.article' 讓 cleanContent 不對正文段落套用促銷關鍵字刪除，
                    // 避免誤刪含「VIP」等字樣的短句正文（七猫正文一句一個 <p>）。
                    bF: function(pageE) { return cleanContent(pageE, {keepText: '.article'}); },
                    aF: function() {
                        var all = document.querySelectorAll('.chapter-detail-article');
                        if (!all.length) return;
                        var last = all[all.length - 1];
                        // 付費牆偵測：七猫對免費試讀範圍外的章節以 <div class="qm-canvas-txt"> 渲染，
                        // .chapter-detail-article 內無 <p> 正文，但 .chapter-title 與下一章連結仍在，
                        // 若不處理引擎會無限附加「只有標題的空章節」。偵測到即移除空章節並停止翻頁。
                        if (last.querySelector('.qm-canvas-txt') || last.querySelectorAll('p').length === 0) {
                            if (all.length > 1) last.remove();
                            var titles = document.querySelectorAll('.chapter-title');
                            if (titles.length > 1) titles[titles.length - 1].remove();
                            // 斷開 live footer 的下一章連結 → getNextE 從 live DOM 讀不到 → 乾淨停止
                            document.querySelectorAll('.reader-footer a').forEach(function(a) {
                                if (/下一章|下一页|下一頁/.test(a.textContent)) a.remove();
                            });
                            return;
                        }
                        // 正常頁：七猫字體大小由 .chapter-detail-article 上的 font-XX class 控制，
                        // XHR 取得的新頁為預設值；把首章的 font-XX class 複製到後續插入的內容。
                        if (all.length > 1) {
                            var fontClass = (all[0].className.match(/font-\d+/) || [])[0];
                            if (fontClass) {
                                for (var i = 1; i < all.length; i++) {
                                    all[i].className = all[i].className.replace(/\bfont-\d+\b/, '').trim() + ' ' + fontClass;
                                }
                            }
                        }
                    }
                }
            },
            hjwzw: {
                // 黃金屋中文（繁體 tw. / 簡體 www.）。手機站 t. / m. 版面與下一章機制不同，不在此規則範圍。
                host: '/^(tw|www)\\.hjwzw\\.com$/',
                // 只匹配章節閱讀頁 /Book/Read/<書號>,<章號>
                url: "/^\\/Book\\/Read\\/\\d+,\\d+/",
                // initSite 清理原始頁時同樣保護正文短句
                cleanOpts: { keepText: 'div[style*="text-indent"]' },
                history: true, retry: 3000, popupBlock: true,
                pager: {
                    // 底部導覽列「上一章 | 目錄 | 下一章」；最後一章該處為純文字「末頁」而非連結，
                    // 取不到 href 即自然停止翻頁，不需額外的結尾偵測。
                    nextL: "(//a[contains(text(),'下一章')])[last()]",
                    // 站方版面全用 inline style，正文容器沒有 class/id：
                    // 標題取頁面上唯一的 <h1>，正文取帶 text-indent 的 div。
                    // 同款 style 的 div 有兩個，第二個只有「請記住本站域名」頁尾，
                    // 以字數門檻排除（不用 [1] 位置條件，否則插入後仍指向首章而插錯位置）。
                    pageE: "//h1 | //div[contains(@style,'text-indent: 2em') and string-length(normalize-space(.)) > 100]",
                    replaceE: "//div[contains(@style,'width: 1000px') and contains(@style,'font-size: 20px')]",
                    scrollD: 2000
                },
                function: {
                    bF: function(pageE) {
                        pageE.forEach(function(el) {
                            if (!el.getAttribute || (el.getAttribute('style') || '').indexOf('text-indent') === -1) return;
                            // 每章正文開頭固定重複「請記住本站域名: 黃金屋」與「書名 章節名」兩行，
                            // 插入時移除，避免夾在連續章節之間打斷閱讀。
                            if (!el.querySelector('p')) return;   // 無 <p> 的異常版面不動，避免整章被清空
                            while (el.firstChild && !(el.firstChild.nodeType === 1 && el.firstChild.tagName === 'P')) {
                                el.firstChild.remove();
                            }
                            var first = el.querySelector('p');
                            if (first && first.querySelector('a[href*="/Book/"]')) first.remove();
                        });
                        // keepText 讓 cleanContent 不對正文段落套用促銷關鍵字刪除（正文一句一個 <p>，
                        // 短句若含「VIP」等字樣會被誤刪）。
                        return cleanContent(pageE, {keepText: 'div[style*="text-indent"]'});
                    }
                }
            },
            thepaperbooks: {
                // 小說站（8book 系）。伺服器對爬蟲/無頭瀏覽器偽裝（cloaking）成
                // 論文書籍關鍵字農場頁；真實瀏覽器中由內嵌混淆 script 渲染出
                // 小說閱讀器：標題 #subtitle、內文 #text（單一大 <p>）、
                // 上下導覽 .read-top-set / .read_bottom（含「上一篇/章節列表/下一篇」）。
                // XHR 取回的 HTML 中 #text 為空（內文只能由該 script 在瀏覽器渲染），
                // 故用 type 6：隱藏 iframe 載入下一章（同源 ?<章節號>），
                // 待站方 JS 渲染完成後自 iframe 文件擷取插入。
                host: '/(^|\\.)thepaperbooks\\.com$/',
                url: "/^\\/read\\/\\d+/",
                history: true, retry: 3000, popupBlock: true,
                // initSite 的 popupBlock 清理保護單一大 <p> 正文
                cleanOpts: { keepText: '#text' },
                pager: {
                    type: 6,
                    // 殼層防護：使用者環境可能是「殼層頁 + 閱讀器 iframe」雙框架，
                    // 兩者的 URL 都是 /read/ 形式、都會匹配本規則。只有閱讀器
                    // 框架有 #text；殼層框架安靜停用，避免空轉重試洗版。
                    nextL: function() {
                        if (!document.querySelector('#text')) {
                            if (!window.__tpbShellLogged) {
                                window.__tpbShellLogged = true;
                                console.info('[MyAutoPager] 本框架無閱讀器容器（殼層頁），停用翻頁；閱讀器框架將接手');
                            }
                            return '';
                        }
                        var a = getXpath("(//a[contains(text(),'下一篇')])[last()]");
                        return (a && a.href && a.href.slice(0, 4) === 'http') ? a.href : '';
                    },
                    pageE: '#subtitle, #text',
                    replaceE: '.read-top-set, .read_bottom',
                    // 等待 iframe 內混淆 script 渲染內文
                    loadTime: 1500,
                    scrollD: 2000
                },
                function: {
                    bF: function(pageE) {
                        // iframe 若拿到未渲染/偽裝版（#text 為空——站方對高頻請求
                        // 會降級供應），放棄本次插入交由引擎重試，避免插入空章節
                        var txt = pageE.filter(function(el) { return el.id === 'text'; })[0];
                        if (!txt || txt.textContent.replace(/\s+/g, '').length < 50) {
                            console.warn('[MyAutoPager] 下一章內文尚未渲染（可能為偽裝/降級頁），放棄本次擷取');
                            return [];
                        }
                        // 擷取內容可能已被站方後插廣告容器，清理；keepText 保護正文
                        return cleanContent(pageE, {keepText: '#text'});
                    },
                    aF: function() {
                        // 同步站方閱讀記錄：站方腳本只在頂層視窗寫 localStorage
                        // 'history'（值格式 items:[{id,url,eps}]，每書一筆、記最後
                        // 閱讀章節；目錄頁的「瀏覽記錄」讀取此值），我們的章節
                        // 經 iframe 載入不會被記錄，插入後在頂層照原格式補寫。
                        try {
                            var book = (location.pathname.match(/read\/(\d+)/) || [])[1];
                            var ch = (curSite.pageUrl.match(/\?(\d+)/) || [])[1];
                            if (!book || !ch) return;
                            var subs = document.querySelectorAll('#subtitle');
                            var eps = subs.length ? subs[subs.length - 1].textContent.trim() : '';
                            var items = [];
                            try { items = JSON.parse((localStorage.getItem('history') || 'items:[]').replace(/^items:/, '')); } catch (e2) {}
                            // 站方以 8book.com 網址記錄（sport. 子網域上亦然），沿用其格式
                            var url = 'https://8book.com/read/' + book + '/?' + ch + '_1';
                            var hit = false;
                            for (var i = 0; i < items.length; i++) {
                                if (String(items[i].id) === book) { items[i].url = url; items[i].eps = eps; hit = true; break; }
                            }
                            if (!hit) items.unshift({ id: book, url: url, eps: eps });
                            localStorage.setItem('history', 'items:' + JSON.stringify(items));
                        } catch (e) { /* 記錄失敗不影響翻頁 */ }
                    }
                }
            },

            ixdzs: {
                // 愛下電子書（繁中 .hk/.tw、簡中 ixdzs8.com，同一平台）
                host: '/(^|\\.)(ixdzs\\.hk|ixdzs\\.tw|ixdzs8\\.com)$/',
                url: "/^\\/read\\/\\d+\\/p\\d+\\.html/",
                history: true, retry: 3000, popupBlock: true,
                // 正文一句一個 <p>，keepText 防推廣關鍵字誤刪
                cleanOpts: { keepText: '.page-content section' },
                pager: {
                    // 末章的下一章連結指向 end.html（完本頁），[href*="/p"] 排除之
                    // → nextL 落空即乾淨停止
                    nextL: 'a.chapter-next[href*="/p"]',
                    // 含 <h3> 章節標題與 <section> 正文
                    pageE: 'article.page-content',
                    replaceE: '.page-turn',
                    scrollD: 2000
                },
                function: {
                    bF: function(pageE) { return cleanContent(pageE, {keepText: '.page-content section'}); }
                }
            },
            ttks: {
                // 天天看小說（AMP 頁面，正文與上下章導航各自是一個 .content）
                host: '/(^|\\.)ttks\\.tw$/',
                url: "/^\\/novel\\/chapters\\/[^\\/]+\\/\\d+\\.html/",
                // 段落間插入的文字廣告與版面廣告槽
                style: '.txtad, ins.pubadx-slot, div[id^="supr-ad-container"] {display: none !important;}',
                history: true, retry: 3000, popupBlock: true,
                // 正文一句一個 <p>，keepText 防推廣關鍵字誤刪
                cleanOpts: { keepText: '.content' },
                pager: {
                    // 末章的下一章連結指向目錄 index.html，:not 排除之 → nextL 落空即乾淨停止
                    nextL: '#linkNext:not([href*="index.html"])',
                    // .frame_body 下有兩個 .content（正文、上下章導航），用 :has 區分；
                    // .title 內是章節標題 <h1>
                    pageE: '.frame_body > .title, .frame_body > .content:not(:has(.next_page))',
                    replaceE: '.frame_body > .content:has(.next_page)',
                    scrollD: 2000
                },
                function: {
                    bF: function(pageE) {
                        // 正文尾端的功能列（添加書籤／返回目錄／分享）每章都有，
                        // 不移除的話每翻一章就重複堆一組。
                        pageE.forEach(function(el) {
                            el.querySelectorAll('.div_feedback, .social_share_frame, .txtad').forEach(function(n) { n.remove(); });
                        });
                        return cleanContent(pageE, {keepText: '.content'});
                    },
                    aF: function() {
                        // 站方以 inline color 控制 12 種配色：正文 <p> 的 color 由伺服器輸出，
                        // 但章節標題 <h1> 的 color 是客戶端 JS 載入後才補上的，XHR 取得的新頁沒有，
                        // 插入的標題會掉回站方 CSS 預設色（深藍灰），與首章的黑色不一致。
                        var h1s = getAll('.frame_body > .title h1');
                        var titleColor = h1s.length ? h1s[0].style.color : '';
                        if (titleColor) {
                            for (var i = 1; i < h1s.length; i++) h1s[i].style.color = titleColor;
                        }
                        // 使用者切換配色後才插入的章節，正文仍是伺服器預設色，一併同步。
                        // （切換當下站方會重套現有 DOM，故只需處理之後插入的內容）
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
            },

            // ---- 搜尋引擎 ----
            google: {
                host: '/^www\\.google\\./i',
                url: function() { urlC = true; if (lp === '/search') { curSite = DBSite.google; } },
                style: '#botstuff',
                history: true,
                pager: {
                    nextL: 'a#pnnext, a[aria-label="Next"], a[aria-label="下一頁"], a[aria-label="下一页"]',
                    pageE: '#rso > div',
                    replaceE: '#botstuff'
                }
            },
            "必應搜索": {
                host: ['www.bing.com', 'cn.bing.com', 'www4.bing.com', 'global.bing.com'],
                url: function() { urlC = true; if (lp == '/search') { curSite = DBSite["必應搜索"]; if (isMobile()) { curSite.blank = 3; curSite.pager.type = 6; curSite.pager.loadTime = 1500; curSite.pager.scrollD = 3000; } } },
                style: '#b_footer,.b_msg,#bnp_rich_div,.cn_related_search_upsell_container',
                history: true,
                pager: {
                    nextL: 'a.sb_pagN,a.sb_halfnext,a.sb_fullnpl',
                    pageE: '#b_results>li.b_algo',
                    replaceE: '#b_results>.b_pag,#b_PagAboveFooter'
                },
                function: {
                    bF: function(pageE) { pageE.forEach(function (one) { getAllCSS('div.rms_iac[data-src]', one).forEach(function (one1) { one1.outerHTML = '<img src="' + one1.dataset.src + '" height="32" width="32" role="presentation" class="rms_img">'; }); }); return pageE; }
                }
            },
            baidu: {
                host: 'www.baidu.com',
                url: function() { if (lp === '/s') { curSite = DBSite.baidu; } },
                style: '#page, #rs_new, #searchTag',
                history: true,
                pager: {
                    nextL: '#page a.n, a.page-inner_2jZi2+a',
                    pageE: '#content_left > div.result, #content_left > div.c-container',
                    replaceE: '#page, #rs_new'
                }
            },
            sogou: {
                host: 'www.sogou.com',
                url: function() { if (lp === '/web' || lp === '/sogou') { curSite = DBSite.sogou; } },
                style: '#pagebar_container',
                history: true,
                pager: {
                    nextL: 'a#sogou_next, a#pager_next, a[id="sogou_next"]',
                    pageE: '.results .vrwrap, .results .rb',
                    replaceE: '#pagebar_container'
                }
            },
            duckduckgo: {
                host: '/^(www\\.)?duckduckgo\\.com$/i',
                url: function() { if (lp === '/') { curSite = DBSite.duckduckgo; } },
                pager: {
                    type: 2,
                    nextL: 'a[data-testid="next"], button#more-results, a.result--more__btn',
                    isHidden: true,
                    interval: 1000
                }
            },

            // ---- CMS 通用規則 ----
            wp_article: {
                host: '/./i',
                url: function() {
                    if (!getCSS('link[href*="/wp-content/" i], script[src*="/wp-content/" i], link[href*="/wp-includes/" i], script[src*="/wp-includes/" i], head>meta[name=generator][content*="WordPress" i]')) return false;
                    if (!indexOF('/post/') && !getCSS('#comments, .comments-area, #disqus_thread')) {
                        // 偵測下一頁連結
                        if (getCSS('a.next, a.next-page')) {
                            curSite = DBSite.wp_article; curSite.pager.nextL = 'a.next, a.next-page';
                        } else if (getCSS('a[rel="next" i], a[aria-label="next" i], a[aria-label="Next Page" i], a[aria-label="下一頁"], a[title="下一頁"]')) {
                            curSite = DBSite.wp_article; curSite.pager.nextL = 'a[rel="next" i], a[aria-label="next" i], a[aria-label="Next Page" i], a[aria-label="下一頁"], a[title="下一頁"]';
                        } else if (getCSS('li.next-page > a, li.next > a, li.pagination-next>a')) {
                            curSite = DBSite.wp_article; curSite.pager.nextL = 'li.next-page > a, li.next > a, li.pagination-next>a';
                        } else if (getCSS('span.current+a')) {
                            curSite = DBSite.wp_article; curSite.pager.nextL = 'span.current+a';
                        } else if (getCSS('.nav-previous a, a.nav-previous')) {
                            curSite = DBSite.wp_article; curSite.pager.nextL = '.nav-previous a, a.nav-previous';
                        } else {
                            return false;
                        }
                        // 偵測 pageE
                        if (getAllCSS('article[id^="post-"]').length > 3) {
                            curSite.pager.pageE = 'article[id^="post-"]';
                        } else if (getAllCSS('article[class]').length > 3) {
                            curSite.pager.pageE = 'article[class]';
                        } else if (getAllCSS('div[id^="post-"]').length > 3) {
                            curSite.pager.pageE = 'div[id^="post-"]';
                        } else if (getAllCSS('.post').length > 3) {
                            curSite.pager.pageE = '.post';
                        } else {
                            return false;
                        }
                    } else {
                        return false;
                    }
                },
                style: 'img[data-src], img[data-original] {opacity: 1 !important;}',
                blank: 3,
                pager: {
                    replaceE: '#nav-below, nav.navigation, nav.paging-navigation, #pagination:not([class*="entry"]), .pagination:not([class*="entry"]), .wp-pagenavi, .pagenavi, nav[role="navigation"], ul[class*="-pagination"]',
                    forceHTTPS: true,
                    scrollD: 3000
                },
                function: {
                    bF: src_bF
                }
            },
            wp_article_post: {
                host: '/./i',
                url: function() {
                    if (!getCSS('link[href*="/wp-content/" i], script[src*="/wp-content/" i], link[href*="/wp-includes/" i], script[src*="/wp-includes/" i], head>meta[name=generator][content*="WordPress" i]')) return false;
                    if (getXpath('(//*[contains(@class, "post-page-numbers") and contains(@class, "current")])[last()]/following-sibling::a[1]')) {
                        curSite = DBSite.wp_article_post;
                        curSite.pager.nextL = '(//*[contains(@class, "post-page-numbers") and contains(@class, "current")])[last()]/following-sibling::a[1]';
                        curSite.pager.replaceE = '//a[contains(@class,"post-page-numbers")]/..';
                        // 偵測 pageE
                        if (getAllCSS('.entry-content').length == 1) {
                            curSite.pager.pageE = '.entry-content>*:not(.page-links):not(.post-links):not(.pagination):not(footer):not([class*=pagination])';
                        } else if (getAllCSS('.article-content').length == 1) {
                            curSite.pager.pageE = '.article-content>*:not(.page-links):not(.post-links):not(.pagination):not(footer):not([class*=pagination])';
                        } else if (getAllCSS('article').length == 1) {
                            curSite.pager.pageE = 'article>*:not(.page-links):not(.post-links):not(.pagination):not(footer):not([class*=pagination])';
                        } else {
                            return false;
                        }
                    } else {
                        return false;
                    }
                },
                pager: {
                    type: 1,
                    scrollD: 3000
                },
                function: {
                    bF: src_bF
                }
            },
            discuz_guide: {
                host: '/./i',
                url: function() {
                    if (!getCSS('head>meta[name="generator" i][content*="Discuz" i]') && !getCSS('body[id="nv_forum"][class^="pg_"]')) return false;
                    if (getCSS('a.nxt:not([href^="javascript"]), a.next:not([href^="javascript"])') && getCSS('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')) {
                        curSite = DBSite.discuz_guide;
                    } else {
                        return false;
                    }
                },
                pager: {
                    nextL: 'a.nxt:not([href^="javascript"]) ,a.next:not([href^="javascript"])',
                    pageE: 'tbody[id^="normalthread_"],tbody[id^="stickthread_"]',
                    replaceE: '.pg, .pages',
                    forceHTTPS: true
                }
            },
            discuz_thread: {
                host: '/./i',
                url: function() {
                    if (!getCSS('head>meta[name="generator" i][content*="Discuz" i]') && !getCSS('body[id="nv_forum"][class^="pg_"]')) return false;
                    if (getCSS('a.nxt:not([href^="javascript"]), a.next:not([href^="javascript"])') && getCSS('#postlist > div[id^="post_"], form>.viewthread')) {
                        curSite = DBSite.discuz_thread;
                    } else {
                        return false;
                    }
                },
                thread: true,
                style: '.pgbtn, .viewthread:not(:first-of-type)>h1, .viewthread:not(:first-of-type)>ins, .viewthread:not(:first-of-type)>.headactions {display: none;}',
                pager: {
                    nextL: 'a.nxt:not([href^="javascript"]) ,a.next:not([href^="javascript"])',
                    pageE: '#postlist > div[id^="post_"], form>.viewthread',
                    replaceE: '//div[contains(@class,"pg") or contains(@class,"pages")][./a[contains(@class,"nxt") or contains(@class,"next") or contains(@class,"prev")][not(contains(@href,"javascript") or contains(@href,"commentmore"))]]',
                    forceHTTPS: true
                },
                function: {
                    bF: src_bF,
                    bFp: [0, 'img[file]', 'file']
                }
            },

            // ---- 常用網站 ----
            zhihu: {
                host: 'www.zhihu.com',
                url: function() { urlC = true; if (indexOF('/search') || indexOF('/topic') || indexOF('/collection')) { curSite = DBSite.zhihu; } },
                pager: {
                    type: 2,
                    nextL: 'button.QuestionMainAction, a[data-za-detail-view-element_name="NextPage"], a[rel="next"]',
                    isHidden: true,
                    interval: 1000
                }
            },
            github: {
                host: 'github.com',
                url: function() { urlC = true; if (indexOF('/issues') || indexOF('/discussions') || indexOF('/pulls') || indexOF('/search')) { curSite = DBSite.github; } },
                pager: {
                    nextL: 'a.next_page, a[rel="next"]',
                    pageE: 'div[id^="issue_"], div.js-navigation-container > div, div[data-testid="results-list"] > div',
                    replaceE: '.paginate-container, nav[aria-label="Pagination"]'
                }
            },
            greasyfork: {
                host: '/^(www\\.)?greasyfork\\.org$/i',
                url: function() { if (indexOF('/scripts') || indexOF('/users')) { curSite = DBSite.greasyfork; } },
                blank: 4,
                pager: {
                    nextL: 'li.pagination-next > a, a[rel="next"]',
                    pageE: '#browse-script-list > li, ol.script-list > li',
                    replaceE: '.pagination'
                }
            },
            stackoverflow: {
                host: '/stackoverflow\\.com|stackexchange\\.com|superuser\\.com|serverfault\\.com|askubuntu\\.com/i',
                url: function() { if (indexOF('/questions') || indexOF('/search')) { curSite = DBSite.stackoverflow; } },
                blank: 4,
                pager: {
                    nextL: 'a[rel="next"]',
                    pageE: '#questions .s-post-summary, .js-search-results .s-post-summary, #question-mini-list .s-post-summary',
                    replaceE: '.s-pagination'
                }
            },
            v2ex: {
                host: '/^(www\\.)?v2ex\\.com$/i',
                url: function() { urlC = true; if (lp === '/' || indexOF('/go/') || indexOF('/recent') || indexOF('/t/')) { curSite = DBSite.v2ex; } },
                pager: {
                    nextL: 'a.page_normal:last-of-type, a.page_current+a',
                    pageE: '.cell.item, div[id^="r_"]',
                    replaceE: '.cell:last-of-type .page_normal, .cell:last-of-type .page_current'
                }
            }
        };
    }
    setDBSite();

    // ========== 規則合併 ==========

    function mergeRules() {
        let _customRules = GM_getValue('menu_customRules', {});
        if (Object.prototype.toString.call(_customRules) !== '[object Object]') _customRules = {};
        let _customKeys = Object.keys(_customRules);

        if (_customKeys.length === 0) {
            DBSite2 = JSON.parse(JSON.stringify(DBSite));
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
            DBSite2 = Object.assign({}, JSON.parse(JSON.stringify(_customRules)), JSON.parse(JSON.stringify(DBSite)));
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
        const disableList = GM_getValue('menu_disable', []);
        const isDisabled = disableList.indexOf(location.hostname) !== -1;

        for (let key in DBSite) {
            let rule = DBSite[key];
            DBSiteNow = rule;

            // 1. host 匹配
            if (!matchHost(rule.host)) continue;

            // 2. url 匹配（可選）
            if (rule.url !== undefined && !matchUrl(rule.url, rule)) continue;

            // 3. 禁用清單
            if (isDisabled) {
                curSite = {SiteTypeID: 0};
                return;
            }

            curSite = rule;
            console.info('[MyAutoPager] 匹配規則:', key);
            return;
        }
    }

    function matchSingleHost(h) {
        if (typeof h === 'string' && h.charAt(0) === '/' && h.charAt(h.length - 1) === '/') {
            return new RegExp(h.slice(1, -1)).test(location.hostname);
        }
        return location.hostname === h;
    }

    function matchHost(host) {
        if (!host) return false;
        if (typeof host === 'string') return matchSingleHost(host);
        if (Array.isArray(host)) return host.some(matchSingleHost);
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

    // 滾動事件監聯（延遲 1 秒啟動，避免頁面載入時立即觸發）
    var _scrollHandler = null; // 防止 SPA 導航時重複註冊
    function windowScroll(fn1) {
        var beforeScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
            fn = fn1 || function () {};

        // 移除上一次的 scroll handler（SPA 重新匹配規則時）
        if (_scrollHandler) {
            window.removeEventListener('scroll', _scrollHandler, false);
            _scrollHandler = null;
        }

        setTimeout(function () {
            // 避免網頁內容太少，高度撐不起滾動條而無法觸發翻頁
            let scrollTop = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                scrollHeight = window.innerHeight || document.documentElement.clientHeight;
            if (scrollTop === 0 && document.documentElement.scrollHeight === scrollHeight) {
                insStyle(`html, body {min-height: ${document.documentElement.scrollHeight + 10}px;}`);
            }

            _scrollHandler = function (e) {
                var afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
                    delta = afterScrollTop - beforeScrollTop;
                if (delta == 0) return false;
                fn(delta > 0 ? 'down' : 'up', e);
                beforeScrollTop = afterScrollTop;
            };
            window.addEventListener('scroll', _scrollHandler, false);
        }, 1000);
    }

    // 翻頁間隔節流（機器狀態；不動 userPaused，故不會擦掉使用者的暫停）
    function intervalPause() {
        if (curSite.pager && curSite.pager.interval) {
            pagerBusy = true;
            setTimeout(function() { pagerBusy = false; }, curSite.pager.interval);
        }
    }

    // 設定 pager 預設值
    function setPagerDefaults() {
        if (curSite.pager.type === undefined) curSite.pager.type = 1;
        if (curSite.pager.scrollD === undefined) curSite.pager.scrollD = 2000;
        if (curSite.pager.interval === undefined) curSite.pager.interval = 500;
    }

    // 主入口：設定預設值並綁定滾動處理器
    function pageLoading() {
        if (curSite.SiteTypeID === 0 || !curSite.pager) return;
        setPagerDefaults();
        curSite.pageUrl = '';

        windowScroll(function (direction, e) {
            // 僅在向下滾動、使用者未暫停、流程不忙、且 SiteTypeID > 0 時觸發
            if (direction != 'down' || userPaused || pagerBusy || curSite.SiteTypeID == 0) return;

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
                // 不呼叫 intervalPause()：iframeExtract 自身即以 pagerBusy 為
                // 「擷取中」互斥鎖（進入時設 true、擷取結束設回 false），
                // 若先開節流窗會讓它入口的 `if (pagerBusy) return` 直接退出。
                checkURL(iframeExtract);
            }
        });
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
            intervalPause();
            btn.click(); pageNumIncrement();
        }
    }
    // Type 6 iframe 擷取（Task 5 實作）
    function iframeExtract(src) {
        if (pagerBusy) return;
        pagerBusy = true;

        let existing = document.getElementById('Autopage_iframe');
        let iframe = existing || document.createElement('iframe');

        if (!existing) {
            iframe.id = 'Autopage_iframe';
            // name 讓框內的腳本實例（含跨域）能透過 window.name 自我識別並退出
            iframe.name = 'Autopage_iframe';
            insStyle('iframe#Autopage_iframe {position: absolute !important; top: -9999px !important; left: -9999px !important; width: 100% !important; height: 100% !important; border: none !important; z-index: -999 !important;}');
        }

        iframe.onload = function() {
            if (!curSite.pager.loadTime) curSite.pager.loadTime = 300;
            // 站方/廣告腳本可能把 iframe 再導航（onload 會多次觸發）：
            // 先清掉上一輪的計時器，避免疊加
            if (iframe._apTimer) { clearInterval(iframe._apTimer); iframe._apTimer = null; }
            let step = 0, timer = setInterval(function() {
                try {
                    let sh = (iframe.contentWindow.document.documentElement.scrollHeight || iframe.contentWindow.document.body.scrollHeight) / 10;
                    iframe.contentWindow.scrollTo(0, 999999);
                    iframe.contentWindow.scrollTo(0, sh * step);
                    if (++step === 12) {
                        clearInterval(timer); iframe._apTimer = null;
                        if (iframe._apWatchdog) { clearTimeout(iframe._apWatchdog); iframe._apWatchdog = null; }
                        processElements(iframe.contentWindow.document);
                        pagerBusy = false;
                    }
                } catch (e) {
                    // iframe 被導航至跨域等 → contentWindow 取用拋錯。
                    // 未保護時 clearInterval 永遠不會執行、pagerBusy 卡在 true，
                    // 翻頁從此死鎖。中止本輪並允許稍後重試。
                    clearInterval(timer); iframe._apTimer = null;
                    console.warn('[MyAutoPager] iframe 擷取中斷（可能被頁面腳本導航），稍後可重試', e);
                    pagerBusy = false;
                    setTimeout(function() { curSite.pageUrl = ''; }, curSite.retry || 3000);
                }
            }, curSite.pager.loadTime / 10);
            iframe._apTimer = timer;
        };

        iframe.src = src.replace(/#.+$/, '');

        // 看門狗：onload 遲遲不觸發（網路卡住）或流程異常時，
        // 解除 pagerBusy 死鎖並允許重試
        if (iframe._apWatchdog) clearTimeout(iframe._apWatchdog);
        iframe._apWatchdog = setTimeout(function() {
            iframe._apWatchdog = null;
            if (pagerBusy) {
                console.warn('[MyAutoPager] iframe 載入逾時，重置後可再次滾動重試');
                if (iframe._apTimer) { clearInterval(iframe._apTimer); iframe._apTimer = null; }
                pagerBusy = false;
                setTimeout(function() { curSite.pageUrl = ''; }, 1000);
            }
        }, (curSite.pager.loadTime || 300) + 20000);

        if (!existing) document.documentElement.appendChild(iframe);
    }
    // 強制新分頁開啟連結
    function forceTarget(pageE) {
        if (curSite.blank === 1) {
            // blank 1：在 <head> 插入 <base target="_blank">
            document.head.appendChild(document.createElement('base')).target = '_blank';

        } else if (curSite.blank === 5 || curSite.blank === 6) {
            // blank 5/6：克隆 <a> 並加上 target="_blank"（清除事件）
            if (!pageE) pageE = getAll(curSite.pager.pageE);
            pageE.forEach(function (dd) {
                getAllCSS('a[href]:not([target="_blank"]):not([href^="#"]):not([href^="javascript:"])', dd).forEach(function (a) {
                    if (a.href.slice(0, 4) == 'http') {
                        const clonedLink = a.cloneNode(true);
                        clonedLink.target = '_blank';
                        // blank 6：額外阻止冒泡，避免父元素事件委託捕獲
                        if (curSite.blank === 6) clonedLink.addEventListener('click', function(e) { e.stopPropagation(); });
                        a.insertAdjacentElement('afterend', clonedLink);
                        a.remove();
                    }
                });
            });
            return pageE;

        } else if (curSite.blank === 4) {
            // blank 4：直接對 pageE 中的 <a> 加上 target="_blank"
            if (!pageE) pageE = getAll(curSite.pager.pageE);
            pageE.forEach(function (dd) {
                getAllCSS('a[href]:not([target="_blank"]):not([onclick]):not([href^="#"]):not([href^="javascript:"])', dd).forEach(function (a) {
                    if (a.href.slice(0, 4) == 'http') { a.target = '_blank'; }
                });
            });
            return pageE;

        } else {
            // blank 2/3：事件委託，攔截 <a> 點擊，透過 GM_openInTab 開啟
            let d;
            if (curSite.blank === 2) {
                d = document.body;
            } else if (curSite.blank === 3) {
                let dd = toE5pop(getAll(curSite.pager.pageE));
                if (dd && dd.parentElement != null) d = dd.parentElement;
            }
            if (!d) return;

            function forceTarget_(target, e) {
                if (target.href && target.target != '_blank' && !(target.getAttribute('onclick')) && target.href.slice(0, 4) == 'http' && target.getAttribute('href').slice(0, 1) != '#') {
                    e.stopPropagation();
                    e.preventDefault();
                    GM_openInTab(target.href, {active: true, insert: true, setParent: true});
                }
            }
            d.addEventListener('click', function(e) {
                if (e.target.tagName === 'A') {
                    forceTarget_(e.target, e);
                } else {
                    let path = e.path || e.composedPath();
                    for (let i = 1; i < path.length - 4; i++) {
                        if (path[i].tagName === 'A') { forceTarget_(path[i], e); break; }
                    }
                }
            });
        }
    }

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
            curSite._noNextLogged = false;
            func(curSite.pageUrl);
        } else if (!curSite._noNextLogged && curSite.pageUrl === '') {
            // pageUrl 為空 = 非「載入中」，是初始就取不到連結 → 留一次診斷線索
            // （載入中或已到末頁時 pageUrl 非空，不會誤報）
            curSite._noNextLogged = true;
            console.info('[MyAutoPager] nextL 未命中有效連結，翻頁未觸發：', curSite.pager.nextL);
        }
    }

    // ---- getNext* URL 輔助函數 ----

    // 內部用：從元素取得下一頁 URL，設定 curSite.pageUrl，回傳 boolean
    function getNextE_(css) {
        if (!css) css = curSite.pager.nextL;
        const url = getNextE(css);
        if (!url) return false;
        curSite.pageUrl = url;
        return true;
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

    // 組合 search 參數 URL
    function buildSearchUrl(nextNum, pf, reg, lp_ = location.pathname) {
        let url;
        if (location.search) {
            url = indexOF(pf, 's') ? location.search.replace(reg, pf + nextNum) : location.search + '&' + pf + nextNum;
        } else {
            url = '?' + pf + nextNum;
        }
        return location.origin + lp_ + url;
    }

    // 從元素文字取得頁碼，替換 URL search 參數
    function getNextEP(css, pf, reg) {
        let nextNum = getOne(css);
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ', '');
            return buildSearchUrl(nextNum, pf, reg);
        }
        return '';
    }

    // 直接給定頁碼，替換 URL search 參數
    function getNextSP(page, pf, reg) {
        if (!page) return '';
        if (typeof page === 'number') page = page.toString();
        return buildSearchUrl(page, pf, reg);
    }

    // 組合 pathname URL
    function buildPathnameUrl(nextNum, reg, a, b) {
        let url = indexOF(reg) ? location.pathname.replace(reg, a + nextNum + b) : location.pathname + a + nextNum + b;
        return location.origin + url + location.search;
    }

    // 從元素文字取得頁碼，替換 URL pathname 路徑
    function getNextEPN(css, reg, a, b = '') {
        let nextNum = getOne(css);
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ', '');
            return buildPathnameUrl(nextNum, reg, a, b);
        }
        return '';
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
        return buildPathnameUrl(nextNum, reg, a, b);
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
        return buildSearchUrl(nextNum, pf, reg, lp_);
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

    function onXhrError(url, detail) {
        // 與 timeout 相同：3 秒後允許再次滾動重試，否則一次失敗就永久卡住
        setTimeout(function() { curSite.pageUrl = ''; }, 3000);
        console.error('[MyAutoPager] XHR error URL:', url, detail);
        var reason = '';
        if (detail && typeof detail === 'object') reason = detail.error || detail.statusText || '';
        GM_notification({text: '❌ 取得下一頁失敗' + (reason ? '（' + reason + '）' : '') + '，可 3 秒後再次滾動重試...', timeout: 5000});
    }
    function onXhrTimeout(url, detail) {
        setTimeout(function() { curSite.pageUrl = ''; }, 3000);
        console.log('[MyAutoPager] XHR timeout URL:', url, detail);
        GM_notification({text: '❌ 取得下一頁逾時，可 3 秒後再次滾動重試...', timeout: 5000});
    }

    // Type 1：XHR 取得下一頁內容（Chrome/Firefox 雙路徑）
    function fetchNextPage(url) {
        console.info('[MyAutoPager] 取得下一頁：', url);
        // Firefox 或規則指定 gmxhr 時使用 GM_xmlhttpRequest + cookiePartition
        // Chrome 使用原生 XMLHttpRequest 以保留跨域 cookie
        if (curSite.gmxhr || navigator.userAgent.includes('Firefox')) {
            let headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            };
            if (curSite.xRequestedWith === true) headers['x-requested-with'] = 'XMLHttpRequest';
            if (curSite.noReferer !== true) headers.Referer = location.href;

            // cookiePartition 僅 Tampermonkey 5.1+ 支援，且此參數在 Chrome 上未經上游實戰
            // （上游只在 Firefox 走此路徑）。帶著它同步拋錯或非同步失敗時，
            // 自動改用精簡參數重試一次，避免單一參數不相容就讓翻頁整個死掉。
            var gmFire = function(withPartition) {
                var opts = {
                    url: url,
                    method: 'GET',
                    responseType: 'arraybuffer',
                    headers: headers,
                    timeout: curSite.xhrTimeout || 5000,
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
                        if (withPartition) {
                            console.warn('[MyAutoPager] GM_xmlhttpRequest 帶 cookiePartition 失敗，改用精簡參數重試', response);
                            gmFire(false);
                        } else {
                            onXhrError(url, response);
                        }
                    },
                    ontimeout: function (response) { onXhrTimeout(url, response); }
                };
                if (withPartition) opts.cookiePartition = { topLevelSite: location.origin };
                GM_xmlhttpRequest(opts);
            };
            try {
                gmFire(true);
            } catch (e) {
                console.warn('[MyAutoPager] GM_xmlhttpRequest 拋出例外，改用精簡參數重試', e);
                try { gmFire(false); } catch (e2) { onXhrError(url, e2); }
            }
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
            xhr.onerror = function() { onXhrError(url, xhr.statusText); };
            xhr.ontimeout = function() { onXhrTimeout(url, xhr.statusText); };
            xhr.send();
        }
    }

    // ---- Hook 函數 ----

    function callBeforeHook(pageE) {
        if (!curSite.function || !curSite.function.bF) return pageE;
        let fn = curSite.function.bF, fp = curSite.function.bFp;
        if (typeof fn === 'string') {
            return fp ? new Function('pageE', 'bFp', 'fun', fn)(pageE, fp, window.autoPage)
                      : new Function('pageE', 'fun', fn)(pageE, window.autoPage);
        }
        return fp ? fn(pageE, fp) : fn(pageE);
    }

    function callAfterHook() {
        if (!curSite.function || !curSite.function.aF) return;
        let fn = curSite.function.aF, fp = curSite.function.aFp;
        if (typeof fn === 'string') {
            fp ? new Function('aFp', 'fun', fn)(fp, window.autoPage)
               : new Function('fun', fn)(window.autoPage);
        } else {
            fp ? fn(fp) : fn();
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
            pageE = callBeforeHook(pageE);

            // bF 回傳空陣列 = 明確放棄本次插入（如內容尚未渲染）。
            // 不能繼續走成功分支：頁碼、歷史與 replaceE 會照常前進，
            // 造成無聲跳章。改走與「取得主體元素失敗」相同的重試路徑。
            if (!pageE || pageE.length === 0) {
                if (curSite.retry) {
                    console.warn('[MyAutoPager] bF 放棄本次內容，' + curSite.retry + ' 毫秒後可重試...');
                    setTimeout(function(){ curSite.pageUrl = ''; }, curSite.retry);
                } else {
                    console.error('[MyAutoPager] bF 放棄本次內容...');
                }
                return;
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
                        const mainElem = getOne(curSite.pager.pageE);
                        if (getAll('br', mainElem).length > 10) {
                            if (!checkLastBr(mainElem)) {
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
            console.info('[MyAutoPager] 已插入下一頁內容：', curSite.pageUrl);

            // 9. 新增歷史記錄
            if (curSite.history === undefined) {
                if (GM_getValue('menu_history', true)) addHistory(response);
            } else {
                if (curSite.history) addHistory(response);
            }

            // 10. 替換元素
            if (curSite.pager.replaceE !== undefined) replaceElems(response);

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
            callAfterHook();
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
        const titleEl = pageE.querySelector && pageE.querySelector('title');
        title = title || (titleEl ? titleEl.textContent : window.top.document.title);
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

    // 內聯事件屬性（會觸發彈窗/跳轉）
    var INLINE_EVENT_ATTRS = ['onclick', 'onmousedown', 'onmouseup', 'ontouchstart', 'ontouchend', 'onpointerdown', 'onauxclick', 'onsubmit', 'oncontextmenu'];

    // 跨域判斷（假設兩段式 TLD；對當前小說站有效）
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

    // 清除內聯事件屬性 + 中和危險連結（javascript: / 跨域）
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

    // 清除非文字內容（小說閱讀專用）
    // 移除廣告、圖片、iframe、腳本等非文字元素，以及站點推廣文字，保留純文字閱讀體驗
    // opts.keepText（CSS 選擇器）：該選擇器命中的正文容器內節點，跳過「推廣關鍵字」刪除，
    // 避免誤刪含 VIP 等字樣的短句正文；未傳入時行為與舊版完全相同（向後相容）。
    function cleanContent(pageE, opts) {
        var removeList = 'iframe, img, script, style, link, ins, noscript, ad, video, audio, canvas, svg, object, embed, form, input, button, select, textarea';
        var keepText = opts && opts.keepText;
        // keepImg：圖片本身即內容的站點（如書籍封面）保留 <img>
        if (opts && opts.keepImg) {
            removeList = removeList.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t !== 'img'; }).join(', ');
        }
        pageE.forEach(function(el) {
            // 移除非文字元素
            el.querySelectorAll(removeList).forEach(function(node) { node.remove(); });
            // 清除彈窗觸發點（僅在啟用時）
            if (popupBlockEnabled) stripPopupTriggers(el);
            // 移除廣告容器、站點推廣文字（div 和 p 都檢查）
            el.querySelectorAll('div, p').forEach(function(node) {
                // 移除廣告容器 class
                if (node.className && /\b(gadBlock|clickforce|cfad|ad[-_]?wrap)/i.test(node.className)) { node.remove(); return; }
                var txt = node.textContent.trim();
                // 移除空元素（無文字、無子元素）
                if (!txt && node.children.length === 0) { node.remove(); return; }
                // 正文容器內的節點不套用推廣關鍵字刪除（保護純文字正文）
                if (keepText && node.closest && node.closest(keepText)) return;
                // 只對短文字元素檢查推廣關鍵字（避免誤刪包含正文的大容器）
                if (txt.length < 200 && (txt.indexOf('溫馨提示') > -1 || txt.indexOf('VIP') > -1 || txt.indexOf('免廣告') > -1 || txt.indexOf('加入書架') > -1 || txt.indexOf('搜書名') > -1)) { node.remove(); return; }
            });
        });
        return pageE;
    }

    // 第三層：攔截 document 級別的點擊劫持（僅小說站啟用）
    var clickGuardInstalled = false;
    function installClickGuard() {
        if (clickGuardInstalled) return;
        clickGuardInstalled = true;

        document.addEventListener('click', function(e) {
            if (!popupBlockEnabled) return;
            var t = e.target;
            if (!t || t.nodeType !== 1) return;

            // 放行腳本自身 UI
            if (t.id === 'Autopage_number' || (t.closest && t.closest('#Autopage_number'))) return;

            // A. 攔截危險錨點（javascript: 協議 / 跨域 target=_blank）
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
            if (curSite && curSite.pager && curSite.pager.pageE) {
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
            if (!popupBlockEnabled) return;
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

    // 清除 DOM 事件（克隆元素）
    function cleanuEvent(css, delay = 0, mode = -1) {
        setTimeout(() => {
            getAll(css).forEach(function (a) {
                const clonedLink = a.cloneNode(true);
                if (mode == 0 || mode == 1) { if (clonedLink.getAttribute('onclick') != undefined) { clonedLink.removeAttribute('onclick'); } }
                if (mode == 0 || mode == 2) clonedLink.addEventListener('click', function(e) { e.stopPropagation(); });
                a.insertAdjacentElement('afterend', clonedLink);
                a.remove();
            });
        }, delay);
    }

    // 檢查元素末尾是否為 <br>（用於 insertP6Br 判斷）
    function checkLastBr(e) {
        const children = Array.from(e.childNodes).filter(node => {
            return node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
        });
        if (children.length === 0) return false;
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
        src_bF, xs_bF, cleanContent, cleanuEvent, pageNumIncrement
    });

    // ========== UI：頁碼按鈕（Shadow DOM）==========

    function pageNumber(type) {
        const host = getCSS('#Autopage_number');
        const shadow = host && host.shadowRoot;
        let status = shadow && getCSS('#Autopage_number_button', shadow);

        if (curSite.SiteTypeID === 0 || curSite.hiddenPN || (curSite.pager && curSite.pager.type == 5 && self != top)) {
            if (status) status.style.display = 'none';
            return;
        }
        switch (type) {
            case 'add':
                add(); break;
            case 'del':
                del(); break;
            case 'set':
                set(); break;
        }

        function add() {
            if (status) {
                if (status.style.display === 'none') { status.style.display = 'flex'; }
                return;
            }
            // 插入網頁
            let _style = `<style>#Autopage_number_button {top: calc(75vh);left: 0;width: 32px;height: 32px;padding: 6px;display: flex;position: fixed;opacity: 0.3;transition: .2s;z-index: 9999998;cursor: pointer;user-select: none;flex-direction: column;align-items: center;justify-content: center;box-sizing: content-box;border-radius: 0 50% 50% 0;transform-origin: center;transform: translateX(-8px);background-color: #eee;-webkit-tap-highlight-color: transparent;box-shadow: 1px 1px 3px 0px #aaa;color: #000;font-size: medium;font-family: system-ui;} @media (any-hover: none) {#Autopage_number_button:active {opacity: 0.8;transform: translateX(0);}}@media (any-hover: hover) {#Autopage_number_button:hover {opacity: 0.8;transform: translateX(0);}}</style>`,
                _html = `<div id="Autopage_number_button" title="1. 此為【當前頁碼】（僅指腳本翻了多少頁，並非實際頁碼，該頁碼可在腳本菜單中關閉）&#10;&#10;2. 滑鼠【左鍵】點擊此處可【臨時暫停翻頁】（再次點擊可恢復）&#10;&#10;3. 滑鼠【右鍵】點擊此處可【回到頂部】">${pageNum._now}</div>`;

            document.documentElement.insertAdjacentHTML('beforeend', `<div id="Autopage_number" style="display: flex !important;position: fixed !important;z-index: 9999998 !important;"></div>`);
            let Autopage_number = getCSS('#Autopage_number'), shadowRoot = Autopage_number.attachShadow({ mode: 'open' }); // 建立 Shadow DOM 避免網頁樣式影響頁碼元素
            shadowRoot.innerHTML = _style + _html; // 插入元素

            if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = !userPaused;
            status = getCSS('#Autopage_number_button', shadowRoot);
            // 左鍵單擊＝臨時暫停翻頁（只動 userPaused，不影響進行中的機器鎖）；
            // 快速點兩下＝啟動／停止自動捲頁。第二擊會還原第一擊的暫停切換，
            // 所以單擊不需要 debounce、暫停仍是即時反應，代價只是雙擊時
            // 暫停指示會閃一下。
            let lastTapAt = 0, tapPrevPaused = false;
            status.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const now = performance.now();
                if (now - lastTapAt < 320) {
                    lastTapAt = 0;
                    userPaused = tapPrevPaused;
                    paintPauseState(this);
                    if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = !userPaused;
                    asToggle();
                    return false;
                }
                lastTapAt = now;
                tapPrevPaused = userPaused;
                userPaused = !userPaused;
                paintPauseState(this);
                if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = !userPaused;
                return false;
            };
            // 右鍵點擊事件（回到頂部）
            status.oncontextmenu = function(e) {
                window.scrollTo(0, 0);
                e.preventDefault();
                e.stopPropagation();
                return false;
            };
            set();
        }
        // 監聽儲存當前頁碼的物件值變化
        function set() {
            Object.defineProperty(pageNum, 'now', {
                configurable: true,
                set: function(value) {
                    this._now = value;
                    if (status) status.textContent = value;
                }
            });
        }
        function del() {
            if (!status) return;
            status.style.display = 'none';
        }
    }

    // ========== UI：菜單 ==========

    // ========== 自動捲頁 ==========
    // 與翻頁解耦：本模組只負責平滑捲動。捲動產生的 scroll 事件照常餵給
    // pageLoading() 的閘門，所以捲到頁底時會自然接續既有的無縫翻頁。

    const AS_MIN = 10, AS_MAX = 200, AS_IDLE_STOP = 30000, AS_TAP_MS = 350, AS_TAP_DIST = 20;
    let autoScroll = false, asSpeed = 40, asRaf = null, asLastTs = 0, asAcc = 0,
        asIdleMs = 0, asLastY = -1, asLastH = -1, asInstalled = false;

    function asBtn() {
        const host = getCSS('#Autopage_number');
        const shadow = host && host.shadowRoot;
        return shadow ? getCSS('#Autopage_number_button', shadow) : null;
    }

    function asClampSpeed(v) {
        v = parseInt(v, 10);
        if (isNaN(v)) return 40;
        return v < AS_MIN ? AS_MIN : (v > AS_MAX ? AS_MAX : v);
    }

    // 只動 backgroundColor，避免與暫停指示（color / fontStyle）互相蓋掉
    function asIndicate() {
        const btn = asBtn();
        if (btn) btn.style.backgroundColor = autoScroll ? '#A5D6A7' : '';
    }

    function paintPauseState(btn) {
        btn.style.color = userPaused ? '#FF5722' : '';
        btn.style.fontStyle = userPaused ? 'italic' : '';
    }

    function asStep(ts) {
        if (!autoScroll) { asRaf = null; return; }
        if (!asLastTs) asLastTs = ts;
        let dt = ts - asLastTs;
        asLastTs = ts;
        // 分頁切回前景或長時間停頓（rAF 在背景分頁被凍結）：丟棄該幀的位移，
        // 否則會一次跳掉一大段
        if (dt < 0 || dt > 250) dt = 0;

        // 亞像素累積：低速時仍平順，不用 setInterval + scrollBy(0,1) 那種抖動做法
        asAcc += asSpeed * dt / 1000;
        const px = Math.floor(asAcc);
        if (px >= 1) { asAcc -= px; window.scrollBy(0, px); }

        // 停滯＝位置與文件高度都不變（既沒捲動、也沒有新內容進來）。
        // 只看位置無法區分「在頁底等下一頁」和「讀完了」，但下一頁落地時
        // scrollHeight 會變，所以加上高度就能讓等待中的抓取繼續延命。
        // 門檻取 30 秒，遠大於引擎自身的 XHR 逾時（8 秒）與重試延遲，
        // 免得把慢速網路誤判成讀完。y 取整：頁面縮放下 pageYOffset 可能
        // 帶小數，逐幀抖動會讓計時永遠歸零、rAF 在書末永久空轉。
        const y = Math.round(window.pageYOffset || document.documentElement.scrollTop || 0);
        const h = document.documentElement.scrollHeight;
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

    // 真人介入即停。程式化 scrollBy 不會產生 wheel / touchmove / keydown，
    // 所以不需要額外的「這是腳本自己捲的」旗標。
    // 手動捲動（滾輪／拖動／方向鍵）刻意不再停止自動捲頁：使用者拖到想看的
    // 位置後，捲動會從新位置繼續。停止方式是再點兩下，或按 Esc。
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
    // 自行以 pointerdown 計時而非監聽 dblclick，才能同時覆蓋滑鼠與觸控，
    // 且不必攔截第一擊的預設行為（選字、點連結都照常）。
    function asInstallPageTap() {
        let lastT = 0, lastX = 0, lastY = 0;
        document.addEventListener('pointerdown', function(e) {
            if (e.isPrimary === false) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const t = e.target;
            // 腳本自身 UI 有自己的處理器
            if (t && t.nodeType === 1 && t.closest && t.closest('#Autopage_number')) return;
            if (asIsInteractive(t)) { lastT = 0; return; }

            const now = performance.now();
            if (now - lastT < AS_TAP_MS &&
                Math.abs(e.clientX - lastX) < AS_TAP_DIST &&
                Math.abs(e.clientY - lastY) < AS_TAP_DIST) {
                lastT = 0;
                // 正在選字（含雙擊選詞）時不搶手勢
                try { const s = window.getSelection(); if (s && !s.isCollapsed) return; } catch (err) {}
                asToggle();
                return;
            }
            lastT = now; lastX = e.clientX; lastY = e.clientY;
        }, true);

        // 雙擊在觸控裝置上原生是「放大」，不抑制的話會同時縮放頁面。
        // manipulation 只關掉雙擊放大，pinch 縮放不受影響。
        insStyle('body {touch-action: manipulation;}');
    }

    function registerMenuCommand() {
        menuId.forEach(id => { try { GM_unregisterMenuCommand(id); } catch(e){} });
        menuId = [];

        // 1. 啟用/禁用（當前網站）
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

        // 5. 自動捲頁速度
        menuId.push(GM_registerMenuCommand('▼ ' + menuAll[4][1] + '：' + asSpeed + ' px/秒', function() {
            const v = prompt('自動捲頁速度（' + AS_MIN + '–' + AS_MAX + ' px/秒）\n\n在左側頁碼按鈕上快速點兩下即可啟動／停止自動捲頁。', asSpeed);
            if (v === null) return;
            asSpeed = asClampSpeed(v);
            GM_setValue('menu_autoScrollSpeed', asSpeed);
            registerMenuCommand();
        }));
    }

    function menu_switch(status, name) {
        GM_setValue(name, !status);
        if (name === 'menu_page_number') {
            status ? pageNumber('del') : pageNumber('add');
            registerMenuCommand();
            // 避免頁碼開關後翻頁失效
            if (curSite.SiteTypeID !== 0 && curSite.pager) {
                setPagerDefaults();
            }
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

    // 自定義翻頁規則編輯器
    function customRules() {
        if (getCSS('#Autopage_customRules')) return

        let customRules = customStringify(GM_getValue('menu_customRules', {}))
        if (customRules == '{}') customRules = '{\n    \n}'; // 引導用戶插入規則的位置
        let _html = `<style>* {font-family: system-ui !important;}</style><div style="left: 0; right: 0; top: 0; bottom: 0; width: 100%; height: 100%; margin: auto; padding: 25px 10px 10px 10px; position: fixed; opacity: 0.95; z-index: 9999999; background-color: #eee; color: #222; font-size: 14px; overflow: scroll; text-align: left;-webkit-touch-callout: text !important;-webkit-user-select: text !important;-khtml-user-select: text !important;-moz-user-select: text !important;-ms-user-select: text !important;user-select: text !important;">
<h3 style="font-size: 22px;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;"><strong># 自定義翻頁規則（優先級最高，會覆蓋同名的外置翻頁規則）-【將規則插入默認的 <code>{ }</code> 中間】</strong></h3>
<details><summary style="cursor: pointer;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;"><kbd><strong>「 點擊展開 查看規則示例 」</strong></kbd></summary>
<ul style="list-style: disc; margin-left: 35px;">
<li>翻頁規則為 JSON 格式，因此需要了解一點 JSON 的基本格式（主要就是末尾逗號、轉義、雙引號等）。</li>
<li>腳本會自動格式化規則，因此<strong>無需手動縮進、換行</strong>，只需把規則<strong>插入默認的 { } 中間</strong>即可。</li>
</ul>
<pre class="notranslate" style="white-space: pre-wrap;user-select: auto;">
// 規則說明：
// "規則名"     唯一名稱，自定義規則優先級最高，會覆蓋同名的外置規則
// "host"       域名，支持正則表達式，也可寫多個域名的陣列
// "url"        控制哪些頁面適用該規則，省略後代表全站適用
// "nextL"      含有下一頁地址的元素選擇器（CSS 或 XPath）
// "pageE"      要從下一頁獲取的元素選擇器（網頁主體內容）
// "replaceE"   用於替換當前頁碼元素的選擇器，省略後自動判斷
// "scrollD"    觸發翻頁的滾動條與底部之間的距離，預設 2000
// "inherits"   繼承標識，僅需修改部分規則時使用

// === 示例一：基本規則（type 1，XHR 模式，預設） ===
{
    "example_basic": {
        "host": "example.com",
        "url": "return fun.isPager()",
        "pager": {
            "nextL": "a.next-page",
            "pageE": "#content",
            "replaceE": ".pagination",
            "scrollD": 2000
        }
    },

// === 示例二：繼承規則（僅修改部分內容） ===
    "example_basic": {
        "host": "other.example.com",
        "inherits": true
    },

// === 示例三：type 2（手動點擊「載入更多」按鈕） ===
    "example_loadmore": {
        "host": "forum.example.com",
        "pager": {
            "type": 2,
            "nextL": "#load-more-btn",
            "pageE": ".post-list"
        }
    },

// === 示例四：type 6（拼接 URL 翻頁） ===
    "example_url": {
        "host": "blog.example.com",
        "pager": {
            "type": 6,
            "nextL": "js; return location.href.replace(/(page=)(\\d+)/, (m,p1,p2) => p1+(+p2+1))",
            "pageE": ".article-list"
        }
    }
}
</pre></details>
<details><summary style="cursor: pointer;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;"><kbd><strong>「 點擊展開 查看所有規則 」（可按 Ctrl+F 搜索規則）</strong></kbd></summary>
<pre id="Autopage_customRules_all" class="notranslate" style="overflow-y: scroll; overflow-x: hidden; height: 500px; word-break: break-all; white-space: pre-wrap;user-select: auto;"> </pre></details>

<textarea id="Autopage_customRules_textarea" style="min-width:95%; min-height:70%; display: block; margin: 10px 0 10px 0; white-space:pre; overflow:scroll; resize: revert; text-transform: initial;" placeholder="留空等於默認的 {}，請把規則插入 {} 之間"></textarea>
<button id="Autopage_customRules_save" style="margin-right: 20px;">保存並刷新</button><button id="Autopage_customRules_cancel">取消修改</button>
</div>`
        document.documentElement.insertAdjacentHTML('beforeend', `<div id="Autopage_customRules" style="display: initial !important;position: fixed !important;z-index: 9999999 !important;"></div>`);
        let Autopage_customRules = getCSS('#Autopage_customRules'), shadowRoot = Autopage_customRules.attachShadow({ mode: 'open' }); // 創建 Shadow DOM 避免網頁樣式影響
        shadowRoot.innerHTML = _html;
        document.documentElement.style.overflow = document.body.style.overflow = 'hidden'; // 避免網頁本身滾動
        getCSS('#Autopage_customRules_textarea', shadowRoot).textContent = customRules; // 單獨插入自定義規則，避免被 insertAdjacentHTML 語義化
        getCSS('#Autopage_customRules_all', shadowRoot).textContent = customStringify(DBSite2); // 單獨插入全部規則列表
        // 保存按鈕
        getCSS('#Autopage_customRules_save', shadowRoot).onclick = function () {
            let customRules_textarea = getCSS('#Autopage_customRules_textarea', shadowRoot)
            customRules = customRules_textarea.value;
            if (!customRules) customRules = '{}'
            try {
                customRules = JSON.parse(customRules)
                GM_setValue('menu_customRules', customRules)
                location.reload();
            } catch (e) {
                let match = e.message.match(/at position (\d+)/), position;
                if (match) {
                    position = parseInt(match[1]);
                } else {
                    match = e.message.match(/line (\d+) column (\d+)/i);
                    position = calculatePositionFromLineColumn(customRules, match[1], match[2])
                }
                console.error('自定義規則存在格式錯誤：\n' + e.message + '\n錯誤位置為該區域中間：\n------\n' + customRules.slice((position<30)?0:position-30,position+29) + '\n------\n\n常見格式錯誤：\n1. 逗號：每組 { } 中的最後一個值末尾不能加逗號\n2. 轉義：如果正則表達式中含有轉義符 \\ 那就要對其再次轉義為 \\\\\n3. 引號：規則中冒號左右的內容都需要加上雙引號，如果內容中含有雙引號則需要對雙引號轉義（即 \\" 這樣），或改為單引號')
                window.alert('自定義規則存在格式錯誤：\n' + e.message + '\n錯誤位置為該區域中間：\n------\n' + customRules.slice((position<30)?0:position-30,position+29) + '\n------\n點擊【確定】後腳本會為你定位並選中編輯框中格式錯誤的文字\n\n常見格式錯誤：\n1. 逗號：每組 { } 中的最後一個值末尾不能加逗號\n2. 轉義：如果正則表達式中含有轉義符 \\ 那就要對其再次轉義為 \\\\\n3. 引號：規則中冒號左右的內容都需要加上雙引號，如果內容中含有雙引號則需要對雙引號轉義（即 \\" 這樣），或改為單引號');
                customRules_textarea.selectionStart = position - 1;
                customRules_textarea.selectionEnd = position;
                customRules_textarea.focus();
            }
        }
        // 取消按鈕
        getCSS('#Autopage_customRules_cancel', shadowRoot).onclick = function () { document.documentElement.style.overflow = document.body.style.overflow = ''; getCSS('#Autopage_customRules').remove(); }
    }

    // 自定義的 stringify 函數，將 [ ] 內的元素格式化為一行顯示
    function customStringify(obj) {
        return JSON.stringify(obj, null, 4).replace(/(: \[)([\s\S]*?)(\],?\n)/g, (match, p1, p2, p3) => {
            return p1 + p2.replace(/\n/g, '').replace(/\s{4}/g, '') + p3;
        });
    }

    // 根據行號和列號計算字串中的 position 位置
    function calculatePositionFromLineColumn(text, line, column) {
        if (!text || line < 1 || column < 1) return -1;
        const lines = text.split('\n');
        if (line > lines.length) return -1;
        let position = 0;
        for (let i = 0; i < line - 1; i++) position += lines[i].length + 1;
        return position + Math.min(column - 1, lines[line - 1].length);
    }

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

    // ========== 初始化 ==========

    function initSite() {
        // 旗標來自規則物件本身，避免與 host 偵測雙源漂移；SPA 導航重進時依新 curSite 重設
        popupBlockEnabled = !!(curSite && curSite.popupBlock);
        if (popupBlockEnabled) {
            installClickGuard();
            if (curSite && curSite.pager && curSite.pager.pageE) {
                // 帶上規則的 cleanOpts，原始頁與插入頁的清理行為才一致
                // （否則 keepImg/keepText 站點的第一頁會被通用規則誤清）
                try { cleanContent(getAll(curSite.pager.pageE), curSite.cleanOpts); } catch (e) {}
            }
        }
        // 自動捲頁只需初始化一次（SPA 導航會重進 initSite，不可重複掛監聽）；
        // 必須早於 registerMenuCommand()，否則菜單標籤會顯示預設值而非已存速度
        if (!asInstalled) {
            asSpeed = asClampSpeed(GM_getValue('menu_autoScrollSpeed', 40));
            asInstallInterrupt();
            asInstallPageTap();
            asInstalled = true;
        }
        registerMenuCommand();
        if (GM_getValue('menu_page_number')) { pageNumber('add'); } else { pageNumber('set'); }
        // SPA 導航會重建按鈕，捲動還在進行時要把指示燈補回去
        asIndicate();
        if (curSite.blank !== undefined) setTimeout(forceTarget, 1000);
        if (curSite.style) insStyle(curSite.style);
        pageLoading();
    }

    matchRule();
    initSite();

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

            setDBSite();
            mergeRules();
            matchRule();
            initSite();
        });
    }

})();
