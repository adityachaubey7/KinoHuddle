import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, connect, emit, once, sleep } from './helpers.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

async function setupRoom() {
  const host = await signup(srv.base, 'Hana');
  const guest = await signup(srv.base, 'Gil');
  const { code } = (await host.c.post('/api/rooms', { name: 'Sync test' })).body.room;
  await guest.c.post(`/api/rooms/${code}/join`);
  return { host, guest, code };
}

test('unauthenticated sockets are refused', async () => {
  await assert.rejects(connect(srv.base, ''), /UNAUTHENTICATED/);
  await assert.rejects(connect(srv.base, 'ss_token=forged.token.value'), /UNAUTHENTICATED/);
});

test('non-members cannot join a room channel or send to it', async () => {
  const { code } = await setupRoom();
  const outsider = await signup(srv.base, 'Out');
  const s = await connect(srv.base, outsider.c.cookie);
  const r = await emit(s, 'room:join', { code });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_A_MEMBER');
  const m = await emit(s, 'chat:send', { code, text: 'hi', clientId: 'abcdef123' });
  assert.equal(m.error.code, 'NOT_A_MEMBER');
  s.close();
});

test('synchronized playback, late join state, permissions', async () => {
  const { host, guest, code } = await setupRoom();
  const hs = await connect(srv.base, host.c.cookie);
  const gs = await connect(srv.base, guest.c.cookie);
  const hj = await emit(hs, 'room:join', { code });
  assert.ok(hj.ok);
  const gj = await emit(gs, 'room:join', { code });
  assert.ok(gj.ok);
  assert.equal(gj.room.members.find((m) => m.id === host.user.id).online, true);

  // Invalid link is rejected
  const bad = await emit(hs, 'player:load', { code, url: 'https://example.com/video' });
  assert.equal(bad.error.code, 'INVALID_VIDEO_URL');

  // Host loads a video -> guest receives it
  const gotLoad = once(gs, 'player:state');
  const load = await emit(hs, 'player:load', { code, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Big Buck Bunny' });
  assert.ok(load.ok);
  const s1 = await gotLoad;
  assert.equal(s1.action, 'load');
  assert.equal(s1.videoId, 'aqz-KE-bpKQ');

  // Guest without permission cannot control
  const denied = await emit(gs, 'player:play', { code, position: 0 });
  assert.equal(denied.error.code, 'HOST_ONLY');

  // Play from 30s
  const gotPlay = once(gs, 'player:state');
  await emit(hs, 'player:play', { code, position: 30 });
  const s2 = await gotPlay;
  assert.equal(s2.isPlaying, true);
  assert.equal(s2.action, 'play');
  assert.ok(s2.seq > s1.seq, 'sequence increases');

  // Authoritative position advances while playing
  await sleep(600);
  const sync = await emit(gs, 'player:sync', { code });
  assert.ok(sync.state.position >= 30.5 && sync.state.position < 32, `position ${sync.state.position}`);

  // Seek and pause
  const gotSeek = once(gs, 'player:state');
  await emit(hs, 'player:seek', { code, position: 120 });
  assert.equal((await gotSeek).position >= 120, true);
  const gotPause = once(gs, 'player:state');
  await emit(hs, 'player:pause', { code, position: 125 });
  const paused = await gotPause;
  assert.equal(paused.isPlaying, false);
  assert.equal(paused.position, 125);

  // Out-of-range position rejected
  assert.equal((await emit(hs, 'player:seek', { code, position: -5 })).error.code, 'BAD_REQUEST');

  // Late joiner (reconnect) restores the same video and position
  gs.close();
  await sleep(100);
  const gs2 = await connect(srv.base, guest.c.cookie);
  const rejoin = await emit(gs2, 'room:join', { code });
  assert.equal(rejoin.room.playback.videoId, 'aqz-KE-bpKQ');
  assert.equal(rejoin.room.playback.position, 125);
  assert.equal(rejoin.room.playback.isPlaying, false);

  // Host enables guest control -> guest can now play
  await host.c.patch(`/api/rooms/${code}`, { guestControl: true });
  const allowed = await emit(gs2, 'player:play', { code, position: 125 });
  assert.ok(allowed.ok);

  hs.close();
  gs2.close();
});

test('chat: delivery, ordering, persistence, validation, de-duplication, rate limit', async () => {
  const { host, guest, code } = await setupRoom();
  const hs = await connect(srv.base, host.c.cookie);
  const gs = await connect(srv.base, guest.c.cookie);
  await emit(hs, 'room:join', { code });
  await emit(gs, 'room:join', { code });

  const received = [];
  gs.on('chat:message', (m) => m.kind === 'text' && received.push(m));

  const a = await emit(hs, 'chat:send', { code, text: '  Hello there  ', clientId: 'msg-000001' });
  assert.ok(a.ok);
  assert.equal(a.message.text, 'Hello there');
  assert.equal(a.message.user.displayName, 'Hana');

  // Retry with the same clientId -> no duplicate
  const retry = await emit(hs, 'chat:send', { code, text: 'Hello there', clientId: 'msg-000001' });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.message.id, a.message.id);

  await emit(gs, 'chat:send', { code, text: 'Hi!', clientId: 'msg-000002' });
  await sleep(150);
  assert.deepEqual(received.map((m) => m.text), ['Hello there', 'Hi!']);

  // Validation
  assert.equal((await emit(hs, 'chat:send', { code, text: '   ', clientId: 'msg-000003' })).error.code, 'EMPTY');
  assert.equal((await emit(hs, 'chat:send', { code, text: 'x'.repeat(501), clientId: 'msg-000004' })).error.code, 'TOO_LONG');
  assert.equal((await emit(hs, 'chat:send', { code, text: 'hi', clientId: 'bad id!' })).error.code, 'BAD_REQUEST');

  // History persists and loads for a joining member, in chronological order
  const hist = await host.c.get(`/api/rooms/${code}/messages`);
  const texts = hist.body.messages.filter((m) => m.kind === 'text').map((m) => m.text);
  assert.deepEqual(texts, ['Hello there', 'Hi!']);
  const times = hist.body.messages.map((m) => new Date(m.createdAt).getTime());
  assert.deepEqual(times, [...times].sort((x, y) => x - y));

  // Rate limit: 8 per 10s per user (guest has used 1)
  let limited = null;
  for (let i = 0; i < 10; i++) {
    const r = await emit(gs, 'chat:send', { code, text: `spam ${i}`, clientId: `spam-00000${i}` });
    if (!r.ok) { limited = r; break; }
  }
  assert.equal(limited?.error.code, 'RATE_LIMITED');

  hs.close();
  gs.close();
});

test('reactions broadcast with timestamps and reject unknown emoji', async () => {
  const { host, guest, code } = await setupRoom();
  const hs = await connect(srv.base, host.c.cookie);
  const gs = await connect(srv.base, guest.c.cookie);
  await emit(hs, 'room:join', { code });
  await emit(gs, 'room:join', { code });
  const got = once(gs, 'reaction');
  const r = await emit(hs, 'reaction:send', { code, emoji: '🔥', clientId: 'react-0001' });
  assert.ok(r.ok);
  const reaction = await got;
  assert.equal(reaction.emoji, '🔥');
  assert.ok(reaction.createdAt);
  assert.equal((await emit(hs, 'reaction:send', { code, emoji: '💩', clientId: 'react-0002' })).error.code, 'BAD_REQUEST');
  hs.close();
  gs.close();
});

test('presence: duplicate tabs count once; offline on last disconnect; host handover after grace', async () => {
  const { host, guest, code } = await setupRoom();
  const h1 = await connect(srv.base, host.c.cookie);
  const h2 = await connect(srv.base, host.c.cookie);
  const gs = await connect(srv.base, guest.c.cookie);
  await emit(h1, 'room:join', { code });
  await emit(h2, 'room:join', { code });
  const j = await emit(gs, 'room:join', { code });
  assert.equal(j.room.members.filter((m) => m.online).length, 2);

  // Closing one of two tabs keeps the host online (no update needed)
  h1.close();
  await sleep(200);
  let state = (await host.c.get(`/api/rooms/${code}`)).body.room;
  assert.equal(state.members.find((m) => m.id === host.user.id).online, true);

  // Closing the last tab -> offline update, then handover after the 1s grace (test config)
  const offline = once(gs, 'room:update');
  h2.close();
  const upd = await offline;
  assert.equal(upd.members.find((m) => m.id === host.user.id).online, false);
  const handover = await once(gs, 'room:update', 4000);
  assert.equal(handover.hostId, guest.user.id);
  gs.close();
});

test('closing a room notifies members and blocks further events', async () => {
  const { host, guest, code } = await setupRoom();
  const gs = await connect(srv.base, guest.c.cookie);
  await emit(gs, 'room:join', { code });
  const closed = once(gs, 'room:closed');
  await host.c.post(`/api/rooms/${code}/close`);
  assert.equal((await closed).reason, 'closed');
  const r = await emit(gs, 'chat:send', { code, text: 'still here?', clientId: 'after-close' });
  assert.equal(r.error.code, 'ROOM_CLOSED');
  gs.close();
});

test('removed members are disconnected from the room channel', async () => {
  const { host, guest, code } = await setupRoom();
  const gs = await connect(srv.base, guest.c.cookie);
  await emit(gs, 'room:join', { code });
  const removed = once(gs, 'room:removed');
  await host.c.post(`/api/rooms/${code}/remove`, { userId: guest.user.id });
  await removed;
  const r = await emit(gs, 'room:join', { code });
  assert.equal(r.error.code, 'NOT_A_MEMBER');
  gs.close();
});
