---
title: WikiFX 热点
description: WikiFX 热点榜单、正文 sidecar 与采用流程
---

## 架构

- `WIKIFX_ARTICLES_API_URL` 仅用于可信榜单（`/top`）响应
- 正文由内部 sidecar（`apps/wikifx-content`）负责：`curl_cffi` 抓取、四级正文抽取、SQLite 持久化缓存
- API 以 `Authorization: Bearer <WIKIFX_CONTENT_API_KEY>` 调用 sidecar；**绝不**从公网榜单地址派生详情 URL

## 控制台流程

1. 「热点选题」页读取最近 1–3 个自然日的榜单（服务端缓存 60 秒，上游不可用时最多回退 24 小时旧缓存）
2. 采用热点时 API 从可信榜单与 sidecar 重新解析正文（浏览器提交内容不被信任）
3. 正文与媒体进入生成队列；空白正文只能查看不允许采用

## 手动抓取

粘贴 newsdetail 链接（仅 `www.wikifx.com` / `aws-www.wikifx.com` 白名单，8–32 位数字 ID）：

- `force=false` 先读 sidecar 正文库，未抓取返回 `content_not_fetched`
- `force=true` 触发一次抓取，sidecar 返回 `ok` / `empty` / `not_found` / `blocked` / `timeout` / `error` 结构化状态
- 成功结果在 API Redis 短期缓存 10 分钟，供「手动采用」使用

## 发布边界

- `externalId` 使用 `language:article_id`，避免多语言文章 ID 相互覆盖
- WikiFX 内容即使在 `AUTO_PUBLISH=true` 下也**强制进入人工审核**

## 配置

| 变量 | 说明 |
| --- | --- |
| `WIKIFX_ARTICLES_API_KEY` | 榜单上游 Bearer Key（仅 API 服务端） |
| `WIKIFX_CONTENT_API_URL` | sidecar 地址（内网） |
| `WIKIFX_CONTENT_API_KEY` | api 与 sidecar 必须一致 |
| `WIKIFX_CONTENT_ALLOW_INSECURE_HTTP` | 仅内网 HTTP 时显式开启 |
