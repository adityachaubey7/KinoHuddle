import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Notification, serializeNotification } from '../models/Notification.js';
import { asyncHandler, validate, HttpError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { unreadCount } from '../services/notifications.js';
import { bus } from '../sockets/bus.js';

const router = Router();
router.use(requireAuth);

const listSchema = z.object({
  before: z.string().datetime().optional(), // cursor: createdAt of the last item already loaded
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unread: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// Every query below is filtered by the signed-in user: nobody can read or change someone else's notifications.
router.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { before, limit, unread } = req.validQuery;
    const filter = { user: req.user._id };
    if (before) filter.createdAt = { $lt: new Date(before) };
    if (unread) filter.readAt = null;
    const docs = await Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
    const page = docs.slice(0, limit);
    res.json({
      notifications: page.map(serializeNotification),
      hasMore: docs.length > limit,
      unread: await unreadCount(req.user._id),
    });
  })
);

router.get('/unread-count', asyncHandler(async (req, res) => res.json({ unread: await unreadCount(req.user._id) })));

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
    bus.notificationCount(req.user._id.toString(), 0);
    res.json({ unread: 0 });
  })
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!n) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
    const unread = await unreadCount(req.user._id);
    bus.notificationCount(req.user._id.toString(), unread);
    res.json({ notification: serializeNotification(n), unread });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
    const r = await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
    if (!r.deletedCount) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
    const unread = await unreadCount(req.user._id);
    bus.notificationCount(req.user._id.toString(), unread);
    res.json({ unread });
  })
);

export default router;
