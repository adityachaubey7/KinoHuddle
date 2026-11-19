import mongoose from 'mongoose';

export const MOD_ACTIONS = [
  'mute', 'unmute', 'ban', 'unban', 'remove', 'promote', 'demote', 'slow_mode', 'report_dismissed', 'report_actioned', 'queue_remove',
];

const modLogSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: MOD_ACTIONS, required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
modLogSchema.index({ room: 1, createdAt: -1 });
modLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export const ModLog = mongoose.model('ModLog', modLogSchema);
