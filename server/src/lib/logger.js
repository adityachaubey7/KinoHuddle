import { config } from '../config.js';

/**
 * Tiny structured logger: one JSON object per line, secrets redacted.
 * Levels: debug < info < warn < error < silent.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const SECRET_KEY = /pass(word)?|token|secret|cookie|authorization|hash|api[_-]?key/i;

function redact(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code, stack: config.isProd ? undefined : value.stack };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

function write(level, msg, fields) {
  if ((LEVELS[level] ?? 20) < (LEVELS[config.logLevel] ?? 20)) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...redact(fields || {}) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (msg, f) => write('debug', msg, f),
  info: (msg, f) => write('info', msg, f),
  warn: (msg, f) => write('warn', msg, f),
  error: (msg, f) => write('error', msg, f),
};
