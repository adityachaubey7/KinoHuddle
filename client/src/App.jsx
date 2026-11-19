import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Layout, RequireAuth, GuestOnly } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import TitleDetail from './pages/TitleDetail.jsx';
import Watchlist from './pages/Watchlist.jsx';
import { SignIn, SignUp } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CreateRoom from './pages/CreateRoom.jsx';
import JoinRoom from './pages/JoinRoom.jsx';
import Room from './pages/Room.jsx';
import Discover from './pages/Discover.jsx';
import Profile from './pages/Profile.jsx';
import Settings from './pages/Settings.jsx';
import Events from './pages/Events.jsx';
import EventForm from './pages/EventForm.jsx';
import EventDetail from './pages/EventDetail.jsx';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/Recovery.jsx';
import NotFound from './pages/NotFound.jsx';

const TITLES = [
  [/^\/$/, 'SyncSpace — watch together'],
  [/^\/title\//, 'Title — SyncSpace'],
  [/^\/watchlist/, 'Watchlist — SyncSpace'],
  [/^\/signin/, 'Sign in — SyncSpace'],
  [/^\/signup/, 'Create account — SyncSpace'],
  [/^\/discover/, 'Discover rooms — SyncSpace'],
  [/^\/dashboard/, 'Dashboard — SyncSpace'],
  [/^\/rooms\/new/, 'New room — SyncSpace'],
  [/^\/join/, 'Join a room — SyncSpace'],
  [/^\/room\//, 'Watch room — SyncSpace'],
  [/^\/profile/, 'Profile — SyncSpace'],
  [/^\/settings/, 'Settings — SyncSpace'],
  [/^\/events\/new/, 'Schedule a watch party — SyncSpace'],
  [/^\/events/, 'Watch parties — SyncSpace'],
  [/^\/forgot-password/, 'Reset your password — SyncSpace'],
  [/^\/reset-password/, 'Choose a new password — SyncSpace'],
  [/^\/verify-email/, 'Verify your email — SyncSpace'],
];

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = TITLES.find(([re]) => re.test(pathname))?.[1] || 'Page not found — SyncSpace';
  }, [pathname]);
  return null;
}

const auth = (el) => <RequireAuth>{el}</RequireAuth>;

export default function App() {
  return (
    <>
      <RouteEffects />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="title/:slug" element={<TitleDetail />} />
          <Route path="signin" element={<GuestOnly><SignIn /></GuestOnly>} />
          <Route path="signup" element={<GuestOnly><SignUp /></GuestOnly>} />
          <Route path="discover" element={<Discover />} />
          <Route path="watchlist" element={auth(<Watchlist />)} />
          <Route path="dashboard" element={auth(<Dashboard />)} />
          <Route path="rooms/new" element={auth(<CreateRoom />)} />
          <Route path="join" element={auth(<JoinRoom />)} />
          <Route path="join/:code" element={auth(<JoinRoom />)} />
          <Route path="room/:code" element={auth(<Room />)} />
          <Route path="profile" element={auth(<Profile />)} />
          <Route path="settings" element={auth(<Settings />)} />
          <Route path="events" element={auth(<Events />)} />
          <Route path="events/new" element={auth(<EventForm />)} />
          <Route path="events/:id" element={auth(<EventDetail />)} />
          <Route path="events/:id/edit" element={auth(<EventForm />)} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
