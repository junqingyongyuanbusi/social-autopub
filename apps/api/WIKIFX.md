# WikiFX server integration

WikiFX credentials stay in the API service. The console or browser must call the existing server-side proxy and must never receive `WIKIFX_ARTICLES_API_KEY`, `WIKIFX_CONTENT_API_KEY`, or an upstream `Authorization` header.

## Architecture

- `WIKIFX_ARTICLES_API_URL` is used **only** for the trusted ranking (`/top`) response.
- `apps/wikifx-content` is the internal article-content sidecar migrated from `/www/go-scaffold/services/wikifx-article-api`. It owns the `curl_cffi` fetcher, HTML extraction, SQLite cache, and structured fetch status.
- `apps/api` calls the sidecar with `Authorization: Bearer <WIKIFX_CONTENT_API_KEY>` and never derives a detail URL from the public ranking URL.
- The sidecar database must be persistent (`/app/data` in Docker/Railway). Redis remains the short-lived API-level manual preview cache.

## Configuration

- `WIKIFX_ARTICLES_API_KEY` — Bearer token for the ranking upstream; API only.
- `WIKIFX_ARTICLES_API_URL` — optional ranking endpoint; defaults to `https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top`.
- `WIKIFX_ALLOW_CUSTOM_URL` — optional and false by default. A custom ranking URL is accepted only when it is HTTPS and this flag is explicitly `true`.
- `WIKIFX_CONTENT_API_URL` — WikiFX正文功能所需的 sidecar base URL, for example `http://wikifx-content:8000` in Compose or a Railway private URL. API can be staged before this is set, but WikiFX detail/enrichment will report configuration unavailable.
- `WIKIFX_CONTENT_API_KEY` — shared internal Bearer key; set identically on `api` and `wikifx-content`.
- `WIKIFX_CONTENT_ALLOW_INSECURE_HTTP` — must be explicitly `true` for an HTTP private-network sidecar; leave false for public URLs.

## Internal endpoints

All endpoints below use `AdminKeyGuard` and therefore require the same `x-admin-key` used by other console-facing API endpoints. User visibility and edit permission are derived from the trusted `x-user-id` / `x-user-role` headers supplied by the server-side console proxy.

- `GET /v1/topics/wikifx?days=3&top=1`
  - `days`: integer `1..3`
  - `top`: integer `1..20`
  - Operators see only languages returned by `AccessService.visibleLanguages`; admins see all items.
  - Missing topic bodies are resolved through the internal sidecar. Confirmed `not_found` rows are omitted; blocked/timeout/empty rows remain visible with a structured status.
  - Items include a stable `id` (`language:article_id`) and the latest non-superseded adoption.
  - `cache.status` is `upstream`, `local-fresh`, or `local-stale`; stale fallback is limited to cached responses fetched within 24 hours.
- `POST /v1/topics/wikifx/adopt`
  - Body: `{ "article_id": "...", "language": "...", "days": 3, "manual": false }`
  - Default（非 manual）：API re-fetches or reads its trusted ranking cache and resolves missing content through the sidecar；browser-submitted article content, title, URL, and media are ignored。
  - `manual: true`：从手动抓取缓存（见下）取正文采用，不要求文章在最近榜单内；缓存过期则 409。同样忽略浏览器提交的正文。
  - Adopted records use `source=wikifx`, `content_type=news`, and always enter review after generation even when `AUTO_PUBLISH=true`.
- `POST /v1/topics/wikifx/fetch-by-url`（手动抓取）
  - Body: `{ "url": "https://www.wikifx.com/ja/newsdetail/202608202624732011.html", "force": false }`
  - 服务端用白名单规则解析 URL（仅 `www.wikifx.com` / `aws-www.wikifx.com` 的 newsdetail 路径、8-32 位数字 ID；拒绝凭据/端口/其它 host），原始 URL 不会转发给上游；sidecar 只接收受控 `language/article_id`。
  - `force=false` 时先读 sidecar 正文库；未抓取返回 422 `content_not_fetched` 提示强制抓取；`force=true` 调用 sidecar `POST /api/articles/content/{language}/{article_id}/fetch`。
  - sidecar 返回 `ok`、`empty`、`not_found`、`blocked`、`timeout`、`error` 等结构化状态；不能把所有 404 当作原文不存在。
  - 成功结果在 API Redis 短期缓存（10 分钟），`adopt {manual:true}` 从此缓存采用，避免重复抓取。

## Sidecar contract

See `apps/wikifx-content/README.md`. The important endpoints are:

- `GET /api/articles/content/{language}/{article_id}` — database-first read; missing row is HTTP 404 with `detail.code=content_not_fetched`.
- `POST /api/articles/content/{language}/{article_id}/fetch` — force one fetch; extraction/fetch failures are returned as HTTP 200 with `status` and `error_code`.
- `POST /api/articles/content/resolve` — batch read/fetch used to enrich ranked topics.
- `POST /api/articles/content/index` and `GET /api/articles/content/records` — operational state inspection.
