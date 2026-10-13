// Fixed-window rate limiter kept in memory per function instance.
// It slows down form spam from one address; it is not a global quota.
export function createRateLimiter({ limit = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    windowMs,
    allow(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
  };
}
