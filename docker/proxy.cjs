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

function renderAppearanceCss(cfg) {
  // An explicitly configured file still fully replaces the stylesheet.
  const explicit = (process.env.DSH_BACKGROUND_CSS || "").trim();
  if (explicit) return readCssFile(explicit);

  const base = sanitizeAppearance(cfg);
  if (!base.enabled) return "";
  const background = resolveBackground();
  if (!background) return "";

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
    // Conversation / answer blocks: card-like, inset from both sides, rounded,
    // using the same surface token as the rest of the workspace.
    // "_markdown_1wejo_*" is the file-type icon for .md files (it sits next to
    // _code_/_excel_/_pdf_ and only sets a colour variable), so icon elements
    // must be excluded or every .md file chip would get a card around it.
    `[class*="markdown"]:not([class*="icon"]):not([class*="Icon"]),[class*="Markdown"]:not([class*="icon"]):not([class*="Icon"]){background-color:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.5)) !important;border-radius:16px !important;margin-left:8px !important;margin-right:8px !important;padding:10px 12px !important;}`,
    // Message column container: it's the rectangular layer-1 background behind
    // every conversation card. Round its corners and align its width to the
    // composer input card (712px) so cards + input share one width.
    `[class*="column_4SmsrG"],[class*="Column_4SmsrG"]{border-radius:22px !important;width:712px !important;max-width:712px !important;}`,
  ].join("");
  // A background.css dropped next to the image is still appended last, so
  // hand-written tweaks keep winning over the panel.
  return rules + readCssFile(BACKGROUND_CSS_FILE);
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
  const pathname = String(req.url || "").split("?")[0];
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
  const [rawPath, search] = String(req.url || "").split("?");
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
  if (req.url === "/__dsh-config" && req.method === "GET") { sendConfigPage(req, res); return true; }
  if (req.url === "/__dsh-config" && req.method === "POST") {
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
