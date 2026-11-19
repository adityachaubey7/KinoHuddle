import { User } from '../models/User.js';
import { WatchHistory } from '../models/WatchHistory.js';

const MAX_DURATION = 24 * 3600;
const COMPLETE_AT = 0.95; // watched at least 95% counts as finished

/**
 * Record how far this person got through the room's current video.
 * Personal only: it never changes the room, and the position must be plausible
 * (inside the video, and the video must be the one the room is playing).
 */
export async function recordProgress(room, user, { videoId, position, duration }) {
  if (!videoId || room.playback?.videoId !== videoId) return { saved: false, reason: 'NOT_CURRENT' };
  if (![position, duration].every(Number.isFinite) || duration < 5 || duration > MAX_DURATION || position < 0) {
    return { saved: false, reason: 'IMPLAUSIBLE' };
  }
  const fresh = await User.findById(user._id).select('preferences');
  if (fresh?.preferences?.saveHistory === false) return { saved: false, reason: 'HISTORY_OFF' };

  const pos = Math.min(position, duration);
  const completed = pos / duration >= COMPLETE_AT;
  const now = new Date();
  const existing = await WatchHistory.findOne({ user: user._id, videoId });
  const newSession = !existing || existing.completed || existing.lastRoomCode !== room.code || now - existing.lastWatchedAt > 60 * 60 * 1000;

  await WatchHistory.updateOne(
    { user: user._id, videoId },
    {
      $set: {
        title: room.playback.videoTitle || existing?.title || '',
        lastPosition: Math.round(pos),
        duration: Math.round(duration),
        completed,
        lastRoomCode: room.code,
        lastRoomName: room.name,
        lastWatchedAt: now,
      },
      $setOnInsert: { firstWatchedAt: now },
      ...(existing && newSession ? { $inc: { timesWatched: 1 } } : {}),
    },
    { upsert: true }
  );
  return { saved: true, completed };
}
