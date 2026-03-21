// ==UserScript==
// @name         MyAutoPager (iPhone)
// @version      1.0.0
// @author       clh (based on AutoPager by X.I.U)
// @description  iPhone Safari 小說自動翻頁 — 無 GM API 依賴
// @copyright    Original AutoPager (c) X.I.U (https://github.com/XIU2/UserScript) GPL-3.0
// @license      GPL-3.0
// @run-at       document-end
// @match        *://look.thisiscm.com/*
// @match        *://uukanshu.cc/*
// @match        *://*.uukanshu.cc/*
// @match        *://69shuba.tw/*
// @match        *://*.69shuba.tw/*
// ==/UserScript==

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
            var result = doc.evaluate(xpath, contextNode, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return result.singleNodeValue && result.singleNodeValue.nodeType === 1 && result.singleNodeValue;
        } catch (err) { return null; }
    }
    function getAllXpath(xpath, contextNode, doc = document) {
        contextNode = contextNode || doc;
        var result = [];
        try {
            var query = doc.evaluate(xpath, contextNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (var i = 0; i < query.snapshotLength; i++) {
                var node = query.snapshotItem(i);
                if (node.nodeType === 1) result.push(node);
            }
        } catch (err) {}
        return result;
    }
    function getOne(selector, contextNode, doc) {
        if (!selector) return;
        doc = doc || document;
        contextNode = contextNode || doc;
        if (selector[0] === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getXpath(selector, contextNode, doc);
        }
        return getCSS(selector, contextNode);
    }
    function getAll(selector, contextNode, doc) {
        if (!selector) return [];
        doc = doc || document;
        contextNode = contextNode || doc;
        if (selector[0] === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getAllXpath(selector, contextNode, doc);
        }
        return getAllCSS(selector, contextNode);
    }
    function getAllParentElement(selector, contextNode, doc) {
        doc = doc || document;
        contextNode = contextNode || doc;
        var parents = [];
        getAll(selector, contextNode, doc).forEach(function(next) {
            var parent = next.parentElement;
            if (parents.indexOf(parent) === -1) parents.push(parent);
        });
        return parents;
    }

    // ========== 工具函數 ==========

    function createDocumentByString(e) {
        if (!e) return;
        try { return (new DOMParser()).parseFromString(e, 'text/html'); } catch(ex) {}
        if (document.implementation.createHTMLDocument) {
            var t = document.implementation.createHTMLDocument('');
            var r = document.createRange();
            var n = r.createContextualFragment(e);
            r.selectNodeContents(document.body);
            t.body.appendChild(n);
            return t;
        }
    }

    function insStyle(style) {
        if (style.indexOf('{') === -1) style += '{display: none !important;}';
        document.documentElement.appendChild(document.createElement('style')).textContent = style;
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
        var b = a.pop();
        if (b.tagName === 'SCRIPT' || b.tagName === 'STYLE' || b.tagName === 'LINK') return toE5pop(a);
        return b;
    }

    // ========== 清除非文字內容 ==========

    function cleanContent(pageE) {
        var removeList = 'iframe, img, script, style, link, ins, noscript, ad, video, audio, canvas, svg, object, embed, form, input, button, select, textarea';
        pageE.forEach(function(el) {
            el.querySelectorAll(removeList).forEach(function(node) { node.remove(); });
            el.querySelectorAll('div, p').forEach(function(node) {
                if (node.className && /\b(gadBlock|clickforce|cfad|ad[-_]?wrap)/i.test(node.className)) { node.remove(); return; }
                var txt = node.textContent.trim();
                if (!txt && node.children.length === 0) { node.remove(); return; }
                if (txt.length < 200 && (txt.indexOf('溫馨提示') > -1 || txt.indexOf('VIP') > -1 || txt.indexOf('免廣告') > -1 || txt.indexOf('加入書架') > -1 || txt.indexOf('搜書名') > -1)) { node.remove(); return; }
            });
        });
        return pageE;
    }

    // ========== 小說規則 ==========

    var rules = {
        novel543: {
            host: 'look.thisiscm.com',
            url: /\d+_\d+/,
            style: 'ins.clickforceads, iframe.cfadif, div[id*="tam-ad"], div[id*="cfad"], ad {display: none !important;}',
            pager: {
                nextL: '(//a[contains(text(),"下一章")])[last()]',
                pageE: '.chapter-content',
                replaceE: '.foot-nav',
                scrollD: 3000
            },
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
            pager: {
                nextL: '#linkNext',
                pageE: '.readcotent',
                replaceE: '.mulu-box',
                scrollD: 3000
            },
            afterPage: function() {
                var els = document.querySelectorAll('.readcotent');
                if (els.length > 1) els[els.length - 1].className = els[0].className;
            }
        },
        '69shuba': {
            host: '69shuba.tw',
            style: 'div[id*="pf-"], script[src*="novelapis"], script[src*="pubfuture"], .ad, iframe {display: none !important;} #nr1, #nr1 * {text-align: center !important; font-size: 36px !important; line-height: 1.8 !important; color: #999 !important;} .nr_title {text-align: center !important; font-size: 24px !important; color: #ddd !important; display: block !important; margin: 20px 0 !important;}',
            pager: {
                nextL: '#pb_next',
                pageE: '.nr_title, .nr_nr',
                replaceE: '.nr_page',
                scrollD: 3000
            }
        }
    };

    // ========== 規則匹配 ==========

    var curSite = null;
    var pausePage = true;
    var pageNum = 1;

    function matchRule() {
        var hostname = location.hostname;
        var pathSearch = location.pathname + location.search;

        for (var key in rules) {
            var rule = rules[key];
            // host 匹配
            if (hostname !== rule.host && hostname.indexOf('.' + rule.host) === -1) continue;
            // url 匹配（可選）
            if (rule.url && !rule.url.test(pathSearch)) continue;

            curSite = rule;
            curSite.pageUrl = '';
            console.info('[MyAutoPager-iPhone] 匹配規則:', key);
            return;
        }
    }

    // ========== 翻頁引擎 ==========

    function getNextUrl() {
        var nextL = curSite.pager.nextL;
        var next = getOne(nextL);
        if (!next || !next.href || next.href.slice(0, 4) !== 'http' || next.getAttribute('href')[0] === '#') return '';
        if (next.href === curSite.pageUrl) return '';
        return next.href;
    }

    function fetchNextPage(url) {
        curSite.pageUrl = url;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.overrideMimeType('text/html; charset=' + (document.characterSet || 'utf-8'));
        xhr.timeout = 8000;
        xhr.onload = function() {
            try {
                processElements(createDocumentByString(xhr.responseText));
            } catch (e) {
                console.error('[MyAutoPager-iPhone] 處理錯誤:', e);
            }
        };
        xhr.onerror = function() { console.log('[MyAutoPager-iPhone] 載入失敗:', url); };
        xhr.ontimeout = function() {
            curSite.pageUrl = '';
            console.log('[MyAutoPager-iPhone] 載入超時:', url);
        };
        xhr.send();
    }

    function processElements(response) {
        var insertP = curSite.pager.insertP || [curSite.pager.pageE, 5];
        var pageE = getAll(curSite.pager.pageE, response, response);
        var toE;

        if (insertP[1] === 5) {
            toE = toE5pop(getAll(insertP[0]));
        } else {
            toE = getOne(insertP[0]);
        }

        if (pageE.length > 0 && toE) {
            // 清理非文字內容
            cleanContent(pageE);

            // 插入
            var addTo = getAddTo(insertP[1]);
            if (insertP[1] === 6) {
                var html = '';
                pageE.forEach(function(one) { html += one.innerHTML; });
                toE.insertAdjacentHTML(addTo, html);
            } else {
                if (insertP[1] === 2 || insertP[1] === 4 || insertP[1] === 5) pageE.reverse();
                pageE.forEach(function(one) { toE.insertAdjacentElement(addTo, one); });
            }

            // 頁碼 +1
            pageNum++;
            updatePageNumber();

            // 歷史記錄
            try {
                var title = response.querySelector('title');
                title = title ? title.textContent : document.title;
                history.pushState(null, title, url);
                document.title = title;
            } catch(e) {}

            // 替換導航元素
            if (curSite.pager.replaceE) {
                var oldE = getAll(curSite.pager.replaceE);
                var newE = getAll(curSite.pager.replaceE, response, response);
                if (oldE.length === newE.length) {
                    for (var i = 0; i < oldE.length; i++) oldE[i].outerHTML = newE[i].outerHTML;
                }
            }

            // 清理所有已載入章節
            cleanContent(getAll(curSite.pager.pageE));

            // 執行 afterPage 鉤子
            if (curSite.afterPage) curSite.afterPage();

        } else if (curSite.pager.retry) {
            setTimeout(function() { curSite.pageUrl = ''; }, curSite.pager.retry);
        }
    }

    // ========== 頁碼按鈕 ==========

    var pageNumBtn = null;

    function createPageNumber() {
        var host = document.createElement('div');
        host.id = 'Autopage_number';
        host.style.cssText = 'display:flex!important;position:fixed!important;z-index:9999998!important;';
        document.documentElement.appendChild(host);

        var shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>' +
            '#btn{top:calc(75vh);left:0;width:32px;height:32px;padding:6px;display:flex;position:fixed;' +
            'opacity:0.3;transition:.2s;z-index:9999998;cursor:pointer;user-select:none;flex-direction:column;' +
            'align-items:center;justify-content:center;box-sizing:content-box;border-radius:0 50% 50% 0;' +
            'transform-origin:center;transform:translateX(-8px);background-color:#eee;' +
            '-webkit-tap-highlight-color:transparent;box-shadow:1px 1px 3px 0px #aaa;color:#000;' +
            'font-size:medium;font-family:system-ui;}' +
            '#btn:active{opacity:0.8;transform:translateX(0);}' +
            '</style><div id="btn">1</div>';

        pageNumBtn = shadow.querySelector('#btn');

        // 點擊暫停/恢復
        pageNumBtn.addEventListener('click', function(e) {
            if (pausePage) {
                this.style.color = '#FF5722';
                this.style.fontStyle = 'italic';
            } else {
                this.style.color = '';
                this.style.fontStyle = '';
            }
            pausePage = !pausePage;
            e.preventDefault();
            e.stopPropagation();
        });
    }

    function updatePageNumber() {
        if (pageNumBtn) pageNumBtn.textContent = pageNum;
    }

    // ========== 滾動偵測 ==========

    function startScrollWatch() {
        var scrollD = curSite.pager.scrollD || 2000;
        var interval = curSite.pager.interval || 500;
        var beforeScrollTop = document.documentElement.scrollTop || document.body.scrollTop;

        // 內容太少時撐高頁面
        setTimeout(function() {
            var st = document.documentElement.scrollTop || document.body.scrollTop;
            var vh = window.innerHeight || document.documentElement.clientHeight;
            if (st === 0 && document.documentElement.scrollHeight === vh) {
                insStyle('html, body {min-height: ' + (document.documentElement.scrollHeight + 10) + 'px;}');
            }

            window.addEventListener('scroll', function() {
                var afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop;
                var delta = afterScrollTop - beforeScrollTop;
                beforeScrollTop = afterScrollTop;
                if (delta <= 0 || !pausePage) return;

                var scrollTop = afterScrollTop;
                var viewHeight = window.innerHeight || document.documentElement.clientHeight;

                if (document.documentElement.scrollHeight <= viewHeight + scrollTop + scrollD) {
                    // 觸發翻頁
                    pausePage = false;
                    setTimeout(function() { pausePage = true; }, interval);

                    var url = getNextUrl();
                    if (url) fetchNextPage(url);
                }
            }, false);
        }, 1000);
    }

    // ========== 初始化 ==========

    matchRule();
    if (!curSite) return;

    // 注入 CSS
    if (curSite.style) insStyle(curSite.style);

    // 顯示頁碼
    createPageNumber();

    // 啟動翻頁
    startScrollWatch();

})();
