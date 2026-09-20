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

### Added (2026-09-20)
- **Mobile sidebar is now a slide-in drawer.** On narrow phone screens the sidebar used to expand in place, squeezing the conversation into a remaining sliver — at 390 px wide, opening it left only **110 px** for the chat area (about 72% of the screen was sidebar), and the conversation rendered nothing at all. Opening the sidebar on a phone now slides it over the content instead: the conversation keeps the **full screen width**, the sidebar floats above it at up to 88% of the screen width (capped at 340 px), and tapping any entry or the content behind it closes it.
- **Mobile touch targets meet the 44 px guideline.** Sidebar icons, conversation rows and the brand header were between 24 px and 38 px tall on phones — small enough to mis-tap. They are now at least 44 px in both directions, with the icons themselves unchanged in size.
- **Mobile text is slightly larger.** Session titles, metadata lines and section labels in the sidebar are a step bigger on phones for readability.
- **This is strictly a small-screen change.** Every one of these rules lives inside a single `(max-width: 560px)` media query, so tablets and desktops keep the upstream layout byte-for-byte. Verified by matching every element's geometry with the feature on and off: **0 differences at 1440 px** (both with and without an open conversation), and the layout is identical to upstream again from 561 px upwards.

### Fixed (2026-09-20, mobile sidebar follow-up)
- **The mobile drawer only widens when the sidebar is open.** Its geometry rules previously had no open/closed condition, so the full widened panel drew even with the sidebar collapsed — it sat on top of the conversation and obscured the left-hand icon rail. Widening is now scoped to the expanded state (the frame element drops its collapsed attribute when open).
- **The collapsed icon rail is preserved, not hidden.** An earlier attempt at the above removed the sidebar column from the layout entirely when closed. That column is the phone's *only* navigation — it carries open-sidebar, new session, plugins, workspace, search and settings — so hiding it left no way to reach any of them on a phone. The column is now always present as a fixed 56 px rail, and the conversation column reserves 56 px of padding so nothing sits underneath it.
- **The drawer is an opaque surface now.** It previously reused the same translucent surface as the rest of the UI, which is fine for a panel sitting over the wallpaper but not for one floating over a conversation: at 45% opacity the chat text behind it stayed fully legible, so two layers of text printed on top of each other. The drawer now paints a solid colour, with a dimming scrim between it and the content.
- **The settings sheet is no longer covered by the drawer.** It sat below the drawer in the stacking order, so opening settings while the drawer was open hid most of it.
- **Fixed a selector-composition bug** that silently voided the open/closed condition: when a comma-separated selector list is concatenated with a state suffix and a child combinator, the suffix only attaches to the last entry, leaving the earlier ones as bare selectors that match nothing.
