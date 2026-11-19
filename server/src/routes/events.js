import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { TOPICS } from '../models/Room.js';
import { Message } from '../models/Message.js';
import { asyncHandler, validate } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { serializeRoom } from '../lib/roomService.js';
import {
  createEvent, loadEvent, assertCanView, serializeEvent, setRsvp, updateEvent, cancelEvent,
  inviteByEmail, rotateInviteLink, joinEvent, listMine, listPublic,
} from '../services/events.js';
import { bus } from '../sockets/bus.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'You’ve scheduled a lot of watch parties recently. Try again later.' } },
});

const iso = z.string().datetime({ offset: true, message: 'Choose a valid date and time.' });
const title = z.string().trim().min(2, 'Use at least 2 characters.').max(80, 'Use 80 characters or fewer.');
const description = z.string().trim().max(500, 'Use 500 characters or fewer.');

const createSchema = z.object({
  title,
  description: description.default(''),
  startsAt: iso,
  timeZone: z.string().max(64).default('UTC'),
  durationMinutes: z.coerce.number().int().min(15, 'At least 15 minutes.').max(600, 'At most 10 hours.').default(120),
  reminderLeadMinutes: z.coerce.number().int().min(5).max(1440).default(15),
  maxMembers: z.coerce.number().int().min(2, 'At least 2 people.').max(50, 'At most 50 people.').default(10),
  guestControl: z.boolean().default(false),
  visibility: z.enum(['private', 'public']).default('private'),
  topic: z.enum(TOPICS).default('general'),
  language: z.string().regex(/^([a-z]{2,3}(-[A-Za-z0-9]{2,8})?|multi)$/, 'Choose a language.').default('multi'),
  country: z.string().length(2).transform((v) => v.toUpperCase()).nullable().optional().transform((v) => v ?? null),
  videoUrl: z.string().trim().max(500).optional().or(z.literal('')),
  videoTitle: z.string().trim().max(120).optional(),
});

const patchSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    startsAt: iso.optional(),
    timeZone: z.string().max(64).optional(),
    durationMinutes: z.coerce.number().int().min(15).max(600).optional(),
    reminderLeadMinutes: z.coerce.number().int().min(5).max(1440).optional(),
  })
  .strict();

const listSchema = z.object({
  scope: z.enum(['mine', 'public']).default('mine'),
  phase: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

const tokenQuery = z.object({ invite: z.string().max(60).optional() });

async function present(items, user) {
  return Promise.all(items.map((e) => serializeEvent(e, user)));
}

router.post(
  '/',
  createLimiter,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const event = await createEvent(req.user, req.body);
    const full = await loadEvent(event._id);
    res.status(201).json({ event: await serializeEvent(full, req.user) });
  })
);

router.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const f = req.validQuery;
    const page = f.scope === 'public' ? await listPublic(req.user, { offset: f.cursor, limit: f.limit }) : await listMine(req.user, { phase: f.phase, offset: f.cursor, limit: f.limit });
    res.json({ events: await present(page.items, req.user), nextCursor: page.nextCursor, total: page.total });
  })
);

router.get(
  '/:id',
  validate(tokenQuery, 'query'),
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    await assertCanView(event, req.user, req.validQuery.invite);
    res.json({ event: await serializeEvent(event, req.user) });
  })
);

router.patch(
  '/:id',
  validate(patchSchema),
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    const { event: updated } = await updateEvent(event, req.user, req.body);
    res.json({ event: await serializeEvent(updated, req.user) });
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    const { event: updated } = await cancelEvent(event, req.user, bus);
    res.json({ event: await serializeEvent(updated, req.user) });
  })
);

router.put(
  '/:id/rsvp',
  validate(z.object({ status: z.enum(['going', 'not_going']), invite: z.string().max(60).optional() })),
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    await assertCanView(event, req.user, req.body.invite);
    const updated = await setRsvp(event, req.user, req.body.status);
    res.json({ event: await serializeEvent(updated, req.user) });
  })
);

router.post(
  '/:id/invite',
  validate(z.object({ emails: z.array(z.string().trim().toLowerCase().email('Enter valid email addresses.').max(254)).min(1).max(10, 'Up to 10 at a time.') })),
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    res.json(await inviteByEmail(event, req.user, req.body.emails));
  })
);

router.post(
  '/:id/invite-link',
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    const updated = await rotateInviteLink(event, req.user);
    res.json({ inviteLink: `/events/${updated._id}?invite=${updated.inviteToken}` });
  })
);

router.post(
  '/:id/join',
  validate(z.object({ invite: z.string().max(60).optional() })),
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id);
    const { room, joined } = await joinEvent(event, req.user, req.body.invite);
    if (joined) {
      bus.roomUpdated(room);
      const sys = await Message.findOne({ room: room._id, kind: 'system' }).sort({ createdAt: -1 });
      bus.system(room, sys);
    }
    res.json({ room: serializeRoom(room, req.user._id), joined });
  })
);

export default router;
