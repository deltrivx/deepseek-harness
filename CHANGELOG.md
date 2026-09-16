# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.1.6-alpha.1] - 2026-09-15

### Added
- **Upstream Sync**: Aligned base source and runtime components with official `deepseek-ai/deepseek-harness` at `v0.1.6-alpha.1`.
- **Network Bridge**: Integrated lightweight Node.js streaming proxy (`proxy.cjs`) to bridge `127.0.0.1` loopback isolation to `0.0.0.0`, supporting full HTTP and WebSocket duplex communication.
- **Multi-Architecture CI**: Configured GitHub Actions workflow for building and publishing `linux/amd64` and `linux/arm64` container images to GHCR.
- **NAS & Private Cloud Templates**: Added ready-to-use Unraid CA XML template and `docker-compose.yml` deployment files.
- **Asset Branding**: Added official high-resolution vector icon (`assets/icon.svg`).
- **Optional WebUI Background**: The LAN proxy can now inject a wallpaper behind the WebUI. Drop an image at `/root/.dsh/background.jpg` (or point `DSH_BACKGROUND_URL` at a remote one) and it is served at `/__dsh-background`; upstream `--dsw-alias-bg-*` theme tokens are overridden with `!important` so light/dark switching keeps working. Tunable via `DSH_BACKGROUND_FILE`, `DSH_BACKGROUND_URL`, `DSH_BACKGROUND_SIZE`, `DSH_BACKGROUND_POSITION`, `DSH_BACKGROUND_LAYER_ALPHA`, `DSH_BACKGROUND_DIM`, `DSH_BACKGROUND_BLUR`, `DSH_BACKGROUND_ENABLED`, `DSH_BACKGROUND_CSS`. When no image is present the proxy injects nothing, so behaviour stays identical to the official image.

### Fixed
- Prevented browser disconnects from propagating as unhandled `ECONNRESET` errors in the LAN proxy.
- Stopped stale persisted `proxy.cjs` files from silently overriding the fixed image proxy unless `DSH_PROXY_FILE` is explicitly set.
- Normalized the WebUI document title to `DeepSeek Harness` and documented direct LAN access without an extra reverse proxy.
- Added a protected browser-based settings editor at `/__dsh-config` for headless Unraid deployments where native configuration-file opening is unavailable; writes are atomic and create timestamped backups.
