// MyAutoPager 閱讀器 Worker 入口：/api/* 交給 api.js，其餘一律回閱讀器頁面（單頁應用）
import { handleApi } from './api.js';
import READER_HTML from './reader.html';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) return handleApi(request, env);
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
        return new Response(READER_HTML, {
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-cache',
                // 頁面只連自己的 /api，不載任何外部資源
                'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
                'referrer-policy': 'no-referrer',
                'x-content-type-options': 'nosniff',
            },
        });
    },
};
