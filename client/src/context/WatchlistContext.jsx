import { createContext, useCallback, useContext, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const WatchlistContext = createContext(null);

export function WatchlistProvider({ children }) {
  const { user, setUser } = useAuth();
  const { toast, error } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const list = useMemo(() => user?.watchlist ?? [], [user?.watchlist]);

  const toggle = useCallback(
    async (title) => {
      if (!user) {
        navigate('/signin', { state: { from: location.pathname + location.search, reason: 'Sign in to save titles to your watchlist.' } });
        return;
      }
      const saved = list.includes(title.slug);
      // Optimistic update, rolled back on failure.
      setUser((u) => ({ ...u, watchlist: saved ? u.watchlist.filter((s) => s !== title.slug) : [...u.watchlist, title.slug] }));
      try {
        const d = saved
          ? await api.del(`/users/me/watchlist/${encodeURIComponent(title.slug)}`)
          : await api.post('/users/me/watchlist', { slug: title.slug });
        setUser((u) => ({ ...u, watchlist: d.watchlist }));
        toast(saved ? `Removed “${title.title}” from your watchlist` : `Saved “${title.title}” to your watchlist`);
      } catch (e) {
        setUser((u) => ({ ...u, watchlist: list }));
        error(e.message);
      }
    },
    [user, list, setUser, toast, error, navigate, location]
  );

  const value = useMemo(() => ({ list, has: (slug) => list.includes(slug), toggle }), [list, toggle]);
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export const useWatchlist = () => useContext(WatchlistContext);
