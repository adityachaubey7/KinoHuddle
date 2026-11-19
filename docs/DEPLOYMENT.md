# Deploying SyncSpace

SyncSpace needs three things in production: a MongoDB database, a Node.js host that supports **WebSockets and a long-running process**, and the built React app.

The simplest and most reliable setup is **one service**: the Express server serves the built client from the same origin. Cookies stay first-party, so sign-in works in every browser (including Safari, which blocks third-party cookies).

## 1. Database: MongoDB Atlas

1. Create a free M0 cluster at mongodb.com/atlas.
2. Database Access → add a user with a strong password.
3. Network Access → allow your host’s outbound IPs (or `0.0.0.0/0` while testing).
4. Copy the connection string, e.g. `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/syncspace?retryWrites=true&w=majority`.

Indexes are created automatically when the server starts.

## 2. Option A (recommended): single service on Render / Railway / Fly.io

**Build command**
```bash
npm run install:all && npm run build
```

**Start command**
```bash
npm start
```

**Environment variables**
```
NODE_ENV=production
MONGODB_URI=<your Atlas string>
JWT_SECRET=<48+ random bytes, hex>
CLIENT_ORIGIN=https://your-app.onrender.com
TRUST_PROXY=true
```

With `NODE_ENV=production` the server serves `client/dist` and falls back to `index.html` for client-side routes. Leave `VITE_API_URL` and `VITE_SOCKET_URL` empty.

Render: create a **Web Service** (not a Static Site), Node runtime. WebSockets are supported out of the box.

## 3. Option B: split frontend and backend

Frontend on Vercel/Netlify, API on Render/Railway.

**API** env:
```
NODE_ENV=production
CLIENT_ORIGIN=https://your-frontend.vercel.app
TRUST_PROXY=true
```
In production the auth cookie is sent with `SameSite=None; Secure`, so both sites must use HTTPS.

**Frontend** env (build time):
```
VITE_API_URL=https://your-api.onrender.com
VITE_SOCKET_URL=https://your-api.onrender.com
```
Add a rewrite so client routes load `index.html` (Vercel: `vercel.json` with `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`).

> Some browsers block third-party cookies. If sign-in doesn’t stick, put both on the same parent domain (`app.example.com` + `api.example.com`) or use Option A.

## 4. Behind Nginx (self-hosted)

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```
Run the server with a process manager (`pm2 start npm --name syncspace -- start`) and set `TRUST_PROXY=true`.

## 5. Scaling past one instance

Presence, host-handover timers and socket rate limits live in memory, so run **one** instance, or add:
- `@socket.io/redis-adapter` for cross-instance broadcasts
- a Redis store for presence and rate limits
- sticky sessions if you allow the polling transport

## 6. Production checklist

- [ ] `JWT_SECRET` is long, random and not committed
- [ ] `CLIENT_ORIGIN` lists only your real frontend origin(s)
- [ ] HTTPS everywhere
- [ ] Atlas network access restricted to your host
- [ ] `TRUST_PROXY=true` behind a proxy (rate limits use the real client IP)
- [ ] `GET /api/health` returns `{"ok":true,"db":"connected"}`

---

# Upgrade: additional deployment notes

## Health checks
Point your platform’s health check at `GET /api/health` (process is up) and, if it supports a readiness probe, `GET /api/ready` (also checks MongoDB; returns 503 while the database is unreachable). Logs are JSON lines on stdout/stderr with a request `id` (also returned as the `X-Request-Id` header); secrets are redacted.

## WebSockets
Socket.IO needs WebSocket (or long-polling) pass-through. Behind Nginx add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` for `/socket.io/`. Render, Railway and Fly support this by default. Set `TRUST_PROXY=true` behind any proxy so rate limits see real client IPs.

## Cookies and CORS
- **Same origin (recommended):** serve the built client from the API or put both behind one domain, set `COOKIE_SAMESITE=lax`, and keep `CLIENT_ORIGIN` equal to that origin.
- **Split domains** (e.g. `app.example.com` + `api.example.com`): leave the production default `SameSite=None; Secure`, serve everything over HTTPS, put the exact web origin in `CLIENT_ORIGIN`, and set `VITE_API_URL` / `VITE_SOCKET_URL` at build time. Some browsers block third-party cookies on unrelated domains; a shared parent domain avoids this.
- Requests from any origin not in `CLIENT_ORIGIN` are rejected for every method.

## Email (optional)
Set `EMAIL_PROVIDER=smtp` and the `SMTP_*` / `EMAIL_FROM` variables, plus `APP_URL` (the public web address used in links). Free tiers of Brevo, Mailgun, Amazon SES or a Gmail app password all work. Without it, password reset and email verification are disabled and the app says so. Test with the Forgot password page; the API replies `502` if the provider refuses delivery.

## MongoDB
Any MongoDB 6+ (Atlas free tier works). Indexes are created at startup. Existing data is untouched (see UPGRADE.md, “Database changes”). The reminder scheduler runs inside the API process, so keep the API process running (it catches up immediately after a restart).

## Frontend, backend and database
1. Database: create an Atlas cluster, allow your server’s IP, copy the connection string into `MONGODB_URI`.
2. Backend: deploy `server/` (Node 20+), set the variables from `server/.env.example`, start with `npm start`.
3. Frontend: `npm run build` in `client/`, then either let the API serve `client/dist` (same origin) or host it on a static host with `VITE_API_URL` / `VITE_SOCKET_URL` set.
This repository has **not** been deployed by the upgrade; these are instructions only.

## Troubleshooting
- *Signed in but immediately signed out in production:* cookie settings. Same origin → `COOKIE_SAMESITE=lax`; split domains → HTTPS + exact `CLIENT_ORIGIN`.
- *Real-time not updating:* WebSocket blocked by a proxy; check the browser network tab for `/socket.io`.
- *`/api/ready` returns 503:* MongoDB unreachable; check `MONGODB_URI`, network allow-list and credentials.
- *Forgot password says email isn’t set up:* `EMAIL_PROVIDER` is `none` or `SMTP_HOST` is empty.
- *Reminders never arrive:* make sure `SCHEDULER_INTERVAL_MS` is not `0` and the process stays running; people must have RSVP’d “going”.
- *Too many requests (429):* built-in rate limits; wait or, in development only, restart the server.
