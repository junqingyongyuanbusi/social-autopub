---
title: 核心概念
description: 内容状态机、路由矩阵、审核边界与幂等发布
---

理解以下四个概念，就能读懂系统的大部分行为。

## 内容状态机

每条内容（`ContentItem`）在生命周期中经历以下状态：

```
PENDING ──> GENERATING ──> REVIEW ──> APPROVED ──> PUBLISHING ──> PUBLISHED
                │            │                          │
                │            └──> REJECTED              └──> FAILED
                │
                └──> FAILED（生成失败，可重新入队）

SUPERSEDED：同一来源内容出现新版本，旧任务自动作废
```

- `PENDING → GENERATING`：内容入库后进入生成队列（BullMQ）
- `REVIEW`：生成完成，等待人工审核；这是**默认的必经关口**
- `APPROVED → PUBLISHING`：审核通过后按路由拆分为发布子任务
- `PUBLISHED`：全部子任务收敛为成功
- `FAILED`：生成或发布失败，失败原因记录在内容与子任务两级

## 发布子任务（PublishJob）

一条内容可能对应多个平台/账号的发布子任务，每个子任务独立跟踪：

| 子任务状态 | 含义 |
| --- | --- |
| `queued` | 已入队，等待 worker 领取 |
| `publishing` | 已被 worker 原子领取，正在调用 Postiz |
| `sent` | Postiz 已受理（注意：不等于社媒投递成功，见投递对账） |
| `failed` | 失败，可在发布记录页重试 |
| `unknown` | 客户端未收到响应，结果未知，需要人工对账 |
| `cancelled` | 因内容版本更新而作废 |

## 路由矩阵

路由规则形如 `语言 × 内容类型 × 平台 → 账号`，支持 `*` 通配内容类型，同一命中可配置多行（`priority` 决定优劣）。

- 审核通过时按路由矩阵生成**发布目标快照**（`publishTargets`），之后即使路由配置变化，不影响已批准的内容
- 手动撰写内容跳过路由，直接指定目标账号

## 审核边界与发布策略

| 变量 | 作用 |
| --- | --- |
| `DRY_RUN=true` | 只让 Postiz 生成草稿，不推送社媒正式外网 |
| `AUTO_PUBLISH=true` | 跳过人工审核自动发布（WikiFX 与历史重生成内容除外，它们始终强制审核） |

:::caution[上线纪律]
首次部署保持 `DRY_RUN=true`，走通「采集 → 审核 → 出草稿」后再切换 `false`。`AUTO_PUBLISH=true` 仅在明确授权后使用。
:::

## 幂等与对账

- 内容幂等：`(source, externalId, contentHash)` 唯一，同一素材重复推送不会重复生成
- 发布幂等：worker 原子领取任务，同一子任务并发执行会被拦截
- 投递对账：每 30 分钟回读 Postiz 帖子状态，把投递失败（`state=ERROR`）回退为可重试状态
