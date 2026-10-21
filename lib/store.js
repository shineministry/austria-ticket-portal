'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const META_FILE = path.join(DATA_DIR, 'files.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeAll(items) {
  const tmp = META_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, META_FILE);
}

function list() {
  return readAll().sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
}

function add(meta) {
  const items = readAll();
  items.push(meta);
  writeAll(items);
  return meta;
}

function get(id) {
  return readAll().find((file) => file.id === id) || null;
}

function remove(id) {
  const items = readAll();
  const index = items.findIndex((file) => file.id === id);
  if (index < 0) return null;
  const [removed] = items.splice(index, 1);
  writeAll(items);
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, removed.stored));
  } catch (_) { /* already gone */ }
  return removed;
}

function stats() {
  const items = readAll();
  return {
    count: items.length,
    bytes: items.reduce((sum, file) => sum + (file.size || 0), 0)
  };
}

function newId() {
  return crypto.randomBytes(9).toString('hex');
}

module.exports = { DATA_DIR, UPLOAD_DIR, list, add, get, remove, stats, newId };
