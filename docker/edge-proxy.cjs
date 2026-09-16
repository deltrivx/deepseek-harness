// 精简版边缘透传代理（方案 A）
// 监听 0.0.0.0:EDGE_PORT（默认 3180），把 HTTP/WebSocket/流式请求纯透传给 DSH web（127.0.0.1:3018）。
// 不启用 Basic Auth（DSH 自身的 token 登录仍是唯一认证层，token 由 entrypoint 持久化）。
// 只用 Node 内置模块，零依赖。

const http = require('node:http');

const LISTEN_HOST = '0.0.0.0';
const LISTEN_PORT = Number(process.env.EDGE_PORT || 3180);
const TARGET_HOST = process.env.DSH_TARGET_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.DSH_TARGET_PORT || 3018);

function proxyRequest(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
    if (body.length > 0) headers['content-length'] = body.length;
    const upstream = http.request(
      { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`[edge-proxy] upstream error: ${e.message}`);
    });
    upstream.end(body);
  });
}

const server = http.createServer(proxyRequest);
server.on('error', (e) => {
  console.error(`[EdgeProxy] fatal: ${e.message}`);
  process.exit(1);
});
server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[EdgeProxy] ${LISTEN_HOST}:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT} (pure pass-through, no basic auth)`);
});
