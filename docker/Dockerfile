FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

RUN git clone --depth=1 https://github.com/deepseek-ai/deepseek-harness.git /app

RUN pnpm install
RUN pnpm build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

COPY --from=builder /app /app

COPY docker/proxy.cjs /app/proxy.cjs
COPY docker/edge-proxy.cjs /app/edge-proxy.cjs
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3018 3180

ENV NODE_ENV=production
ENV DSH_HOME=/root/.dsh
ENV DSH_PORT=3018
# DSH_WEB_TOKEN 预留（当前 dsh web 不读取，token 由 DSH 随机生成并由 entrypoint 持久化）
ENV DSH_WEB_TOKEN=
ENV EDGE_PORT=3180

VOLUME ["/root/.dsh", "/workspace"]

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
