# KinoHuddle

Real-time watch parties for YouTube. Create a private room, share the invite link, and everyone’s player stays on the same moment: play, pause, seek and speed changes reach the whole room, players that drift get pulled back in line, and the room talks it through in chat with emoji reactions.

Built with **React + Vite**, **Node.js + Express**, **MongoDB + Mongoose** and **Socket.IO**, using the official **YouTube IFrame Player API**.

---

## Features

**Browse**
- Landing page with a curated catalog in three categories: Movies, Anime, Cartoons
- Search (title, genre, studio), genre/length filters, sorting; filters live in the URL so they can be shared
- Title detail pages with synopsis, related titles, an inline preview and “Watch together”
- Watchlist saved to your account

**Shared watch queue** (new)
- Add YouTube videos to a room queue; the first add starts playing when nothing is on
- Vote for what plays next (one vote per person), or let the host order it by hand
- The next video starts automatically when the current one ends, once, for everyone
- Saved in MongoDB: survives refreshes, reconnects and server restarts

**Scheduled watch parties** (new)
- Pick a date and time (stored in UTC, shown in each person's own time zone), set capacity and visibility
- Invite by secret link or by email; RSVP going / not going; public parties are listed for everyone
- The room opens 15 minutes early; in-app reminders are sent by a server-side scheduler (no browser needed)

**Notifications** (new)
- Bell with unread count, live updates over Socket.IO, mark one or all read, bounded paging

**Moderation** (new)
- Host-appointed moderators, mute/unmute, temporary or permanent bans and unbans, slow mode
- Report a person or message; reviewers see reports, act on them and everything is written to an audit log

**Watch history** (new)
- Continue Watching, recently watched, remove entries or turn history off; kept 180 days, visible only to you

**Accounts**
- Sign up, sign in, sign out (signing out invalidates the session on the server), “sign out everywhere”
- Email verification and password reset by email (needs an email provider, see Configure)
- Protected routes that return you to where you were going after sign-in
- Profile (name, bio, avatar colour) and settings (floating reactions, reduced motion, password change)

**Rooms**
- Private rooms with unique 8-character codes (no ambiguous characters) and invite links
- Join by code, pasted link or invite URL; preview screen before joining
- Live member list with online/offline presence (multiple tabs count once)
- Host powers: control playback, change video, let everyone control, lock the room, set capacity, transfer host, remove a member, close the room
- Leaving as host hands the room to the next member; if the host disconnects, the room is handed over after a grace period (default 60 s)
- Clear states for invalid, closed, expired, full, locked and removed-from rooms
- Rooms expire after 24 h without activity (configurable)

**Free public rooms (no code needed)**
- `/discover`: a live directory of public rooms with topic, language and country filters, search, “has space” / “playing now”, sorting, and cursor pagination. Filters live in the URL.
- One-click join (`POST /api/rooms/:code/join-public`) and **“Join a free room”** (`POST /api/rooms/public/quick-join`), which drops you into the busiest room with space, optionally in your language or topic.
- Always-on official lobbies (Worldwide Lounge, Anime Night, Movie Club, Cartoon Corner, Hindi Chill, Español Latino): never expire, capacity 200, shared playback control. Edit `server/src/lib/officialRooms.js` to change the list.
- Anyone can host a public room from **New room → Make this room public** (topic, language, optional country).
- Directory cards update live over Socket.IO (member counts, now-playing). Cards never expose member identities, and private rooms are never listed (joining one via `join-public` returns 404).

**Synchronized playback**
- Accepts `youtube.com/watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/` links (and `t=` start times); validated on both client and server
- Server holds the authoritative state `{videoId, isPlaying, position, rate, updatedAt, seq}` in MongoDB
- Clients estimate the server clock offset (best of 4 pings) and compute the expected position locally
- Drift check every 0.5 s; anything over **1 s** is corrected with a seek; buffering is ignored
- Sequence numbers drop stale or out-of-order updates; a 15 s background resync catches anything missed
- Late joiners, page refreshes and reconnects restore the current video, position and play state
- Handles autoplay blocking (“Join playback” button), unavailable/private videos, and videos whose owner blocks embedding

**Chat and reactions**
- Room-only chat over Socket.IO, persisted in MongoDB, last 50 messages on join, “Load earlier messages”
- Sender, timestamp, grouping, typing indicator, optimistic sending with retry
- Duplicate prevention: every message carries a client id with a unique index, so retries after reconnects never double-post
- Validation (1–500 characters), rate limits (8 messages / 10 s, 12 reactions / 10 s)
- Eight emoji reactions that float over the video and are logged in chat with the video timestamp

**Security**
- bcrypt password hashing, JWT in an `httpOnly` cookie, token versioning for global sign-out
- Every REST route and socket event re-checks identity and room membership on the server; client-sent identities are never trusted
- zod validation on all payloads, Helmet, CORS allow-list, HTTP and socket rate limits, 20 KB body limit, safe error responses
- Indexes on room code, membership, message history and the per-room client id

---

## Project structure

```
syncspace/
├── client/                 React + Vite app
│   └── src/
│       ├── components/     Layout, UI kit (Button, Field, Modal, Switch, Avatar…), icons, TitleCard
│       ├── context/        Auth, toasts, watchlist
│       ├── lib/            API client, socket, YouTube helpers, formatting
│       ├── pages/          Home, TitleDetail, Auth, Dashboard, CreateRoom, JoinRoom, Room, Profile, Settings, NotFound
│       │   └── room/       useRoom (real-time hook), SyncPlayer, Chat, People, VideoPicker
│       └── styles/         Design system (tokens + components)
├── server/
│   ├── src/
│   │   ├── models/         User, Room, Message
│   │   ├── routes/         auth, users, catalog, rooms
│   │   ├── sockets/        Socket.IO handlers, presence, broadcast bus
│   │   ├── lib/            room service, YouTube URL parser, validation, rate limiter
│   │   ├── data/           Catalog
│   │   ├── app.js          Express app
│   │   └── index.js        HTTP + Socket.IO server, expiry sweep
│   └── test/               API + socket integration tests (node:test)
├── e2e/                    Multi-browser end-to-end journey (Playwright)
└── docs/                   API.md, DEPLOYMENT.md
```

---

## Getting started

### Requirements
- Node.js 20 or newer
- MongoDB 6+ (local install, Docker, or a free MongoDB Atlas cluster)

### 1. Install

```bash
npm run install:all          # installs server/ and client/
```

### 2. Database

Pick one:

```bash
# Docker
docker run -d --name syncspace-mongo -p 27017:27017 mongo:7

# or a local install
mongod --dbpath ./data
```

Or create a free cluster on MongoDB Atlas and copy its connection string. Collections and indexes are created automatically on first start.

### 3. Configure

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env      # optional; empty values are fine for local dev
```

Edit `server/.env` and set `JWT_SECRET` to a long random string:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/syncspace` | Database connection |
| `JWT_SECRET` | dev-only fallback | Signs session tokens (required, ≥32 chars in production) |
| `JWT_EXPIRES_IN` | `7d` | Session length |
| `CLIENT_ORIGIN` | `http://localhost:5173,http://localhost:4173` | Allowed browser origins (comma-separated) |
| `ROOM_TTL_HOURS` | `24` | Inactivity before a room expires |
| `HOST_GRACE_SECONDS` | `60` | Wait before handing host to someone else on disconnect |
| `TRUST_PROXY` | `false` | Set `true` behind Render/Railway/Nginx |
| `PORT` | `4000` | API port |
| `OFFICIAL_ROOMS_ENABLED` | `true` (`false` in tests) | Create the always-on public lobbies at startup |
| `PUBLIC_ROOM_CAPACITY` | `200` | Capacity of official lobbies |
| `APP_URL` | first `CLIENT_ORIGIN` | Web address used in email links |
| `COOKIE_SAMESITE` | `lax` (dev), `none` (production) | Use `lax` when client and API share an origin |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |
| `SCHEDULER_INTERVAL_MS` | `30000` | Reminder scheduler period (0 disables) |
| `EMAIL_PROVIDER` | `none` | `smtp` to send real email; `none` disables email features |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | empty | SMTP settings for `EMAIL_PROVIDER=smtp` |

### 4. Run

Two terminals:

```bash
npm run dev:server     # API + sockets on http://localhost:4000
npm run dev:client     # app on http://localhost:5173 (proxies /api and /socket.io)
```

Open http://localhost:5173. To try a watch party alone, open a second browser (or a private window) and sign up as a different user.

---

## Testing

### Backend integration tests (62 tests, real MongoDB)

```bash
npm test
```

Uses the `syncspace_test` database (override with `TEST_MONGODB_URI`). Covers URL parsing, auth, protected routes, catalog, watchlist, profile, password change, the full room lifecycle (create, preview, join, lock, capacity, remove, transfer, leave, close, expiry), socket auth, non-member rejection, play/pause/seek/rate sync, late-join state, permissions, chat ordering/persistence/validation/de-duplication/rate limits, reactions, presence with duplicate tabs, host handover and close/remove notifications. The upgrade adds tests for the queue (voting, ordering, concurrency, end-of-video idempotency, restart persistence), scheduled parties (UTC storage, invitations, RSVP, capacity, reminders, rescheduling, cancellation), notifications (ownership, paging, de-duplication), moderation (permission matrix, mute/ban expiry, slow mode, reports, audit log), account recovery (hashed single-use expiring tokens, session revocation, cookie flags, cross-site writes), watch history, rate limits, health/readiness and database outage behaviour.

### End-to-end journey (28 checks, three browsers)

```bash
npm run build && (cd client && npx vite preview)   # client on :4173, API must be running
pip install playwright && playwright install chromium
python3 e2e/journey.py
```

Three separate browser sessions sign up, create and join a room through the UI, then verify synced play, pause and seek, drift correction (a player pushed 6 s ahead is pulled back), chat both ways, floating reactions, a late joiner on a phone-sized screen, refresh recovery, an offline/online reconnect that catches a missed pause, invalid and malformed codes, an anonymous visitor, a signed-in non-member, the 403 on chat history, mobile layout without horizontal scroll, and closing the room. Screenshots go to `e2e/shots/`.

### Feature journey (28 checks, five browsers)

```bash
python3 e2e/features.py          # same setup as above; run it after journey.py
```

Covers the queue (add, validation, votes reorder both screens, reload persistence, the video really ending and advancing everyone), mute and report/review flows, scheduling a party, inviting by email, the notification bell, RSVP, cancellation notice, a stranger blocked from a private event and the password-reset pages. Videos last 7 s in this mock so “ended” can happen.

> The e2e suite swaps YouTube for `e2e/mock_yt.js`, a stand-in for the IFrame Player API with a real clock, so it runs offline and deterministically. It tests SyncSpace’s synchronization logic; it does not test YouTube itself. Check real playback manually with the steps below.

### Manual check with real YouTube

1. Sign in as user A, create a room with a catalog title.
2. Open the invite link in another browser as user B and join.
3. A presses play, pauses, drags the timeline: B follows each time.
4. Send chat messages and reactions both ways.
5. Refresh B mid-playback: it returns to the same moment.
6. Paste `https://vimeo.com/1` into “Change video”: it’s rejected. As B, the play button is disabled.

---

## Limitations

- **Sync accuracy** depends on network latency and YouTube buffering. The target is within about one second; frame-perfect sync isn’t possible through the embedded player.
- **YouTube rules apply.** Ads, age restrictions, region locks and private videos are controlled by YouTube. Videos whose owners disable embedding can’t play (the room says so). Ads may play at different times for different viewers; the player catches up afterwards.
- **Only YouTube** is supported. Other sources (Netflix, local files, DRM services) can’t be synchronized reliably or legally through this approach.
- **Autoplay:** browsers can block sound until the viewer clicks; SyncSpace shows a “Join playback” button when that happens.
- **Single server instance.** Presence, socket rate limits and the “unavailable video” vote counter are in memory. Running several instances needs more than the Socket.IO Redis adapter (see docs/UPGRADE.md, “Scaling”).
- **Email needs a provider.** Without `EMAIL_PROVIDER=smtp`, password reset and verification are disabled (the app says so). Notifications and reminders are in-app only; no email or push reminders are sent.
- **Queue titles.** Videos added by link are shown as “YouTube video” unless chosen from the catalog, because the app does not call YouTube’s data API.
- **Queue auto-advance needs a controller online.** The server only trusts an “ended” report once someone who controls playback has told it the video’s length. If every controller is offline the queue waits until one returns.
- **Reminders use the server clock** and a 30 s poll, so a reminder can be up to about 30 s late.
- The anime category contains official trailers, because full episodes aren’t reliably embeddable worldwide.

## Credits

Catalog films are Blender Studio open movies (Creative Commons) and official trailers from their distributors, played through YouTube’s embedded player. SyncSpace doesn’t host, download or modify any video.
