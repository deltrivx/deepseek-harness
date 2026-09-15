#!/bin/bash
set -euo pipefail

echo "=== 正在启动 DeepSeek Harness (DSH) Docker 增强版 ==="

mkdir -p /root/.dsh /workspace

# 只在上游客户端文件存在时应用局域网免 loopback 判定补丁。
node -e '
const fs = require("fs");
const targetFile = "/app/packages/client/connection/lib/client.js";
if (fs.existsSync(targetFile)) {
  let code = fs.readFileSync(targetFile, "utf8");
  const marker = "function isLoopbackHostname(hostname) { return true;";
  if (!code.includes(marker) && code.includes("function isLoopbackHostname(hostname) {")) {
    code = code.replace("function isLoopbackHostname(hostname) {", "function isLoopbackHostname(hostname) { return true;");
    fs.writeFileSync(targetFile, code);
    console.log("[DSH-Docker] 成功应用 isLoopbackHostname 局域网免判定补丁");
  }
}
'

# 默认使用镜像内经过测试的代理。仅在显式指定 DSH_PROXY_FILE 时允许覆盖，
# 避免旧的持久化 proxy.cjs 覆盖新镜像并造成配置页/连接重置。
if [ -n "${DSH_PROXY_FILE:-}" ] && [ -f "$DSH_PROXY_FILE" ]; then
  cp -f "$DSH_PROXY_FILE" /app/proxy.cjs
fi

node /app/proxy.cjs &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT

cd /app
exec node --import tsx/esm apps/cli/src/bin.ts web --no-open --port "${DSH_PORT:-3018}"
