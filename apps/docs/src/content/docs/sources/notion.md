---
title: Notion 接入
description: Notion 数据库轮询约定、字段规范与只读边界
---

## 工作方式

- 每条登记的数据源对应一个 Notion 数据库，由后台定时轮询
- **触发条件**：页面 `social_media_sent` 复选框被勾选后才进入内容队列
- 系统**只读 Notion，不回写**

## 字段约定

| 字段 | 说明 |
| --- | --- |
| `social_media_sent` | Checkbox，勾选即触发摄取 |
| `内容类型` | 新闻 / 教育 / 测评 / 曝光；可为空，按表兜底 |
| `摘要` | 正文为空时的兜底内容 |
| `发布链接 / Publish link` | `exposure-review` 类型必填，支持 URL / Rich text / Formula string |

## 幂等与版本

- 内容以 `(来源, externalId, contentHash)` 判重：同一素材内容未变不会重复生成
- 素材内容发生变化时创建新版本，旧任务自动转为 `SUPERSEDED`
- 轮询失败会记录到失败表，可在「设置」页查看

## 曝光类内容的链接处理

- `exposure-review` 保存原始 `.com` 链接；发布时仅把 hostname 末尾的 `.com` 派生为 `.me`，并按内容类型与语言追加只读 CTA
- 链接缺失或非法会阻止生成/发布，并在控制台显示错误

## 字段名调整

字段名映射集中在 `apps/api/src/sources/notion/notion.constants.ts`，调整字段只需改这一处。
