import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, connect, emit, sleep } from './helpers.js';
import { ensureOfficialRooms, OFFICIAL_ROOMS } from '../src/lib/officialRooms.js';
import { Room } from '../src/models/Room.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

const mk = (c, body) => c.post('/api/rooms', { name: 'Test room', ...body });

test('private rooms stay private: not listed, not joinable via join-public', async () => {
  const { c: host } = await signup(srv.base, 'Hana');
  const { c: other } = await signup(srv.base, 'Omar');
  const created = await mk(host, {});
  assert.equal(created.status, 201);
  assert.equal(created.body.room.visibility, 'private');

  const list = await other.get('/api/rooms/public');
  assert.equal(list.status, 200);
  assert.ok(!list.body.rooms.some((r) => r.code === created.body.room.code));

  const j = await other.post(`/api/rooms/${created.body.room.code}/join-public`);
  assert.equal(j.status, 404); // looks like it doesn't exist
  // ...but the classic code-based join still works
  assert.equal((await other.post(`/api/rooms/${created.body.room.code}/join`)).status, 200);
});

test('public rooms are listed without sign-in and can be joined without a code', async () => {
  const { c: host } = await signup(srv.base, 'Priya');
  const { c: guest } = await signup(srv.base, 'Leo');
  const r = await mk(host, { name: 'Hindi movie night', visibility: 'public', topic: 'movies', language: 'hi', country: 'in' });
  assert.equal(r.status, 201);
  assert.equal(r.body.room.country, 'IN');
  assert.equal(r.body.room.topic, 'movies');

  const anon = await fetch(`${srv.base}/api/rooms/public`).then((x) => x.json());
  const card = anon.rooms.find((x) => x.code === r.body.room.code);
  assert.ok(card, 'listed for anonymous visitors');
  assert.equal(card.memberCount, 1);
  assert.equal(card.members, undefined, 'cards never expose member identities');

  const j = await guest.post(`/api/rooms/${card.code}/join-public`);
  assert.equal(j.status, 200);
  assert.equal(j.body.joined, true);
  assert.equal(j.body.room.members.length, 2);
  assert.equal((await guest.post(`/api/rooms/${card.code}/join-public`)).body.joined, false);

  const anonJoin = await fetch(`${srv.base}/api/rooms/${card.code}/join-public`, { method: 'POST' });
  assert.equal(anonJoin.status, 401);
});

test('filters, search, pagination and validation', async () => {
  const { c } = await signup(srv.base, 'Filter');
  await mk(c, { name: 'Anime marathon', visibility: 'public', topic: 'anime', language: 'ja', country: 'JP' });
  await mk(c, { name: 'Español chill', visibility: 'public', topic: 'general', language: 'es' });
  await mk(c, { name: 'Gaming', visibility: 'public', topic: 'gaming', language: 'en', country: 'US' });

  const by = async (qs) => (await c.get(`/api/rooms/public?${qs}`)).body;
  assert.ok((await by('topic=anime')).rooms.every((r) => r.topic === 'anime'));
  assert.ok((await by('language=es')).rooms.every((r) => r.language === 'es'));
  assert.ok((await by('country=jp')).rooms.every((r) => r.country === 'JP'));
  const q = await by('q=' + encodeURIComponent('marathon'));
  assert.equal(q.rooms.length, 1);
  assert.equal(q.rooms[0].name, 'Anime marathon');
  assert.equal((await by('q=' + encodeURIComponent('.*'))).rooms.length, 0, 'regex chars are escaped');

  const p1 = await by('limit=2');
  assert.equal(p1.rooms.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = await by(`limit=2&cursor=${p1.nextCursor}`);
  assert.ok(p2.rooms.every((r) => !p1.rooms.some((x) => x.code === r.code)), 'pages do not overlap');
  assert.ok(p1.stats.rooms >= 3);

  assert.equal((await c.get('/api/rooms/public?topic=nope')).status, 400);
  assert.equal((await c.get('/api/rooms/public?limit=9999')).status, 400);
  assert.equal((await mk(c, { visibility: 'public', topic: 'nope' })).status, 400);
});

test('hasSpace hides full rooms; full public rooms reject joins', async () => {
  const { c: host } = await signup(srv.base, 'Full');
  const { c: a } = await signup(srv.base, 'Ann');
  const { c: b } = await signup(srv.base, 'Bob');
  const r = await mk(host, { name: 'Tiny public', visibility: 'public', maxMembers: 2 });
  const code = r.body.room.code;
  assert.equal((await a.post(`/api/rooms/${code}/join-public`)).status, 200);
  const listed = await b.get('/api/rooms/public?hasSpace=true&q=Tiny');
  assert.equal(listed.body.rooms.length, 0);
  const full = await b.post(`/api/rooms/${code}/join-public`);
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, 'ROOM_FULL');
});

test('official lobbies: created once, never expire, joinable, quick-join works', async () => {
  await ensureOfficialRooms();
  await ensureOfficialRooms(); // idempotent
  assert.equal(await Room.countDocuments({ isOfficial: true }), OFFICIAL_ROOMS.length);

  // Even with a stale expiry date they stay open and listed.
  await Room.updateOne({ slug: 'movie-club' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const { c } = await signup(srv.base, 'Lobby');
  const list = (await c.get('/api/rooms/public?topic=movies')).body.rooms;
  const club = list.find((r) => r.name === 'Movie Club');
  assert.ok(club && club.isOfficial);
  assert.equal(club.maxMembers, 200);

  const joined = await c.post(`/api/rooms/${club.code}/join-public`);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.room.isOfficial, true);
  assert.equal(joined.body.room.canControl, true);
  assert.equal(joined.body.room.isHost, false, 'nobody is the host of a lobby');

  const { c: d } = await signup(srv.base, 'Quick');
  const q = await d.post('/api/rooms/public/quick-join', { language: 'hi' });
  assert.equal(q.status, 200);
  assert.equal(q.body.room.language, 'hi', 'picked a room in the requested language');
  assert.equal(q.body.room.visibility, 'public');

  // leaving the lobby does not close it
  assert.equal((await d.post(`/api/rooms/${q.body.room.code}/leave`)).status, 200);
  const again = (await d.get('/api/rooms/public?language=hi')).body.rooms;
  assert.ok(again.some((r) => r.name === 'Hindi Chill'), 'official lobby still listed');
});

test('lobby socket pushes live counts to people browsing the directory', async () => {
  await ensureOfficialRooms();
  const { c: watcher } = await signup(srv.base, 'Browser');
  const { c: joiner } = await signup(srv.base, 'Joiner');
  const ws = await connect(srv.base, watcher.cookie);
  await emit(ws, 'lobby:join', {});
  const updates = [];
  ws.on('lobby:update', (card) => updates.push(card));

  const club = (await joiner.get('/api/rooms/public?topic=anime')).body.rooms.find((r) => r.name === 'Anime Night');
  await joiner.post(`/api/rooms/${club.code}/join-public`);
  const js = await connect(srv.base, joiner.cookie);
  await emit(js, 'room:join', { code: club.code });
  await sleep(300);

  const last = updates.filter((u) => u.code === club.code).at(-1);
  assert.ok(last, 'received a lobby update');
  assert.ok(last.memberCount >= 1 && last.onlineCount >= 1);
  ws.close();
  js.close();
});

test('public members can chat and sync like any room (existing behaviour intact)', async () => {
  const { c: host } = await signup(srv.base, 'Sync');
  const { c: m } = await signup(srv.base, 'Mate');
  const r = await mk(host, { name: 'Sync check', visibility: 'public', videoUrl: 'aqz-KE-bpKQ' });
  const code = r.body.room.code;
  await m.post(`/api/rooms/${code}/join-public`);
  const hs = await connect(srv.base, host.cookie);
  const ms = await connect(srv.base, m.cookie);
  assert.equal((await emit(hs, 'room:join', { code })).ok, true);
  assert.equal((await emit(ms, 'room:join', { code })).ok, true);
  const got = new Promise((res) => ms.once('player:state', res));
  assert.equal((await emit(hs, 'player:play', { code, position: 5 })).ok, true);
  assert.equal((await got).isPlaying, true);
  assert.equal((await emit(ms, 'player:pause', { code, position: 9 })).error.code, 'HOST_ONLY');
  const chat = await emit(ms, 'chat:send', { code, text: 'नमस्ते 👋 مرحبا', clientId: 'abcdef123456' });
  assert.equal(chat.ok, true);
  assert.equal(chat.message.text, 'नमस्ते 👋 مرحبا');
  hs.close();
  ms.close();
});

test('dev CORS accepts any localhost port but never foreign sites', async () => {
  const login = (origin) =>
    fetch(`${srv.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'password123' }),
    });
  assert.equal((await login('http://localhost:5174')).status, 401); // reached the handler
  assert.equal((await login('http://127.0.0.1:5199')).status, 401);
  assert.equal((await login('https://evil.example.com')).status, 403);
  assert.equal((await login('http://localhost.evil.com')).status, 403);
});
