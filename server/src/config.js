import 'dotenv/config';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const jwtSecret = required('JWT_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me');
if (isProd && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export const config = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 4000),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/syncspace'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieName: 'ss_token',
  // Comma-separated list of allowed browser origins
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  roomTtlHours: Number(process.env.ROOM_TTL_HOURS || 24),
  hostGraceSeconds: Number(process.env.HOST_GRACE_SECONDS || 60),
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Free public rooms
  officialRoomsEnabled: (process.env.OFFICIAL_ROOMS_ENABLED ?? (nodeEnv === 'test' ? 'false' : 'true')) === 'true',
  publicRoomCapacity: Number(process.env.PUBLIC_ROOM_CAPACITY || 200),
  // Public URL of the web app, used in links inside emails and notifications.
  appUrl: (process.env.APP_URL || (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0]).trim().replace(/\/$/, ''),
  // 'lax' is right when the client and API share an origin (recommended). Use 'none' only for split domains.
  cookieSameSite: ['lax', 'strict', 'none'].includes(process.env.COOKIE_SAMESITE)
    ? process.env.COOKIE_SAMESITE
    : nodeEnv === 'production' ? 'none' : 'lax',
  logLevel: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? (nodeEnv === 'test' ? 0 : 30_000)),
  email: {
    // 'smtp' sends real mail through the configured server; 'none' disables email features safely.
    provider: process.env.EMAIL_PROVIDER || (nodeEnv === 'test' ? 'memory' : 'none'),
    from: process.env.EMAIL_FROM || 'SyncSpace <no-reply@localhost>',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
  },
};

const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Is this browser origin allowed to talk to the API?
 * Production: only the origins listed in CLIENT_ORIGIN.
 * Development/test: also any localhost port, because Vite moves to 5174, 5175… when 5173 is busy.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin and non-browser requests have no Origin header
  if (config.clientOrigins.includes(origin)) return true;
  return !config.isProd && LOCAL_RE.test(origin);
}
