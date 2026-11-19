import mongoose from 'mongoose';

export const TOPICS = ['general', 'movies', 'anime', 'cartoons', 'music', 'sports', 'gaming'];

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['host', 'moderator', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null }, // set when the member leaves on purpose
    removed: { type: Boolean, default: false }, // banned by the host/moderator; cannot rejoin while the ban is active
    bannedUntil: { type: Date, default: null }, // null + removed = permanent ban
    bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    muted: { type: Boolean, default: false },
    mutedUntil: { type: Date, default: null }, // null + muted = until unmuted
  },
  { _id: false }
);

const playbackSchema = new mongoose.Schema(
  {
    videoId: { type: String, default: null },
    videoTitle: { type: String, default: '' },
    isPlaying: { type: Boolean, default: false },
    position: { type: Number, default: 0 }, // seconds at `updatedAt`
    rate: { type: Number, default: 1 },
    duration: { type: Number, default: 0 }, // seconds, reported by someone who controls playback
    queueItemId: { type: mongoose.Schema.Types.ObjectId, default: null }, // the queue entry this video came from
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    seq: { type: Number, default: 0 }, // increases with every change; clients drop stale updates
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [memberSchema],
    maxMembers: { type: Number, default: 10, min: 2, max: 500 },
    // Public rooms are listed on /discover and can be joined in one click, without a code.
    visibility: { type: String, enum: ['public', 'private'], default: 'private' },
    topic: { type: String, enum: TOPICS, default: 'general' },
    language: { type: String, default: 'multi', maxlength: 12 }, // BCP-47 short code, or 'multi'
    country: { type: String, default: null, uppercase: true, maxlength: 2 }, // ISO 3166-1 alpha-2, null = worldwide
    isOfficial: { type: Boolean, default: false }, // always-on lobby created by the system
    slug: { type: String, default: undefined }, // stable id for official rooms
    guestControl: { type: Boolean, default: false }, // can members control playback?
    locked: { type: Boolean, default: false }, // no new members
    slowModeSeconds: { type: Number, default: 0, min: 0, max: 300 }, // minimum gap between a member's chat messages
    queueMode: { type: String, enum: ['votes', 'manual'], default: 'votes' },
    queueVersion: { type: Number, default: 0 }, // increases with every queue change; clients drop stale snapshots
    scheduledStartAt: { type: Date, default: null }, // set for rooms created by a scheduled watch party
    status: { type: String, enum: ['open', 'closed', 'expired'], default: 'open' },
    playback: { type: playbackSchema, default: () => ({}) },
    lastActivityAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

roomSchema.index({ 'members.user': 1, lastActivityAt: -1 });
roomSchema.index({ status: 1, expiresAt: 1 });
roomSchema.index({ visibility: 1, status: 1, lastActivityAt: -1 });
roomSchema.index({ visibility: 1, topic: 1 });
roomSchema.index({ visibility: 1, language: 1 });
roomSchema.index({ visibility: 1, country: 1 });
roomSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });

/** Active (not left) membership for a user, or undefined. */
roomSchema.methods.memberFor = function memberFor(userId) {
  const id = userId.toString();
  return this.members.find((m) => (m.user?._id || m.user).toString() === id && !m.leftAt);
};

roomSchema.methods.activeMembers = function activeMembers() {
  return this.members.filter((m) => !m.leftAt);
};

roomSchema.methods.isHost = function isHost(userId) {
  return this.host.toString() === userId.toString();
};

/** Host or an appointed moderator (active members only). */
roomSchema.methods.canModerate = function canModerate(userId) {
  if (this.isHost(userId)) return true;
  const m = this.memberFor(userId);
  return Boolean(m && m.role === 'moderator');
};

roomSchema.methods.canControl = function canControl(userId) {
  return this.isHost(userId) || (this.guestControl && Boolean(this.memberFor(userId)));
};

/** Server-authoritative position, extrapolated to `now`. */
roomSchema.methods.currentPosition = function currentPosition(now = Date.now()) {
  const p = this.playback;
  if (!p.isPlaying) return p.position;
  const elapsed = (now - new Date(p.updatedAt).getTime()) / 1000;
  return Math.max(0, p.position + elapsed * (p.rate || 1));
};

/** Is this member record under an active ban? Expired temporary bans no longer count. */
export function isBanned(member, now = Date.now()) {
  if (!member?.removed) return false;
  return !member.bannedUntil || new Date(member.bannedUntil).getTime() > now;
}

/** Is this member currently muted? Expired temporary mutes no longer count. */
export function isMuted(member, now = Date.now()) {
  if (!member?.muted) return false;
  return !member.mutedUntil || new Date(member.mutedUntil).getTime() > now;
}

export const Room = mongoose.model('Room', roomSchema);
