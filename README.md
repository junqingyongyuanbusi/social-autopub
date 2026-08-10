# social-autopub — 多语言社媒自动发布系统

Notion / HTTP 推送 → LLM 生成各平台文案 → 人工审核 → Postiz 发布到 X / Instagram / Facebook。
支持 10 种语言 × 2 类内容表，自动路由到对应账号。

## 架构

```
Notion(10语言×2表) ─┐                     ┌─> X
HTTP /v1/ingest ────┼─> api ─> LLM 生成 ─> 审核工作台 ─> Postiz ──┤─> Instagram
                    │   (轮询/队列)       (console)               └─> Facebook
        Postgres(状态)  Redis(队列: BullMQ)        Postiz(账号/发布)
```

| 模块 | 说明 |
|---|---|
| `apps/api` | NestJS 单体：Notion 轮询、HTTP ingest、LLM 生成、路由矩阵、Postiz 发布（BullMQ worker 同进程） |
| `apps/console` | Next.js 运营控制台：内容队列 / 审核工作台 / 发布记录 / 设置 |
| Postgres + Redis | 系统状态与任务队列；Docker 部署自带，Railway 用插件 |

- 表结构/字段：`apps/api/prisma/schema.prisma`；环境变量按根目录 `.env.example`
- **分支模型**：`dev` → Railway（staging，`DRY_RUN=true`）；`main` → 自托管 Docker（生产）

## 部署

### 方式一：自托管 Docker（生产，推荐）

前置：一台装有 Docker + compose 的服务器，以及 `apps/api`、`apps/console` 的域名（绑 HTTPS）。

```bash
# 1. 拉代码（任选一个源）
git clone git@gitlab.fx696.com:mkt-dept/social-autopub.git   # 或 GitHub
cd social-autopub && git checkout main

# 2. 配置环境变量（参照根目录 .env.example；Docker 下这些必填）
cp .env.example .env        # 填入真实值，尤其：PUBLIC_API_URL 等
```
> 关键项：`DATABASE_URL/REDIS_URL`（compose 内网地址写死不用改）、`NOTION_TOKEN`、`OPENROUTER_API_KEY`(或 `ANTHROPIC_API_KEY`)、`POSTIZ_API_URL/POSTIZ_API_KEY/POSTIZ_JWT_SECRET`、`PUBLIC_API_URL`(本服务公网地址，Postiz 回调要能访问)、`ADMIN_API_KEY`(api/console 一致)、`AUTH_SECRET`、`ADMIN_EMAIL/ADMIN_PASSWORD`、`INGEST_API_KEYS`。

```bash
# 3. 启动（Postgres + Redis + api + console 全量编排）
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
2. 本仓库推 GitHub → Railway 建项目：Postgres + Redis 插件，再建两个服务
   - `api`：Root `apps/api`，Build `pnpm install && pnpm build`，Start `pnpm start`
   - `console`：Root `apps/console`，Build `pnpm install && pnpm build`，Start `pnpm start`
3. 环境变量按 `.env.example` 配置；staging 保持 `DRY_RUN=true`

## 环境变量速查

见根目录 `.env.example`（每个变量都带注释）。补充两点：
- `PUBLIC_API_URL`：仅 Postiz OAuth 绑号回调需要对外可达（compose 已注释对应 Caddy 放行）；若账号在 Postiz 网页手动绑，此变量可不配置
- `API_INTERNAL_URL`：console 服务端直连 api 用（compose 内 `http://api:3000`；不配则回退公网地址）

## Notion 接入约定

- 字段：`social_media_sent`(Checkbox，勾选即触发)、`内容类型`(新闻/教育/测评/曝光，可空按表兜底)、`摘要`(正文为空兜底)
- 系统**只读 Notion 不回写**；字段名调整只改 `apps/api/src/sources/notion/notion.constants.ts`

## 快速验证

1. `curl <api>/healthz` → `{"ok":true,"deps":{"db":"ok","redis":"ok"}}`
2. HTTP 入口：`curl -X POST <api>/v1/ingest -H "x-api-key: <key>" -H "Content-Type: application/json" -d '{"external_id":"t1","language":"en","content_type":"news","title":"Test","body":"Hello"}'`
3. 全链路（staging）：Notion 勾选 → 5 分钟内队列出现 → 审核「通过并发布」→ Postiz 出草稿（`DRY_RUN`）
