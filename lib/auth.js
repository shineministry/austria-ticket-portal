'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const COOKIE_NAME = 'austria_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

const sessions = new Map();

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readAuth() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (data && data.salt && data.hash) return data;
  } catch (_) { /* missing or corrupt */ }
  return null;
}

function hashPasscode(passcode, saltHex) {
  return crypto.scryptSync(String(passcode), Buffer.from(saltHex, 'hex'), SCRYPT.keylen, SCRYPT).toString('hex');
}

function setPasscode(passcode) {
  const code = String(passcode || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('Passcode must be exactly 6 digits.');
  const salt = crypto.randomBytes(16).toString('hex');
  ensureConfigDir();
  const payload = { salt, hash: hashPasscode(code, salt), updatedAt: new Date().toISOString() };
  const tmp = AUTH_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
  sessions.clear();
  return true;
}

function hasPasscode() {
  return readAuth() !== null;
}

function verifyPasscode(input) {
  const stored = readAuth();
  if (!stored) return false;
  let derived;
  try {
    derived = hashPasscode(input, stored.salt);
  } catch (_) {
    return false;
  }
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(stored.hash, 'hex');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    // equalise work on failure to avoid a trivial timing oracle
    crypto.randomBytes(32);
  }
  return ok;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const session = { token, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(token, session);
  pruneSessions();
  return session;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function touchSession(session) {
  session.expiresAt = Date.now() + SESSION_TTL_MS;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function sessionTokenFrom(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  setPasscode,
  hasPasscode,
  verifyPasscode,
  createSession,
  getSession,
  touchSession,
  destroySession,
  sessionTokenFrom,
  parseCookies
};
