---
title: 环境变量速查
description: 按服务分类的关键环境变量（详见仓库 .env.example）
---

根目录 `.env.example` 是变量的权威来源（每个变量带注释）。以下是关键项速查。

## api 服务

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` / `REDIS_URL` | 数据库与队列连接串（生产必填） |
| `NOTION_TOKEN` | Notion 集成令牌 |
| `WIKIFX_ARTICLES_API_KEY` | WikiFX 榜单 Bearer Key（仅服务端） |
| `WIKIFX_CONTENT_API_URL` / `WIKIFX_CONTENT_API_KEY` | 正文 sidecar 地址与共享密钥 |
| `WIKIFX_CONTENT_ALLOW_INSECURE_HTTP` | 仅内网 HTTP sidecar 时开启 |
| `LLM_PROVIDER` / `OPENROUTER_API_KEY` 或 `ANTHROPIC_API_KEY` | LLM 接入（二选一） |
| `GENERATION_MODEL` | 生成模型名 |
| `OPENROUTER_REASONING_MAX_TOKENS` | 推理预算（默认 1000） |
| `POSTIZ_API_URL` / `POSTIZ_API_KEY` | Postiz Public API 地址与密钥 |
| `POSTIZ_JWT_SECRET` | Postiz 实例 JWT 密钥（OAuth 授权流） |
| `PUBLIC_API_URL` | 本服务公网回调地址（OAuth webhook 用） |
| `INGEST_API_KEYS` | HTTP 推送鉴权（`key:来源名` 逗号分隔） |
| `ADMIN_API_KEY` | 管理接口密钥（api 与 console 必须一致） |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 首个控制台管理员（首次启动自动创建） |
| `DRY_RUN` | `true` 只建 Postiz 草稿 |
| `AUTO_PUBLISH` | `true` 跳人工审核（谨慎） |
| `CONSOLE_URL` | CORS 白名单（console 域名） |

## console 服务

| 变量 | 说明 |
| --- | --- |
| `API_INTERNAL_URL` | 服务端直连 api 的内网地址（Docker：`http://api:3000`） |
| `NEXT_PUBLIC_API_URL` | 无内网地址时的后备公网地址 |
| `ADMIN_API_KEY` | 与 api 相同的管理密钥（仅存服务端） |
| `AUTH_SECRET` | Auth.js 会话签名密钥（`openssl rand -hex 32`） |
| `AUTH_TRUST_HOST` | 反代部署时设为 `true` |

## 安全提示

- `NODE_ENV=production` 启动时校验必须变量，缺失会直接启动失败
- 不要把真实密钥提交进仓库；生产值通过平台环境变量注入
- 浏览器永不接触 `ADMIN_API_KEY` 与各上游密钥（经 console 服务端代理转发）
