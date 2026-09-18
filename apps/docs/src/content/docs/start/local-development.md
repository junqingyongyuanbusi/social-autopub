---
title: 本地开发
description: 准备依赖、启动 api 与 console、常用脚本
---

## 前置要求

- Node.js 22（仓库使用 pnpm 9.15.0，经 `packageManager` 字段锁定）
- PostgreSQL 与 Redis（可参考根目录 `docker-compose.yml` 单独起）
- 第三方凭据：Notion、LLM（OpenRouter 或 Anthropic）、Postiz（本地仅调试可略）

## 安装与初始化

```bash
pnpm install --frozen-lockfile

# 生成 Prisma Client 并应用迁移
pnpm db:generate
pnpm db:migrate
```

环境变量参照根目录 `.env.example`（每个变量带注释）。**任何情况下不要把真实密钥提交进仓库。**

## 启动

```bash
# API（含 BullMQ worker 与定时任务，同进程）
pnpm dev:api

# 控制台
pnpm dev:console

# 文档站（本站在 apps/docs）
pnpm --filter docs dev
```

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 构建全部包 |
| `pnpm --filter api build` | 仅构建 API |
| `pnpm --filter api test` | 运行 API 测试（node:test） |
| `pnpm --filter console build` | 仅构建控制台 |
| `pnpm --filter docs build` | 仅构建文档站 |

## 安全边界

- 本地开发同样遵守「不读不写 `.env`、不触发真实发布」的纪律
- 调试发布链路时保持 `DRY_RUN=true`
- 需要联调真实发布时，单独获得授权并在受控环境进行
