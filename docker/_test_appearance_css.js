#!/usr/bin/env node
/**
 * 外观引擎的回归测试 —— 直接 require 同目录的 proxy.cjs 纯函数，不启动服务。
 *
 * 这套测试存在的唯一理由：v0.1.6 公开版的外观功能往页面里塞了大量几何规则
 * （padding / width:774px / max-width:100% / flex / box-sizing / font-size），
 * 而且是**无条件注入**的。实测后果：
 *   - 移动端 390px 下 123 个元素位置/尺寸被改动（图标按钮 44px 塌成 36px）；
 *   - 桌面端打开会话后 133 个元素被改动（标题栏被撑到 774px / 1160px）。
 * 根因是 backdrop-filter 与几何属性：backdrop-filter 会建立包含块与层叠上下文，
 * 夹在 #root 上会让它内部的 position:fixed 元素改以 #root 为参照，从而整体错位。
 *
 * 因此这里立三条硬红线，任何一条被破坏都会失败：
 *   1. 样式表里只允许出现「颜色类」属性（白名单），几何属性一律禁止；
 *   2. 唯一的例外是我们自己的 html::before 壁纸图层，几何属性只准出现在那里；
 *   3. 绝不允许 body * 之类的全量选择器，也绝不出现 backdrop-filter。
 *
 *   node docker/_test_appearance_css.js
 *
 * CI 在构建镜像前会跑这一套（见 .github/workflows/docker-build-ghcr.yml）。
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------------
// 断言框架
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? " —— " + detail : ""}`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

// ---------------------------------------------------------------------------
// 准备隔离环境：必须在 require 之前设置，因为 proxy.cjs 在加载时读取这些常量
// ---------------------------------------------------------------------------
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-appearance-test-"));
const BG_FILE = path.join(HOME, "background.png");
// 1x1 PNG，仅用于让 resolveBackground() 走「有壁纸」分支
fs.writeFileSync(BG_FILE, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
));

process.env.DSH_HOME = HOME;
process.env.DSH_BACKGROUND_FILE = BG_FILE;
process.env.DSH_APPEARANCE_FILE = path.join(HOME, "appearance.json");
process.env.DSH_BACKGROUND_CSS = path.join(HOME, "background.css");
delete process.env.DSH_BACKGROUND_URL;
delete process.env.DSH_BACKGROUND_ENABLED;

const engine = require(path.join(__dirname, "proxy.cjs"));

// ---------------------------------------------------------------------------
// CSS 解析：把样式表拆成规则，用于逐条审查属性
// ---------------------------------------------------------------------------
function parseRules(css) {
  const rules = [];
  for (const chunk of css.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace < 0) continue;
    const selector = chunk.slice(0, brace).trim();
    if (!selector) continue;
    const decls = chunk.slice(brace + 1).split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const colon = item.indexOf(":");
        return { property: item.slice(0, colon).trim().toLowerCase() };
      });
    rules.push({ selector, properties: decls.map((d) => d.property) });
  }
  return rules;
}

const ALLOWED = new Set([...engine.PAINT_PROPERTIES, ...engine.LAYER_PROPERTIES]);
// 表面层走「设计令牌覆写」，属性名是自定义属性，单独一套白名单。
const TOKEN_ALLOWED = new Set([...engine.SNAPSHOT_NAMES, ...engine.SOFTEN_NAMES]);
const WALLPAPER_LAYER = "html::before";

/** 审查一份样式表：属性必须在白名单内；非图层规则不得出现几何属性。 */
function auditCss(css) {
  const problems = [];
  for (const rule of parseRules(css)) {
    const isLayer = rule.selector === WALLPAPER_LAYER;
    for (const property of rule.properties) {
      if (property.startsWith("--")) {
        if (!TOKEN_ALLOWED.has(property)) {
          problems.push(`${rule.selector} 改动了未列入白名单的自定义属性 ${property}`);
        }
        continue;
      }
      if (!ALLOWED.has(property)) {
        problems.push(`${rule.selector} 使用了白名单外属性 ${property}`);
        continue;
      }
      if (!isLayer && engine.LAYER_PROPERTIES.has(property)) {
        problems.push(`${rule.selector} 在应用元素上使用了图层属性 ${property}`);
      }
    }
    if (/\bbody\s*\*/.test(rule.selector) || /\*\s*\{?$/.test(rule.selector) && rule.selector === "*") {
      problems.push(`出现全量选择器 ${rule.selector}`);
    }
  }
  return problems;
}

const base = engine.DEFAULT_APPEARANCE;

// ---------------------------------------------------------------------------
section("1. 关闭全部外观 ⇒ 零注入（与官方镜像一致）");
// ---------------------------------------------------------------------------
const offCss = engine.renderAppearanceCss({ ...base, enabled: false, rounded: false });
check("关闭壁纸 + 关闭圆角时输出为空字符串", offCss === "", `实际输出 ${offCss.length} 字符`);

// ---------------------------------------------------------------------------
section("2. 只开圆角 ⇒ 只允许 border-radius");
// ---------------------------------------------------------------------------
const roundCss = engine.renderAppearanceCss({ ...base, enabled: false, rounded: true });
const roundRules = parseRules(roundCss);
check("有产出圆角规则", roundRules.length > 0);
check("圆角规则只声明 border-radius",
  roundRules.every((r) => r.properties.every((p) => p === "border-radius")),
  JSON.stringify(roundRules.map((r) => r.properties)));
check("圆角样式表无任何违规属性", auditCss(roundCss).length === 0, auditCss(roundCss).join(" / "));

// ---------------------------------------------------------------------------
section("3. 开启壁纸 ⇒ 独立图层 + 只改颜色的表面层");
// ---------------------------------------------------------------------------
const onCss = engine.renderAppearanceCss({
  ...base, enabled: true, rounded: true, surface: 0.35, container: 0.45, blur: 6, dim: 0.2,
});
check("生成了 html::before 壁纸图层", onCss.includes(`${WALLPAPER_LAYER}{`));
check("壁纸图层使用 z-index:-1 且不吃鼠标事件",
  /z-index:-1 !important/.test(onCss) && /pointer-events:none !important/.test(onCss));
check("柔化作用在壁纸上（filter:blur）", /(^|;)filter:blur\(6px\) !important/.test(onCss));
check("压暗以图层叠加实现", onCss.includes("linear-gradient(rgba(0,0,0,0.2)"));
check("表面层通过 design token 半透明化（color-mix 引用快照）",
  onCss.includes("color-mix(in srgb,var(--dsh-snap-bg-base)") &&
  /body > \*\{[^}]*--dsw-alias-bg-base:color-mix/.test(onCss));
check("侧栏令牌同样被半透明化", /--dsw-specific-sidebar-fill:color-mix/.test(onCss));
check("开启状态下同样无违规属性", auditCss(onCss).length === 0, auditCss(onCss).join(" / "));

// ---------------------------------------------------------------------------
section("4. 硬性红线：绝不出现几何属性 / 全量选择器 / backdrop-filter");
// ---------------------------------------------------------------------------
const FORBIDDEN = [
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "width", "height", "max-width", "min-width", "max-height", "min-height",
  "flex", "flex-grow", "flex-shrink", "flex-basis", "flex-direction", "flex-wrap",
  "grid", "grid-template-columns", "grid-column", "display", "overflow", "overflow-x",
  "overflow-y", "box-sizing", "font-size", "line-height", "gap", "order",
  "position", "inset", "top", "right", "bottom", "left", "z-index", "transform",
  "float", "align-items", "justify-content", "white-space", "backdrop-filter",
  "-webkit-backdrop-filter",
];

const matrix = [];
for (const enabled of [true, false]) {
  for (const rounded of [true, false]) {
    for (const blur of [0, 12]) {
      for (const dim of [0, 0.5]) {
        matrix.push({ ...base, enabled, rounded, blur, dim, surface: 0.4, container: 0.6 });
      }
    }
  }
}
const allCss = matrix.map((cfg) => engine.renderAppearanceCss(cfg)).join("\n");

for (const property of FORBIDDEN) {
  // 图层规则允许 position / inset / z-index / transform，其余一律禁止
  const isLayerOnly = ["position", "inset", "z-index", "transform"].includes(property);
  const pattern = new RegExp(`(^|[;{"])${property.replace(/[-]/g, "\\-")}\\s*:`, "m");
  const hit = allCss.split("}").some((chunk) => {
    const brace = chunk.indexOf("{");
    if (brace < 0) return false;
    const selector = chunk.slice(0, brace).trim();
    if (isLayerOnly && selector === WALLPAPER_LAYER) return false;
    return pattern.test(chunk.slice(brace + 1));
  });
  check(`任何配置下都不出现 ${property}`, !hit);
}

check("样本覆盖 16 种配置组合", matrix.length === 16);
check("任何配置下都不出现 body * 全量选择器", !/body\s*\*/.test(allCss));
check("任何配置下都不出现 backdrop-filter", !/backdrop-filter/i.test(allCss));

// ---------------------------------------------------------------------------
section("5. 护栏本身有效（负向测试）");
// ---------------------------------------------------------------------------
let threw = false;
try {
  engine.paintRule(".x", { padding: "20px" });
} catch {
  threw = true;
}
check("paintRule 遇到 padding 会直接抛错", threw);

threw = false;
try {
  engine.paintRule(".x", { "backdrop-filter": "blur(4px)" });
} catch {
  threw = true;
}
check("paintRule 遇到 backdrop-filter 会直接抛错", threw);

threw = false;
try {
  engine.layerRule(".x", { "font-size": "16px" });
} catch {
  threw = true;
}
check("layerRule 也不能使用白名单外的属性", threw);

check("合法声明可以正常通过", engine.paintRule(".x", { "border-radius": "8px" }).includes("border-radius:8px"));

// ---------------------------------------------------------------------------
section("6. 配置清洗与旧配置兼容");
// ---------------------------------------------------------------------------
const legacy = engine.sanitizeAppearance({
  enabled: true, subtle: 0.55, blurMain: 5, blurInput: 2,
  surface: 0.32, container: 0.14, blur: 4, panelAlpha: 0.14, inputAlpha: 0.05,
  dim: 0, size: "cover", position: "center", 未知字段: 123,
});
check("v1 遗留字段 subtle 被丢弃", !("subtle" in legacy));
check("v1 遗留字段 blurMain 被丢弃", !("blurMain" in legacy));
check("v1 遗留字段 blurInput 被丢弃", !("blurInput" in legacy));
check("未知字段被丢弃", !("未知字段" in legacy));
check("rounded 有默认值", legacy.rounded === true);
check("v1 配置的透明度被重置为默认值（否则升级后侧栏几乎不可见）",
  legacy.surface === engine.DEFAULT_APPEARANCE.surface &&
  legacy.container === engine.DEFAULT_APPEARANCE.container,
  `surface=${legacy.surface} container=${legacy.container}`);
check("v1 配置里语义未变的字段仍被保留", legacy.blur === 4 && legacy.size === "cover" && legacy.enabled === true);

const v2 = engine.sanitizeAppearance({ enabled: true, surface: 0.6, container: 0.7, blur: 8 });
check("v2 配置的透明度原样保留", v2.surface === 0.6 && v2.container === 0.7 && v2.blur === 8);

const clamped = engine.sanitizeAppearance({ surface: 5, container: -3, blur: 999, dim: 9 });
check("surface 被钳制到 [0,1]", clamped.surface === 1);
check("container 被钳制到 [0,1]", clamped.container === 0);
check("blur 被钳制到上限 40", clamped.blur === 40);
check("dim 被钳制到上限 0.9", clamped.dim === 0.9);

const bad = engine.sanitizeAppearance({ size: "drop-table", position: "nowhere" });
check("非法 size 回退到默认", bad.size === "cover");
check("非法 position 回退到默认", bad.position === "center");

const bools = engine.sanitizeAppearance({ enabled: "yes", rounded: 1 });
check("非布尔值不会被误当成布尔", bools.enabled === true && bools.rounded === true);

// ---------------------------------------------------------------------------
section("7. 面板即时预览用的 query 解析");
// ---------------------------------------------------------------------------
const q = new URLSearchParams("enabled=false&rounded=0&surface=0.8&blur=10&dim=0.3&size=contain&position=top");
const fromQuery = engine.appearanceFromQuery(q);
check("布尔参数 enabled=false 解析正确", fromQuery.enabled === false);
check("布尔参数 rounded=0 解析正确", fromQuery.rounded === false);
check("数值参数解析正确", fromQuery.surface === 0.8 && fromQuery.blur === 10 && fromQuery.dim === 0.3);
check("字符串参数解析正确", fromQuery.size === "contain" && fromQuery.position === "top");
const qCss = engine.renderAppearanceCss(fromQuery);
check("query 预览同样通过属性审查", auditCss(qCss).length === 0, auditCss(qCss).join(" / "));

// ---------------------------------------------------------------------------
section("8. 无壁纸文件时不应注入任何壁纸内容");
// ---------------------------------------------------------------------------
fs.rmSync(BG_FILE);
const noImage = engine.renderAppearanceCss({ ...base, enabled: true, rounded: false });
check("缺壁纸文件时输出为空", noImage === "", `实际 ${noImage.length} 字符`);
fs.writeFileSync(BG_FILE, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
));

// ---------------------------------------------------------------------------
section("9. 手写 background.css 的两种边界");
// ---------------------------------------------------------------------------
// 9a. 指向不存在的文件时，不能让整个外观静默失效 —— 必须回落到内置引擎。
//     （这一条是为了拦住一个真实缺陷：DSH_BACKGROUND_CSS 一旦非空就完全接管，
//      文件被删掉 / 路径写错时页面毫无反应，且不报任何错，极难排查。）
const missingOverride = path.join(HOME, "不存在的覆盖.css");
process.env.DSH_BACKGROUND_CSS = missingOverride;
const fallback = engine.renderAppearanceCss({ ...base, enabled: true, rounded: true });
check("DSH_BACKGROUND_CSS 指向缺失文件时回落到内置引擎",
  fallback.includes(`${WALLPAPER_LAYER}{`) && fallback.includes("border-radius:22px"),
  `实际 ${fallback.length} 字符`);

// 9b. 指向真实文件时，文件内容完全接管。
const overrideFile = path.join(HOME, "override.css");
fs.writeFileSync(overrideFile, ".x{border-radius:4px}");
process.env.DSH_BACKGROUND_CSS = overrideFile;
const taken = engine.renderAppearanceCss({ ...base, enabled: true, rounded: true });
check("DSH_BACKGROUND_CSS 指向真实文件时由该文件接管",
  taken.includes(".x{border-radius:4px}") && !taken.includes(WALLPAPER_LAYER + "{"));

// 9c. 只有注释的手写文件视同空文件，保证「关闭外观 ⇒ 零注入」在生产环境同样成立。
const commentOnly = path.join(HOME, "comment-only.css");
fs.writeFileSync(commentOnly, "/* 这里没有真正的规则 */\n");
process.env.DSH_BACKGROUND_CSS = commentOnly;
const commentCss = engine.renderAppearanceCss({ ...base, enabled: false, rounded: false });
check("纯注释的手写文件不会产生任何注入", commentCss === "", `实际 ${commentCss.length} 字符`);
process.env.DSH_BACKGROUND_CSS = path.join(HOME, "background.css");

// ---------------------------------------------------------------------------
section("10. 表面层：令牌快照与覆写（这套机制一旦写错会静默失效）");
// ---------------------------------------------------------------------------
const tokenRules = parseRules(onCss).filter((r) => !r.selector.startsWith("["));
const snapRule = tokenRules.find((r) => r.selector === "body");
const overrideRule = tokenRules.find((r) => r.selector === "body > *");

check("存在 body 上的快照规则", Boolean(snapRule));
check("存在 body > * 上的令牌覆写规则", Boolean(overrideRule));

// 10a. 快照与覆写必须在不同元素上 —— 写在同一元素会构成 var() 循环，
//      两边一起变成无效值，表现为「面板开着但毫无变化」，且不报任何错。
check("快照与覆写不在同一个选择器上（否则 var() 循环）",
  Boolean(snapRule) && Boolean(overrideRule) && snapRule.selector !== overrideRule.selector);

// 10b. 令牌覆写只能出现在 body 的直接子级，绝不能退化成 body * 全量选择器。
check("令牌覆写限定在 body > *，没有退化成全量选择器",
  Boolean(overrideRule) && !/body\s+\*/.test(onCss) && !/\*\s*\{/.test(onCss.replace(/body > \*/g, "")));

// 10c. 每个快照都必须带兜底，避免令牌为空时 color-mix 拿到空值。
const rawSnapshot = onCss.slice(onCss.indexOf("body{") + 5, onCss.indexOf("}", onCss.indexOf("body{")));
for (const spec of engine.SOFTEN_TOKENS) {
  const decl = rawSnapshot.split(";").find((d) => d.trim().startsWith(spec.snap + ":"));
  check(`快照 ${spec.snap} 带兜底值`, Boolean(decl) && decl.includes(","),
    decl || "(缺失)");
}

// 10d. 覆写值必须是 color-mix（颜色函数），不能是别的什么东西。
const overrideBody = onCss.slice(onCss.indexOf("body > *{") + 10);
const overrideDecls = overrideBody.slice(0, overrideBody.indexOf("}")).split(";").filter(Boolean);
check("每一处令牌覆写都用 color-mix 生成半透明色",
  overrideDecls.length === engine.SOFTEN_TOKENS.length &&
  overrideDecls.every((d) => d.includes("color-mix(in srgb,var(--dsh-snap-")));
check("令牌覆写数量与令牌表一致", overrideDecls.length === engine.SOFTEN_TOKENS.length,
  `实际 ${overrideDecls.length} 条 / 期望 ${engine.SOFTEN_TOKENS.length} 条`);

// 10e. 面板滑杆能真正改变令牌比例。
const thin = engine.renderAppearanceCss({ ...base, enabled: true, rounded: false, surface: 0.1, container: 0.9 });
check("surface 滑杆影响 bg-base 的比例", thin.includes("var(--dsh-snap-bg-base) 10%,transparent"));
check("container 滑杆影响侧栏令牌的比例", thin.includes("var(--dsh-snap-sidebar-fill) 90%,transparent"));

// 10f. 令牌轨道也有护栏：试图覆写白名单外的自定义属性必须抛错。
threw = false;
try {
  engine.tokenRule(".x", { "--dsw-something-else": "red" }, engine.SOFTEN_NAMES, true);
} catch {
  threw = true;
}
check("tokenRule 拒绝白名单外的自定义属性", threw);
check("tokenRule 接受合法令牌", engine.tokenRule("body > *", { "--dsw-alias-bg-base": "red" }, engine.SOFTEN_NAMES, true).includes("--dsw-alias-bg-base:red"));

// ---------------------------------------------------------------------------
// 收尾
// ---------------------------------------------------------------------------
fs.rmSync(HOME, { recursive: true, force: true });

process.stdout.write(`\n${"=".repeat(58)}\n`);
if (failures.length) {
  process.stdout.write(`失败 ${failures.length} 项 / 通过 ${passed} 项\n\n`);
  for (const item of failures) process.stdout.write(`  ✗ ${item}\n`);
  process.stdout.write(`${"=".repeat(58)}\n`);
  process.exit(1);
}
process.stdout.write(`全部通过：${passed} 项\n`);
process.stdout.write(`${"=".repeat(58)}\n`);
