---
title: 概述
description: 系统能力、模块划分与整体数据流
---

社媒自动发布系统把「内容来源 → 多语言生成 → 人工审核 → 多平台发布 → 效果分析」串成一条可审计的流水线。

## 它能做什么

- 从 **Notion 数据库**、**HTTP 推送**或 **WikiFX 热点**采集素材，统一入库并做幂等去重
- 用 LLM 按 **10 种语言 × 3 个平台**（X / Instagram / Facebook）生成平台化文案
- 生成结果进入**人工审核工作台**：逐平台编辑文案与配图，通过后才进入发布
- 按**路由矩阵**（语言 × 内容类型 × 平台 → 账号）自动拆分发布任务，经 **Postiz** 投递
- 采集发布数据与社媒指标，提供**数据分析看板**与**投递对账**

## 模块划分

| 模块 | 说明 |
| --- | --- |
| `apps/api` | NestJS 单体：Notion 轮询、WikiFX 热点读取、HTTP ingest、LLM 生成、路由矩阵、Postiz 发布（BullMQ worker 同进程） |
| `apps/console` | Next.js 运营控制台：热点选题 / 内容队列 / 审核工作台 / 发布记录 / 数据分析 / 设置 |
| `apps/wikifx-content` | WikiFX 正文抓取 sidecar：`curl_cffi` 抓取、四级正文抽取、SQLite 缓存 |
| `apps/docs` | 本站：Astro Starlight 文档站（静态，部署于 Cloudflare Pages） |

## 数据流

```
Notion(10语言×2表) ─┐                          ┌─> X
HTTP /v1/ingest ────┼─> api ─> LLM 生成 ─> 审核工作台 ─> Postiz ─┤─> Instagram
WikiFX 热点 ─> 选题 ─┘   (轮询/队列)        (console)            └─> Facebook
          │              Postgres(状态)  Redis(队列: BullMQ)
          └─> wikifx-content sidecar（抓取 + SQLite 正文缓存）
```

## 关键设计约束

- **人工审核是默认边界**：生成内容进入 `REVIEW`，除非显式开启 `AUTO_PUBLISH`，绝不自动发布
- **发布幂等**：同一内容同平台同账号只发一次；结果未知的任务转入人工对账而不自动重发
- **状态单点**：PostgreSQL/Prisma 是唯一的持久化真相；Redis 只承载队列与限流
- **凭据隔离**：所有第三方凭据只存在于 API 服务端，浏览器永不接触

## 下一步

- 理解状态机与路由矩阵：[核心概念](/start/concepts/)
- 在本地把系统跑起来：[本地开发](/start/local-development/)
