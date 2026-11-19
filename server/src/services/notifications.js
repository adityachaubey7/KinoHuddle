import mongoose from 'mongoose';
import { Notification, serializeNotification } from '../models/Notification.js';
import { bus } from '../sockets/bus.js';
import { log } from '../lib/logger.js';

const safeLink = (l) => (typeof l === 'string' && /^\/(?!\/)[\w\-./?=&#%]*$/.test(l) ? l : null);

export const unreadCount = (userId) => Notification.countDocuments({ user: userId, readAt: null });

/**
 * Create a notification for one user. With a dedupeKey the notification is stored at most once:
 * a retry, a restart or two racing workers return null instead of creating (or pushing) a duplicate.
 */
export async function notify(userId, { type, title, body = '', link = null, data = {}, dedupeKey = null }) {
  try {
    const fields = { user: userId, type, title: String(title).slice(0, 120), body: String(body).slice(0, 300), link: safeLink(link), data, dedupeKey };
    let doc;
    if (dedupeKey) {
      const res = await Notification.findOneAndUpdate(
        { user: userId, dedupeKey },
        { $setOnInsert: { ...fields, createdAt: new Date() } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, setDefaultsOnInsert: true }
      );
      if (res.lastErrorObject?.updatedExisting) return null;
      doc = res.value;
    } else {
      doc = await Notification.create(fields);
    }
    bus.notification(userId.toString(), serializeNotification(doc), await unreadCount(userId));
    return doc;
  } catch (err) {
    if (err?.code === 11000) return null; // lost an upsert race: someone else created it
    log.error('notify failed', { type, message: err.message });
    return null;
  }
}

export const notifyMany = (userIds, payload) =>
  Promise.all([...new Set(userIds.map(String))].map((id) => notify(new mongoose.Types.ObjectId(id), { ...payload, dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}` : null })));

/** Remove unread notifications that no longer apply (for example reminders for a rescheduled event). */
export async function withdrawUnread(match) {
  const res = await Notification.deleteMany({ ...match, readAt: null });
  return res.deletedCount;
}
