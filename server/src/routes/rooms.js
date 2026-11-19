import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Room, TOPICS, isBanned } from '../models/Room.js';
import { Message, serializeMessage } from '../models/Message.js';
import { asyncHandler, validate, HttpError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { parseYouTube } from '../lib/youtube.js';
import {
  loadRoom,
  assertOpen,
  assertMember,
  assertHost,
  serializeRoom,
  serializePreview,
  createRoom,
  joinRoom,
  leaveRoom,
  closeRoom,
  setHost,
  touch,
  isExpired,
} from '../lib/roomService.js';
import { banMember, logAction } from '../services/moderation.js';
import { getSnapshot } from '../services/queue.js';
import { bus } from '../sockets/bus.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 30,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'You’ve created a lot of rooms recently. Try again later.' } },
});

const createSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(60, 'Use 60 characters or fewer.'),
  maxMembers: z.coerce.number().int().min(2, 'At least 2 people.').max(50, 'At most 50 people.').default(10),
  guestControl: z.boolean().default(false),
  videoUrl: z.string().trim().max(500).optional().or(z.literal('')),
  videoTitle: z.string().trim().max(120).optional(),
  visibility: z.enum(['private', 'public']).default('private'),
  topic: z.enum(TOPICS).default('general'),
  language: z.string().regex(/^([a-z]{2,3}(-[A-Za-z0-9]{2,8})?|multi)$/, 'Choose a language.').default('multi'),
  country: z
    .string()
    .length(2)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

/** Latest system message for a room, to broadcast after REST-side changes. */
const lastSystem = (room) => Message.findOne({ room: room._id, kind: 'system' }).sort({ createdAt: -1 });

router.post(
  '/',
  createLimiter,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, maxMembers, guestControl, videoUrl, videoTitle, visibility, topic, language, country } = req.body;
    let video = null;
    if (videoUrl) {
      const parsed = parseYouTube(videoUrl);
      if (!parsed) {
        throw new HttpError(400, 'INVALID_VIDEO_URL', 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…', {
          videoUrl: 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…',
        });
      }
      video = { ...parsed, title: videoTitle || '' };
    }
    const room = await createRoom(req.user, { name, maxMembers, guestControl, video, visibility, topic, language, country });
    res.status(201).json({ room: serializeRoom(room, req.user._id) });
  })
);

// Recent rooms for the dashboard (including ones that have since closed or expired).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rooms = await Room.find({ 'members.user': req.user._id })
      .sort({ lastActivityAt: -1 })
      .limit(24)
      .populate('members.user', 'displayName avatarColor');
    const me = req.user._id.toString();
    const items = rooms
      .filter((r) => {
        const m = r.members.find((x) => (x.user?._id || x.user).toString() === me);
        return m && !isBanned(m);
      })
      .map((r) => {
        const s = serializeRoom(r, me);
        const membership = r.members.find((x) => (x.user?._id || x.user).toString() === me);
        return {
          code: s.code,
          name: s.name,
          status: s.status,
          isHost: s.isHost,
          left: Boolean(membership?.leftAt),
          memberCount: s.members.length,
          onlineCount: s.members.filter((m) => m.online).length,
          members: s.members.slice(0, 5).map(({ id, displayName, avatarColor }) => ({ id, displayName, avatarColor })),
          nowPlaying: s.playback.videoId ? { videoId: s.playback.videoId, title: s.playback.videoTitle } : null,
          lastActivityAt: s.lastActivityAt,
          expiresAt: s.expiresAt,
        };
      });
    res.json({ rooms: items });
  })
);

router.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    const me = req.user._id;
    if (room.memberFor(me)) return res.json({ access: 'member', room: serializeRoom(room, me) });
    const prior = room.members.find((m) => (m.user?._id || m.user).toString() === me.toString());
    res.json({ access: isBanned(prior) ? 'removed' : 'preview', room: serializePreview(room) });
  })
);

router.post(
  '/:code/join',
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    const { room: updated, joined } = await joinRoom(room, req.user);
    if (joined) {
      bus.roomUpdated(updated);
      bus.system(updated, await lastSystem(updated));
    }
    res.json({ room: serializeRoom(updated, req.user._id), joined });
  })
);

router.post(
  '/:code/leave',
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    if (!room.memberFor(req.user._id)) return res.json({ ok: true });
    const { closed } = await leaveRoom(room, req.user);
    bus.userRemoved(room, req.user._id.toString(), { notify: false }); // disconnect this user's sockets from the room
    if (closed) bus.roomClosed(room, 'empty');
    else {
      const fresh = await loadRoom(room.code);
      bus.roomUpdated(fresh);
      const recent = await Message.find({ room: room._id, kind: 'system' }).sort({ createdAt: -1 }).limit(2);
      for (const m of recent.reverse()) bus.system(fresh, m);
    }
    res.json({ ok: true, closed });
  })
);

router.post(
  '/:code/close',
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertHost(room, req.user._id);
    if (room.status !== 'open' || isExpired(room)) return res.json({ ok: true });
    await closeRoom(room);
    bus.system(room, await lastSystem(room));
    bus.roomClosed(room, 'closed');
    res.json({ ok: true });
  })
);

const settingsSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters.').max(60, 'Use 60 characters or fewer.').optional(),
    guestControl: z.boolean().optional(),
    locked: z.boolean().optional(),
    maxMembers: z.coerce.number().int().min(2).max(50).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    topic: z.enum(TOPICS).optional(),
    slowModeSeconds: z.coerce.number().int().min(0, 'Use 0 to switch it off.').max(300, 'Up to 5 minutes.').optional(),
  })
  .strict();

router.patch(
  '/:code',
  validate(settingsSchema),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertOpen(room);
    assertHost(room, req.user._id);
    if (req.body.maxMembers !== undefined && req.body.maxMembers < room.activeMembers().length) {
      throw new HttpError(400, 'BELOW_MEMBER_COUNT', `There are already ${room.activeMembers().length} people in this room.`, {
        maxMembers: 'Can’t be lower than the current number of members.',
      });
    }
    const slowChanged = req.body.slowModeSeconds !== undefined && req.body.slowModeSeconds !== room.slowModeSeconds;
    Object.assign(room, req.body);
    touch(room);
    await room.save();
    if (slowChanged) await logAction(room, req.user._id, 'slow_mode', null, { seconds: req.body.slowModeSeconds });
    bus.roomUpdated(room);
    res.json({ room: serializeRoom(room, req.user._id) });
  })
);

const targetSchema = z.object({
  userId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid member.'),
});

router.post(
  '/:code/transfer',
  validate(targetSchema),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertOpen(room);
    assertHost(room, req.user._id);
    const target = room.memberFor(req.body.userId);
    if (!target) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'That person isn’t in this room.');
    setHost(room, req.body.userId);
    touch(room);
    await room.save();
    const msg = await Message.create({ room: room._id, kind: 'system', text: `${target.user.displayName} is now the host` });
    bus.roomUpdated(room);
    bus.system(room, msg);
    res.json({ room: serializeRoom(room, req.user._id) });
  })
);

router.post(
  '/:code/remove',
  validate(targetSchema),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertOpen(room);
    if (req.body.userId === req.user._id.toString()) throw new HttpError(400, 'CANNOT_REMOVE_SELF', 'Use “Leave room” instead.');
    if (!room.canModerate(req.user._id)) throw new HttpError(403, 'HOST_ONLY', 'Only the host can do that.');
    const target = room.memberFor(req.body.userId);
    if (!target) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'That person isn’t in this room.');
    const name = target.user.displayName;
    await banMember(room, req.user, req.body.userId, null, { action: 'remove' });
    const msg = await Message.create({ room: room._id, kind: 'system', text: `${name} was removed by the host` });
    bus.userRemoved(room, req.body.userId);
    const fresh = await loadRoom(room.code);
    bus.roomUpdated(fresh);
    bus.system(fresh, msg);
    res.json({ room: serializeRoom(fresh, req.user._id) });
  })
);

const historySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  '/:code/messages',
  validate(historySchema, 'query'),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertMember(room, req.user._id);
    const { before, limit } = req.validQuery;
    const filter = { room: room._id };
    if (before) filter.createdAt = { $lt: new Date(before) };
    const docs = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate('user', 'displayName avatarColor');
    res.json({ messages: docs.reverse().map((d) => serializeMessage(d)), hasMore: docs.length === limit });
  })
);

router.get(
  '/:code/queue',
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertMember(room, req.user._id);
    res.json({ queue: await getSnapshot(room) });
  })
);

export default router;
