import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler, validate } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { Message } from '../models/Message.js';
import { REPORT_REASONS } from '../models/Report.js';
import { loadRoom, assertOpen, serializeRoom } from '../lib/roomService.js';
import {
  muteMember, unmuteMember, banMember, unbanMember, setModerator,
  createReport, listReports, resolveReport, moderationOverview, listLog,
} from '../services/moderation.js';
import { bus } from '../sockets/bus.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const keyByUser = (req) => req.user._id.toString();
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? Number(process.env.TEST_REPORT_LIMIT || 1000) : 8,
  keyGenerator: keyByUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'You’ve sent several reports recently. Try again later.' } },
});
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 40,
  keyGenerator: keyByUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many moderation actions at once. Slow down.' } },
});

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id.');
const targetSchema = z.object({
  userId: objectId,
  minutes: z.coerce.number().int().min(1).max(60 * 24 * 30).nullable().optional().transform((v) => v ?? null),
});

const announce = async (room, text) => {
  const msg = await Message.create({ room: room._id, kind: 'system', text });
  bus.system(room, msg);
};
const respond = async (req, res, room) => {
  const fresh = await loadRoom(room.code);
  bus.roomUpdated(fresh);
  res.json({ room: serializeRoom(fresh, req.user._id) });
};
const nameIn = (room, id) => room.members.find((m) => (m.user?._id || m.user).toString() === id)?.user?.displayName || 'A member';

router.post('/:code/mute', actionLimiter, validate(targetSchema), asyncHandler(async (req, res) => {
  const room = await loadRoom(req.params.code);
  assertOpen(room);
  await muteMember(room, req.user, req.body.userId, req.body.minutes);
  await announce(room, `${nameIn(room, req.body.userId)} was muted by a moderator`);
  await respond(req, res, room);
}));

router.post('/:code/unmute', actionLimiter, validate(targetSchema.pick({ userId: true })), asyncHandler(async (req, res) => {
  const room = await loadRoom(req.params.code);
  assertOpen(room);
  await unmuteMember(room, req.user, req.body.userId);
  await respond(req, res, room);
}));

router.post('/:code/ban', actionLimiter, validate(targetSchema), asyncHandler(async (req, res) => {
  const room = await loadRoom(req.params.code);
  assertOpen(room);
  await banMember(room, req.user, req.body.userId, req.body.minutes);
  await announce(room, `${nameIn(room, req.body.userId)} was removed by a moderator`);
  bus.userRemoved(room, req.body.userId);
  await respond(req, res, room);
}));

router.post('/:code/unban', actionLimiter, validate(targetSchema.pick({ userId: true })), asyncHandler(async (req, res) => {
  const room = await loadRoom(req.params.code);
  assertOpen(room);
  await unbanMember(room, req.user, req.body.userId);
  await respond(req, res, room);
}));

router.post(
  '/:code/moderators',
  actionLimiter,
  validate(z.object({ userId: objectId, moderator: z.boolean() })),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertOpen(room);
    await setModerator(room, req.user, req.body.userId, req.body.moderator);
    await announce(room, `${nameIn(room, req.body.userId)} ${req.body.moderator ? 'is now a moderator' : 'is no longer a moderator'}`);
    await respond(req, res, room);
  })
);

router.get('/:code/moderation', asyncHandler(async (req, res) => {
  const room = await loadRoom(req.params.code);
  res.json(moderationOverview(room, req.user));
}));

router.get(
  '/:code/moderation/log',
  validate(z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), 'query'),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    res.json({ log: await listLog(room, req.user, req.validQuery) });
  })
);

router.post(
  '/:code/reports',
  reportLimiter,
  validate(
    z.object({
      userId: objectId,
      messageId: objectId.optional(),
      reason: z.enum(REPORT_REASONS),
      details: z.string().trim().max(300, 'Use 300 characters or fewer.').optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertOpen(room);
    const { userId, messageId, reason, details } = req.body;
    const report = await createReport(room, req.user, { targetId: userId, messageId, reason, details });
    res.status(201).json({ ok: true, id: report._id.toString() });
  })
);

router.get(
  '/:code/reports',
  validate(z.object({ status: z.enum(['open', 'actioned', 'dismissed', 'all']).default('open'), limit: z.coerce.number().int().min(1).max(100).default(30) }), 'query'),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    res.json({ reports: await listReports(room, req.user, req.validQuery) });
  })
);

router.post(
  '/:code/reports/:id',
  actionLimiter,
  validate(
    z.object({
      decision: z.enum(['dismiss', 'action']),
      action: z.enum(['none', 'mute', 'ban']).default('none'),
      minutes: z.coerce.number().int().min(1).max(60 * 24 * 30).nullable().optional().transform((v) => v ?? null),
      note: z.string().trim().max(300).default(''),
    })
  ),
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    assertOpen(room);
    const report = await resolveReport(room, req.user, req.params.id, req.body);
    if (req.body.decision === 'action' && req.body.action === 'ban') bus.userRemoved(room, report.target.id);
    const fresh = await loadRoom(room.code);
    bus.roomUpdated(fresh);
    res.json({ report });
  })
);

export default router;
