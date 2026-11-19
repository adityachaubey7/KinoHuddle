import mongoose from 'mongoose';

export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'inappropriate', 'other'];

const reportSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: '', maxlength: 300 },
    // A snapshot of the reported message only, so the report stays reviewable if the message scrolls away.
    messageText: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'actioned', 'dismissed'], default: 'open' },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
    resolution: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

reportSchema.index({ room: 1, status: 1, createdAt: -1 });
// One open report per reporter, target and message: repeat clicks cannot flood the review queue.
reportSchema.index(
  { room: 1, reporter: 1, target: 1, message: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export const Report = mongoose.model('Report', reportSchema);
