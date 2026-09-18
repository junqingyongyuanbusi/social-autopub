---
title: 自托管 Docker
description: 用 Docker Compose 部署生产环境
---

## 前置要求

- 一台安装 Docker 与 Docker Compose 的服务器
- `apps/api` 与 `apps/console` 的域名（绑定 HTTPS）

## 步骤

```bash
# 1. 拉代码（GitLab 默认 master 即生产分支；GitHub 对应 main）
git clone <仓库地址> && cd social-autopub

# 2. 配置环境变量（参照根目录 .env.example，Docker 下这些必填）
cp .env.example .env   # 填入真实值，尤其 PUBLIC_API_URL 等

# 3. 启动全量编排（Postgres + Redis + WikiFX sidecar + api + console）
docker compose up -d --build
```

## 网络拓扑

- 唯一公网入口是 **console**（`docker compose` 中 api 无对外端口）
- 数据流：浏览器 → console:3001 →（Docker 内网）→ api:3000
- 反向代理只需对 console 开放（配 HTTPS）；若要用 HTTP ingest 或 Postiz OAuth 绑号，按路径放行 api

## 初始化（全部在控制台页面完成）

1. 「设置」页登记各 Notion 表的 Database ID + 语言
2. 「账号健康」页点「立即同步」拉取 Postiz 账号 → 「路由矩阵」页配置路由
3. 建库：启动时 `prisma migrate deploy` 自动建表；若某库此前用 `db push` 建过，先标记基线：

```bash
docker exec <api容器> sh -c './node_modules/.bin/prisma migrate resolve --applied 0_init'
```

## 上线纪律

首次启动保持 `DRY_RUN=true`（只建 Postiz 草稿）→ 走一遍「Notion 勾选 → 审核 → 出草稿」验证 → 确认无误后再切换 `DRY_RUN=false`。
