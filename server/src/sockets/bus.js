import { serializeRoom, serializePublicCard } from '../lib/roomService.js';
import { serializeMessage } from '../models/Message.js';
import { presence } from './presence.js';

/** Lets REST handlers push real-time updates without importing the socket server directly. */
let io = null;
export const setIo = (instance) => {
  io = instance;
};

export const channel = (code) => `room:${code}`;
export const userChannel = (id) => `user:${id}`;
export const LOBBY = 'lobby';

export const bus = {
  roomUpdated(room) {
    io?.to(channel(room.code)).emit('room:update', serializeRoom(room));
    bus.lobbyUpdate(room);
  },
  /** Push fresh counts / now-playing to everyone browsing /discover. */
  lobbyUpdate(room) {
    if (io && room.visibility === 'public' && room.status === 'open') {
      io.to(LOBBY).emit('lobby:update', serializePublicCard(room));
    }
  },
  system(room, msgDoc) {
    if (msgDoc) io?.to(channel(room.code)).emit('chat:message', serializeMessage(msgDoc));
  },
  roomClosed(room, reason = 'closed') {
    if (!io) return;
    io.to(channel(room.code)).emit('room:closed', { code: room.code, reason });
    if (room.visibility === 'public') io.to(LOBBY).emit('lobby:remove', { code: room.code });
    io.in(channel(room.code)).socketsLeave(channel(room.code));
    presence.clearRoom(room.code);
  },
  /** Push a freshly stored notification (and the new unread count) to every tab the user has open. */
  notification(userId, notification, unread) {
    io?.to(userChannel(userId)).emit('notification:new', { notification, unread });
  },
  notificationCount(userId, unread) {
    io?.to(userChannel(userId)).emit('notification:count', { unread });
  },
  /** The shared queue changed: send the new snapshot to everyone in the room. */
  queueUpdated(code, snapshot) {
    io?.to(channel(code)).emit('queue:update', snapshot);
  },
  userRemoved(room, userId, { notify = true } = {}) {
    if (!io) return;
    for (const sid of presence.socketsFor(room.code, userId)) {
      const s = io.sockets.sockets.get(sid);
      if (s) {
        if (notify) s.emit('room:removed', { code: room.code });
        s.leave(channel(room.code));
        s.data.rooms?.delete(room.code);
      }
      presence.remove(room.code, userId, sid);
    }
  },
};
