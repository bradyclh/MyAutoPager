'use strict';

// 這個檔案同時給 node（static 測試）和瀏覽器（e2e 注入）使用，
// 兩邊共用同一份站台定義，避免各寫一份後改到不同步。
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AP_TEST_SITES = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

// 每個規則的比對樣本。
//
// chapter：章節閱讀頁，兩個版本都必須匹配到 key。
// notChapter：同網域但不是章節頁（書庫、目錄、完本頁），不該匹配到 key —
//             規則寫太寬會在這些頁面誤啟用（popupBlock、清內容）。
// verified：是否曾用真實瀏覽器注入完整腳本實測過翻頁。
//           只有 true 的站會出現在 e2e 的預設清單裡。
//
// 新增規則時請一併在這裡加一筆；static 測試會檢查「每條 iPhone 規則都有樣本」，
// 漏加會直接失敗。

return [
    {
        key: 'novel543',
        verified: false,
        chapter: [['look.thisiscm.com', '/123_456.html'], ['look.twword.com', '/123_456.html']],
        notChapter: [['look.thisiscm.com', '/']],
    },
    {
        key: 'uukanshu',
        verified: false,
        // 這條規則沒有 url 限制，整個網域都會匹配，故無 notChapter 樣本
        chapter: [['uukanshu.cc', '/b/123/456.html']],
        notChapter: [],
    },
    {
        key: '69shuba',
        verified: false,
        chapter: [['69shuba.tw', '/txt/123/456']],
        notChapter: [],
    },
    {
        key: '69shuba_com',
        verified: false,
        chapter: [['69shuba.com', '/txt/123/456']],
        notChapter: [],
    },
    {
        key: 'uuread',
        verified: false,
        chapter: [['www.uuread.tw', '/chapter/123.html']],
        notChapter: [['www.uuread.tw', '/book/123.html']],
    },
    {
        key: 'qimao',
        verified: false,
        chapter: [['www.qimao.com', '/reader/index/123'], ['www.qimao.com', '/shuku/123-456']],
        notChapter: [['www.qimao.com', '/shuku/123/']],
    },
    {
        key: 'hjwzw',
        verified: false,
        chapter: [['tw.hjwzw.com', '/Book/Read/123,456']],
        notChapter: [['tw.hjwzw.com', '/Book/123']],
    },
    {
        key: 'ixdzs',
        verified: false,
        chapter: [['ixdzs.tw', '/read/123/p4.html'], ['ixdzs8.com', '/read/123/p4.html']],
        // 末章的下一章指向完本頁 end.html
        notChapter: [['ixdzs.tw', '/read/123/end.html']],
    },
    {
        key: 'ttks',
        verified: true,
        chapter: [['ttks.tw', '/novel/chapters/douluozhifenshenwuhundewotaijinshenle/16.html']],
        // 末章的下一章指向目錄 index.html
        notChapter: [['ttks.tw', '/novel/chapters/douluozhifenshenwuhundewotaijinshenle/index.html']],
        e2e: {
            start: 'https://ttks.tw/novel/chapters/douluozhifenshenwuhundewotaijinshenle/16.html',
            last: 'https://ttks.tw/novel/chapters/douluozhifenshenwuhundewotaijinshenle/108.html',
            chapterBlock: '.frame_body > .content:not(:has(.next_page))',
            titleEl: '.frame_body > .title h1',
            navEl: '.frame_body > .content:has(.next_page)',
            // 正文段落（相對於 chapterBlock）。這裡的字級/顏色與容器不同，
            // 只比容器會漏掉差異，所以要指定到段落層級。
            textEl: 'p',
            // 每章只該有一份的元素（重複代表插入時沒清乾淨）
            singletons: ['.div_feedback', '.social_share_frame'],
            hiddenAds: ['.txtad'],
        },
    },
    {
        key: 'twkan',
        verified: true,
        chapter: [['twkan.com', '/txt/112514/56580647']],
        notChapter: [['twkan.com', '/book/112514/index.html']],
        e2e: {
            start: 'https://twkan.com/txt/112514/56580647',
            last: 'https://twkan.com/txt/112514/57369722',
            chapterBlock: '.txtnav',
            titleEl: '.txtnav h1',
            navEl: '.page1',
            // 正文是純文字節點 + <br>，沒有段落元素，比容器本身即可
            textEl: null,
            singletons: [],
            hiddenAds: ['.txtcenter'],
        },
    },
];

}));
