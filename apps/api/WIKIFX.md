# WikiFX server integration

WikiFX credentials stay in the API service. The console or browser must call the existing server-side proxy and must never receive `WIKIFX_ARTICLES_API_KEY` or an upstream `Authorization` header.

## Configuration

- `WIKIFX_ARTICLES_API_KEY` — Bearer token used only by `apps/api`.
- `WIKIFX_ARTICLES_API_URL` — optional; defaults to `https://articles-api.chouai.cc.cd/api/v1/public/wikifx/articles/top`.
- `WIKIFX_ALLOW_CUSTOM_URL` — optional and false by default. A custom API URL is accepted only when it is HTTPS and this flag is explicitly `true`.
## Internal endpoints

Both endpoints use `AdminKeyGuard` and therefore require the same `x-admin-key` used by other console-facing API endpoints. User visibility and edit permission are derived from the trusted `x-user-id` / `x-user-role` headers supplied by the server-side console proxy.

- `GET /v1/topics/wikifx?days=3&top=1`
  - `days`: integer `1..3`
  - `top`: integer `1..20`
  - Operators see only languages returned by `AccessService.visibleLanguages`; admins see all items.
  - Items include a stable `id` (`language:article_id`) and the latest non-superseded adoption.
  - `cache.status` is `upstream`, `local-fresh`, or `local-stale`; stale fallback is limited to cached responses fetched within 24 hours.
- `POST /v1/topics/wikifx/adopt`
  - Body: `{ "article_id": "...", "language": "...", "days": 3, "manual": false }`
  - Default（非 manual）：API re-fetches or reads its trusted cache with `top=1`；browser-submitted article content, title, URL, and media are ignored。
  - `manual: true`：从手动抓取缓存（见下）取正文采用，不要求文章在最近榜单内；缓存过期则 409。同样忽略浏览器提交的正文。
  - Adopted records use `source=wikifx`, `content_type=news`, and always enter review after generation even when `AUTO_PUBLISH=true`.
- `POST /v1/topics/wikifx/fetch-by-url`（手动抓取）
  - Body: `{ "url": "https://www.wikifx.com/ja/newsdetail/202608202624732011.html", "force": false }`
  - 服务端用白名单规则解析 URL（仅 `www.wikifx.com` / `aws-www.wikifx.com` 的 newsdetail 路径、8-32 位数字 ID；拒绝凭据/端口/其它 host），原始 URL 不会转发给上游；上游只收到受控 `language/article_id`。
  - `force=false` 时先读正文库；未抓取返回 422 提示强制抓取；`force=true` 触发上游抓取后返回。
  - 结果在服务端 Redis 短期缓存（10 分钟），`adopt {manual:true}` 从此缓存采用，避免重复抓取。
