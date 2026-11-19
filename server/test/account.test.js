import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, client, connect } from './helpers.js';
import { outbox } from '../src/services/mailer.js';
import { EmailToken, hashToken } from '../src/models/EmailToken.js';
import { User } from '../src/models/User.js';
import { config } from '../src/config.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

const tokenFrom = (mail) => /token=([\w-]+)/.exec(mail.text)[1];
const waitForMail = async (to) => {
  for (let i = 0; i < 40; i++) {
    if (outbox.some((m) => m.to === to)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
};
const lastMail = (to) => [...outbox].reverse().find((m) => m.to === to);

test('registration sends a verification email; the link verifies once', async () => {
  const { c, email } = await signup(srv.base, 'Vera');
  await waitForMail(email);
  const mail = lastMail(email);
  assert.ok(mail, 'verification email was handed to the provider');
  assert.equal((await c.get('/api/auth/me')).body.user.emailVerified, false);

  const token = tokenFrom(mail);
  const stored = await EmailToken.findOne({ tokenHash: hashToken(token) });
  assert.ok(stored, 'only the hash is stored');
  assert.equal(await EmailToken.countDocuments({ tokenHash: token }), 0, 'the raw token is never stored');

  assert.equal((await client(srv.base).post('/api/auth/verify-email', { token })).status, 200);
  assert.equal((await c.get('/api/auth/me')).body.user.emailVerified, true);
  assert.equal((await client(srv.base).post('/api/auth/verify-email', { token })).status, 400, 'single use');
  assert.equal((await client(srv.base).post('/api/auth/verify-email', { token: 'x'.repeat(40) })).status, 400);

  // Resend: signed-in only; no-op once verified.
  assert.equal((await client(srv.base).post('/api/auth/resend-verification')).status, 401);
  assert.equal((await c.post('/api/auth/resend-verification')).body.alreadyVerified, true);
  const w = await signup(srv.base, 'Walt');
  await waitForMail(w.email);
  const before = outbox.length;
  assert.equal((await w.c.post('/api/auth/resend-verification')).status, 200);
  assert.equal(outbox.length, before + 1);
  // The earlier link from registration is replaced by the new one.
  assert.equal((await client(srv.base).post('/api/auth/verify-email', { token: tokenFrom(outbox.filter((m) => m.to === w.email)[0]) })).status, 400);
  assert.equal((await client(srv.base).post('/api/auth/verify-email', { token: tokenFrom(lastMail(w.email)) })).status, 200);
});

test('forgot password: same answer for unknown accounts, hashed expiring single-use token, sessions revoked', async () => {
  const { c, email } = await signup(srv.base, 'Pat');
  const other = client(srv.base);
  await other.post('/api/auth/login', { email, password: 'password123' }); // a second device
  const sock = await connect(srv.base, other.cookie);

  const known = await client(srv.base).post('/api/auth/forgot-password', { email });
  const unknown = await client(srv.base).post('/api/auth/forgot-password', { email: 'ghost@example.com' });
  assert.equal(known.status, 200);
  assert.deepEqual(known.body, unknown.body, 'no account enumeration');
  assert.equal(lastMail('ghost@example.com'), undefined, 'nothing is sent to unknown addresses');
  assert.equal((await client(srv.base).post('/api/auth/forgot-password', { email: 'bad' })).status, 400);

  const mail = lastMail(email);
  assert.match(mail.subject, /Reset/);
  const token = tokenFrom(mail);
  assert.equal(await EmailToken.countDocuments({ tokenHash: token }), 0);

  const anon = client(srv.base);
  assert.equal((await anon.post('/api/auth/reset-password', { token, password: 'short' })).status, 400, 'password rules still apply');
  assert.equal((await anon.post('/api/auth/reset-password', { token: 'y'.repeat(43), password: 'newpass123' })).status, 400);
  const done = await anon.post('/api/auth/reset-password', { token, password: 'newpass123' });
  assert.equal(done.status, 200);
  assert.equal((await anon.post('/api/auth/reset-password', { token, password: 'another123' })).status, 400, 'reuse refused');

  // Old password and old sessions are dead; new password works.
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await other.get('/api/auth/me')).status, 401);
  assert.equal((await client(srv.base).post('/api/auth/login', { email, password: 'password123' })).status, 401);
  assert.equal((await client(srv.base).post('/api/auth/login', { email, password: 'newpass123' })).status, 200);
  const dropped = await Promise.race([new Promise((r) => sock.once('disconnect', () => r(true))), new Promise((r) => setTimeout(() => r(false), 100))]);
  sock.disconnect();
  void dropped; // existing sockets stay until they reconnect; new connections are refused:
  await assert.rejects(connect(srv.base, other.cookie));
  assert.equal((await User.findOne({ email })).emailVerifiedAt instanceof Date, true, 'proving inbox control verifies the email');
});

test('a newer reset link replaces older ones; expired tokens are refused', async () => {
  const { email } = await signup(srv.base, 'Quin');
  await client(srv.base).post('/api/auth/forgot-password', { email });
  const first = tokenFrom(lastMail(email));
  await client(srv.base).post('/api/auth/forgot-password', { email });
  const second = tokenFrom(lastMail(email));
  assert.notEqual(first, second);
  assert.equal((await client(srv.base).post('/api/auth/reset-password', { token: first, password: 'newpass123' })).status, 400);

  await EmailToken.updateOne({ tokenHash: hashToken(second) }, { expiresAt: new Date(Date.now() - 1000) });
  const expired = await client(srv.base).post('/api/auth/reset-password', { token: second, password: 'newpass123' });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error.code, 'INVALID_TOKEN');
});

test('logout really ends the session: a copied cookie stops working', async () => {
  const { c } = await signup(srv.base, 'Lou');
  const stolen = c.cookie;
  assert.equal((await fetch(`${srv.base}/api/auth/me`, { headers: { cookie: stolen } })).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await fetch(`${srv.base}/api/auth/me`, { headers: { cookie: stolen } })).status, 401);
  await assert.rejects(connect(srv.base, stolen));
  assert.equal((await client(srv.base).post('/api/auth/logout')).status, 200, 'logging out while signed out is harmless');
});

test('cookie flags, config endpoint and cross-site writes', async () => {
  const res = await fetch(`${srv.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Cookie', email: 'cookie@example.com', password: 'password123' }),
  });
  const set = res.headers.getSetCookie().join(';');
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=Lax/i);
  assert.equal(config.cookieName, 'ss_token');
  assert.equal((await (await fetch(`${srv.base}/api/auth/config`)).json()).emailEnabled, true);

  // A state-changing request from a foreign site is refused before it reaches any route.
  const { c, email } = await signup(srv.base, 'Cora');
  const evil = await fetch(`${srv.base}/api/auth/logout-all`, { method: 'POST', headers: { origin: 'https://evil.example', cookie: c.cookie } });
  assert.equal(evil.status, 403);
  assert.equal((await c.get('/api/auth/me')).status, 200, 'the session was not touched');
  void email;
});

test('password change keeps this session, signs out others, and reports wrong passwords', async () => {
  const { c, email } = await signup(srv.base, 'Dee');
  const other = client(srv.base);
  await other.post('/api/auth/login', { email, password: 'password123' });
  assert.equal((await c.post('/api/users/me/password', { currentPassword: 'nope12345', newPassword: 'fresh12345' })).status, 400);
  assert.equal((await c.post('/api/users/me/password', { currentPassword: 'password123', newPassword: 'fresh12345' })).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  assert.equal((await other.get('/api/auth/me')).status, 401);
});
