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
- **In-page Appearance Panel**: a floating button in the bottom-right corner of the main page now controls the wallpaper end to end — enable switch, surface / sidebar / subtle opacity, frosted-glass blur, wallpaper dimming, sizing and position, plus config-page tints. Sliders preview live by rebuilding `/__dsh-appearance.css?...`, so nothing is written until **Save**. Configuration is persisted to `appearance.json` next to the wallpaper and survives container rebuilds; **Change image** uploads a replacement (≤ 32 MB, JPEG/PNG/GIF/WebP magic-byte validated). Saving and uploading reuse the WebUI login state; unauthenticated visitors can only preview.
- Stopped stale persisted `proxy.cjs` files from silently overriding the fixed image proxy unless `DSH_PROXY_FILE` is explicitly set.
- Normalized the WebUI document title to `DeepSeek Harness` and documented direct LAN access without an extra reverse proxy.
- Added a protected browser-based settings editor at `/__dsh-config` for headless Unraid deployments where native configuration-file opening is unavailable; writes are atomic and create timestamped backups.

### Changed (2026-09-20)
- **The background feature no longer affects layout (appearance engine rewritten)**. The previous implementation injected a batch of size and spacing rules into the page **unconditionally**, so they stayed active even with the background switched off — which is why turning the background off looked correct and turning it on looked broken. Measured on the previous build: with a conversation open, **133 elements** changed position or size on desktop (the session header was stretched from 774px to 1160px), and **123** did at a 390px mobile viewport (icon buttons collapsed from a 44px to a 36px touch target). The rewritten engine only ever changes colours on app elements, and all geometry is confined to the wallpaper's own isolated layer. With matched on/off comparison of every element, desktop 1440 (both empty and with content) and mobile 390 now show **0 changes**.
- **`backdrop-filter` is no longer applied to app elements.** It establishes a containing block and a stacking context, so mounting it on the application shell made fixed-position elements inside it resolve against that shell instead of the viewport — the root cause of the whole-surface shift. Wallpaper softening now blurs the wallpaper layer itself.
- **Translucent surfaces are driven by theme tokens rather than component class names.** This no longer misses elements, so the wallpaper is now visible across the entire viewport including the sidebar, and components added upstream later pick it up automatically.
- **Opacity semantics changed.** *Overall opacity* now controls the large base surfaces, while *sidebar / panel opacity* controls the sidebar, menus, message bubbles and cards. The two are independent, so the base can be made more transparent to reveal the wallpaper while the sidebar text stays legible.
- **Panel changes**: added a *rounded panels* switch, removed the three obsolete blur fields, and renamed *frosted-glass blur* to *wallpaper softening*.
- **Existing configuration is migrated automatically.** On first load after upgrading, obsolete fields are dropped and the two opacity values are reset to the new defaults — the old `container` value meant the opposite of what it means now, so keeping a stored `0.14` would have left the sidebar nearly invisible. The background switch, softening, dimming, fill mode and position are all preserved.
- `DSH_BACKGROUND_CSS` pointing at a file that does not exist no longer silently disables the whole appearance engine; it falls back to the built-in styles. A `background.css` that contains only comments is treated as empty, so turning every appearance option off genuinely injects nothing.
- **Added a regression gate to the build pipeline.** Before any image is built, CI validates the generated appearance stylesheet; any change that tries to write a size/spacing property into the appearance layer, use a universal selector, or bring back `backdrop-filter` fails the build outright.

### Changed (2026-09-20, mobile sidebar reverted)

- **The mobile sidebar layout layer has been withdrawn; narrow screens use the upstream layout again.** An earlier change on this date turned the phone sidebar into a floating drawer so the conversation would stop being squeezed. That approach was abandoned after it proved worse than the problem it solved. It had to override the sidebar's column width, then its content root's width (upstream pins that node with an inline `width:280px`, which a `max-width` cannot beat), then the collapsed-state padding, then the touch-target padding — each rule compensating for the previous one, and each new rule surfacing a fresh defect. Measured on the shipped build at 390 px, the drawer frame was 341 px wide while the content inside it stayed pinned at 280 px, leaving a 61 px empty band down the right-hand edge of the sidebar; the header's action buttons at its right end were clipped by 32 px.
- **The phone sidebar now expands in place, exactly as upstream does.** At 390 px the frame grid is `280px 110px 0px`, with the sidebar at its full 280 px and the conversation taking the remaining 110 px. That does squeeze the conversation — but it is the official layout, it renders correctly, and it was the behaviour in place before the drawer work began.
- **Only the mobile layout layer was withdrawn; the appearance engine is untouched.** Wallpaper, panel rounding, opacity controls and every theme token behave exactly as before. Verified in the browser against the live build: the injected stylesheet still carries the `html::before` wallpaper layer and the `border-radius` rules, and contains no media query, no `sidebarCol` rule and no `centerCol` rule.
- **The regression gate now asserts the mobile layer stays off**, instead of asserting the drawer's own rules. The build fails if the appearance layer emits any small-screen media query or writes to `sidebarCol` / `centerCol` / `grid-template-columns`, so the withdrawn approach cannot be reintroduced by accident.

