import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { RevokedToken } from '../models/RevokedToken.js';
import { HttpError } from '../lib/http.js';

export function signToken(user) {
  // `jti` identifies this one session so signing out can invalidate exactly this token.
  return jwt.sign({ sub: user._id.toString(), v: user.tokenVersion }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    jwtid: crypto.randomUUID(),
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd || config.cookieSameSite === 'none',
    sameSite: config.cookieSameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

export function setAuthCookie(res, user) {
  res.cookie(config.cookieName, signToken(user), cookieOptions());
}

export function clearAuthCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(config.cookieName, opts);
}

/** Parse a raw Cookie header (used by Socket.IO handshake). */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** Resolve a token to a user document, or null. Identity always comes from the token, never the client body. */
export async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.v) return null;
    if (payload.jti && (await RevokedToken.exists({ jti: payload.jti }))) return null; // signed out
    return user;
  } catch {
    return null;
  }
}

/** Invalidate one session token (sign out). Safe to call with a missing or already-invalid token. */
export async function revokeToken(token) {
  if (!token) return;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (!payload.jti) return;
    await RevokedToken.updateOne(
      { jti: payload.jti },
      { $setOnInsert: { jti: payload.jti, expiresAt: new Date(payload.exp * 1000) } },
      { upsert: true }
    );
  } catch {
    /* expired or malformed: nothing to revoke */
  }
}

export function tokenFromRequest(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[config.cookieName] || null;
}

export async function optionalAuth(req, _res, next) {
  try {
    req.user = await userFromToken(tokenFromRequest(req));
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAuth(req, _res, next) {
  try {
    req.user = await userFromToken(tokenFromRequest(req));
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));
    next();
  } catch (err) {
    next(err);
  }
}
