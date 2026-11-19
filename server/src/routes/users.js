import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { asyncHandler, validate, HttpError } from '../lib/http.js';
import { requireAuth, setAuthCookie } from '../middleware/auth.js';
import { passwordRule, AVATAR_COLORS } from './auth.js';
import { bySlug } from '../data/catalog.js';
import { Room, isBanned } from '../models/Room.js';
import { WatchHistory, progressOf } from '../models/WatchHistory.js';
import mongoose from 'mongoose';

const router = Router();
router.use(requireAuth);

const profileSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Use at least 2 characters.').max(40, 'Use 40 characters or fewer.').optional(),
    bio: z.string().trim().max(160, 'Use 160 characters or fewer.').optional(),
    avatarColor: z.enum(AVATAR_COLORS, { message: 'Pick one of the offered colours.' }).optional(),
    preferences: z
      .object({
        reduceMotion: z.boolean().optional(),
        showReactions: z.boolean().optional(),
        chatSounds: z.boolean().optional(),
        saveHistory: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

router.patch(
  '/me',
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const { preferences, ...rest } = req.body;
    Object.assign(req.user, rest);
    if (preferences) {
      for (const [k, v] of Object.entries(preferences)) req.user.preferences[k] = v;
    }
    await req.user.save();
    res.json({ user: req.user.toSelf() });
  })
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  newPassword: passwordRule,
});

router.post(
  '/me/password',
  validate(passwordSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'WRONG_PASSWORD', 'Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
    }
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    user.tokenVersion += 1; // sign out other sessions
    await user.save();
    setAuthCookie(res, user); // keep this session signed in
    res.json({ ok: true });
  })
);

const slugSchema = z.object({ slug: z.string().max(80) });

router.get('/me/watchlist', (req, res) => {
  res.json({ watchlist: req.user.watchlist });
});

router.post(
  '/me/watchlist',
  validate(slugSchema),
  asyncHandler(async (req, res) => {
    if (!bySlug.has(req.body.slug)) throw new HttpError(404, 'TITLE_NOT_FOUND', 'That title isn’t in the catalog.');
    const updated = await User.findByIdAndUpdate(req.user._id, { $addToSet: { watchlist: req.body.slug } }, { returnDocument: 'after' });
    res.json({ watchlist: updated.watchlist });
  })
);

router.delete(
  '/me/watchlist/:slug',
  asyncHandler(async (req, res) => {
    const updated = await User.findByIdAndUpdate(req.user._id, { $pull: { watchlist: String(req.params.slug) } }, { returnDocument: 'after' });
    res.json({ watchlist: updated.watchlist });
  })
);

// ---------------------------------------------------------------- watch history (personal; separate from the watchlist)

const historyQuery = z.object({
  sort: z.enum(['recent', 'progress']).default('recent'),
  cursor: z.coerce.number().int().min(0).max(5000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

/** Link back to a room only while the person can still enter it. Private room details never leak after leaving or a ban. */
async function roomAccess(userId, codes) {
  if (!codes.length) return new Map();
  const rooms = await Room.find({ code: { $in: codes }, status: 'open' }).select('code name members');
  const out = new Map();
  for (const r of rooms) {
    const m = r.members.find((x) => x.user.toString() === userId.toString());
    if (m && !m.leftAt && !isBanned(m)) out.set(r.code, r.name);
  }
  return out;
}

async function presentHistory(userId, docs) {
  const access = await roomAccess(userId, [...new Set(docs.map((d) => d.lastRoomCode).filter(Boolean))]);
  return docs.map((h) => ({
    id: h._id.toString(),
    videoId: h.videoId,
    title: h.title,
    lastPosition: h.lastPosition,
    duration: h.duration,
    progress: progressOf(h),
    completed: h.completed,
    timesWatched: h.timesWatched,
    lastWatchedAt: h.lastWatchedAt,
    room: h.lastRoomCode && access.has(h.lastRoomCode) ? { code: h.lastRoomCode, name: access.get(h.lastRoomCode) } : null,
    roomName: h.lastRoomName || null, // the name you saw at the time, kept even if you can't re-enter
  }));
}

router.get(
  '/me/history',
  validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { sort, cursor, limit } = req.validQuery;
    // "progress" lists unfinished videos first, most-complete first.
    const filter = { user: req.user._id };
    const q = WatchHistory.find(sort === 'progress' ? { ...filter, completed: false, duration: { $gt: 0 } } : filter);
    const docs =
      sort === 'progress'
        ? (await q.sort({ lastWatchedAt: -1 }).limit(500)).sort((a, b) => progressOf(b) - progressOf(a)).slice(cursor, cursor + limit + 1)
        : await q.sort({ lastWatchedAt: -1 }).skip(cursor).limit(limit + 1);
    res.json({ items: await presentHistory(req.user._id, docs.slice(0, limit)), nextCursor: docs.length > limit ? String(cursor + limit) : null });
  })
);

// Videos worth coming back to: started, not finished.
router.get(
  '/me/history/continue',
  asyncHandler(async (req, res) => {
    const docs = await WatchHistory.find({ user: req.user._id, completed: false, duration: { $gt: 0 }, lastPosition: { $gte: 15 } })
      .sort({ lastWatchedAt: -1 })
      .limit(8);
    res.json({ items: await presentHistory(req.user._id, docs) });
  })
);

router.delete(
  '/me/history/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'That entry doesn’t exist.');
    const r = await WatchHistory.deleteOne({ _id: req.params.id, user: req.user._id });
    if (!r.deletedCount) throw new HttpError(404, 'NOT_FOUND', 'That entry doesn’t exist.');
    res.json({ ok: true });
  })
);

router.delete(
  '/me/history',
  asyncHandler(async (req, res) => {
    const r = await WatchHistory.deleteMany({ user: req.user._id });
    res.json({ ok: true, deleted: r.deletedCount });
  })
);

export default router;
