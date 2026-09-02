'use strict';

// 真實瀏覽器 e2e — 在已載入 userscript 的章節頁上執行。
//
// 這一層抓的是靜態檢查看不到的東西：翻頁到底有沒有發生、插入的章節樣式
// 跟首章是否一致、每章重複的功能列有沒有清掉、末章會不會把目錄或完本頁
// 當成章節塞進來。ttks 那次「標題顏色不一致」就是只比了字級沒比顏色才漏掉的，
// 所以這裡一律做整組 computed style 比對，而不是挑幾個屬性看。
//
// 用法見 test/README.md。需要 window.AP_TEST_SITES（由 fixtures/sites.js 提供）。

(function () {
    var SITES = (typeof window !== 'undefined' && window.AP_TEST_SITES) || [];

    // 逐一比對的 computed style 屬性。刻意列得寬，寧可誤報也不要漏掉。
    var STYLE_PROPS = [
        'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
        'lineHeight', 'letterSpacing', 'textIndent', 'textAlign',
        'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom',
        'whiteSpace', 'visibility', 'opacity'
    ];

    function snapshot(el) {
        var s = getComputedStyle(el);
        var o = {};
        STYLE_PROPS.forEach(function (p) { o[p] = s[p]; });
        return o;
    }

    function styleDiff(a, b) {
        var d = [];
        STYLE_PROPS.forEach(function (p) {
            if (a[p] !== b[p]) d.push(p + ': ' + a[p] + ' ≠ ' + b[p]);
        });
        return d;
    }

    function qsa(sel, ctx) {
        if (!sel) return [];
        try { return [].slice.call((ctx || document).querySelectorAll(sel)); }
        catch (e) { return []; }
    }

    function currentSite() {
        for (var i = 0; i < SITES.length; i++) {
            var s = SITES[i];
            if (!s.e2e) continue;
            var host;
            try { host = new URL(s.e2e.start).hostname; } catch (e) { continue; }
            if (location.hostname === host || location.hostname.indexOf('.' + host) !== -1) return s;
        }
        return null;
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // 捲到底並等待章節數變化。
    //
    // 兩個必須自己處理的細節：
    // 1. window.scrollTo() 會改變捲動位置，但在自動化執行環境（CDP evaluate）
    //    底下不會派發 scroll 事件 —— 引擎因此永遠不會被觸發，看起來就像「壞了」。
    //    引擎的 handler 是自己從 DOM 重算位置、不讀事件物件，所以補一個合成
    //    scroll 事件就能正常驅動它。
    // 2. 引擎在捲動差值為 0 時直接 return，所以每輪要先往上一點再回到底部，
    //    製造一個向下的差值，否則停在底部之後就再也不會觸發。
    function nudgeToBottom() {
        var de = document.documentElement;
        var nearBottom = Math.max(0, de.scrollHeight - window.innerHeight - 300);
        window.scrollTo(0, nearBottom);
        window.dispatchEvent(new Event('scroll'));
        window.scrollTo(0, de.scrollHeight);
        window.dispatchEvent(new Event('scroll'));
    }

    function scrollAndWait(cfg, before, timeoutMs) {
        var deadline = Date.now() + (timeoutMs || 20000);
        function tick() {
            nudgeToBottom();
            if (qsa(cfg.chapterBlock).length > before) return Promise.resolve(true);
            if (Date.now() > deadline) return Promise.resolve(false);
            return sleep(500).then(tick);
        }
        return tick();
    }

    function results() {
        var list = [];
        return {
            add: function (name, ok, detail) { list.push({ name: name, ok: !!ok, detail: detail || '' }); },
            all: function () { return list; },
            summary: function () {
                var bad = list.filter(function (r) { return !r.ok; });
                return {
                    passed: list.length - bad.length,
                    failed: bad.length,
                    ok: bad.length === 0,
                    checks: list.map(function (r) {
                        return (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : '');
                    })
                };
            }
        };
    }

    // 樣式一致性 — 首章 vs 每個已插入的章節。
    // 抽成獨立函式有兩個理由：run() 要用，而且要能在「不翻頁」的情況下單獨驗證
    // （翻頁會讓規則的 aF 重新同步樣式，把問題蓋掉，就測不出比對邏輯本身有沒有效）。
    function addStyleChecks(cfg, R) {
        var blocks = qsa(cfg.chapterBlock);
        var titles = qsa(cfg.titleEl);

        var titleProblems = [];
        if (titles.length > 1) {
            var titleBase = snapshot(titles[0]);
            for (var i = 1; i < titles.length; i++) {
                var d = styleDiff(titleBase, snapshot(titles[i]));
                if (d.length) titleProblems.push('第 ' + (i + 1) + ' 章標題 → ' + d.join('; '));
            }
        }
        R.add('章節標題樣式與首章一致', titleProblems.length === 0, titleProblems.join(' | '));

        var textProblems = [];
        var pick = function (block) { return cfg.textEl ? block.querySelector(cfg.textEl) : block; };
        var baseEl = blocks.length ? pick(blocks[0]) : null;
        if (baseEl) {
            var textBase = snapshot(baseEl);
            for (var j = 1; j < blocks.length; j++) {
                var el = pick(blocks[j]);
                if (!el) { textProblems.push('第 ' + (j + 1) + ' 章找不到正文元素'); continue; }
                var td = styleDiff(textBase, snapshot(el));
                if (td.length) textProblems.push('第 ' + (j + 1) + ' 章正文 → ' + td.join('; '));
            }
        }
        R.add('正文樣式與首章一致', textProblems.length === 0, textProblems.join(' | '));
    }

    // 只比對目前畫面上已有的章節，不觸發翻頁
    function checkStyles() {
        var site = currentSite();
        if (!site) return { error: '目前網域沒有對應的 e2e 設定' };
        var R = results();
        addStyleChecks(site.e2e, R);
        return Object.assign({ site: site.key, mode: 'styles' }, R.summary());
    }

    // ---- 翻頁測試 ----
    async function run(opts) {
        opts = opts || {};
        var site = currentSite();
        if (!site) return { error: '目前網域沒有對應的 e2e 設定' };
        var cfg = site.e2e;
        var R = results();

        // 前置：userscript 有沒有在跑。沒有的話後面全部會失敗，先講清楚。
        var injected = !!document.getElementById('Autopage_number');
        R.add('userscript 已注入（頁碼元素存在）', injected,
            injected ? '' : '找不到 #Autopage_number，可能規則沒匹配或腳本沒載入');
        if (!injected && !opts.force) {
            return Object.assign({ site: site.key }, R.summary());
        }

        var beforeCount = qsa(cfg.chapterBlock).length;
        var beforePath = location.pathname;
        var beforeTitle = document.title;
        var titlesBefore = qsa(cfg.titleEl).length;

        R.add('起始有章節內容', beforeCount > 0, '章節區塊 ' + beforeCount + ' 個');
        if (beforeCount === 0) return Object.assign({ site: site.key }, R.summary());

        var paged = await scrollAndWait(cfg, beforeCount, opts.timeoutMs);
        var afterCount = qsa(cfg.chapterBlock).length;

        R.add('翻頁有發生', paged && afterCount > beforeCount,
            '章節區塊 ' + beforeCount + ' → ' + afterCount);
        if (afterCount <= beforeCount) return Object.assign({ site: site.key }, R.summary());

        // 標題數應與章節數同步成長（少了代表 pageE 沒把標題一起帶進來）
        var titlesAfter = qsa(cfg.titleEl).length;
        R.add('章節標題與章節數同步', titlesAfter === afterCount,
            '標題 ' + titlesBefore + ' → ' + titlesAfter + '，章節 ' + afterCount);

        R.add('網址已更新', location.pathname !== beforePath, '');
        R.add('文件標題已更新', document.title !== beforeTitle, '');

        // 導航列必須被替換而不是累積
        var navCount = qsa(cfg.navEl).length;
        R.add('導航列維持唯一', navCount === 1, '找到 ' + navCount + ' 個');

        addStyleChecks(cfg, R);

        // 每章都有、但整頁只該留一份的功能列
        var blocks = qsa(cfg.chapterBlock);
        var dupes = [];
        (cfg.singletons || []).forEach(function (sel) {
            var n = qsa(sel).length;
            if (n > 1) dupes.push(sel + ' × ' + n);
        });
        R.add('每章重複的功能列沒有堆疊', dupes.length === 0, dupes.join(', '));

        // 廣告：要嘛被移除，要嘛被 CSS 隱藏
        var visibleAds = [];
        (cfg.hiddenAds || []).forEach(function (sel) {
            qsa(sel).forEach(function (el) {
                if (getComputedStyle(el).display !== 'none') visibleAds.push(sel);
            });
        });
        R.add('廣告版位已隱藏或移除', visibleAds.length === 0, visibleAds.join(', '));

        // 插入的章節不該帶進可執行內容
        var leftovers = [];
        for (var k = 1; k < blocks.length; k++) {
            var n = qsa('script, iframe, ins', blocks[k]).length;
            if (n) leftovers.push('第 ' + (k + 1) + ' 章殘留 ' + n + ' 個');
        }
        R.add('插入內容不含 script/iframe/ins', leftovers.length === 0, leftovers.join(', '));

        return Object.assign({ site: site.key }, R.summary());
    }

    // ---- 末章停止測試（在該書最後一章的頁面上執行）----
    async function runStop(opts) {
        opts = opts || {};
        var site = currentSite();
        if (!site) return { error: '目前網域沒有對應的 e2e 設定' };
        var cfg = site.e2e;
        var R = results();

        var before = qsa(cfg.chapterBlock).length;
        var navBefore = qsa(cfg.navEl).length;
        R.add('起始有章節內容', before > 0, '章節區塊 ' + before + ' 個');

        // 這裡預期「不會」翻頁，所以等固定時間而不是等變化。
        // 仍要用 nudgeToBottom 真正驅動引擎 —— 否則根本沒觸發，
        // 「沒有翻頁」就成了毫無意義的假通過。
        var deadline = Date.now() + (opts.waitMs || 8000);
        while (Date.now() < deadline) {
            nudgeToBottom();
            await sleep(1000);
        }

        var after = qsa(cfg.chapterBlock).length;
        R.add('末章不再翻頁', after === before, '章節區塊 ' + before + ' → ' + after);
        // 比對前後而不是斷言等於 1：有些站的末章頁原生就帶不只一組導航
        // （七猫的付費牆章節頁就有兩組）。真正的不變條件是「沒有累積」。
        var navAfter = qsa(cfg.navEl).length;
        R.add('導航列沒有累積', navAfter <= navBefore, '導航列 ' + navBefore + ' → ' + navAfter);

        return Object.assign({ site: site.key, mode: 'stop' }, R.summary());
    }

    window.APE2E = {
        run: run,
        runStop: runStop,
        checkStyles: checkStyles,
        sites: SITES,
        currentSite: currentSite
    };
}());
