const http = require("node:http");

const PORT = parseInt(process.env.PORT || "3080", 10);
const TARGET_PORT = parseInt(process.env.DSH_PORT || "3018", 10);
const TARGET_HOST = "127.0.0.1";
const PUBLIC_TITLE = "DeepSeek Harness";

let activeCookie = "";

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
  if (/<title>[^<]*<\/title>/i.test(text)) {
    return Buffer.from(text.replace(/<title>[^<]*<\/title>/i, `<title>${PUBLIC_TITLE}</title>`));
  }
  if (/<head[^>]*>/i.test(text)) {
    return Buffer.from(text.replace(/<head[^>]*>/i, (head) => `${head}<title>${PUBLIC_TITLE}</title>`));
  }
  return body;
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

const server = http.createServer((req, res) => {
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
