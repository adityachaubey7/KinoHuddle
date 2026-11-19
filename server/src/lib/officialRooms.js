import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Room } from '../models/Room.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { uniqueRoomCode } from './roomService.js';

const SYSTEM_EMAIL = 'system@syncspace.local';
const TEN_YEARS = 10 * 365 * 24 * 3600 * 1000;

/** Always-on, free lobbies. Edit this list to add more. */
export const OFFICIAL_ROOMS = [
  { slug: 'worldwide-lounge', name: 'Worldwide Lounge', topic: 'general', language: 'multi', country: null, videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny' },
  { slug: 'anime-night', name: 'Anime Night', topic: 'anime', language: 'en', country: null, videoId: 'xU47nhruN-Q', title: 'Your Name — trailer' },
  { slug: 'movie-club', name: 'Movie Club', topic: 'movies', language: 'en', country: null, videoId: 'R6MlUcmOul8', title: 'Tears of Steel' },
  { slug: 'cartoon-corner', name: 'Cartoon Corner', topic: 'cartoons', language: 'en', country: null, videoId: '_cMxraX_5RE', title: 'Sprite Fright' },
  { slug: 'hindi-chill', name: 'Hindi Chill', topic: 'general', language: 'hi', country: 'IN', videoId: 'eRsGyueVLvQ', title: 'Sintel' },
  { slug: 'espanol-latino', name: 'Español Latino', topic: 'general', language: 'es', country: null, videoId: 'SkVqJ1SGeL0', title: 'Caminandes: Llamigos' },
];

async function systemUser() {
  const existing = await User.findOne({ email: SYSTEM_EMAIL });
  if (existing) return existing;
  // A real bcrypt hash of a random secret: nobody can sign in as the system account.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  try {
    return await User.create({ email: SYSTEM_EMAIL, passwordHash, displayName: 'SyncSpace', avatarColor: '#F4B740' });
  } catch (err) {
    if (err?.code === 11000) return User.findOne({ email: SYSTEM_EMAIL });
    throw err;
  }
}

/** Create any missing official rooms and make sure existing ones are open. Safe to call repeatedly. */
export async function ensureOfficialRooms() {
  const owner = await systemUser();
  const now = new Date();
  for (const def of OFFICIAL_ROOMS) {
    const existing = await Room.findOne({ slug: def.slug });
    if (existing) {
      if (existing.status !== 'open') {
        existing.status = 'open';
        existing.closedAt = null;
        existing.expiresAt = new Date(now.getTime() + TEN_YEARS);
        await existing.save();
      }
      continue;
    }
    await Room.create({
      code: await uniqueRoomCode(),
      slug: def.slug,
      name: def.name,
      host: owner._id, // the system account owns the room; it never joins as a member
      members: [],
      maxMembers: config.publicRoomCapacity,
      guestControl: true, // lobbies have no human host, so members share playback control
      visibility: 'public',
      topic: def.topic,
      language: def.language,
      country: def.country,
      isOfficial: true,
      playback: { videoId: def.videoId, videoTitle: def.title, isPlaying: false, position: 0, updatedAt: now },
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + TEN_YEARS),
    });
  }
}
