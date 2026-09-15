#!/bin/bash
set -uo pipefail

echo "=== 正在启动 DeepSeek Harness (DSH) Docker 增强版 ==="

mkdir -p /root/.dsh /workspace

# Patch the shipped static shell so direct/static access no longer shows dev-only title.
if [ -f /app/apps/web/dist/index.html ]; then
  sed -i 's#<title>DSH Local Build</title>#<title>DeepSeek Harness</title>#g' /app/apps/web/dist/index.html
fi
if [ -f /app/apps/web/dist/manifest.webmanifest ]; then
  sed -i 's#"short_name": "DSH"#"short_name": "DeepSeek Harness"#g' /app/apps/web/dist/manifest.webmanifest
fi

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

# 默认使用镜像内经过测试的代理。仅在显式指定 DSH_PROXY_FILE 时允许覆盖。
if [ -n "${DSH_PROXY_FILE:-}" ] && [ -f "$DSH_PROXY_FILE" ]; then
  cp -f "$DSH_PROXY_FILE" /app/proxy.cjs
fi

cd /app

# === 后台 watcher：从 DSH 输出文件抓真实 token，持久化到挂载卷（不阻塞主进程） ===
TOKEN_FILE="/root/.dsh/web-login-token.txt"
WORKSPACE_TOKEN_FILE="/workspace/DSH_WEB_TOKEN.txt"
DSH_OUT="/tmp/.dsh-web.out"
: > "$DSH_OUT"

(
  for i in $(seq 1 120); do
    TOK=$(grep -oE 'token=[^& ]+' "$DSH_OUT" 2>/dev/null | head -1 | sed 's/^token=//')
    if [ -n "$TOK" ]; then
      echo "$TOK" > "$TOKEN_FILE" && echo "$TOK" > "$WORKSPACE_TOKEN_FILE"
      echo "[DSH-Docker] 已持久化 DSH 真实 token"
      exit 0
    fi
    sleep 1
  done
  echo "[DSH-Docker] 警告: 120s 内未能抓到 token" >&2
) &

# DSH 成为主进程，stdout/stderr 同时进 docker logs 和 $DSH_OUT（供 watcher 读取）
exec node --import tsx/esm apps/cli/src/bin.ts web --no-open --port "${DSH_PORT:-3018}" 2>&1 | tee -a "$DSH_OUT"
