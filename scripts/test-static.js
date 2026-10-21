'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// local src/href refs must resolve to files next to index.html (GitHub Pages serves repo root)
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#|mailto:)/.test(u));
for (const ref of refs) {
  check(`asset exists: ${ref}`, fs.existsSync(path.join(root, ref)));
}

// no root-absolute local paths (they break Pages subpaths and custom-domain root differently)
const absRefs = refs.filter((r) => r.startsWith('/'));
check('no root-absolute local asset paths', absRefs.length === 0, absRefs.join(', '));

// old Node endpoints must be gone
check('no /api/ fetches in app.js', !/['"`]\/?api\//.test(appJs));
check('app.js talks to api.github.com', appJs.includes('https://api.github.com'));

// CSP allows only GitHub API
const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
check('CSP present', csp.length > 0);
check('CSP connect-src limited to api.github.com', /connect-src https:\/\/api\.github\.com/.test(csp) && !/connect-src[^;]*\*/.test(csp));

// crypto module is loaded before app.js
check('vault-crypto.js loaded before app.js', html.indexOf('vault-crypto.js') < html.indexOf('app.js') && html.includes('vault-crypto.js'));

// Pages specifics
check('.nojekyll present (disables Jekyll processing)', fs.existsSync(path.join(root, '.nojekyll')));
const cname = fs.existsSync(path.join(root, 'CNAME')) ? fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim() : '';
check('CNAME has custom domain', cname === 'austria-travel.shine-ministry.com', cname || '(empty)');

// no server leftovers
check('no server.js', !fs.existsSync(path.join(root, 'server.js')));
check('no node_modules committed', !fs.existsSync(path.join(root, 'node_modules')));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
