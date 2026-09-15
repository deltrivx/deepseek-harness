#!/bin/bash
set -e

echo "=== 正在启动 DeepSeek Harness (DSH) Docker 增强版 ==="

mkdir -p /root/.dsh
mkdir -p /workspace

# 每次启动自动应用客户端局域网免 loopback 判定补丁（允许通过内网/远程浏览器管理模型与设置）
node -e '
const fs = require("fs");
const targetFile = "/app/packages/client/connection/lib/client.js";
if (fs.existsSync(targetFile)) {
  let code = fs.readFileSync(targetFile, "utf8");
  if (!code.includes("function isLoopbackHostname(hostname) { return true;")) {
    code = code.replace("function isLoopbackHostname(hostname) {", "function isLoopbackHostname(hostname) { return true;");
    fs.writeFileSync(targetFile, code);
    console.log("[DSH-Docker] 成功应用 isLoopbackHostname 局域网免判定补丁");
  }
}
'

if [ -f /root/.dsh/proxy.cjs ]; then
  cp -f /root/.dsh/proxy.cjs /app/proxy.cjs
fi

node /app/proxy.cjs &

cd /app
exec node --import tsx/esm apps/cli/src/bin.ts web --no-open --port 3018
