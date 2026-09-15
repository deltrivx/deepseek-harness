FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

# 克隆官方 deepseek-harness 源码
RUN git clone https://github.com/deepseek-ai/deepseek-harness.git /app

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm build

# 生产运行镜像
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app /app
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/proxy.js /app/proxy.js

RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3080
ENV DSH_PORT=3018

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
