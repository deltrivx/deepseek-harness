# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.1.6-alpha.1] - 2026-09-15

### Added
- **Upstream Sync**: Aligned base source and runtime components with official `deepseek-ai/deepseek-harness` at `v0.1.6-alpha.1`.
- **Network Bridge**: Integrated lightweight Node.js streaming proxy (`proxy.js`) to bridge `127.0.0.1` loopback isolation to `0.0.0.0`, supporting full HTTP and WebSocket duplex communication.
- **Multi-Architecture CI**: Configured GitHub Actions workflow for building and publishing `linux/amd64` and `linux/arm64` container images to GHCR.
- **NAS & Private Cloud Templates**: Added ready-to-use Unraid CA XML template and `docker-compose.yml` deployment files.
- **Asset Branding**: Added official high-resolution vector icon (`assets/icon.svg`).
