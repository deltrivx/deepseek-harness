# DeepSeek Harness (DSH) Docker 增强版

<div align="center">

[![GitHub stars](https://img.shields.io/github/stars/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/network)
[![GitHub issues](https://img.shields.io/github/issues/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/issues)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Docker Image](https://img.shields.io/badge/Docker-GHCR-blue?logo=docker&style=flat-square)](https://github.com/deltrivx/deepseek-harness/pkgs/container/deepseek-harness)

**面向 NAS、私有云与局域网环境的开箱即用 DeepSeek Harness (DSH) 容器化部署方案**

[English](README.en.md) | 简体中文

</div>

---

## 🌟 项目亮点

DeepSeek Harness (`dsh`) 是 DeepSeek 官方开源的下一代智能体运行时（Everything-is-a-Plugin 架构）。由于官方出于本地开发安全考虑，默认锁定绑定回环地址 `127.0.0.1`，直接在服务器或 NAS 上容器化运行时外部无法访问。

本项目提供完整的容器化与工程化增强方案：
- 🚀 **突破回环限制**：内置极简、零依赖的高性能反向代理，安全打通 NAS / 局域网访问。
- 🛡️ **安全隔离与沙箱保护**：严格挂载隔离持久化配置目录与代码工作区目录，避免误触宿主机重要文件。
- 📦 **自动云端构建 (GHCR)**：基于 GitHub Actions 自动化多架构构建（`linux/amd64`, `linux/arm64`），免去本地编译负担。
- 🖥️ **全平台适配**：专为 Unraid、飞牛 fnOS、群晖 DSM、TrueNAS、Debian/Ubuntu 服务器设计，附带 Docker Compose 模板。

---

## 🚀 快速上手

### 1. 使用 Docker Compose（推荐）

创建 `docker-compose.yml` 文件：

```yaml
services:
  deepseek-harness:
    image: ghcr.io/deltrivx/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080" # Web UI 访问端口
    environment:
      - TZ=Asia/Shanghai
      - PORT=3080
      - DSH_PORT=3018
    volumes:
      - ./data:/root/.dsh        # DSH 核心配置与插件持久化
      - ./workspace:/workspace   # 你的代码/工作空间目录
    working_dir: /workspace
```

启动容器：
```bash
docker compose up -d
```

访问地址：`http://<宿主机IP>:3080`

---

## ⚙️ 目录持久化说明

| 宿主机路径 | 容器内路径 | 说明 |
| :--- | :--- | :--- |
| `/path/to/data` | `/root/.dsh` | 存储 API Keys、模型配置卡片、插件及持久化设置 |
| `/path/to/workspace` | `/workspace` | 智能体操作的工作目录，支持挂载多个项目代码库 |

---

## 🛠️ GitHub Actions 自动化

本项目配置了完整的持续集成构建流：
- 代码提交到 `main` 分支或发布 Release 时自动触发。
- 自动拉取官方最新 `deepseek-ai/deepseek-harness` 源码构建并推送到 GitHub Container Registry (GHCR)。

---

## 📄 开源许可

本项目遵循 [MIT 许可证](LICENSE)。
DeepSeek Harness 核心属于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
