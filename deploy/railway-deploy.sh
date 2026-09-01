#!/usr/bin/env bash
# social-autopub Railway 一键部署脚本
# 前置：已 railway login；在仓库根目录执行：bash deploy/railway-deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

POSTIZ_URL="https://postiztest.nexory.top"
ADMIN_KEY="${ADMIN_KEY:-$(openssl rand -hex 24)}"
INGEST_KEY="${INGEST_KEY:-$(openssl rand -hex 24)}"
AUTH_SECRET_VALUE="${AUTH_SECRET_VALUE:-$(openssl rand -hex 32)}"
CONTENT_KEY="${WIKIFX_CONTENT_API_KEY:-$(openssl rand -hex 32)}"
CONTENT_URL="${WIKIFX_CONTENT_API_URL:-http://wikifx-content.railway.internal:8000}"

echo "==> 1/7 创建 Railway 项目"
railway init --name social-autopub

echo "==> 2/7 添加 Postgres 与 Redis"
railway add --database postgres
railway add --database redis

echo "==> 3/7 创建并部署 WikiFX content sidecar"
railway add --service wikifx-content
cd "$ROOT/apps/wikifx-content"
railway variables --service wikifx-content \
  --set "WIKIFX_CONTENT_API_KEY=${CONTENT_KEY}" \
  --set "PORT=8000"
railway up --service wikifx-content --detach
cd "$ROOT"

# Railway private networking uses the service DNS name.  Keep this URL private;
# do not replace it with a public domain just to make the API reachable.
echo "==> 4/7 创建并部署 api 服务"
railway add --service api
cd "$ROOT/apps/api"
railway up --service api --detach
cd "$ROOT"

echo "==> 5/7 配置 api 环境变量并生成域名"
railway variables --service api \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}' \
  --set "POSTIZ_API_URL=${POSTIZ_URL}/api/public/v1" \
  --set "ADMIN_API_KEY=${ADMIN_KEY}" \
  --set "INGEST_API_KEYS=${INGEST_KEY}:internal" \
  --set "WIKIFX_CONTENT_API_URL=${CONTENT_URL}" \
  --set "WIKIFX_CONTENT_API_KEY=${CONTENT_KEY}" \
  --set "WIKIFX_CONTENT_ALLOW_INSECURE_HTTP=true" \
  --set "DRY_RUN=true" \
  --set "LLM_PROVIDER=openrouter" \
  --set "GENERATION_MODEL=anthropic/claude-sonnet-4.5" \
  --set "NOTION_TOKEN=TODO_FILL_ME" \
  --set "WIKIFX_ARTICLES_API_KEY=TODO_FILL_ME" \
  --set "OPENROUTER_API_KEY=TODO_FILL_ME" \
  --set "POSTIZ_API_KEY=TODO_FILL_ME"
API_DOMAIN="$(railway domain --service api --json 2>/dev/null | grep -o '"domain":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
[ -z "$API_DOMAIN" ] && API_DOMAIN="$(railway domain --service api 2>&1 | grep -oE '[a-z0-9-]+\.up\.railway\.app' | head -1)"
echo "    api 域名: https://${API_DOMAIN}"

echo "==> 6/7 创建并部署 console 服务"
railway add --service console
cd "$ROOT/apps/console"
railway variables --service console \
  --set "NEXT_PUBLIC_API_URL=https://${API_DOMAIN}" \
  --set "ADMIN_API_KEY=${ADMIN_KEY}" \
  --set "AUTH_SECRET=${AUTH_SECRET_VALUE}" \
  --set "NEXT_PUBLIC_POSTIZ_URL=${POSTIZ_URL}"
railway up --service console --detach
cd "$ROOT"
CONSOLE_DOMAIN="$(railway domain --service console --json 2>/dev/null | grep -o '"domain":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
[ -z "$CONSOLE_DOMAIN" ] && CONSOLE_DOMAIN="$(railway domain --service console 2>&1 | grep -oE '[a-z0-9-]+\.up\.railway\.app' | head -1)"
echo "    console 域名: https://${CONSOLE_DOMAIN}"

echo "==> 7/7 回填 api 的 CORS 白名单并重新部署"
railway variables --service api --set "CONSOLE_URL=https://${CONSOLE_DOMAIN}"
cd "$ROOT/apps/api" && railway up --service api --detach && cd "$ROOT"

cat <<EOF

========================================
部署完成（有 4 个变量待你填真实值）：
  railway variables --service api --set "NOTION_TOKEN=secret_xxx"
  railway variables --service api --set "WIKIFX_ARTICLES_API_KEY=<通过安全渠道取得的 Bearer Key>"
  railway variables --service api --set "OPENROUTER_API_KEY=sk-or-xxx"
  railway variables --service api --set "POSTIZ_API_KEY=<在 ${POSTIZ_URL} 的 Settings 里生成>"

控制台:       https://${CONSOLE_DOMAIN}
API:          https://${API_DOMAIN}/healthz
WikiFX sidecar: ${CONTENT_URL}（private，仅 api 访问）
管理密钥 ADMIN_API_KEY: ${ADMIN_KEY}
Ingest 密钥: ${INGEST_KEY}
注意：请在 Railway 为 wikifx-content 创建 volume 并挂载到 /app/data，否则正文缓存会随 redeploy 清空。
========================================
EOF
