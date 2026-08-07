# social-autopub — 多语言社媒自动发布系统

Notion（10 语言 × 2 表）/ HTTP 推送 → LLM 生成各平台文案 → 人工审核 → Postiz 发布到 X / Instagram / Facebook。
全量托管在 Railway，不做本地调试。完整方案见 `~/.claude/plans/notion-notion-10-llm-agent-zany-newell.md`。

## 结构

```
apps/api       NestJS：Notion 轮询 + HTTP ingest + LLM 生成 + 路由矩阵 + Postiz 发布（BullMQ worker 同进程）
apps/console   Next.js 运营控制台：内容队列 / 审核工作台 / 发布记录…
```

## Railway 部署步骤

1. **Postiz**：用官方 Railway 模板（锁定 v2.11.3 三服务版，避开 Temporal）。部署后设
   `MAIN_URL` / `FRONTEND_URL` / `NEXT_PUBLIC_BACKEND_URL`，注册管理员后置 `DISABLE_REGISTRATION=true`；
   Settings → Providers 配 Meta / X 应用凭证并完成各账号 OAuth；生成 API Key。
   验证限流：默认 30 req/h，自托管尝试 `API_LIMIT` 调高。
2. **业务服务**：本仓库推到 GitHub → Railway 新建项目，添加 Postgres、Redis 插件，再建两个服务：
   - `api`：Root Directory `apps/api`，Build `pnpm install && pnpm build`，Start `pnpm start`（启动时 `prisma migrate deploy` 自动建表/迁移；首次从空库部署即可。若某库此前已用 `db push` 建过表，需先在该库执行 `prisma migrate resolve --applied 0_init` 标记基线）
   - `console`：Root Directory `apps/console`，Build `pnpm install && pnpm build`，Start `pnpm start`
3. **环境变量**：按根目录 `.env.example` 配置到各服务；staging 环境保持 `DRY_RUN=true`（发布只建 Postiz 草稿）。
4. **初始化数据**（全部在控制台页面完成，无需操作数据库）：
   - 「设置」页登记 20 张 Notion 表的 Database ID + 语言
   - 「账号健康」页点「立即同步」拉取 Postiz 账号 → 「路由矩阵」页配置 语言 × 类型 × 平台 → 账号

## Notion 表字段约定

`social_media_sent`(Checkbox，勾选即立即发布) · `内容类型`(Rich text: 新闻/教育/测评/曝光，可空按表类型兜底) ·
`摘要`(Rich text，正文块为空时兜底)。Notion 日期字段不会参与调度；系统只读取 Notion，不回写状态、结果或链接。
字段名调整只需改 `apps/api/src/sources/notion/notion.constants.ts`。

## 端到端验证（staging）

1. `curl https://<api>/healthz`
2. Notion 测试表将某页 `social_media_sent` 勾选为 true → 5 分钟内控制台「内容队列」出现任务
3. 审核工作台编辑文案 →「通过并发布」→ Postiz 日历出现草稿（DRY_RUN）
4. HTTP 入口：`curl -X POST https://<api>/v1/ingest -H "x-api-key: <key>" -H "Content-Type: application/json" -d '{"external_id":"t1","language":"en","content_type":"news","title":"Test","body":"Hello"}'`
5. 全链路验证通过后，生产环境 `DRY_RUN=false` 真发
