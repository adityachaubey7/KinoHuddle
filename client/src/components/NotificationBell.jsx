import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Button, Spinner } from './ui.jsx';
import { useNotifications } from '../context/NotificationContext.jsx';
import { relative } from '../lib/format.js';

export default function NotificationBell() {
  const { items, unread, hasMore, status, load, loadMore, markRead, markAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    load();
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, load]);

  const openItem = async (n) => {
    if (!n.read) markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="menu bell" ref={ref}>
      <button
        className="btn btn-quiet btn-icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{unread ? `${unread} unread notifications` : ''}</span>
      {open && (
        <div className="menu-list notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <Button variant="quiet" size="sm" onClick={markAll} disabled={!unread}>Mark all read</Button>
          </div>
          <div className="notif-list">
            {status === 'loading' && !items.length && <div className="notif-empty"><Spinner label="Loading notifications" /></div>}
            {status === 'error' && !items.length && (
              <div className="notif-empty">
                <p>Couldn’t load notifications.</p>
                <Button size="sm" onClick={load}>Try again</Button>
              </div>
            )}
            {status === 'ready' && !items.length && <div className="notif-empty"><p>You’re all caught up.</p></div>}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`notif-item ${n.read ? 'read' : ''}`} onClick={() => openItem(n)}>
                    <span className="notif-dot" aria-label={n.read ? undefined : 'Unread'} />
                    <span>
                      <span className="notif-title">{n.title}</span>
                      {n.body && <span className="notif-body">{n.body}</span>}
                      <span className="notif-time">{relative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && <div style={{ padding: 8, textAlign: 'center' }}><Button variant="quiet" size="sm" onClick={loadMore}>Show older</Button></div>}
          </div>
        </div>
      )}
    </div>
  );
}
