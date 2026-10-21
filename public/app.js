'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  files: [],
  view: localStorage.getItem('atp.view') || 'grid',
  query: '',
  busy: false
};

const gate = $('#gate');
const app = $('#app');
const codeBoxes = $$('.code-box');
const codeRow = $('#code-row');
const gateError = $('#gate-error');
const passcodeForm = $('#passcode-form');
const unlockBtn = $('#unlock-btn');
const filesEl = $('#files');
const emptyEl = $('#empty');
const searchInput = $('#search-input');
const dropPanel = $('#drop-panel');
const fileInput = $('#file-input');
const progressBar = $('#progress-bar');
const progressEl = $('#progress');
const dropStatus = $('#drop-status');

/* ---------------- helpers ---------------- */

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function fmtDate(ts) {
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
  }, 3800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------------- auth ---------------- */

function readCode() {
  return codeBoxes.map((box) => box.value).join('');
}

function syncUnlockState() {
  unlockBtn.disabled = readCode().length !== 6;
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

  unlockBtn.disabled = true;
  const label = unlockBtn.querySelector('.btn-label');
  const original = label.textContent;
  label.textContent = 'Checking…';

  try {
    const data = await api('api/login', { method: 'POST', body: JSON.stringify({ passcode }) });
    codeBoxes.forEach((box) => { box.value = ''; box.classList.remove('filled'); });
    enterApp(data.files || [], data.stats);
  } catch (err) {
    if (err.status === 401) {
      setGateError('Incorrect passcode. Please try again.');
    } else {
      setGateError(err.message || 'Unable to sign in right now.');
    }
    codeBoxes.forEach((box) => { box.value = ''; box.classList.remove('filled'); });
    codeBoxes[0].focus();
    syncUnlockState();
  } finally {
    label.textContent = original;
    syncUnlockState();
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('api/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  showGate();
  toast('Signed out', 'Your session has been closed.');
});

function showGate() {
  app.classList.add('hidden');
  gate.classList.remove('hidden');
  setGateError('');
  setTimeout(() => codeBoxes[0].focus(), 60);
}

function enterApp(files, stats) {
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  state.files = Array.isArray(files) ? files : [];
  if (stats) {
    $('#stat-count').textContent = stats.count;
    $('#stat-size').textContent = fmtBytes(stats.bytes);
  }
  render();
  if (state.view === 'list') setView('list'); else setView('grid');
}

/* ---------------- files ---------------- */

function visibleFiles() {
  const q = state.query.trim().toLowerCase();
  return state.files.filter((file) => (q ? file.name.toLowerCase().includes(q) : true));
}

function thumbMarkup(file) {
  const url = `api/files/${file.id}?disposition=inline`;
  if (file.kind === 'image') {
    return `<div class="thumb" data-preview="${file.id}"><img src="${url}" alt="${esc(file.name)}" loading="lazy" /></div>`;
  }
  const cls = file.kind === 'document' ? 'is-doc' : 'is-other';
  const label = (file.ext || 'FILE').toUpperCase().slice(0, 4);
  return `<div class="thumb" data-preview="${file.kind === 'document' ? file.id : ''}"><div class="thumb-icon ${cls}">${esc(label)}</div></div>`;
}

function cardMarkup(file) {
  return `
    <article class="card" data-id="${file.id}">
      ${thumbMarkup(file)}
      <div class="file-body">
        <h3 class="file-name" title="${esc(file.name)}">${esc(file.name)}</h3>
        <p class="file-meta">${fmtBytes(file.size)} · ${fmtDate(file.uploadedAt)}</p>
        <span class="list-meta">${fmtBytes(file.size)} · ${fmtDate(file.uploadedAt)}</span>
        <div class="file-actions">
          <a class="btn btn-outline btn-sm" href="api/files/${file.id}" download>Download</a>
          ${file.kind === 'image' || file.kind === 'document'
            ? `<button class="btn btn-ghost btn-sm" data-preview="${file.id}">Preview</button>` : ''}
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm btn-danger-ghost" data-delete="${file.id}" aria-label="Delete ${esc(file.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
          </button>
        </div>
      </div>
    </article>`;
}

function render() {
  const list = visibleFiles();
  filesEl.innerHTML = list.map(cardMarkup).join('');

  const hasAny = state.files.length > 0;
  const hasVisible = list.length > 0;
  emptyEl.classList.toggle('is-visible', !hasAny);
  filesEl.style.display = hasVisible ? '' : 'none';

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
  try {
    const data = await api('api/files');
    state.files = data.files || [];
    render();
    toast('List refreshed');
  } catch (err) {
    handleError(err);
  }
});

filesEl.addEventListener('click', async (event) => {
  const deleteBtn = event.target.closest('[data-delete]');
  if (deleteBtn) {
    const id = deleteBtn.getAttribute('data-delete');
    const file = state.files.find((f) => f.id === id);
    if (!file) return;
    if (!window.confirm(`Delete “${file.name}”? This cannot be undone.`)) return;
    deleteBtn.disabled = true;
    try {
      await api(`api/files/${id}`, { method: 'DELETE' });
      state.files = state.files.filter((f) => f.id !== id);
      render();
      toast('File deleted', file.name);
    } catch (err) {
      deleteBtn.disabled = false;
      handleError(err);
    }
    return;
  }

  const previewBtn = event.target.closest('[data-preview]');
  if (previewBtn) {
    const id = previewBtn.getAttribute('data-preview');
    if (id) openPreview(id);
  }
});

/* ---------------- lightbox ---------------- */

const lightbox = $('#lightbox');

function openPreview(id) {
  const file = state.files.find((f) => f.id === id);
  if (!file) return;
  $('#lb-name').textContent = file.name;
  $('#lb-sub').textContent = `${fmtBytes(file.size)} · ${fmtDate(file.uploadedAt)}`;
  $('#lb-download').href = `api/files/${file.id}`;

  const body = $('#lb-body');
  const url = `api/files/${file.id}?disposition=inline`;
  if (file.kind === 'image') {
    body.innerHTML = `<img src="${url}" alt="${esc(file.name)}" />`;
  } else if (file.ext === 'pdf') {
    body.innerHTML = `<iframe src="${url}" title="${esc(file.name)}"></iframe>`;
  } else if (file.kind === 'video') {
    body.innerHTML = `<video src="${url}" controls autoplay></video>`;
  } else {
    body.innerHTML = `<div class="fallback">
      <p><strong>${esc(file.name)}</strong></p>
      <p>Preview is not available for this file type.</p>
      <a class="btn btn-primary btn-sm" href="api/files/${file.id}">Download file</a>
    </div>`;
  }
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#lb-close').focus();
}

function closePreview() {
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

function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (state.busy) {
    toast('An upload is already in progress', 'Please wait for it to finish.', 'error');
    return;
  }

  const form = new FormData();
  files.forEach((file) => form.append('files', file));

  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'api/files');
  xhr.withCredentials = true;

  state.busy = true;
  progressEl.hidden = false;
  progressBar.style.width = '0%';
  setDropStatus(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);

  xhr.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const pct = Math.round((event.loaded / event.total) * 100);
    progressBar.style.width = `${pct}%`;
  });

  const done = (message, isError = false) => {
    state.busy = false;
    progressEl.hidden = true;
    progressBar.style.width = '0%';
    setDropStatus(message, isError);
    if (message) setTimeout(() => setDropStatus(''), 5000);
  };

  xhr.addEventListener('load', () => {
    let data = null;
    try { data = JSON.parse(xhr.responseText); } catch (_) { /* noop */ }
    if (xhr.status === 401) {
      done('Session expired. Please sign in again.', true);
      showGate();
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      const added = data.files || [];
      state.files = [...added, ...state.files];
      render();
      done(`Uploaded ${added.length} file${added.length === 1 ? '' : 's'}.`);
      toast(`Upload complete`, added.map((f) => f.name).slice(0, 2).join(', ') + (added.length > 2 ? ` +${added.length - 2} more` : ''));
      if (data.rejected && data.rejected.length) {
        toast('Some files were skipped', data.rejected.map((r) => `${r.name} (${r.reason})`).join(', '), 'error');
      }
    } else {
      const message = (data && data.error) || 'Upload failed.';
      done(message, true);
      toast('Upload failed', message, 'error');
    }
    fileInput.value = '';
  });

  xhr.addEventListener('error', () => {
    done('Network error during upload.', true);
    toast('Upload failed', 'Network error.', 'error');
    fileInput.value = '';
  });

  xhr.send(form);
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
  if (event.target.closest('button, a, input')) return;
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

function handleError(err) {
  if (err && err.status === 401) {
    showGate();
    return;
  }
  toast('Something went wrong', err && err.message ? err.message : 'Please try again.', 'error');
}

(async function boot() {
  codeBoxes[0].focus();
  try {
    const data = await api('api/session');
    enterApp(data.files || [], data.stats);
  } catch (_) {
    showGate();
  }
})();
