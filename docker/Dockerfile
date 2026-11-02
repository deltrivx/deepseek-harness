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

ARG DSH_REF="dsh-v0.2.1-rc.5"
RUN if [ -n "$DSH_REF" ]; then \
      git clone --depth=1 --branch "$DSH_REF" https://github.com/deepseek-ai/deepseek-harness.git /app 2>/dev/null || \
      git clone --depth=1 https://github.com/deepseek-ai/deepseek-harness.git /app; \
    else \
      git clone --depth=1 https://github.com/deepseek-ai/deepseek-harness.git /app; \
    fi

RUN pnpm install
RUN pnpm run build:official

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

COPY --from=builder /app /app

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3018

ENV NODE_ENV=production
ENV DSH_HOME=/root/.dsh
ENV DSH_PORT=3018

VOLUME ["/root/.dsh", "/workspace"]

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
