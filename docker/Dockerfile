FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@latest

# 克隆官方 deepseek-harness 源码并构建
RUN git clone --depth=1 https://github.com/deepseek-ai/deepseek-harness.git /app

RUN pnpm install
RUN pnpm build

# 生产运行镜像
FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@latest

COPY --from=builder /app /app
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/proxy.js /app/proxy.js

RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3080
ENV DSH_PORT=3018

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
