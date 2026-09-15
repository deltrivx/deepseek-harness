#!/bin/bash
set -euo pipefail

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

# === 启动 DSH web，把 stdout 引到日志文件，便于抓 token ===
LOGFILE=/tmp/dsh-web.log
: > "$LOGFILE"
node --import tsx/esm apps/cli/src/bin.ts web --no-open --port "${DSH_PORT:-3018}" >> "$LOGFILE" 2>&1 &
DSH_PID=$!
trap 'kill "$DSH_PID" 2>/dev/null || true' EXIT

# === 从日志抓 DSH 真实生成的 token，持久化到挂载卷（供 Unraid 拼 URL）===
# DSH 启动日志会打印形如: dsh web: http://127.0.0.1:3018/?token=***
TOKEN_FILE="/root/.dsh/web-login-token.txt"
for i in $(seq 1 60); do
  TOK=$(grep -oE 'token=[^& ]+' "$LOGFILE" 2>/dev/null | head -1 | sed 's/^token=//')
  if [ -n "$TOK" ]; then
    echo "$TOK" > "$TOKEN_FILE"
    chmod 644 "$TOKEN_FILE"
    echo "$TOK" > /workspace/DSH_WEB_TOKEN.txt
    chmod 644 /workspace/DSH_WEB_TOKEN.txt
    echo "[DSH-Docker] 已持久化 DSH 真实 token -> $TOKEN_FILE 和 /workspace/DSH_WEB_TOKEN.txt"
    break
  fi
  sleep 1
done
if [ -z "$TOK" ]; then
  echo "[DSH-Docker] 警告: 未能从日志抓到 token，登录需手动查看 /tmp/dsh-web.log" >&2
fi

# 把日志尾随输出到 stdout（保留容器日志可见）
tail -f "$LOGFILE"
wait "$DSH_PID"
