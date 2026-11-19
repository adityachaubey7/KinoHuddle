import mongoose from 'mongoose';
import crypto from 'node:crypto';

/** Single-use tokens for email verification and password reset. Only a SHA-256 hash is stored. */
const emailTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['verify', 'reset'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
emailTokenSchema.index({ user: 1, type: 1 });
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 }); // clean up a day after expiry

export const EmailToken = mongoose.model('EmailToken', emailTokenSchema);

export const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/** Create a token for a user; returns the raw value (emailed once, never stored). */
export async function issueToken(userId, type, ttlMs) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await EmailToken.create({ user: userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) });
  return raw;
}

/** Atomically consume a token: valid, unexpired and unused → returns the document, otherwise null. */
export function consumeToken(raw, type) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
  return EmailToken.findOneAndUpdate(
    { tokenHash: hashToken(raw), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'before' }
  );
}
