# SyncSpace API

Base path: `/api`. All bodies are JSON. Authentication is an `httpOnly` cookie (`ss_token`) set by sign-up and sign-in; an `Authorization: Bearer <token>` header also works.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "ROOM_FULL", "message": "This room is full (10 people).", "fields": { "name": "Use at least 2 characters." } } }
```

`fields` is present only for validation errors (400).

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_VIDEO_URL`, `WRONG_PASSWORD`, `BELOW_MEMBER_COUNT`, `CANNOT_REMOVE_SELF`, `BAD_JSON` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `NOT_A_MEMBER`, `HOST_ONLY`, `ROOM_LOCKED`, `REMOVED`, `CORS_BLOCKED` |
| 404 | `ROOM_NOT_FOUND`, `TITLE_NOT_FOUND`, `MEMBER_NOT_FOUND`, `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `ROOM_FULL` |
| 410 | `ROOM_CLOSED`, `ROOM_EXPIRED` |
| 413 | `TOO_LARGE` |
| 429 | `RATE_LIMITED` |

## Rate limits

| Scope | Limit |
|---|---|
| All `/api` routes | 300 requests / minute / IP |
| `/auth/register`, `/auth/login` | 20 / 15 minutes / IP |
| `POST /rooms` | 30 / hour / user |
| Socket chat | 8 messages / 10 s / user |
| Socket reactions | 12 / 10 s / user |
| Socket playback controls | 20 / 5 s / user |

---

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ displayName, email, password }` | `201 { user }` and sets cookie |
| POST | `/auth/login` | `{ email, password }` | `{ user }` and sets cookie |
| POST | `/auth/logout` | – | `{ ok }` clears cookie |
| POST | `/auth/logout-all` 🔒 | – | `{ ok }` invalidates every session |
| GET | `/auth/me` 🔒 | – | `{ user }` |

Password: 8–128 characters with at least one letter and one number. Display name: 2–40 characters.

`user` (self view):
```json
{ "id": "…", "email": "…", "displayName": "Asha", "avatarColor": "#F2B33D", "bio": "",
  "watchlist": ["sintel"], "preferences": { "reduceMotion": false, "showReactions": true, "chatSounds": false },
  "createdAt": "…" }
```

## Users 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| PATCH | `/users/me` | any of `{ displayName, bio, avatarColor, preferences: {…} }` | `{ user }` |
| POST | `/users/me/password` | `{ currentPassword, newPassword }` | `{ ok }` (other sessions signed out) |
| GET | `/users/me/watchlist` | – | `{ watchlist: [slug] }` |
| POST | `/users/me/watchlist` | `{ slug }` | `{ watchlist }` |
| DELETE | `/users/me/watchlist/:slug` | – | `{ watchlist }` |

## Catalog (public)

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/catalog` | `q`, `category` (`all\|movies\|anime\|cartoons`), `genre`, `length` (`any\|short\|medium`), `sort` (`featured\|newest\|oldest\|title`) | `{ items, total, categories, genres }` |
| GET | `/catalog/:slug` | – | `{ item, related }` |

## Rooms 🔒

| Method | Path | Who | Body | Response |
|---|---|---|---|---|
| POST | `/rooms` | any user | `{ name, maxMembers?=10, guestControl?=false, videoUrl?, videoTitle? }` | `201 { room }` |
| GET | `/rooms` | any user | – | `{ rooms: [summary] }` recent rooms incl. closed |
| GET | `/rooms/:code` | any user | – | `{ access: "member", room }` or `{ access: "preview" \| "removed", room: preview }` |
| POST | `/rooms/:code/join` | any user | – | `{ room, joined }` |
| POST | `/rooms/:code/leave` | member | – | `{ ok, closed }` |
| PATCH | `/rooms/:code` | host | any of `{ name, guestControl, locked, maxMembers }` | `{ room }` |
| POST | `/rooms/:code/transfer` | host | `{ userId }` | `{ room }` |
| POST | `/rooms/:code/remove` | host | `{ userId }` | `{ room }` |
| POST | `/rooms/:code/close` | host | – | `{ ok }` |
| GET | `/rooms/:code/messages` | member | query `before` (ISO date), `limit` (1–100, default 50) | `{ messages, hasMore }` |

Codes are 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Input is case-insensitive and dashes/spaces are ignored.

`room` (member view):
```json
{ "code": "K7M4QX2P", "name": "Friday film club", "status": "open", "hostId": "…",
  "isHost": true, "canControl": true, "guestControl": false, "locked": false, "maxMembers": 10,
  "members": [{ "id": "…", "displayName": "Asha", "avatarColor": "#F2B33D", "role": "host", "online": true, "joinedAt": "…", "lastSeenAt": "…" }],
  "playback": { "videoId": "aqz-KE-bpKQ", "videoTitle": "Big Buck Bunny", "isPlaying": true, "position": 42.1, "rate": 1, "serverTime": 1729450000000, "seq": 7, "updatedBy": "…" },
  "createdAt": "…", "expiresAt": "…", "lastActivityAt": "…" }
```

`position` is extrapolated to `serverTime`. Clients compute the current position as `position + (serverNow − serverTime) / 1000 × rate` while playing.

---

# Socket.IO events

Connect to the same origin as the API with credentials (`withCredentials: true`). The handshake is authenticated from the cookie (or `auth: { token }`); unauthenticated connections are refused with `connect_error` message `UNAUTHENTICATED`.

Events that take an acknowledgement callback reply with `{ ok: true, … }` or `{ ok: false, error: { code, message } }`. Every privileged event re-loads the room and re-checks membership and permission from the database.

## Client → server

| Event | Payload | Ack | Notes |
|---|---|---|---|
| `time:ping` | `{}` | `{ serverTime }` | Clock-offset estimation |
| `room:join` | `{ code }` | `{ ok, room, messages, reactions }` | Must already be a member (REST join). Re-emit on every reconnect. |
| `room:leave` | `{ code }` | – | Leaves the socket channel only (membership unchanged) |
| `player:load` | `{ code, url, title? }` | `{ ok, state }` | Host or permitted member. URL validated server-side. |
| `player:play` | `{ code, position }` | `{ ok, state }` | `position` 0–86400 |
| `player:pause` | `{ code, position }` | `{ ok, state }` | |
| `player:seek` | `{ code, position }` | `{ ok, state }` | Keeps play/pause state |
| `player:rate` | `{ code, rate }` | `{ ok, state }` | 0.25–2 |
| `player:sync` | `{ code }` | `{ ok, state }` | Any member; current authoritative state |
| `chat:send` | `{ code, text, clientId }` | `{ ok, message, duplicate? }` | 1–500 chars after trimming; `clientId` 6–64 chars `[A-Za-z0-9_-]` |
| `chat:typing` | `{ code, typing }` | – | Relayed to others |
| `reaction:send` | `{ code, emoji, clientId }` | `{ ok, reaction }` | `emoji` ∈ 😂 😮 😍 👏 🔥 😢 😱 🍿 |

## Server → client

| Event | Payload | When |
|---|---|---|
| `player:state` | `playback` + `{ action, by: { id, displayName } }` | Any playback change. Ignore if `seq` is lower than the last applied. |
| `room:update` | `room` (no viewer flags) | Presence, members, host, settings change |
| `chat:message` | `message` | New text or system message |
| `chat:typing` | `{ user, typing }` | Someone started/stopped typing |
| `reaction` | `message` (kind `reaction`) | New reaction |
| `room:closed` | `{ code, reason: "closed" \| "expired" \| "empty" }` | Room ended; socket removed from channel |
| `room:removed` | `{ code }` | You were removed by the host |

`message`:
```json
{ "id": "…", "kind": "text|reaction|system", "text": "…", "emoji": null, "videoTime": 42.1,
  "clientId": "…", "createdAt": "…", "user": { "id": "…", "displayName": "Asha", "avatarColor": "#F2B33D" } }
```

## Sync algorithm (client)

1. On connect: `room:join`, then four `time:ping`s; keep the offset from the lowest round trip.
2. Apply the room’s `playback` immediately (load/cue the video at the expected position).
3. On every `player:state`, drop it if `seq` is stale, otherwise store it as the target and apply.
4. Every 0.5 s: if the target is playing and the player is playing, compare `getCurrentTime()` with the expected position; if the gap is over 1 s, seek. Skip while buffering. If the player won’t start for 2.5 s, show a “Join playback” button (autoplay policy).
5. Every 15 s: `player:sync` as a safety net for missed events.

## Public rooms

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/rooms/public` | optional | Query: `topic`, `language`, `country`, `q`, `hasSpace`, `playing`, `sort` (`active`\|`newest`), `cursor`, `limit` (1–30). Returns `{ rooms, nextCursor, stats: { rooms, watching } }`. |
| POST | `/api/rooms/public/quick-join` | required | Optional body `{ topic, language, country }`. Joins the busiest matching room with space. `404 NO_PUBLIC_ROOMS` if none. |
| POST | `/api/rooms/:code/join-public` | required | Join without an invite. `404` for private rooms. Same `ROOM_FULL` / `ROOM_LOCKED` / `REMOVED` errors as `/join`. |
| POST | `/api/rooms` | required | New optional fields: `visibility` (`private`\|`public`), `topic`, `language` (`en`, `hi`, … or `multi`), `country` (ISO 3166-1 alpha-2). |

Socket events: `lobby:join` / `lobby:leave` (acked) subscribe to the directory; the server emits `lobby:update` (a room card) and `lobby:remove` (`{ code }`).

---

# Upgrade additions

All routes below require a signed-in session (httpOnly cookie) unless noted. Errors use `{ "error": { "code", "message", "fields"? } }`.

## Ops
- `GET /api/health` — liveness. `GET /api/ready` — readiness (pings MongoDB; `503` when unavailable). Both unauthenticated.

## Auth (additions)
- `GET /api/auth/config` → `{ emailEnabled }` (public)
- `POST /api/auth/forgot-password` `{ email }` → same `200` for known and unknown emails; `503 EMAIL_NOT_CONFIGURED`; `502 EMAIL_DELIVERY_FAILED`
- `POST /api/auth/reset-password` `{ token, password }` → `400 INVALID_TOKEN` when expired, used or unknown
- `POST /api/auth/verify-email` `{ token }`; `POST /api/auth/resend-verification`
- `POST /api/auth/logout` now revokes the session token server-side.

## Queue
- `GET /api/rooms/:code/queue` (members) → `{ queue: { version, mode, max, current, items[] } }`
- Mutations are Socket.IO events (below).

## Watch parties
- `POST /api/events` `{ title, description?, startsAt (ISO with offset), timeZone, durationMinutes?, reminderLeadMinutes?, visibility?, maxMembers?, guestControl?, topic?, videoUrl? }`
- `GET /api/events?scope=mine|public&phase=upcoming|past&cursor&limit`
- `GET /api/events/:id[?invite=token]` (`404` if you may not see it; `410 INVITE_EXPIRED` / `EVENT_CANCELLED`)
- `PATCH /api/events/:id` (organiser) · `POST /api/events/:id/cancel` (organiser)
- `PUT /api/events/:id/rsvp` `{ status: "going" | "not_going" }` (`409 EVENT_FULL`, `410 EVENT_ENDED`)
- `POST /api/events/:id/invite` `{ emails[≤10] }` · `POST /api/events/:id/invite-link` (rotates the secret link)
- `POST /api/events/:id/join` `{ invite? }` (`409 EVENT_NOT_STARTED` before the 15-minute window)

## Notifications
- `GET /api/notifications?limit&before&unread` → `{ notifications, hasMore, unread }`
- `GET /api/notifications/unread-count` · `POST /api/notifications/read-all` · `POST /api/notifications/:id/read` · `DELETE /api/notifications/:id`

## Moderation (host / moderators)
- `POST /api/rooms/:code/mute|unmute|ban|unban` `{ userId, minutes? }` (`minutes` omitted = until lifted)
- `POST /api/rooms/:code/moderators` `{ userId, moderator }` (host)
- `GET /api/rooms/:code/moderation` · `GET /api/rooms/:code/moderation/log?limit&before`
- `POST /api/rooms/:code/reports` `{ userId, messageId?, reason, details? }` (any member)
- `GET /api/rooms/:code/reports?status` · `POST /api/rooms/:code/reports/:id` `{ decision: "dismiss"|"action", action?: "none"|"mute"|"ban", minutes?, note? }`
- `PATCH /api/rooms/:code` accepts `slowModeSeconds` (0–300, host). `POST /api/rooms/:code/remove` is now a permanent ban and also available to moderators.

## Watch history
- `GET /api/users/me/history?sort=recent|progress&cursor&limit` · `GET /api/users/me/history/continue`
- `DELETE /api/users/me/history/:id` · `DELETE /api/users/me/history`
- `PATCH /api/users/me` accepts `preferences.saveHistory`.

## Socket.IO additions
Client → server (all acknowledge with `{ ok: true, ... }` or `{ ok: false, error }`):
`queue:get`, `queue:add {code,url,title?}`, `queue:vote {code,itemId,on}`, `queue:remove {code,itemId}`, `queue:move {code,itemId,toIndex}`, `queue:mode {code,mode}`, `queue:next {code,itemId?}`, `queue:unavailable {code,videoId}`, `player:ended {code,videoId}`, `player:duration {code,videoId,duration}`, `history:progress {code,videoId,position,duration}`.
Server → client: `queue:update` (full snapshot with increasing `version`), `notification:new {notification, unread}`, `notification:count {unread}`. `room:join` acks now include `queue`. `chat:send` can fail with `MUTED` or `SLOW_MODE` (`retryAfter` seconds).
