import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (message, { type = 'info', duration = 3800 } = {}) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-2), { id, message, type }]);
      if (duration) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({ toast: push, error: (m) => push(m, { type: 'error', duration: 6000 }) }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
