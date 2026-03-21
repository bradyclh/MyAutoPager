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

    // ========== 後續 Task 將在此添加 ==========

})();
