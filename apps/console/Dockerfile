# syntax=docker/dockerfile:1
# social-autopub console —— Next.js 15 运营控制台
# 构建上下文必须是仓库根目录：docker build -f apps/console/Dockerfile .
# 运行时依赖：api 服务（见 docker-compose.yml，经 API_INTERNAL_URL 内网直连）
# 环境相关地址和密钥全部在容器启动时注入，不写入镜像构建参数

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/console/package.json apps/console/package.json
RUN --mount=type=cache,id=pnpm-console,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY apps/console apps/console
RUN --mount=type=cache,id=next-console,target=/repo/apps/console/.next/cache \
    pnpm --filter console build

# 保留完整 standalone 目录树（含 pnpm 虚拟仓库），防止拆目录后 node_modules 符号链接断裂。
# 将静态资源放回实际 app 根，并建立固定入口，运行阶段不依赖构建机的目录名。
RUN SERVER="$(find /repo/apps/console/.next/standalone -name server.js -not -path '*/node_modules/*' | head -1)" \
    && test -n "$SERVER" \
    && APP_ROOT="$(dirname "$SERVER")" \
    && mkdir -p "$APP_ROOT/.next/static" \
    && cp -a /repo/apps/console/.next/static/. "$APP_ROOT/.next/static/" \
    && RELATIVE_SERVER="${SERVER#/repo/apps/console/.next/standalone/}" \
    && ln -s "$RELATIVE_SERVER" /repo/apps/console/.next/standalone/entry.js

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app

COPY --from=builder --chown=app:app /repo/apps/console/.next/standalone /app/standalone
USER app

EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/standalone/entry.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
