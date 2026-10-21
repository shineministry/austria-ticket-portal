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
