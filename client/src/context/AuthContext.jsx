import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { closeSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready

  useEffect(() => {
    api
      .get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setStatus('ready'));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', Boolean(user?.preferences?.reduceMotion));
  }, [user?.preferences?.reduceMotion]);

  const signIn = useCallback(async (email, password) => {
    const d = await api.post('/auth/login', { email, password });
    setUser(d.user);
    return d.user;
  }, []);

  const signUp = useCallback(async (displayName, email, password) => {
    const d = await api.post('/auth/register', { displayName, email, password });
    setUser(d.user);
    return d.user;
  }, []);

  const signOut = useCallback(async ({ everywhere = false } = {}) => {
    try {
      await api.post(everywhere ? '/auth/logout-all' : '/auth/logout');
    } finally {
      closeSocket();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, setUser, status, signIn, signUp, signOut }),
    [user, status, signIn, signUp, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
