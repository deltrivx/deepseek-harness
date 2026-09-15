/**
 * DSH Auth Gate
 *
 * 在容器入口端口（默认 3180）前置一层 Basic Auth，
 * 认证通过后透传请求到 DSH 真正的 web 端口（默认 3018）。
 *
 * DSH web 用自有 token+cookie 会话：首访会返回 401 并带
 * dsh-token 头（本 token 的登录链接）。gate 负责把 401 的
 * dsh-token 头原样透传给浏览器；浏览器拿到 token 后再次
 * 访问（带 Basic 凭证）时，DSH 完成 set-cookie 登录，后续
 * 会话即正常。
 *
 * 环境变量:
 *   AUTH_GATE_PORT     入口端口，默认 3180
 *   DSH_PORT           DSH web 端口，默认 3018
 *   DSH_AUTH_USER      用户名（与 DSH_AUTH_PASS 同时设置才启用认证）
 *   DSH_AUTH_PASS      密码
 *
 * 不设置 DSH_AUTH_USER / DSH_AUTH_PASS 时，纯透传（向后兼容）。
 */
const http = require("node:http");
const crypto = require("node:crypto");

const GATE_PORT = parseInt(process.env.AUTH_GATE_PORT || "3180", 10);
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = parseInt(process.env.DSH_PORT || "3018", 10);
const AUTH_USER = process.env.DSH_AUTH_USER || "";
const AUTH_PASS = process.env.DSH_AUTH_PASS || "";
const AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASS);

function basicAuthCheck(req) {
  if (!AUTH_ENABLED) return true;
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;
  let provided;
  try {
    provided = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const [user, ...rest] = provided.split(":");
  const pass = rest.join(":");
  const expectUser = Buffer.from(AUTH_USER, "utf8");
  const actualUser = Buffer.from(user || "", "utf8");
  const expectPass = Buffer.from(AUTH_PASS, "utf8");
  const actualPass = Buffer.from(pass || "", "utf8");
  const userOk =
    expectUser.length === actualUser.length &&
    crypto.timingSafeEqual(expectUser, actualUser);
  const passOk =
    expectPass.length === actualPass.length &&
    crypto.timingSafeEqual(expectPass, actualPass);
  return userOk && passOk;
}

function buildHeaders(req) {
  const headers = { ...req.headers };
  headers.host = TARGET_HOST + ":" + TARGET_PORT;
  delete headers["accept-encoding"];
  if (headers.origin) headers.origin = "http://" + TARGET_HOST + ":" + TARGET_PORT;
  if (headers.referer) headers.referer = "http://" + TARGET_HOST + ":" + TARGET_PORT + "/";
  delete headers["sec-fetch-site"];
  return headers;
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="DeepSeek Harness", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end("请输入 DSH 访问凭证。\n");
}

function forwardResponse(req, res, proxyRes) {
  // 原样透传响应（含 DSH 自己的 401 + dsh-token 头、set-cookie 等）
  res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
  proxyRes.pipe(res, { end: true });
}

const server = http.createServer((req, res) => {
  if (!basicAuthCheck(req)) {
    sendUnauthorized(res);
    return;
  }
  const proxyReq = http.request(
    {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: buildHeaders(req),
    },
    (proxyRes) => forwardResponse(req, res, proxyRes)
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("DSH 服务未就绪，请稍候重试。" + (err && err.message ? " (" + err.message + ")" : ""));
    }
  });
  req.on("aborted", () => proxyReq.destroy());
  req.on("error", () => proxyReq.destroy());
  res.on("close", () => {
    if (!res.writableEnded) proxyReq.destroy();
  });
  req.pipe(proxyReq, { end: true });
});

server.on("upgrade", (req, socket, head) => {
  if (!basicAuthCheck(req)) {
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\n" +
        'WWW-Authenticate: Basic realm="DeepSeek Harness", charset="UTF-8"\r\n' +
        "Connection: close\r\n\r\n"
    );
    socket.destroy();
    return;
  }
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
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        Object.keys(proxyRes.headers)
          .map((h) => h + ": " + (Array.isArray(proxyRes.headers[h]) ? proxyRes.headers[h].join(", ") : proxyRes.headers[h]))
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);
    proxySocket.on("error", closeBoth);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.end();
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(GATE_PORT, "0.0.0.0", () => {
  console.log(
    "[AuthGate] listening 0.0.0.0:" + GATE_PORT + " -> " + TARGET_HOST + ":" + TARGET_PORT +
      " (basic auth " + (AUTH_ENABLED ? "ON" : "OFF, pass-through") + ")"
  );
});
