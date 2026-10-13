// Minimal HTTP router used by every Mmadi microservice.
// Works with the Express-style req/res that Cloud Functions (2nd gen) provides,
// and with plain fakes in tests. No third-party dependencies.

import { authenticate } from './auth.js';
import { createRateLimiter } from './ratelimit.js';

export { HttpError, badRequest, unauthorized, forbidden, notFound, conflict } from './errors.js';
import { HttpError, badRequest, notFound } from './errors.js';

function compile(path) {
  const keys = [];
  const pattern = path
    .replace(/\/+$/, '')
    .replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { keys, regex: new RegExp(`^${pattern || ''}/?$`) };
}

function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * createService({ name, auth, log }) returns a router.
 *   name  service name; requests arrive as /api/<name>/...
 *   auth  adapter with verifyIdToken(token)
 * Route options: { auth: 'staff' | 'admin' | 'signed-in', rateLimit: { limit, windowMs }, cache: seconds }
 * Handlers receive { req, params, query, body, user, ip } and return the JSON body.
 */
export function createService({ name, auth, log = console }) {
  const base = `/api/${name}`;
  const routes = [];
  const limiters = new Map();

  const add = (method) => (path, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    routes.push({ method, path, ...compile(path), opts, handler });
    if (opts.rateLimit) limiters.set(`${method} ${path}`, createRateLimiter(opts.rateLimit));
  };

  async function handle(req, res) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    try {
      let path = req.path || new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith(base)) path = path.slice(base.length);
      path = path.replace(/\/+$/, '');

      const candidates = routes.filter((r) => r.regex.test(path));
      if (!candidates.length) throw notFound('No such endpoint.');
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const route = candidates.find((r) => r.method === method);
      if (!route) {
        res.set('Allow', [...new Set(candidates.map((r) => r.method))].join(', '));
        throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
      }

      const match = route.regex.exec(path);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));

      let body;
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        const type = String(req.headers?.['content-type'] || '');
        if (!type.includes('application/json')) {
          throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
        }
        body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('The request body must be a JSON object.');
      }

      const ip = clientIp(req);
      const limiter = limiters.get(`${route.method} ${route.path}`);
      if (limiter && !limiter.allow(ip)) {
        res.set('Retry-After', String(Math.ceil(limiter.windowMs / 1000)));
        throw new HttpError(429, 'too_many_requests', 'Too many requests. Wait a few minutes and try again.');
      }

      const user = route.opts.auth ? await authenticate(req, auth, route.opts.auth) : null;
      const result = await route.handler({ req, params, query: req.query || {}, body, user, ip });

      if (route.opts.cache && !user) res.set('Cache-Control', `public, max-age=${route.opts.cache}, s-maxage=${route.opts.cache * 5}`);
      const status = method === 'POST' && route.opts.created !== false ? 201 : 200;
      res.status(status).json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
      } else {
        log.error(`[${name}] unhandled error`, err);
        res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Try again shortly.' } });
      }
    }
  }

  return {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    handle,
    routes,
  };
}
