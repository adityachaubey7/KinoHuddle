import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for system
    kind: { type: String, enum: ['text', 'reaction', 'system'], default: 'text' },
    text: { type: String, default: '', maxlength: 500 },
    emoji: { type: String, default: null },
    videoTime: { type: Number, default: null }, // playback position when sent
    clientId: { type: String, default: null }, // client-generated id for de-duplication
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ room: 1, createdAt: -1 });
// A client id may only be stored once per room: retries after reconnects cannot duplicate.
messageSchema.index(
  { room: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

export const Message = mongoose.model('Message', messageSchema);

export function serializeMessage(msg, userDoc) {
  const u = userDoc || msg.user;
  return {
    id: msg._id.toString(),
    kind: msg.kind,
    text: msg.text,
    emoji: msg.emoji,
    videoTime: msg.videoTime,
    clientId: msg.clientId,
    createdAt: msg.createdAt,
    user:
      u && u._id
        ? { id: u._id.toString(), displayName: u.displayName, avatarColor: u.avatarColor }
        : null,
  };
}
