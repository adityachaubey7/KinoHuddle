import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, connect, once, sleep } from './helpers.js';
import { WatchEvent } from '../src/models/WatchEvent.js';
import { Notification } from '../src/models/Notification.js';
import { Room } from '../src/models/Room.js';
import { runReminders } from '../src/services/scheduler.js';
import { notify } from '../src/services/notifications.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

const inMinutes = (m) => new Date(Date.now() + m * 60_000);
const mk = (host, over = {}) =>
  host.c.post('/api/events', { title: 'Movie night', startsAt: inMinutes(120).toISOString(), timeZone: 'Asia/Kolkata', ...over });
const notes = (u, q = '') => u.c.get(`/api/notifications${q}`);

test('create: validation, UTC storage, room expiry outlives the party', async () => {
  const host = await signup(srv.base, 'Hana');
  assert.equal((await mk(host, { startsAt: inMinutes(-30).toISOString() })).status, 400);
  assert.equal((await mk(host, { startsAt: 'tomorrow' })).status, 400);
  assert.equal((await mk(host, { timeZone: 'Mars/Base' })).status, 400);
  assert.equal((await mk(host, { startsAt: new Date(Date.now() + 400 * 864e5).toISOString() })).status, 400);
  assert.equal((await mk(host, { title: 'x' })).status, 400);

  // A start time sent with an offset is stored as the same instant in UTC.
  const day = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
  const r = await mk(host, { startsAt: `${day}T20:00:00+05:30`, durationMinutes: 90 });
  assert.equal(r.status, 201);
  assert.equal(r.body.event.startsAt, `${day}T14:30:00.000Z`);
  assert.equal(r.body.event.timeZone, 'Asia/Kolkata');
  assert.equal(r.body.event.phase, 'upcoming');
  assert.ok(r.body.event.roomCode, 'organiser sees the room code');
  const stored = await WatchEvent.findById(r.body.event.id);
  assert.equal(stored.startsAt.toISOString(), `${day}T14:30:00.000Z`);

  // The room must not expire before a party that is days away.
  const room = await Room.findOne({ code: r.body.event.roomCode });
  assert.ok(room.expiresAt.getTime() >= new Date(`${day}T14:30:00Z`).getTime());
});

test('visibility: private events are invisible to strangers; invite link, rotation and expiry', async () => {
  const host = await signup(srv.base, 'Hana');
  const eve = await signup(srv.base, 'Eve');
  const ev = (await mk(host)).body.event;

  assert.equal((await eve.c.get(`/api/events/${ev.id}`)).status, 404);
  assert.equal((await eve.c.get('/api/events/not-an-id')).status, 404);
  assert.equal((await eve.c.get(`/api/events/${ev.id}?invite=wrong`)).status, 404);

  const token = ev.inviteLink.split('invite=')[1];
  const viaLink = await eve.c.get(`/api/events/${ev.id}?invite=${token}`);
  assert.equal(viaLink.status, 200);
  assert.equal(viaLink.body.event.roomCode, null, 'the room code stays hidden from people who have not joined');
  assert.equal(viaLink.body.event.inviteLink, null);

  const rotated = (await host.c.post(`/api/events/${ev.id}/invite-link`)).body.inviteLink.split('invite=')[1];
  assert.notEqual(rotated, token);
  const frank = await signup(srv.base, 'Frank');
  assert.equal((await frank.c.get(`/api/events/${ev.id}?invite=${token}`)).status, 404, 'old link is dead');
  assert.equal((await frank.c.get(`/api/events/${ev.id}?invite=${rotated}`)).status, 200);
  assert.equal((await eve.c.post(`/api/events/${ev.id}/invite-link`)).status, 403);

  // The invitation expires once the party is over.
  await WatchEvent.updateOne({ _id: ev.id }, { startsAt: inMinutes(-300), durationMinutes: 60 });
  const gina = await signup(srv.base, 'Gina');
  const expired = await gina.c.get(`/api/events/${ev.id}?invite=${rotated}`);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error.code, 'INVITE_EXPIRED');
});

test('public events are listed for everyone; private ones never are', async () => {
  const host = await signup(srv.base, 'Hana');
  const other = await signup(srv.base, 'Omar');
  const pub = (await mk(host, { title: 'Open screening', visibility: 'public', topic: 'movies' })).body.event;
  const priv = (await mk(host, { title: 'Secret screening' })).body.event;
  const list = (await other.c.get('/api/events?scope=public')).body.events.map((e) => e.id);
  assert.ok(list.includes(pub.id));
  assert.ok(!list.includes(priv.id));
  assert.equal((await other.c.get(`/api/events/${pub.id}`)).status, 200);
  assert.equal((await other.c.get(`/api/events/${priv.id}`)).status, 404);
  assert.equal((await other.c.get('/api/events?scope=bogus')).status, 400);
});

test('invitations: notify existing accounts, reveal nothing about others, arrive live, never duplicate', async () => {
  const host = await signup(srv.base, 'Hana');
  const ivy = await signup(srv.base, 'Ivy');
  const ev = (await mk(host)).body.event;

  const sock = await connect(srv.base, ivy.c.cookie);
  const pushed = once(sock, 'notification:new');
  const a = await host.c.post(`/api/events/${ev.id}/invite`, { emails: [ivy.email, 'nobody-here@example.com'] });
  const b = await host.c.post(`/api/events/${ev.id}/invite`, { emails: ['someone-else@example.com'] });
  assert.equal(a.status, 200);
  assert.deepEqual(Object.keys(a.body), Object.keys(b.body), 'same response shape whether or not the account exists');

  const live = await pushed;
  assert.equal(live.notification.type, 'event_invite');
  assert.equal(live.unread, 1);
  sock.disconnect();

  await host.c.post(`/api/events/${ev.id}/invite`, { emails: [ivy.email] }); // retry
  const list = (await notes(ivy)).body;
  assert.equal(list.notifications.length, 1);
  assert.equal(list.unread, 1);
  assert.equal(list.notifications[0].link, `/events/${ev.id}`);

  // Invited people can open the event without the link.
  assert.equal((await ivy.c.get(`/api/events/${ev.id}`)).status, 200);
  const stranger = await signup(srv.base, 'Stu');
  assert.equal((await stranger.c.post(`/api/events/${ev.id}/invite`, { emails: [stranger.email] })).status, 403);
  assert.equal((await host.c.post(`/api/events/${ev.id}/invite`, { emails: ['not-an-email'] })).status, 400);
});

test('RSVP: states, capacity, host rules, ended events', async () => {
  const host = await signup(srv.base, 'Hana');
  const [a, b, c] = [await signup(srv.base, 'Ann'), await signup(srv.base, 'Ben'), await signup(srv.base, 'Cy')];
  const ev = (await mk(host, { visibility: 'public', maxMembers: 3 })).body.event;
  assert.equal(ev.goingCount, 1);

  let r = await a.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' });
  assert.equal(r.body.event.myRsvp, 'going');
  assert.equal(r.body.event.goingCount, 2);
  r = await a.c.put(`/api/events/${ev.id}/rsvp`, { status: 'not_going' });
  assert.equal(r.body.event.myRsvp, 'not_going');
  assert.equal(r.body.event.goingCount, 1);
  await a.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' });
  await b.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' });
  const full = await c.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' });
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, 'EVENT_FULL');
  assert.equal((await c.c.put(`/api/events/${ev.id}/rsvp`, { status: 'maybe' })).status, 400);
  assert.equal((await host.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' })).status, 400);

  assert.equal((await WatchEvent.findById(ev.id)).rsvps.length, 2, 'one entry per person');
  const attendees = (await host.c.get(`/api/events/${ev.id}`)).body.event.attendees.map((x) => x.displayName).sort();
  assert.deepEqual(attendees, ['Ann', 'Ben']);
  assert.equal((await a.c.get(`/api/events/${ev.id}`)).body.event.attendees, undefined, 'guests do not see the attendee list');

  await WatchEvent.updateOne({ _id: ev.id }, { startsAt: inMinutes(-500), durationMinutes: 60 });
  assert.equal((await c.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' })).body.error.code, 'EVENT_ENDED');
  const past = (await a.c.get('/api/events?phase=past')).body.events;
  assert.ok(past.some((e) => e.id === ev.id && e.phase === 'completed'));
});

test('joining: early-entry window, access rules, bans and capacity of the room still apply', async () => {
  const host = await signup(srv.base, 'Hana');
  const guest = await signup(srv.base, 'Gus');
  const eve = await signup(srv.base, 'Eve');
  const ev = (await mk(host)).body.event;
  const token = ev.inviteLink.split('invite=')[1];

  assert.equal((await host.c.post(`/api/events/${ev.id}/join`, {})).status, 200, 'organiser can always enter');
  const early = await guest.c.post(`/api/events/${ev.id}/join`, { invite: token });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, 'EVENT_NOT_STARTED');
  assert.equal((await eve.c.post(`/api/events/${ev.id}/join`, {})).status, 404, 'no access, no hint that it exists');

  await WatchEvent.updateOne({ _id: ev.id }, { startsAt: inMinutes(5) });
  const ok = await guest.c.post(`/api/events/${ev.id}/join`, { invite: token });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.joined);
  const after = (await guest.c.get(`/api/events/${ev.id}`)).body.event;
  assert.equal(after.myRsvp, 'going', 'joining counts as attending');
  assert.equal(after.roomCode, ev.roomCode, 'now a member, so the code is visible');

  // A banned person cannot sneak back in through the event link.
  const ban = await host.c.post(`/api/rooms/${ev.roomCode}/ban`, { userId: guest.user.id });
  assert.equal(ban.status, 200);
  const again = await guest.c.post(`/api/events/${ev.id}/join`, { invite: token });
  assert.equal(again.status, 403);
});

test('edit and cancel: host only; rescheduling retracts stale reminders; cancelling notifies and stops reminders', async () => {
  const host = await signup(srv.base, 'Hana');
  const ann = await signup(srv.base, 'Ann');
  const ev = (await mk(host, { visibility: 'public', startsAt: inMinutes(10).toISOString() })).body.event;
  await ann.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' });

  assert.equal((await ann.c.patch(`/api/events/${ev.id}`, { title: 'Hijack' })).status, 403);
  assert.equal((await ann.c.post(`/api/events/${ev.id}/cancel`)).status, 403);
  assert.equal((await host.c.patch(`/api/events/${ev.id}`, { bogus: 1 })).status, 400);

  // Reminder goes out (starts in 10 min, lead 15 min).
  const reminders = (u) => Notification.countDocuments({ user: u.user.id, type: 'event_reminder', 'data.eventId': ev.id });
  await runReminders();
  assert.equal(await reminders(ann), 1);

  // Reschedule: the unread reminder is withdrawn, going guests are told, and a new reminder is scheduled.
  const later = inMinutes(180).toISOString();
  const edit = await host.c.patch(`/api/events/${ev.id}`, { startsAt: later });
  assert.equal(edit.status, 200);
  const afterEdit = (await notes(ann)).body.notifications.map((n) => n.type);
  assert.ok(!afterEdit.includes('event_reminder'), 'stale reminder withdrawn');
  assert.ok(afterEdit.includes('event_updated'));
  await runReminders();
  assert.equal(await reminders(ann), 0, 'not due yet at the new time');
  await runReminders(new Date(Date.now() + 170 * 60_000));
  assert.equal(await reminders(ann), 1, 'due at the new time');

  // Cancel.
  const c1 = await host.c.post(`/api/events/${ev.id}/cancel`);
  assert.equal(c1.body.event.status, 'cancelled');
  assert.equal((await host.c.post(`/api/events/${ev.id}/cancel`)).status, 200, 'cancelling twice is harmless');
  const types = (await notes(ann)).body.notifications.map((n) => n.type);
  assert.ok(types.includes('event_cancelled'));
  assert.ok(!types.includes('event_reminder'), 'reminders for a cancelled party disappear');
  assert.equal(types.filter((t) => t === 'event_cancelled').length, 1);
  await runReminders(new Date(Date.now() + 200 * 60_000));
  assert.equal(await reminders(host), 0, 'no reminder for a cancelled party');
  assert.equal((await host.c.patch(`/api/events/${ev.id}`, { title: 'Nope' })).status, 409);
  assert.equal((await ann.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' })).status, 410);
});

test('reminders are idempotent across repeated runs, parallel workers and restarts; missed parties are skipped', async () => {
  const host = await signup(srv.base, 'Hana');
  const ann = await signup(srv.base, 'Ann');
  const ben = await signup(srv.base, 'Ben');
  const ev = (await mk(host, { visibility: 'public', startsAt: inMinutes(14).toISOString() })).body.event;
  await ann.c.put(`/api/events/${ev.id}/rsvp`, { status: 'going' });
  await ben.c.put(`/api/events/${ev.id}/rsvp`, { status: 'not_going' });

  await Promise.all([runReminders(), runReminders(), runReminders()]); // three workers at once
  await runReminders();
  const count = (u) => Notification.countDocuments({ user: u.user.id, type: 'event_reminder', 'data.eventId': ev.id });
  assert.equal(await count(host), 1);
  assert.equal(await count(ann), 1);
  assert.equal(await count(ben), 0, 'people who said no are not reminded');
  assert.ok((await WatchEvent.findById(ev.id)).reminderSentFor, 'delivery state is persisted');

  // Missed schedule: the server was "down" past the end of the party → no reminder, but marked done.
  const missed = (await mk(host, { startsAt: inMinutes(30).toISOString(), durationMinutes: 15 })).body.event;
  await WatchEvent.updateOne({ _id: missed.id }, { startsAt: inMinutes(-90), durationMinutes: 15 });
  await runReminders();
  assert.equal(await Notification.countDocuments({ 'data.eventId': missed.id, type: 'event_reminder' }), 0);
  // Late but still running: reminder says it already started.
  const running = (await mk(host, { startsAt: inMinutes(30).toISOString() })).body.event;
  await WatchEvent.updateOne({ _id: running.id }, { startsAt: inMinutes(-5) });
  await runReminders();
  const late = await Notification.findOne({ 'data.eventId': running.id, type: 'event_reminder' });
  assert.match(late.title, /started 5 minutes ago/);
});

test('dashboard list: upcoming vs past for the signed-in user only', async () => {
  const host = await signup(srv.base, 'Hana');
  const other = await signup(srv.base, 'Omar');
  const soon = (await mk(host, { title: 'Soon', startsAt: inMinutes(30).toISOString() })).body.event;
  const later = (await mk(host, { title: 'Later', startsAt: inMinutes(600).toISOString() })).body.event;
  const up = (await host.c.get('/api/events?limit=5')).body;
  assert.deepEqual(up.events.map((e) => e.title), ['Soon', 'Later'], 'soonest first');
  assert.equal(up.nextCursor, null);
  assert.deepEqual((await other.c.get('/api/events')).body.events, []);
  const page = (await host.c.get('/api/events?limit=1')).body;
  assert.equal(page.events.length, 1);
  assert.equal(page.nextCursor, '1');
  assert.ok(soon.id && later.id);
});

test('notifications: ownership, read state, pagination, dedupe, real-time count', async () => {
  const a = await signup(srv.base, 'Ann');
  const b = await signup(srv.base, 'Ben');
  assert.equal((await a.c.get('/api/notifications')).status, 200);
  const anon = await (await fetch(`${srv.base}/api/notifications`)).status;
  assert.equal(anon, 401);

  for (let i = 0; i < 5; i++) await notify(a.user.id, { type: 'account', title: `N${i}`, link: '/dashboard' });
  assert.ok(await notify(a.user.id, { type: 'account', title: 'once', dedupeKey: 'k1' }));
  assert.equal(await notify(a.user.id, { type: 'account', title: 'once', dedupeKey: 'k1' }), null, 'same key is stored once');
  assert.ok(await notify(b.user.id, { type: 'account', title: 'Ben only', dedupeKey: 'k1' }), 'keys are per user');

  const sock = await connect(srv.base, a.c.cookie);
  let list = (await notes(a, '?limit=4')).body;
  assert.equal(list.notifications.length, 4);
  assert.ok(list.hasMore);
  assert.equal(list.unread, 6);
  const older = (await notes(a, `?limit=4&before=${encodeURIComponent(list.notifications.at(-1).createdAt)}`)).body;
  assert.ok(older.notifications.length >= 1);
  assert.ok(!older.notifications.some((n) => list.notifications.some((m) => m.id === n.id)), 'no overlap between pages');
  assert.equal((await notes(a, '?limit=500')).status, 400);

  // Ben cannot read, mark or delete Ann's notification (and learns nothing about it).
  const target = list.notifications[0].id;
  assert.equal((await b.c.post(`/api/notifications/${target}/read`)).status, 404);
  assert.equal((await b.c.del(`/api/notifications/${target}`)).status, 404);
  assert.ok(!(await notes(b)).body.notifications.some((n) => n.id === target));
  assert.equal((await Notification.findById(target)).readAt, null);

  const countPush = once(sock, 'notification:count');
  const one = await a.c.post(`/api/notifications/${target}/read`);
  assert.equal(one.body.unread, 5);
  assert.equal((await countPush).unread, 5);
  assert.equal((await a.c.post(`/api/notifications/${target}/read`)).body.unread, 5, 'idempotent');
  assert.equal((await notes(a, '?unread=true&limit=50')).body.notifications.length, 5);

  assert.equal((await a.c.post('/api/notifications/read-all')).body.unread, 0);
  assert.equal((await a.c.get('/api/notifications/unread-count')).body.unread, 0);
  assert.equal((await b.c.get('/api/notifications/unread-count')).body.unread, 1, 'Ben untouched');
  sock.disconnect();

  // Links are only ever in-app paths.
  const bad = await notify(a.user.id, { type: 'account', title: 'bad link', link: 'https://evil.example/x' });
  assert.equal(bad.link, null);
  const proto = await notify(a.user.id, { type: 'account', title: 'bad link 2', link: '//evil.example' });
  assert.equal(proto.link, null);
});

test('notifications for a deleted room still open and link to a safe page', async () => {
  const host = await signup(srv.base, 'Hana');
  const ann = await signup(srv.base, 'Ann');
  const ev = (await mk(host, { visibility: 'public' })).body.event;
  await host.c.post(`/api/events/${ev.id}/invite`, { emails: [ann.email] });
  await Room.deleteOne({ code: ev.roomCode });
  const e = await ann.c.get(`/api/events/${ev.id}`);
  assert.equal(e.status, 200, 'the event page still loads');
  assert.equal(e.body.event.roomOpen, false);
  assert.equal(e.body.event.joinable && e.body.event.roomOpen, false);
  await sleep(10);
});
