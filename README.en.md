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

## 🎨 Custom WebUI Background (Optional)

Upstream DSH only ships light/dark theme and font-size settings — **no background image support**. This image adds an optional background through the LAN proxy:

1. Drop any image into the persistent directory as `background.jpg` (Unraid example: `/mnt/user/appdata/deepseek-harness/data/background.jpg`).
2. Restart the container and hard-refresh the browser (`Cmd/Ctrl + Shift + R`).

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DSH_BACKGROUND_FILE` | `/root/.dsh/background.jpg` | Image path; jpg/png/webp/gif/svg up to 32 MB |
| `DSH_BACKGROUND_URL` | empty | External image URL; takes precedence over the local file |
| `DSH_BACKGROUND_SIZE` | `cover` | `cover` / `contain` / `auto` |
| `DSH_BACKGROUND_POSITION` | `center` | Same as CSS `background-position` |
| `DSH_BACKGROUND_LAYER_ALPHA` | `0.72` | Default opacity 0–1 for zero-config setups; lower shows more background. **Once you save from the panel, the panel wins** |
| `DSH_BACKGROUND_DIM` | `0` | Darkens the background 0–0.9 for readability |
| `DSH_BACKGROUND_BLUR` | `0` | Wallpaper softening (blurs the wallpaper itself) 0–40; 0 disables it |
| `DSH_BACKGROUND_ENABLED` | `auto` | `auto` / `true` / `false` |
| `DSH_BACKGROUND_CSS` | empty | Advanced: path to custom CSS that fully replaces the default injection |

> The injection overrides the upstream colour theme tokens with `!important`, so light/dark switching keeps working. It **only ever changes colours** — size, spacing, `display`, `flex` and every other geometry property is confined to the wallpaper's own `html::before` layer, nothing of the sort is ever emitted for page elements, and `backdrop-filter` is not used at all. Enabling the background therefore leaves the native layout untouched: comparing every element's position and size with the background on and off yields 0 differences at desktop 1440 (both empty and with content) and at mobile 390. When no image file exists and no URL is set, the proxy injects nothing at all.

### 🪄 In-page Appearance Panel (recommended)

A floating **外观 / Appearance** button sits in the bottom-right corner of the main page. It exposes the background switch, rounded panels, overall opacity (large base surfaces), sidebar/panel opacity (sidebar, menus, bubbles and cards), wallpaper softening, wallpaper dimming, sizing and position, plus advanced items such as the config-page tints.

- The two opacity values are independent: lower *overall* to reveal the wallpaper, keep *sidebar/panel* higher so sidebar text stays legible.
- Dragging a slider **previews instantly** — nothing is written to disk and no reload happens.
- **Save** persists to `appearance.json` next to `background.jpg`, so it survives container rebuilds.
- **Revert** restores the last saved values, **Reset** restores built-in defaults.
- **Change image** uploads a local picture (≤ 32 MB, JPEG/PNG/GIF/WebP validated) and replaces `background.jpg`.

Saving and uploading require an authenticated session (the WebUI login is reused); without it you can still preview locally.

> When upgrading from an older build, `appearance.json` is migrated automatically on first load: obsolete blur fields are dropped and the two opacity values are reset to the new defaults. The old sidebar opacity meant the opposite of what it means now, so keeping a stored `0.14` would have left the sidebar nearly invisible. The background switch, softening, dimming, fill mode and position are all preserved.

| Route | Purpose |
| :--- | :--- |
| `GET /__dsh-appearance.css` | Renders the current stylesheet; query parameters render a preview |
| `GET /__dsh-appearance` | Reads the saved configuration (auth required) |
| `POST /__dsh-appearance` | Saves the configuration (auth required) |
| `POST /__dsh-appearance/background` | Uploads a new wallpaper (auth required) |

---

## 📄 License

- Licensed under the [MIT License](LICENSE).
- DeepSeek Harness core is property of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
