---
title: 变更台账
description: 重要变更的批准、实施与验证记录
---

## 2026-09 — 文档站上线

- 新增 `apps/docs`（Astro Starlight 静态文档站），部署于 Cloudflare Pages
- 把 README / AGENTS / WIKIFX / sidecar 文档结构化为五个分区；`SYNC_LOG.md` 内容迁入本页
- 站点启用中文界面、全文搜索（Pagefind）、深色模式与 `/llms.txt`

## 2026-09 — 投递对账与体验修复

- 新增 Postiz 投递状态对账服务：每 30 分钟回读帖子状态，把投递失败（`state=ERROR`）回退为可重试状态，解决「系统显示已发布但社媒没有」
- 发布记录页支持失败重试；发布日历改为最新在前；审核详情展示撰写时上传的媒体
- 撰写发布页新增**本地帖子预览**（纯前端渲染，不发起网络请求）
- 清理撰写页冗余说明文字，移除未实现的 Queue / Draft 入口

## 2026-09 — 社媒数据分析

- 接入 Postiz analytics：账号级 + 帖子级指标定时采集入库（`AccountMetricSnapshot` / `PostMetricSnapshot`）
- 新增控制台「数据分析」页（7/30/90 天窗口、指标卡片、趋势图、账号与帖子明细）
- 支持手动同步（3 分钟冷却防抖），采集受 Postiz 限流保护约束

## 2026-09-08 — 开放 WikiFX 手动抓取预览

- 用户批准取消手动抓取的语言编辑权限限制
- `fetchByUrl` 不再检查 `canEdit`；普通用户无需账号分配或语言路由即可读取缓存与抓取正文
- 保留控制台登录鉴权、API 服务密钥校验、URL 白名单；采用入队的 `canEdit` 与列表可见性不变
- 验证：新增 5 个回归用例；`pnpm --filter api test` 87/87 通过，构建成功
