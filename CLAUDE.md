# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

AutoPager 是一個 Tampermonkey 油猴腳本（UserScript），提供瀏覽器自動無縫翻頁功能（無限滾動）。純 JavaScript 專案，無構建系統、無套件管理器。

- **分發**: GreasyFork (https://greasyfork.org/zh-CN/scripts/419215)
- **授權**: GPL-3.0
- **原作者**: X.I.U

## 檔案結構

| 檔案 | 用途 |
|------|------|
| `AutoPager-6.6.73.user.js` | 最新版主程式（~3000 行） |
| `AutoPager-6.6.66.user.js` | 舊版本，供對照參考 |
| `autoPager-custom.js` | 自定義規則 JSON 範本 |

## 開發方式

無 build 系統。開發流程：
1. 直接編輯 `.user.js` 檔案
2. 跑靜態檢查：`node test/static.test.js`（零依賴、離線可跑）
3. 透過 Tampermonkey 管理器重載，在真實章節頁跑瀏覽器 e2e
4. 瀏覽器 DevTools Console 查看 `console.info()` / `console.error()` 輸出
5. 比較兩版本差異：`diff AutoPager-6.6.66.user.js AutoPager-6.6.73.user.js`

### 測試

改完規則兩層都要跑，細節見 `test/README.md`：

- **靜態檢查** `node test/static.test.js` — 抓規則沒註冊、iPhone 版 `@match` 漏掉、
  桌面與 iPhone 版選擇器不同步、規則太寬會在目錄頁誤啟用。
- **瀏覽器 e2e** — 注入 `test/fixtures/sites.js` 與 `test/e2e-browser.js` 後呼叫
  `APE2E.run()` / `APE2E.runStop()` / `APE2E.checkStyles()`，驗證翻頁真的發生、
  插入章節的 computed style 與首章一致、功能列沒重複堆疊、末章乾淨停止。

新增站台規則時，必須在 `test/fixtures/sites.js` 補一筆樣本，否則靜態檢查會失敗。

## 架構設計

### 規則驅動模式

核心是 **聲明式規則**（DBSite 物件），每條規則定義一個網站的翻頁行為，而非硬編碼邏輯。規則來源三層：

1. **內置規則** — `setDBSite()` 函數中定義，覆蓋 200+ 網站
2. **外置規則** — 從多個 CDN/GitHub 代理源遠程加載 `rules.json`
3. **自定義規則** — 用戶透過菜單編寫 JSON，參考 `autoPager-custom.js`

### 六種翻頁模式（pager.type）

| Type | 模式 | 說明 |
|------|------|------|
| 1 | 靜態加載 | XHR 獲取下一頁 HTML 並插入 DOM（預設） |
| 2 | 按鈕點擊 | 自動點擊「加載更多」按鈕 |
| 3 | 滾動觸發 | 基於滾動距離觸發翻頁 |
| 4 | 動態加載 | 透過自定義函數加載 |
| 5 | iframe 無限套娃 | iframe 嵌套加載 |
| 6 | iframe 單層 | 單個 iframe 加載後插入 |

### 規則物件結構

```javascript
{
  "host": "domain.com" | ["domain1.com", "domain2.com"],
  "url": /regex/ | function,
  "pager": {
    "type": 1-6,
    "nextL": "CSS選擇器|XPath",    // 下一頁鏈接定位
    "pageE": "CSS選擇器|XPath",    // 要提取的內容元素
    "insertP": ["selector", position],  // 插入位置
    "replaceE": "selector",        // 要替換的元素（頁碼等）
    "scrollD": number,             // 滾動觸發距離
    "scriptT": 0-3                 // script 標籤處理方式
  },
  "function": {
    "bF": function,  // 插入前回呼
    "aF": function   // 插入後回呼
  }
}
```

### 核心模組與函數

- **規則管理**: `getRulesUrl()`, `setDBSite()`, `customRules()`, `doesItSupport()`
- **翻頁流程**: `pageLoading()` → `getPageE(url)` → `processElems()` → `replaceElems()`
- **DOM 選擇**: `getCSS()`, `getAllCSS()`, `getXpath()`, `getAllXpath()`, `getOne()`, `getAll()`
- **下一頁 URL 提取**: `getNextE()`, `getNextEP()`, `getNextSP()`, `getNextEPN()`, `getNextUPN()`, `getNextUP()`, `getNextF()`
- **iframe 加載**: `insIframe()`, `insIframe_()`
- **用戶菜單**: `registerMenuCommand()`, `menu_switch()`, `menu_disable()`
- **工具函數**: `addHistory()`, `cleanuEvent()`, `isMobile()`, `insStyle()`, `insScript()`

### 油猴 API 依賴

腳本依賴以下 Tampermonkey/Violentmonkey API：
- `GM_xmlhttpRequest` — 跨域請求（繞過 CORS）
- `GM_getValue` / `GM_setValue` — 持久化存儲用戶設定
- `GM_registerMenuCommand` — 註冊右鍵/菜單項
- `GM_notification` — 桌面通知
- `unsafeWindow` — 存取頁面 window 物件
- `window.onurlchange` — 監聽 SPA/PJAX URL 變化

## 修改注意事項

- 腳本開頭的 `// ==UserScript==` 元數據區塊是油猴管理器解析的配置，格式有嚴格要求
- `@exclude` 列表排除了購物、視頻等不適合自動翻頁的網站
- `@connect` 列表聲明所有允許跨域請求的域名，新增遠程源需同步更新
- 外置規則有 30+ 個 CDN/代理源做容錯，分佈在 `getRulesUrl()` 中
- `webTypeIf()` 包含 WordPress/Typecho 等通用 CMS 的自動檢測邏輯

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).
