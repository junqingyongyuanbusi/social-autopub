---
title: HTTP 推送
description: 通过 /v1/ingest 接口推送内容
---

除 Notion 轮询外，外部系统可直接调用 API 推送内容。

## 调用方式

```bash
curl -X POST <api>/v1/ingest \
  -H "x-api-key: <ingest-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "t1",
    "language": "en",
    "content_type": "news",
    "title": "Test",
    "body": "Hello"
  }'
```

## 约定

- 鉴权使用独立的 **ingest key**（`INGEST_API_KEYS`），与管理员密钥分离
- `external_id` 由调用方提供并保证稳定；与内容哈希共同构成幂等键
- 推送成功后内容以 `PENDING` 状态进入生成队列，走与 Notion 相同的流水线
- 推送接口只负责入库，不触发发布
