import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket, newClientId, request } from '../../lib/socket.js';

/**
 * Owns the room's real-time connection: joining (and re-joining after reconnects),
 * clock offset to the server, chat, reactions, presence and playback events.
 */
export function useRoom(code, { onPlayerState, onReaction }) {
  const [status, setStatus] = useState('connecting'); // connecting | ready | error | closed | removed | expired
  const [error, setError] = useState(null);
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [connection, setConnection] = useState('connecting'); // connecting | online | reconnecting
  const [typing, setTyping] = useState({}); // userId -> { name, until }
  const [reactions, setReactions] = useState([]);
  const [queue, setQueue] = useState(null);
  const offsetRef = useRef(0);
  const handlers = useRef({ onPlayerState, onReaction });
  handlers.current = { onPlayerState, onReaction };
  const socketRef = useRef(null);
  const lastSeq = useRef(-1);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const mergeMessages = useCallback((incoming) => {
    setMessages((prev) => {
      const byId = new Map();
      for (const m of prev) byId.set(m.id, m);
      for (const m of incoming) {
        // Replace an optimistic message with the stored one.
        if (m.clientId) {
          for (const [k, v] of byId) if (v.pending && v.clientId === m.clientId) byId.delete(k);
        }
        byId.set(m.id, m);
      }
      return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    });
  }, []);

  // Queue snapshots carry a version that only goes up: an older one arriving late is ignored.
  const applyQueue = useCallback((snap, { force = false } = {}) => {
    if (!snap) return;
    setQueue((prev) => (force || !prev || snap.version >= prev.version ? snap : prev));
  }, []);

  const applyState = useCallback((state, { force = false } = {}) => {
    if (!state) return;
    if (!force && typeof state.seq === 'number' && state.seq < lastSeq.current) return; // stale
    lastSeq.current = Math.max(lastSeq.current, state.seq ?? 0);
    setRoom((r) => (r ? { ...r, playback: state } : r));
    handlers.current.onPlayerState?.(state);
  }, []);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;
    let disposed = false;

    async function syncClock() {
      let best = null;
      for (let i = 0; i < 4; i++) {
        const t0 = Date.now();
        const res = await request(s, 'time:ping', {}, 3000);
        const t1 = Date.now();
        if (!res?.serverTime) continue;
        const rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt, offset: res.serverTime + rtt / 2 - t1 };
      }
      if (best) offsetRef.current = best.offset;
    }

    async function join() {
      setConnection('online');
      const res = await request(s, 'room:join', { code });
      if (disposed) return;
      if (!res.ok) {
        const c = res.error.code;
        if (c === 'ROOM_CLOSED') setStatus('closed');
        else if (c === 'ROOM_EXPIRED') setStatus('expired');
        else {
          setError(res.error);
          setStatus('error');
        }
        return;
      }
      await syncClock();
      if (disposed) return;
      setRoom(res.room);
      setReactions(res.reactions);
      applyQueue(res.queue, { force: true });
      mergeMessages(res.messages);
      setHasMore((h) => h || res.messages.length >= 50);
      setStatus('ready');
      applyState(res.room.playback, { force: true });
    }

    const onConnect = () => join();
    const onDisconnect = () => !disposed && setConnection('reconnecting');
    const onConnectError = (err) => {
      if (err?.message === 'UNAUTHENTICATED') {
        setError({ code: 'UNAUTHENTICATED', message: 'Your session ended. Sign in again.' });
        setStatus('error');
      } else setConnection('reconnecting');
    };
    const onUpdate = (r) => setRoom((prev) => (prev ? { ...r, playback: prev.playback } : r));
    const onMessage = (m) => mergeMessages([m]);
    const onReactionEvt = (r) => {
      mergeMessages([r]);
      handlers.current.onReaction?.(r);
    };
    const onPlayer = (state) => applyState(state);
    const onQueue = (snap) => snap.code === code && applyQueue(snap);
    const onClosed = ({ reason }) => setStatus(reason === 'expired' ? 'expired' : 'closed');
    const onRemoved = () => setStatus('removed');
    const onTyping = ({ user, typing: t }) =>
      setTyping((prev) => {
        const next = { ...prev };
        if (t) next[user.id] = { name: user.displayName, until: Date.now() + 4000 };
        else delete next[user.id];
        return next;
      });

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('room:update', onUpdate);
    s.on('chat:message', onMessage);
    s.on('reaction', onReactionEvt);
    s.on('player:state', onPlayer);
    s.on('queue:update', onQueue);
    s.on('room:closed', onClosed);
    s.on('room:removed', onRemoved);
    s.on('chat:typing', onTyping);
    if (s.connected) join();

    // Periodically fetch the authoritative state in case an event was missed.
    const resync = setInterval(async () => {
      if (!s.connected) return;
      const res = await request(s, 'player:sync', { code }, 4000);
      if (res?.ok) applyState(res.state);
    }, 15000);
    const typingSweep = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const entries = Object.entries(prev).filter(([, v]) => v.until > now);
        return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
      });
    }, 2000);

    return () => {
      disposed = true;
      clearInterval(resync);
      clearInterval(typingSweep);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.off('room:update', onUpdate);
      s.off('chat:message', onMessage);
      s.off('reaction', onReactionEvt);
      s.off('player:state', onPlayer);
      s.off('queue:update', onQueue);
      s.off('room:closed', onClosed);
      s.off('room:removed', onRemoved);
      s.off('chat:typing', onTyping);
      if (s.connected) s.emit('room:leave', { code });
    };
  }, [code, mergeMessages, applyState, applyQueue]);

  const control = useCallback(
    async (action, payload = {}) => {
      const res = await request(socketRef.current, `player:${action}`, { code, ...payload });
      if (res?.ok) applyState(res.state);
      return res;
    },
    [code, applyState]
  );

  /** Queue and playback reports: every one is validated and authorised again on the server. */
  const emitRoom = useCallback((event, payload = {}) => request(socketRef.current, event, { code, ...payload }), [code]);

  const resync = useCallback(async () => {
    const res = await request(socketRef.current, 'player:sync', { code });
    if (res?.ok) applyState(res.state, { force: true });
    return res;
  }, [code, applyState]);

  const sendMessage = useCallback(
    async (text, me, existingClientId) => {
      const clientId = existingClientId || newClientId();
      const optimistic = {
        id: `pending-${clientId}`,
        clientId,
        kind: 'text',
        text,
        createdAt: new Date().toISOString(),
        user: { id: me.id, displayName: me.displayName, avatarColor: me.avatarColor },
        pending: true,
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), optimistic]);
      const res = await request(socketRef.current, 'chat:send', { code, text, clientId });
      if (res?.ok) mergeMessages([res.message]);
      else
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...m, pending: false, failed: res?.error?.message || 'Not sent' } : m))
        );
      return res;
    },
    [code, mergeMessages]
  );

  const discardMessage = useCallback((id) => setMessages((prev) => prev.filter((m) => m.id !== id)), []);

  const sendReaction = useCallback(
    (emoji) => request(socketRef.current, 'reaction:send', { code, emoji, clientId: newClientId() }),
    [code]
  );

  const typingTimer = useRef(null);
  const isTyping = useRef(false);
  const notifyTyping = useCallback(() => {
    const s = socketRef.current;
    if (!s?.connected) return;
    if (!isTyping.current) {
      isTyping.current = true;
      s.emit('chat:typing', { code, typing: true });
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTyping.current = false;
      s.emit('chat:typing', { code, typing: false });
    }, 2500);
  }, [code]);

  return {
    status, error, room, setRoom, queue, emitRoom, messages, mergeMessages, hasMore, setHasMore, connection, typing, reactions,
    serverNow, control, resync, sendMessage, discardMessage, sendReaction, notifyTyping,
  };
}
