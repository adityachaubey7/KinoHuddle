import mongoose from 'mongoose';

/**
 * One upcoming video in a room's shared queue. The video that is playing now lives in Room.playback;
 * an item is deleted atomically when it starts playing, so a queue entry can only be claimed once.
 */
const queueItemSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    videoId: { type: String, required: true, match: /^[A-Za-z0-9_-]{11}$/ },
    title: { type: String, default: '', maxlength: 120 },
    startSeconds: { type: Number, default: 0, min: 0, max: 24 * 3600 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rank: { type: Number, required: true }, // manual order; lower plays first
    pinned: { type: Boolean, default: false }, // "play next": jumps ahead of vote ordering
    votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // unique voters (enforced by $addToSet / $ne guards)
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

queueItemSchema.index({ room: 1, rank: 1 });
// One entry per video per room, enforced by the database even when two people add it at the same instant.
queueItemSchema.index({ room: 1, videoId: 1 }, { unique: true });

export const QueueItem = mongoose.model('QueueItem', queueItemSchema);

/**
 * Order in which items will play.
 *  - manual: by rank (host/moderator order; ties broken by id).
 *  - votes:  "play next" (pinned) items first, then most votes, then by rank (first come, first served).
 */
export function sortQueue(items, mode) {
  const byRank = (a, b) => a.rank - b.rank || String(a._id).localeCompare(String(b._id));
  const list = [...items];
  if (mode === 'manual') return list.sort(byRank);
  return list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned) return byRank(a, b);
    return b.votes.length - a.votes.length || byRank(a, b);
  });
}
