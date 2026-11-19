import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

const NotificationContext = createContext(null);
const PAGE = 15;

/** Unread count, a bounded list, and live updates over the user's personal socket channel. */
export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const userId = user?.id;

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const d = await api.get(`/notifications?limit=${PAGE}`);
      setItems(d.notifications);
      setHasMore(d.hasMore);
      setUnread(d.unread);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  const loadMore = useCallback(async () => {
    const last = items.at(-1);
    if (!last) return;
    try {
      const d = await api.get(`/notifications?limit=${PAGE}&before=${encodeURIComponent(last.createdAt)}`);
      setItems((prev) => [...prev, ...d.notifications.filter((n) => !prev.some((p) => p.id === n.id))]);
      setHasMore(d.hasMore);
    } catch {
      /* the list stays as it was */
    }
  }, [items]);

  const markRead = useCallback(async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      const d = await api.post(`/notifications/${id}/read`);
      setUnread(d.unread);
    } catch {
      /* will resync on next load */
    }
  }, []);

  const markAll = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      load();
    }
  }, [load]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setUnread(0);
      setStatus('idle');
      return undefined;
    }
    let live = true;
    api.get('/notifications/unread-count').then((d) => live && setUnread(d.unread)).catch(() => {});
    const s = getSocket();
    const onNew = ({ notification, unread: count }) => {
      setItems((prev) => (prev.some((n) => n.id === notification.id) ? prev : [notification, ...prev]));
      setUnread(count);
      toast(notification.title);
    };
    const onCount = ({ unread: count }) => setUnread(count);
    const onConnect = () => api.get('/notifications/unread-count').then((d) => setUnread(d.unread)).catch(() => {});
    s.on('notification:new', onNew);
    s.on('notification:count', onCount);
    s.on('connect', onConnect);
    return () => {
      live = false;
      s.off('notification:new', onNew);
      s.off('notification:count', onCount);
      s.off('connect', onConnect);
    };
  }, [userId, toast]);

  const value = useMemo(
    () => ({ items, unread, hasMore, status, load, loadMore, markRead, markAll }),
    [items, unread, hasMore, status, load, loadMore, markRead, markAll]
  );
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useNotifications = () => useContext(NotificationContext);
