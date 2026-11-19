import mongoose from 'mongoose';

/** Session tokens that were signed out. Entries disappear when the token would have expired anyway. */
const revokedSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
});
revokedSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RevokedToken = mongoose.model('RevokedToken', revokedSchema);
