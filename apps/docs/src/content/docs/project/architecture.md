---
title: 架构边界
description: 系统分层、模块职责与不可逾越的边界
---

## 分层与职责

| 层 | 组件 | 职责 |
| --- | --- | --- |
| 接入 | Notion 轮询 / HTTP ingest / WikiFX 选题 | 采集素材并归一为内容任务 |
| 编排 | api（NestJS + BullMQ） | 状态机推进、任务队列、幂等控制 |
| 生成 | LLM client（`apps/api/src/generation/llm.client.ts`） | 平台化文案生成 |
| 审核 | console（Next.js） | 人工审核与操作界面 |
| 发布 | Postiz 适配器（`apps/api/src/postiz/`） | 社媒发布与数据分析 |
| 持久化 | PostgreSQL/Prisma + Redis | 状态真相与队列/限流 |

## 必须遵守的边界

1. **单一入口**：Notion 轮询与 HTTP 摄取必须走 API 的 ingestion/状态机流程，保持幂等与版本递增语义
2. **单一真相**：内容、路由、生成、用户与发布状态一律由 PostgreSQL/Prisma 承载；Redis 只管队列与限流
3. **适配器隔离**：出站 LLM 调用只允许出现在 `llm.client.ts`；社媒发布只允许出现在 Postiz 适配器，控制器与 console 不得直连第三方
4. **审核默认开启**：生成内容进入 `REVIEW`，除非显式授权否则不允许自动发布
5. **凭据最小暴露**：`ADMIN_API_KEY` 与所有第三方密钥只存在于 API/console 服务端；浏览器经 console 代理访问
6. **迁移兼容**：Prisma schema 与迁移属兼容敏感区，应用前需明确批准

## 数据归属

- `ContentItem`：内容主体与状态机
- `Generation`：内容 × 平台 的生成结果（审核编辑对象）
- `PublishJob`：内容 × 平台 × 账号 的发布子任务
- `Account` / `UserAccount` / `RoutingRule`：账号台账、权限与路由
- `AccountMetricSnapshot` / `PostMetricSnapshot`：分析指标快照
