#!/bin/bash
set -euo pipefail

echo "=== 正在启动 DeepSeek Harness (DSH) 原生官方版 ==="

mkdir -p /root/.dsh /workspace

cd /app
exec node --import tsx/esm apps/cli/src/bin.ts web --no-open --port "${DSH_PORT:-3018}"
