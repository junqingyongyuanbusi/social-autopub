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
  - Body: `{ "article_id": "...", "language": "...", "days": 3 }`
  - The API re-fetches or reads its trusted cache with `top=1`; browser-submitted article content, title, URL, and media are ignored.
  - Adopted records use `source=wikifx`, `content_type=news`, and always enter review after generation even when `AUTO_PUBLISH=true`.
