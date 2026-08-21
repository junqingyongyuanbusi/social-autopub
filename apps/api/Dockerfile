# syntax=docker/dockerfile:1
# social-autopub api —— NestJS + BullMQ（同进程 worker）
# 构建上下文必须是仓库根目录：docker build -f apps/api/Dockerfile .
# 运行时依赖：Postgres + Redis（见 docker-compose.yml）

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo
# 先只拷依赖清单，最大化利用构建缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=s/2d21f73a-130b-4b39-af4b-df78404b120d-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter api build   # prisma generate && nest build

# pnpm deploy：产出仅含 prod 依赖的独立运行时目录（含 dist/prisma/package.json）
RUN --mount=type=cache,id=s/2d21f73a-130b-4b39-af4b-df78404b120d-pnpm,target=/pnpm/store \
    pnpm --filter "api..." --prod deploy /out/api

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# ca-certificates（访问 Notion/OpenRouter/Postiz 的 TLS）+ tini（正确转发 SIGTERM）
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app

# pnpm deploy 产出的纯净 prod 依赖（含 prisma CLI）；COPY 时直接设置归属，避免额外 chown 大层
COPY --from=builder --chown=app:app /out/api /app

USER app
# 生成 Prisma Client（deploy 的新 node_modules 里 @prisma/client 未含生成产物，必须显式生成）
RUN ./node_modules/.bin/prisma generate

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# 启动即应用迁移；迁移失败则以失败码退出，由编排器负责重启策略
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]

# 健康检查与 Railway 版 healthz 语义一致：进程 + DB + Redis 全通过才 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
