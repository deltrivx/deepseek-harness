#!/bin/bash
set -e

echo "=== 正在启动 DeepSeek Harness (DSH) Docker 增强版 ==="

# 确保配置和工作区目录存在
mkdir -p /root/.dsh
mkdir -p /workspace

# 启动反向代理（突破 127.0.0.1 回环限制）
node /app/proxy.js &

# 启动官方 DSH 服务
cd /app
exec pnpm start
