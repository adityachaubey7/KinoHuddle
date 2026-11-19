import mongoose from 'mongoose';

/**
 * Personal watch history: one entry per user per video. It is deliberately separate from the
 * watchlist (things you want to watch) and never drives a shared room's playback.
 */
const watchHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoId: { type: String, required: true },
    title: { type: String, default: '', maxlength: 120 },
    lastPosition: { type: Number, default: 0, min: 0 }, // seconds
    duration: { type: Number, default: 0, min: 0 },
    completed: { type: Boolean, default: false },
    timesWatched: { type: Number, default: 1 },
    lastRoomCode: { type: String, default: null },
    lastRoomName: { type: String, default: '', maxlength: 60 },
    firstWatchedAt: { type: Date, default: Date.now },
    lastWatchedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

watchHistorySchema.index({ user: 1, videoId: 1 }, { unique: true });
watchHistorySchema.index({ user: 1, lastWatchedAt: -1 });
// Retention: history older than 180 days (since last watched) is deleted automatically.
watchHistorySchema.index({ lastWatchedAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export const WatchHistory = mongoose.model('WatchHistory', watchHistorySchema);

export const progressOf = (h) => (h.duration > 0 ? Math.min(1, h.lastPosition / h.duration) : 0);
