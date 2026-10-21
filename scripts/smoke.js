'use strict';

const BASE = 'http://localhost:3000';
const PASS = process.argv[2] || '800140';

function cookieOf(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return raw.map((c) => String(c).split(';')[0]).join('; ');
}

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    body,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    redirect: 'manual'
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* ignore */ }
  return { status: res.status, data, cookie: cookieOf(res), headers: res.headers };
}

function multipart(files) {
  const boundary = '----smoke' + Date.now();
  const parts = [];
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  // static
  const index = await fetch(BASE + '/');
  check('GET / serves portal HTML', index.ok && (await index.text()).includes('Austria Ticket Portal'));

  // wrong passcode
  const bad = await call('/api/login', { method: 'POST', body: JSON.stringify({ passcode: '000000' }), headers: { 'content-type': 'application/json' } });
  check('wrong passcode rejected', bad.status === 401, `status=${bad.status}`);

  // correct passcode
  const good = await call('/api/login', { method: 'POST', body: JSON.stringify({ passcode: PASS }), headers: { 'content-type': 'application/json' } });
  const cookie = good.cookie;
  check('correct passcode accepted', good.status === 200 && cookie.includes('austria_sid'), `status=${good.status}`);
  check('cookie is httpOnly+SameSite=Strict', /HttpOnly/i.test(good.headers.get('set-cookie') || '') && /SameSite=Strict/i.test(good.headers.get('set-cookie') || ''));

  // session
  const sess = await call('/api/session', { cookie });
  check('session restores files list', sess.status === 200 && Array.isArray(sess.data.files));

  // upload
  const { body, contentType } = multipart([
    { name: 'boarding-pass.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') },
    { name: 'alps.png', type: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }
  ]);
  const up = await call('/api/files', { method: 'POST', body, cookie, headers: { 'content-type': contentType } });
  check('upload accepts pdf+png', up.status === 201 && up.data.files.length === 2, `status=${up.status}`);
  const ids = up.data.files.map((f) => f.id);

  // list
  const list = await call('/api/files', { cookie });
  check('list shows uploaded files', list.status === 200 && list.data.files.length === 2, `count=${list.data.files.length}`);

  // download
  const dl = await fetch(`${BASE}/api/files/${ids[0]}`, { headers: { cookie } });
  check('download works', dl.status === 200 && dl.headers.get('content-type') === 'application/pdf', `type=${dl.headers.get('content-type')}`);

  // inline preview
  const inline = await fetch(`${BASE}/api/files/${ids[1]}?disposition=inline`, { headers: { cookie } });
  check('inline preview serves image', inline.status === 200 && inline.headers.get('content-type') === 'image/png' && /inline/i.test(inline.headers.get('content-disposition') || ''));

  // unauthenticated blocked
  const anon = await call('/api/files');
  check('unauthenticated blocked', anon.status === 401);

  // unsupported type
  const badUp = await multipart([{ name: 'malware.exe', type: 'application/octet-stream', data: Buffer.from('MZ') }]);
  const badFile = await call('/api/files', { method: 'POST', body: badUp.body, cookie, headers: { 'content-type': badUp.contentType } });
  check('unsupported type rejected', badFile.status === 415, `status=${badFile.status}`);

  // delete
  const del = await call(`/api/files/${ids[0]}`, { method: 'DELETE', cookie });
  check('delete works', del.status === 200);

  // logout
  const out = await call('/api/logout', { method: 'POST', body: '{}', cookie, headers: { 'content-type': 'application/json' } });
  check('logout clears session', out.status === 200);
  const after = await call('/api/session', { cookie });
  check('session invalid after logout', after.status === 401);

  // cleanup remaining files
  const relogin = await call('/api/login', { method: 'POST', body: JSON.stringify({ passcode: PASS }), headers: { 'content-type': 'application/json' } });
  const cur = await call('/api/files', { cookie: relogin.cookie });
  for (const file of cur.data.files || []) {
    await call(`/api/files/${file.id}`, { method: 'DELETE', cookie: relogin.cookie });
  }
  check('cleanup left vault empty', (await call('/api/files', { cookie: relogin.cookie })).data.files.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
