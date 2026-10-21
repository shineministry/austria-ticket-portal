'use strict';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = process.env.VAULT_REPO || 'shineministry/austria-ticket-portal-data';
const API = 'https://api.github.com';
const ORIGIN = 'https://austria-travel.shine-ministry.com';

if (!TOKEN) {
  console.log('SKIPPED  GH_TOKEN / GITHUB_TOKEN not set — GitHub API test not run.');
  process.exit(0);
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra
  };
}

function encPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, opts);
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}

function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return Buffer.from(bin, 'binary').toString('base64');
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cleanup(path, sha) {
  try {
    await api(`/repos/${encPath(REPO)}/contents/${encPath(path)}`, {
      method: 'DELETE',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: `cleanup ${path}`, sha, branch: 'main' })
    });
  } catch (_) { /* best effort */ }
}

(async () => {
  let branch = 'main';

  // 1. repo access + privacy + default branch
  const repo = await api(`/repos/${encPath(REPO)}`, { headers: headers() });
  check('GET /repos repo reachable', repo.status === 200, `status ${repo.status}`);
  check('vault repo is private', repo.data && repo.data.private === true);
  branch = (repo.data && repo.data.default_branch) || 'main';

  // 2. contents root readable (token has Contents: Read at minimum)
  const root = await api(`/repos/${encPath(REPO)}/contents`, { headers: headers() });
  check('GET /contents root readable (404 ok if empty repo)', root.status === 200 || root.status === 404, `status ${root.status}`);

  // 3. list files/ (404 means empty dir — app treats as no files)
  const before = await api(`/repos/${encPath(REPO)}/contents/files?ref=${branch}`, { headers: headers() });
  check('list files/ works or 404 when empty', before.status === 200 || before.status === 404, `status ${before.status}`);

  // 4. upload small text file (mimics app PUT)
  const stamp = Date.now();
  const textName = `files/__smoke__${stamp}-abcd__smoke test #1~café.txt`;
  const textPayload = 'hello austria — smoke test';
  const textPut = await api(`/repos/${encPath(REPO)}/contents/${encPath(textName)}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message: 'smoke: add text', content: Buffer.from(textPayload).toString('base64'), branch })
  });
  check('PUT upload (special chars in name)', textPut.status === 201, `status ${textPut.status}`);
  const textSha = textPut.data && textPut.data.content && textPut.data.content.sha;

  // 5. listing reflects upload, size correct
  const list = await api(`/repos/${encPath(REPO)}/contents/files?ref=${branch}`, { headers: headers() });
  const listed = Array.isArray(list.data) && list.data.find((e) => e.path === textName);
  check('uploaded file appears in list', Boolean(listed), listed ? `size ${listed.size}` : 'not found');
  check('listed size matches payload', listed && listed.size === Buffer.byteLength(textPayload));

  // 6. raw download via Accept: application/vnd.github.raw+json
  const rawRes = await fetch(`${API}/repos/${encPath(REPO)}/contents/${encPath(textName)}?ref=${branch}`, {
    headers: headers({ Accept: 'application/vnd.github.raw+json' })
  });
  const rawText = await rawRes.text();
  check('raw download returns exact bytes', rawRes.status === 200 && rawText === textPayload, `status ${rawRes.status}`);

  // 7. CORS preflight like the browser will send
  const pre = await fetch(API + `/repos/${encPath(REPO)}/contents/${encPath(textName)}`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization,content-type,accept,x-github-api-version'
    }
  });
  const acao = pre.headers.get('access-control-allow-origin');
  const acrh = pre.headers.get('access-control-allow-headers') || '';
  check('CORS preflight allowed', (pre.status === 200 || pre.status === 204) && acao === '*', `status ${pre.status}, ACAO ${acao}`);
  check('CORS allows Authorization header', /authorization/i.test(acrh), acrh || '(none)');

  // 8. delete with sha (portal delete flow)
  if (textSha) {
    const del = await api(`/repos/${encPath(REPO)}/contents/${encPath(textName)}`, {
      method: 'DELETE',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: 'smoke: delete text', sha: textSha, branch })
    });
    check('DELETE with sha', del.status === 200, `status ${del.status}`);
  } else {
    check('DELETE with sha', false, 'no sha from PUT');
  }

  // 9. binary roundtrip (512 KB random) — base64 integrity through API
  const binName = `files/__smoke__${stamp}-ef01__binary.bin`;
  const binBytes = new Uint8Array(512 * 1024);
  for (let off = 0; off < binBytes.length; off += 65536) {
    crypto.getRandomValues(binBytes.subarray(off, Math.min(off + 65536, binBytes.length)));
  }
  const binPut = await api(`/repos/${encPath(REPO)}/contents/${encPath(binName)}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message: 'smoke: add binary', content: toBase64(binBytes), branch })
  });
  check('PUT 512KB binary upload', binPut.status === 201, `status ${binPut.status}`);
  const binSha = binPut.data && binPut.data.content && binPut.data.content.sha;

  const binRaw = await fetch(`${API}/repos/${encPath(REPO)}/contents/${encPath(binName)}?ref=${branch}`, {
    headers: headers({ Accept: 'application/vnd.github.raw+json' })
  });
  const binGot = new Uint8Array(await binRaw.arrayBuffer());
  const gotHash = await sha256Hex(binGot);
  const wantHash = await sha256Hex(binBytes);
  check('binary raw download sha256 matches', binRaw.status === 200 && gotHash === wantHash, `status ${binRaw.status}`);

  if (binSha) await cleanup(binName, binSha);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
