# syntax=docker/dockerfile:1
# social-autopub console —— Next.js 15 运营控制台
# 构建上下文必须是仓库根目录：docker build -f apps/console/Dockerfile .
# 注意：NEXT_PUBLIC_* 在构建期内联进产物，必须通过 build-arg 传入真实公网地址
# 运行时依赖：api 服务（见 docker-compose.yml，经 API_INTERNAL_URL 内网直连）

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/console/package.json apps/console/package.json
RUN pnpm install --frozen-lockfile

COPY apps/console apps/console

# 构建期内联的公开地址（按你的服务器公网域名覆盖）
ARG NEXT_PUBLIC_API_URL=https://api.example.com
ARG NEXT_PUBLIC_POSTIZ_URL=https://postiz.example.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_POSTIZ_URL=$NEXT_PUBLIC_POSTIZ_URL
RUN pnpm --filter console build

# pnpm deploy：产出仅含 prod 依赖的独立运行时目录（含 .next / package.json / src）
RUN pnpm --filter "console..." --prod deploy /out/console

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/console /app
# 去掉构建缓存，缩小镜像
RUN rm -rf /app/.next/cache

RUN groupadd --system app && useradd --system --gid app app \
    && chown -R app:app /app
USER app

EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "./node_modules/.bin/next start -p ${PORT:-3001} -H 0.0.0.0"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
