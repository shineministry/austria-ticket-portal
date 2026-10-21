'use strict';

const path = require('node:path');
const express = require('express');
const multer = require('multer');

const auth = require('./lib/auth');
const store = require('./lib/store');
const { rateLimit } = require('./lib/rate-limit');
const { EXT_MIME, MAX_FILE_BYTES, MAX_FILES_PER_BATCH, extOf, sanitizeName, kindOf } = require('./lib/types');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
// Optional subpath mount, e.g. BASE_PATH=/public for reverse proxies.
const BASE_PATH = (() => {
  const raw = String(process.env.BASE_PATH || '').trim();
  if (!raw || raw === '/') return '';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
})();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const site = express.Router();
site.use(express.json({ limit: '16kb' }));

site.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "frame-src 'self' blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  });
  if (process.env.NODE_ENV === 'production' || req.secure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CSRF hardening: browser state-changing requests must be same-origin.
site.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    let ok = false;
    try {
      ok = new URL(origin).host === host;
    } catch (_) {
      ok = false;
    }
    if (!ok) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  next();
});

const loginLimiter = rateLimit({ name: 'login', windowMs: 15 * 60 * 1000, max: 5 });
const uploadLimiter = rateLimit({ name: 'upload', windowMs: 60 * 60 * 1000, max: 150 });
const generalLimiter = rateLimit({ name: 'api', windowMs: 60 * 1000, max: 300 });

function requireAuth(req, res, next) {
  const token = auth.sessionTokenFrom(req);
  const session = auth.getSession(token);
  if (!session) return res.status(401).json({ error: 'Not signed in.' });
  auth.touchSession(session);
  res.locals.session = session;
  next();
}

function setSessionCookie(req, res, session) {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.cookie(auth.COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: auth.SESSION_TTL_MS
  });
}

function publicFile(file) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    ext: file.ext,
    kind: file.kind,
    uploadedAt: file.uploadedAt
  };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, store.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = extOf(file.originalname);
    const id = store.newId();
    cb(null, `${id}${ext ? '.' + ext : ''}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_BATCH }
});

site.post('/api/login', loginLimiter, (req, res) => {
  if (!auth.hasPasscode()) {
    return res.status(503).json({ error: 'No passcode configured. Run: npm run set-passcode' });
  }
  const passcode = req.body && req.body.passcode;
  if (typeof passcode !== 'string' || !/^\d{6}$/.test(passcode.trim())) {
    return res.status(400).json({ error: 'Enter the 6-digit passcode.' });
  }
  if (!auth.verifyPasscode(passcode.trim())) {
    return res.status(401).json({ error: 'Incorrect passcode.' });
  }
  const session = auth.createSession();
  setSessionCookie(req, res, session);
  res.json({ ok: true, files: store.list().map(publicFile), stats: store.stats() });
});

site.post('/api/logout', (req, res) => {
  const token = auth.sessionTokenFrom(req);
  auth.destroySession(token);
  res.clearCookie(auth.COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

site.get('/api/session', (req, res) => {
  const session = auth.getSession(auth.sessionTokenFrom(req));
  if (!session) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ ok: true, files: store.list().map(publicFile), stats: store.stats() });
});

site.get('/api/files', generalLimiter, requireAuth, (req, res) => {
  res.json({ files: store.list().map(publicFile), stats: store.stats() });
});

site.post('/api/files', generalLimiter, uploadLimiter, requireAuth, (req, res) => {
  upload.array('files', MAX_FILES_PER_BATCH)(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File too large. Maximum size is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`
          : err.code === 'LIMIT_FILE_COUNT'
            ? `Too many files. Maximum is ${MAX_FILES_PER_BATCH} per batch.`
            : 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files received.' });

    const accepted = [];
    const rejected = [];
    for (const file of files) {
      const ext = extOf(file.originalname);
      if (!EXT_MIME[ext]) {
        try {
          require('node:fs').unlinkSync(file.path);
        } catch (_) { /* ignore */ }
        rejected.push({ name: sanitizeName(file.originalname), reason: 'Unsupported file type' });
        continue;
      }
      const name = sanitizeName(file.originalname);
      const meta = {
        id: path.basename(file.filename, ext ? '.' + ext : ''),
        name,
        stored: file.filename,
        size: file.size,
        ext,
        kind: kindOf(ext),
        mime: EXT_MIME[ext],
        uploadedAt: Date.now()
      };
      store.add(meta);
      accepted.push(publicFile(meta));
    }

    if (!accepted.length) {
      return res.status(415).json({ error: 'Unsupported file type.', rejected });
    }
    res.status(201).json({ files: accepted, rejected, stats: store.stats() });
  });
});

site.get('/api/files/:id', generalLimiter, requireAuth, (req, res) => {
  const file = store.get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const inline = req.query.disposition === 'inline';
  const safeName = encodeURIComponent(file.name);
  res.set({
    'Content-Type': EXT_MIME[file.ext] || 'application/octet-stream',
    'Content-Length': String(file.size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${safeName}`,
    'Cache-Control': 'private, max-age=0, no-cache'
  });
  const stream = require('node:fs').createReadStream(require('node:path').join(store.UPLOAD_DIR, file.stored));
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'File missing from storage.' });
    res.end();
  });
  stream.pipe(res);
});

site.delete('/api/files/:id', generalLimiter, requireAuth, (req, res) => {
  const removed = store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'File not found.' });
  res.json({ ok: true, stats: store.stats() });
});

site.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h', etag: true }));

site.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// eslint-disable-next-line no-unused-vars
site.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.use(BASE_PATH || '/', site);

app.listen(PORT, HOST, () => {
  console.log(`Austria Ticket Portal running at http://localhost:${PORT}${BASE_PATH}`);
  if (!auth.hasPasscode()) {
    console.warn('WARNING: no passcode configured. Run `npm run set-passcode` before signing in.');
  }
});
