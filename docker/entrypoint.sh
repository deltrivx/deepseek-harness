#!/bin/bash
set -e

echo "=== 正在启动 DeepSeek Harness (DSH) Docker 增强版 ==="

mkdir -p /root/.dsh
mkdir -p /workspace

# 启动反向代理（突破 127.0.0.1 回环限制）
if [ -f /app/proxy.cjs ]; then
  node /app/proxy.cjs &
elif [ -f /app/proxy.js ]; then
  node --input-type=commonjs /app/proxy.js 2>/dev/null & || node /app/proxy.js &
fi

cd /app
exec pnpm start
