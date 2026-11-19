import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { boot, signup } from './helpers.js';

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

test('health and readiness; request ids; unknown routes', async () => {
  const h = await fetch(`${srv.base}/api/health`);
  assert.equal((await h.json()).ok, true);
  const r = await fetch(`${srv.base}/api/ready`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ready, true);
  assert.match(r.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  const nf = await fetch(`${srv.base}/api/nope`);
  assert.equal(nf.status, 404);
});

test('bad input is answered cleanly: malformed JSON, oversized bodies, wrong types', async () => {
  const post = (body, type = 'application/json') => fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(50_000) }))).status, 413);
  assert.equal((await post(JSON.stringify({ email: { $gt: '' }, password: 'x' }))).status, 400, 'operator injection is rejected by validation');
  const { c } = await signup(srv.base, 'Ops');
  assert.equal((await c.get('/api/events?limit=abc')).status, 400);
});

test('when the database is unreachable readiness says so and the API fails safely', async () => {
  await mongoose.disconnect();
  try {
    const r = await fetch(`${srv.base}/api/ready`);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).ready, false);
    assert.equal((await fetch(`${srv.base}/api/health`)).status, 200, 'liveness stays up');
  } finally {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  assert.equal((await fetch(`${srv.base}/api/ready`)).status, 200, 'recovers when the database returns');
});
