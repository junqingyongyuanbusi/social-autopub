#!/usr/bin/env bash
# social-autopub Railway 一键部署脚本
# 前置：已 railway login；在仓库根目录执行：bash deploy/railway-deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

POSTIZ_URL="https://postiztest.nexory.top"
ADMIN_KEY="${ADMIN_KEY:-$(openssl rand -hex 24)}"
INGEST_KEY="${INGEST_KEY:-$(openssl rand -hex 24)}"

echo "==> 1/6 创建 Railway 项目"
railway init --name social-autopub

echo "==> 2/6 添加 Postgres 与 Redis"
railway add --database postgres
railway add --database redis

echo "==> 3/6 创建并部署 api 服务"
railway add --service api
cd "$ROOT/apps/api"
railway up --service api --detach
cd "$ROOT"

echo "==> 4/6 配置 api 环境变量并生成域名"
railway variables --service api \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}' \
  --set "POSTIZ_API_URL=${POSTIZ_URL}/api/public/v1" \
  --set "ADMIN_API_KEY=${ADMIN_KEY}" \
  --set "INGEST_API_KEYS=${INGEST_KEY}:internal" \
  --set "DRY_RUN=true" \
  --set "LLM_PROVIDER=openrouter" \
  --set "GENERATION_MODEL=anthropic/claude-sonnet-4.5" \
  --set "NOTION_TOKEN=TODO_FILL_ME" \
  --set "OPENROUTER_API_KEY=TODO_FILL_ME" \
  --set "POSTIZ_API_KEY=TODO_FILL_ME"
API_DOMAIN="$(railway domain --service api --json 2>/dev/null | grep -o '"domain":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
[ -z "$API_DOMAIN" ] && API_DOMAIN="$(railway domain --service api 2>&1 | grep -oE '[a-z0-9-]+\.up\.railway\.app' | head -1)"
echo "    api 域名: https://${API_DOMAIN}"

echo "==> 5/6 创建并部署 console 服务"
railway add --service console
cd "$ROOT/apps/console"
railway variables --service console \
  --set "NEXT_PUBLIC_API_URL=https://${API_DOMAIN}" \
  --set "ADMIN_API_KEY=${ADMIN_KEY}" \
  --set "NEXT_PUBLIC_POSTIZ_URL=${POSTIZ_URL}"
railway up --service console --detach
cd "$ROOT"
CONSOLE_DOMAIN="$(railway domain --service console --json 2>/dev/null | grep -o '"domain":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
[ -z "$CONSOLE_DOMAIN" ] && CONSOLE_DOMAIN="$(railway domain --service console 2>&1 | grep -oE '[a-z0-9-]+\.up\.railway\.app' | head -1)"
echo "    console 域名: https://${CONSOLE_DOMAIN}"

echo "==> 6/6 回填 api 的 CORS 白名单并重新部署"
railway variables --service api --set "CONSOLE_URL=https://${CONSOLE_DOMAIN}"
cd "$ROOT/apps/api" && railway up --service api --detach && cd "$ROOT"

cat <<EOF

========================================
部署完成（有 3 个变量待你填真实值）：
  railway variables --service api --set "NOTION_TOKEN=secret_xxx"
  railway variables --service api --set "OPENROUTER_API_KEY=sk-or-xxx"
  railway variables --service api --set "POSTIZ_API_KEY=<在 ${POSTIZ_URL} 的 Settings 里生成>"

控制台:  https://${CONSOLE_DOMAIN}
API:     https://${API_DOMAIN}/healthz
管理密钥 ADMIN_API_KEY: ${ADMIN_KEY}
Ingest 密钥: ${INGEST_KEY}
========================================
EOF
