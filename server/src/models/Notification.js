import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'event_invite', 'event_reminder', 'event_updated', 'event_cancelled',
  'room_invite', 'membership', 'moderation', 'report_outcome', 'account',
];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 300 },
    link: { type: String, default: null, maxlength: 200 }, // in-app path, validated when created
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // e.g. { eventId, roomCode }
    dedupeKey: { type: String, default: null, maxlength: 200 },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
// The same logical notification is stored once per user, so retries and races cannot duplicate it.
notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
// Retention: notifications are removed after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
notificationSchema.index({ 'data.eventId': 1, type: 1, readAt: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);

export const serializeNotification = (n) => ({
  id: n._id.toString(),
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  data: n.data || {},
  read: Boolean(n.readAt),
  createdAt: n.createdAt,
});
