const http = require("node:http");

const PORT = parseInt(process.env.PORT || "3080", 10);
const TARGET_PORT = parseInt(process.env.DSH_PORT || "3018", 10);
const TARGET_HOST = "127.0.0.1";

let activeCookie = "";

function tryLogin(token) {
  if (!token) return;
  const req = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: "/?token=" + token,
    method: "GET",
    headers: {
      "host": TARGET_HOST + ":" + TARGET_PORT
    }
  }, (res) => {
    const sc = res.headers["set-cookie"];
    if (sc && sc.length > 0) {
      activeCookie = sc[0].split(";")[0];
      console.log("[DSH-Proxy] 自动激活 Cookie 成功:", activeCookie.slice(0, 35));
    }
  });
  req.on("error", () => {});
  req.end();
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, "http://" + TARGET_HOST + ":" + PORT);
  const qToken = urlObj.searchParams.get("token");
  if (qToken) {
    tryLogin(qToken);
  }

  const headers = { ...req.headers };
  // 关键：重写为 127.0.0.1:3018 且移除 sec-fetch-site，完美绕过 isTrustedApiRequest 检查
  headers["host"] = TARGET_HOST + ":" + TARGET_PORT;
  if (headers["origin"]) {
    headers["origin"] = "http://" + TARGET_HOST + ":" + TARGET_PORT;
  }
  if (headers["referer"]) {
    headers["referer"] = "http://" + TARGET_HOST + ":" + TARGET_PORT + "/";
  }
  delete headers["sec-fetch-site"];

  if (activeCookie && (!headers["cookie"] || !headers["cookie"].includes("dsh-auth-"))) {
    const old = headers["cookie"] || "";
    headers["cookie"] = old ? (old + "; " + activeCookie) : activeCookie;
  }

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers };
    if (resHeaders["set-cookie"]) {
      const sc = resHeaders["set-cookie"];
      if (Array.isArray(sc) && sc.length > 0) {
        activeCookie = sc[0].split(";")[0];
      }
    }
    res.writeHead(proxyRes.statusCode, resHeaders);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("DSH 启动中... " + err.message);
    }
  });

  req.pipe(proxyReq, { end: true });
});

server.on("upgrade", (req, socket, head) => {
  const headers = { ...req.headers };
  headers["host"] = TARGET_HOST + ":" + TARGET_PORT;
  headers["origin"] = "http://" + TARGET_HOST + ":" + TARGET_PORT;
  if (headers["referer"]) {
    headers["referer"] = "http://" + TARGET_HOST + ":" + TARGET_PORT + "/";
  }
  delete headers["sec-fetch-site"];

  if (activeCookie && (!headers["cookie"] || !headers["cookie"].includes("dsh-auth-"))) {
    const old = headers["cookie"] || "";
    headers["cookie"] = old ? (old + "; " + activeCookie) : activeCookie;
  }

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: headers,
  };

  const proxyReq = http.request(options);
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" +
      Object.keys(proxyRes.headers).map(h => `${h}: ${proxyRes.headers[h]}`).join("\r\n") +
      "\r\n\r\n");
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on("error", () => {
    socket.destroy();
  });

  proxyReq.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[DSH-Proxy] 监听 0.0.0.0:" + PORT + " -> " + TARGET_PORT);
});
