'use strict';

/* ---------------- constants ---------------- */

const VAULT_KEY = 'atp.vault.v1';
const THROTTLE_KEY = 'atp.throttle';
const META_PATH = 'ticket-meta.json';
const API_BASE = 'https://api.github.com';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const UPLOAD_DELAY_MS = 350;
const BLOB_CACHE_MAX = 40;

const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff'],
  document: ['pdf', 'txt', 'csv', 'md', 'json', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods'],
  video: ['mp4', 'webm', 'mov', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', 'flac'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz']
};
const ALLOWED_EXTS = Object.values(KINDS).flat();

const MIME_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', md: 'text/plain; charset=utf-8',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip'
};

/* ---------------- dom ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const setupSection = $('#setup');
const gate = $('#gate');
const app = $('#app');
const codeBoxes = $$('.code-box');
const codeRow = $('#code-row');
const gateError = $('#gate-error');
const passcodeForm = $('#passcode-form');
const unlockBtn = $('#unlock-btn');
const setupForm = $('#setup-form');
const setupError = $('#setup-error');
const setupBtn = $('#setup-btn');
const filesEl = $('#files');
const emptyEl = $('#empty');
const searchInput = $('#search-input');
const dropPanel = $('#drop-panel');
const fileInput = $('#file-input');
const progressBar = $('#progress-bar');
const progressEl = $('#progress');
const dropStatus = $('#drop-status');
const lightbox = $('#lightbox');

const state = {
  files: [],
  meta: new Map(), // path -> { name, type }
  view: localStorage.getItem('atp.view') || 'grid',
  query: '',
  busy: false
};

let vault = null; // { token, repo, branch } — memory only after unlock
let previewToken = 0;

/* ---------------- helpers ---------------- */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(ts));
  } catch (_) {
    return new Date(ts).toLocaleString();
  }
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, detail = '', type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.innerHTML = `${esc(message)}${detail ? `<small>${esc(detail)}</small>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s ease';
    setTimeout(() => el.remove(), 260);
  }, 4200);
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function kindOf(ext) {
  for (const [kind, exts] of Object.entries(KINDS)) {
    if (exts.includes(ext)) return kind;
  }
  return 'other';
}

function mimeOf(ext) {
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function safeName(name) {
  let s = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  if (!s) s = 'file';
  if (s.length > 120) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

function makeStoredName(originalName) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${ts}-${rand}__${safeName(originalName)}`;
}

function mapStoredName(storedName) {
  const m = /^(\d{10,})-[a-z0-9]+__(.+)$/.exec(storedName);
  if (m) return { uploadedAt: Number(m[1]), name: m[2] };
  return { uploadedAt: 0, name: storedName };
}

function encPath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function repoPath(repo) {
  return '/repos/' + encPath(repo);
}

/* ---------------- vault storage ---------------- */

function loadVault() {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.cipher) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveVault(record) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(record));
}

function clearVault() {
  localStorage.removeItem(VAULT_KEY);
}

function clearSession() {
  vault = null;
}

/* ---------------- throttle ---------------- */

function readThrottle() {
  try {
    return JSON.parse(localStorage.getItem(THROTTLE_KEY)) || { fails: 0, until: 0 };
  } catch (_) {
    return { fails: 0, until: 0 };
  }
}

function registerFail() {
  const t = readThrottle();
  t.fails = (t.fails || 0) + 1;
  if (t.fails >= 5) {
    t.until = Date.now() + Math.min(30000 * Math.pow(2, t.fails - 5), 300000);
  }
  localStorage.setItem(THROTTLE_KEY, JSON.stringify(t));
}

function clearThrottle() {
  localStorage.removeItem(THROTTLE_KEY);
}

function throttleRemaining() {
  return Math.max(0, readThrottle().until - Date.now());
}

/* ---------------- github api ---------------- */

async function gh(path, { method = 'GET', body = null, raw = false, token } = {}) {
  const auth = token || (vault && vault.token);
  const headers = {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined
    });
  } catch (_) {
    throw new Error('Network error — check your internet connection.');
  }

  if (raw) {
    if (!res.ok) throw Object.assign(new Error(await apiErrorMessage(res)), { status: res.status });
    return res.blob();
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error((data && data.message) || `Request failed (${res.status})`), {
      status: res.status,
      data
    });
  }
  return data;
}

async function apiErrorMessage(res) {
  try {
    const data = await res.clone().json();
    return data.message || `Request failed (${res.status})`;
  } catch (_) {
    return `Request failed (${res.status})`;
  }
}

/* ---------------- screens ---------------- */

function showSetup(message = '') {
  app.classList.add('hidden');
  gate.classList.add('hidden');
  setupSection.classList.remove('hidden');
  setSetupError(message);
  if (message) toast('Vault needs attention', message, 'error');
  setTimeout(() => $('#setup-token').focus(), 60);
}

function showGate() {
  app.classList.add('hidden');
  setupSection.classList.add('hidden');
  gate.classList.remove('hidden');
  setGateError('');
  clearCode();
  syncUnlockState();
  setTimeout(() => codeBoxes[0].focus(), 60);
}

function sessionExpired(message) {
  clearSession();
  clearBlobs();
  clearVault();
  showSetup(message || 'Your saved GitHub token was rejected by GitHub. Paste a fresh token to reconnect.');
}

function setSetupError(message) {
  setupError.hidden = !message;
  setupError.textContent = message || '';
}

function handleError(err) {
  if (err && err.status === 401) {
    sessionExpired();
    return;
  }
  toast('Something went wrong', err && err.message ? err.message : 'Please try again.', 'error');
}

/* ---------------- setup flow ---------------- */

function humanRepoError(err) {
  if (err.status === 401) return 'GitHub rejected that token.';
  if (err.status === 404) return 'Repository not found, or this token cannot see it.';
  if (err.status === 403) return `Access denied: ${err.message}`;
  return err.message || 'Could not reach GitHub.';
}

function setSetupBusy(busy, label) {
  setupBtn.disabled = busy;
  setupBtn.querySelector('.btn-label').textContent = label || 'Create vault & unlock';
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setSetupError('');

  const repo = $('#setup-repo').value.trim();
  const token = $('#setup-token').value.trim();
  const pass = $('#setup-pass').value.trim();
  const pass2 = $('#setup-pass2').value.trim();

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return setSetupError('Repository must look like owner/name.');
  if (!token) return setSetupError('Paste your GitHub token.');
  if (!/^\d{6}$/.test(pass)) return setSetupError('Passcode must be exactly 6 digits.');
  if (pass !== pass2) return setSetupError('Passcodes do not match.');

  setSetupBusy(true, 'Checking repository…');
  try {
    let repoData;
    try {
      repoData = await gh(`/repos/${encPath(repo)}`, { token });
    } catch (err) {
      setSetupError(humanRepoError(err));
      return;
    }
    if (repoData.private === false) {
      setSetupError('Vault repository must be private — a public repo would expose your files.');
      return;
    }

    setSetupBusy(true, 'Checking permissions…');
    try {
      await gh(`/repos/${encPath(repo)}/contents`, { token });
    } catch (err) {
      if (err.status === 403) {
        setSetupError('Token needs “Contents: Read and write” permission on this repository.');
        return;
      }
      if (err.status !== 404) {
        setSetupError(humanRepoError(err));
        return;
      }
    }

    const branch = repoData.default_branch || 'main';

    setSetupBusy(true, 'Encrypting…');
    const cipher = await VaultCrypto.encryptSecret(pass, JSON.stringify({ token, repo, branch }));
    saveVault({ v: 1, cipher });
    clearThrottle();
    vault = { token, repo, branch };

    $('#setup-token').value = '';
    $('#setup-pass').value = '';
    $('#setup-pass2').value = '';
    setupForm.reset();
    $('#setup-repo').value = repo;
    setSetupError('');
    enterApp();
    toast('Vault connected', repo);
  } finally {
    setSetupBusy(false);
  }
});

/* ---------------- passcode gate ---------------- */

function readCode() {
  return codeBoxes.map((box) => box.value).join('');
}

function clearCode() {
  codeBoxes.forEach((box) => { box.value = ''; box.classList.remove('filled'); });
}

function syncUnlockState() {
  unlockBtn.disabled = readCode().length !== 6 || throttleRemaining() > 0;
}

function setGateError(message) {
  gateError.hidden = !message;
  gateError.textContent = message || '';
  codeRow.classList.toggle('is-error', Boolean(message));
  if (message) {
    codeRow.classList.add('shake');
    setTimeout(() => codeRow.classList.remove('shake'), 480);
  }
}

function resetGateSoon(ms) {
  setTimeout(() => {
    setGateError('');
    syncUnlockState();
  }, ms);
}

codeBoxes.forEach((box, index) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(0, 1);
    box.classList.toggle('filled', Boolean(box.value));
    if (box.value && index < codeBoxes.length - 1) codeBoxes[index + 1].focus();
    setGateError('');
    syncUnlockState();
    if (readCode().length === 6) passcodeForm.requestSubmit();
  });

  box.addEventListener('keydown', (event) => {
    if (event.key === 'Backspace' && !box.value && index > 0) {
      codeBoxes[index - 1].focus();
      codeBoxes[index - 1].value = '';
      codeBoxes[index - 1].classList.remove('filled');
      syncUnlockState();
    }
    if (event.key === 'ArrowLeft' && index > 0) codeBoxes[index - 1].focus();
    if (event.key === 'ArrowRight' && index < codeBoxes.length - 1) codeBoxes[index + 1].focus();
  });

  box.addEventListener('paste', (event) => {
    event.preventDefault();
    const digits = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
    digits.forEach((digit, i) => {
      if (codeBoxes[i]) {
        codeBoxes[i].value = digit;
        codeBoxes[i].classList.add('filled');
      }
    });
    const next = Math.min(digits.length, codeBoxes.length - 1);
    codeBoxes[next].focus();
    syncUnlockState();
    if (readCode().length === 6) passcodeForm.requestSubmit();
  });
});

passcodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const passcode = readCode();
  if (passcode.length !== 6) return;

  const wait = throttleRemaining();
  if (wait > 0) {
    setGateError(`Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`);
    resetGateSoon(wait);
    return;
  }

  const stored = loadVault();
  if (!stored) {
    showSetup('No vault found in this browser — set it up first.');
    return;
  }

  unlockBtn.disabled = true;
  const label = unlockBtn.querySelector('.btn-label');
  const original = label.textContent;
  label.textContent = 'Unlocking…';

  try {
    const plain = await VaultCrypto.decryptSecret(stored.cipher, passcode);
    if (!plain) {
      registerFail();
      const rem = throttleRemaining();
      clearCode();
      if (rem > 0) {
        setGateError(`Incorrect passcode. Locked for ${Math.ceil(rem / 1000)}s.`);
        resetGateSoon(rem);
      } else {
        setGateError('Incorrect passcode. Please try again.');
      }
      codeBoxes[0].focus();
      return;
    }

    let cfg;
    try {
      cfg = JSON.parse(plain);
    } catch (_) {
      clearVault();
      showSetup('Stored vault is corrupted — please set it up again.');
      return;
    }

    try {
      await gh('/user', { token: cfg.token });
    } catch (err) {
      if (err.status === 401) {
        clearVault();
        showSetup('Your saved GitHub token was rejected by GitHub. Paste a fresh token to reconnect.');
      } else {
        setGateError(err.message || 'Could not reach GitHub.');
        codeBoxes[0].focus();
      }
      return;
    }

    clearThrottle();
    vault = { token: cfg.token, repo: cfg.repo, branch: cfg.branch || 'main' };
    clearCode();
    enterApp();
  } finally {
    label.textContent = original;
    syncUnlockState();
  }
});

$('#reset-btn').addEventListener('click', () => {
  if (!window.confirm('Reset the vault stored in this browser? Your files stay in GitHub, but you will need your token and a new passcode.')) return;
  clearVault();
  clearThrottle();
  clearSession();
  showSetup('Vault reset. Enter your token and choose a new passcode.');
});

$('#logout-btn').addEventListener('click', () => {
  clearSession();
  clearBlobs();
  showGate();
  toast('Portal locked', 'Your token was cleared from memory.');
});

function enterApp() {
  setupSection.classList.add('hidden');
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  state.files = [];
  render();
  setView(state.view === 'list' ? 'list' : 'grid');
  refreshList({ silent: true }).catch(handleError);
}

/* ---------------- files ---------------- */

async function listFiles() {
  let data;
  try {
    data = await gh(`${repoPath(vault.repo)}/contents/files?ref=${encodeURIComponent(vault.branch)}`);
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry) => entry.type === 'file')
    .map((entry) => {
      const parsed = mapStoredName(entry.name);
      const ext = extOf(parsed.name);
      return {
        path: entry.path,
        sha: entry.sha,
        name: parsed.name,
        size: entry.size || 0,
        uploadedAt: parsed.uploadedAt,
        ext,
        kind: kindOf(ext)
      };
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function fetchMetaRecord() {
  let data;
  try {
    data = await gh(`${repoPath(vault.repo)}/contents/${encPath(META_PATH)}?ref=${encodeURIComponent(vault.branch)}`);
  } catch (err) {
    if (err.status === 404) return { sha: null, files: {} };
    throw err;
  }
  let files = {};
  try {
    const bytes = VaultCrypto.fromBase64(String(data.content || '').replace(/\s/g, ''));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed.files === 'object' && parsed.files) files = parsed.files;
  } catch (_) { /* corrupt manifest — treat as empty */ }
  return { sha: data.sha || null, files };
}

function applyMeta(files) {
  state.meta = new Map(Object.entries(files || {}));
}

async function loadMeta() {
  try {
    const record = await fetchMetaRecord();
    applyMeta(record.files);
  } catch (_) { /* keep previous metadata */ }
}

async function putMeta(files, sha) {
  const payload = JSON.stringify({ version: 1, files }, null, 2);
  const body = {
    message: 'meta: update ticket metadata',
    content: VaultCrypto.toBase64(new TextEncoder().encode(payload)),
    branch: vault.branch
  };
  if (sha) body.sha = sha;
  return gh(`${repoPath(vault.repo)}/contents/${encPath(META_PATH)}`, { method: 'PUT', body });
}

async function updateMeta(changes) {
  const record = await fetchMetaRecord();
  const files = { ...record.files };
  let changed = false;
  for (const [path, value] of Object.entries(changes)) {
    if (value === null) {
      if (files[path]) { delete files[path]; changed = true; }
    } else {
      files[path] = value;
      changed = true;
    }
  }
  if (!changed) return;

  try {
    await putMeta(files, record.sha);
  } catch (err) {
    if (err.status !== 409 && err.status !== 422) throw err;
    const fresh = await fetchMetaRecord();
    const retried = { ...fresh.files };
    for (const [path, value] of Object.entries(changes)) {
      if (value === null) delete retried[path];
      else retried[path] = value;
    }
    await putMeta(retried, fresh.sha);
    applyMeta(retried);
    return;
  }
  applyMeta(files);
}

function metaFor(path) {
  return state.meta.get(path) || null;
}

function metaSuffix(path) {
  const m = state.meta.get(path);
  if (!m) return '';
  return [m.type, m.name].filter(Boolean).map((v) => ` · ${v}`).join('');
}

function metaChips(path) {
  const m = state.meta.get(path);
  if (!m || (!m.name && !m.type)) return '';
  return `<div class="chips">${
    m.name ? `<span class="chip">${esc(m.name)}</span>` : ''
  }${
    m.type ? `<span class="chip chip-accent">${esc(m.type)}</span>` : ''
  }</div>`;
}

async function refreshList({ silent = false } = {}) {
  const files = await listFiles();
  state.files = files;
  await loadMeta();
  render();
  if (!silent) toast('List refreshed', `${files.length} file${files.length === 1 ? '' : 's'}`);
}

function visibleFiles() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.files;
  return state.files.filter((file) => {
    const m = metaFor(file.path);
    const haystack = `${file.name} ${m && m.name ? m.name : ''} ${m && m.type ? m.type : ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

function thumbMarkup(file) {
  if (file.kind === 'image') {
    return `<div class="thumb" data-preview="${esc(file.path)}"><img alt="${esc(file.name)}" data-src="${esc(file.path)}" loading="lazy" /></div>`;
  }
  const cls = file.kind === 'document' ? 'is-doc' : 'is-other';
  const label = (file.ext || 'FILE').toUpperCase().slice(0, 4);
  const previewable = file.kind === 'document';
  return `<div class="thumb" ${previewable ? `data-preview="${esc(file.path)}"` : ''}><div class="thumb-icon ${cls}">${esc(label)}</div></div>`;
}

function cardMarkup(file) {
  const previewable = file.kind === 'image' || file.kind === 'document';
  return `
    <article class="card" data-id="${esc(file.path)}">
      ${thumbMarkup(file)}
      <div class="file-body">
        <h3 class="file-name" title="${esc(file.name)}">${esc(file.name)}</h3>
        <p class="file-meta">${fmtBytes(file.size)} · ${fmtDate(file.uploadedAt)}${esc(metaSuffix(file.path))}</p>
        ${metaChips(file.path)}
        <span class="list-meta">${fmtBytes(file.size)} · ${fmtDate(file.uploadedAt)}${esc(metaSuffix(file.path))}</span>
        <div class="file-actions">
          <button class="btn btn-outline btn-sm" data-download="${esc(file.path)}">Download</button>
          ${previewable ? `<button class="btn btn-ghost btn-sm" data-preview="${esc(file.path)}">Preview</button>` : ''}
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm btn-danger-ghost" data-delete="${esc(file.path)}" aria-label="Delete ${esc(file.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
          </button>
        </div>
      </div>
    </article>`;
}

function render() {
  const list = visibleFiles();
  filesEl.innerHTML = list.map(cardMarkup).join('');
  hydrateThumbs();

  const hasAny = state.files.length > 0;
  emptyEl.classList.toggle('is-visible', !hasAny);
  filesEl.style.display = list.length ? '' : 'none';

  const counter = $('#result-count');
  if (state.query.trim() && hasAny) {
    counter.hidden = false;
    counter.textContent = `${list.length} of ${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
  } else {
    counter.hidden = true;
  }

  $('#stat-count').textContent = state.files.length;
  $('#stat-size').textContent = fmtBytes(state.files.reduce((sum, f) => sum + (f.size || 0), 0));
}

function hydrateThumbs() {
  $$('.thumb img[data-src]', filesEl).forEach((img) => {
    const path = img.getAttribute('data-src');
    ensureBlob(path)
      .then((url) => { if (img.isConnected) img.src = url; })
      .catch(() => { /* keep placeholder */ });
  });
}

function setView(view) {
  state.view = view;
  localStorage.setItem('atp.view', view);
  filesEl.dataset.view = view;
  $('#view-grid').classList.toggle('is-active', view === 'grid');
  $('#view-list').classList.toggle('is-active', view === 'list');
}

$('#view-grid').addEventListener('click', () => setView('grid'));
$('#view-list').addEventListener('click', () => setView('list'));

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  render();
});

$('#refresh-btn').addEventListener('click', async () => {
  if (state.busy) return;
  try {
    await refreshList();
  } catch (err) {
    handleError(err);
  }
});

filesEl.addEventListener('click', async (event) => {
  const deleteBtn = event.target.closest('[data-delete]');
  if (deleteBtn) {
    const path = deleteBtn.getAttribute('data-delete');
    const file = state.files.find((f) => f.path === path);
    if (!file) return;
    if (!window.confirm(`Delete “${file.name}”? This removes it from Git history view but the commit stays.`)) return;
    deleteBtn.disabled = true;
    try {
      await gh(`${repoPath(vault.repo)}/contents/${encPath(path)}`, {
        method: 'DELETE',
        body: { message: `delete ${file.name}`, sha: file.sha, branch: vault.branch }
      });
      revokeBlob(path);
      state.files = state.files.filter((f) => f.path !== path);
      if (state.meta.has(path)) {
        updateMeta({ [path]: null })
          .then(() => render())
          .catch((mErr) => toast('File deleted, metadata kept', mErr.message || 'Could not update manifest.', 'error'));
      }
      render();
      toast('File deleted', file.name);
    } catch (err) {
      deleteBtn.disabled = false;
      handleError(err);
    }
    return;
  }

  const downloadBtn = event.target.closest('[data-download]');
  if (downloadBtn) {
    downloadBtn.disabled = true;
    try {
      await saveFile(downloadBtn.getAttribute('data-download'));
    } catch (err) {
      handleError(err);
    } finally {
      downloadBtn.disabled = false;
    }
    return;
  }

  const previewBtn = event.target.closest('[data-preview]');
  if (previewBtn) {
    const path = previewBtn.getAttribute('data-preview');
    if (path) openPreview(path);
  }
});

/* ---------------- blob cache ---------------- */

const blobCache = new Map(); // path -> { promise, url? }

function evictBlobs() {
  const resolved = [...blobCache.entries()].filter(([, entry]) => entry.url);
  if (resolved.length <= BLOB_CACHE_MAX) return;
  resolved.slice(0, resolved.length - BLOB_CACHE_MAX).forEach(([path, entry]) => {
    URL.revokeObjectURL(entry.url);
    blobCache.delete(path);
  });
}

function ensureBlob(path) {
  const cached = blobCache.get(path);
  if (cached) return cached.promise;

  const promise = gh(`${repoPath(vault.repo)}/contents/${encPath(path)}`, { raw: true })
    .then((raw) => {
      // GitHub raw often returns application/octet-stream — browsers need the
      // real type (esp. application/pdf) or previews render blank.
      const blob = new Blob([raw], { type: mimeOf(extOf(path)) });
      const url = URL.createObjectURL(blob);
      blobCache.set(path, { promise, url });
      evictBlobs();
      return url;
    })
    .catch((err) => {
      blobCache.delete(path);
      throw err;
    });

  blobCache.set(path, { promise });
  return promise;
}

function revokeBlob(path) {
  const entry = blobCache.get(path);
  if (entry && entry.url) URL.revokeObjectURL(entry.url);
  blobCache.delete(path);
}

function clearBlobs() {
  blobCache.forEach((entry) => entry.url && URL.revokeObjectURL(entry.url));
  blobCache.clear();
}

async function saveFile(path) {
  const file = state.files.find((f) => f.path === path);
  const url = await ensureBlob(path);
  const link = document.createElement('a');
  link.href = url;
  link.download = file ? file.name : 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* ---------------- lightbox ---------------- */

async function openPreview(path) {
  const file = state.files.find((f) => f.path === path);
  if (!file) return;
  const token = ++previewToken;

  $('#lb-name').textContent = file.name;
  $('#lb-sub').textContent = `${fmtBytes(file.size)} · ${fmtDate(file.uploadedAt)}${metaSuffix(path)}`;
  const download = $('#lb-download');
  download.removeAttribute('href');
  download.setAttribute('aria-disabled', 'true');

  const body = $('#lb-body');
  body.innerHTML = '<div class="fallback">Loading preview…</div>';
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#lb-close').focus();

  let url;
  try {
    url = await ensureBlob(path);
  } catch (err) {
    if (token !== previewToken) return;
    body.innerHTML = `<div class="fallback"><p><strong>${esc(file.name)}</strong></p><p>${esc(err.message || 'Could not load file.')}</p></div>`;
    return;
  }
  if (token !== previewToken || lightbox.hidden) return;

  download.href = url;
  download.setAttribute('download', file.name);
  download.removeAttribute('aria-disabled');

  const openBtn = $('#lb-open');
  openBtn.hidden = file.ext !== 'pdf';
  openBtn.onclick = () => window.open(url, '_blank', 'noopener');

  if (file.kind === 'image') {
    body.innerHTML = `<img src="${url}" alt="${esc(file.name)}" />`;
  } else if (file.ext === 'pdf') {
    body.innerHTML = `<iframe src="${url}" title="${esc(file.name)}"></iframe>`;
  } else if (file.kind === 'video') {
    body.innerHTML = `<video src="${url}" controls autoplay></video>`;
  } else if (file.kind === 'audio') {
    body.innerHTML = `<audio src="${url}" controls style="width:min(420px,86%)"></audio>`;
  } else {
    body.innerHTML = `<div class="fallback">
      <p><strong>${esc(file.name)}</strong></p>
      <p>Preview is not available for this file type.</p>
      <button class="btn btn-primary btn-sm" id="lb-fallback-download">Download file</button>
    </div>`;
    const fb = $('#lb-fallback-download');
    if (fb) fb.addEventListener('click', () => saveFile(path).catch(handleError));
  }
}

function closePreview() {
  previewToken++;
  lightbox.hidden = true;
  $('#lb-body').innerHTML = '';
  document.body.style.overflow = '';
}

$('#lb-close').addEventListener('click', closePreview);
lightbox.addEventListener('click', (event) => {
  if (event.target.hasAttribute('data-close')) closePreview();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !lightbox.hidden) closePreview();
});

/* ---------------- uploads ---------------- */

function setDropStatus(message, isError = false) {
  if (!message) {
    dropStatus.hidden = true;
    dropStatus.textContent = '';
    dropStatus.classList.remove('is-error');
    return;
  }
  dropStatus.hidden = false;
  dropStatus.textContent = message;
  dropStatus.classList.toggle('is-error', isError);
}

function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(file);
  });
}

async function putFile(file, storedName, onProgress) {
  const bytes = await readFileBytes(file);
  let content;
  try {
    content = VaultCrypto.toBase64(bytes);
  } catch (_) {
    throw new Error(`Could not encode ${file.name}`);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API_BASE}${repoPath(vault.repo)}/contents/${encPath('files/' + storedName)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${vault.token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) { /* noop */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data && data.content);
      } else {
        reject(Object.assign(new Error((data && data.message) || `Upload failed (${xhr.status})`), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(JSON.stringify({ message: `add ${safeName(file.name)}`, content, branch: vault.branch }));
  });
}

async function uploadFiles(fileList) {
  const all = Array.from(fileList || []);
  if (!all.length) return;
  if (!vault) return;
  if (state.busy) {
    toast('An upload is already in progress', 'Please wait for it to finish.', 'error');
    return;
  }

  const accepted = [];
  const rejected = [];
  for (const file of all) {
    const ext = extOf(file.name);
    if (file.size > MAX_FILE_BYTES) rejected.push(`${file.name} (over 25 MB)`);
    else if (!ALLOWED_EXTS.includes(ext)) rejected.push(`${file.name} (unsupported type)`);
    else accepted.push(file);
  }

  if (!accepted.length) {
    toast('No files uploaded', rejected.slice(0, 3).join(', ') || 'Nothing suitable selected.', 'error');
    fileInput.value = '';
    return;
  }

  const metaName = $('#ticket-name').value.trim().slice(0, 80);
  const metaType = $('#ticket-type').value;
  const metaEntries = {};

  state.busy = true;
  progressEl.hidden = false;
  progressBar.style.width = '0%';

  const ok = [];
  const failures = [];

  try {
    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      setDropStatus(`Uploading ${i + 1} of ${accepted.length}: ${file.name}`);
      try {
        const created = await putFile(file, makeStoredName(file.name), (frac) => {
          progressBar.style.width = `${Math.round(((i + frac) / accepted.length) * 100)}%`;
        });
        ok.push(file.name);
        if ((metaName || metaType) && created && created.path) {
          metaEntries[created.path] = { name: metaName, type: metaType };
        }
      } catch (err) {
        if (err.status === 401) {
          sessionExpired('Your GitHub token was rejected during upload. Paste a fresh token to reconnect.');
          fileInput.value = '';
          return;
        }
        failures.push(`${file.name}: ${err.message}`);
      }
      if (i < accepted.length - 1) await sleep(UPLOAD_DELAY_MS);
    }

    if (Object.keys(metaEntries).length) {
      try {
        await updateMeta(metaEntries);
        $('#ticket-name').value = '';
      } catch (mErr) {
        toast('Ticket details not saved', mErr.message || 'Metadata update failed.', 'error');
      }
    }

    if (ok.length) {
      await refreshList({ silent: true });
      setDropStatus(`Uploaded ${ok.length} file${ok.length === 1 ? '' : 's'}.`);
      toast('Upload complete', ok.slice(0, 2).join(', ') + (ok.length > 2 ? ` +${ok.length - 2} more` : ''));
      setTimeout(() => setDropStatus(''), 5000);
    }
    if (failures.length) {
      setDropStatus(`${failures.length} upload${failures.length === 1 ? '' : 's'} failed.`, true);
      toast('Upload failed', failures.slice(0, 2).join(' · '), 'error');
    }
    if (rejected.length) {
      toast('Some files were skipped', rejected.slice(0, 3).join(', '), 'error');
    }
  } finally {
    state.busy = false;
    progressEl.hidden = true;
    progressBar.style.width = '0%';
    fileInput.value = '';
  }
}

['dragenter', 'dragover'].forEach((type) => {
  dropPanel.addEventListener(type, (event) => {
    event.preventDefault();
    dropPanel.classList.add('is-dragging');
  });
});

['dragleave', 'drop'].forEach((type) => {
  dropPanel.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === 'dragleave' && dropPanel.contains(event.relatedTarget)) return;
    dropPanel.classList.remove('is-dragging');
  });
});

dropPanel.addEventListener('drop', (event) => uploadFiles(event.dataTransfer.files));
dropPanel.addEventListener('click', (event) => {
  if (event.target.closest('button, a, input, select, label, .upload-fields')) return;
  fileInput.click();
});
$('#browse-btn').addEventListener('click', (event) => {
  event.stopPropagation();
  fileInput.click();
});
$('#select-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  uploadFiles(fileInput.files);
  fileInput.value = '';
});

/* ---------------- boot ---------------- */

(function boot() {
  setView(state.view);
  if (loadVault()) showGate();
  else showSetup();
})();
