import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, connect, emit, makeRoom, enter, yt, VIDEOS } from './helpers.js';
import { WatchHistory } from '../src/models/WatchHistory.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

const progress = (s, code, videoId, position, duration = 600) => emit(s, 'history:progress', { code, videoId, position, duration });

test('progress is recorded for the current video only, validated, and kept apart from the room and the watchlist', async () => {
  const host = await signup(srv.base, 'Hana');
  const ann = await signup(srv.base, 'Ann');
  const code = await makeRoom(host, [ann], { videoUrl: yt(0), videoTitle: 'Big Buck' });
  const hs = await connect(srv.base, host.c.cookie);
  const as = await connect(srv.base, ann.c.cookie);
  await enter(hs, code); await enter(as, code);
  try {
    assert.equal((await progress(as, code, VIDEOS[1], 30)).reason, 'NOT_CURRENT', 'not what the room is playing');
    const clamp = await progress(as, code, VIDEOS[0], 9999, 600); assert.equal(clamp.saved, true, JSON.stringify(clamp));
    assert.equal((await progress(as, code, VIDEOS[0], -5)).error.code, 'BAD_REQUEST', 'negative positions are rejected');

    await sleepMs(0);
    const h = await WatchHistory.findOne({ user: ann.user.id, videoId: VIDEOS[0] });
    assert.equal(h.lastPosition, 600);
    assert.equal(h.completed, true);

    // Personal progress never changes what the room is playing.
    const room = (await host.c.get(`/api/rooms/${code}`)).body.room;
    assert.equal(room.playback.position, 0);
    assert.equal((await ann.c.get('/api/users/me/watchlist')).body.watchlist.length, 0, 'watchlist untouched');
  } finally { hs.disconnect(); as.disconnect(); }
});
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

test('continue watching, sorting, pagination, privacy of room links, deletion and opt-out', async () => {
  const host = await signup(srv.base, 'Hana');
  const ann = await signup(srv.base, 'Ann');
  const code = await makeRoom(host, [ann], { videoUrl: yt(0) });
  const as = await connect(srv.base, ann.c.cookie);
  await enter(as, code);
  try {
    // Seed several entries directly: 1 finished, 2 partly watched.
    const mk = (i, pos, dur, completed, ago) => WatchHistory.create({ user: ann.user.id, videoId: VIDEOS[i], title: `V${i}`, lastPosition: pos, duration: dur, completed, lastRoomCode: code, lastRoomName: 'Test room', lastWatchedAt: new Date(Date.now() - ago) });
    await mk(1, 100, 200, false, 1000);
    await mk(2, 20, 600, false, 2000);
    await mk(3, 600, 600, true, 3000);
    await mk(4, 5, 600, false, 4000); // barely started: not "continue watching"

    const cont = (await ann.c.get('/api/users/me/history/continue')).body.items;
    assert.deepEqual(cont.map((x) => x.title), ['V1', 'V2']);
    assert.equal(cont[0].progress, 0.5);
    assert.equal(cont[0].room.code, code, 'still a member: link allowed');

    const recent = (await ann.c.get('/api/users/me/history?limit=2')).body;
    assert.deepEqual(recent.items.map((x) => x.title), ['V1', 'V2']);
    assert.equal(recent.nextCursor, '2');
    const next = (await ann.c.get('/api/users/me/history?limit=2&cursor=2')).body;
    assert.deepEqual(next.items.map((x) => x.title), ['V3', 'V4']);
    assert.equal(next.nextCursor, null);
    const byProgress = (await ann.c.get('/api/users/me/history?sort=progress')).body.items.map((x) => x.title);
    assert.deepEqual(byProgress, ['V1', 'V2', 'V4'], 'unfinished only, most complete first');
    assert.equal((await ann.c.get('/api/users/me/history?sort=weird')).status, 400);

    // After leaving, the room link disappears (private details stay private).
    await ann.c.post(`/api/rooms/${code}/leave`);
    const afterLeave = (await ann.c.get('/api/users/me/history/continue')).body.items;
    assert.equal(afterLeave[0].room, null);

    // Isolation + deletion.
    const other = await signup(srv.base, 'Oli');
    assert.deepEqual((await other.c.get('/api/users/me/history')).body.items, []);
    const id = recent.items[0].id;
    assert.equal((await other.c.del(`/api/users/me/history/${id}`)).status, 404);
    assert.equal((await ann.c.del(`/api/users/me/history/${id}`)).status, 200);
    assert.equal((await ann.c.del(`/api/users/me/history/${id}`)).status, 404);
    assert.equal((await ann.c.del('/api/users/me/history')).body.deleted, 3);

    // Opt out: nothing more is stored.
    await ann.c.patch('/api/users/me', { preferences: { saveHistory: false } });
    await ann.c.post(`/api/rooms/${code}/join`);
    await enter(as, code);
    assert.equal((await progress(as, code, VIDEOS[0], 50)).reason, 'HISTORY_OFF');
    assert.equal(await WatchHistory.countDocuments({ user: ann.user.id }), 0);
  } finally { as.disconnect(); }
});

test('watch history requires sign-in', async () => {
  const r = await fetch(`${srv.base}/api/users/me/history`);
  assert.equal(r.status, 401);
});
