const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = parseInt(process.env.PORT || "3080", 10);
const TARGET_PORT = parseInt(process.env.DSH_PORT || "3018", 10);
const TARGET_HOST = "127.0.0.1";
const PUBLIC_TITLE = "DeepSeek Harness";
const CONFIG_FILE = process.env.DSH_CONFIG_FILE || path.join(process.env.DSH_HOME || "/root/.dsh", "settings.yaml");
const MAX_CONFIG_BYTES = 1024 * 1024;
const DSH_HOME = process.env.DSH_HOME || "/root/.dsh";
const BACKGROUND_ROUTE = "/__dsh-background";
const BACKGROUND_FILE = process.env.DSH_BACKGROUND_FILE || path.join(DSH_HOME, "background.jpg");
const BACKGROUND_URL = (process.env.DSH_BACKGROUND_URL || "").trim();
const BACKGROUND_SIZE = process.env.DSH_BACKGROUND_SIZE || "cover";
const BACKGROUND_POSITION = process.env.DSH_BACKGROUND_POSITION || "center";
const BACKGROUND_LAYER_ALPHA = process.env.DSH_BACKGROUND_LAYER_ALPHA;
const BACKGROUND_DIM = process.env.DSH_BACKGROUND_DIM;
const BACKGROUND_BLUR = process.env.DSH_BACKGROUND_BLUR;
const BACKGROUND_ENABLED = (process.env.DSH_BACKGROUND_ENABLED || "auto").trim().toLowerCase();
const BACKGROUND_CSS_FILE = (process.env.DSH_BACKGROUND_CSS || path.join(DSH_HOME, "background.css")).trim();
const MAX_BACKGROUND_BYTES = 32 * 1024 * 1024;
const APPEARANCE_FILE = (process.env.DSH_APPEARANCE_FILE || path.join(DSH_HOME, "appearance.json")).trim();
const APPEARANCE_ROUTE = "/__dsh-appearance";
const APPEARANCE_CSS_ROUTE = "/__dsh-appearance.css";
const APPEARANCE_UPLOAD_ROUTE = "/__dsh-appearance/background";

// Single source of truth for the look. Everything the old hand-edited
// background.css used to do is now a field here, so the in-page panel can
// drive it without touching files.
const DEFAULT_APPEARANCE = {
  enabled: true,
  surface: 0.32,
  subtle: 0.55,
  container: 0.14,
  blur: 4,
  blurMain: 5,
  blurInput: 2,
  panelAlpha: 0.14,
  inputAlpha: 0.05,
  dim: 0,
  size: "cover",
  position: "center",
};
const APPEARANCE_NUMBERS = {
  surface: [0, 1],
  subtle: [0, 1],
  container: [0, 1],
  panelAlpha: [0, 1],
  inputAlpha: [0, 1],
  dim: [0, 0.9],
  blur: [0, 40],
  blurMain: [0, 40],
  blurInput: [0, 40],
};
const APPEARANCE_SIZES = ["cover", "contain", "100% 100%", "auto"];
const APPEARANCE_POSITIONS = ["center", "top", "bottom", "left", "right", "top left", "top right"];

// The theme presenter writes every --dsw-* token onto document.body as inline
// style, and portals (dialogs, tooltips, menus) live outside #root. So the
// overrides cannot target a single element: body keeps the originals (snapshot
// into --dsw-bgw-N) while every descendant re-derives them with color-mix.
// This stays adaptive to light/dark without hardcoding any palette.
const SURFACE_TOKENS = [
  "--dsw-alias-bg-base",
  "--dsw-alias-bg-l1",
  "--dsw-alias-bg-l2",
  "--dsw-alias-bg-layer-1",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-layer-3",
  "--dsw-alias-bg-layer-4",
  "--dsw-alias-bg-overlay",
  "--dsw-alias-bg-module-platform",
  "--dsw-alias-bg-multi-select",
  "--dsw-alias-bg-skeleton",
  "--dsw-alias-markdown-code-block",
  "--dsw-alias-markdown-code-block-banner",
  "--dsw-alias-markdown-code-segment-selected",
  "--dsw-alias-markdown-code-segment-unselected",
  "--dsw-alias-markdown-inline-code",
  "--dsw-alias-markdown-citation",
  "--dsw-alias-markdown-placeholder",
  "--dsw-alias-markdown-tag",
  "--dsw-specific-sidebar-fill",
  "--dsw-specific-sidebar-nav-item-active",
  "--dsw-specific-sidebar-nav-item-active-accent",
  "--dsw-specific-sidebar-nav-item-hover",
  "--dsw-specific-menu",
  "--dsw-specific-bubble",
  "--dsw-specific-bubble-highlight",
  "--dsw-specific-input-major",
  "--dsw-specific-login-input",
  "--dsw-alias-fill-l2",
  "--dsw-alias-fill-tertiary",
  "--dsw-alias-fill-tsp-secondary",
  "--dsw-alias-toast-bg",
  "--dsw-alias-tooltip-bg",
  "--dsw-hovercard-bg",
];

// Hover / scrollbar / toolbar fills are already subtle; only nudge them so
// interactive affordances do not disappear.
const SUBTLE_TOKENS = [
  "--dsw-alias-interactive-bg-active",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-interactive-bg-hover-accent",
  "--dsw-alias-interactive-bg-hover-danger",
  "--dsw-alias-interactive-bg-hover-solid",
  "--dsw-alias-scrollbar-bg-l1",
  "--dsw-alias-scrollbar-bg-l2",
  "--dsw-alias-button-elevated-fill",
  "--dsw-alias-button-floating-fill",
  "--dsw-alias-button-tool-bar-fill",
  "--dsw-alias-button-ghost-active-fill",
];

let activeCookie = "";

function buildTokenCss(surfaceAlpha, subtleAlpha) {
  const names = SURFACE_TOKENS.concat(SUBTLE_TOKENS);
  const snapshot = `--dsw-bgw-layer1:var(--dsw-alias-bg-layer-1);` + names.map((name, index) => `--dsw-bgw-${index}:var(${name})`).join(";");
  const override = names
    .map((name, index) => {
      if (index === 0) return `${name}:transparent !important`;
      const percent = Math.round((index < SURFACE_TOKENS.length ? surfaceAlpha : subtleAlpha) * 100);
      return `${name}:color-mix(in srgb,var(--dsw-bgw-${index}) ${percent}%,transparent) !important`;
    })
    .join(";");
  return `body{${snapshot}}body *{${override}}`;
}

function clampUnit(raw, fallback, min, max) {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function alpha(value) {
  return Math.round(value * 1000) / 1000;
}

function cssUrl(value) {
  return String(value).replace(/["\\\r\n]/g, "");
}

function backgroundMime(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    default: return "image/jpeg";
  }
}

function resolveBackground() {
  if (BACKGROUND_ENABLED === "false") return null;
  if (BACKGROUND_URL) return { url: cssUrl(BACKGROUND_URL), file: null };
  try {
    const stat = fs.statSync(BACKGROUND_FILE);
    if (!stat.isFile() || stat.size > MAX_BACKGROUND_BYTES) return null;
    return { url: `${BACKGROUND_ROUTE}?v=${Math.floor(stat.mtimeMs)}`, file: BACKGROUND_FILE };
  } catch {
    return null;
  }
}

function readBodyBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function looksLikeImage(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return true;
  return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
}

function writeAtomic(file, data, binary) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak-${Date.now()}`); } catch { /* best effort */ }
    pruneBackups(file);
  }
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, data, binary ? undefined : { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function pruneBackups(file, keep = 5) {
  try {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const old = fs.readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.bak-`))
      .sort()
      .reverse()
      .slice(keep);
    for (const name of old) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

function readCssFile(file) {
  try {
    const css = fs.readFileSync(file, "utf8");
    return css.trim() ? css : "";
  } catch {
    return "";
  }
}

function appearanceFromEnv() {
  // Environment variables stay supported as the zero-config path, but a saved
  // appearance.json always wins so the in-page panel is authoritative.
  const cfg = { ...DEFAULT_APPEARANCE };
  const layerAlpha = Number.parseFloat(BACKGROUND_LAYER_ALPHA);
  if (Number.isFinite(layerAlpha)) {
    cfg.surface = Math.min(1, Math.max(0, layerAlpha));
    cfg.subtle = Math.min(1, cfg.surface + 0.2);
    cfg.container = cfg.surface;
  }
  const dim = Number.parseFloat(BACKGROUND_DIM);
  if (Number.isFinite(dim)) cfg.dim = Math.min(0.9, Math.max(0, dim));
  const blur = Number.parseFloat(BACKGROUND_BLUR);
  if (Number.isFinite(blur) && blur > 0) {
    cfg.blur = blur;
    cfg.blurMain = Math.round(blur * 1.3);
    cfg.blurInput = Math.max(0, Math.round(blur * 0.45));
  }
  cfg.size = BACKGROUND_SIZE;
  cfg.position = BACKGROUND_POSITION;
  if (BACKGROUND_ENABLED === "false") cfg.enabled = false;
  return cfg;
}

function loadAppearance() {
  const cfg = appearanceFromEnv();
  try {
    const saved = JSON.parse(fs.readFileSync(APPEARANCE_FILE, "utf8"));
    if (saved && typeof saved === "object") return sanitizeAppearance({ ...cfg, ...saved });
  } catch {
    // No saved file yet: env / built-in defaults apply.
  }
  return cfg;
}

function sanitizeAppearance(input) {
  const cfg = { ...DEFAULT_APPEARANCE };
  if (typeof input.enabled === "boolean") cfg.enabled = input.enabled;
  for (const key of Object.keys(APPEARANCE_NUMBERS)) {
    const [min, max] = APPEARANCE_NUMBERS[key];
    const parsed = Number.parseFloat(input[key]);
    if (Number.isFinite(parsed)) cfg[key] = Math.min(max, Math.max(min, parsed));
  }
  if (APPEARANCE_SIZES.includes(String(input.size))) cfg.size = String(input.size);
  if (APPEARANCE_POSITIONS.includes(String(input.position))) cfg.position = String(input.position);
  return cfg;
}

function appearanceFromQuery(params) {
  const patch = {};
  for (const key of Object.keys(DEFAULT_APPEARANCE)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    if (key === "enabled") patch.enabled = raw === "true" || raw === "1";
    else if (key === "size" || key === "position") patch[key] = raw;
    else patch[key] = Number.parseFloat(raw);
  }
  return sanitizeAppearance({ ...loadAppearance(), ...patch });
}

// ---------------------------------------------------------------------------
// 两层分离（2026-09-18 重构）
//
// 之前所有布局补丁都写在 renderAppearanceCss() 里，而它在 enabled=false 时
// 直接 return "" —— 于是「关背景 = 零补丁（原始布局）」「开背景 = 全部补丁
// 一次性生效」。用户看到的现象就是：不开背景一切正常，一开背景布局全乱。
//
// 现在严格分层：
//   LAYOUT_FIX_CSS        布局层，永远注入，不受背景开关影响。只做移动端
//                         适配所必需的几何与不透明度，桌面端一律不碰。
//   renderAppearanceCss() 背景层，仅当 enabled 且有背景图时才产出内容。
//                         只改颜色 / 背景图 / 模糊，**绝不改任何几何属性**
//                         （padding / margin / width / max-width / flex /
//                         grid / position 一律禁止出现在这里）。
//
// 这样「开关背景」只会切换背景图与表面透明度，布局像素级不变。
const LAYOUT_FIX_CSS = [
  // ---- 面板圆角背景（2026-09-18 恢复，沿用之前的圆角设计）----
  //
  // 之前的两处圆角：
  //   1. 顶面板（消息列容器 _column）：22px。上游 column 自带 layer-1
  //      背景色但 border-radius:0，看着就是一块「直角背景」，加 22px
  //      后成为一张卡片。
  //   2. markdown 回答卡：16px + layer-1 背景色，让 AI 回复像圆角卡片。
  //
  // border-radius 是**纯视觉裁剪**，不改变布局盒模型尺寸（width / height /
  // position 都不受影响），所以放在布局层全局生效是安全的：开关背景都
  // 保持一致的圆角外观，不会出现「只有开背景才有圆角」的割裂。
  //
  // 刻意**不恢复**之前配套的 padding:20px / margin:-14px /
  // max-width:712px —— 那些是用户评价「治标不治本」的 PC 端对齐补丁，
  // 已永久删除。这里只恢复圆角与卡片背景本身。
  `[class*="_column"],[class*="Column"]{border-radius:22px !important;}`,
  // markdown：圆角面板背景。box-sizing:border-box 是关键 —— 原始设计（备份
  // proxy.cjs 第 341 行）只有 padding:10px 20px，没指定 box-sizing，等于假设
  // 上游用 border-box。但线上当前 hash 下实测 content-box，加 padding 会把
  // 宽度撑大 40px → 移动端 342→382 → 极易溢出 402px 视口。显式锁 border-box
  // 后外尺寸不变，仅内部文字位置变化，符合「圆角背景恢复但布局不破坏」。
  `[class*="markdown"]:not([class*="icon"]):not([class*="Icon"]),[class*="Markdown"]:not([class*="icon"]):not([class*="Icon"]){border-radius:16px !important;background-color:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.5)) !important;padding:10px 20px !important;box-sizing:border-box !important;}`,
  // ---- 顶面板 kBmzhq_header（会话头 + 标签栏）----
  //
  // 圆角面板背景：跟 markdown 同样的 layer-1 颜色 + 22px 圆角，与底部 composer
  // 卡 (PbIGXq_card, w=774) 同宽居中。原本这条 header 默认全宽 (1160px) 撑满
  // centerCol，背景也是透明的，看起来像一块扁平的横条；加 panel 后变成顶/底
  // 两张同宽卡片的对称视觉。
  //
  // 用 width + margin 0 auto 收宽度是布局改动，但只影响这一条 header 本身
  // （不挪走 grid track、不动 sidebarCol / centerCol 划分）；header 内的
  // titleRow / tabs 都是 flex 自然收窄，外层 width 缩了它们也跟着居中显示。
  // 不改 box-sizing —— header 默认已是 border-box（实测），加 padding 不会
  // 撑爆外宽。
  //
  // 上游 titleCluster 默认 flex-basis:0% + flex-shrink:1，把外层 width 缩
  // 到 774 后它会被 headerUtilities 挤到 width:0 → 标题完全消失。这里把
  // 它的 flex 行为松开（flex-shrink:0 / flex-basis:auto），让标题按内容
  // 自然占位，headerUtilities 仍可放右但溢出时也至少看得到标题。
  `[class*="kBmzhq_header"]{background-color:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.5)) !important;border-radius:22px !important;padding:8px 16px !important;box-sizing:border-box !important;}`,
  // 桌面端 header 收窄到 774px 与 composer 卡同宽居中。移动端不约束宽度，让它
  // 自然撑满 centerCol（content-box 配合 padding 8px 16px 加上 centerCol 自身
  // 的 width:100%，不会溢出）。
  `@media (min-width:1024px){[class*="kBmzhq_header"]{width:774px !important;max-width:774px !important;margin:8px auto 0 !important;}}`,
  `[class*="kBmzhq_header"] [class*="kBmzhq_titleCluster"]{flex-shrink:0 !important;flex-basis:auto !important;min-width:0 !important;}`,
  `[class*="kBmzhq_header"] [class*="kBmzhq_tabs"]{padding-left:0 !important;}`,
  // ---- 移动端布局修复（max-width:640px）----
  //
  // 根本原因（已在线上验证，0.1.6-alpha.1 当前构建 index-BRtJ62WN.css +
  // vendor.css 映射在原生命名）：
  //   1) AppFrame 用 grid-template-columns 280px minmax(0,1fr) 0px 由 JS 写
  //      到内联 style；viewport<400px 时中心列被压到 ~110px，几乎不可用。
  //   2) 整张 AppFrame.module.css 里 0 条基于宽度的 @media，只有 3 条全是
  //      prefers-reduced-motion。响应式完全靠 JS，但 JS 的 "narrow" 判定
  //      只在 SIDEBAR_AUTO_COLLAPSE=1024 时自动收缩侧栏，并未阻止用户在
  //      手机上点开导致中心列崩溃。
  //   3) centerCol / rightbarCol 都是 position:static 的 grid item，
  //      sidebarCol / overlayLayer / handle 是 position:absolute 不占轨；
  //      自动分配默认会把 centerCol 放到 track 1、rightbarCol 放到
  //      track 2，因此把 grid 改成 "1fr | 0" 后必须显式 grid-column 钉死，
  //      否则 rightbarCol 会被推到主轨把整张图盖住。
  //
  // 选择 .bR7R9W_*（ui-layout/AppFrame 当前 hash）作为首选，外加
  // [class$="_xxx"] 后缀兜底：上游下次重新打包把 bR7R9W 换成别的 hash 时，
  // 只要末尾仍是 _frame / _sidebarCol / _centerCol / _rightbarCol / _handle
  // 就仍然命中。
  `@media (max-width:640px){`,
  // 三列 → 单列，centerCol 显式钉到主轨。
  `.bR7R9W_frame,[class$="_frame"]{grid-template-columns:minmax(0,1fr) 0px !important;}`,
  `.bR7R9W_centerCol,[class$="_centerCol"]{grid-column:1 !important;}`,
  `.bR7R9W_rightbarCol,[class$="_rightbarCol"]{grid-column:2 !important;}`,
  // 侧栏改 overlay：脱离 grid，覆盖在中心列上方。
  `.bR7R9W_sidebarCol,[class$="_sidebarCol"]{position:absolute !important;left:0 !important;top:0 !important;bottom:0 !important;width:min(86vw,320px) !important;z-index:50 !important;transform:translateX(-100%);transition:transform .22s ease !important;box-shadow:4px 0 24px rgba(0,0,0,.35) !important;}`,
  // 展开 → 滑入；折叠 → 缩成 56px rail（不要 translateX 把内容推出屏幕）。
  `.bR7R9W_frame:not([data-sidebar-collapsed]) .bR7R9W_sidebarCol,.bR7R9W_frame:not([data-sidebar-collapsed]) [class$="_sidebarCol"]{transform:translateX(0) !important;}`,
  `.bR7R9W_frame[data-sidebar-collapsed] .bR7R9W_sidebarCol,.bR7R9W_frame[data-sidebar-collapsed] [class$="_sidebarCol"]{width:56px !important;transform:none !important;box-shadow:none !important;}`,
  // 拖拽把在手机上没意义
  `.bR7R9W_handle,[class$="_handle"]{display:none !important;}`,
  // overlayLayer 是 sidebar overlay 的点击关闭层 — 桌面不显示，移动端
  // 展开 sidebar 时需要变成半透明黑色 backdrop，点击关闭侧栏。
  `[class$="_overlayLayer"]{display:none !important;}`,
  `.bR7R9W_frame:not([data-sidebar-collapsed]) [class$="_overlayLayer"],.bR7R9W_frame:not([data-sidebar-collapsed]) .bR7R9W_overlayLayer{display:block !important;background-color:rgba(0,0,0,.5) !important;z-index:49 !important;}`,
  // 任何仍然被写死成 712px 的面板，在窄屏改成跟随视口。
  `[class*="_column"],[class*="Column"],[class*="_card"],[class*="composer"],[class*="Composer"]{max-width:100% !important;width:auto !important;}`,
  // 长内容（代码块 / 表格 / 长单词）不允许把页面顶宽。
  `pre,code,table,[class*="markdown"],[class*="Markdown"]{max-width:100% !important;overflow-x:auto !important;}`,
  `img,svg,video{max-width:100% !important;height:auto !important;}`,
  // 触控目标最小 44px（iOS HIG），只提升不改变视觉盒子。
  // 刻意不含 a / input：正文里的超链接和表单控件基数太大，一把梭会把
  // 行高和工具栏撑爆（a 里既有导航项也有 markdown 正文里的行内链接）。
  `button,[role="button"]{min-height:44px !important;min-width:44px !important;}`,
  // 输入框在移动端至少要 16px，否则 iOS Safari 聚焦时会自动放大整页。
  `textarea,input,select{font-size:16px !important;}`,
  // ---- 设置面板移动端重排（实测 iPhone 16 Pro 402 视口）----
  // 设置面板（BCrMEa_panel）默认是 nav 188px + content 132px 双列布局，
  // 移动端视口只有 320px 时 content 被自身 padding 进一步压成 84px，每行
  // rowText 48px + control 68px 直接溢出，标题/描述文字一字符一字符竖排。
  // 改成：panel 占满视口 + 纵向布局；nav 横向滚动条；content 占满；行内
  // rowText / control 上下堆叠。
  // 同样用 .BCrMEa_* + [class*="settingsPanel"] 双选择器。
  // z-index 要高于侧栏 overlay（z-index=50），否则侧栏 logo / 工作区
  // 文字会从面板下面透出来，看起来像没遮挡。
  // 注意：这里不能用 var(--dsw-alias-bg-layer-1, ...) — 该变量在深色
  // 主题里实际是 32% 透明的 rgba，回退值永远不会生效，面板会半透。
  // 改为硬编码的不透明背景色：深色 #14141a / 浅色 #ffffff。
  `.BCrMEa_panel,[class*="settingsPanel"]{width:100% !important;max-width:100% !important;height:calc(100vh - 56px) !important;flex-direction:column !important;z-index:60 !important;background:#14141a !important;background-color:#14141a !important;}`,
  `body[data-ds-light-theme] .BCrMEa_panel,body[data-ds-light-theme] [class*="settingsPanel"]{background:#ffffff !important;background-color:#ffffff !important;}`,
  `.BCrMEa_overlay,[class$="_overlay"]{z-index:60 !important;background:rgba(0,0,0,.5) !important;}`,
  `.BCrMEa_nav,[class$="_nav"]:not([role=navigation]){width:100% !important;height:auto !important;max-height:56px !important;flex:0 0 auto !important;flex-direction:row !important;overflow-x:auto !important;overflow-y:hidden !important;padding:8px 12px !important;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.1)) !important;}`,
  `.BCrMEa_navTitle{display:none !important;}`,
  `.BCrMEa_navList{flex-direction:row !important;flex-wrap:nowrap !important;gap:8px !important;height:40px !important;align-items:center !important;}`,
  `.BCrMEa_navCell{flex-shrink:0 !important;width:auto !important;height:32px !important;padding:0 12px !important;}`,
  `.BCrMEa_content{width:100% !important;flex:1 1 auto !important;min-height:0 !important;padding:12px !important;}`,
  `[class*="_row"]:not([class*="cubeRow"]):not([class*="navList"]):not([class*="arrowRow"]){flex-direction:column !important;align-items:stretch !important;gap:8px !important;padding:12px 0 !important;}`,
  `[class*="_rowText"]{width:100% !important;}`,
  `[class*="_title"],[class*="_desc"]{width:100% !important;max-width:100% !important;}`,
  // 主题色块（外观 → 浅色/深色/跟随系统）：三个并排均分。
  `[class$="_cubeRow"]{flex-direction:row !important;flex-wrap:nowrap !important;gap:12px !important;height:auto !important;justify-content:space-between !important;padding:8px 0 !important;}`,
  `[class$="_themeCube"]{flex:1 1 0 !important;min-width:0 !important;max-width:88px !important;height:88px !important;}`,
  // 通用弹层（工作区选择器、确认弹窗等）：_dialog_* 默认是 14% 透明，
  // 透出背景里的选择器图标 / 空状态文字。直接覆盖为不透明深色；
  // 浅色主题同样翻成白色。同时加阴影 + 提 z-index 让 dialog 浮在
  // backdrop 之上更有层次。
  `[class*="_dialog"]{background-color:#14141a !important;background:#14141a !important;border-radius:12px !important;box-shadow:0 16px 48px rgba(0,0,0,.5) !important;z-index:1100 !important;}`,
  `body[data-ds-light-theme] [class*="_dialog"]{background-color:#ffffff !important;background:#ffffff !important;}`,
  // 弹层根（_root_*）固定铺满屏幕，给一个深色 backdrop 让弹层与背景
  // 拉开层次（DSH body 本身就是深色，0.5 黑叠在深色上看不出，必须更深）。
  `[class*="_root_"]:has([class*="_dialog"]){background-color:rgba(0,0,0,.72) !important;}`,
  // 选择器下拉（_list_* scrollable portal）：32% 透明同样修成不透明。
  `[class*="_list_"][class*="portal"]{background-color:#14141a !important;background:#14141a !important;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.1)) !important;border-radius:10px !important;max-width:calc(100vw - 24px) !important;}`,
  `body[data-ds-light-theme] [class*="_list_"][class*="portal"]{background-color:#ffffff !important;background:#ffffff !important;}`,
  // 空状态 composer 卡片（PbIGXq_root/hero/...）默认 align-items:center +
  // flex-grow:0，width 被锁成 ~168px，输入框只剩 136px，无法输入。
  // 强制 root 横向伸展 + card flex-grow:1，让输入框占满 composer 区域。
  // 重要：box-sizing:border-box — 上游是 content-box，width:100% 加 32px 左右
  // padding 会撑出 viewport（320px 视口下实测 PbIGXq_root 撑到 342px）。
  `[class$="_composerRoot"],[class*="_composerHero"],[class*="_composerRoot"],[class*="PbIGXq_root"]{align-items:stretch !important;width:100% !important;box-sizing:border-box !important;max-width:100% !important;}`,
  `[class*="PbIGXq_card"]{flex:1 1 auto !important;width:auto !important;min-width:0 !important;max-width:100% !important;box-sizing:border-box !important;}`,
  `[class*="PbIGXq_input"]{width:100% !important;min-height:44px !important;}`,
  // centerCol 也加保险：避免任何子元素的 padding/box-sizing 撑爆。
  `[class$="_centerCol"]{min-width:0 !important;box-sizing:border-box !important;max-width:100% !important;}`,
  // body/html 横向裁剪 — 兜底：上游有 cmqW6G_panel 等 visibility:hidden
  // 但 transform:translateX(320px) 推到屏外的元素，会让 body scrollWidth
  // 翻倍（实测 320 视口下 scrollW=640）。overflow-x:hidden 把它们裁掉。
  `html,body{overflow-x:hidden !important;}`,
  `}`,
].join("");

function renderAppearanceCss(cfg) {
  // An explicitly configured file still fully replaces the stylesheet.
  const explicit = (process.env.DSH_BACKGROUND_CSS || "").trim();
  if (explicit) return LAYOUT_FIX_CSS + readCssFile(explicit);

  const base = sanitizeAppearance(cfg);
  if (!base.enabled) return LAYOUT_FIX_CSS;
  const background = resolveBackground();
  if (!background) return LAYOUT_FIX_CSS;

  const image = base.dim > 0
    ? `linear-gradient(rgba(0,0,0,${alpha(base.dim)}),rgba(0,0,0,${alpha(base.dim)})),url("${background.url}")`
    : `url("${background.url}")`;
  const percent = Math.round(base.container * 100);
  // Name-agnostic safety net: hashed CSS-module class names still carry the
  // original words, so this keeps working even if upstream renames tokens.
  const containerRule = `[class*="sidebar"],[class*="Sidebar"],[class*="side-bar"],[class*="drawer"],[class*="Drawer"],[class*="panel"],[class*="Panel"],[class*="column"],[class*="Column"],[class*="pane"],[class*="Pane"],[class*="surface"],[class*="Surface"],aside,nav,main,[role="navigation"],[role="complementary"],[role="dialog"]{background-color:color-mix(in srgb,var(--dsw-bgw-layer1) ${percent}%,transparent) !important;}`;
  const blurRule = base.blur > 0
    ? `#root{backdrop-filter:blur(${base.blur}px) saturate(1.08) !important;-webkit-backdrop-filter:blur(${base.blur}px) saturate(1.08) !important;}`
    : "";
  const mainBlur = base.blurMain > 0 ? `backdrop-filter:blur(${base.blurMain}px) !important;-webkit-backdrop-filter:blur(${base.blurMain}px) !important;` : "";
  const inputBlur = base.blurInput > 0 ? `backdrop-filter:blur(${base.blurInput}px) !important;-webkit-backdrop-filter:blur(${base.blurInput}px) !important;` : "";
  const rules = [
    `html,body{background-image:${image} !important;background-size:${cssUrl(base.size)} !important;background-position:${cssUrl(base.position)} !important;background-attachment:fixed !important;background-repeat:no-repeat !important;}`,
    `html,body{background-color:transparent !important;}`,
    buildTokenCss(base.surface, base.subtle),
    containerRule,
    blurRule,
    `main{background-color:rgba(255,255,255,${alpha(base.panelAlpha)}) !important;${mainBlur}}`,
    `textarea,input,select{background-color:rgba(255,255,255,${alpha(base.inputAlpha)}) !important;${inputBlur}color:#1f2328 !important;}`,
    `body[data-ds-dark-theme] main{background-color:rgba(28,28,30,${alpha(Math.min(1, base.panelAlpha * 1.3))}) !important;}`,
    `body[data-ds-dark-theme] textarea,body[data-ds-dark-theme] input,body[data-ds-dark-theme] select{background-color:rgba(28,28,30,${alpha(Math.min(1, base.inputAlpha * 1.4))}) !important;color:#e6e6e6 !important;}`,
  ].join("");
  // 布局层在前（几何基线），背景层居中（只上色），background.css 追加在最后
  // —— 手写的覆盖依然是最终赢家。
  return LAYOUT_FIX_CSS + rules + readCssFile(BACKGROUND_CSS_FILE);
}

function buildBackgroundCss() {
  const css = renderAppearanceCss(loadAppearance());
  return `<style id="dsh-background">${css}</style>`;
}

function appearanceVersion() {
  let stamp = 0;
  for (const file of [APPEARANCE_FILE, BACKGROUND_FILE, BACKGROUND_CSS_FILE]) {
    try {
      stamp = Math.max(stamp, fs.statSync(file).mtimeMs);
    } catch {
      /* ignore missing files */
    }
  }
  return stamp ? Math.floor(stamp) : 0;
}

function handleBackgroundRoute(req, res) {
  // req.url can be either a relative path ("/__dsh-background?v=...")
  // or an absolute URI ("http://host:port/__dsh-background?v=...") when the
  // request arrives through an HTTP proxy (Chrome's CDP-issued fetch / image
  // preload / css url() resolution). Strip both forms down to a clean pathname
  // before matching, otherwise the handler silently misses and the request
  // falls through to upstream DSH which 404s.
  let pathname;
  try {
    pathname = new URL(req.url, "http://dsh.invalid").pathname;
  } catch {
    pathname = String(req.url || "").split("?")[0];
  }
  if (pathname !== BACKGROUND_ROUTE) return false;
  try {
    const stat = fs.statSync(BACKGROUND_FILE);
    if (!stat.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "content-type": backgroundMime(BACKGROUND_FILE),
      "content-length": stat.size,
      "cache-control": "public, max-age=300",
      etag: `"${stat.size}-${Math.floor(stat.mtimeMs)}"`,
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(BACKGROUND_FILE)
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("background image not available");
    return true;
  }
}

// A tiny floating panel in the bottom-right corner of the main page. It never
// re-implements the colour maths: it only rebuilds the href of the stylesheet
// link, so the server stays the single source of truth.
function appearancePanelScript() {
  const lines = [
    "(function(){",
    "if(window.__dshuPanel)return;window.__dshuPanel=1;",
    "var C=" + JSON.stringify(loadAppearance()) + ",D=" + JSON.stringify(DEFAULT_APPEARANCE) + ";",
    "var SAVED=JSON.parse(JSON.stringify(C));",
    "var FIELDS=[",
    " {k:'surface',t:'整体不透明度',min:0,max:1,step:0.01,u:'pct',adv:0},",
    " {k:'container',t:'侧栏/面板不透明度',min:0,max:1,step:0.01,u:'pct',adv:0},",
    " {k:'blur',t:'毛玻璃模糊',min:0,max:24,step:1,u:'px',adv:0},",
    " {k:'subtle',t:'次级（悬停/滚动条）',min:0,max:1,step:0.01,u:'pct',adv:1},",
    " {k:'blurMain',t:'配置页模糊',min:0,max:24,step:1,u:'px',adv:1},",
    " {k:'blurInput',t:'配置页输入框模糊',min:0,max:24,step:1,u:'px',adv:1},",
    " {k:'panelAlpha',t:'配置页底色',min:0,max:1,step:0.01,u:'pct',adv:1},",
    " {k:'inputAlpha',t:'配置页输入框底色',min:0,max:1,step:0.01,u:'pct',adv:1},",
    " {k:'dim',t:'壁纸压暗',min:0,max:0.9,step:0.05,u:'num',adv:1}",
    "];",
    // [value, 中文标签]
    "var SIZES=[['cover','铺满（裁剪）'],['contain','完整显示'],['100% 100%','拉伸铺满'],['auto','原始尺寸']],POSES=[['center','居中'],['top','顶部'],['bottom','底部'],['left','左侧'],['right','右侧'],['top left','左上'],['top right','右上']];",
    // The script is injected before </head>, so document.body may not exist yet.
    "function boot(){",
    "if(window.__dshuBooted)return;window.__dshuBooted=1;",
    "var st=document.createElement('style');",
    // Colours come from the same --dsw-* tokens the app uses, so the launcher
    // and the panel pick up whatever translucency the theme/wallpaper has and
    // follow light/dark automatically. Literal values are only fallbacks for
    // when the theme has not been applied yet.
    "st.textContent='#dshu-wrap{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:13px/1.5 -apple-system,BlinkMacSystemFont,\"Segoe UI\",system-ui,sans-serif;color:var(--dsw-alias-label-primary,#1f2328)}'" +
      "+'#dshu-wrap *{box-sizing:border-box}'" +
      "+'#dshu-btn{width:40px;height:40px;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.82));-webkit-backdrop-filter:blur(16px) saturate(1.08);backdrop-filter:blur(16px) saturate(1.08);box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer;color:inherit;display:flex;align-items:center;justify-content:center;margin-left:auto}'" +
      "+'#dshu-wrap.open #dshu-btn{display:none}'" +
      "+'#dshu-wrap #dshu-btn svg{width:20px;height:20px;display:block}'" +
      "+'#dshu-panel{display:none;width:290px;max-height:74vh;overflow:auto;margin-top:8px;padding:14px;border-radius:14px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.88));-webkit-backdrop-filter:blur(20px) saturate(1.08);backdrop-filter:blur(20px) saturate(1.08);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 10px 36px rgba(0,0,0,.2)}'" +
      "+'#dshu-panel.open{display:block}'" +
      "+'#dshu-head{display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:10px}'" +
      "+'#dshu-close{cursor:pointer;opacity:.6;padding:0 4px}'" +
      "+'.dshu-row{margin:0 0 10px}'" +
      "+'.dshu-labs{display:flex;justify-content:space-between;font-size:12px;opacity:.85;margin-bottom:2px}'" +
      "+'#dshu-wrap input[type=range]{width:100%;margin:0}'" +
      "+'#dshu-wrap select{width:100%;padding:4px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.9));color:inherit;font:inherit}'" +
      "+'#dshu-sel{margin:6px 0 10px}'" +
      "+'#dshu-sel label{display:block;font-size:12px;opacity:.85;margin:6px 0 2px}'" +
      "+'#dshu-ops{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}'" +
      "+'#dshu-ops button{flex:1 1 44%;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.9));color:inherit;cursor:pointer;font:inherit}'" +
      "+'#dshu-ops button.p{background:#0969da;color:#fff;border-color:#0969da}'" +
      "+'#dshu-adv{margin-top:8px}'" +
      "+'#dshu-adv-toggle{font-size:12px;opacity:.7;cursor:pointer;margin:8px 0 6px;display:inline-block}'" +
      "+'#dshu-msg{font-size:12px;opacity:.8;margin-top:8px;min-height:16px}'" +
      "+'#dshu-file{display:none}';",
    "document.head.appendChild(st);",
    "var wrap=document.createElement('div');wrap.id='dshu-wrap';",
    "wrap.innerHTML='<button id=\"dshu-btn\" type=\"button\" title=\"外观设置\" aria-label=\"外观设置\">'" +
      "+'<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">'" +
      "+'<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"></rect>'" +
      "+'<circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"></circle>'" +
      "+'<polyline points=\"21 15 16 10 5 21\"></polyline>'" +
      "+'</svg></button>'" +
      "+'<div id=\"dshu-panel\">'" +
      "+'<div id=\"dshu-head\"><span>外观设置</span><span id=\"dshu-close\">×</span></div>'" +
      "+'<label id=\"dshu-on\"><input type=\"checkbox\" id=\"dshu-enabled\"> 启用背景图</label>'" +
      "+'<div id=\"dshu-basic\"></div>'" +
      "+'<span id=\"dshu-adv-toggle\">▸ 高级</span>'" +
      "+'<div id=\"dshu-adv\" style=\"display:none\"></div>'" +
      "+'<div id=\"dshu-sel\"></div>'" +
      "+'<div id=\"dshu-ops\">'" +
      "+'<button id=\"dshu-save\" class=\"p\">保存</button>'" +
      "+'<button id=\"dshu-revert\">还原</button>'" +
      "+'<button id=\"dshu-reset\">重置</button>'" +
      "+'<button id=\"dshu-pick\">换图</button>'" +
      "+'</div><div id=\"dshu-msg\"></div>'" +
      "+'<input type=\"file\" id=\"dshu-file\" accept=\"image/*\">'" +
      "+'</div>';",
    "document.body.appendChild(wrap);",
    "var link=document.getElementById('dsh-background');",
    "var panel=wrap.querySelector('#dshu-panel'),msg=wrap.querySelector('#dshu-msg');",
    "function fmt(v,u){if(u==='pct')return Math.round(v*100)+'%';if(u==='px')return v+'px';return (Math.round(v*100)/100).toFixed(2)}",
    "function row(f,host){",
    " var d=document.createElement('div');d.className='dshu-row';",
    " d.innerHTML='<div class=\"dshu-labs\"><span>'+f.t+'</span><span></span></div>'" +
      "+'<input type=\"range\" min=\"'+f.min+'\" max=\"'+f.max+'\" step=\"'+f.step+'\" value=\"'+C[f.k]+'\">';",
    " var out=d.querySelector('.dshu-labs span:last-child');out.textContent=fmt(C[f.k],f.u);",
    " var r=d.querySelector('input');",
    " r.oninput=function(){C[f.k]=parseFloat(r.value);out.textContent=fmt(C[f.k],f.u);deb()};",
    " host.appendChild(d);",
    "}",
    "function build(){",
    " var b=wrap.querySelector('#dshu-basic'),a=wrap.querySelector('#dshu-adv');",
    " b.innerHTML='';a.innerHTML='';",
    " for(var i=0;i<FIELDS.length;i++){row(FIELDS[i],FIELDS[i].adv?a:b)}",
    " var sel=wrap.querySelector('#dshu-sel');",
    " sel.innerHTML='<label>填充方式<select id=\"dshu-size\"></select></label><label>位置<select id=\"dshu-pos\"></select></label>';",
    " var ss=sel.querySelector('#dshu-size'),sp=sel.querySelector('#dshu-pos');",
    " SIZES.forEach(function(v){var o=document.createElement('option');o.value=v[0];o.textContent=v[1];ss.appendChild(o)});",
    " POSES.forEach(function(v){var o=document.createElement('option');o.value=v[0];o.textContent=v[1];sp.appendChild(o)});",
    " ss.value=C.size;sp.value=C.position;",
    " ss.onchange=function(){C.size=ss.value;deb()};",
    " sp.onchange=function(){C.position=sp.value;deb()};",
    " wrap.querySelector('#dshu-enabled').checked=!!C.enabled;",
    "}",
    "var timer=null;",
    "function deb(){clearTimeout(timer);timer=setTimeout(apply,120)}",
    "function apply(){if(!link)return;var p=[];for(var k in C){p.push(k+'='+encodeURIComponent(C[k]))}link.href='/__dsh-appearance.css?'+p.join('&')+'&t='+Date.now();say('未保存 —— 满意后点「保存」')}",
    "function say(t){msg.textContent=t||''}",
    "function setOpen(v){panel.classList.toggle('open',v);wrap.classList.toggle('open',v);try{localStorage.setItem('dshu-open',v?'1':'0')}catch(e){}}",
    // Only the landing page keeps the launcher, and never while a dialog or
    // overlay is on top of it.
    "function shouldShow(){",
    " if(panel.classList.contains('open'))return true;",
    " var p=location.pathname||'/';",
    " if(p!=='/'&&p!=='/index.html')return false;",
    " if(document.querySelector('[role=\"dialog\"],[role=\"alertdialog\"],[class*=\"mask\"],[class*=\"Mask\"],[class*=\"modal\"],[class*=\"Modal\"]'))return false;",
    " return true;",
    "}",
    "var syncTimer=null;",
    "function syncVisibility(){clearTimeout(syncTimer);syncTimer=setTimeout(function(){wrap.style.display=shouldShow()?'':'none'},80)}",
    "new MutationObserver(syncVisibility).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','role','style']});",
    "window.addEventListener('popstate',syncVisibility);",
    "syncVisibility();",
    "build();",
    "wrap.querySelector('#dshu-btn').onclick=function(){setOpen(true)};",
    "wrap.querySelector('#dshu-close').onclick=function(){setOpen(false)};",
    "wrap.querySelector('#dshu-adv-toggle').onclick=function(){var a=wrap.querySelector('#dshu-adv');var open=a.style.display==='none';a.style.display=open?'block':'none';this.textContent=(open?'▾':'▸')+' 高级'};",
    "wrap.querySelector('#dshu-enabled').onchange=function(){C.enabled=this.checked;apply()};",
    "wrap.querySelector('#dshu-save').onclick=function(){",
    " say('保存中...');",
    " fetch('/__dsh-appearance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(C)})",
    "  .then(function(r){return r.json().then(function(j){return {s:r.status,j:j}})})",
    "  .then(function(o){if(o.j.ok){SAVED=JSON.parse(JSON.stringify(C));say('已保存')}else{say(o.s===401?'请先登录后再保存':'保存失败：'+(o.j.error||''))}})",
    "  .catch(function(e){say('保存失败：'+e.message)});",
    "};",
    "wrap.querySelector('#dshu-revert').onclick=function(){C=JSON.parse(JSON.stringify(SAVED));build();apply();say('已还原')};",
    "wrap.querySelector('#dshu-reset').onclick=function(){C=JSON.parse(JSON.stringify(D));build();apply();say('已重置为默认，记得保存')};",
    "var file=wrap.querySelector('#dshu-file');",
    "wrap.querySelector('#dshu-pick').onclick=function(){file.click()};",
    "file.onchange=function(){",
    " var f=file.files&&file.files[0];if(!f)return;",
    " say('上传中...');",
    " fetch('/__dsh-appearance/background',{method:'POST',headers:{'content-type':f.type||'image/jpeg'},body:f})",
    "  .then(function(r){return r.json().then(function(j){return {s:r.status,j:j}})})",
    "  .then(function(o){if(o.j.ok){apply();say('背景已更换')}else{say(o.s===401?'请先登录后再保存':'上传失败：'+(o.j.error||''))}})",
    "  .catch(function(e){say('上传失败：'+e.message)});",
    " file.value='';",
    "};",
    "try{if(localStorage.getItem('dshu-open')==='1')setOpen(true)}catch(e){}",
    "};",
    "if(document.body&&document.body.nodeName){boot()}else{document.addEventListener('DOMContentLoaded',boot)}",
    "})()",
  ].join("");
  return `<script id="dshu-panel-script">${lines}</script>`;
}

async function handleAppearanceRoute(req, res) {
  // Same absolute-URI caveat as handleBackgroundRoute — see comment there.
  let rawPath, search;
  try {
    const u = new URL(req.url, "http://dsh.invalid");
    rawPath = u.pathname;
    search = u.search.startsWith("?") ? u.search.slice(1) : "";
  } catch {
    [rawPath, search] = String(req.url || "").split("?");
  }
  const pathname = rawPath || "";
  if (pathname === APPEARANCE_CSS_ROUTE) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const params = new URLSearchParams(search || "");
    const css = renderAppearanceCss(params.toString() ? appearanceFromQuery(params) : loadAppearance());
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : css);
    return true;
  }
  if (pathname !== APPEARANCE_ROUTE && pathname !== APPEARANCE_UPLOAD_ROUTE) return false;

  if (pathname === APPEARANCE_ROUTE && req.method === "GET") {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, config: loadAppearance(), defaults: DEFAULT_APPEARANCE }));
    return true;
  }

  if (pathname === APPEARANCE_ROUTE && req.method === "POST") {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }
    try {
      const parsed = JSON.parse(await readRequestBody(req));
      const next = sanitizeAppearance(parsed && typeof parsed === "object" ? parsed : {});
      writeAtomic(APPEARANCE_FILE, JSON.stringify(next, null, 2) + "\n", false);
      console.log("[DSH-Proxy] 外观配置已更新");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, config: next }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return true;
  }

  if (pathname === APPEARANCE_UPLOAD_ROUTE && req.method === "POST") {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }
    try {
      const body = await readBodyBuffer(req, MAX_BACKGROUND_BYTES);
      if (!body || body.length < 8) throw new Error("empty upload");
      if (!looksLikeImage(body)) throw new Error("unsupported image format");
      writeAtomic(BACKGROUND_FILE, body, true);
      console.log("[DSH-Proxy] 背景图已更新：" + BACKGROUND_FILE);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, bytes: body.length }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return true;
  }
  return false;
}

function tryLogin(token) {
  if (!token) return;
  const req = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: "/?token=" + encodeURIComponent(token),
    method: "GET",
    headers: { host: TARGET_HOST + ":" + TARGET_PORT },
  }, (res) => {
    const sc = res.headers["set-cookie"];
    if (sc && sc.length > 0) {
      activeCookie = sc[0].split(";")[0];
      console.log("[DSH-Proxy] 自动激活 Cookie 成功");
    }
    res.resume();
  });
  req.on("error", () => {});
  req.end();
}

function buildHeaders(req) {
  const headers = { ...req.headers };
  headers.host = TARGET_HOST + ":" + TARGET_PORT;
  // Ask the upstream for an uncompressed HTML body so the title can be fixed safely.
  delete headers["accept-encoding"];
  if (headers.origin) headers.origin = "http://" + TARGET_HOST + ":" + TARGET_PORT;
  if (headers.referer) headers.referer = "http://" + TARGET_HOST + ":" + TARGET_PORT + "/";
  delete headers["sec-fetch-site"];
  if (activeCookie && (!headers.cookie || !headers.cookie.includes("dsh-auth-"))) {
    headers.cookie = headers.cookie ? headers.cookie + "; " + activeCookie : activeCookie;
  }
  return headers;
}

function rewriteHtml(body, req) {
  const text = body.toString("utf8");
  const bridge = `<script>(function(){document.title="${PUBLIC_TITLE}";new MutationObserver(function(){if(document.title!=="${PUBLIC_TITLE}")document.title="${PUBLIC_TITLE}"}).observe(document.querySelector("head")||document.documentElement,{subtree:true,childList:true,characterData:true});document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("button"):null;if(!b)return;var t=(b.innerText||b.textContent||"").trim();if(t.indexOf("打开配置文件")>=0||/open\\s+config/i.test(t)){e.preventDefault();e.stopImmediatePropagation();location.assign("/__dsh-config");}},true)})()</script>`;
  let rewritten = text.replace(/<title>[^<]*<\/title>/i, `<title>${PUBLIC_TITLE}</title>`);
  if (!/<title>[^<]*<\/title>/i.test(text)) rewritten = rewritten.replace(/<head[^>]*>/i, (head) => `${head}<title>${PUBLIC_TITLE}</title>`);
  if (/<\/head>/i.test(rewritten) && !rewritten.includes("/__dsh-config")) {
    const pathname = String((req && req.url) || "/").split("?")[0];
    // Keyed off the app shell rather than the exact path, so the panel still
    // shows up if upstream ever serves the UI from a nested route.
    const isMainPage = pathname === "/" || pathname === "/index.html" || /<div[^>]+id=["']root["']/i.test(rewritten);
    const link = `<link id="dsh-background" rel="stylesheet" href="${APPEARANCE_CSS_ROUTE}?v=${appearanceVersion()}">`;
    const panel = isMainPage ? appearancePanelScript() : "";
    rewritten = rewritten.replace(/<\/head>/i, `${link}${bridge}${panel}</head>`);
  }
  return Buffer.from(rewritten);
}

function isAuthorized(req) {
  const cookie = String(req.headers.cookie || "");
  return Boolean(activeCookie && cookie.includes(activeCookie)) || cookie.split(";").some((item) => item.trim().startsWith("dsh-auth-"));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" })[char]);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_CONFIG_BYTES) {
        req.destroy(new Error("configuration is too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendConfigPage(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("请先在 DeepSeek Harness WebUI 中完成登录。");
    return;
  }
  let content = "";
  let error = "";
  try { content = fs.readFileSync(CONFIG_FILE, "utf8"); } catch (err) { error = err.message; }
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek Harness 配置</title><style>body{font:14px system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1f2328}main{max-width:1100px;margin:24px auto;padding:20px;background:#fff;border:1px solid #d0d7de;border-radius:12px}textarea{width:100%;min-height:65vh;box-sizing:border-box;font:13px ui-monospace,monospace;padding:12px;border:1px solid #8c959f;border-radius:8px}button{padding:8px 16px;border:1px solid #8c959f;border-radius:8px;background:#fff;cursor:pointer}button.primary{background:#0969da;color:#fff;border-color:#0969da}.bar{display:flex;gap:10px;align-items:center;margin:12px 0}.muted{color:#656d76}.error{color:#cf222e;white-space:pre-wrap}</style>${buildBackgroundCss()}</head><body><main><h1>DeepSeek Harness 配置</h1><p class="muted">浏览器编辑回退：${escapeHtml(CONFIG_FILE)}。保存前会自动创建 .bak 备份。</p>${error ? `<p class="error">无法读取配置文件：${escapeHtml(error)}</p>` : ""}<textarea id="config" spellcheck="false">${escapeHtml(content)}</textarea><div class="bar"><button class="primary" id="save">保存配置</button><button id="back">返回 WebUI</button><span id="status" class="muted"></span></div></main><script>const status=document.getElementById("status");document.getElementById("back").onclick=()=>location.assign("/");document.getElementById("save").onclick=async()=>{status.textContent="保存中...";try{const r=await fetch("/__dsh-config",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:document.getElementById("config").value})});const j=await r.json();status.textContent=j.ok?"已保存，重启容器后生效":(j.error||"保存失败")}catch(e){status.textContent="保存失败："+e.message}};</script></body></html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function handleConfigRoute(req, res) {
  // See handleBackgroundRoute for why we can't trust raw req.url.
  let pathname = req.url;
  try { pathname = new URL(req.url, "http://dsh.invalid").pathname; } catch {}
  if (pathname !== "/__dsh-config") return false;
  if (req.method === "GET") { sendConfigPage(req, res); return true; }
  if (req.method === "POST") {
    if (!isAuthorized(req)) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "unauthorized" })); return true; }
    try {
      const parsed = JSON.parse(await readRequestBody(req));
      if (typeof parsed.content !== "string" || Buffer.byteLength(parsed.content, "utf8") > MAX_CONFIG_BYTES) throw new Error("invalid configuration content");
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak-${Date.now()}`);
      const temporary = `${CONFIG_FILE}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, parsed.content, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, CONFIG_FILE);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ ok: true }));
    } catch (err) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: err.message })); }
    return true;
  }
  return false;
}

function forwardResponse(req, res, proxyRes) {
  const headers = { ...proxyRes.headers };
  if (headers["set-cookie"] && Array.isArray(headers["set-cookie"]) && headers["set-cookie"].length > 0) {
    activeCookie = headers["set-cookie"][0].split(";")[0];
  }

  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (contentType.includes("text/html") && req.method !== "HEAD") {
    const chunks = [];
    proxyRes.on("data", (chunk) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = rewriteHtml(Buffer.concat(chunks), req);
      delete headers["content-length"];
      delete headers.etag;
      res.writeHead(proxyRes.statusCode || 502, headers);
      res.end(body);
    });
    proxyRes.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    return;
  }

  res.writeHead(proxyRes.statusCode || 502, headers);
  proxyRes.pipe(res, { end: true });
}

const server = http.createServer(async (req, res) => {
  if (handleBackgroundRoute(req, res)) return;
  if (await handleAppearanceRoute(req, res)) return;
  if (await handleConfigRoute(req, res)) return;
  let urlObj;
  try {
    urlObj = new URL(req.url, "http://" + TARGET_HOST + ":" + PORT);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  const qToken = urlObj.searchParams.get("token");
  if (qToken) tryLogin(qToken);

  const proxyReq = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: buildHeaders(req),
  }, (proxyRes) => forwardResponse(req, res, proxyRes));

  const fail = (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("DeepSeek Harness 服务正在启动或连接已重置，请稍候刷新。" + (err?.message ? ` (${err.message})` : ""));
    }
  };
  proxyReq.on("error", fail);
  req.on("aborted", () => proxyReq.destroy());
  req.on("error", () => proxyReq.destroy());
  res.on("close", () => {
    if (!res.writableEnded) proxyReq.destroy();
  });
  req.pipe(proxyReq, { end: true });
});

server.on("upgrade", (req, socket, head) => {
  const proxyReq = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: buildHeaders(req),
  });
  const closeBoth = () => {
    socket.destroy();
    proxyReq.destroy();
  };
  socket.on("error", closeBoth);
  proxyReq.on("error", closeBoth);
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" +
      Object.keys(proxyRes.headers).map((h) => `${h}: ${proxyRes.headers[h]}`).join("\r\n") +
      "\r\n\r\n");
    if (proxyHead?.length) socket.write(proxyHead);
    if (head?.length) proxySocket.write(head);
    proxySocket.on("error", closeBoth);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.end();
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[DSH-Proxy] 监听 0.0.0.0:${PORT} -> ${TARGET_PORT}`);
});
