/**
 * In-memory presence: which users currently have at least one live socket in a room.
 * A user with two tabs open is counted once; they go offline only when the last socket leaves.
 * (Single-instance. For horizontal scaling, use the Socket.IO Redis adapter + a shared store.)
 */
const rooms = new Map(); // code -> Map<userId, Set<socketId>>

export const presence = {
  add(code, userId, socketId) {
    if (!rooms.has(code)) rooms.set(code, new Map());
    const users = rooms.get(code);
    const first = !users.has(userId) || users.get(userId).size === 0;
    if (!users.has(userId)) users.set(userId, new Set());
    users.get(userId).add(socketId);
    return first; // true when the user just came online
  },
  remove(code, userId, socketId) {
    const users = rooms.get(code);
    if (!users?.has(userId)) return false;
    const set = users.get(userId);
    set.delete(socketId);
    if (set.size === 0) {
      users.delete(userId);
      if (users.size === 0) rooms.delete(code);
      return true; // user just went offline
    }
    return false;
  },
  isOnline(code, userId) {
    return Boolean(rooms.get(code)?.get(userId)?.size);
  },
  onlineIds(code) {
    return new Set(rooms.get(code)?.keys() || []);
  },
  socketsFor(code, userId) {
    return [...(rooms.get(code)?.get(userId) || [])];
  },
  clearRoom(code) {
    rooms.delete(code);
  },
};
