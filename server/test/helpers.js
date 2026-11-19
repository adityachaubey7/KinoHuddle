process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/syncspace_test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.HOST_GRACE_SECONDS = '1';

const { default: mongoose } = await import('mongoose');
const { start } = await import('../src/index.js');
const { io: ioClient } = await import('socket.io-client');

export async function boot() {
  const srv = await start({ port: 0 });
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const base = `http://127.0.0.1:${srv.port}`;
  return { ...srv, base };
}

/** Minimal cookie-keeping HTTP client. */
export function client(base) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    get cookie() { return cookie; },
  };
}

export async function signup(base, name) {
  const c = client(base);
  const email = `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const r = await c.post('/api/auth/register', { displayName: name, email, password: 'password123' });
  if (r.status !== 201) throw new Error('signup failed ' + JSON.stringify(r.body));
  return { c, user: r.body.user, email };
}

export function connect(base, cookie) {
  return new Promise((resolve, reject) => {
    const s = ioClient(base, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

export const emit = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));
export const once = (s, ev, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), ms);
    s.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const V = ['aqz-KE-bpKQ', 'xU47nhruN-Q', 'R6MlUcmOul8', '_cMxraX_5RE', 'eRsGyueVLvQ', 'SkVqJ1SGeL0'];
export const VIDEOS = V;
export const yt = (i) => `https://youtu.be/${V[i]}`;

/** Create a room hosted by `host` and add the given guests (REST), returning the code. */
export async function makeRoom(host, guests = [], body = {}) {
  const r = await host.c.post('/api/rooms', { name: 'Test room', ...body });
  if (r.status !== 201) throw new Error('room create failed ' + JSON.stringify(r.body));
  const code = r.body.room.code;
  for (const g of guests) {
    const j = await g.c.post(`/api/rooms/${code}/join`);
    if (j.status !== 200) throw new Error('join failed ' + JSON.stringify(j.body));
  }
  return code;
}

/** Join the room's socket channel and resolve with the join ack. */
export async function enter(s, code) {
  const ack = await emit(s, 'room:join', { code });
  if (!ack.ok) throw new Error('room:join failed ' + JSON.stringify(ack));
  return ack;
}
