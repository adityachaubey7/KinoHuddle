import { Server } from 'socket.io';
import { z } from 'zod';
import { config, isAllowedOrigin } from '../config.js';
import { readCookie, userFromToken } from '../middleware/auth.js';
import { Room, isMuted } from '../models/Room.js';
import { QueueItem } from '../models/QueueItem.js';
import { Message, serializeMessage } from '../models/Message.js';
import { normalizeRoomCode } from '../lib/http.js';
import { parseYouTube } from '../lib/youtube.js';
import { createLimiter } from '../lib/rateLimiter.js';
import { HttpError } from '../lib/http.js';
import { log } from '../lib/logger.js';
import { recordProgress } from '../services/history.js';
import * as queue from '../services/queue.js';
import {
  expiryFor,
  isExpired,
  serializeRoom,
  serializePlayback,
  nextHostCandidate,
  setHost,
} from '../lib/roomService.js';
import { presence } from './presence.js';
import { bus, channel, userChannel, setIo, LOBBY } from './bus.js';

export const REACTIONS = ['😂', '😮', '😍', '👏', '🔥', '😢', '😱', '🍿'];
export const MAX_MESSAGE_LENGTH = 500;
const MAX_POSITION = 24 * 3600;

const chatLimiter = createLimiter({ limit: 8, windowMs: 10_000 });
const reactionLimiter = createLimiter({ limit: 12, windowMs: 10_000 });
const controlLimiter = createLimiter({ limit: 20, windowMs: 5_000 });
const queueLimiter = createLimiter({ limit: 20, windowMs: 10_000 });
const progressLimiter = createLimiter({ limit: 4, windowMs: 10_000 });
const hostTimers = new Map(); // code -> timeout

const codeSchema = z.object({ code: z.string().max(20) });
const positionSchema = codeSchema.extend({ position: z.number().finite().min(0).max(MAX_POSITION) });
const rateSchema = codeSchema.extend({ rate: z.number().min(0.25).max(2) });
const loadSchema = codeSchema.extend({ url: z.string().max(500), title: z.string().trim().max(120).optional() });
const itemSchema = codeSchema.extend({ itemId: z.string().max(40) });
const queueAddSchema = codeSchema.extend({ url: z.string().max(500), title: z.string().trim().max(120).optional() });
const queueMoveSchema = itemSchema.extend({ toIndex: z.number().int().min(0).max(100) });
const queueModeSchema = codeSchema.extend({ mode: z.enum(['votes', 'manual']) });
const videoSchema = codeSchema.extend({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) });
const durationSchema = videoSchema.extend({ duration: z.number().finite().min(1).max(MAX_POSITION) });
const progressSchema = videoSchema.extend({ position: z.number().finite().min(0).max(MAX_POSITION), duration: z.number().finite().min(1).max(MAX_POSITION) });
const chatSchema = codeSchema.extend({
  text: z.string().max(MAX_MESSAGE_LENGTH * 2),
  clientId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
});
const reactionSchema = codeSchema.extend({
  emoji: z.enum(REACTIONS),
  clientId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

const fail = (code, message) => ({ ok: false, error: { code, message } });
const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {});

/** Re-validates membership against the database for every privileged event. */
async function memberRoom(socket, rawCode, { requireControl = false } = {}) {
  const code = normalizeRoomCode(rawCode);
  if (!code) return { error: fail('ROOM_NOT_FOUND', 'That room code doesn’t exist.') };
  const room = await Room.findOne({ code }).populate('members.user', 'displayName avatarColor');
  if (!room) return { error: fail('ROOM_NOT_FOUND', 'That room code doesn’t exist.') };
  if (room.status === 'closed') return { error: fail('ROOM_CLOSED', 'The host closed this room.') };
  if (isExpired(room)) return { error: fail('ROOM_EXPIRED', 'This room expired after a period of inactivity.') };
  const userId = socket.data.user._id.toString();
  if (!room.memberFor(userId)) return { error: fail('NOT_A_MEMBER', 'Join this room first.') };
  if (requireControl && !room.canControl(userId))
    return { error: fail('HOST_ONLY', 'Only the host can control playback in this room.') };
  return { room, code, userId, member: room.memberFor(userId) };
}

async function applyPlayback(room, userId, patch) {
  const now = new Date();
  const ttl = expiryFor(room, now.getTime());
  const set = { lastActivityAt: now, expiresAt: ttl, 'playback.updatedAt': now, 'playback.updatedBy': userId };
  for (const [k, v] of Object.entries(patch)) set[`playback.${k}`] = v;
  return Room.findOneAndUpdate({ _id: room._id }, { $set: set, $inc: { 'playback.seq': 1 } }, { returnDocument: 'after' });
}

function cancelHostTimer(code) {
  const t = hostTimers.get(code);
  if (t) {
    clearTimeout(t);
    hostTimers.delete(code);
  }
}

/** If the host stays offline past the grace period, hand the room to someone who is here. */
function scheduleHostHandover(code, hostId) {
  cancelHostTimer(code);
  const timer = setTimeout(async () => {
    hostTimers.delete(code);
    try {
      const room = await Room.findOne({ code }).populate('members.user', 'displayName avatarColor');
      if (!room || room.status !== 'open' || room.host.toString() !== hostId) return;
      if (presence.isOnline(code, hostId)) return;
      const next = nextHostCandidate(room, hostId);
      if (!next || !presence.isOnline(code, (next.user._id || next.user).toString())) return;
      setHost(room, next.user._id);
      await room.save();
      const msg = await Message.create({
        room: room._id,
        kind: 'system',
        text: `${next.user.displayName} is now the host (the previous host disconnected)`,
      });
      bus.roomUpdated(room);
      bus.system(room, msg);
    } catch (err) {
      log.error('socket handler failed', { where: 'host handover', err });
    }
  }, config.hostGraceSeconds * 1000);
  timer.unref?.();
  hostTimers.set(code, timer);
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    // Clients re-run `room:join` on every (re)connect, which restores presence,
    // chat history and the authoritative playback state.
  });
  setIo(io);

  // Authenticate every connection from the httpOnly cookie (or an explicit token).
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || readCookie(socket.handshake.headers.cookie, config.cookieName);
      const user = await userFromToken(token);
      if (!user) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = user;
      socket.data.rooms = new Set();
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const userId = user._id.toString();
    const by = { id: userId, displayName: user.displayName };
    socket.join(userChannel(userId)); // personal channel for notifications, shared by all of this person's tabs

    // Anyone signed in can watch the public directory update live.
    socket.on('lobby:join', (_payload, ack) => {
      socket.join(LOBBY);
      safeAck(ack)({ ok: true });
    });
    socket.on('lobby:leave', (_payload, ack) => {
      socket.leave(LOBBY);
      safeAck(ack)({ ok: true });
    });

    socket.on('time:ping', (_payload, ack) => safeAck(ack)({ serverTime: Date.now() }));

    socket.on('room:join', async (payload, ack) => {
      ack = safeAck(ack);
      const parsed = codeSchema.safeParse(payload);
      if (!parsed.success) return ack(fail('BAD_REQUEST', 'Invalid request.'));
      try {
        const { room, code, error } = await memberRoom(socket, parsed.data.code);
        if (error) return ack(error);

        socket.join(channel(code));
        socket.data.rooms.add(code);
        const cameOnline = presence.add(code, userId, socket.id);
        if (room.isHost(userId)) cancelHostTimer(code);

        await Room.updateOne(
          { _id: room._id, 'members.user': user._id },
          { $set: { 'members.$.lastSeenAt': new Date() } }
        );

        const history = await Message.find({ room: room._id })
          .sort({ createdAt: -1, _id: -1 })
          .limit(50)
          .populate('user', 'displayName avatarColor');

        ack({
          ok: true,
          room: serializeRoom(room, userId),
          messages: history.reverse().map((m) => serializeMessage(m)),
          reactions: REACTIONS,
          queue: await queue.getSnapshot(room),
        });
        if (cameOnline) {
          socket.to(channel(code)).emit('room:update', serializeRoom(room));
          bus.lobbyUpdate(room);
        }
      } catch (err) {
        log.error('socket handler failed', { where: 'room:join', err });
        ack(fail('SERVER_ERROR', 'Couldn’t connect to the room. Try again.'));
      }
    });

    socket.on('room:leave', async (payload) => {
      const code = normalizeRoomCode(payload?.code);
      if (!code || !socket.data.rooms.has(code)) return;
      await disconnectFromRoom(code);
    });

    // ---------- Playback (host / permitted members only) ----------
    const control = (event, schema, buildPatch) => {
      socket.on(event, async (payload, ack) => {
        ack = safeAck(ack);
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return ack(fail('BAD_REQUEST', 'Invalid playback update.'));
        if (!controlLimiter.take(userId)) return ack(fail('RATE_LIMITED', 'Slow down a little.'));
        try {
          const { room, code, error } = await memberRoom(socket, parsed.data.code, { requireControl: true });
          if (error) return ack(error);
          const patch = buildPatch(parsed.data, room);
          if (patch.error) return ack(patch.error);
          const updated = await applyPlayback(room, user._id, patch.set);
          await patch.afterApply?.(room);
          const state = { ...serializePlayback(updated), action: patch.action, by };
          io.to(channel(code)).emit('player:state', state);
          if (patch.afterApply) await broadcastQueue(room, code);
          if (patch.systemText) {
            const msg = await Message.create({ room: room._id, kind: 'system', text: patch.systemText });
            io.to(channel(code)).emit('chat:message', serializeMessage(msg));
          }
          ack({ ok: true, state });
        } catch (err) {
          log.error('socket handler failed', { event, err });
          ack(fail('SERVER_ERROR', 'Playback update failed.'));
        }
      });
    };

    control('player:play', positionSchema, ({ position }) => ({
      action: 'play',
      set: { isPlaying: true, position },
    }));
    control('player:pause', positionSchema, ({ position }) => ({
      action: 'pause',
      set: { isPlaying: false, position },
    }));
    control('player:seek', positionSchema, ({ position }, room) => ({
      action: 'seek',
      set: { position, isPlaying: room.playback.isPlaying },
    }));
    control('player:rate', rateSchema, ({ rate }, room) => ({
      action: 'rate',
      set: { rate, position: room.currentPosition() },
    }));
    control('player:load', loadSchema, ({ url, title }) => {
      const parsed = parseYouTube(url);
      if (!parsed) {
        return { error: fail('INVALID_VIDEO_URL', 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…') };
      }
      return {
        action: 'load',
        set: { videoId: parsed.videoId, videoTitle: title || '', position: parsed.startSeconds, isPlaying: false, rate: 1, duration: 0, queueItemId: null },
        afterApply: async (room) => {
          // The same video waiting in the queue would otherwise play twice in a row.
          const dropped = await QueueItem.findOneAndDelete({ room: room._id, videoId: parsed.videoId });
          if (dropped) await Room.updateOne({ _id: room._id }, { $inc: { queueVersion: 1 } });
        },
        systemText: `${user.displayName} changed the video${title ? ` to “${title}”` : ''}`,
      };
    });

    // Members ask for the authoritative state for drift correction.
    socket.on('player:sync', async (payload, ack) => {
      ack = safeAck(ack);
      const parsed = codeSchema.safeParse(payload);
      if (!parsed.success) return ack(fail('BAD_REQUEST', 'Invalid request.'));
      const { room, error } = await memberRoom(socket, parsed.data.code);
      if (error) return ack(error);
      ack({ ok: true, state: serializePlayback(room) });
    });


    // ---------- Shared watch queue ----------
    const broadcastQueue = async (room, code) => {
      bus.queueUpdated(code, await queue.getSnapshot(room));
    };

    /** Announce a video change that came from the queue to everyone in the room. */
    const announceAdvance = async (result, code, text) => {
      const state = { ...serializePlayback(result.room), action: 'load', by: null, fromQueue: true };
      io.to(channel(code)).emit('player:state', state);
      const msg = await Message.create({ room: result.room._id, kind: 'system', text });
      io.to(channel(code)).emit('chat:message', serializeMessage(msg));
      await broadcastQueue(result.room, code);
      return state;
    };

    const queueEvent = (event, schema, handler, { limited = true } = {}) => {
      socket.on(event, async (payload, ack) => {
        ack = safeAck(ack);
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return ack(fail('BAD_REQUEST', 'Invalid request.'));
        if (limited && !queueLimiter.take(userId)) return ack(fail('RATE_LIMITED', 'Slow down a little.'));
        try {
          const ctx = await memberRoom(socket, parsed.data.code);
          if (ctx.error) return ack(ctx.error);
          const out = await handler({ ...ctx, data: parsed.data });
          ack({ ok: true, ...out });
        } catch (err) {
          if (err instanceof HttpError) return ack(fail(err.code, err.message));
          log.error('socket handler failed', { event, err });
          ack(fail('SERVER_ERROR', 'That didn’t work. Try again.'));
        }
      });
    };

    queueEvent('queue:get', codeSchema, async ({ room }) => ({ queue: await queue.getSnapshot(room) }), { limited: false });

    queueEvent('queue:add', queueAddSchema, async ({ room, code, data }) => {
      const { item, duplicate } = await queue.addItem(room, user, data);
      const idle = !room.playback.videoId;
      if (idle) {
        // Nothing is playing and nothing was waiting: start this one (paused, so nobody is surprised by sound).
        const result = await queue.advanceQueue(room._id, { isPlaying: false, actorId: user._id });
        if (result.advanced) {
          await announceAdvance(result, code, `${user.displayName} started the queue with “${result.item.title || 'a video'}”`);
          return { duplicate, started: true };
        }
      }
      await broadcastQueue(room, code);
      return { duplicate, itemId: item._id.toString() };
    });

    queueEvent('queue:vote', itemSchema.extend({ on: z.boolean().default(true) }), async ({ room, code, data }) => {
      const out = await queue.setVote(room, user, data.itemId, data.on);
      if (out.changed) await broadcastQueue(room, code);
      return out;
    });

    queueEvent('queue:remove', itemSchema, async ({ room, code, data }) => {
      const out = await queue.removeItem(room, user, data.itemId);
      if (out.removed) await broadcastQueue(room, code);
      return out;
    });

    queueEvent('queue:move', queueMoveSchema, async ({ room, code, data }) => {
      const out = await queue.moveItem(room, user, data.itemId, data.toIndex);
      await broadcastQueue(room, code);
      return out;
    });

    queueEvent('queue:mode', queueModeSchema, async ({ room, code, data }) => {
      const out = await queue.setQueueMode(room, user, data.mode);
      const fresh = await Room.findById(room._id).populate('members.user', 'displayName avatarColor');
      io.to(channel(code)).emit('room:update', serializeRoom(fresh));
      await broadcastQueue(fresh, code);
      return out;
    });

    // Skip to the next video, or play a chosen entry right now (people who control playback only).
    queueEvent('queue:next', codeSchema.extend({ itemId: z.string().max(40).optional() }), async ({ room, code, data }) => {
      if (!room.canControl(userId)) throw new HttpError(403, 'HOST_ONLY', 'Only the host can control playback in this room.');
      const result = await queue.advanceQueue(room._id, { itemId: data.itemId || null, actorId: user._id });
      if (!result.advanced) {
        if (result.reason === 'EMPTY') throw new HttpError(404, 'QUEUE_EMPTY', 'The queue is empty.');
        if (result.reason === 'ITEM_NOT_FOUND') throw new HttpError(404, 'QUEUE_ITEM_NOT_FOUND', 'That video is no longer in the queue.');
        throw new HttpError(409, 'CONFLICT', 'The room changed at the same moment. Try again.');
      }
      const state = await announceAdvance(result, code, `${user.displayName} started “${result.item.title || 'the next video'}”`);
      return { state };
    });

    // Anyone's player reports that the video finished. Only the first valid report does anything.
    queueEvent('player:ended', videoSchema, async ({ room, code, data }) => {
      if (room.playback.videoId !== data.videoId) return { advanced: false, reason: 'STALE' };
      if (!queue.endReportAllowed(room, userId)) return { advanced: false, reason: 'NOT_FINISHED' };
      const result = await queue.advanceQueue(room._id, { expectVideoId: data.videoId });
      if (result.advanced) {
        await announceAdvance(result, code, `Up next: “${result.item.title || 'a video'}”`);
        return { advanced: true };
      }
      if (result.reason === 'EMPTY') {
        const fin = await queue.finishWithoutQueue(room, data.videoId);
        if (fin.finished) {
          io.to(channel(code)).emit('player:state', { ...serializePlayback(fin.room), action: 'pause', by: null });
          return { advanced: false, reason: 'EMPTY', finished: true };
        }
      }
      return { advanced: false, reason: result.reason };
    }, { limited: false });

    // The current video can't be played on this device (removed, private or embedding disabled).
    queueEvent('queue:unavailable', videoSchema, async ({ room, code, data }) => {
      if (room.playback.videoId !== data.videoId) return { advanced: false, reason: 'STALE' };
      if (!queue.unavailableVerdict(room, userId, presence.onlineIds(code))) return { advanced: false, reason: 'WAITING_FOR_OTHERS' };
      const result = await queue.advanceQueue(room._id, { expectVideoId: data.videoId });
      if (!result.advanced) return { advanced: false, reason: result.reason };
      await announceAdvance(result, code, `Skipped a video that can’t be played. Up next: “${result.item.title || 'a video'}”`);
      return { advanced: true };
    });

    // Whoever controls playback tells the server how long the video is (needed to trust "ended" reports).
    queueEvent('player:duration', durationSchema, async ({ room, data }) => {
      if (!room.canControl(userId) || room.playback.videoId !== data.videoId) return { stored: false };
      return { stored: await queue.setDuration(room, data.videoId, data.duration) };
    }, { limited: false });

    // Personal watch progress (never affects the room).
    queueEvent('history:progress', progressSchema, async ({ room, data }) => {
      if (!progressLimiter.take(userId)) return { saved: false, reason: 'RATE_LIMITED' };
      return recordProgress(room, user, data);
    }, { limited: false });

    // ---------- Chat ----------
    socket.on('chat:send', async (payload, ack) => {
      ack = safeAck(ack);
      const parsed = chatSchema.safeParse(payload);
      if (!parsed.success) return ack(fail('BAD_REQUEST', 'Message couldn’t be sent.'));
      const text = parsed.data.text.replace(/\s+$/g, '').replace(/^\s+/g, '');
      if (!text) return ack(fail('EMPTY', 'Type a message first.'));
      if (text.length > MAX_MESSAGE_LENGTH)
        return ack(fail('TOO_LONG', `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`));
      try {
        const { room, code, error, member } = await memberRoom(socket, parsed.data.code);
        if (error) return ack(error);
        if (isMuted(member)) return ack(fail('MUTED', 'A moderator muted you in this room.'));

        // A retried send (after a reconnect) returns the stored message instead of duplicating it.
        const existing = await Message.findOne({ room: room._id, clientId: parsed.data.clientId }).populate(
          'user',
          'displayName avatarColor'
        );
        if (existing) return ack({ ok: true, message: serializeMessage(existing), duplicate: true });

        if (!chatLimiter.take(userId))
          return ack(fail('RATE_LIMITED', 'You’re sending messages too quickly. Wait a few seconds.'));

        if (room.slowModeSeconds > 0 && !room.canModerate(userId)) {
          const last = await Message.findOne({ room: room._id, user: user._id, kind: 'text' }).sort({ createdAt: -1 });
          const wait = last ? room.slowModeSeconds - (Date.now() - last.createdAt.getTime()) / 1000 : 0;
          if (wait > 0) {
            const retryAfter = Math.ceil(wait);
            return ack({ ...fail('SLOW_MODE', `Slow mode is on. Wait ${retryAfter}s before sending another message.`), retryAfter });
          }
        }

        let doc;
        try {
          doc = await Message.create({
            room: room._id,
            user: user._id,
            kind: 'text',
            text,
            clientId: parsed.data.clientId,
            videoTime: room.playback.videoId ? room.currentPosition() : null,
          });
        } catch (err) {
          if (err?.code === 11000) {
            const dup = await Message.findOne({ room: room._id, clientId: parsed.data.clientId }).populate('user', 'displayName avatarColor');
            return ack({ ok: true, message: serializeMessage(dup), duplicate: true });
          }
          throw err;
        }
        Room.updateOne(
          { _id: room._id },
          { $set: { lastActivityAt: new Date(), expiresAt: expiryFor(room) } }
        ).catch(() => {});
        const message = serializeMessage(doc, user);
        io.to(channel(code)).emit('chat:message', message);
        ack({ ok: true, message });
      } catch (err) {
        log.error('socket handler failed', { where: 'chat:send', err });
        ack(fail('SERVER_ERROR', 'Message couldn’t be sent. Try again.'));
      }
    });

    socket.on('chat:typing', async (payload) => {
      const code = normalizeRoomCode(payload?.code);
      if (!code || !socket.data.rooms.has(code)) return;
      socket.to(channel(code)).emit('chat:typing', { user: by, typing: Boolean(payload.typing) });
    });

    // ---------- Reactions ----------
    socket.on('reaction:send', async (payload, ack) => {
      ack = safeAck(ack);
      const parsed = reactionSchema.safeParse(payload);
      if (!parsed.success) return ack(fail('BAD_REQUEST', 'That reaction isn’t available.'));
      if (!reactionLimiter.take(userId)) return ack(fail('RATE_LIMITED', 'Easy there — too many reactions at once.'));
      try {
        const { room, code, error, member } = await memberRoom(socket, parsed.data.code);
        if (error) return ack(error);
        if (isMuted(member)) return ack(fail('MUTED', 'A moderator muted you in this room.'));
        let doc;
        try {
          doc = await Message.create({
            room: room._id,
            user: user._id,
            kind: 'reaction',
            emoji: parsed.data.emoji,
            clientId: parsed.data.clientId,
            videoTime: room.playback.videoId ? room.currentPosition() : null,
          });
        } catch (err) {
          if (err?.code === 11000) return ack({ ok: true, duplicate: true });
          throw err;
        }
        const reaction = serializeMessage(doc, user);
        io.to(channel(code)).emit('reaction', reaction);
        ack({ ok: true, reaction });
      } catch (err) {
        log.error('socket handler failed', { where: 'reaction:send', err });
        ack(fail('SERVER_ERROR', 'Reaction failed.'));
      }
    });

    async function disconnectFromRoom(code) {
      socket.leave(channel(code));
      socket.data.rooms.delete(code);
      const wentOffline = presence.remove(code, userId, socket.id);
      if (!wentOffline) return;
      try {
        const room = await Room.findOne({ code }).populate('members.user', 'displayName avatarColor');
        if (!room) return;
        await Room.updateOne(
          { _id: room._id, 'members.user': user._id },
          { $set: { 'members.$.lastSeenAt': new Date() } }
        );
        if (room.status === 'open') {
          io.to(channel(code)).emit('room:update', serializeRoom(room));
          bus.lobbyUpdate(room);
          if (room.isHost(userId)) scheduleHostHandover(code, userId);
        }
      } catch (err) {
        log.error('socket handler failed', { where: 'disconnect', err });
      }
    }

    socket.on('disconnect', async () => {
      for (const code of [...socket.data.rooms]) await disconnectFromRoom(code);
    });
  });

  return io;
}

/** Mark rooms that passed their expiry as expired and notify anyone still connected. */
export async function expireRooms() {
  const now = new Date();
  const due = await Room.find({ status: 'open', isOfficial: { $ne: true }, expiresAt: { $lt: now } }).limit(200);
  for (const room of due) {
    // Someone is actively connected: extend instead of expiring.
    if (presence.onlineIds(room.code).size > 0) {
      room.expiresAt = expiryFor(room, now.getTime());
      await room.save();
      continue;
    }
    room.status = 'expired';
    room.playback.isPlaying = false;
    await room.save();
    bus.roomClosed(room, 'expired');
  }
  return due.length;
}
