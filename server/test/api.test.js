import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, signup } from './helpers.js';
import { parseYouTube } from '../src/lib/youtube.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

test('YouTube URL parsing accepts supported formats and rejects others', () => {
  const id = 'aqz-KE-bpKQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=abc`,
    `youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=xyz`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    id,
  ]) {
    assert.equal(parseYouTube(url)?.videoId, id, url);
  }
  assert.equal(parseYouTube(`https://youtu.be/${id}?t=90`).startSeconds, 90);
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}&t=1m30s`).startSeconds, 90);
  for (const bad of [
    'https://vimeo.com/12345',
    'https://evil.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/watch?v=short',
    'javascript:alert(1)',
    '',
    'not a url',
  ]) {
    assert.equal(parseYouTube(bad), null, bad);
  }
});

test('register, me, logout, login', async () => {
  const c = client(srv.base);
  const bad = await c.post('/api/auth/register', { displayName: 'A', email: 'nope', password: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields.email && bad.body.error.fields.password && bad.body.error.fields.displayName);

  const r = await c.post('/api/auth/register', { displayName: 'Asha', email: 'asha@example.com', password: 'password123' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.passwordHash, undefined);
  assert.equal((await c.get('/api/auth/me')).body.user.email, 'asha@example.com');

  const dup = await client(srv.base).post('/api/auth/register', { displayName: 'Asha', email: 'ASHA@example.com', password: 'password123' });
  assert.equal(dup.status, 409);

  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).status, 401);

  assert.equal((await c.post('/api/auth/login', { email: 'asha@example.com', password: 'wrongpass1' })).status, 401);
  const ok = await c.post('/api/auth/login', { email: 'asha@example.com', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('protected routes reject anonymous requests', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/rooms')).status, 401);
  assert.equal((await anon.post('/api/rooms', { name: 'x' })).status, 401);
  assert.equal((await anon.get('/api/users/me/watchlist')).status, 401);
});

test('catalog search, filters and details', async () => {
  const anon = client(srv.base);
  const all = await anon.get('/api/catalog');
  assert.ok(all.body.total >= 15);
  const anime = await anon.get('/api/catalog?category=anime');
  assert.ok(anime.body.items.every((t) => t.category === 'anime'));
  const q = await anon.get('/api/catalog?q=bunny');
  assert.equal(q.body.items[0].slug, 'big-buck-bunny');
  const short = await anon.get('/api/catalog?length=short');
  assert.ok(short.body.items.every((t) => t.minutes < 5));
  assert.equal((await anon.get('/api/catalog?category=bogus')).status, 400);
  const d = await anon.get('/api/catalog/sintel');
  assert.equal(d.body.item.title, 'Sintel');
  assert.equal((await anon.get('/api/catalog/does-not-exist')).status, 404);
});

test('watchlist and profile updates', async () => {
  const { c } = await signup(srv.base, 'Ravi');
  assert.equal((await c.post('/api/users/me/watchlist', { slug: 'sintel' })).body.watchlist[0], 'sintel');
  await c.post('/api/users/me/watchlist', { slug: 'sintel' });
  assert.equal((await c.get('/api/users/me/watchlist')).body.watchlist.length, 1);
  assert.equal((await c.post('/api/users/me/watchlist', { slug: 'fake' })).status, 404);
  assert.equal((await c.del('/api/users/me/watchlist/sintel')).body.watchlist.length, 0);

  const p = await c.patch('/api/users/me', { displayName: 'Ravi K', bio: 'Film nerd', preferences: { reduceMotion: true } });
  assert.equal(p.body.user.displayName, 'Ravi K');
  assert.equal(p.body.user.preferences.reduceMotion, true);
  assert.equal((await c.patch('/api/users/me', { email: 'x@y.com' })).status, 400, 'cannot change email via profile');
  assert.equal((await c.patch('/api/users/me', { avatarColor: 'red' })).status, 400);

  assert.equal((await c.post('/api/users/me/password', { currentPassword: 'nope', newPassword: 'newpass123' })).status, 400);
  assert.equal((await c.post('/api/users/me/password', { currentPassword: 'password123', newPassword: 'newpass123' })).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200, 'current session stays signed in');
});

test('room lifecycle: create, preview, join, permissions, full, locked, remove, transfer, leave, close', async () => {
  const host = await signup(srv.base, 'Host');
  const guest = await signup(srv.base, 'Guest');
  const third = await signup(srv.base, 'Third');
  const fourth = await signup(srv.base, 'Fourth');

  const badUrl = await host.c.post('/api/rooms', { name: 'Movie night', videoUrl: 'https://vimeo.com/1' });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.error.code, 'INVALID_VIDEO_URL');

  const created = await host.c.post('/api/rooms', {
    name: 'Movie night', maxMembers: 3, videoUrl: 'https://youtu.be/aqz-KE-bpKQ', videoTitle: 'Big Buck Bunny',
  });
  assert.equal(created.status, 201);
  const { code } = created.body.room;
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(created.body.room.isHost, true);
  assert.equal(created.body.room.playback.videoId, 'aqz-KE-bpKQ');

  // Invalid / unknown codes
  assert.equal((await guest.c.get('/api/rooms/bad')).status, 404);
  assert.equal((await guest.c.get('/api/rooms/ABCDEFGH')).status, 404);

  // Non-members see only a preview, and cannot read chat
  const preview = await guest.c.get(`/api/rooms/${code}`);
  assert.equal(preview.body.access, 'preview');
  assert.equal(preview.body.room.members, undefined);
  assert.equal((await guest.c.get(`/api/rooms/${code}/messages`)).status, 403);

  // Join (lower-case and dashed code is normalized)
  const j = await guest.c.post(`/api/rooms/${code.toLowerCase().slice(0, 4)}-${code.toLowerCase().slice(4)}/join`);
  assert.equal(j.status, 200);
  assert.equal(j.body.room.isHost, false);
  assert.equal(j.body.room.members.length, 2);
  assert.equal((await guest.c.get(`/api/rooms/${code}/messages`)).status, 200);

  // Members cannot change settings
  assert.equal((await guest.c.patch(`/api/rooms/${code}`, { locked: true })).status, 403);
  assert.equal((await guest.c.post(`/api/rooms/${code}/close`)).status, 403);

  // Lock blocks new members
  await host.c.patch(`/api/rooms/${code}`, { locked: true });
  assert.equal((await third.c.post(`/api/rooms/${code}/join`)).body.error.code, 'ROOM_LOCKED');
  await host.c.patch(`/api/rooms/${code}`, { locked: false });

  // Capacity
  assert.equal((await third.c.post(`/api/rooms/${code}/join`)).status, 200);
  const full = await fourth.c.post(`/api/rooms/${code}/join`);
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, 'ROOM_FULL');
  assert.equal((await host.c.patch(`/api/rooms/${code}`, { maxMembers: 2 })).status, 400);

  // Remove: removed members cannot come back
  await host.c.post(`/api/rooms/${code}/remove`, { userId: third.user.id });
  assert.equal((await third.c.post(`/api/rooms/${code}/join`)).body.error.code, 'REMOVED');
  assert.equal((await third.c.get(`/api/rooms/${code}`)).body.access, 'removed');

  // Transfer host
  const t = await host.c.post(`/api/rooms/${code}/transfer`, { userId: guest.user.id });
  assert.equal(t.body.room.hostId, guest.user.id);
  assert.equal((await host.c.post(`/api/rooms/${code}/close`)).status, 403, 'old host lost powers');

  // Host leaving hands over to the remaining member
  await guest.c.post(`/api/rooms/${code}/leave`);
  const after = await host.c.get(`/api/rooms/${code}`);
  assert.equal(after.body.room.hostId, host.user.id);

  // Recent rooms list
  const list = await guest.c.get('/api/rooms');
  assert.equal(list.body.rooms[0].code, code);
  assert.equal(list.body.rooms[0].left, true);

  // Close: no further joins
  assert.equal((await host.c.post(`/api/rooms/${code}/close`)).status, 200);
  const closed = await fourth.c.post(`/api/rooms/${code}/join`);
  assert.equal(closed.status, 410);
  assert.equal(closed.body.error.code, 'ROOM_CLOSED');
});

test('expired rooms reject joins', async () => {
  const { Room } = await import('../src/models/Room.js');
  const host = await signup(srv.base, 'Old');
  const other = await signup(srv.base, 'Late');
  const { code } = (await host.c.post('/api/rooms', { name: 'Yesterday' })).body.room;
  await Room.updateOne({ code }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await other.c.post(`/api/rooms/${code}/join`);
  assert.equal(r.status, 410);
  assert.equal(r.body.error.code, 'ROOM_EXPIRED');
});
