'use strict';

const buckets = new Map();

function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, name }) {
  return function limiter(req, res, next) {
    const key = `${name}:${clientKey(req)}`;
    const now = Date.now();
    let hits = buckets.get(key);
    if (!hits || hits.resetAt <= now) {
      hits = { count: 0, resetAt: now + windowMs };
      buckets.set(key, hits);
    }
    hits.count += 1;
    if (hits.count > max) {
      const retryAfter = Math.ceil((hits.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Too many requests. Try again in ${retryAfter}s.` });
    }
    if (hits.count === 1) {
      setTimeout(() => buckets.delete(key), windowMs).unref?.();
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of buckets) if (hit.resetAt <= now) buckets.delete(key);
}, 60000).unref?.();

module.exports = { rateLimit, clientKey };
