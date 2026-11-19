import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.TEST_REPORT_LIMIT = '2';
process.env.TEST_SENSITIVE_LIMIT = '3';
const { boot, signup, client, makeRoom } = await import('./helpers.js');

let srv;
before(async () => { srv = await boot(); });
after(async () => { await srv.stop(); });

test('report endpoint is rate limited per user', async () => {
  const host = await signup(srv.base, 'Host');
  const ben = await signup(srv.base, 'Ben');
  const cara = await signup(srv.base, 'Cara');
  const code = await makeRoom(host, [ben, cara]);
  const r = (target, reason) => ben.c.post(`/api/rooms/${code}/reports`, { userId: target.user.id, reason });
  const dan = await signup(srv.base, 'Dan');
  await dan.c.post(`/api/rooms/${code}/join`);
  assert.equal((await r(cara, 'spam')).status, 201);
  assert.equal((await r(host, 'hate')).status, 201);
  const third = await r(dan, 'other');
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'RATE_LIMITED');
  assert.equal((await host.c.post(`/api/rooms/${code}/reports`, { userId: cara.user.id, reason: 'spam' })).status, 201, 'limit is per user');
});

test('password reset and verification endpoints are rate limited', async () => {
  const c = client(srv.base);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await c.post('/api/auth/forgot-password', { email: `nobody${i}@example.com` })).status);
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[4], 429);
  assert.equal((await c.post('/api/auth/reset-password', { token: 'x'.repeat(30), password: 'newpass123' })).status, 429);
});
