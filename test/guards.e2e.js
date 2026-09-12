#!/usr/bin/env node
'use strict';

// 彈窗攔截與雙擊手勢的離線 e2e — node test/guards.e2e.js
//
// test/e2e-browser.js 測的是「翻頁有沒有發生」，必須連到真的章節頁。
// 這支測的是與站台無關的兩件事：廣告彈窗擋不擋得住、點兩下會不會
// 順手把底下的廣告一起點下去。兩者都不需要真站台，所以改用一個
// 仿 69shuba 廣告手法的合成頁面，headless 跑、離線可重現。
//
// 需要 playwright（環境已預裝 Chromium）：
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/guards.e2e.js

const fs = require('fs');
const path = require('path');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch (e) {
    try {
        ({ chromium } = require(require('child_process')
            .execSync('node -e "console.log(require.resolve(\'playwright\'))"', {
                env: { ...process.env, NODE_PATH: '/opt/node22/lib/node_modules' },
            })
            .toString()
            .trim()));
    } catch (e2) {
        console.log('略過：找不到 playwright（npm i -g playwright）');
        process.exit(0);
    }
}

const SCRIPT = fs.readFileSync(
    path.join(__dirname, '..', 'MyAutoPager-iPhone.user.js'), 'utf8');

// 腳本本體（去掉 ==UserScript== 中繼資料區塊，那是給管理器看的）
const BODY = SCRIPT.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/m, '');

// Userscripts App 的 GM API shim
const GM_SHIM = `
window.GM = {
    _s: {},
    getValue: function (k, d) { return Promise.resolve(k in this._s ? this._s[k] : d); },
    setValue: function (k, v) { this._s[k] = v; return Promise.resolve(); },
    info: { script: { version: '0.0.0-test' } },
};
window.GM_xmlhttpRequest = function (o) { o.onerror && o.onerror({}); };
`;

// 仿 69shuba 章節頁：正文裡夾廣告錨點、頁面腳本一開始就把 window.open
// 存起來、廣告延遲注入。這些都是真實站台用過的手法。
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>測試章節</title>
<style>body{margin:0}.txtnav{padding:20px;font-size:20px;line-height:2}
.filler{height:3000px}</style></head><body>
<h1 class="hide720">第一章</h1>
<div class="txtnav">
  <p id="plain">這是一段正常的正文文字，點兩下應該要能啟動自動捲動。</p>
  <p><a id="adlink" href="http://ads.example.com/go?x=1" target="_blank">正文裡的廣告錨點</a></p>
  <p id="plain2">後面還有更多正文內容。</p>
</div>
<div class="page1"><a href="/txt/1/1">上一章</a><a href="/txt/1/3">下一章</a></div>
<div class="filler"></div>
<script>
// 廣告載入器的典型作法：最早期就把原始 window.open 存進自己的變數，
// 之後即使 window.open 被覆寫也還能用。document-end 的腳本擋不到這個。
window.__savedOpen = window.open;
window.__adOpened = false;
window.__adClicked = false;

// 廣告錨點用 addEventListener 掛處理器（拔 inline 屬性擋不掉）
document.getElementById('adlink').addEventListener('click', function (e) {
    window.__adClicked = true;
    var w = window.__savedOpen('http://ads.example.com/popup', '_blank');
    if (w) window.__adOpened = true;
});

// 延遲注入的廣告：帶 inline onclick 與跨域 iframe
setTimeout(function () {
    var d = document.createElement('div');
    d.id = 'latead';
    d.className = 'ad-wrap';
    d.innerHTML = '<span id="lateinline" class="ad-wrap" onclick="window.__adClicked=true">late</span>' +
                  '<a id="latelink" href="http://ads.example.com/late" target="_blank">late link</a>';
    document.body.appendChild(d);

    // 站方自己的 UI：inline onclick 必須原封不動保留
    var ui = document.createElement('div');
    ui.innerHTML = '<button id="siteui" onclick="window.__siteUiRan=true">字級</button>';
    document.body.appendChild(ui);

    // 正文中段後來才插進來的廣告錨點 —— 真實站台的非同步廣告載入器就是
    // 這樣做的，而「初始化時掃一次」的作法完全掃不到它。
    var inText = document.createElement('p');
    inText.innerHTML = '<a id="intextad" href="http://ads.example.com/intext" ' +
                       'target="_blank" style="display:block;padding:24px">延遲插入的正文廣告</a>';
    document.querySelector('.txtnav').appendChild(inText);
    document.getElementById('intextad').addEventListener('click', function () {
        window.__adClicked = true;
        var w = window.__savedOpen('http://ads.example.com/intextpopup', '_blank');
        if (w) window.__adOpened = true;
    });
    var f = document.createElement('iframe');
    f.id = 'lateframe';
    f.src = 'http://ads.example.com/frame.html';
    document.body.appendChild(f);
}, 50);

// 同源 iframe 繞過手法：iframe.contentWindow.open 是乾淨的
window.__bypassOpen = function () {
    var f = document.createElement('iframe');
    document.body.appendChild(f);
    try { return !!f.contentWindow.open('http://ads.example.com/bypass', '_blank'); }
    catch (e) { return false; }
};

// 分離的錨點：還沒進 DOM，click 事件傳不到 document
window.__detachedClick = function () {
    var a = document.createElement('a');
    a.href = 'http://ads.example.com/detached';
    a.target = '_blank';
    a.click();
};
</script></body></html>`;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n    ${detail}`}`);
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    });

    // 真的被開出來的分頁（攔截失效才會有）
    const popups = [];
    ctx.on('page', (p) => popups.push(p.url()));

    await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (u.includes('69shuba.com')) {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
        }
        // 廣告網域：回空白，避免真的連外
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    });

    const page = await ctx.newPage();
    // @run-at document-start：必須在頁面腳本之前跑，這正是修正的重點
    await page.addInitScript(GM_SHIM + '\n' + BODY);

    const logs = [];
    page.on('console', (m) => logs.push(m.text()));

    await page.goto('http://www.69shuba.com/txt/89438/40135894');
    await page.waitForTimeout(400);

    // --- 腳本有啟動 ---
    check('腳本有注入並命中規則',
        logs.some((l) => l.includes('匹配: 69shuba_com')),
        `console 沒看到匹配訊息，實際：${logs.slice(0, 5).join(' | ')}`);

    // --- 1. window.open 覆寫早於頁面腳本 ---
    const savedOpenBlocked = await page.evaluate(
        () => window.__savedOpen('http://ads.example.com/direct') === null);
    check('頁面腳本提前存起來的 window.open 也被攔截（document-start 的關鍵）',
        savedOpenBlocked, '頁面腳本快取的參考仍然可用 —— 覆寫跑太晚');

    // --- 2. 同源 iframe contentWindow.open 繞過 ---
    const bypassed = await page.evaluate(() => window.__bypassOpen());
    check('同源 iframe 的 contentWindow.open 繞過被堵住', bypassed === false);

    // --- 3. 分離錨點的程式化 click ---
    await page.evaluate(() => window.__detachedClick());
    await page.waitForTimeout(150);
    check('未進 DOM 的 a.click() 不會開新分頁',
        !popups.some((u) => u.includes('detached')), `popups=${JSON.stringify(popups)}`);

    // --- 4. 正文裡的跨域 _blank 廣告錨點被拆彈 ---
    const adState = await page.evaluate(() => {
        const a = document.getElementById('adlink');
        return { href: a.getAttribute('href'), blocked: a.hasAttribute('data-blocked-href') };
    });
    check('正文內跨域 _blank 廣告錨點被拆彈', adState.href === null && adState.blocked,
        JSON.stringify(adState));

    // --- 5. 延遲注入的廣告也被處理（MutationObserver） ---
    const lateState = await page.evaluate(() => {
        const s = document.getElementById('lateinline');
        const a = document.getElementById('latelink');
        const f = document.getElementById('lateframe');
        return {
            inlineOnclick: s ? s.getAttribute('onclick') : 'missing',
            lateHref: a ? a.getAttribute('href') : 'missing',
            sandbox: f ? f.getAttribute('sandbox') : 'missing',
        };
    });
    check('延遲注入廣告的 inline onclick 被拔掉', lateState.inlineOnclick === null,
        JSON.stringify(lateState));

    // 反向保護：不能為了擋廣告把站方自己的按鈕一起弄壞
    const siteUi = await page.evaluate(() => {
        const b = document.getElementById('siteui');
        return b ? b.getAttribute('onclick') : 'missing';
    });
    check('站方自己 UI 的 inline onclick 沒被誤拔',
        siteUi === 'window.__siteUiRan=true', `onclick=${JSON.stringify(siteUi)}`);
    check('延遲注入的廣告錨點被拆彈', lateState.lateHref === null, JSON.stringify(lateState));
    check('跨域 iframe 被加上不含 allow-popups 的 sandbox',
        typeof lateState.sandbox === 'string' && !/allow-popups/.test(lateState.sandbox),
        `sandbox=${lateState.sandbox}`);

    // --- 6. 站內 _blank 改為同分頁開啟，不是弄死 ---
    const sameOrigin = await page.evaluate(() => {
        const a = document.createElement('a');
        a.href = '/txt/89438/40135895';
        a.target = '_blank';
        a.id = 'sameorigin';
        document.querySelector('.txtnav').appendChild(a);
        return null;
    });
    await page.waitForTimeout(80);
    const soState = await page.evaluate(() => {
        const a = document.getElementById('sameorigin');
        return { href: a.getAttribute('href'), target: a.getAttribute('target') };
    });
    check('站內 _blank 連結保留 href、只拔掉 target',
        soState.href && soState.target === null, JSON.stringify(soState));

    // --- 7. 雙擊正文啟動自動捲動 ---
    const btnText = () => page.evaluate(() => {
        const h = document.getElementById('Autopage_number');
        return h && h.shadowRoot ? h.shadowRoot.querySelector('#btn').style.backgroundColor : '?';
    });
    check('頁碼按鈕有建立', (await btnText()) !== '?');

    const box = await page.locator('#plain').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(120);
    const started = await btnText();
    check('在正文點兩下會啟動自動捲動', /166|rgb/.test(started) && started !== '',
        `按鈕背景色=${JSON.stringify(started)}（啟動時應為綠色）`);

    const y1 = await page.evaluate(() => window.pageYOffset);
    await page.waitForTimeout(700);
    const y2 = await page.evaluate(() => window.pageYOffset);
    check('自動捲動確實在捲', y2 > y1, `y1=${y1} y2=${y2}`);

    // 再點兩下停止
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(120);
    const stopped = await btnText();
    check('再點兩下會停止自動捲動', stopped === '', `按鈕背景色=${JSON.stringify(stopped)}`);

    // --- 8. 關鍵回歸：在廣告錨點上點兩下，不能觸發廣告 ---
    await page.evaluate(() => { window.scrollTo(0, 0); window.__adClicked = false; window.__adOpened = false; });
    await page.waitForTimeout(60);
    const adBox = await page.locator('#adlink').first().boundingBox();
    await page.mouse.click(adBox.x + adBox.width / 2, adBox.y + adBox.height / 2);
    await page.mouse.click(adBox.x + adBox.width / 2, adBox.y + adBox.height / 2);
    await page.waitForTimeout(200);
    const adAfter = await page.evaluate(() => ({ clicked: window.__adClicked, opened: window.__adOpened }));
    check('在廣告錨點上點兩下不會開廣告分頁', !adAfter.opened && !popups.some((u) => u.includes('popup')),
        `${JSON.stringify(adAfter)} popups=${JSON.stringify(popups)}`);
    check('在廣告錨點上點兩下不會觸發廣告的 click 處理器', !adAfter.clicked, JSON.stringify(adAfter));

    // --- 9. 關鍵回歸：初始化「之後」才插進正文的廣告 ---
    // 原版只在啟動時掃一次，所以這顆廣告從來沒被拆彈：手指點下去既會觸發
    // 廣告，asIsInteractive 又因為它仍是帶 href 的 <a> 而放棄手勢 ——
    // 「點兩下跳廣告、而且自動捲動不會啟動」正是這樣來的。
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        window.__adClicked = false;
        window.__adOpened = false;
    });
    // 前面幾項測試會讓自動捲動停在不確定的狀態；用 Esc 歸零，這項才測得準
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const lateBox = await page.locator('#intextad').first().boundingBox();
    await page.mouse.click(lateBox.x + lateBox.width / 2, lateBox.y + lateBox.height / 2);
    await page.mouse.click(lateBox.x + lateBox.width / 2, lateBox.y + lateBox.height / 2);
    await page.waitForTimeout(150);
    const lateAfter = await page.evaluate(() => ({
        clicked: window.__adClicked,
        opened: window.__adOpened,
        bg: (() => {
            const h = document.getElementById('Autopage_number');
            return h && h.shadowRoot ? h.shadowRoot.querySelector('#btn').style.backgroundColor : '?';
        })(),
    }));
    check('在「延遲插入正文」的廣告上點兩下不會觸發廣告',
        !lateAfter.clicked && !lateAfter.opened, JSON.stringify(lateAfter));
    check('在「延遲插入正文」的廣告上點兩下仍能啟動自動捲動',
        lateAfter.bg !== '' && lateAfter.bg !== '?', `按鈕背景色=${JSON.stringify(lateAfter.bg)}`);

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${failed.length ? '✗ 失敗' : '✓ 全數通過'} — ${results.length - failed.length} 項通過、${failed.length} 項失敗`);
    if (failed.length) {
        console.log('\n失敗項目：');
        failed.forEach((f) => console.log(`  - ${f.name}`));
    }
    process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
