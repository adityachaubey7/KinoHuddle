import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, connect, emit, sleep, makeRoom, enter } from './helpers.js';
import { Room } from '../src/models/Room.js';
import { Notification } from '../src/models/Notification.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

async function setup() {
  const host = await signup(srv.base, 'Host');
  const mod = await signup(srv.base, 'Mona');
  const ben = await signup(srv.base, 'Ben');
  const cara = await signup(srv.base, 'Cara');
  const code = await makeRoom(host, [mod, ben, cara]);
  const p = await host.c.post(`/api/rooms/${code}/moderators`, { userId: mod.user.id, moderator: true });
  assert.equal(p.status, 200);
  const socks = {};
  for (const [k, u] of Object.entries({ host, mod, ben, cara })) {
    socks[k] = await connect(srv.base, u.c.cookie);
    await enter(socks[k], code);
  }
  return { host, mod, ben, cara, code, socks, close: () => Object.values(socks).forEach((s) => s.disconnect()) };
}
const say = (s, code, text) => emit(s, 'chat:send', { code, text, clientId: `c${Math.random().toString(36).slice(2, 12)}` });

test('moderators: only the host appoints; role shows in the room; permission matrix', async () => {
  const t = await setup();
  try {
    const room = (await t.ben.c.get(`/api/rooms/${t.code}`)).body.room;
    assert.equal(room.members.find((m) => m.id === t.mod.user.id).role, 'moderator');
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/moderators`, { userId: t.ben.user.id, moderator: true })).body.error.code, 'HOST_ONLY');
    assert.equal((await t.ben.c.post(`/api/rooms/${t.code}/mute`, { userId: t.cara.user.id })).status, 403);

    // A moderator cannot act on the host, on themselves, or on another moderator.
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/mute`, { userId: t.host.user.id })).body.error.code, 'CANNOT_TARGET_HOST');
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/ban`, { userId: t.mod.user.id })).body.error.code, 'CANNOT_TARGET_SELF');
    await t.host.c.post(`/api/rooms/${t.code}/moderators`, { userId: t.ben.user.id, moderator: true });
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/mute`, { userId: t.ben.user.id })).status, 403);
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/mute`, { userId: t.ben.user.id, minutes: 5 })).status, 200, 'host may');
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/mute`, { userId: t.host.user.id })).status, 400);
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/mute`, { userId: 'bad' })).status, 400);
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/mute`, { userId: t.cara.user.id, minutes: 999999 })).status, 400);
    await t.host.c.post(`/api/rooms/${t.code}/moderators`, { userId: t.ben.user.id, moderator: false });
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/moderators`, { userId: t.host.user.id, moderator: true })).status, 400);
  } finally { t.close(); }
});

test('mute: blocks chat and reactions server-side, notifies, expires on its own, can be lifted', async () => {
  const t = await setup();
  try {
    assert.ok((await say(t.socks.ben, t.code, 'hello')).ok);
    const m = await t.mod.c.post(`/api/rooms/${t.code}/mute`, { userId: t.ben.user.id, minutes: 10 });
    assert.equal(m.status, 200);
    assert.equal(m.body.room.members.find((x) => x.id === t.ben.user.id).muted, true);
    assert.equal((await say(t.socks.ben, t.code, 'still here')).error.code, 'MUTED');
    assert.equal((await emit(t.socks.ben, 'reaction:send', { code: t.code, emoji: '😂', clientId: 'reactionid1' })).error.code, 'MUTED');
    assert.ok((await say(t.socks.cara, t.code, 'others unaffected')).ok);
    assert.equal(await Notification.countDocuments({ user: t.ben.user.id, type: 'moderation' }), 1);

    // Temporary mutes lapse without any cleanup job.
    await Room.updateOne({ code: t.code, 'members.user': t.ben.user.id }, { $set: { 'members.$.mutedUntil': new Date(Date.now() - 1000) } });
    assert.ok((await say(t.socks.ben, t.code, 'back again')).ok);
    const state = (await t.host.c.get(`/api/rooms/${t.code}`)).body.room.members.find((x) => x.id === t.ben.user.id);
    assert.equal(state.muted, false);

    await t.mod.c.post(`/api/rooms/${t.code}/mute`, { userId: t.ben.user.id });
    assert.equal((await say(t.socks.ben, t.code, 'x')).error.code, 'MUTED');
    assert.equal((await t.mod.c.get(`/api/rooms/${t.code}/moderation`)).body.muted.length, 1);
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/unmute`, { userId: t.ben.user.id })).status, 200);
    assert.ok((await say(t.socks.ben, t.code, 'free')).ok);
  } finally { t.close(); }
});

test('ban: temporary and permanent, disconnects, blocks rejoin, expires, unban rules', async () => {
  const t = await setup();
  try {
    const removed = new Promise((r) => t.socks.ben.once('room:removed', r));
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/ban`, { userId: t.ben.user.id, minutes: 30 })).status, 200);
    await removed;
    assert.equal((await t.ben.c.get(`/api/rooms/${t.code}`)).body.access, 'removed');
    assert.equal((await t.ben.c.post(`/api/rooms/${t.code}/join`)).body.error.code, 'REMOVED');
    assert.equal((await t.ben.c.get('/api/rooms')).body.rooms.some((r) => r.code === t.code), false);
    assert.equal((await t.mod.c.get(`/api/rooms/${t.code}/moderation`)).body.banned.length, 1);

    // The ban runs out by itself.
    await Room.updateOne({ code: t.code, 'members.user': t.ben.user.id }, { $set: { 'members.$.bannedUntil': new Date(Date.now() - 1000) } });
    assert.equal((await t.ben.c.get(`/api/rooms/${t.code}`)).body.access, 'preview');
    assert.equal((await t.ben.c.post(`/api/rooms/${t.code}/join`)).status, 200);

    // Host's permanent removal can't be undone by a moderator; moderators can undo their own bans.
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/remove`, { userId: t.cara.user.id })).status, 200);
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/unban`, { userId: t.cara.user.id })).status, 403);
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/ban`, { userId: t.ben.user.id })).status, 200);
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/unban`, { userId: t.ben.user.id })).status, 200);
    assert.equal((await t.ben.c.post(`/api/rooms/${t.code}/join`)).status, 200);
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/unban`, { userId: t.cara.user.id })).status, 200);
    assert.equal((await t.mod.c.post(`/api/rooms/${t.code}/unban`, { userId: t.cara.user.id })).body.error.code, 'NOT_BANNED');
    assert.equal((await t.cara.c.post(`/api/rooms/${t.code}/join`)).status, 200);
    assert.equal((await t.ben.c.post(`/api/rooms/${t.code}/ban`, { userId: t.cara.user.id })).status, 403);

    // A member who already left can still be banned (stops them returning).
    await t.cara.c.post(`/api/rooms/${t.code}/leave`);
    assert.equal((await t.host.c.post(`/api/rooms/${t.code}/ban`, { userId: t.cara.user.id, minutes: 60 })).status, 200);
    assert.equal((await t.cara.c.post(`/api/rooms/${t.code}/join`)).body.error.code, 'REMOVED');
  } finally { t.close(); }
});

test('slow mode: host sets it, members are held to it, moderators exempt, validated', async () => {
  const t = await setup();
  try {
    assert.equal((await t.ben.c.patch(`/api/rooms/${t.code}`, { slowModeSeconds: 5 })).status, 403);
    assert.equal((await t.mod.c.patch(`/api/rooms/${t.code}`, { slowModeSeconds: 5 })).status, 403, 'host only');
    assert.equal((await t.host.c.patch(`/api/rooms/${t.code}`, { slowModeSeconds: 9999 })).status, 400);
    const set = await t.host.c.patch(`/api/rooms/${t.code}`, { slowModeSeconds: 1 });
    assert.equal(set.body.room.slowModeSeconds, 1);

    assert.ok((await say(t.socks.ben, t.code, 'one')).ok);
    const blocked = await say(t.socks.ben, t.code, 'two');
    assert.equal(blocked.error.code, 'SLOW_MODE');
    assert.ok(blocked.retryAfter >= 1);
    assert.ok((await say(t.socks.cara, t.code, 'someone else is fine')).ok);
    assert.ok((await say(t.socks.mod, t.code, 'mod one')).ok);
    assert.ok((await say(t.socks.mod, t.code, 'mod two')).ok, 'moderators are exempt');
    await sleep(1100);
    assert.ok((await say(t.socks.ben, t.code, 'three')).ok);
    await t.host.c.patch(`/api/rooms/${t.code}`, { slowModeSeconds: 0 });
    assert.ok((await say(t.socks.ben, t.code, 'four')).ok);
  } finally { t.close(); }
});

test('reports: validation, duplicates, review permissions, actions, notifications, privacy', async () => {
  const t = await setup();
  try {
    const bad = await say(t.socks.cara, t.code, 'you are all terrible');
    const msgId = bad.message.id;
    const eve = await signup(srv.base, 'Eve');
    const base = `/api/rooms/${t.code}/reports`;

    assert.equal((await eve.c.post(base, { userId: t.cara.user.id, reason: 'spam' })).status, 403, 'non-members cannot report');
    assert.equal((await t.ben.c.post(base, { userId: t.ben.user.id, reason: 'spam' })).body.error.code, 'CANNOT_TARGET_SELF');
    assert.equal((await t.ben.c.post(base, { userId: t.cara.user.id, reason: 'nonsense' })).status, 400);
    assert.equal((await t.ben.c.post(base, { userId: t.cara.user.id, reason: 'spam', details: 'x'.repeat(301) })).status, 400);
    assert.equal((await t.ben.c.post(base, { userId: t.cara.user.id, messageId: t.host.user.id, reason: 'spam' })).body.error.code, 'MESSAGE_NOT_FOUND');
    assert.equal((await t.ben.c.post(base, { userId: t.mod.user.id, messageId: msgId, reason: 'spam' })).body.error.code, 'MESSAGE_NOT_FOUND', 'message must belong to the reported person');

    const ok = await t.ben.c.post(base, { userId: t.cara.user.id, messageId: msgId, reason: 'harassment', details: 'Insulting everyone' });
    assert.equal(ok.status, 201);
    assert.equal((await t.ben.c.post(base, { userId: t.cara.user.id, messageId: msgId, reason: 'harassment' })).body.error.code, 'ALREADY_REPORTED');

    // Only the host and moderators can see reports.
    assert.equal((await t.ben.c.get(base)).status, 403);
    assert.equal((await eve.c.get(base)).status, 403);
    assert.equal((await t.ben.c.get(`/api/rooms/${t.code}/moderation/log`)).status, 403);
    const list = (await t.mod.c.get(base)).body.reports;
    assert.equal(list.length, 1);
    assert.equal(list[0].messageText, 'you are all terrible');
    assert.equal(list[0].reporter.displayName, 'Ben');
    assert.equal(JSON.stringify(list).includes('@example.com'), false, 'no email addresses in reports');

    // Review: act + mute; second review is refused; reporter is thanked (without details).
    const rid = list[0].id;
    assert.equal((await t.ben.c.post(`${base}/${rid}`, { decision: 'dismiss' })).status, 403);
    const done = await t.mod.c.post(`${base}/${rid}`, { decision: 'action', action: 'mute', minutes: 15, note: 'warned' });
    assert.equal(done.status, 200);
    assert.equal(done.body.report.status, 'actioned');
    assert.equal((await t.host.c.post(`${base}/${rid}`, { decision: 'dismiss' })).body.error.code, 'ALREADY_HANDLED');
    assert.equal((await say(t.socks.cara, t.code, 'again')).error.code, 'MUTED');
    const thanks = await Notification.find({ user: t.ben.user.id, type: 'report_outcome' });
    assert.equal(thanks.length, 1);
    assert.equal(thanks[0].body.includes('mute'), false);

    // Reports about the host: moderators review (no punishment possible); the host never sees them.
    const hostReport = await t.cara.c.post(base, { userId: t.host.user.id, reason: 'other', details: 'rude' });
    assert.equal(hostReport.status, 201);
    assert.equal((await t.host.c.get(base)).body.reports.length, 0, 'host cannot see reports about themselves');
    const hr = (await t.mod.c.get(base)).body.reports[0];
    assert.equal((await t.mod.c.post(`${base}/${hr.id}`, { decision: 'action', action: 'ban' })).body.error.code, 'CANNOT_TARGET_HOST');
    assert.equal((await t.mod.c.get(base)).body.reports.length, 1, 'report is still open after the refused punishment');
    assert.equal((await t.mod.c.post(`${base}/${hr.id}`, { decision: 'dismiss', note: 'reviewed' })).body.report.status, 'dismissed');
    assert.equal((await t.host.c.post(`${base}/${hr.id}`, { decision: 'dismiss' })).status, 403);

    // Audit log records who did what, and is private.
    const log = (await t.host.c.get(`/api/rooms/${t.code}/moderation/log`)).body.log;
    const actions = log.map((l) => l.action);
    for (const a of ['promote', 'mute', 'report_actioned', 'report_dismissed']) assert.ok(actions.includes(a), a);
    assert.equal(log.find((l) => l.action === 'mute').actor, 'Mona');
    assert.equal((await eve.c.get(`/api/rooms/${t.code}/moderation`)).status, 403);

    // A departed member can still be reported (their earlier message is context) and their report remains reviewable.
    await t.cara.c.post(`/api/rooms/${t.code}/leave`);
    assert.equal((await t.ben.c.post(base, { userId: t.cara.user.id, reason: 'spam' })).status, 201);
    // Demoted moderators lose access immediately.
    await t.host.c.post(`/api/rooms/${t.code}/moderators`, { userId: t.mod.user.id, moderator: false });
    assert.equal((await t.mod.c.get(base)).status, 403);
  } finally { t.close(); }
});
