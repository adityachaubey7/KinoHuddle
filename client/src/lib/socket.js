import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_SOCKET_URL || undefined; // undefined = same origin

let socket = null;

/** One shared, cookie-authenticated connection per signed-in session. */
export function getSocket() {
  if (!socket) {
    socket = io(URL, {
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
      transports: ['websocket', 'polling'],
    });
  }
  if (socket.disconnected) socket.connect();
  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/** emit with an ack and timeout; resolves to the server's ack payload. */
export function request(s, event, payload, timeout = 8000) {
  return new Promise((resolve) => {
    s.timeout(timeout).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The server didn’t respond. Check your connection.' } });
      else resolve(res);
    });
  });
}

export function newClientId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}
