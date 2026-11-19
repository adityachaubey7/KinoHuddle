import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Room, TOPICS } from '../models/Room.js';
import { Message } from '../models/Message.js';
import { asyncHandler, validate, HttpError } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { loadRoom, joinRoom, serializeRoom, serializePublicCard, isExpired } from '../lib/roomService.js';
import { bus } from '../sockets/bus.js';
import { config } from '../config.js';

const router = Router();

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const listSchema = z.object({
  topic: z.enum(TOPICS).optional(),
  language: z.string().regex(/^([a-z]{2,3}(-[A-Za-z0-9]{2,8})?|multi)$/).optional(),
  country: z.string().length(2).transform((v) => v.toUpperCase()).optional(),
  hasSpace: bool.optional(),
  playing: bool.optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['active', 'newest']).default('active'),
  cursor: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Open public rooms matching the filters, as directory cards, best first. */
async function findPublic(f) {
  const filter = { visibility: 'public', status: 'open' };
  if (f.topic) filter.topic = f.topic;
  if (f.language) filter.language = f.language;
  if (f.country) filter.country = f.country;
  if (f.q) filter.name = { $regex: escapeRegex(f.q), $options: 'i' };
  const docs = await Room.find(filter).sort({ lastActivityAt: -1 }).limit(300);
  let cards = docs.filter((r) => !isExpired(r)).map(serializePublicCard);
  if (f.hasSpace) cards = cards.filter((c) => !c.full && !c.locked);
  if (f.playing) cards = cards.filter((c) => c.isPlaying);
  if (f.sort === 'newest') {
    const created = new Map(docs.map((d) => [d.code, new Date(d.createdAt).getTime()]));
    cards.sort((a, b) => created.get(b.code) - created.get(a.code));
  } else {
    cards.sort(
      (a, b) =>
        b.onlineCount - a.onlineCount ||
        b.memberCount - a.memberCount ||
        new Date(b.lastActivityAt) - new Date(a.lastActivityAt)
    );
  }
  return cards;
}

// Directory of public rooms. Anyone may browse; joining needs a session.
router.get(
  '/public',
  optionalAuth,
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const f = req.validQuery;
    const all = await findPublic(f);
    const page = all.slice(f.cursor, f.cursor + f.limit);
    const next = f.cursor + f.limit;
    res.json({
      rooms: page,
      nextCursor: next < all.length ? String(next) : null,
      stats: { rooms: all.length, watching: all.reduce((n, c) => n + c.onlineCount, 0) },
    });
  })
);

const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 40,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'You’re joining rooms very quickly. Wait a moment.' } },
});

async function joinAndAnnounce(room, user) {
  const { room: updated, joined } = await joinRoom(room, user);
  if (joined) {
    bus.roomUpdated(updated);
    const sys = await Message.findOne({ room: updated._id, kind: 'system' }).sort({ createdAt: -1 });
    bus.system(updated, sys);
  }
  return { updated, joined };
}

// One click: drop the user into the busiest public room that has space.
router.post(
  '/public/quick-join',
  requireAuth,
  joinLimiter,
  validate(listSchema.pick({ topic: true, language: true, country: true }), 'body'),
  asyncHandler(async (req, res) => {
    const cards = await findPublic({ ...req.body, hasSpace: true, sort: 'active' });
    for (const card of cards) {
      try {
        const room = await loadRoom(card.code);
        const { updated, joined } = await joinAndAnnounce(room, req.user);
        return res.json({ room: serializeRoom(updated, req.user._id), joined });
      } catch (err) {
        // Full, locked or removed-from rooms: try the next one.
        if (err instanceof HttpError && ['ROOM_FULL', 'ROOM_LOCKED', 'REMOVED', 'ROOM_EXPIRED', 'ROOM_CLOSED'].includes(err.code)) continue;
        throw err;
      }
    }
    throw new HttpError(404, 'NO_PUBLIC_ROOMS', 'No public rooms have space right now. Start one!');
  })
);

// Join a public room without a code or invite. Private rooms look like they don't exist.
router.post(
  '/:code/join-public',
  requireAuth,
  joinLimiter,
  asyncHandler(async (req, res) => {
    const room = await loadRoom(req.params.code);
    if (room.visibility !== 'public') {
      throw new HttpError(404, 'ROOM_NOT_FOUND', 'That room code doesn’t exist. Check it and try again.');
    }
    const { updated, joined } = await joinAndAnnounce(room, req.user);
    res.json({ room: serializeRoom(updated, req.user._id), joined });
  })
);

export default router;
