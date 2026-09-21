---
title: Railway 环境
description: 在 Railway 上部署 Postiz 与本系统
---

## Postiz（发布后端）

:::caution[平台侧准备是前置条件]
部署 Postiz 之前（或同时），需要先在各平台注册开发者应用并拿到凭据：
[Meta 开发者准备](/prepare/meta-developer/) · [X 开发者准备](/prepare/x-developer/)。
第 4 步的 OAuth 绑定依赖这些凭据，没有它们绑不上任何账号。
:::

1. 使用官方 Railway 模板部署 Postiz（锁定版本、避开 Temporal 依赖）
2. 配置 `MAIN_URL` / `FRONTEND_URL` / `NEXT_PUBLIC_BACKEND_URL`
3. 管理员创建完成后设置 `DISABLE_REGISTRATION=true`
4. 配置平台应用凭据（`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` / `X_API_KEY` / `X_API_SECRET` 等），
   在 Postiz 内完成各社媒账号的 OAuth 绑定，并在 Settings 生成 API Key

## 本系统服务

本仓库从 GitHub 推送后，在 Railway 项目内建 **Postgres + Redis 插件**，再建三个服务：

| 服务 | Root | 说明 |
| --- | --- | --- |
| `wikifx-content` | `apps/wikifx-content` | 使用目录内 Dockerfile；绑定持久化 volume 到 `/app/data` |
| `api` | `apps/api` | NestJS API 与 worker |
| `console` | `apps/console` | Next.js 控制台 |

## 关键配置

- `wikifx-content` 与 `api` 设置相同的随机 `WIKIFX_CONTENT_API_KEY`
- api 的 `WIKIFX_CONTENT_API_URL` 填 sidecar 的 private URL；HTTP 内网地址需同时设 `WIKIFX_CONTENT_ALLOW_INSECURE_HTTP=true`
- 其余环境变量按 `.env.example` 配置；staging 保持 `DRY_RUN=true`

## 部署注意

- 上传前确认 Railway 项目与服务选择器正确（`--service api --environment production`）
- 容器启动即执行 `prisma migrate deploy`，数据库迁移随部署自动应用
- 每次上传应以部署状态、日志与 `/healthz` 三重证据确认成功
