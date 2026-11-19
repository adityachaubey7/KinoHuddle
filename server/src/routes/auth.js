import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User.js';
import { asyncHandler, validate, HttpError } from '../lib/http.js';
import { setAuthCookie, clearAuthCookie, requireAuth, revokeToken, tokenFromRequest } from '../middleware/auth.js';
import { EmailToken, issueToken, consumeToken, hashToken } from '../models/EmailToken.js';
import { sendMail, emailEnabled } from '../services/mailer.js';
import { notify } from '../services/notifications.js';
import { createLimiter } from '../lib/rateLimiter.js';
import { log } from '../lib/logger.js';
import { config } from '../config.js';

const router = Router();

const AVATAR_COLORS = ['#F2B33D', '#5CC8B8', '#E86A5C', '#8F9BFF', '#C68AE8', '#7BC96F'];

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' } },
});

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);
const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use 128 characters or fewer.')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number.');

const registerSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters.').max(40, 'Use 40 characters or fewer.'),
  email,
  password,
});

const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(128) });

router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { displayName, email, password } = req.body;
    if (await User.exists({ email })) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.', { email: 'An account with this email already exists.' });
    }
    const user = await User.create({
      displayName,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    });
    setAuthCookie(res, user);
    sendVerificationEmail(user).catch((err) => log.error('verification email failed', { message: err.message }));
    res.status(201).json({ user: user.toSelf() });
  })
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    // Same message whether the email or the password is wrong.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    setAuthCookie(res, user);
    res.json({ user: user.toSelf() });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revokeToken(tokenFromRequest(req)); // the token stops working everywhere, not just in this browser
    clearAuthCookie(res);
    res.json({ ok: true });
  })
);

router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    clearAuthCookie(res);
    res.json({ ok: true });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSelf() });
});

// ---------------------------------------------------------------- email verification + password reset

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? Number(process.env.TEST_SENSITIVE_LIMIT || 1000) : 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' } },
});
const perEmail = createLimiter({ limit: 3, windowMs: 60 * 60 * 1000 }); // at most 3 reset emails per address per hour
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 5,
  keyGenerator: (req) => req.user?._id?.toString() || 'anon',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many verification emails. Try again later.' } },
});

const RESET_TTL = 30 * 60 * 1000;
const VERIFY_TTL = 24 * 3600 * 1000;

async function sendVerificationEmail(user) {
  if (!emailEnabled() || user.emailVerifiedAt) return { sent: false };
  await EmailToken.updateMany({ user: user._id, type: 'verify', usedAt: null }, { $set: { usedAt: new Date() } });
  const raw = await issueToken(user._id, 'verify', VERIFY_TTL);
  return sendMail({
    to: user.email,
    subject: 'Verify your SyncSpace email',
    text: `Hi ${user.displayName},\n\nConfirm your email address to finish setting up SyncSpace:\n${config.appUrl}/verify-email?token=${raw}\n\nThis link works once and expires in 24 hours. If you didn’t create an account, ignore this message.`,
  });
}

// Tells the client which optional features this server can actually provide.
router.get('/config', (_req, res) => res.json({ emailEnabled: emailEnabled() }));

router.post(
  '/forgot-password',
  sensitiveLimiter,
  validate(z.object({ email })),
  asyncHandler(async (req, res) => {
    if (!emailEnabled()) {
      throw new HttpError(503, 'EMAIL_NOT_CONFIGURED', 'Password reset by email isn’t set up on this server. Ask the administrator to configure email.');
    }
    const generic = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
    if (!perEmail.take(hashToken(req.body.email))) return res.json(generic); // quietly stop mail-bombing one address
    const user = await User.findOne({ email: req.body.email });
    if (user) {
      await EmailToken.updateMany({ user: user._id, type: 'reset', usedAt: null }, { $set: { usedAt: new Date() } }); // older links die
      const raw = await issueToken(user._id, 'reset', RESET_TTL);
      const result = await sendMail({
        to: user.email,
        subject: 'Reset your SyncSpace password',
        text: `Hi ${user.displayName},\n\nUse this link to choose a new password:\n${config.appUrl}/reset-password?token=${raw}\n\nIt works once and expires in 30 minutes. If you didn’t ask for this, ignore this message — your password hasn’t changed.`,
      });
      if (!result.sent) throw new HttpError(502, 'EMAIL_DELIVERY_FAILED', 'We couldn’t send the email right now. Try again in a few minutes.');
    }
    res.json(generic);
  })
);

router.post(
  '/reset-password',
  sensitiveLimiter,
  validate(z.object({ token: z.string().min(20).max(200), password })),
  asyncHandler(async (req, res) => {
    const record = await consumeToken(req.body.token, 'reset'); // atomic: a link can only be used once
    if (!record) throw new HttpError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired. Request a new one.');
    const user = await User.findById(record.user).select('+passwordHash');
    if (!user) throw new HttpError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired. Request a new one.');
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.tokenVersion += 1; // every existing session, on every device, is signed out
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date(); // they just proved they control this inbox
    await user.save();
    await EmailToken.updateMany({ user: user._id, type: 'reset', usedAt: null }, { $set: { usedAt: new Date() } });
    await notify(user._id, { type: 'account', title: 'Your password was changed', body: 'If this wasn’t you, reset it again and review your account.', link: '/settings' });
    clearAuthCookie(res);
    res.json({ ok: true });
  })
);

router.post(
  '/verify-email',
  sensitiveLimiter,
  validate(z.object({ token: z.string().min(20).max(200) })),
  asyncHandler(async (req, res) => {
    const record = await consumeToken(req.body.token, 'verify');
    if (!record) throw new HttpError(400, 'INVALID_TOKEN', 'This verification link is invalid or has expired.');
    await User.updateOne({ _id: record.user, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
    res.json({ ok: true });
  })
);

router.post(
  '/resend-verification',
  requireAuth,
  resendLimiter,
  asyncHandler(async (req, res) => {
    if (!emailEnabled()) throw new HttpError(503, 'EMAIL_NOT_CONFIGURED', 'Email isn’t set up on this server.');
    if (req.user.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });
    const result = await sendVerificationEmail(req.user);
    if (!result.sent) throw new HttpError(502, 'EMAIL_DELIVERY_FAILED', 'We couldn’t send the email right now. Try again in a few minutes.');
    res.json({ ok: true });
  })
);

export { password as passwordRule, AVATAR_COLORS };
export default router;
