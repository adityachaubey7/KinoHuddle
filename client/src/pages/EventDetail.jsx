import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button, ButtonLink, Field, Modal, PageLoading, State } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { countdown, formatWhen, localZone, zoneAbbr } from '../lib/format.js';

function InviteModal({ event, onClose }) {
  const { toast, error } = useToast();
  const [link, setLink] = useState(`${window.location.origin}${event.inviteLink}`);
  const [emails, setEmails] = useState('');
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied');
    } catch {
      error('Your browser blocked copying. Select the link and copy it manually.');
    }
  };
  const rotate = async () => {
    try {
      const d = await api.post(`/events/${event.id}/invite-link`);
      setLink(`${window.location.origin}${d.inviteLink}`);
      toast('New link created. The old one no longer works.');
    } catch (e) {
      error(e.message);
    }
  };
  const send = async (e) => {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).filter(Boolean);
    if (!list.length) return setFieldError('Enter at least one email address.');
    setSending(true);
    setFieldError('');
    try {
      await api.post(`/events/${event.id}/invite`, { emails: list });
      toast('Invitations sent to people who have a SyncSpace account');
      setEmails('');
    } catch (err) {
      setFieldError(err.fields?.emails || err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Invite people" onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="muted" style={{ marginBottom: 'var(--s4)' }}>Anyone with this link can see the party and RSVP after signing in, until it’s over.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <label htmlFor="event-link" className="sr-only">Invitation link</label>
        <input id="event-link" className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button icon="copy" onClick={copy}>Copy</Button>
      </div>
      <Button variant="quiet" size="sm" onClick={rotate} style={{ marginTop: 8 }}>Create a new link</Button>

      <form onSubmit={send} style={{ marginTop: 'var(--s5)' }} noValidate>
        <Field label="Invite by email" hint="People with a SyncSpace account get a notification. We don’t say whether an address has an account." error={fieldError}>
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: 72 }} placeholder="friend@example.com, another@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} />}
        </Field>
        <Button type="submit" loading={sending} style={{ marginTop: 8 }}>Send invitations</Button>
      </form>
    </Modal>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const invite = params.get('invite') || undefined;
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const [state, setState] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(null);
  const [modal, setModal] = useState(null); // 'invite' | 'cancel'
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/events/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`);
      setState({ status: 'ready', event: d.event });
    } catch (e) {
      setState({ status: 'error', code: e.code, message: e.message, http: e.status });
    }
  }, [id, invite]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keeps "in 5 min" and the Join button honest
    return () => clearInterval(t);
  }, []);

  if (state.status === 'loading') return <PageLoading label="Loading watch party" />;
  if (state.status === 'error') {
    const gone = state.http === 410;
    return (
      <State
        icon={gone ? 'clock' : 'lock'}
        title={state.code === 'INVITE_EXPIRED' ? 'This invitation has expired' : state.code === 'EVENT_CANCELLED' ? 'This watch party was cancelled' : state.http === 404 ? 'Watch party not found' : 'Couldn’t load this watch party'}
        actions={<ButtonLink to="/events" variant="primary">See your watch parties</ButtonLink>}
      >
        {state.http === 404 ? 'It may have been removed, or it isn’t shared with you. Ask the organiser for a fresh link.' : state.message}
      </State>
    );
  }

  const { event } = state;
  const active = event.status === 'scheduled' && event.phase !== 'completed';
  const hostZoneDiffers = event.timeZone && event.timeZone !== localZone();

  const run = async (key, fn, success) => {
    setBusy(key);
    try {
      const d = await fn();
      if (d?.event) setState({ status: 'ready', event: d.event });
      if (success) toast(success);
      return d;
    } catch (e) {
      error(e.message);
      if (e.code === 'EVENT_NOT_STARTED' || e.status === 410) load();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const rsvp = (status) => run(status, () => api.put(`/events/${id}/rsvp`, { status, invite }), status === 'going' ? 'You’re going' : 'Marked as not going');
  const join = async () => {
    const d = await run('join', () => api.post(`/events/${id}/join`, { invite }));
    if (d?.room) navigate(`/room/${d.room.code}`);
  };
  const cancel = async () => {
    await run('cancel', () => api.post(`/events/${id}/cancel`), 'Watch party cancelled');
    setModal(null);
  };

  return (
    <div className="event-page">
      <section className="event-hero">
        <Link to="/events" className="muted" style={{ fontSize: 'var(--t-sm)' }}><Icon name="arrowLeft" size={14} /> All watch parties</Link>
        <h1>{event.title}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {event.phase === 'ongoing' && <span className="chip chip-sync"><span className="dot" /> Happening now</span>}
          {event.phase === 'upcoming' && <span className="chip chip-warn">Starts {countdown(event.startsAt)}</span>}
          {event.phase === 'completed' && <span className="chip">Finished</span>}
          {event.status === 'cancelled' && <span className="chip chip-bad">Cancelled</span>}
          <span className="chip">{event.visibility === 'public' ? 'Public' : 'Private'}</span>
        </div>
        {event.description && <p className="muted" style={{ marginTop: 'var(--s3)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{event.description}</p>}
      </section>

      <section className="panel panel-pad">
        <dl className="event-facts" style={{ margin: 0 }}>
          <div className="event-fact">
            <dt>When</dt>
            <dd>
              {formatWhen(event.startsAt)} {zoneAbbr(event.startsAt)}
              {hostZoneDiffers && <small>Organiser’s time: {formatWhen(event.startsAt, event.timeZone)} {zoneAbbr(event.startsAt, event.timeZone)}</small>}
            </dd>
          </div>
          <div className="event-fact"><dt>Length</dt><dd>About {event.durationMinutes >= 60 ? `${event.durationMinutes / 60} h` : `${event.durationMinutes} min`}</dd></div>
          <div className="event-fact"><dt>Hosted by</dt><dd>{event.isHost ? 'You' : event.host.displayName}</dd></div>
          <div className="event-fact"><dt>Going</dt><dd>{event.goingCount}{event.maxMembers ? ` of ${event.maxMembers}` : ''}</dd></div>
        </dl>
      </section>

      {active && (
        <section className="panel panel-pad" aria-label="Your response" style={{ display: 'grid', gap: 'var(--s4)' }}>
          {!event.isHost && (
            <div>
              <div className="label" id="rsvp-label" style={{ marginBottom: 8 }}>Are you going?</div>
              <div className="rsvp" role="group" aria-labelledby="rsvp-label">
                <Button variant={event.myRsvp === 'going' ? 'primary' : 'default'} aria-pressed={event.myRsvp === 'going'} icon="check" loading={busy === 'going'} onClick={() => rsvp('going')}>I’m going</Button>
                <Button variant={event.myRsvp === 'not_going' ? 'primary' : 'default'} aria-pressed={event.myRsvp === 'not_going'} loading={busy === 'not_going'} onClick={() => rsvp('not_going')}>Can’t make it</Button>
              </div>
              {event.myRsvp === 'going' && <p className="faint" style={{ fontSize: 'var(--t-sm)', marginTop: 8 }}>You’ll get a reminder {event.reminderLeadMinutes >= 60 ? `${event.reminderLeadMinutes / 60} h` : `${event.reminderLeadMinutes} min`} before it starts.</p>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" size="lg" icon="door" disabled={!event.joinable || !event.roomOpen} loading={busy === 'join'} onClick={join}>Join the room</Button>
            {!event.joinable && <span className="faint" style={{ fontSize: 'var(--t-sm)' }}>The room opens {formatWhen(event.joinOpensAt)} {zoneAbbr(event.joinOpensAt)}.</span>}
            {event.joinable && !event.roomOpen && <span className="faint" style={{ fontSize: 'var(--t-sm)' }}>This party’s room has closed.</span>}
          </div>
        </section>
      )}

      {event.isHost && (
        <section className="panel panel-pad" aria-label="Organiser tools">
          <h2 style={{ fontSize: 'var(--t-lg)', marginBottom: 'var(--s3)' }}>Organiser</h2>
          {active ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button icon="link" onClick={() => setModal('invite')}>Invite people</Button>
              <ButtonLink to={`/events/${event.id}/edit`} icon="settings">Edit</ButtonLink>
              <Button variant="danger" onClick={() => setModal('cancel')}>Cancel party</Button>
            </div>
          ) : <p className="muted">This party is {event.status === 'cancelled' ? 'cancelled' : 'over'}, so it can’t be changed.</p>}
          {event.attendees?.length > 0 && (
            <div style={{ marginTop: 'var(--s4)' }}>
              <div className="label" style={{ marginBottom: 6 }}>Going ({event.attendees.length})</div>
              <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>{event.attendees.map((a) => a.displayName).join(', ')}</p>
            </div>
          )}
        </section>
      )}

      {modal === 'invite' && <InviteModal event={event} onClose={() => setModal(null)} />}
      {modal === 'cancel' && (
        <Modal
          title="Cancel this watch party?"
          onClose={() => setModal(null)}
          actions={<><Button variant="quiet" onClick={() => setModal(null)}>Keep it</Button><Button variant="danger" loading={busy === 'cancel'} onClick={cancel}>Cancel party</Button></>}
        >
          <p className="muted">Everyone who’s going or invited is notified, and pending reminders are removed.</p>
        </Modal>
      )}
    </div>
  );
}
