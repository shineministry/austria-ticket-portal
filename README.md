# Austria Ticket Portal

A private, light-mode file portal for uploading tickets, PDFs, images and documents — protected by a **6-digit passcode**.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Passcode gate** — 6-digit code, verified against a salted **scrypt** hash (the passcode itself is never stored)
- **Rate limiting** — max 5 login attempts / 15 min per IP, plus upload & API rate limits
- **Hardened sessions** — `httpOnly` + `SameSite=Strict` cookies, random 32-byte tokens, 12h expiry
- **Drag & drop uploads** — PDF, images, Office docs, archives, audio/video · 25 MB per file, 20 per batch
- **Gallery + list views** — image thumbnails, PDF preview, search, download, delete
- **Clean light UI** — card layout, soft shadows, red alpine accent, fully responsive
- **Security headers** — CSP, HSTS (when HTTPS), `nosniff`, frame denial, same-origin CSRF check

## Quick start

```bash
npm install
npm run set-passcode     # choose your 6-digit passcode (hashed to config/auth.json)
npm start                # http://localhost:3000
```

Set the passcode non-interactively:

```bash
npm run set-passcode -- 123456
```

## Configuration

| Env var | Default     | Description               |
| ------- | ----------- | ------------------------- |
| `PORT`  | `3000`      | HTTP port                 |
| `HOST`  | `0.0.0.0`   | Bind address              |

## Storage layout

```
data/uploads/    # uploaded files (generated, git-ignored)
data/files.json  # file metadata (generated, git-ignored)
config/auth.json # scrypt salt + hash only (generated, git-ignored)
```

Everything user-specific lives under `data/` and `config/`, both git-ignored. Only the salted hash of the passcode is written — never the passcode.

## Deploying

> **Important:** GitHub Pages is static-only hosting and **cannot run this app** (the passcode gate and uploads need the Node backend). Deploy to a Node host instead.

### Option A — Render (free, one-click)

1. Push this repo to GitHub (already done if you're reading it there).
2. On [render.com](https://render.com), **New → Blueprint** and pick this repo — `render.yaml` provisions everything, including a persistent disk for uploads.
3. Render sets a random `PASSCODE` env var on first deploy. Find it under **Environment → PASSCODE** in the dashboard, or replace it with your own 6-digit code and redeploy.
4. Your app is live at `https://<name>.onrender.com`.

### Option B — any VPS / Node host

```bash
npm install
PASSCODE=123456 npm start        # passcode via env var (no config file needed)
# or:
npm run set-passcode && npm start # passcode hashed to config/auth.json
```

### Environment variables

| Var         | Default | Purpose                                                            |
| ----------- | ------- | ------------------------------------------------------------------ |
| `PORT`      | `3000`  | HTTP port                                                          |
| `HOST`      | `0.0.0.0` | Bind address                                                     |
| `PASSCODE`  | —       | 6-digit passcode (used when `config/auth.json` is absent)          |
| `BASE_PATH` | —       | Serve under a subpath, e.g. `/public` (for reverse proxies)        |
| `DATA_DIR`  | `./data`| Where uploads are stored (set to a mounted disk path in production)|

## Production tips

- Put it behind HTTPS (e.g. Caddy / nginx / Cloudflare). The app enables HSTS and secure cookies automatically when `req.secure` is true.
- Set the passcode once with `npm run set-passcode` and share it only with people who need access.

## Scripts

| Command                | What it does                     |
| ---------------------- | -------------------------------- |
| `npm start`            | Run the server                   |
| `npm run dev`          | Run with auto-restart on changes |
| `npm run set-passcode` | Set / rotate the 6-digit passcode |

## License

MIT
