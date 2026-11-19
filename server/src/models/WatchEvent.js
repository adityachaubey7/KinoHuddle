import mongoose from 'mongoose';

const rsvpSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['going', 'not_going'], required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const watchEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    roomCode: { type: String, required: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'private' }, // mirrors the room, for the public listing
    startsAt: { type: Date, required: true }, // always stored in UTC
    durationMinutes: { type: Number, default: 120, min: 15, max: 600 },
    timeZone: { type: String, default: 'UTC', maxlength: 64 }, // the organiser's IANA zone, for display only
    reminderLeadMinutes: { type: Number, default: 15, min: 5, max: 1440 },
    reminderSentFor: { type: Date, default: null }, // the startsAt value reminders were already sent for
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
    cancelledAt: { type: Date, default: null },
    rsvps: [rsvpSchema],
    invited: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, _id: false }],
    inviteToken: { type: String, required: true }, // secret link token; rotate to invalidate old links
    version: { type: Number, default: 1 }, // bumps on every edit; part of notification dedupe keys
  },
  { timestamps: true }
);

watchEventSchema.index({ status: 1, startsAt: 1 });
watchEventSchema.index({ host: 1, startsAt: -1 });
watchEventSchema.index({ 'rsvps.user': 1, startsAt: -1 });
watchEventSchema.index({ 'invited.user': 1, startsAt: -1 });
watchEventSchema.index({ room: 1 });
watchEventSchema.index({ visibility: 1, status: 1, startsAt: 1 });

export const WatchEvent = mongoose.model('WatchEvent', watchEventSchema);

export const endsAt = (e) => new Date(new Date(e.startsAt).getTime() + e.durationMinutes * 60_000);

/** upcoming | ongoing | completed | cancelled — derived from the clock, never stored. */
export function phaseOf(e, now = Date.now()) {
  if (e.status === 'cancelled') return 'cancelled';
  const start = new Date(e.startsAt).getTime();
  if (now < start) return 'upcoming';
  if (now < endsAt(e).getTime()) return 'ongoing';
  return 'completed';
}
