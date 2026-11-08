-- MyAutoPager 閱讀器（Cloudflare D1）
-- 套用：npx wrangler d1 execute myautopager --remote --file schema.sql
-- 可重複執行（IF NOT EXISTS）

CREATE TABLE IF NOT EXISTS books (
    id          TEXT PRIMARY KEY,          -- 由 userscript 依網址推導，例如 oop.tw/areada/xxx/
    title       TEXT NOT NULL,
    site        TEXT,                      -- 規則名稱（oop、ttks…）
    source_url  TEXT,                      -- 書頁／目錄網址，供閱讀器「回原網站」
    next_url    TEXT,                      -- 下次續抓的起點；NULL = 上次已抓到最後
    next_skip   INTEGER NOT NULL DEFAULT 0,-- 1 = next_url 那頁已存過，續抓時只用它找下一頁
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- idx 是閱讀順序（0 起算、連續）。插入到中間時整段往後移，所以不設成唯一鍵；
-- 進度以 chapter url 記錄，不受移位影響。
CREATE TABLE IF NOT EXISTS chapters (
    book_id  TEXT NOT NULL,
    idx      INTEGER NOT NULL,
    url      TEXT NOT NULL,                -- 該章第一頁的網址（同章分頁已合併）
    title    TEXT NOT NULL,
    content  TEXT NOT NULL,                -- 純文字，段落以 \n 分隔
    chars    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (book_id, url)
);
CREATE INDEX IF NOT EXISTS chapters_order ON chapters (book_id, idx);

-- 下載紀錄：每按一次下載就一筆，userscript 下載中定期回報。
-- 書架靠它顯示「下載中 120 / 約 350 章（電腦，1 分鐘前）」，別台裝置也看得到
CREATE TABLE IF NOT EXISTS download_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     TEXT NOT NULL,
    mode        TEXT,                      -- here／all／resume
    device      TEXT,
    state       TEXT NOT NULL,             -- running／done／stopped／error
    chapters    INTEGER NOT NULL DEFAULT 0,
    est         INTEGER NOT NULL DEFAULT 0,-- 估計總章數（0 = 不知道）
    message     TEXT,
    started_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS download_runs_book ON download_runs (book_id, id);

CREATE TABLE IF NOT EXISTS progress (
    book_id      TEXT PRIMARY KEY,
    chapter_url  TEXT NOT NULL,
    ratio        REAL NOT NULL DEFAULT 0,  -- 章內捲動位置 0–1
    device       TEXT,
    updated_at   INTEGER NOT NULL
);
