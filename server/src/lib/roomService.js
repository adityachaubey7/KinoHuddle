import { Room, isBanned, isMuted } from '../models/Room.js';
import { Message } from '../models/Message.js';
import { config } from '../config.js';
import { HttpError, generateRoomCode, normalizeRoomCode } from './http.js';
import { presence } from '../sockets/presence.js';

const TTL_MS = () => config.roomTtlHours * 3600 * 1000;

/** When a room should expire after activity at `now`. A scheduled watch party keeps its room alive until the party is over. */
export function expiryFor(room, now = Date.now()) {
  const fromActivity = now + TTL_MS();
  const fromSchedule = room?.scheduledStartAt ? new Date(room.scheduledStartAt).getTime() + TTL_MS() : 0;
  return new Date(Math.max(fromActivity, fromSchedule));
}

export function isExpired(room, now = Date.now()) {
  if (room.isOfficial) return false; // official lobbies never expire
  return room.status === 'expired' || (room.status === 'open' && new Date(room.expiresAt).getTime() < now);
}

export async function uniqueRoomCode() {
  for (let i = 0; i < 6; i++) {
    const code = generateRoomCode();
    if (!(await Room.exists({ code }))) return code;
  }
  throw new HttpError(500, 'CODE_GENERATION_FAILED', 'Could not create a room code. Try again.');
}

/** Load a room by code (normalized) with members populated. Throws 404 on bad/missing code. */
export async function loadRoom(rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (!code) throw new HttpError(404, 'ROOM_NOT_FOUND', 'That room code doesn’t exist. Check it and try again.');
  const room = await Room.findOne({ code }).populate('members.user', 'displayName avatarColor');
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'That room code doesn’t exist. Check it and try again.');
  if (room.status === 'open' && isExpired(room)) {
    room.status = 'expired';
    await room.save();
  }
  return room;
}

export function assertOpen(room) {
  if (room.status === 'closed') throw new HttpError(410, 'ROOM_CLOSED', 'The host closed this room.');
  if (room.status === 'expired' || isExpired(room))
    throw new HttpError(410, 'ROOM_EXPIRED', 'This room expired after a period of inactivity.');
}

export function assertMember(room, userId) {
  const m = room.memberFor(userId);
  if (!m) throw new HttpError(403, 'NOT_A_MEMBER', 'Join this room to see what’s playing.');
  return m;
}

export function assertHost(room, userId) {
  if (!room.isHost(userId)) throw new HttpError(403, 'HOST_ONLY', 'Only the host can do that.');
}

const uid = (m) => (m.user?._id || m.user).toString();

export function serializePlayback(room, now = Date.now()) {
  const p = room.playback || {};
  return {
    videoId: p.videoId || null,
    videoTitle: p.videoTitle || '',
    isPlaying: Boolean(p.isPlaying),
    position: room.currentPosition(now),
    rate: p.rate || 1,
    serverTime: now,
    seq: p.seq || 0,
    updatedBy: p.updatedBy ? p.updatedBy.toString() : null,
  };
}

/** Full room view for members. */
export function serializeRoom(room, viewerId) {
  const online = presence.onlineIds(room.code);
  const members = room
    .activeMembers()
    .map((m) => ({
      id: uid(m),
      displayName: m.user?.displayName ?? 'Member',
      avatarColor: m.user?.avatarColor ?? '#888',
      role: room.isHost(uid(m)) ? 'host' : m.role === 'moderator' ? 'moderator' : 'member',
      muted: isMuted(m),
      mutedUntil: isMuted(m) ? m.mutedUntil : null,
      online: online.has(uid(m)),
      joinedAt: m.joinedAt,
      lastSeenAt: m.lastSeenAt,
    }))
    .sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : new Date(a.joinedAt) - new Date(b.joinedAt)));

  return {
    code: room.code,
    name: room.name,
    status: isExpired(room) && room.status === 'open' ? 'expired' : room.status,
    hostId: room.host.toString(),
    isHost: viewerId ? room.isHost(viewerId) : false,
    canControl: viewerId ? room.canControl(viewerId) : false,
    canModerate: viewerId ? room.canModerate(viewerId) : false,
    guestControl: room.guestControl,
    locked: room.locked,
    slowModeSeconds: room.slowModeSeconds || 0,
    queueMode: room.queueMode || 'votes',
    maxMembers: room.maxMembers,
    visibility: room.visibility,
    topic: room.topic,
    language: room.language,
    country: room.country || null,
    isOfficial: Boolean(room.isOfficial),
    members,
    playback: serializePlayback(room),
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    lastActivityAt: room.lastActivityAt,
  };
}

/** Limited view for someone deciding whether to join. */
export function serializePreview(room) {
  const host = room.members.find((m) => uid(m) === room.host.toString());
  const count = room.activeMembers().length;
  return {
    code: room.code,
    name: room.name,
    status: isExpired(room) && room.status === 'open' ? 'expired' : room.status,
    hostName: host?.user?.displayName ?? 'Host',
    memberCount: count,
    maxMembers: room.maxMembers,
    full: count >= room.maxMembers,
    locked: room.locked,
    nowPlaying: room.playback?.videoTitle || null,
    visibility: room.visibility,
  };
}

/** Card shown in the public directory. Contains no member identities. */
export function serializePublicCard(room) {
  const online = presence.onlineIds(room.code);
  const memberCount = room.activeMembers().length;
  const p = room.playback || {};
  return {
    code: room.code,
    name: room.name,
    topic: room.topic,
    language: room.language,
    country: room.country || null,
    isOfficial: Boolean(room.isOfficial),
    memberCount,
    onlineCount: online.size,
    maxMembers: room.maxMembers,
    full: memberCount >= room.maxMembers,
    locked: room.locked,
    isPlaying: Boolean(p.isPlaying),
    nowPlaying: p.videoId ? { videoId: p.videoId, title: p.videoTitle || '' } : null,
    lastActivityAt: room.lastActivityAt,
  };
}

export function touch(room) {
  const now = new Date();
  room.lastActivityAt = now;
  room.expiresAt = expiryFor(room, now.getTime());
}

export async function createRoom(user, { name, maxMembers, guestControl, video, visibility = 'private', topic = 'general', language = 'multi', country = null, scheduledStartAt = null }) {
  const now = new Date();
  const room = await Room.create({
    code: await uniqueRoomCode(),
    name,
    host: user._id,
    maxMembers,
    guestControl,
    ...(visibility === 'public' ? { visibility, topic, language, country } : {}),
    members: [{ user: user._id, role: 'host', joinedAt: now, lastSeenAt: now }],
    playback: video
      ? { videoId: video.videoId, videoTitle: video.title || '', isPlaying: false, position: video.startSeconds || 0, updatedAt: now, updatedBy: user._id }
      : {},
    ...(scheduledStartAt ? { scheduledStartAt } : {}),
    lastActivityAt: now,
    expiresAt: expiryFor({ scheduledStartAt }, now.getTime()),
  });
  await Message.create({ room: room._id, kind: 'system', text: `${user.displayName} created the room` });
  return loadRoom(room.code);
}

/** Join (or rejoin). Enforces closed/expired/removed/locked/full rules server-side. */
export async function joinRoom(room, user) {
  assertOpen(room);
  const userId = user._id.toString();
  if (room.memberFor(userId)) return { room, joined: false };

  const prior = room.members.find((m) => uid(m) === userId);
  if (isBanned(prior)) {
    throw new HttpError(
      403,
      'REMOVED',
      prior.bannedUntil ? 'You’re temporarily banned from this room.' : 'The host removed you from this room.'
    );
  }
  if (room.locked) throw new HttpError(403, 'ROOM_LOCKED', 'The host locked this room to new members.');
  if (room.activeMembers().length >= room.maxMembers)
    throw new HttpError(409, 'ROOM_FULL', `This room is full (${room.maxMembers} people).`);

  const now = new Date();
  if (prior) {
    // An expired temporary ban no longer applies.
    prior.removed = false;
    prior.bannedUntil = null;
    prior.bannedBy = null;
    prior.role = 'member';
    prior.leftAt = null;
    prior.joinedAt = now;
    prior.lastSeenAt = now;
  } else {
    room.members.push({ user: user._id, role: 'member', joinedAt: now, lastSeenAt: now });
  }
  touch(room);
  await room.save();
  await Message.create({ room: room._id, kind: 'system', text: `${user.displayName} joined` });
  return { room: await loadRoom(room.code), joined: true };
}

/** Pick the next host: earliest-joined online member, else earliest-joined member. */
export function nextHostCandidate(room, excludeId) {
  const online = presence.onlineIds(room.code);
  const others = room
    .activeMembers()
    .filter((m) => uid(m) !== excludeId)
    .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
  return others.find((m) => online.has(uid(m))) || others[0] || null;
}

export function setHost(room, newHostId) {
  room.host = newHostId;
  for (const m of room.members) m.role = uid(m) === newHostId.toString() ? 'host' : m.role === 'moderator' && !m.leftAt ? 'moderator' : 'member';
}

/** Member leaves on purpose. Host leaving hands the room over; last person leaving closes it. */
export async function leaveRoom(room, user) {
  const userId = user._id.toString();
  const member = room.memberFor(userId);
  if (!member) return { room, closed: false, newHostId: null };

  member.leftAt = new Date();
  if (member.role === 'moderator') member.role = 'member';
  let newHostId = null;
  let closed = false;
  if (room.isHost(userId)) {
    const next = nextHostCandidate(room, userId);
    if (next) {
      newHostId = uid(next);
      setHost(room, newHostId);
    } else {
      room.status = 'closed';
      room.closedAt = new Date();
      closed = true;
    }
  }
  touch(room);
  await room.save();
  await Message.create({ room: room._id, kind: 'system', text: `${user.displayName} left` });
  if (newHostId) {
    const next = room.members.find((m) => uid(m) === newHostId);
    await Message.create({ room: room._id, kind: 'system', text: `${next?.user?.displayName || 'A member'} is now the host` });
  }
  return { room, closed, newHostId };
}

export async function closeRoom(room) {
  room.status = 'closed';
  room.closedAt = new Date();
  room.playback.position = room.currentPosition();
  room.playback.isPlaying = false;
  room.playback.updatedAt = new Date();
  await room.save();
  await Message.create({ room: room._id, kind: 'system', text: 'The host closed the room' });
  return room;
}
