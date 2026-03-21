# AutoPager 重寫設計規格

自建 Tampermonkey 自動無縫翻頁腳本，不依賴外部開發者或 CDN 規則源。

## 需求摘要

- 通用型自動翻頁腳本，匹配所有網站 (`*://*/*`)
- 規則驅動架構：內建規則 + 菜單 JSON 編輯器覆蓋層
- 純本地規則管理，無外部 CDN 依賴
- 3 種翻頁模式（原版 6 種精簡合併）
- 4 項菜單功能（原版 7 項精簡）
- 約 15 條內建規則覆蓋常用場景

## 架構

單一 IIFE (`(function(){ ... })()`)，分為以下區塊：

```
UserScript 元數據
Config — 全域常數/預設值
Rules — 內建規則 (DBSite)
Core — 滾動偵測、翻頁引擎
DOM — 選擇器 (CSS/XPath)、插入、替換
Rules Engine — 匹配、合併
UI — 頁碼按鈕、菜單、規則編輯器
Init — 啟動流程
```

## 翻頁模式

### Type 1 — XHR 靜態加載（預設）

用 XMLHttpRequest（Chrome）或 GM_xmlhttpRequest（Firefox）取得下一頁 HTML，解析為 Document 後提取 `pageE` 元素插入當前頁。

觸發方式：
- 預設：距頁底 `scrollD` px 時觸發
- 有 `scrollE` 欄位時：距基準元素 `scrollD` px 時觸發（取代原版 type 3）

XHR 策略：
- Chrome 優先用原生 XMLHttpRequest（解決 Cloudflare cookie 問題）
- Firefox 用 GM_xmlhttpRequest + cookiePartition + arraybuffer + TextDecoder（解決 GBK 亂碼）

### Type 2 — 點擊按鈕

網站自帶「載入更多」功能，腳本只需在觸發線自動 `element.click()`。支援 `nextText`（完全匹配）、`nextTextOf`（包含匹配）、`isHidden`（隱藏時跳過）。

### Type 6 — iframe 提取

對付重度客戶端渲染的網站。建立隱藏 iframe 載入下一頁，分段模擬滾動觸發懶載（將 loadTime 除以 10，分 12 次 setInterval 逐步捲動 iframe 到不同高度，最後一次提取 DOM），提取後走 `processElements()` 流程。

## 規則格式

```javascript
{
  "規則名稱": {
    // 匹配條件
    "host": "domain.com" | ["a.com", "b.com"] | "/regex/",
    "url": "/regex/" | "fun.indexOF('/path')",

    // 翻頁行為
    "pager": {
      "type": 1 | 2 | 6,
      "nextL": "CSS|XPath|js;code",
      "pageE": "CSS|XPath",
      "insertP": ["selector", 1-6],
      "replaceE": "selector",
      "scrollD": 2000,
      "scrollE": "selector",
      "interval": 500,
      "scriptT": 0-3,
      "forceHTTPS": false,
      "nextText": "string",
      "nextTextOf": "string",
      "isHidden": false,
      "loadTime": 300
    },

    // 選項
    "style": "CSS rules",
    "history": true,
    "retry": 3000,
    "blank": 1-6,

    // 鉤子函數
    "function": {
      "bF": "code" | function,
      "bFp": [params],
      "aF": "code" | function,
      "aFp": [params]
    }
  }
}
```

欄位預設值：
- `type`: 1
- `scrollD`: 2000
- `interval`: 500
- `insertP`: `[pageE, 5]`（pageE 最後一個元素之後）
- `loadTime`: 300（type 6）

`scrollE` 欄位取代原版獨立的 type 3。有 `scrollE` 時，觸發計算沿用原版算法：`scrollE.offsetTop - (scrollTop + viewportHeight) ≤ scrollD`（使用 offsetTop 而非 getBoundingClientRect，與原版行為一致）。

額外欄位（未列入上方主格式，但自定義規則可用）：
- `noReferer`: true — XHR 請求不帶 Referer header
- `xRequestedWith`: true — XHR 請求加 `X-Requested-With: XMLHttpRequest` header
- `gmxhr`: true — 強制使用 GM_xmlhttpRequest 而非原生 XMLHttpRequest
- `insertP6Br`: true/false — insertP 位置 6（文字型）時是否在段落間加 `<br/><br/>`（預設自動偵測：檢查正文末尾是否已有 `<br>`）

`retry` 欄位語義：pageE 提取失敗後，等待 retry 毫秒重設 pageUrl 為空，允許下次捲動重新觸發翻頁嘗試。

`blank` 欄位語義（強制新分頁開啟連結）：
- 1: 用 `<base target="_blank">` 全域設定
- 2: 在 document.body 上委託 click 事件，攔截 `<a>` 點擊
- 3: 在 pageE 父元素上委託 click 事件
- 4: 直接對 pageE 內所有 `<a>` 加 `target="_blank"`
- 5: 克隆 `<a>` 元素並加 `target="_blank"`
- 6: 同 5 + 額外 `stopPropagation` 阻止父元素事件委託

自定義規則支援 `inherits: true`，深度合併 pager 子物件後覆蓋同名內建規則。

## 規則匹配引擎

### 合併順序（優先級高 → 低）

1. 自定義規則（GM_getValue 存儲）
2. 內建規則（腳本內 DBSite）

同名規則時自定義覆蓋內建。`inherits: true` 時深度合併而非完全覆蓋。

### 匹配流程

遍歷合併後規則，第一個匹配即停止：

1. `host` 匹配：string → `location.hostname === host`（精確匹配）、array → any `===` match、"/re/" → regex test hostname
2. `url` 匹配（可選）："/re/" → regex test `location.pathname + location.search`、其他字串 → `new Function('fun', 'rule', code)(window.autoPage, currentRule)` 執行，回傳 truthy 為匹配。`rule` 參數允許在匹配階段動態修改規則屬性。
3. 禁用清單檢查（menu_disable，以 `location.hostname` 為粒度）

### SPA/PJAX 支援

規則的 `url` 函數可呼叫 `fun.isUrlC()` 設置全域 `urlC = true` 旗標。此呼叫發生在匹配階段（`url` 函數執行時的副作用）。初始化流程在所有規則匹配完成後，根據 `urlC` 旗標決定是否註冊 URL 變化監聽。

監聽降級策略：
1. 優先使用 Tampermonkey 原生 `window.onurlchange` grant（檢查 `window.onurlchange !== undefined`）
2. 若不可用，手動攔截 `history.pushState` / `replaceState` + 監聽 `popstate`

URL 變化時：重置 curSite → 重新匹配規則 → 重啟翻頁引擎

## 核心翻頁流程

```
scrollWatcher (scroll 事件)
  → 方向判斷 (down only)
  → 暫停狀態判斷
  → 觸發線計算（scrollE 模式 or 頁底模式）
  → intervalPause() 鎖定防連續觸發
  → resolveNextURL() 取得下一頁 URL
  → 依 type 分流：fetchNextPage / clickNextButton / iframeExtract
  → processElements()
      → bF 鉤子
      → 計算插入位置
      → 插入 DOM（位置 1-5 用 insertAdjacentElement，位置 6 用 insertAdjacentHTML 拼接 innerHTML）
      → 頁碼 +1
      → 更新歷史
      → 替換元素
      → 處理 script
      → aF 鉤子
```

### resolveNextURL() — nextL 解析

`nextL` 支援三種格式，依序判斷：

1. **function**（type 為 function）— 直接呼叫，回傳 URL 字串
2. **"js;code" 字串**（以 `js;` 開頭）— 去掉前綴後透過 `new Function('fun', code)(window.autoPage)` 執行，回傳 URL
3. **CSS/XPath 選擇器**（其他字串）— 從 DOM 找到元素，取其 `.href` 屬性

所有路徑的共同檢查：
- URL 必須以 `http` 開頭
- URL 不可與上一次取得的 `curSite.pageUrl` 相同（相同代表沒有下一頁）
- `href` 屬性值不可以 `#` 開頭
- 若規則有 `forceHTTPS: true` 且當前頁面為 HTTPS，將 URL 的 `http:` 替換為 `https:`

### replaceElems() — 元素替換

- `replaceE` 有值時：在當前頁和回應頁分別用 `getAll(replaceE)` 取得元素，逐一替換 `outerHTML`
- `replaceE` 未定義時：檢查 nextL 元素是否有同 tagName 的相鄰兄弟元素。是 → 替換 nextL 的父元素（XPath 用 `/..`，CSS 用 getAllParentElement）；否 → 替換 nextL 元素自身
- 替換條件：新舊元素數量必須相等，否則跳過

插入位置 (`insertP[1]`)：
- 1: beforebegin（目標元素前面）
- 2: afterbegin（目標內部開頭）
- 3: beforeend（目標內部末尾）
- 4: afterend（目標元素後面）
- 5: afterend，定位到 pageE 列表最後一個元素（預設）
- 6: beforeend，用 innerHTML 拼接（文字型，如小說）

位置 2/4/5 插入前需反轉 pageE 陣列以維持正確順序。

## UI 元件

### 頁碼按鈕

- Shadow DOM 隔離，避免被網頁 CSS 影響
- 左下角圓形浮動按鈕，預設半透明 (opacity: 0.3)，hover 顯現
- 左鍵點擊：暫停/恢復翻頁（暫停時紅色斜體）
- 右鍵點擊：回到頁頂
- 用 `Object.defineProperty` 監聽 `pageNum.now` 的 set，自動更新文字

### 菜單項（4 項）

| 菜單 | GM key | 預設值 |
|------|--------|--------|
| 啟用/禁用（當前網站） | menu_disable | [] |
| 顯示頁碼及暫停翻頁 | menu_page_number | true |
| 歷史記錄+修改地址/標題 | menu_history | true |
| 自定義翻頁規則 | menu_customRules | {} |

### 規則編輯器

- Shadow DOM 彈窗，全螢幕遮罩
- 規則說明摺疊面板 + 所有規則唯讀列表
- textarea 編輯區，JSON 格式
- 保存時 JSON.parse 驗證，錯誤時定位並選中錯誤位置
- 保存成功後 location.reload()

## 內建規則清單

### 個人規則（2 條）

- **uukanshu**: uukanshu.cc 小說閱讀，隱藏廣告 + className 歸一化
- **69shuba**: 69shuba.tw 小說閱讀，隱藏廣告 + 閱讀樣式

### 搜尋引擎（5 條）

- **google**: Google 搜尋結果翻頁
- **bing**: Bing 搜尋結果翻頁
- **baidu**: 百度搜尋結果翻頁
- **sogou**: 搜狗搜尋翻頁
- **duckduckgo**: DuckDuckGo（type 2 點擊按鈕）

### 通用 CMS 模板（3 條）

- **wordpress_list**: WP 列表頁，用 meta generator / wp-content 偵測
- **wordpress_article**: WP 文章頁多頁分頁
- **discuz**: Discuz! 論壇，用 meta generator 偵測

### 常用站點（5 條）

- **zhihu**: 知乎（type 2）
- **github**: GitHub issues/discussions 列表
- **greasyfork**: GreasyFork 腳本列表
- **stackoverflow**: StackOverflow 搜尋/問題列表
- **v2ex**: V2EX 帖子翻頁

## DOM 工具函數

沿用原版的 CSS/XPath 通用選擇器：

- `getOne(selector)` — 自動判斷 CSS 或 XPath，回傳單一元素
- `getAll(selector)` — 回傳元素陣列
- `insStyle(css)` — 注入 CSS，無 `{}` 時自動加 `{display:none!important}`
- `insScript(selector, contextNode)` — 注入 script 標籤
- `createDocumentByString(html)` — HTML 字串轉 Document 物件

暴露 `window.autoPage` 物件供自定義規則的 `fun` 參數使用，包含所有工具函數。

## 與原版的差異總結

| 項目 | 原版 | 新版 |
|------|------|------|
| 翻頁模式 | 6 種 | 3 種（type 1+3 合併, 2, 6） |
| 規則來源 | 內建 + CDN 外置 + 自定義 | 內建 + 自定義（無 CDN） |
| CMS 偵測 | 隱式魔法 (webTypeIf) | 明確規則 + url 函數判斷 |
| 菜單項 | 7 項 | 4 項 |
| 內建規則 | 200+ 條 | ~15 條（按需擴充） |
| 外部依賴 | 30+ CDN/代理域名 | 無 |
| @connect | 30+ 條 | 無 |
| 程式碼量 | ~3000 行 | 預估 ~800-1000 行 |

## 排除網站

沿用原版的 @exclude 列表，排除購物、視頻等不適合自動翻頁的網站。

## 腳本元數據

```
// @name         MyAutoPager
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_info
// @grant        window.onurlchange
// @grant        unsafeWindow
// @run-at       document-end
// @license      MIT
```
