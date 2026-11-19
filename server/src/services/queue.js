import mongoose from 'mongoose';
import { Room } from '../models/Room.js';
import { QueueItem, sortQueue } from '../models/QueueItem.js';
import { ModLog } from '../models/ModLog.js';
import { HttpError } from '../lib/http.js';
import { parseYouTube } from '../lib/youtube.js';
import { expiryFor } from '../lib/roomService.js';

export const MAX_QUEUE = 50;
export const MAX_PER_USER = 10;
const RANK_STEP = 1024;
const END_SLACK_SECONDS = 3; // an "ended" report is only believed once the server clock agrees the video is nearly over

const uid = (u) => (u?._id || u).toString();
const validId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

/** Queue snapshot for the room, in play order. `version` only ever increases. */
export async function getSnapshot(room) {
  const version = (await Room.findById(room._id).select('queueVersion queueMode playback')).toObject();
  const items = await QueueItem.find({ room: room._id }).populate('addedBy', 'displayName avatarColor');
  const sorted = sortQueue(items, version.queueMode);
  return {
    code: room.code,
    version: version.queueVersion || 0,
    mode: version.queueMode || 'votes',
    max: MAX_QUEUE,
    current: version.playback?.videoId
      ? { videoId: version.playback.videoId, title: version.playback.videoTitle || '', queueItemId: version.playback.queueItemId?.toString() || null }
      : null,
    items: sorted.map((i, index) => ({
      id: i._id.toString(),
      position: index + 1,
      videoId: i.videoId,
      title: i.title,
      startSeconds: i.startSeconds,
      pinned: i.pinned,
      votes: i.votes.length,
      voters: i.votes.map(String),
      addedBy: i.addedBy ? { id: uid(i.addedBy), displayName: i.addedBy.displayName } : null,
      createdAt: i.createdAt,
    })),
  };
}

const bump = (roomId) => Room.updateOne({ _id: roomId }, { $inc: { queueVersion: 1 } });

async function nextRank(roomId, { top = false } = {}) {
  const edge = await QueueItem.findOne({ room: roomId }).sort({ rank: top ? 1 : -1 }).select('rank');
  if (!edge) return RANK_STEP;
  return top ? edge.rank - RANK_STEP : edge.rank + RANK_STEP;
}

/** Add a video. A video that is already queued is not added twice: the requester's vote goes to the existing entry. */
export async function addItem(room, user, { url, title }) {
  const parsed = parseYouTube(url);
  if (!parsed) throw new HttpError(400, 'INVALID_VIDEO_URL', 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…');
  if (room.playback?.videoId === parsed.videoId) throw new HttpError(409, 'ALREADY_PLAYING', 'That video is playing right now.');

  const count = await QueueItem.countDocuments({ room: room._id });
  if (count >= MAX_QUEUE) throw new HttpError(409, 'QUEUE_FULL', `The queue is full (${MAX_QUEUE} videos). Remove one first.`);
  if (!room.canModerate(user._id)) {
    const mine = await QueueItem.countDocuments({ room: room._id, addedBy: user._id });
    if (mine >= MAX_PER_USER) throw new HttpError(409, 'USER_LIMIT', `You can have ${MAX_PER_USER} videos waiting at once.`);
  }

  try {
    const item = await QueueItem.create({
      room: room._id,
      videoId: parsed.videoId,
      title: (title || '').trim().slice(0, 120),
      startSeconds: parsed.startSeconds || 0,
      addedBy: user._id,
      rank: await nextRank(room._id),
    });
    await bump(room._id);
    return { item, duplicate: false };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Someone queued this video first (possibly a moment ago). Count the requester's vote on it.
    const existing = await QueueItem.findOneAndUpdate(
      { room: room._id, videoId: parsed.videoId },
      { $addToSet: { votes: user._id } },
      { returnDocument: 'after' }
    );
    if (!existing) throw new HttpError(409, 'CONFLICT', 'The queue changed. Try again.');
    await bump(room._id);
    return { item: existing, duplicate: true };
  }
}

/** Vote on (or withdraw a vote from) an upcoming video. One vote per person per item; repeating is harmless. */
export async function setVote(room, user, itemId, on) {
  if (!validId(itemId)) throw new HttpError(404, 'QUEUE_ITEM_NOT_FOUND', 'That video is no longer in the queue.');
  const filter = { _id: itemId, room: room._id };
  const res = await QueueItem.updateOne(
    on ? { ...filter, votes: { $ne: user._id } } : { ...filter, votes: user._id },
    on ? { $addToSet: { votes: user._id } } : { $pull: { votes: user._id } }
  );
  if (!res.modifiedCount) {
    const exists = await QueueItem.exists(filter);
    if (!exists) throw new HttpError(404, 'QUEUE_ITEM_NOT_FOUND', 'That video is no longer in the queue.');
    return { changed: false }; // already voted / already withdrawn
  }
  await bump(room._id);
  return { changed: true };
}

/** Remove an entry. Moderators can remove anything; everyone else only their own. Removing twice is harmless. */
export async function removeItem(room, user, itemId) {
  if (!validId(itemId)) return { removed: false };
  const item = await QueueItem.findOne({ _id: itemId, room: room._id });
  if (!item) return { removed: false };
  const own = item.addedBy.toString() === user._id.toString();
  if (!own && !room.canModerate(user._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can remove other people’s videos.');
  const res = await QueueItem.deleteOne({ _id: item._id, room: room._id });
  if (!res.deletedCount) return { removed: false }; // someone else removed or started it first
  await bump(room._id);
  if (!own) await ModLog.create({ room: room._id, actor: user._id, action: 'queue_remove', target: item.addedBy, details: { videoId: item.videoId } });
  return { removed: true };
}

async function renumber(roomId, mode) {
  const items = sortQueue(await QueueItem.find({ room: roomId }), mode === 'votes' ? 'manual' : mode);
  if (!items.length) return;
  await QueueItem.bulkWrite(items.map((it, i) => ({ updateOne: { filter: { _id: it._id }, update: { $set: { rank: (i + 1) * RANK_STEP } } } })));
}

/**
 * Move an entry. Manual mode: to any position. Votes mode: only to the front ("play next"),
 * because votes decide the rest of the order.
 */
export async function moveItem(room, user, itemId, toIndex) {
  if (!room.canModerate(user._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can reorder the queue.');
  if (!validId(itemId)) throw new HttpError(404, 'QUEUE_ITEM_NOT_FOUND', 'That video is no longer in the queue.');
  const mode = room.queueMode || 'votes';

  if (mode === 'votes') {
    if (toIndex !== 0) throw new HttpError(400, 'REORDER_NOT_ALLOWED', 'Votes decide the order. Use “Play next”, or switch to manual order.');
    const rank = await nextRank(room._id, { top: true });
    const res = await QueueItem.updateOne({ _id: itemId, room: room._id }, { $set: { pinned: true, rank } });
    if (!res.matchedCount) throw new HttpError(404, 'QUEUE_ITEM_NOT_FOUND', 'That video is no longer in the queue.');
    await bump(room._id);
    return { moved: true };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const others = sortQueue(await QueueItem.find({ room: room._id, _id: { $ne: itemId } }), 'manual');
    const at = Math.max(0, Math.min(toIndex, others.length));
    const prev = others[at - 1];
    const next = others[at];
    let rank;
    if (prev && next) rank = (prev.rank + next.rank) / 2;
    else if (prev) rank = prev.rank + RANK_STEP;
    else if (next) rank = next.rank - RANK_STEP;
    else rank = RANK_STEP;
    if (prev && next && Math.abs(next.rank - prev.rank) < 1e-6) {
      await renumber(room._id, 'manual'); // ranks ran out of room: spread them out and retry once
      continue;
    }
    const res = await QueueItem.updateOne({ _id: itemId, room: room._id }, { $set: { rank, pinned: false } });
    if (!res.matchedCount) throw new HttpError(404, 'QUEUE_ITEM_NOT_FOUND', 'That video is no longer in the queue.');
    await bump(room._id);
    return { moved: true };
  }
  throw new HttpError(409, 'CONFLICT', 'The queue changed while moving. Try again.');
}

export async function setQueueMode(room, user, mode) {
  if (!room.isHost(user._id)) throw new HttpError(403, 'HOST_ONLY', 'Only the host can change how the queue is ordered.');
  if (!['votes', 'manual'].includes(mode)) throw new HttpError(400, 'BAD_REQUEST', 'Unknown queue order.');
  if (mode === 'manual' && room.queueMode === 'votes') {
    // Freeze the order people were looking at, so switching modes doesn't shuffle the queue.
    const items = sortQueue(await QueueItem.find({ room: room._id }), 'votes');
    if (items.length) {
      await QueueItem.bulkWrite(items.map((it, i) => ({ updateOne: { filter: { _id: it._id }, update: { $set: { rank: (i + 1) * RANK_STEP, pinned: false } } } })));
    }
  }
  await Room.updateOne({ _id: room._id }, { $set: { queueMode: mode }, $inc: { queueVersion: 1 } });
  return { mode };
}

/**
 * Start the next video. Safe to call many times at once for the same "ended" moment:
 *  1. claim the entry (atomic delete) so two callers can never play the same entry;
 *  2. switch Room.playback only if nobody changed it since we looked (compare-and-set on `seq`);
 *  3. if step 2 loses the race, the entry is put back.
 * `expectVideoId` makes a late "ended" report for an earlier video a no-op.
 */
export async function advanceQueue(roomId, { itemId = null, expectVideoId = null, isPlaying = true, actorId = null } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await Room.findById(roomId);
    if (!room) return { advanced: false, reason: 'ROOM_NOT_FOUND' };
    if (room.status !== 'open') return { advanced: false, reason: 'ROOM_NOT_OPEN' };
    if (expectVideoId && room.playback.videoId !== expectVideoId) return { advanced: false, reason: 'STALE', room };

    const items = sortQueue(await QueueItem.find({ room: roomId }), room.queueMode);
    const candidate = itemId ? items.find((i) => i._id.toString() === itemId) : items[0];
    if (!candidate) return { advanced: false, reason: itemId ? 'ITEM_NOT_FOUND' : 'EMPTY', room };

    const claimed = await QueueItem.findOneAndDelete({ _id: candidate._id, room: roomId });
    if (!claimed) {
      if (itemId) return { advanced: false, reason: 'ITEM_NOT_FOUND', room };
      continue; // another caller took it; look at the queue again
    }

    const now = new Date();
    const guard = { _id: roomId, status: 'open', 'playback.seq': room.playback.seq || 0 };
    if (expectVideoId) guard['playback.videoId'] = expectVideoId;
    const updated = await Room.findOneAndUpdate(
      guard,
      {
        $set: {
          'playback.videoId': claimed.videoId,
          'playback.videoTitle': claimed.title || '',
          'playback.position': claimed.startSeconds || 0,
          'playback.isPlaying': isPlaying,
          'playback.rate': 1,
          'playback.duration': 0,
          'playback.queueItemId': claimed._id,
          'playback.updatedAt': now,
          'playback.updatedBy': actorId,
          lastActivityAt: now,
          expiresAt: expiryFor(room, now.getTime()),
        },
        $inc: { 'playback.seq': 1, queueVersion: 1 },
      },
      { returnDocument: 'after' }
    );
    if (!updated) {
      // Playback changed under us (another advance, a manual video change). Put the entry back untouched.
      try {
        await QueueItem.create(claimed.toObject());
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
      if (expectVideoId) return { advanced: false, reason: 'STALE', room };
      continue;
    }
    return { advanced: true, room: updated, item: claimed };
  }
  return { advanced: false, reason: 'CONFLICT' };
}

/** Pause at the end of the video when there is nothing queued. Only the first of many reports takes effect. */
export async function finishWithoutQueue(room, videoId) {
  const end = room.playback.duration > 0 ? room.playback.duration : room.currentPosition();
  const updated = await Room.findOneAndUpdate(
    { _id: room._id, 'playback.videoId': videoId, 'playback.isPlaying': true, 'playback.seq': room.playback.seq || 0 },
    { $set: { 'playback.isPlaying': false, 'playback.position': end, 'playback.updatedAt': new Date() }, $inc: { 'playback.seq': 1 } },
    { returnDocument: 'after' }
  );
  return updated ? { finished: true, room: updated } : { finished: false };
}

/**
 * Decide whether an "ended" report should be believed.
 * With a known duration the server's own clock must agree (nobody can skip early by lying);
 * without one, only people who control playback are trusted.
 */
export function endReportAllowed(room, userId, now = Date.now()) {
  const d = room.playback.duration || 0;
  if (d > 0) return room.currentPosition(now) >= d - END_SLACK_SECONDS;
  return room.canControl(userId);
}

/** Unavailable-video reports: a controller can skip alone; otherwise a strict majority of people online must report. */
const unavailable = new Map(); // `${code}:${videoId}:${seq}` -> Set<userId>
export function unavailableVerdict(room, userId, onlineIds) {
  if (room.canControl(userId)) return true;
  const key = `${room.code}:${room.playback.videoId}:${room.playback.seq}`;
  if (!unavailable.has(key)) unavailable.set(key, new Set());
  const set = unavailable.get(key);
  set.add(userId.toString());
  if (unavailable.size > 500) unavailable.delete(unavailable.keys().next().value);
  const online = Math.max(1, onlineIds.size);
  const votes = [...set].filter((id) => onlineIds.has(id)).length;
  return votes >= Math.floor(online / 2) + 1;
}

export async function setDuration(room, videoId, duration) {
  const res = await Room.updateOne(
    { _id: room._id, 'playback.videoId': videoId },
    { $set: { 'playback.duration': Math.round(duration) } }
  );
  return res.modifiedCount > 0;
}
