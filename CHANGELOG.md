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

### Fixed
- Prevented browser disconnects from propagating as unhandled `ECONNRESET` errors in the LAN proxy.
- Stopped stale persisted `proxy.cjs` files from silently overriding the fixed image proxy unless `DSH_PROXY_FILE` is explicitly set.
- Normalized the WebUI document title to `DeepSeek Harness` and documented direct LAN access without an extra reverse proxy.
