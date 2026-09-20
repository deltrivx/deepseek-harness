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

// ---------------------------------------------------------------------------
// 外观（背景）引擎 —— 纯装饰层，几何零影响
//
// 硬性约束（由 paintRule() 在生成期强制校验，违反直接抛错）：
//
//   1. 应用元素上只允许改颜色类属性。padding / margin / width / max-width /
//      height / flex / grid / display / overflow / box-sizing / font-size /
//      position / z-index 一律禁止 —— 这些正是上一版把移动端布局彻底搞坏的
//      元凶（logo 被拉伸到满屏、composer 卡片溢出视口、文字被裁切）。
//
//   2. 应用元素上禁止 backdrop-filter / filter。二者会让元素成为「绝对定位与
//      固定定位后代的包含块」，并把它升级为层叠上下文 —— 上游大量布局由 JS
//      测量后写成内联样式，包含块一变，侧栏宽度、弹层位置就会跟着变。这是
//      「不开背景一切正常、一开背景布局全乱」的直接原因。
//
//   3. 不使用 `body *` 这类全量选择器。实测主题变量直接定义在 body 的样式规则
//      里（并非 inline style），后代用 var() 自然继承，逐个元素重新推导既不
//      必要、又会把作用范围放大到整棵 DOM。
//
//   4. 壁纸放在自己的 html::before 图层里（position:fixed + z-index:-1）。
//      它不参与应用布局：柔化与压暗都作用在这一层上，界面元素完全不受影响。
//
// 因此「关闭壁纸 + 关闭圆角」时输出为空字符串 —— 与官方镜像表现完全一致。
// ---------------------------------------------------------------------------

// 颜色类属性白名单：应用元素唯一允许改动的集合
const PAINT_PROPERTIES = new Set([
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-attachment",
  "border-radius",
  "border-color",
  "box-shadow",
  "color",
  "outline-color",
  "text-shadow",
  "mix-blend-mode",
]);

// 壁纸图层专用白名单：只有我们自己的 html::before 允许使用几何属性
const LAYER_PROPERTIES = new Set([
  "content",
  "position",
  "inset",
  "z-index",
  "pointer-events",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-attachment",
  "filter",
  "-webkit-filter",
  "transform",
]);

// 移动端布局层白名单 —— 唯一允许改几何属性、且**必须**整体包在小屏媒体查询里的轨道。
// 与外观无关：外观永远不许碰几何；这里改几何是因为上游在窄屏下确实排不下。
const MOBILE_PROPERTIES = new Set([
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  // 抽屉需要脱离网格流并贴住视口边缘；这些只在 ≤560px 的媒体查询里生效。
  "position",
  "top",
  "bottom",
  "left",
  "right",
  "z-index",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "margin",
  "margin-left",
  "margin-right",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "line-height",
  "overflow",
  "overflow-x",
  "overflow-y",
  "overscroll-behavior",
  "flex",
  "flex-direction",
  "display",
  "align-items",
  "visibility",
  "opacity",
  // 抽屉必须是不透明表面：它是浮在正文之上的浮层，若沿用桌面那种半透明
  // 「表面令牌」，背后的会话文字会直接透上来，两层字叠在一起无法阅读。
  // 颜色与 pointer-events 都不改变任何盒模型尺寸，几何中性。
  "background",
  "background-color",
  "box-shadow",
  "pointer-events",
]);

function assertAllowed(decls, allowed, where, kind) {
  for (const name of Object.keys(decls)) {
    if (!allowed.has(String(name).toLowerCase())) {
      throw new Error(
        `[DSH-Proxy] 外观样式违规：${where} 试图使用非${kind}属性 "${name}"。` +
        `外观功能只允许改颜色与背景，任何几何属性都会破坏原生布局。`
      );
    }
  }
}

function declarations(decls) {
  return Object.entries(decls).map(([name, value]) => `${name}:${value} !important`).join(";");
}

// 应用元素：只允许颜色类声明
function paintRule(selector, decls) {
  assertAllowed(decls, PAINT_PROPERTIES, selector, "颜色类");
  return `${selector}{${declarations(decls)}}`;
}

// 壁纸图层：允许几何属性（该图层本身不参与应用布局）
function layerRule(selector, decls) {
  assertAllowed(decls, LAYER_PROPERTIES, selector, "图层类");
  return `${selector}{${declarations(decls)}}`;
}

// 移动端布局：允许几何属性，但调用方必须整体包在媒体查询里。
// mobileRule 只做校验，不带媒体查询 —— 由 mobileMedia() 负责包裹，避免漏包。
function mobileRule(selector, decls) {
  assertAllowed(decls, MOBILE_PROPERTIES, selector, "移动端布局类");
  return `${selector}{${declarations(decls)}}`;
}

// 把若干移动端规则整体包进媒体查询。max-width 是唯一入口，防止某条规则
// 忘记加断点而泄漏到桌面端 —— 那是「不要动 PC 端」这条硬约束的代码级保证。
function mobileMedia(query, rules) {
  const body = rules.filter(Boolean).join("");
  if (!body) return "";
  return `@media ${query}{${body}}`;
}

// 单一事实来源：面板、接口与样式表全部读它。
// 字段沿用既有 appearance.json，v1 的 subtle / blurMain / blurInput 已废弃，
// sanitize 时会被自动丢弃（不需要单独的迁移步骤）。
const DEFAULT_APPEARANCE = {
  enabled: true,
  rounded: true,
  surface: 0.35,
  container: 0.45,
  blur: 0,
  dim: 0,
  size: "cover",
  position: "center",
  panelAlpha: 0.14,
  inputAlpha: 0.05,
};
const APPEARANCE_BOOLEANS = ["enabled", "rounded"];
const APPEARANCE_NUMBERS = {
  surface: [0, 1],
  container: [0, 1],
  panelAlpha: [0, 1],
  inputAlpha: [0, 1],
  dim: [0, 0.9],
  blur: [0, 40],
};
const APPEARANCE_SIZES = ["cover", "contain", "100% 100%", "auto"];
const APPEARANCE_POSITIONS = ["center", "top", "bottom", "left", "right", "top left", "top right"];


let activeCookie = "";


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
  // 只有注释的文件视同空文件：否则用户把 background.css 清成注释后，
  // 关闭全部外观仍会注入一个 <style> 标签，「零注入」的保证就破了。
  try {
    const css = fs.readFileSync(file, "utf8");
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    return body ? css : "";
  } catch {
    return "";
  }
}

function appearanceFromEnv() {
  // 环境变量仍是零配置路径；一旦存在 appearance.json，则以它为准（面板是权威）。
  const cfg = { ...DEFAULT_APPEARANCE };
  const layerAlpha = Number.parseFloat(BACKGROUND_LAYER_ALPHA);
  if (Number.isFinite(layerAlpha)) {
    cfg.surface = Math.min(1, Math.max(0, layerAlpha));
    cfg.container = Math.min(1, Math.max(0, layerAlpha));
  }
  const dim = Number.parseFloat(BACKGROUND_DIM);
  if (Number.isFinite(dim)) cfg.dim = Math.min(0.9, Math.max(0, dim));
  const blur = Number.parseFloat(BACKGROUND_BLUR);
  if (Number.isFinite(blur) && blur > 0) cfg.blur = Math.min(40, blur);
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
    // 还没有保存过：用环境变量 / 内置默认值。
  }
  return cfg;
}

function sanitizeAppearance(input) {
  const cfg = { ...DEFAULT_APPEARANCE };
  for (const key of APPEARANCE_BOOLEANS) {
    if (typeof input[key] === "boolean") cfg[key] = input[key];
  }
  for (const key of Object.keys(APPEARANCE_NUMBERS)) {
    const [min, max] = APPEARANCE_NUMBERS[key];
    const parsed = Number.parseFloat(input[key]);
    if (Number.isFinite(parsed)) cfg[key] = Math.min(max, Math.max(min, parsed));
  }
  if (APPEARANCE_SIZES.includes(String(input.size))) cfg.size = String(input.size);
  if (APPEARANCE_POSITIONS.includes(String(input.position))) cfg.position = String(input.position);

  // v1 的 surface / container 与现在的语义不同：v1 的 container 是「面板透明度」，
  // 数值越小面板越透（实测存下来的 0.14 会把侧栏压得几乎看不见）。
  // 检测到 v1 遗留字段时把这两个透明度恢复为默认值，否则升级后界面直接不可读。
  // 其余字段（enabled / blur / dim / size / position）语义未变，继续沿用。
  const isLegacyV1 = ["subtle", "blurMain", "blurInput"].some((key) => key in input);
  if (isLegacyV1) {
    cfg.surface = DEFAULT_APPEARANCE.surface;
    cfg.container = DEFAULT_APPEARANCE.container;
  }

  // 未在白名单里的历史字段（subtle / blurMain / blurInput 等）在此自然丢弃。
  return cfg;
}

function appearanceFromQuery(params) {
  const patch = {};
  for (const key of Object.keys(DEFAULT_APPEARANCE)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    if (APPEARANCE_BOOLEANS.includes(key)) patch[key] = raw === "true" || raw === "1";
    else if (key === "size" || key === "position") patch[key] = raw;
    else patch[key] = Number.parseFloat(raw);
  }
  return sanitizeAppearance({ ...loadAppearance(), ...patch });
}

// ---------------------------------------------------------------------------
// 样式表组装（2026-09-20 重写）
//
// 上一版把「布局补丁」与「背景」混在一起：LAYOUT_FIX_CSS 里有 padding /
// width:774px / max-width:100% / min-height:44px / font-size:16px 等大量几何
// 规则，而且**无条件注入**，连关掉背景也照样生效 —— 移动端 logo 被拉伸到满屏、
// composer 卡片溢出视口、文字被裁切，都是它造成的。
//
// 现在只组装三类内容，且各自都有硬护栏：
//   roundedCss()   圆角层：只声明 border-radius，不碰任何尺寸与间距。
//   tokenCss()     表面层：只覆写「颜色类设计令牌」，让壁纸透出来。
//   wallpaperCss() 壁纸层：html::before 独立图层，几何属性只允许出现在这里。
//
// 关闭壁纸且关闭圆角 ⇒ 返回空字符串 ⇒ 与官方镜像表现完全一致。
// ---------------------------------------------------------------------------

// 表面层不再靠类名猜元素。实测 app 是令牌驱动的：遮挡壁纸的每个大块
// （侧栏 root、内容卡片、主外壳）底色都直接来自下面这些令牌，
// 由 body 继承下发。按类名做匹配则会漏（例如侧栏的容器类叫
// `u5VEBa_root u5VEBa_quietBars`，既不以 _root 结尾也不含 sidebar），
// 而且上游一旦改哈希前缀就全失效。改令牌则一次到位、且对未来的新组件同样生效。
//
// alpha 决定用面板上的哪个滑杆：surface=主体外壳，container=侧栏/菜单/气泡。
// fallback 用于令牌本身为空时（不同主题/上游版本可能没定义）：
// 回落到更基础的令牌，保证 color-mix 永远拿到一个合法颜色，
// 否则该令牌会变成「无效值」，反而让元素失去底色。
const SOFTEN_TOKENS = [
  { token: "--dsw-alias-bg-base", snap: "--dsh-snap-bg-base", alpha: "surface", fallback: "#151517" },
  { token: "--dsw-alias-bg-l1", snap: "--dsh-snap-bg-l1", alpha: "surface", fallback: "--dsh-snap-bg-base" },
  { token: "--dsw-alias-bg-l2", snap: "--dsh-snap-bg-l2", alpha: "surface", fallback: "--dsh-snap-bg-base" },
  { token: "--dsw-alias-bg-layer-1", snap: "--dsh-snap-bg-layer-1", alpha: "surface", fallback: "--dsh-snap-bg-base" },
  { token: "--dsw-alias-bg-layer-2", snap: "--dsh-snap-bg-layer-2", alpha: "container", fallback: "--dsh-snap-bg-base" },
  { token: "--dsw-specific-sidebar-fill", snap: "--dsh-snap-sidebar-fill", alpha: "container", fallback: "--dsh-snap-bg-base" },
  { token: "--dsw-specific-menu", snap: "--dsh-snap-menu", alpha: "container", fallback: "--dsh-snap-bg-base" },
  { token: "--dsw-specific-bubble", snap: "--dsh-snap-bubble", alpha: "container", fallback: "--dsh-snap-bg-base" },
];

const SNAPSHOT_NAMES = new Set(SOFTEN_TOKENS.map((item) => item.snap));
const SOFTEN_NAMES = new Set(SOFTEN_TOKENS.map((item) => item.token));

/** 令牌轨道的护栏：只允许上面列出的自定义属性，别的一律抛错。 */
function tokenRule(selector, decls, allowed, important) {
  for (const name of Object.keys(decls)) {
    if (!allowed.has(name)) {
      throw new Error(
        `[DSH-Proxy] 外观样式违规：${selector} 试图改动未列入白名单的自定义属性 "${name}"。` +
        `表面层只允许覆写颜色类设计令牌。`
      );
    }
  }
  const body = Object.entries(decls)
    .map(([name, value]) => `${name}:${value}${important ? " !important" : ""}`)
    .join(";");
  return `${selector}{${body}}`;
}

function clampUnitPercent(value) {
  const parsed = Number.parseFloat(value);
  const unit = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
  return Math.round(unit * 100);
}

function roundedCss() {
  // 只声明圆角。圆角是纯视觉裁剪，不改变盒模型尺寸，因此完全不影响布局。
  // 上一版配套的 padding / width / margin / box-sizing 全部移除 —— 那才是
  // 「面板圆角」变成「面板错位」的原因。
  return [
    paintRule('[class*="_column"],[class*="Column"]', { "border-radius": "22px" }),
    paintRule('[class*="markdown"]:not([class*="icon"]):not([class*="Icon"]),[class*="Markdown"]:not([class*="icon"]):not([class*="Icon"])', { "border-radius": "16px" }),
  ].join("");
}

// 「快照」与「覆写」必须落在**不同元素**上：
// 若同写在一个元素上，--dsh-snap-x:var(--dsw-x) 会被该元素自己的
// --dsw-x:color-mix(...,var(--dsh-snap-x) ...) 反向引用，构成循环，
// 两个属性一起失效。因此快照放 body（那里令牌还是原值），覆写放它的子级。
function snapshotCss() {
  const decls = {};
  for (const spec of SOFTEN_TOKENS) {
    const fb = spec.fallback.startsWith("--") ? `var(${spec.fallback})` : spec.fallback;
    decls[spec.snap] = `var(${spec.token},${fb})`;
  }
  return tokenRule("body", decls, SNAPSHOT_NAMES, false);
}

function tokenCss(cfg) {
  const percent = {
    surface: clampUnitPercent(cfg.surface),
    container: clampUnitPercent(cfg.container),
  };
  const decls = {};
  for (const spec of SOFTEN_TOKENS) {
    decls[spec.token] = `color-mix(in srgb,var(${spec.snap}) ${percent[spec.alpha]}%,transparent)`;
  }
  // 覆写在 body 的直接子级上，靠继承下发到整棵树 —— 包括挂在 body 上的
  // portal 容器（弹窗/提示），因此比逐个类名匹配更完整。
  return tokenRule("body > *", decls, SOFTEN_NAMES, true);
}

function wallpaperCss(cfg, background) {
  const layers = [];
  if (cfg.dim > 0) {
    layers.push(`linear-gradient(rgba(0,0,0,${alpha(cfg.dim)}),rgba(0,0,0,${alpha(cfg.dim)}))`);
  }
  layers.push(`url("${background.url}")`);
  const decls = {
    content: '""',
    position: "fixed",
    inset: "0",
    "z-index": "-1",
    "pointer-events": "none",
    "background-image": layers.join(","),
    "background-size": cssUrl(cfg.size),
    "background-position": cssUrl(cfg.position),
    "background-repeat": "no-repeat",
    "background-attachment": "fixed",
  };
  if (cfg.blur > 0) {
    // 柔化作用在壁纸这一层，不在任何界面元素上加 backdrop-filter。
    // scale 略放大以吃掉模糊在边缘产生的透明带。
    const value = `blur(${Math.round(cfg.blur)}px)`;
    decls.filter = value;
    decls["-webkit-filter"] = value;
    decls.transform = "scale(1.08)";
  }
  return layerRule("html::before", decls);
}

// ---------------------------------------------------------------------------
// 移动端布局 —— 上游在窄屏下确实排不下，这里做「小屏专属」收紧。
//
// 实测上游行为（390×844，与应用外观无关 —— 关掉外观注入逐项测量完全相同）：
//   外壳是 grid，列宽由 JS 写在 inline style 上，随侧栏开合切换：
//     关闭态 `56px minmax(0px, 1fr) 0px`  → 56px 图标轨道 + 334px 正文
//     打开态 `280px minmax(0px, 1fr) 0px` → 280px 侧栏  + 110px 正文
//   也就是说：上游把小屏的侧栏做成「挤压式」，展开后正文只剩 110px。
//   360 宽手机上侧栏占 77.8% 视口，正文 80px —— 实际已不可用。
//   此外轨道/侧栏里的图标按钮只有 28~38px（低于 44px 最小触摸目标），
//   会话标题 14px、时间 12px、行高 20px 在手机上也偏小偏密。
//
// 小屏改为「轨道 + 浮层抽屉」：
//   - 轨道（关闭态）保持 56px 不动，正文照旧吃满剩余宽度，这一态本来就好用；
//   - 展开态不再挤压正文，侧栏改成浮在正文之上的抽屉（fixed + 固定宽度），
//     正文列始终是满宽，点完会话立刻就是完整内容，不需要再等布局重排。
//
// 实现要点：上游把列宽写在 inline style，普通规则压不住，必须 !important；
// 而一旦让 sidebarCol 脱离网格流（fixed），网格的自动放置会把后面几列整体
// 前移一格（centerCol 会落到 0px 那一列）—— 所以三个列都必须显式指定
// grid-column，不能依赖自动放置。
//
// **全部规则只存在于 ≤ 560px 的媒体查询内，桌面端一个字节都不会变。**
// ---------------------------------------------------------------------------
const MOBILE_MAX_WIDTH = 560;
const MOBILE_QUERY = `(max-width:${MOBILE_MAX_WIDTH}px)`;

// 网格骨架：三列全部显式定位，避免 sidebarCol 脱离流后发生错位。
const MOBILE_FRAME_SELECTOR = '[class*="_frame"],[class*="Frame"]';
const MOBILE_SIDEBAR_COL_SELECTOR = '[class*="sidebarCol"]';
const MOBILE_CENTER_COL_SELECTOR = '[class*="centerCol"]';
const MOBILE_RIGHTBAR_COL_SELECTOR = '[class*="rightbarCol"]';

// 把「父选择器列表 + 状态后缀 + 子选择器列表」展开成完整的选择器列表。
//
// 直接写 `'[a],[b]:not(X) > [c]'` 是错的：逗号分隔时后缀只挂在最后一项，前面的
// `[a]` 会变成一条没有目标的裸选择器（它甚至会命中 frame 自己），整条规则静默跑偏。
// 曾经因此让抽屉的开合限定完全没生效。
function expandPairs(parentList, stateSuffix, childList) {
  const parents = parentList.split(",").map((s) => s.trim());
  const children = childList.split(",").map((s) => s.trim());
  const out = [];
  for (const p of parents) {
    if (childList) {
      for (const c of children) out.push(`${p}${stateSuffix} > ${c}`);
    } else {
      out.push(`${p}${stateSuffix}`);
    }
  }
  return out.join(",");
}

// 展开态 = frame 上没有 data-sidebar-collapsed（上游展开时会把该属性摘掉）。
const MOBILE_FRAME_OPEN = expandPairs(MOBILE_FRAME_SELECTOR, ":not([data-sidebar-collapsed])", "");
const MOBILE_FRAME_CLOSED = expandPairs(MOBILE_FRAME_SELECTOR, "[data-sidebar-collapsed]", "");
const MOBILE_SCRIM_SELECTOR = expandPairs(MOBILE_FRAME_SELECTOR, ":not([data-sidebar-collapsed])::after", "");
const MOBILE_DRAWER_SELECTOR = expandPairs(
  MOBILE_FRAME_SELECTOR, ":not([data-sidebar-collapsed])", MOBILE_SIDEBAR_COL_SELECTOR);
const MOBILE_RAIL_HIDDEN_SELECTOR = expandPairs(
  MOBILE_FRAME_SELECTOR, "[data-sidebar-collapsed]", MOBILE_SIDEBAR_COL_SELECTOR);

// 侧栏内容根：去掉上游为桌面预留的横向内边距，把宽度让给列表。
const MOBILE_SIDEBAR_INNER = ['[class*="u5VEBa_root"]'];

// 底部设置栏 / 侧栏内可点行：抬高到最小触摸目标。
const MOBILE_TAP_ROW_SELECTORS = [
  '[class*="u5VEBa_newSession"]',
  '[class*="u5VEBa_panelRow"]',
  '[class*="BCrMEa_trigger"]',
  '[class*="sEMD0G_sessionOverflow"]',
];

// 纯图标按钮：补内边距把热区顶到 44px（图标本身尺寸不变，视觉上不会变笨重）。
const MOBILE_ICON_SELECTORS = [
  '[class*="u5VEBa_iconButton"]',
  '[class*="sEMD0G_iconButton"]',
  '[class*="sEMD0G_searchButton"]',
  '[class*="BCrMEa_trigger"]',
  '[class*="EeRcbq_iconButton"]',
];

// 品牌按钮（logo + 文字）：上游是 24px 高，手机上偏小；抬到 44px。
const MOBILE_BRAND_SELECTORS = ['[class*="u5VEBa_brand"]'];

// 会话标题与时间：手机上放宽字号与行高。
const MOBILE_TITLE_SELECTORS = ['[class*="EeRcbq_title"]'];
const MOBILE_META_SELECTORS = ['[class*="EeRcbq_time"]'];
const MOBILE_SECTION_LABEL_SELECTORS = ['[class*="sEMD0G_sectionLabel"]', '[class*="u5VEBa_panelTitle"]'];

// 抽屉的最大宽度：留出约 14% 视口给正文做「下面还有内容」的视觉暗示。
const MOBILE_DRAWER_WIDTH = "min(88vw,340px)";

// 抽屉与遮罩的表面色。
//
// 为什么必须自己定色、而不是沿用上游的表面令牌：
// 壁纸功能会把 `--dsw-alias-bg-layer-*` / `--dsw-specific-sidebar-fill` 这类令牌
// **整体「柔化」成半透明**（默认 container=45%）。桌面端侧栏背后只有壁纸，半透明
// 没问题；但小屏上侧栏是**浮在会话之上的抽屉**，45% 透明会让底下的会话文字直接
// 透上来，两层文字互相叠印 —— 这正是「移动端一开侧栏就没法看」的直接原因。
//
// 抽屉是唯一需要「实心」的场景，因此在移动端轨道里显式给一个不透明底色，
// 并把遮罩压在其下、正文之上。两处都只改颜色，不动几何。
const MOBILE_DRAWER_SURFACE = "var(--dsw-alias-bg-base,#151517)";
const MOBILE_DRAWER_SURFACE_SOLID = "#1b1b1c";
const MOBILE_SCRIM_COLOR = "rgba(0,0,0,0.45)";

// 设置面板：上游做成一张从右侧推入的全屏 sheet（z-index:40），本身也是半透明的。
// 小屏上有两个问题：
//   ① 它的 z-index(40) 低于抽屉(60) —— 侧栏开着时点进设置，抽屉会盖在设置上面；
//   ② 半透明底 + 底下透出抽屉内容，三层文字互相叠印。
// 因此移动端把设置面板抬到抽屉之上，并同样刷成实心表面。
const MOBILE_SETTINGS_PANEL_SELECTOR = '[class*="cmqW6G_panel"]';
const MOBILE_SETTINGS_Z = "80";

// 抽屉内层各面板：上游只给外层上色，内层是透明的；外层一旦不透明，
// 内层的圆角/描边会与外层底色错开，因此内层也统一刷成同一实心色。
const MOBILE_DRAWER_SURFACE_SELECTORS = [
  '[class*="u5VEBa_root"]',
  '[class*="u5VEBa_quietBars"]',
  '[class*="u5VEBa_regionArea"]',
  '[class*="sEMD0G_root"]',
  '[class*="sEMD0G_listArea"]',
  '[class*="sEMD0G_list"]',
  '[class*="sEMD0G_treeBody"]',
];

function mobileLayoutCss() {
  const rules = [];

  // 1. 网格骨架：侧栏列恒为 0，正文列恒吃满剩余宽度。
  //    上游 inline style 在关闭态写的是 56px（图标轨道），展开态写 280px；
  //    这里统一压成 0 列宽，侧栏改由下面的 fixed 抽屉呈现。
  rules.push(mobileRule(MOBILE_FRAME_SELECTOR, {
    "grid-template-columns": "0px minmax(0px,1fr) 0px",
  }));
  rules.push(mobileRule(MOBILE_CENTER_COL_SELECTOR, {
    "grid-column": "2 / 3",
    "min-width": "0",
  }));
  rules.push(mobileRule(MOBILE_RIGHTBAR_COL_SELECTOR, {
    "grid-column": "3 / 4",
  }));

  // 2. 侧栏本体：脱离网格流，做成浮层抽屉。
  //
  //    ★ 只在**展开态**渲染。上游在 frame 上写 `data-sidebar-collapsed="true"`，
  //      展开时该属性直接消失 —— 这是判断开合最稳的钩子。
  //      没有这条限定的话，抽屉会在「关闭」状态下也强行显示，表现为图标轨道
  //      压在正文上、怎么点都收不掉。
  //
  //    ★ background-color 也是必须的：抽屉是实心浮层，不能沿用被壁纸功能柔化过的
  //      表面令牌（默认 45% 透明），否则浮层背后的会话文字会透上来与抽屉内容叠印。
  rules.push(mobileRule(`${MOBILE_DRAWER_SELECTOR}`, {
    "grid-column": "1 / 2",
    position: "fixed",
    top: "0",
    bottom: "0",
    left: "0",
    width: MOBILE_DRAWER_WIDTH,
    "max-width": MOBILE_DRAWER_WIDTH,
    "z-index": "60",
    "overflow-y": "auto",
    "overscroll-behavior": "contain",
    "background-color": MOBILE_DRAWER_SURFACE_SOLID,
    "box-shadow": "2px 0 16px rgba(0,0,0,0.35)",
  }));

  // 2a. 关闭态：整个侧栏列彻底退出（不再残留图标轨道压住正文）。
  rules.push(mobileRule(`${MOBILE_RAIL_HIDDEN_SELECTOR}`, {
    display: "none",
  }));

  // 2b. 抽屉内层容器刷透明，只保留最外层那一块实心底色，避免内层各自上色后
  //     在圆角/描边处露出缝隙。
  rules.push(mobileRule(MOBILE_DRAWER_SURFACE_SELECTORS.join(","), {
    "background-color": "transparent",
  }));

  // 2c. 遮罩层：正文之上、抽屉之下压一层暗色，进一步防止文字穿透，
  //     同时给出「点外面可收起」的视觉暗示。用 frame 的伪元素，不新增 DOM。
  //     同样只在展开态出现。
  rules.push(mobileRule(`${MOBILE_SCRIM_SELECTOR}`, {
    position: "fixed",
    top: "0",
    bottom: "0",
    left: "0",
    right: "0",
    "z-index": "55",
    "background-color": MOBILE_SCRIM_COLOR,
    "pointer-events": "none",
    display: "block",
  }));

  // 2d. 设置面板：抬到抽屉之上，并刷成实心表面。
  //     父级 rightbarCol 被压成 0 列宽不影响它（面板是 position:fixed），
  //     但它的 z-index 低于抽屉、底色又是半透明的，两层一起看就是糊成一片。
  rules.push(mobileRule(MOBILE_SETTINGS_PANEL_SELECTOR, {
    "z-index": MOBILE_SETTINGS_Z,
    "background-color": MOBILE_DRAWER_SURFACE_SOLID,
  }));

  // 3. 侧栏内容根：收紧左右内边距，把宽度还给会话标题。
  rules.push(mobileRule(MOBILE_SIDEBAR_INNER.join(","), {
    padding: "6px 8px",
    "max-width": "100%",
  }));

  // 4. 可点行抬高到 44px。
  rules.push(mobileRule(MOBILE_TAP_ROW_SELECTORS.join(","), {
    "min-height": "44px",
  }));

  // 5. 纯图标按钮：靠内边距把热区顶到 44px。
  rules.push(mobileRule(MOBILE_ICON_SELECTORS.join(","), {
    "min-width": "44px",
    "min-height": "44px",
    padding: "8px",
  }));

  // 5b. 品牌按钮与顶部行：统一抬到 44px 高，避免 logo 行成为最小的点击目标。
  rules.push(mobileRule(MOBILE_BRAND_SELECTORS.join(","), {
    "min-height": "44px",
  }));

  // 6. 字号与行高：会话标题 15px / 行高 22px，时间 13px，分组标题 13px。
  rules.push(mobileRule(MOBILE_TITLE_SELECTORS.join(","), {
    "font-size": "15px",
    "line-height": "22px",
  }));
  rules.push(mobileRule(MOBILE_META_SELECTORS.join(","), {
    "font-size": "13px",
    "line-height": "22px",
  }));
  rules.push(mobileRule(MOBILE_SECTION_LABEL_SELECTORS.join(","), {
    "font-size": "13px",
    "line-height": "20px",
  }));

  return mobileMedia(MOBILE_QUERY, rules);
}

function renderAppearanceCss(cfg) {
  const base = sanitizeAppearance(cfg);

  // 显式指定的样式表完全接管 —— 但**只在文件确实存在且非空时**。
  // 变量指向的文件被删掉 / 路径写错时，不能让整个外观静默失效
  // （那会表现为「面板还是开着，页面却毫无变化」，极难排查），
  // 这种情况回落到内置引擎。
  const override = readCssFile(process.env.DSH_BACKGROUND_CSS || "");
  if (override) {
    return (base.rounded ? roundedCss() : "") + mobileLayoutCss() + override;
  }

  const parts = [];
  if (base.rounded) parts.push(roundedCss());

  // 移动端布局是独立轨道：不依赖背景开关，关闭背景时同样生效。
  parts.push(mobileLayoutCss());

  const background = base.enabled ? resolveBackground() : null;
  if (background) {
    // 主题可能给 html 自己设过底色；置空让壁纸图层露出来（纯颜色改动）。
    parts.push(paintRule("html", { "background-color": "transparent" }));
    parts.push(snapshotCss());
    parts.push(tokenCss(base));
    parts.push(wallpaperCss(base, background));
  }

  // 手写的 background.css 追加在最后，优先级最高。
  return parts.join("") + readCssFile(BACKGROUND_CSS_FILE);
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
    " {k:'blur',t:'壁纸柔化',min:0,max:24,step:1,u:'px',adv:0},",
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
      "+'#dshu-on{display:block;margin:0 0 8px;font-size:12px;cursor:pointer}'" +
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
      "+'<label id=\"dshu-on\"><input type=\"checkbox\" id=\"dshu-rounded\"> 圆角面板</label>'" +
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
    " wrap.querySelector('#dshu-rounded').checked=!!C.rounded;",
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
    "wrap.querySelector('#dshu-rounded').onchange=function(){C.rounded=this.checked;apply()};",
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

// ---------------------------------------------------------------------------
// 可按需引用：_test_appearance_css.js 直接 require 本文件来校验样式输出。
// 只有直接执行（node proxy.cjs）或经由兼容入口 proxy.js 时才真正监听端口。
// ---------------------------------------------------------------------------
module.exports = {
  DEFAULT_APPEARANCE,
  APPEARANCE_BOOLEANS,
  APPEARANCE_NUMBERS,
  APPEARANCE_SIZES,
  APPEARANCE_POSITIONS,
  PAINT_PROPERTIES,
  LAYER_PROPERTIES,
  MOBILE_PROPERTIES,
  MOBILE_MAX_WIDTH,
  MOBILE_QUERY,
  SOFTEN_TOKENS,
  SNAPSHOT_NAMES,
  SOFTEN_NAMES,
  paintRule,
  layerRule,
  mobileRule,
  mobileMedia,
  mobileLayoutCss,
  expandPairs,
  tokenRule,
  assertAllowed,
  sanitizeAppearance,
  appearanceFromQuery,
  renderAppearanceCss,
  buildBackgroundCss,
  appearancePanelScript,
  resolveBackground,
};

const entryFile = String((require.main && require.main.filename) || "");
const startedDirectly = require.main === module || /[\\/]proxy\.js$/.test(entryFile);
if (startedDirectly) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[DSH-Proxy] 监听 0.0.0.0:${PORT} -> ${TARGET_PORT}`);
  });
}

