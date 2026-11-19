import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Room } from '../models/Room.js';
import { User } from '../models/User.js';
import { WatchEvent, phaseOf, endsAt } from '../models/WatchEvent.js';
import { HttpError } from '../lib/http.js';
import { createRoom, expiryFor, loadRoom, joinRoom, closeRoom } from '../lib/roomService.js';
import { notify, withdrawUnread } from './notifications.js';

export const EARLY_JOIN_MINUTES = 15; // people can enter the room this long before the start time
const MAX_INVITES = 100;
const MAX_AHEAD_MS = 365 * 24 * 3600 * 1000;

export const validTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return typeof tz === 'string' && tz.length <= 64;
  } catch {
    return false;
  }
};

const uid = (u) => (u?._id || u).toString();
const newToken = () => crypto.randomBytes(18).toString('base64url');
const tokenMatches = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

function assertStartsAt(date, { allowPast = false } = {}) {
  const t = date.getTime();
  if (Number.isNaN(t)) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid date and time.', { startsAt: 'Choose a valid date and time.' });
  if (!allowPast && t < Date.now() + 60_000) throw new HttpError(400, 'VALIDATION_ERROR', 'Pick a time in the future.', { startsAt: 'Pick a time in the future.' });
  if (t > Date.now() + MAX_AHEAD_MS) throw new HttpError(400, 'VALIDATION_ERROR', 'Events can be scheduled up to a year ahead.', { startsAt: 'Events can be scheduled up to a year ahead.' });
}

export async function createEvent(user, input) {
  const startsAt = new Date(input.startsAt);
  assertStartsAt(startsAt);
  if (!validTimeZone(input.timeZone)) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown time zone.', { timeZone: 'Unknown time zone.' });
  let video = null;
  if (input.videoUrl) {
    const { parseYouTube } = await import('../lib/youtube.js');
    const parsed = parseYouTube(input.videoUrl);
    if (!parsed) throw new HttpError(400, 'INVALID_VIDEO_URL', 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…', { videoUrl: 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…' });
    video = { ...parsed, title: input.videoTitle || '' };
  }
  const room = await createRoom(user, {
    name: input.title,
    maxMembers: input.maxMembers,
    guestControl: input.guestControl,
    video,
    visibility: input.visibility,
    topic: input.topic,
    language: input.language,
    country: input.country,
    scheduledStartAt: startsAt,
  });
  const event = await WatchEvent.create({
    title: input.title,
    description: input.description || '',
    host: user._id,
    room: room._id,
    roomCode: room.code,
    visibility: room.visibility,
    startsAt,
    durationMinutes: input.durationMinutes,
    timeZone: input.timeZone,
    reminderLeadMinutes: input.reminderLeadMinutes,
    inviteToken: newToken(),
  });
  return event;
}

export async function loadEvent(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'EVENT_NOT_FOUND', 'That watch party doesn’t exist or isn’t shared with you.');
  const event = await WatchEvent.findById(id).populate('host', 'displayName avatarColor');
  if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'That watch party doesn’t exist or isn’t shared with you.');
  return event;
}

const rsvpOf = (event, userId) => event.rsvps.find((r) => uid(r.user) === userId.toString());
const isInvited = (event, userId) => event.invited.some((i) => uid(i.user) === userId.toString());

/**
 * May this person see the event?
 *  - the organiser, anyone who was invited or answered, and members of its room always can;
 *  - anyone can see an event whose room is public;
 *  - anyone holding the current secret link can, until the party is over.
 * Everyone else gets a 404 so private events can't be discovered.
 */
export async function assertCanView(event, user, token) {
  const id = user._id.toString();
  if (uid(event.host) === id || rsvpOf(event, id) || isInvited(event, id)) return { via: 'direct' };
  if (event.visibility === 'public') return { via: 'public' };
  const room = await Room.findById(event.room).select('members');
  if (room?.members.some((m) => uid(m.user) === id && !m.leftAt)) return { via: 'member' };
  if (token && tokenMatches(token, event.inviteToken)) {
    if (event.status === 'cancelled') throw new HttpError(410, 'EVENT_CANCELLED', 'This watch party was cancelled.');
    if (phaseOf(event) === 'completed') throw new HttpError(410, 'INVITE_EXPIRED', 'This invitation has expired because the watch party is over.');
    return { via: 'link' };
  }
  throw new HttpError(404, 'EVENT_NOT_FOUND', 'That watch party doesn’t exist or isn’t shared with you.');
}

export function assertHost(event, user) {
  if (uid(event.host) !== user._id.toString()) throw new HttpError(403, 'HOST_ONLY', 'Only the organiser can do that.');
}

export async function serializeEvent(event, viewer, { room } = {}) {
  const viewerId = viewer._id.toString();
  const isHost = uid(event.host) === viewerId;
  room = room || (await Room.findById(event.room).select('code members maxMembers status visibility'));
  const member = room?.members.some((m) => uid(m.user) === viewerId && !m.leftAt);
  const going = event.rsvps.filter((r) => r.status === 'going');
  const phase = phaseOf(event);
  const opensAt = new Date(new Date(event.startsAt).getTime() - EARLY_JOIN_MINUTES * 60_000);
  const joinable = event.status === 'scheduled' && phase !== 'completed' && (isHost || Date.now() >= opensAt.getTime());
  return {
    id: event._id.toString(),
    title: event.title,
    description: event.description,
    startsAt: new Date(event.startsAt).toISOString(),
    endsAt: endsAt(event).toISOString(),
    durationMinutes: event.durationMinutes,
    timeZone: event.timeZone,
    reminderLeadMinutes: event.reminderLeadMinutes,
    status: event.status,
    phase,
    visibility: event.visibility,
    host: { id: uid(event.host), displayName: event.host?.displayName || 'Host', avatarColor: event.host?.avatarColor },
    isHost,
    maxMembers: room?.maxMembers ?? null,
    goingCount: going.length + 1, // the organiser is always counted
    myRsvp: isHost ? 'going' : rsvpOf(event, viewerId)?.status || null,
    invited: isInvited(event, viewerId),
    joinable,
    joinOpensAt: opensAt.toISOString(),
    roomOpen: room?.status === 'open',
    // The room code is only revealed to people already inside the room. Everyone else enters through /events/:id/join.
    roomCode: isHost || member ? event.roomCode : null,
    inviteLink: isHost ? `/events/${event._id}?invite=${event.inviteToken}` : null,
    attendees: isHost
      ? await attendeeList(going)
      : undefined,
  };
}

async function attendeeList(going) {
  const users = await User.find({ _id: { $in: going.map((g) => g.user) } }).select('displayName');
  return users.map((u) => ({ id: u._id.toString(), displayName: u.displayName }));
}

export async function setRsvp(event, user, status) {
  if (uid(event.host) === user._id.toString()) throw new HttpError(400, 'HOST_ATTENDS', 'You’re the organiser, so you’re already attending.');
  if (event.status === 'cancelled') throw new HttpError(410, 'EVENT_CANCELLED', 'This watch party was cancelled.');
  if (phaseOf(event) === 'completed') throw new HttpError(410, 'EVENT_ENDED', 'This watch party is over.');
  if (status === 'going' && rsvpOf(event, user._id)?.status !== 'going') {
    const room = await Room.findById(event.room).select('maxMembers');
    const going = event.rsvps.filter((r) => r.status === 'going').length + 1;
    if (room && going >= room.maxMembers) throw new HttpError(409, 'EVENT_FULL', `This watch party is full (${room.maxMembers} people).`);
  }
  const now = new Date();
  const updated = await WatchEvent.updateOne(
    { _id: event._id, 'rsvps.user': user._id },
    { $set: { 'rsvps.$.status': status, 'rsvps.$.at': now } }
  );
  if (!updated.matchedCount) {
    await WatchEvent.updateOne({ _id: event._id, 'rsvps.user': { $ne: user._id } }, { $push: { rsvps: { user: user._id, status, at: now } } });
  }
  return loadEvent(event._id);
}

const audience = (event) => [...new Set([...event.rsvps.filter((r) => r.status === 'going').map((r) => uid(r.user)), ...event.invited.map((i) => uid(i.user))])].filter((id) => id !== uid(event.host));

export async function updateEvent(event, user, patch) {
  assertHost(event, user);
  if (event.status === 'cancelled') throw new HttpError(409, 'EVENT_CANCELLED', 'A cancelled watch party can’t be edited.');
  if (phaseOf(event) === 'completed') throw new HttpError(409, 'EVENT_ENDED', 'This watch party is over.');

  const set = {};
  const oldStart = new Date(event.startsAt).getTime();
  let rescheduled = false;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.durationMinutes !== undefined) set.durationMinutes = patch.durationMinutes;
  if (patch.reminderLeadMinutes !== undefined) set.reminderLeadMinutes = patch.reminderLeadMinutes;
  if (patch.timeZone !== undefined) {
    if (!validTimeZone(patch.timeZone)) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown time zone.', { timeZone: 'Unknown time zone.' });
    set.timeZone = patch.timeZone;
  }
  if (patch.startsAt !== undefined) {
    const next = new Date(patch.startsAt);
    assertStartsAt(next);
    if (next.getTime() !== oldStart) {
      set.startsAt = next;
      set.reminderSentFor = null; // the new time gets its own reminder
      rescheduled = true;
    }
  }
  if (!Object.keys(set).length) return { event, changed: false };

  const updated = await WatchEvent.findOneAndUpdate(
    { _id: event._id, status: 'scheduled' },
    { $set: set, $inc: { version: 1 } },
    { returnDocument: 'after' }
  ).populate('host', 'displayName avatarColor');
  if (!updated) throw new HttpError(409, 'EVENT_CANCELLED', 'A cancelled watch party can’t be edited.');

  // Keep the room in step: name, and an expiry that outlives the (new) start time.
  const roomSet = {};
  if (set.title) roomSet.name = set.title;
  if (set.startsAt) {
    roomSet.scheduledStartAt = set.startsAt;
    roomSet.expiresAt = expiryFor({ scheduledStartAt: set.startsAt });
  }
  if (Object.keys(roomSet).length) await Room.updateOne({ _id: event.room }, { $set: roomSet });

  if (rescheduled) {
    // Reminders for the old time are no longer true.
    await withdrawUnread({ type: 'event_reminder', 'data.eventId': event._id.toString() });
  }
  const meaningful = rescheduled || set.title !== undefined || set.timeZone !== undefined;
  if (meaningful) {
    const when = rescheduled ? `now starts ${new Date(set.startsAt).toUTCString()}` : 'was updated';
    await Promise.all(
      audience(updated).map((id) =>
        notify(id, {
          type: 'event_updated',
          title: rescheduled ? `“${updated.title}” was rescheduled` : `“${updated.title}” was updated`,
          body: rescheduled ? `New start: ${new Date(set.startsAt).toUTCString()}.` : `The organiser ${when}.`,
          link: `/events/${updated._id}`,
          data: { eventId: updated._id.toString() },
          dedupeKey: `event_updated:${updated._id}:v${updated.version}`,
        })
      )
    );
  }
  return { event: updated, changed: true, rescheduled };
}

export async function cancelEvent(event, user, bus) {
  assertHost(event, user);
  if (event.status === 'cancelled') return { event, already: true };
  const updated = await WatchEvent.findOneAndUpdate(
    { _id: event._id, status: 'scheduled' },
    { $set: { status: 'cancelled', cancelledAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' }
  ).populate('host', 'displayName avatarColor');
  if (!updated) return { event, already: true };

  await withdrawUnread({ type: { $in: ['event_reminder', 'event_updated', 'event_invite'] }, 'data.eventId': event._id.toString() });
  await Promise.all(
    audience(updated).map((id) =>
      notify(id, {
        type: 'event_cancelled',
        title: `“${updated.title}” was cancelled`,
        body: 'The organiser cancelled this watch party.',
        link: `/events/${updated._id}`,
        data: { eventId: updated._id.toString() },
        dedupeKey: `event_cancelled:${updated._id}`,
      })
    )
  );
  // An empty room created only for this party has no reason to stay open.
  const room = await Room.findById(event.room).populate('members.user', 'displayName avatarColor');
  if (room && room.status === 'open' && room.members.filter((m) => !m.leftAt).length <= 1 && !room.playback?.isPlaying) {
    await closeRoom(room);
    bus?.roomClosed(room, 'closed');
  }
  return { event: updated, already: false };
}

/** Invite people by email. The response never reveals which addresses have an account. */
export async function inviteByEmail(event, user, emails) {
  assertHost(event, user);
  if (event.status === 'cancelled') throw new HttpError(409, 'EVENT_CANCELLED', 'This watch party was cancelled.');
  if (phaseOf(event) === 'completed') throw new HttpError(409, 'EVENT_ENDED', 'This watch party is over.');
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
  const users = await User.find({ email: { $in: unique } }).select('_id');
  const fresh = await loadEvent(event._id);
  const known = new Set(fresh.invited.map((i) => uid(i.user)));
  for (const u of users) {
    const id = u._id.toString();
    if (id === uid(event.host) || known.has(id)) continue;
    if (fresh.invited.length + 1 > MAX_INVITES) break;
    await WatchEvent.updateOne({ _id: event._id, 'invited.user': { $ne: u._id } }, { $push: { invited: { user: u._id, at: new Date() } } });
    await notify(u._id, {
      type: 'event_invite',
      title: `${user.displayName} invited you to “${event.title}”`,
      body: `Starts ${new Date(event.startsAt).toUTCString()}.`,
      link: `/events/${event._id}`,
      data: { eventId: event._id.toString() },
      dedupeKey: `event_invite:${event._id}:${id}`,
    });
  }
  return { requested: unique.length };
}

export async function rotateInviteLink(event, user) {
  assertHost(event, user);
  const updated = await WatchEvent.findOneAndUpdate({ _id: event._id }, { $set: { inviteToken: newToken() } }, { returnDocument: 'after' });
  return updated;
}

/** Enter the party's room. Honours the invitation rules, the early-entry window, bans, locking and capacity. */
export async function joinEvent(event, user, token) {
  const access = await assertCanView(event, user, token);
  if (event.status === 'cancelled') throw new HttpError(410, 'EVENT_CANCELLED', 'This watch party was cancelled.');
  if (phaseOf(event) === 'completed') throw new HttpError(410, 'EVENT_ENDED', 'This watch party is over.');
  const isHost = uid(event.host) === user._id.toString();
  const opens = new Date(event.startsAt).getTime() - EARLY_JOIN_MINUTES * 60_000;
  if (!isHost && Date.now() < opens) {
    throw new HttpError(409, 'EVENT_NOT_STARTED', `The room opens ${EARLY_JOIN_MINUTES} minutes before the start time.`);
  }
  const room = await loadRoom(event.roomCode);
  const { room: updated, joined } = await joinRoom(room, user);
  if (!isHost && !rsvpOf(event, user._id)) {
    await WatchEvent.updateOne({ _id: event._id, 'rsvps.user': { $ne: user._id } }, { $push: { rsvps: { user: user._id, status: 'going', at: new Date() } } });
  }
  return { room: updated, joined, via: access.via };
}

const WINDOW_MS = 600 * 60_000; // longest possible event, used to bound queries

/** Events a person is part of (organiser, invited, or answered RSVP). */
export async function listMine(user, { phase = 'upcoming', offset = 0, limit = 12 }) {
  const me = user._id;
  const mine = { $or: [{ host: me }, { 'rsvps.user': me }, { 'invited.user': me }] };
  const now = Date.now();
  let docs;
  if (phase === 'upcoming') {
    docs = await WatchEvent.find({ ...mine, status: 'scheduled', startsAt: { $gt: new Date(now - WINDOW_MS) } })
      .sort({ startsAt: 1 }).limit(200).populate('host', 'displayName avatarColor');
    docs = docs.filter((e) => ['upcoming', 'ongoing'].includes(phaseOf(e, now)));
  } else {
    docs = await WatchEvent.find({ ...mine, $or: [{ status: 'cancelled' }, { startsAt: { $lte: new Date(now) } }] })
      .sort({ startsAt: -1 }).limit(200).populate('host', 'displayName avatarColor');
    docs = docs.filter((e) => ['completed', 'cancelled'].includes(phaseOf(e, now)));
  }
  return paginate(docs, offset, limit);
}

export async function listPublic(user, { offset = 0, limit = 12 }) {
  const now = Date.now();
  let docs = await WatchEvent.find({ visibility: 'public', status: 'scheduled', startsAt: { $gt: new Date(now - WINDOW_MS) } })
    .sort({ startsAt: 1 }).limit(200).populate('host', 'displayName avatarColor');
  docs = docs.filter((e) => ['upcoming', 'ongoing'].includes(phaseOf(e, now)));
  return paginate(docs, offset, limit);
}

const paginate = (docs, offset, limit) => ({
  items: docs.slice(offset, offset + limit),
  nextCursor: offset + limit < docs.length ? String(offset + limit) : null,
  total: docs.length,
});
