---
title: 运维手册
description: 日常运维、迁移、发布策略切换与故障处理
---

## 健康检查

```bash
curl <api>/healthz
# => {"ok":true,"deps":{"db":"ok","redis":"ok","wikifx_content":"ok"}}
```

`wikifx_content` 为 `not_configured` 表示未配置 sidecar，不影响其它来源。

## 发布策略切换

| 操作 | 步骤 |
| --- | --- |
| 开启真发 | 验证草稿链路后，把 `DRY_RUN` 改为 `false` |
| 免审发布 | `AUTO_PUBLISH=true`（WikiFX 与历史重生成内容仍强制审核） |

:::danger[谨慎操作]
`AUTO_PUBLISH=true` 意味着内容生成后直接进入发布流程。仅在明确授权并确认生成质量后进行。
:::

## 数据库迁移

- 部署新版本时容器启动自动执行 `prisma migrate deploy`
- 迁移文件在 `apps/api/prisma/migrations/`；迁移属兼容敏感操作，应用前需评估与批准
- 旧库如用 `db push` 建表，需先 `prisma migrate resolve --applied 0_init` 标记基线

## 队列与补偿

- 发布任务、生成任务均由 BullMQ 承载；Redis 重启丢失的排队任务由补偿服务自动重入队
- 结果未知的发布任务**不会**被自动重发，需在发布记录页人工对账

## 常见故障

| 现象 | 排查方向 |
| --- | --- |
| 控制台 503／登录失败 | api 健康检查、`ADMIN_API_KEY` 两侧是否一致 |
| 内容生成失败积压 | LLM Key 配额、`GENERATION_MODEL` 是否可用 |
| 发布失败（Postiz 4xx/5xx） | Postiz 服务状态、`POSTIZ_API_KEY` 是否过期 |
| 系统显示已发布但社媒没有 | 等待投递对账（每 30 分钟）或到发布记录页查看 `failed` 回退 |
| WikiFX 正文为空 | sidecar 健康、`WIKIFX_CONTENT_API_KEY` 两侧一致性 |
