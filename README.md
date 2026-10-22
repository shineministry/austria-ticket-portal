# Austria Ticket Portal

A small, light-mode file portal for storing and sharing travel tickets, boarding passes, PDFs and images — **deployed entirely on GitHub, with no server to host or maintain.**

- **Frontend:** static site on GitHub Pages — <https://austria-travel.shine-ministry.com>
- **Storage:** a private GitHub repository (`shineministry/austria-ticket-portal-data`) via the GitHub REST API
- **Access:** 6-digit passcode unlocks a token that is AES-GCM encrypted and kept only in your browser

## How it works

```
Browser ──(passcode)──► decrypt token (PBKDF2 + AES-GCM, localStorage)
   │
   └──► api.github.com ──► private repo ──► files/ (uploaded tickets & documents)
```

There is no backend. `index.html` / `app.js` / `styles.css` are served by GitHub Pages. All file operations (list, upload, download, delete) go directly from your browser to `api.github.com` using a fine-grained personal access token.

## First-time setup

1. **Create a private vault repository** (already done for this project):
   `shineministry/austria-ticket-portal-data` — must be **private**; the portal refuses public repos.
2. **Create a fine-grained personal access token**
   (<https://github.com/settings/personal-access-tokens/new>):
   - Resource owner: your account
   - Repository access: *Only select repositories* → the vault repo
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: short (30–90 days recommended)
3. **Open the portal** — the first-run setup screen appears:
   - Vault repository: `owner/vault-repo`
   - Paste the token
   - Choose a **6-digit passcode** and confirm it
4. *Create vault & unlock* — the token is encrypted with your passcode and stored in `localStorage`. The token is **never** stored in the repo, in plaintext, or on any server.

After setup, unlocking only needs the 6-digit passcode.

## Security model (read this)

- **Passcode:** 6 digits, so ~20 bits of entropy. It is stretched with PBKDF2-SHA256 (600k iterations) and unlocks the encrypted token. Client-side throttling (exponential backoff) slows guessing in the browser, but someone with full access to your browser profile could attempt an offline brute-force of the stored ciphertext — for this reason:
  - use a **fine-grained token scoped only to the vault repo** with Contents read/write, and
  - give it a **short expiration**; the portal will ask for a fresh token when the old one stops working.
- **Token storage:** AES-256-GCM ciphertext in `localStorage` (key `atp.vault.v1`). “Reset this browser’s vault” or “Lock portal” clears it from the browser; the token itself must be revoked at GitHub if compromised.
- **Transport:** everything happens over HTTPS to `api.github.com`; the site's CSP allows connections only to `api.github.com`.
- **Files:** stored as git blobs in a private repo. Anyone with read access to that repo can see the files; git history retains deleted files (deletion removes them from the latest tree).

## Ticket details (Name & Ticket type)

Uploads are **staged, not immediate**: drop or pick files → they wait in a queue → fill in **Name** (traveler or label) and **Ticket type** (Flight, Train, Bus, …) → press **Save & upload**. Details apply to every file in that batch and are saved in **`ticket-meta.json`** at the root of the vault repo (a small manifest mapping each file to its metadata — no server needed). Metadata shows on file cards and in search; the **Details** button on any card edits or removes it later, and it is cleaned up automatically when you delete a file.

## Limits

| Limit | Value | Why |
|---|---|---|
| Max file size | 25 MB | GitHub Contents API JSON/base64 upload practical limit |
| Allowed types | images, PDF, docs, archives, mp4/mp3/wav… | extension whitelist in `app.js` |
| Files listed | up to 1,000 | GitHub contents listing is not paginated |
| API rate | 5,000 requests/hour (authenticated) | per GitHub PAT |
| Upload spacing | ~350 ms between files | avoids GitHub secondary rate limits |

## Local development

Any static file server works — the site is three files plus one script:

```bash
npm run serve        # npx http-server on http://localhost:8080
# or: python -m http.server 8080
```

Web Crypto (`crypto.subtle`) requires a secure context — `localhost` and HTTPS are fine; opening `index.html` via `file://` will not work.

## Tests

```bash
npm test             # crypto + static checks + live GitHub API checks
npm run test:crypto  # PBKDF2/AES-GCM roundtrip, tamper rejection (no network)
npm run test:static  # relative assets, CSP, no leftover Node endpoints
npm run test:api     # live API: upload/list/raw/delete + CORS preflight
```

`test:api` needs a token: `GH_TOKEN=github_pat_… npm run test:api` (skipped politely if unset). It uploads and deletes only `__smoke__*` files in the vault repo.

## Deploying / updating

The portal repo (`austria-ticket-portal`) is public and contains only the static frontend. GitHub Pages serves the repo root (custom domain via `CNAME`). To update the site: edit the files, run `npm test`, commit, push — Pages redeploys automatically.

To move hosting or storage later: the vault repo is plain git; clone it and your files are plain files under `files/`.
