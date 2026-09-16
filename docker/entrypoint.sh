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

# === 固定 token：预置 HMAC secret 进挂载卷 .credentials.yaml ===
# DSH browser-auth 用 32 字节 secret 做 HMAC-SHA256 签 cookie，secret 存在
# /root/.dsh/.credentials.yaml 的 client-connection/browser-session 记录里。
# 只要这个文件保留，DSH 每次启动都复用同一 secret → token 永远固定不变。
# entrypoint 只在文件缺失时生成一次，之后永不覆盖。
CRED_FILE="/root/.dsh/.credentials.yaml"
if [ ! -f "$CRED_FILE" ]; then
  SECRET_B64URL=$(node -e "process.stdout.write(Buffer.from(require('crypto').randomBytes(32)).toString('base64').replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''))")
  cat > "$CRED_FILE" <<YAML
version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: ${SECRET_B64URL}
YAML
  chmod 600 "$CRED_FILE"
  echo "[DSH-Docker] 已生成固定 HMAC secret 并写入 $CRED_FILE（token 将跨镜像/重启固定不变）"
else
  echo "[DSH-Docker] 检测到已存在的固定 secret（$CRED_FILE），token 保持固定"
fi

cd /app

# === 启动精简版边缘透传代理（0.0.0.0:EDGE_PORT -> 127.0.0.1:3018，无 Basic Auth） ===
EDGE_PORT="${EDGE_PORT:-3180}"
EDGE_OUT="/tmp/.edge-proxy.out"
: > "$EDGE_OUT"
node /app/edge-proxy.cjs >> "$EDGE_OUT" 2>&1 &
EDGE_PID=$!
echo "[DSH-Docker] edge-proxy 已启动: 0.0.0.0:${EDGE_PORT} -> 127.0.0.1:${DSH_PORT:-3018} (纯透传)"

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
