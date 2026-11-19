import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req[part] with a zod schema; replaces it with the parsed value. */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part] ?? {});
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return next(new HttpError(400, 'VALIDATION_ERROR', 'Some fields need attention.', fields));
  }
  if (part === 'query') req.validQuery = result.data;
  else req[part] = result.data;
  next();
};

// Unambiguous alphabet: no 0/O, 1/I/L
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateRoomCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ROOM_CODE_RE.test(code) ? code : null;
}
