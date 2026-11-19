import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ButtonLink, Thumb } from '../components/ui.jsx';
import EventRow from '../components/EventRow.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { clock, relative } from '../lib/format.js';

/** Everything on the dashboard that comes from the new features: verification notice, parties, continue watching, history. */
export default function DashboardExtras() {
  const { user } = useAuth();
  const { toast, error } = useToast();
  const navigate = useNavigate();
  const [events, setEvents] = useState({ status: 'loading', items: [] });
  const [cont, setCont] = useState({ status: 'loading', items: [] });
  const [recent, setRecent] = useState({ status: 'loading', items: [] });
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(null);

  const loadAll = useCallback(() => {
    api.get('/events?scope=mine&phase=upcoming&limit=3').then((d) => setEvents({ status: 'ready', items: d.events })).catch(() => setEvents({ status: 'error', items: [] }));
    api.get('/users/me/history/continue').then((d) => setCont({ status: 'ready', items: d.items })).catch(() => setCont({ status: 'error', items: [] }));
    api.get('/users/me/history?limit=6').then((d) => setRecent({ status: 'ready', items: d.items })).catch(() => setRecent({ status: 'error', items: [] }));
  }, []);

  useEffect(() => {
    loadAll();
    api.get('/auth/config').then((c) => setEmailEnabled(c.emailEnabled)).catch(() => {});
  }, [loadAll]);

  const verify = async () => {
    setSending(true);
    try {
      await api.post('/auth/resend-verification');
      toast('Verification email sent. Check your inbox.');
    } catch (e) {
      error(e.message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (id) => {
    setBusy(id);
    try {
      await api.del(`/users/me/history/${id}`);
      setCont((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) }));
      setRecent((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) }));
      toast('Removed from your history');
    } catch (e) {
      error(e.message);
    } finally {
      setBusy(null);
    }
  };

  // Resuming starts a NEW room at your own position. It never moves a room other people are watching.
  const resume = async (item) => {
    setBusy(`r${item.id}`);
    try {
      const d = await api.post('/rooms', {
        name: (item.title || 'Watching together').slice(0, 60),
        videoUrl: `https://youtu.be/${item.videoId}?t=${Math.max(0, Math.floor(item.lastPosition))}`,
        videoTitle: item.title || undefined,
      });
      navigate(`/room/${d.room.code}`);
    } catch (e) {
      error(e.message);
      setBusy(null);
    }
  };

  return (
    <>
      {emailEnabled && user && !user.emailVerified && (
        <div className="dash-section" style={{ marginTop: 'var(--s5)' }}>
          <div className="banner" role="status">
            <span>Verify your email so you can recover your account if you forget your password.</span>
            <Button size="sm" loading={sending} onClick={verify}>Send verification email</Button>
          </div>
        </div>
      )}

      <section className="dash-section" aria-labelledby="dash-events">
        <h2 id="dash-events">Upcoming watch parties <Link to="/events">See all</Link></h2>
        {events.status === 'loading' && <div className="skeleton" style={{ height: 96 }} aria-busy="true" />}
        {events.status === 'error' && <p className="muted">Couldn’t load your watch parties. Refresh to try again.</p>}
        {events.status === 'ready' && !events.items.length && (
          <div className="panel panel-pad" style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <p className="muted">Nothing scheduled. Pick a time and invite friends, and everyone gets a reminder.</p>
            <ButtonLink to="/events/new" icon="calendar">Schedule a party</ButtonLink>
          </div>
        )}
        {events.items.length > 0 && <div className="event-list">{events.items.map((e) => <EventRow key={e.id} event={e} />)}</div>}
      </section>

      {cont.items.length > 0 && (
        <section className="dash-section" aria-labelledby="dash-continue">
          <h2 id="dash-continue">Continue watching</h2>
          <div className="cw-grid">
            {cont.items.map((i) => (
              <article key={i.id} className="cw-card">
                <div className="cw-media">
                  <Thumb id={i.videoId} quality="mqdefault" />
                  <div className="progress" role="progressbar" aria-label="Progress" aria-valuenow={Math.round(i.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.round(i.progress * 100)}%` }} /></div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="queue-title">{i.title || 'YouTube video'}</div>
                  <div className="queue-sub">{clock(i.lastPosition)} of {clock(i.duration)} · {relative(i.lastWatchedAt)}</div>
                </div>
                <div className="cw-actions">
                  <Button size="sm" variant="primary" icon="play" loading={busy === `r${i.id}`} onClick={() => resume(i)}>Resume in a new room</Button>
                  {i.room && <ButtonLink to={`/room/${i.room.code}`} size="sm">Back to {i.room.name}</ButtonLink>}
                  <Button size="sm" variant="quiet" loading={busy === i.id} onClick={() => remove(i.id)} aria-label={`Remove ${i.title || 'this video'} from history`}>Remove</Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {recent.items.length > 0 && (
        <section className="dash-section" aria-labelledby="dash-recent">
          <h2 id="dash-recent">Recently watched <Link to="/settings">Privacy settings</Link></h2>
          <div className="room-list">
            {recent.items.map((i) => (
              <div key={i.id} className="room-row" style={{ gridTemplateColumns: '96px 1fr auto' }}>
                <div className="room-thumb"><Thumb id={i.videoId} quality="mqdefault" /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="room-name">{i.title || 'YouTube video'}</div>
                  <div className="room-sub">
                    <span>{i.completed ? 'Finished' : `${Math.round(i.progress * 100)}% watched`}</span>
                    <span>{relative(i.lastWatchedAt)}</span>
                    {i.roomName && <span>in {i.roomName}</span>}
                    {i.timesWatched > 1 && <span>{i.timesWatched} times</span>}
                  </div>
                </div>
                <Button size="sm" variant="quiet" loading={busy === i.id} onClick={() => remove(i.id)} aria-label={`Remove ${i.title || 'this video'} from history`}>Remove</Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
