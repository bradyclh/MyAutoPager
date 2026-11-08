# MyAutoPager 雲端閱讀器

把小說下載到自己的 Cloudflare Worker，之後在電腦或 iPhone 開一個網址就能讀，不必再開小說站；閱讀進度跨裝置同步。

```
小說站（userscript「⬇ 下載」）──上傳章節──▶ Worker + D1 ◀──閱讀／進度── 網頁閱讀器（電腦、iPhone）
```

- **Worker**（`src/worker.js`）：`/api/*` 是 API，其餘路徑回傳閱讀器頁面
- **D1**（`schema.sql`）：`books`、`chapters`（純文字）、`progress`（每本書一筆，新的蓋舊的）
- **驗證**：所有 API 都要 `Authorization: Bearer <TOKEN>`；TOKEN 是 Worker secret，只有你知道

免費方案就夠用：D1 免費 5 GB、每天 10 萬次寫入，一部 3000 章的小說約 10–20 MB。

## 部署（一次）

```bash
cd reader
npm install
npx wrangler login                     # 開瀏覽器登入 Cloudflare
npx wrangler d1 create myautopager     # 把輸出的 database_id 貼到 wrangler.toml
npx wrangler d1 execute myautopager --remote --file schema.sql
npx wrangler secret put TOKEN          # 自己設一組長一點的隨機字串
npx wrangler deploy                    # 輸出 https://myautopager-reader.<你的子網域>.workers.dev
```

改了 `schema.sql` 之後重跑 `d1 execute` 即可（全部是 `IF NOT EXISTS`）。

## 使用

1. 在支援的小說站打開任一章，點左側 **Aa** → **⬇ 下載**（桌面版也可從 Tampermonkey 選單）
2. 第一次會要求填 **閱讀器網址**（上面 deploy 輸出的網址）與 **TOKEN**，按「儲存並測試」
3. 選一種下載方式：

| 按鈕 | 做什麼 |
|---|---|
| 從本章開始 | 從目前這章往後抓到最後一章 |
| 整本（第一章起） | 從目錄頁找到第一章，抓整本；碰到已存的章節會跳到上次的結尾繼續 |
| 續抓新章節 | 從上次停下或抓完的地方接著抓（連載更新用） |
| 停止 | 目前這頁抓完就停；未完成的那一章不存，下次從那章重抓 |

4. 按 **📚 書架**（或「開啟這本」）開閱讀器。網址帶著 TOKEN 開啟一次之後就記在那台裝置，TOKEN 會立刻從網址列抹掉；之後直接開閱讀器網址即可。iPhone 可在 Safari「加入主畫面」當成 App 用。

**下載中請讓小說站的分頁保持開啟**（iPhone 請留在前景，Safari 會暫停背景分頁）。每頁間隔 0.7 秒；遇到 403／429／503 會自動放慢重試。

## 閱讀器

- 連續捲動，讀到章末自動接下一章；畫面最多保留 6 章
- 正文區塊限寬 40em、水平置中；字級（自動／手動）與四種背景與 userscript 的 Aa 面板相同
- 正文上快速點兩下：開始／停止自動捲動；鍵盤 ← → 換章；右上 ≡ 目錄
- **進度同步**：停下 3 秒後送出（連續捲動時最多 15 秒一次），切走分頁或關閉時也會送。切回分頁時若另一台裝置讀得更新，會提示「iPhone 剛剛讀到「第 N 章」」，可選擇跳過去或留在原處。裝置名稱可在 Aa 面板修改

## 下載的內容怎麼來

沿用翻頁規則：`nextL` 找下一頁、`pageE` 取正文、站方 hook（`bF`／`beforePage`）做解密、倒序轉正、去廣告，再轉成純文字段落。同一章拆成多頁的站（oop.tw、novels.com.tw）以標題去掉頁碼後比對來合併，分頁切在句子中間的段落會接回去。

書本 id 取自章節頁上的「目錄／書頁」連結（去掉 `www.`／`m.` 前綴），所以電腦與手機下載同一本書會對到同一筆。

## 測試

```bash
npm test                                         # API 測試（node:sqlite 模擬 D1，零依賴）
npx wrangler d1 execute myautopager --local --file schema.sql
echo 'TOKEN=local-dev-token' > .dev.vars
npx wrangler dev                                 # http://127.0.0.1:8787/#t=local-dev-token
```
