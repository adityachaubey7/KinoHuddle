import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 40 },
    avatarColor: { type: String, default: '#F2B33D' },
    bio: { type: String, default: '', maxlength: 160 },
    watchlist: [{ type: String }], // catalog slugs
    tokenVersion: { type: Number, default: 0 }, // bump to sign out every session
    emailVerifiedAt: { type: Date, default: null },
    preferences: {
      reduceMotion: { type: Boolean, default: false },
      showReactions: { type: Boolean, default: true },
      chatSounds: { type: Boolean, default: false },
      saveHistory: { type: Boolean, default: true }, // keep a personal watch history
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    displayName: this.displayName,
    avatarColor: this.avatarColor,
  };
};

userSchema.methods.toSelf = function toSelf() {
  return {
    id: this._id.toString(),
    email: this.email,
    displayName: this.displayName,
    avatarColor: this.avatarColor,
    bio: this.bio,
    watchlist: this.watchlist,
    emailVerified: Boolean(this.emailVerifiedAt),
    preferences: this.preferences,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
