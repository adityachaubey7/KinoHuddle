import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Icon, { Logo } from './Icon.jsx';
import { Avatar, ButtonLink, PageLoading } from './ui.jsx';
import NotificationBell from './NotificationBell.jsx';

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className="menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        <Avatar user={user} size={34} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <div className="menu-head">
            <div style={{ fontWeight: 600 }}>{user.displayName}</div>
            <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>{user.email}</div>
          </div>
          <Link role="menuitem" className="menu-item" to="/profile"><Icon name="user" size={18} />Profile</Link>
          <Link role="menuitem" className="menu-item" to="/watchlist"><Icon name="bookmark" size={18} />Watchlist</Link>
          <Link role="menuitem" className="menu-item" to="/settings"><Icon name="settings" size={18} />Settings</Link>
          <button
            role="menuitem"
            className="menu-item"
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            <Icon name="logout" size={18} />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);
  const inRoom = location.pathname.startsWith('/room/');

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="brand" aria-label="SyncSpace home">
            <Logo />
            <span className="brand-word">SyncSpace</span>
          </Link>
          <nav className={`nav-links ${navOpen ? 'open' : ''}`} aria-label="Main">
            <NavLink to="/" end className="nav-link">Browse</NavLink>
            <NavLink to="/discover" className="nav-link">Discover</NavLink>
            {user && <NavLink to="/dashboard" className="nav-link">Dashboard</NavLink>}
            {user && <NavLink to="/events" className="nav-link">Events</NavLink>}
            {user && <NavLink to="/watchlist" className="nav-link">Watchlist</NavLink>}
            <NavLink to="/join" className="nav-link">Join a room</NavLink>
          </nav>
          <div className="nav-right">
            {user ? (
              <>
                <ButtonLink to="/rooms/new" variant="primary" size="sm" icon="plus" className="hide-sm">New room</ButtonLink>
                <NotificationBell />
                <UserMenu />
              </>
            ) : (
              <>
                <ButtonLink to="/signin" variant="quiet" size="sm">Sign in</ButtonLink>
                <ButtonLink to="/signup" variant="primary" size="sm" className="hide-sm">Create account</ButtonLink>
              </>
            )}
            <button
              className="btn btn-quiet btn-icon nav-burger"
              aria-label={navOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((o) => !o)}
            >
              <Icon name={navOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      {!inRoom && (
        <footer className="footer">
          <div className="footer-inner">
            <p>
              SyncSpace plays videos through YouTube’s official embedded player. Ads, availability and region limits are set by YouTube and the video’s owner.
            </p>
            <p>Catalog films courtesy of Blender Studio (CC BY) and their official distributors.</p>
          </div>
        </footer>
      )}
    </div>
  );
}

/** Gate for signed-in pages. Remembers where the person was going. */
export function RequireAuth({ children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading label="Checking your session" />;
  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search, reason: 'Sign in to continue.' }} />;
  }
  return children;
}

export function GuestOnly({ children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (user) return <Navigate to={location.state?.from || '/dashboard'} replace />;
  return children;
}
