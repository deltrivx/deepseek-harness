const http = require('http');

const TARGET_PORT = parseInt(process.env.DSH_PORT || '3018', 10);
const LISTEN_PORT = parseInt(process.env.PORT || '3080', 10);

const server = http.createServer((req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DSH 服务正在启动中，请稍候刷新... (' + err.message + ')');
  });

  req.pipe(proxyReq, { end: true });
});

// 支持 WebSocket 双向流
server.on('upgrade', (req, socket, head) => {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      Object.keys(proxyRes.headers).map(k => `${k}: ${proxyRes.headers[k]}`).join('\r\n') +
      '\r\n\r\n');
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => {
    socket.destroy();
  });

  proxyReq.end();
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[DSH Proxy] 外部监听启动: 0.0.0.0:${LISTEN_PORT} -> 127.0.0.1:${TARGET_PORT}`);
});
