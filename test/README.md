# 測試

兩層，各自抓不同類型的問題。改完規則兩層都跑一次。

| | 執行方式 | 需要網路 | 抓什麼 |
|---|---|---|---|
| 靜態檢查 | `node test/static.test.js` | 否 | 規則沒註冊、`@match` 漏掉、兩版不同步、規則太寬 |
| 瀏覽器 e2e | 注入頁面後呼叫 `APE2E.*` | 是 | 翻頁沒發生、樣式不一致、功能列重複、末章沒停 |

## 靜態檢查

```bash
node test/static.test.js
```

零依賴、離線可跑，失敗時 exit code 為 1。

它把兩個 userscript 的規則物件抽出來（用括號配對切出字面量再單獨求值，不會真的執行腳本），然後檢查：

- 兩個腳本語法正確、版本號格式正確
- 小說站規則都有 `pager.nextL` 與 `pager.pageE`
- 小說站規則兩個版本都有（刻意不做的要登記到 `IPHONE_EXEMPT`）
- 兩版同名規則的 `nextL` / `pageE` / `replaceE` 一致
- **每個章節頁樣本的網域都被 iPhone 版的 `@match` 涵蓋**
- 章節頁能匹配到預期規則、非章節頁不會誤匹配

`@match` 那項是實際踩過的坑：iPhone 版有 `qimao` 規則，但 `@match` 從沒加過 qimao.com，所以那條規則在 iPhone 上根本不會被注入。症狀跟「規則寫錯」一模一樣，卻更難察覺。

## 瀏覽器 e2e

e2e 測的是**頁面上實際在跑的那份 userscript**。要驗證還沒提交的本機修改，得先讓瀏覽器跑到你改的版本：把本機檔案更新進 Tampermonkey，或停用已安裝的版本後手動注入本機檔案。否則你測到的是舊版。

在章節頁的 console 依序貼上 `test/fixtures/sites.js` 與 `test/e2e-browser.js`，然後：

```js
await APE2E.run()          // 翻頁測試：在一般章節頁跑
await APE2E.runStop()      // 停止測試：在該書最後一章跑
APE2E.checkStyles()        // 只比對畫面上已有章節的樣式，不翻頁
```

回傳 `{ site, passed, failed, ok, checks }`，`checks` 是每項的 PASS/FAIL 說明。

`run()` 檢查：翻頁有發生、標題數與章節數同步、網址與文件標題已更新、導航列維持唯一、**標題與正文的 computed style 與首章一致**、每章重複的功能列沒有堆疊、廣告已隱藏或移除、插入內容不含 `script`/`iframe`/`ins`。

樣式那項用一整組 computed style 屬性逐一比對，不是挑幾個看。ttks 那次「插入章節標題顏色不對」就是只比了字級沒比顏色才漏掉的——現在移除插入標題的 inline color 再跑 `checkStyles()`，會直接指出 `color: rgb(0, 0, 0) ≠ rgb(27, 38, 49)`。

### 為什麼要自己派發 scroll 事件

`window.scrollTo()` 會改變捲動位置，但在自動化執行環境（CDP evaluate）底下**不會派發 scroll 事件**，翻頁引擎因此永遠不會被觸發，看起來就像壞了。引擎的 handler 是自己從 DOM 重算位置、不讀事件物件，所以 `e2e-browser.js` 在捲動後補一個合成 `scroll` 事件來驅動它。

另外引擎在捲動差值為 0 時會直接 return，所以每輪要先往上一點再回到底部，否則停在底部之後就再也不會觸發。

## 新增站台規則時

在 `test/fixtures/sites.js` 加一筆。靜態檢查會要求「每條 iPhone 規則都有樣本」，漏加會直接失敗。

```js
{
    key: 'example',              // 必須與規則物件的 key 相同
    verified: false,             // 真的用瀏覽器實測過翻頁才設 true
    chapter: [['example.com', '/read/1/2.html']],   // 應匹配到 key
    notChapter: [['example.com', '/book/1/']],      // 不該匹配到 key
    e2e: {                       // 選填，有才能跑瀏覽器 e2e
        start: 'https://example.com/read/1/2.html',
        last: 'https://example.com/read/1/999.html',  // 最後一章
        chapterBlock: '.content',   // 每章一個，翻頁後會增加
        titleEl: '.content h1',     // 章節標題
        navEl: '.pager',            // 上下章導航，必須維持唯一
        textEl: 'p',                // 正文段落；正文非段落結構就設 null
        singletons: ['.share'],     // 每章都有但整頁只該留一份的元素
        hiddenAds: ['.ad'],         // 應被移除或 display:none 的廣告
    },
}
```

`notChapter` 要放目錄頁、完本頁這類同網域但非章節的網址。這些正是規則寫太寬時會誤啟用的地方，而末章的「下一章」往往就指向它們——ttks 指向 `index.html`、twkan 與 ixdzs 指向 `end.html`。
