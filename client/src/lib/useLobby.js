import { useEffect } from 'react';
import { getSocket } from './socket.js';

/** While mounted, receive live card updates for public rooms (counts, now-playing). */
export function useLobby(enabled, { onUpdate, onRemove }) {
  useEffect(() => {
    if (!enabled) return undefined;
    const s = getSocket();
    const join = () => s.emit('lobby:join', {});
    if (s.connected) join();
    s.on('connect', join); // re-subscribe after every reconnect
    s.on('lobby:update', onUpdate);
    s.on('lobby:remove', onRemove);
    return () => {
      s.off('connect', join);
      s.off('lobby:update', onUpdate);
      s.off('lobby:remove', onRemove);
      s.emit('lobby:leave', {});
    };
  }, [enabled, onUpdate, onRemove]);
}
