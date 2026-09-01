# social-autopub — 多语言社媒自动发布系统

Notion / HTTP 推送 / WikiFX 热点选题 → LLM 生成各平台文案 → 人工审核 → Postiz 发布到 X / Instagram / Facebook。
支持 10 种语言 × 2 类内容表，自动路由到对应账号。WikiFX 是控制台内的候选素材渠道，只有运营明确采用后才进入生成队列。

## 架构

```
Notion(10语言×2表) ─┐                         ┌─> X
HTTP /v1/ingest ────┼─> api ─> LLM 生成 ─> 审核工作台 ─> Postiz ──┤─> Instagram
WikiFX 热点 ─> 选题 ─┘   (轮询/队列)       (console)               └─> Facebook
          │             Postgres(状态)  Redis(队列: BullMQ)        Postiz(账号/发布)
          └─> wikifx-content sidecar（curl_cffi 抓取 + SQLite 正文缓存）
```

| 模块 | 说明 |
|---|---|
| `apps/api` | NestJS 单体：Notion 轮询、WikiFX 热点读取、HTTP ingest、LLM 生成、路由矩阵、Postiz 发布（BullMQ worker 同进程） |
| `apps/console` | Next.js 运营控制台：热点选题 / 内容队列 / 审核工作台 / 发布记录 / 设置 |
| `apps/wikifx-content` | WikiFX 正文抓取 sidecar：复用 Go 脚手架的 `curl_cffi` 抓取、四级正文抽取、SQLite 缓存与结构化状态 |
| Postgres + Redis | 系统状态与任务队列；Docker 部署自带，Railway 用插件；sidecar 另有持久化 volume |

- 表结构/字段：`apps/api/prisma/schema.prisma`；环境变量按根目录 `.env.example`
- **分支模型**：`dev` → Railway（staging，`DRY_RUN=true`）；`main` → 自托管 Docker（生产）

## 部署

### 方式一：自托管 Docker（生产，推荐）

前置：一台装有 Docker + compose 的服务器，以及 `apps/api`、`apps/console` 的域名（绑 HTTPS）。

```bash
# 1. 拉代码（GitLab 默认 master 即生产分支；GitHub 对应 main）
git clone git@gitlab.fx696.com:mkt-dept/social-autopub.git
cd social-autopub
# 如从 GitHub 克隆：git checkout main

# 2. 配置环境变量（参照根目录 .env.example；Docker 下这些必填）
cp .env.example .env        # 填入真实值，尤其：PUBLIC_API_URL 等
```
> 关键项：`DATABASE_URL/REDIS_URL`（compose 内网地址写死不用改）、`NOTION_TOKEN`、`WIKIFX_ARTICLES_API_KEY`、`WIKIFX_CONTENT_API_KEY`（api 与 sidecar 相同）、`OPENROUTER_API_KEY`(或 `ANTHROPIC_API_KEY`)、`POSTIZ_API_URL/POSTIZ_API_KEY/POSTIZ_JWT_SECRET`、`PUBLIC_API_URL`(本服务公网地址，Postiz 回调要能访问)、`ADMIN_API_KEY`(api/console 一致)、`AUTH_SECRET`、`ADMIN_EMAIL/ADMIN_PASSWORD`、`INGEST_API_KEYS`。

```bash
# 3. 启动（Postgres + Redis + WikiFX content sidecar + api + console 全量编排）
docker compose up -d --build

# 4. 唯一公网入口：console（api 全内网，无对外端口）
#    数据流：浏览器 → console:3001 →（Docker 内网）→ api:3000
#    反向代理只需对 console 开放（配 HTTPS）：
#    console.example.com { reverse_proxy 127.0.0.1:3001 }
#    若要用 HTTP ingest 或 Postiz OAuth 绑号，见 compose 内 Caddy 注释按路径放行 api
```

**初始化（全部在控制台页面完成，无需动数据库）**
1. 「设置」页登记各 Notion 表的 Database ID + 语言
2. 「账号健康」页点「立即同步」拉取 Postiz 账号 → 「路由矩阵」页配置 语言 × 类型 × 平台 → 账号
3. 建库默认空表：启动时 `prisma migrate deploy` 自动建表；若某库此前用 `db push` 建过，先执行 `docker exec <api容器> sh -c './node_modules/.bin/prisma migrate resolve --applied 0_init'` 标记基线

**上线纪律**：首次启动保持 `DRY_RUN=true`（只建 Postiz 草稿）→ 走一遍「Notion 勾选 → 审核 → 出草稿」验证 → 确认无误后 `DRY_RUN=false` 真发。

### 方式二：Railway（staging）

`dev` 分支，`DRY_RUN=true`：
1. Postiz：官方 Railway 模板（锁 v2.11.3、避开 Temporal），配 `MAIN_URL/FRONTEND_URL/NEXT_PUBLIC_BACKEND_URL`，管理员后置 `DISABLE_REGISTRATION=true`，配好各账号 OAuth 与 API Key
2. 本仓库推 GitHub → Railway 建项目：Postgres + Redis 插件，再建三个服务
   - `wikifx-content`：Root `apps/wikifx-content`，使用目录内 Dockerfile；绑定持久化 volume 到 `/app/data`（`deploy/railway-deploy.sh` 会创建，并设置 `RAILWAY_RUN_UID=0`）
   - `api`：Root `apps/api`，Build `pnpm install && pnpm build`，Start `pnpm start`
   - `console`：Root `apps/console`，Build `pnpm install && pnpm build`，Start `pnpm start`
3. 在 `wikifx-content` 与 `api` 服务设置相同的随机 `WIKIFX_CONTENT_API_KEY`；api 的 `WIKIFX_CONTENT_API_URL` 填 sidecar private URL（HTTP private URL 同时设 `WIKIFX_CONTENT_ALLOW_INSECURE_HTTP=true`）。环境变量按 `.env.example` 配置；staging 保持 `DRY_RUN=true`

## 环境变量速查

见根目录 `.env.example`（每个变量都带注释）。补充两点：
- `PUBLIC_API_URL`：仅 Postiz OAuth 绑号回调需要对外可达（compose 已注释对应 Caddy 放行）；若账号在 Postiz 网页手动绑，此变量可不配置
- `API_INTERNAL_URL`：console 服务端直连 api 用（Docker Compose：`http://api:3000`；当前 Railway：`http://api.railway.internal:8080`；不配则回退公网地址）
- `WIKIFX_ARTICLES_API_KEY`：WikiFX 热点榜单 Bearer Key，仅配置在 api 服务端；浏览器和 console 均不持有
- `WIKIFX_ARTICLES_API_URL`：热点榜单上游地址（单篇 detail 不再从此地址派生）
- `WIKIFX_CONTENT_API_URL` / `WIKIFX_CONTENT_API_KEY`：api 访问内部正文 sidecar 的地址与 Bearer key；sidecar 的 key 必须完全一致
- `WIKIFX_CONTENT_ALLOW_INSECURE_HTTP`：仅允许 api→内网 sidecar 使用 HTTP 时开启；公网地址必须 HTTPS

## Notion 接入约定

- 字段：`social_media_sent`(Checkbox，勾选即触发)、`内容类型`(新闻/教育/测评/曝光，可空按表兜底)、`摘要`(正文为空兜底)、`发布链接 / Publish link`(exposure-review 必填，支持 URL/Rich text/Formula string)
- `exposure-review` 保存原始 `.com` 链接；发布时只把 hostname 末尾 `.com` 派生为 `.me`，按内容类型和语言追加只读 CTA。缺失或非法链接会阻止生成/发布并在控制台显示错误。
- 系统**只读 Notion 不回写**；字段名调整只改 `apps/api/src/sources/notion/notion.constants.ts`
- 历史补链必须在获得数据库变更与 Railway 部署批准、确认 migration 已成功应用，并确认新版本 rollout 已完全结束、所有旧 API/generation worker 实例均已停止后运行；部署窗口更稳妥的做法是暂停 Notion poll/generation worker，避免旧 worker 消费新版 `generationRevision/forceReview` 任务。仓库开发环境先完成 API build，再执行 `pnpm --filter api backfill:exposure-review-links`；已部署的 Railway API runtime 不包含 pnpm workspace，应执行 `npm run backfill:exposure-review-links`，也可直接执行 `node dist/scripts/backfill-exposure-review-links.js`。命令使用专用 application context（不启动发布 worker/定时任务），完整分页并输出分类 JSON 报告；`requeued` 表示已安全入生成队列，不表示草稿已经生成。它不会处理已禁用来源、`GENERATING`、已有 PublishJob 或已进入批准/发布终态的内容。若报告中 `activeGenerating > 0`，等待这些任务结束后再次执行。历史重生成任务始终强制进入 `REVIEW`，即使 `AUTO_PUBLISH=true`。该命令会写数据库和生成队列，必须单独批准后运行。

## WikiFX 热点接入约定

- 控制台「热点选题」按最近 `1..3` 个完整自然日读取榜单，未采用的热点不会创建 `ContentItem` 或调用 LLM。
- 采用时 api 会从可信榜单与内部 WikiFX content sidecar 重新解析正文，浏览器提交的标题、正文和图片不会直接入库。
- 正文为空的文章只展示，不允许采用；有效首图会进入生成稿媒体。
- `externalId` 使用 `language:article_id`，避免多语言文章 ID 相互覆盖。
- WikiFX 内容即使在 `AUTO_PUBLISH=true` 下也强制进入人工审核。
- 榜单服务端缓存 60 秒；上游暂不可用时最多回退到 24 小时内的旧缓存；正文由 sidecar 的持久化 SQLite 缓存管理。详细接口说明见 `apps/api/WIKIFX.md` 与 `apps/wikifx-content/README.md`。

## 快速验证

1. `curl <sidecar>/healthz` → `{"ok":true,...}`；配置 sidecar 后 api 的 `/healthz` 会检查 `wikifx_content=ok`
2. `curl <api>/healthz` → `{"ok":true,"deps":{"db":"ok","redis":"ok","wikifx_content":"ok"}}`（尚未配置 sidecar 的 staged API 会标记 `not_configured`，不影响其它来源）
3. HTTP 入口：`curl -X POST <api>/v1/ingest -H "x-api-key: <key>" -H "Content-Type: application/json" -d '{"external_id":"t1","language":"en","content_type":"news","title":"Test","body":"Hello"}'`
4. WikiFX 读取：登录控制台打开「热点选题」，确认统计区间、缓存状态和列表可见；没有 Key 或 sidecar 时页面应显示服务未配置/不可用错误
5. WikiFX 手动验证：对 `POST /v1/topics/wikifx/fetch-by-url` 使用 `force=true`，确认 sidecar 返回 `status=ok`、`content_chars>0`，再次请求 `force=false` 命中 Redis/SQLite 缓存
6. WikiFX 采用会创建内容并调用 LLM，只在获得对应副作用批准后联调；采用后应进入 `REVIEW`，不得自动发布
7. 全链路（staging）：Notion 勾选 → 5 分钟内队列出现 → 审核「通过并发布」→ Postiz 出草稿（`DRY_RUN`）
