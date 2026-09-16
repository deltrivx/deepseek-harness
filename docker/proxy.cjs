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
const BACKGROUND_CSS_FILE = (process.env.DSH_BACKGROUND_CSS || "").trim();
const MAX_BACKGROUND_BYTES = 32 * 1024 * 1024;

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
  const snapshot = names.map((name, index) => `--dsw-bgw-${index}:var(${name})`).join(";");
  const override = names
    .map((name, index) => {
      if (index === 0) return `${name}:transparent`;
      const percent = Math.round((index < SURFACE_TOKENS.length ? surfaceAlpha : subtleAlpha) * 100);
      return `${name}:color-mix(in srgb,var(--dsw-bgw-${index}) ${percent}%,transparent)`;
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

function buildBackgroundCss() {
  const custom = BACKGROUND_CSS_FILE;
  if (custom) {
    try {
      const css = fs.readFileSync(custom, "utf8");
      if (css.trim()) return `<style id="dsh-background">${css}</style>`;
    } catch {
      return "";
    }
    return "";
  }
  const background = resolveBackground();
  if (!background) return "";
  const base = clampUnit(BACKGROUND_LAYER_ALPHA, 0.72, 0, 1);
  const dim = clampUnit(BACKGROUND_DIM, 0, 0, 0.9);
  const blur = Math.max(0, Number.parseFloat(BACKGROUND_BLUR) || 0);
  const image = dim > 0
    ? `linear-gradient(rgba(0,0,0,${alpha(dim)}),rgba(0,0,0,${alpha(dim)})),url("${background.url}")`
    : `url("${background.url}")`;
  const subtle = Math.min(1, base + 0.2);
  const blurRule = blur > 0
    ? `main,aside,section,nav{backdrop-filter:blur(${blur}px) !important;-webkit-backdrop-filter:blur(${blur}px) !important;}`
    : "";
  const css = [
    `html,body{background-image:${image} !important;background-size:${cssUrl(BACKGROUND_SIZE)} !important;background-position:${cssUrl(BACKGROUND_POSITION)} !important;background-attachment:fixed !important;background-repeat:no-repeat !important;}`,
    `html,body{background-color:transparent !important;}`,
    buildTokenCss(base, subtle),
    blurRule,
  ].join("");
  return `<style id="dsh-background">${css}</style>`;
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

function rewriteHtml(body) {
  const text = body.toString("utf8");
  const bridge = `<script>(function(){document.title="${PUBLIC_TITLE}";new MutationObserver(function(){if(document.title!=="${PUBLIC_TITLE}")document.title="${PUBLIC_TITLE}"}).observe(document.querySelector("head")||document.documentElement,{subtree:true,childList:true,characterData:true});document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("button"):null;if(!b)return;var t=(b.innerText||b.textContent||"").trim();if(t.indexOf("打开配置文件")>=0||/open\\s+config/i.test(t)){e.preventDefault();e.stopImmediatePropagation();location.assign("/__dsh-config");}},true)})()</script>`;
  let rewritten = text.replace(/<title>[^<]*<\/title>/i, `<title>${PUBLIC_TITLE}</title>`);
  if (!/<title>[^<]*<\/title>/i.test(text)) rewritten = rewritten.replace(/<head[^>]*>/i, (head) => `${head}<title>${PUBLIC_TITLE}</title>`);
  if (/<\/head>/i.test(rewritten) && !rewritten.includes("/__dsh-config")) rewritten = rewritten.replace(/<\/head>/i, `${buildBackgroundCss()}${bridge}</head>`);
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
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek Harness 配置</title><style>body{font:14px system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1f2328}main{max-width:1100px;margin:24px auto;padding:20px;background:#fff;border:1px solid #d0d7de;border-radius:12px}textarea{width:100%;min-height:65vh;box-sizing:border-box;font:13px ui-monospace,monospace;padding:12px;border:1px solid #8c959f;border-radius:8px}button{padding:8px 16px;border:1px solid #8c959f;border-radius:8px;background:#fff;cursor:pointer}button.primary{background:#0969da;color:#fff;border-color:#0969da}.bar{display:flex;gap:10px;align-items:center;margin:12px 0}.muted{color:#656d76}.error{color:#cf222e;white-space:pre-wrap}</style></head><body><main><h1>DeepSeek Harness 配置</h1><p class="muted">浏览器编辑回退：${escapeHtml(CONFIG_FILE)}。保存前会自动创建 .bak 备份。</p>${error ? `<p class="error">无法读取配置文件：${escapeHtml(error)}</p>` : ""}<textarea id="config" spellcheck="false">${escapeHtml(content)}</textarea><div class="bar"><button class="primary" id="save">保存配置</button><button id="back">返回 WebUI</button><span id="status" class="muted"></span></div></main><script>const status=document.getElementById("status");document.getElementById("back").onclick=()=>location.assign("/");document.getElementById("save").onclick=async()=>{status.textContent="保存中...";try{const r=await fetch("/__dsh-config",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:document.getElementById("config").value})});const j=await r.json();status.textContent=j.ok?"已保存，重启容器后生效":(j.error||"保存失败")}catch(e){status.textContent="保存失败："+e.message}};</script></body></html>`;
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
      const body = rewriteHtml(Buffer.concat(chunks));
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
