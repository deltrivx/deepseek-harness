FROM node:22-bullseye-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

# 克隆官方最新上游源码并构建
RUN git clone --depth=1 https://github.com/deepseek-ai/deepseek-harness.git /app

RUN pnpm install
RUN pnpm build

FROM node:22-bullseye-slim AS runner

WORKDIR /app

# 安装容器运行时及常用实用 CLI 工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    jq \
    python3 \
    tar \
    gzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

COPY --from=builder /app /app

COPY docker/proxy.cjs /app/proxy.cjs
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3080 3018

ENV NODE_ENV=production
ENV DSH_HOME=/root/.dsh
ENV PORT=3080
ENV DSH_PORT=3018

VOLUME ["/root/.dsh", "/workspace"]

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
