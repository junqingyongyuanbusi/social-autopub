# WikiFX Article Content Sidecar

这是从 `/www/go-scaffold/services/wikifx-article-api` 移植的 WikiFX 文章正文子系统，供 `apps/api` 内网调用。抓取使用原实现的 `curl_cffi` Chrome TLS impersonation，正文抽取使用原实现的四级容器策略和结构化状态机。

## 运行

```bash
# 开发/测试环境（生产镜像只安装 requirements.txt）
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt

WIKIFX_CONTENT_API_KEY=$(openssl rand -hex 32) \
  PORT=8000 \
  python3.12 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

数据库默认为 `data/wikifx.db`。生产必须把 `/app/data` 挂载到持久化 volume，否则重新部署会丢失已抓取正文。

Railway 上不要为此服务配置 public domain；只通过 Railway private networking 让 `api` 访问它。API key 是第二层保护，不应替代网络隔离。

所有 `/api/articles/*` 请求都需要：

```text
Authorization: Bearer <WIKIFX_CONTENT_API_KEY>
```

`/healthz` 和 `/api/health` 默认可匿名探活，会在 API key 或抓取依赖缺失时返回 HTTP 503；若请求带有 `Authorization`，sidecar 会校验它，供 api 健康检查验证共享 key。

## 兼容接口

| 方法 | 路径 | 语义 |
|---|---|---|
| `GET` | `/api/articles/content/{language}/{article_id}` | 只读正文库；未抓取返回 404 `content_not_fetched` |
| `POST` | `/api/articles/content/{language}/{article_id}/fetch` | 强制抓取一篇，失败也以 200 返回 `status/error_code` |
| `POST` | `/api/articles/content/resolve` | 批量读库，缺失时抓取并返回正文 |
| `POST` | `/api/articles/content/index` | 批量读取元信息，不返回正文 |
| `GET` | `/api/articles/content/records` | 正文库状态统计与分页明细 |

数据库状态值：`ok`、`empty`、`not_found`、`blocked`、`timeout`、`error`；`resolve` 另用 `content_status=stored|fetched|fetch_failed` 表示本次返回来源。不要仅依据 HTTP 404 判断原文不存在：GET 的 404 也可能只是尚未抓取（`content_not_fetched`）。

## 配置

- `WIKIFX_CONTENT_API_KEY`：与 `apps/api` 完全相同的内部 Bearer key。
- `WIKIFX_CONTENT_DATA_DIR` / `WIKIFX_CONTENT_DB_PATH`：可选数据路径覆盖。
- `WIKIFX_ARTICLE_SCHEME`：默认为 `https`，仅用于服务端构造官方文章 URL。
- `PORT`：Railway 注入的监听端口。
