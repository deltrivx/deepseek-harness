#!/bin/bash
set -euo pipefail

echo "=== 正在启动 local coding tool (DSH) 官方构建产物 ==="

mkdir -p /root/.dsh /workspace

cd /app
exec node /app/apps/cli/lib/bin.js web --no-open --port "${DSH_PORT:-3018}"
