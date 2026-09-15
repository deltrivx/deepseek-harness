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

# === token 持久化：保证重启不变（无感访问）===
# 优先级：1. 显式 DSH_WEB_TOKEN 环境变量  2. 已持久化的 token 文件  3. 随机生成
# 持久化位置：/root/.dsh/web-login-token.txt（挂载卷，容器重启保留）
TOKEN_FILE="/root/.dsh/web-login-token.txt"
if [ -z "${DSH_WEB_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  # 复用之前持久化的 token（容器重启不丢）
  export DSH_WEB_TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
  echo "[DSH-Docker] 复用持久化 token"
fi
if [ -z "${DSH_WEB_TOKEN:-}" ]; then
  # 随机生成并持久化
  export DSH_WEB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  echo "$DSH_WEB_TOKEN" > "$TOKEN_FILE"
  chmod 644 "$TOKEN_FILE"
  echo "[DSH-Docker] 已生成并持久化新 token -> $TOKEN_FILE"
fi
# 把 token 也写到 /workspace 方便 Unraid 文件管理器直接查看
echo "$DSH_WEB_TOKEN" > /workspace/DSH_WEB_TOKEN.txt
chmod 644 /workspace/DSH_WEB_TOKEN.txt
echo "[DSH-Docker] token 已同步到 /workspace/DSH_WEB_TOKEN.txt"

# 默认使用镜像内经过测试的代理。仅在显式指定 DSH_PROXY_FILE 时允许覆盖。
if [ -n "${DSH_PROXY_FILE:-}" ] && [ -f "$DSH_PROXY_FILE" ]; then
  cp -f "$DSH_PROXY_FILE" /app/proxy.cjs
fi

cd /app
# 直接跑 DSH web，不再套任何代理
exec node --import tsx/esm apps/cli/src/bin.ts web --no-open --port "${DSH_PORT:-3018}"
