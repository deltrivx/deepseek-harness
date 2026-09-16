<div align="center">

<img src="assets/icon.png" alt="DeepSeek Harness Logo" width="120" height="120" />

# DeepSeek Harness (DSH) Docker Enhanced

[![GitHub stars](https://img.shields.io/github/stars/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/network)
[![GitHub issues](https://img.shields.io/github/issues/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/issues)
[![Release](https://img.shields.io/github/v/release/deltrivx/deepseek-harness?include_prereleases&style=flat-square&color=blue)](https://github.com/deltrivx/deepseek-harness/releases)
[![Upstream Sync](https://img.shields.io/badge/Upstream%20Sync-v0.1.6--alpha.1-blueviolet?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Docker Image](https://img.shields.io/badge/Docker-GHCR-blue?logo=docker&style=flat-square)](https://github.com/deltrivx/deepseek-harness/pkgs/container/deepseek-harness)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

**Out-of-the-box containerized deployment suite for DeepSeek Harness (DSH) on NAS, Private Clouds, and Local Networks.**

English | [简体中文](README.md) | [Changelog](CHANGELOG.md)

</div>

---

## 📖 Introduction

[DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) is the next-generation agent runtime officially open-sourced by DeepSeek (powered by the Cordis plugin-first architecture).

By default, the upstream runtime binds strictly to `127.0.0.1` for local single-machine security, preventing external access when deployed on NAS devices, homelabs, or cloud servers.

**This project delivers a complete containerized solution:**
- Bridges local network and WAN reverse-proxy access out of the box.
- Strictly aligned with upstream official releases (currently synced with **`v0.1.6-alpha.1`**).
- Automated multi-arch cloud builds (`linux/amd64` and `linux/arm64`) via GHCR.
- Pre-configured Unraid CA templates and Docker Compose configurations.

---

## 🚀 Quick Start

### Docker Compose

```yaml
services:
  deepseek-harness:
    image: ghcr.io/deltrivx/deepseek-harness:v0.1.6-alpha.1 # or latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080"
    environment:
      - TZ=Asia/Shanghai
      - PORT=3080
      - DSH_PORT=3018
    volumes:
      - ./data:/root/.dsh        # Configuration, keys, and plugins
      - ./workspace:/workspace   # Root workspace for agent execution
    working_dir: /workspace
```

Run:
```bash
docker compose up -d
```

Access Web UI at `http://<HOST_IP>:3080`.

The bundled proxy listens on `0.0.0.0:3080`, so no extra Nginx, domain, or reverse-proxy configuration is required. The page title is normalized to **DeepSeek Harness**, and browser disconnects are handled without propagating upstream `ECONNRESET` failures. Configuration and credentials are persisted under `/root/.dsh`. On headless Unraid hosts, use the browser editor at `http://<HOST_IP>:3080/__dsh-config` after signing in; saves create `settings.yaml.bak-*` backups. Do not override `/entrypoint.sh` or `/app/proxy.cjs` in an Unraid template, or an old startup script may replace the fixed proxy.

---

## 📄 License

- Licensed under the [MIT License](LICENSE).
- DeepSeek Harness core is property of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
