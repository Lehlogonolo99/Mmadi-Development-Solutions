// GENERATED from services/shared by scripts/sync-shared.mjs. Do not edit here.
// Standalone HTTP server for running a service in Docker or Kubernetes.
// Adapts Node's http request/response to the small Express-style interface the router uses.
// GET /healthz answers 200 for liveness and readiness probes.

import http from 'node:http';

const MAX_BODY = 64 * 1024;

function wrapResponse(res) {
  const wrapped = {
    set(name, value) { res.setHeader(name, value); return wrapped; },
    status(code) { res.statusCode = code; return wrapped; },
    json(body) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return wrapped;
    },
  };
  return wrapped;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function serve(app, { port = Number(process.env.PORT) || 8080, name = 'service' } = {}) {
  const server = http.createServer(async (nodeReq, nodeRes) => {
    const res = wrapResponse(nodeRes);
    const url = new URL(nodeReq.url, 'http://localhost');
    if (url.pathname === '/healthz') return res.status(200).json({ ok: true, service: name });

    let body;
    try {
      if (['POST', 'PUT', 'PATCH'].includes(nodeReq.method)) {
        const raw = await readBody(nodeReq);
        const type = String(nodeReq.headers['content-type'] || '');
        if (raw && type.includes('application/json')) body = JSON.parse(raw);
      }
    } catch (err) {
      const status = err.status || 400;
      return res.status(status).json({ error: { code: status === 413 ? 'payload_too_large' : 'bad_request', message: status === 413 ? 'The request is too large.' : 'The request body isn’t valid JSON.' } });
    }

    const req = {
      method: nodeReq.method,
      url: nodeReq.url,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: nodeReq.headers,
      body,
      ip: nodeReq.socket.remoteAddress,
    };
    await app.handle(req, res);
  });

  server.keepAliveTimeout = 65_000; // longer than typical load balancer idle timeouts
  server.listen(port, () => console.log(`${name} listening on :${port}`));

  const shutdown = (signal) => {
    console.log(`${name} received ${signal}, draining connections`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}
