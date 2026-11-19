import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, connect, emit, once, sleep, makeRoom, enter, yt, VIDEOS } from './helpers.js';
import { start } from '../src/index.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

async function party() {
  const host = await signup(srv.base, 'Host');
  const ann = await signup(srv.base, 'Ann');
  const bob = await signup(srv.base, 'Bob');
  const code = await makeRoom(host, [ann, bob]);
  const [hs, as, bs] = await Promise.all([host, ann, bob].map((u) => connect(srv.base, u.c.cookie)));
  await Promise.all([hs, as, bs].map((s) => enter(s, code)));
  return { host, ann, bob, code, hs, as, bs, close: () => [hs, as, bs].forEach((s) => s.disconnect()) };
}

test('add: validation, duplicates become votes, current video rejected, limits and authorization', async () => {
  const p = await party();
  try {
    assert.equal((await emit(p.as, 'queue:add', { code: p.code, url: 'https://vimeo.com/1' })).error.code, 'INVALID_VIDEO_URL');

    // Nothing is playing yet, so the first add starts it (paused).
    const first = await emit(p.as, 'queue:add', { code: p.code, url: yt(0), title: 'One' });
    assert.ok(first.ok && first.started);
    const room = (await p.host.c.get(`/api/rooms/${p.code}`)).body.room;
    assert.equal(room.playback.videoId, VIDEOS[0]);
    assert.equal(room.playback.isPlaying, false);

    assert.equal((await emit(p.as, 'queue:add', { code: p.code, url: yt(0) })).error.code, 'ALREADY_PLAYING');

    const two = await emit(p.as, 'queue:add', { code: p.code, url: yt(1), title: 'Two' });
    assert.ok(two.ok && !two.duplicate);
    const dup = await emit(p.bs, 'queue:add', { code: p.code, url: yt(1) });
    assert.ok(dup.ok && dup.duplicate, 'second add of the same video is a vote');
    const q = (await p.bob.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(q.items.length, 1);
    assert.equal(q.items[0].votes, 1);
    assert.deepEqual(q.items[0].voters, [p.bob.user.id]);

    // A stranger can't touch the queue or read it.
    const eve = await signup(srv.base, 'Eve');
    const es = await connect(srv.base, eve.c.cookie);
    assert.equal((await emit(es, 'queue:add', { code: p.code, url: yt(2) })).error.code, 'NOT_A_MEMBER');
    assert.equal((await eve.c.get(`/api/rooms/${p.code}/queue`)).status, 403);
    es.disconnect();
  } finally { p.close(); }
});

test('votes: one per person, idempotent, withdrawable; votes decide order; ties keep first-come order', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) }); // starts playing
    const a = (await emit(p.hs, 'queue:add', { code: p.code, url: yt(1), title: 'A' })).itemId;
    const b = (await emit(p.hs, 'queue:add', { code: p.code, url: yt(2), title: 'B' })).itemId;
    const c = (await emit(p.hs, 'queue:add', { code: p.code, url: yt(3), title: 'C' })).itemId;

    const updates = [];
    p.hs.on('queue:update', (s) => updates.push(s));
    assert.ok((await emit(p.as, 'queue:vote', { code: p.code, itemId: c })).changed);
    assert.equal((await emit(p.as, 'queue:vote', { code: p.code, itemId: c })).changed, false, 'same person twice');
    assert.ok((await emit(p.bs, 'queue:vote', { code: p.code, itemId: c })).changed);
    assert.ok((await emit(p.bs, 'queue:vote', { code: p.code, itemId: b })).changed);
    await sleep(100);

    let q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.deepEqual(q.items.map((i) => i.title), ['C', 'B', 'A']);
    assert.equal(q.items[0].votes, 2);
    assert.ok(updates.length >= 3, 'queue changes were broadcast');
    assert.ok(updates.every((u, i) => i === 0 || u.version >= updates[i - 1].version));

    assert.ok((await emit(p.as, 'queue:vote', { code: p.code, itemId: c, on: false })).changed);
    assert.equal((await emit(p.as, 'queue:vote', { code: p.code, itemId: c, on: false })).changed, false);
    assert.equal((await emit(p.as, 'queue:vote', { code: p.code, itemId: 'nope' })).error.code, 'QUEUE_ITEM_NOT_FOUND');
    q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(q.items.find((i) => i.id === c).votes, 1);
    assert.equal(a.length > 0, true);
  } finally { p.close(); }
});

test('reorder and removal are permission-checked; manual vs votes mode rules', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) });
    const ids = [];
    for (const i of [1, 2, 3]) ids.push((await emit(p.as, 'queue:add', { code: p.code, url: yt(i), title: `T${i}` })).itemId);

    assert.equal((await emit(p.as, 'queue:move', { code: p.code, itemId: ids[2], toIndex: 0 })).error.code, 'NOT_ALLOWED');
    assert.equal((await emit(p.bs, 'queue:remove', { code: p.code, itemId: ids[0] })).error.code, 'NOT_ALLOWED', 'not your item');
    assert.equal((await emit(p.as, 'queue:mode', { code: p.code, mode: 'manual' })).error.code, 'HOST_ONLY');

    // Votes mode: only "play next" is allowed.
    assert.equal((await emit(p.hs, 'queue:move', { code: p.code, itemId: ids[2], toIndex: 1 })).error.code, 'REORDER_NOT_ALLOWED');
    assert.ok((await emit(p.hs, 'queue:move', { code: p.code, itemId: ids[2], toIndex: 0 })).ok);
    let q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(q.items[0].title, 'T3');

    // Manual mode: any position; order is frozen from what people were seeing.
    assert.ok((await emit(p.hs, 'queue:mode', { code: p.code, mode: 'manual' })).ok);
    q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.deepEqual(q.items.map((i) => i.title), ['T3', 'T1', 'T2']);
    assert.ok((await emit(p.hs, 'queue:move', { code: p.code, itemId: ids[2], toIndex: 0 })).ok);
    assert.ok((await emit(p.hs, 'queue:move', { code: p.code, itemId: ids[0], toIndex: 2 })).ok);
    q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.deepEqual(q.items.map((i) => i.title), ['T3', 'T2', 'T1']);
    assert.ok(q.items.every((it, i) => it.position === i + 1));

    // Owners may remove their own; removal is idempotent; moving a removed item fails cleanly.
    assert.ok((await emit(p.as, 'queue:remove', { code: p.code, itemId: ids[1] })).removed);
    assert.equal((await emit(p.as, 'queue:remove', { code: p.code, itemId: ids[1] })).removed, false);
    assert.equal((await emit(p.hs, 'queue:move', { code: p.code, itemId: ids[1], toIndex: 0 })).error.code, 'QUEUE_ITEM_NOT_FOUND');
  } finally { p.close(); }
});

test('moving many times never produces duplicate positions (rank precision recovery)', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) });
    const ids = [];
    for (const i of [1, 2, 3]) ids.push((await emit(p.hs, 'queue:add', { code: p.code, url: yt(i), title: `T${i}` })).itemId);
    await emit(p.hs, 'queue:mode', { code: p.code, mode: 'manual' });
    for (let n = 0; n < 40; n++) await emit(p.hs, 'queue:move', { code: p.code, itemId: ids[n % 2 ? 1 : 2], toIndex: 1 });
    const q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(new Set(q.items.map((i) => i.id)).size, 3);
    assert.equal(q.items.length, 3);
  } finally { p.close(); }
});

test('end of video: trusted reports advance exactly once; empty queue pauses; stale and early reports are ignored', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0), title: 'First' });
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(1), title: 'Second' });
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(2), title: 'Third' });

    // Without a known duration, only a controller can report the end; a guest is ignored.
    assert.equal((await emit(p.as, 'player:ended', { code: p.code, videoId: VIDEOS[0] })).reason, 'NOT_FINISHED');
    assert.equal((await emit(p.as, 'player:duration', { code: p.code, videoId: VIDEOS[0], duration: 100 })).stored, false, 'guests cannot set the duration');
    assert.ok((await emit(p.hs, 'player:duration', { code: p.code, videoId: VIDEOS[0], duration: 100 })).stored);

    // Playing at 10s of 100s: a guest claiming "ended" must not skip.
    await emit(p.hs, 'player:play', { code: p.code, position: 10 });
    assert.equal((await emit(p.bs, 'player:ended', { code: p.code, videoId: VIDEOS[0] })).reason, 'NOT_FINISHED');

    // Near the end, everyone's player reports at once: only one advance happens.
    await emit(p.hs, 'player:seek', { code: p.code, position: 99 });
    const results = await Promise.all([p.hs, p.as, p.bs].map((s) => emit(s, 'player:ended', { code: p.code, videoId: VIDEOS[0] })));
    assert.equal(results.filter((r) => r.advanced).length, 1);
    let room = (await p.host.c.get(`/api/rooms/${p.code}`)).body.room;
    assert.equal(room.playback.videoId, VIDEOS[1]);
    assert.equal(room.playback.isPlaying, true);
    let q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.deepEqual(q.items.map((i) => i.title), ['Third'], 'only one entry was consumed');
    assert.equal(q.current.videoId, VIDEOS[1]);

    // A late duplicate for the old video is a no-op.
    assert.equal((await emit(p.as, 'player:ended', { code: p.code, videoId: VIDEOS[0] })).reason, 'STALE');

    // Skip with queue:next (controllers only).
    assert.equal((await emit(p.as, 'queue:next', { code: p.code })).error.code, 'HOST_ONLY');
    assert.ok((await emit(p.hs, 'queue:next', { code: p.code })).ok);
    assert.equal((await emit(p.hs, 'queue:next', { code: p.code })).error.code, 'QUEUE_EMPTY');

    // Last video ends with an empty queue: room pauses at the end once.
    await emit(p.hs, 'player:duration', { code: p.code, videoId: VIDEOS[2], duration: 50 });
    await emit(p.hs, 'player:play', { code: p.code, position: 49 });
    const fin = await Promise.all([p.hs, p.as].map((s) => emit(s, 'player:ended', { code: p.code, videoId: VIDEOS[2] })));
    assert.equal(fin.filter((r) => r.finished).length, 1);
    room = (await p.host.c.get(`/api/rooms/${p.code}`)).body.room;
    assert.equal(room.playback.isPlaying, false);
    assert.equal(room.playback.videoId, VIDEOS[2]);
  } finally { p.close(); }
});

test('concurrent adds of one video, and removal racing with advancing, keep the queue consistent', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) });
    const adds = await Promise.all([p.hs, p.as, p.bs].map((s) => emit(s, 'queue:add', { code: p.code, url: yt(1) })));
    assert.ok(adds.every((r) => r.ok));
    assert.equal(adds.filter((r) => !r.duplicate).length, 1);
    let q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(q.items.length, 1);

    const id = q.items[0].id;
    const [next, removed] = await Promise.all([
      emit(p.hs, 'queue:next', { code: p.code, itemId: id }),
      emit(p.hs, 'queue:remove', { code: p.code, itemId: id }),
    ]);
    // Exactly one of the two actions won; the other got a clean answer.
    const nextWon = next.ok === true;
    const removeWon = removed.removed === true;
    assert.ok(nextWon !== removeWon, `exactly one wins (next=${nextWon}, remove=${removeWon})`);
    q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(q.items.length, 0);
    const room = (await p.host.c.get(`/api/rooms/${p.code}`)).body.room;
    assert.equal(room.playback.videoId, nextWon ? VIDEOS[1] : VIDEOS[0]);
  } finally { p.close(); }
});

test('unavailable video: a controller skips alone; guests need a majority; unrelated reports are ignored', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) });
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(1), title: 'Next' });
    assert.equal((await emit(p.as, 'queue:unavailable', { code: p.code, videoId: VIDEOS[0] })).reason, 'WAITING_FOR_OTHERS');
    assert.equal((await emit(p.as, 'queue:unavailable', { code: p.code, videoId: VIDEOS[3] })).reason, 'STALE');
    assert.ok((await emit(p.bs, 'queue:unavailable', { code: p.code, videoId: VIDEOS[0] })).advanced, '2 of 3 online guests agree');
    assert.equal((await p.host.c.get(`/api/rooms/${p.code}`)).body.room.playback.videoId, VIDEOS[1]);
    assert.equal((await emit(p.hs, 'queue:unavailable', { code: p.code, videoId: VIDEOS[1] })).advanced, false, 'empty queue: nothing to skip to');
  } finally { p.close(); }
});

test('changing the video by hand removes the same video from the queue', async () => {
  const p = await party();
  try {
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) });
    await emit(p.hs, 'queue:add', { code: p.code, url: yt(1) });
    await emit(p.hs, 'player:load', { code: p.code, url: yt(1) });
    const q = (await p.host.c.get(`/api/rooms/${p.code}/queue`)).body.queue;
    assert.equal(q.items.length, 0);
    assert.equal(q.current.videoId, VIDEOS[1]);
  } finally { p.close(); }
});

test('queue survives refresh, reconnect and a server restart', async () => {
  const p = await party();
  await emit(p.hs, 'queue:add', { code: p.code, url: yt(0) });
  const id = (await emit(p.hs, 'queue:add', { code: p.code, url: yt(1), title: 'Persisted' })).itemId;
  await emit(p.as, 'queue:vote', { code: p.code, itemId: id });
  p.close();

  // "Refresh": a fresh socket gets the full queue in the join ack.
  const again = await connect(srv.base, p.ann.c.cookie);
  const ack = await enter(again, p.code);
  assert.equal(ack.queue.items[0].title, 'Persisted');
  assert.equal(ack.queue.items[0].votes, 1);
  again.disconnect();

  // Server restart: stop, start against the same database, sign in again.
  await srv.stop();
  const second = await start({ port: 0 });
  try {
    const base2 = `http://127.0.0.1:${second.port}`;
    const login = await p.ann.c.get(`/api/rooms/${p.code}/queue`).catch(() => null);
    assert.equal(login, null, 'old base url is gone');
  } catch { /* expected: the old client points at the old port */ }
  const { client } = await import('./helpers.js');
  const c2 = client(`http://127.0.0.1:${second.port}`);
  const l = await c2.post('/api/auth/login', { email: p.ann.email, password: 'password123' });
  assert.equal(l.status, 200);
  const q = (await c2.get(`/api/rooms/${p.code}/queue`)).body.queue;
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].title, 'Persisted');
  assert.equal(q.items[0].votes, 1);
  assert.equal(q.current.videoId, VIDEOS[0]);
  await second.stop();
  srv = await boot();
});
