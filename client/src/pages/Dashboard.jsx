import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Avatar, Button, ButtonLink, State, Thumb } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { relative } from '../lib/format.js';
import DashboardExtras from './DashboardExtras.jsx';

function StatusChip({ room }) {
  if (room.status === 'closed') return <span className="chip">Closed</span>;
  if (room.status === 'expired') return <span className="chip">Expired</span>;
  if (room.left) return <span className="chip">You left</span>;
  if (room.onlineCount > 0)
    return (
      <span className="chip chip-sync">
        <span className="dot" /> {room.onlineCount} watching
      </span>
    );
  return <span className="chip">Open</span>;
}

function RoomRow({ room }) {
  const open = room.status === 'open';
  const Tag = open ? Link : 'div';
  const props = open ? { to: room.left ? `/join/${room.code}` : `/room/${room.code}` } : {};
  return (
    <Tag className="room-row" {...props}>
      <div className="room-thumb">
        {room.nowPlaying ? <Thumb id={room.nowPlaying.videoId} quality="mqdefault" /> : <Icon name="film" />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="room-name">
          {room.name} {room.isHost && <span className="chip chip-warn" style={{ marginLeft: 6 }}>Host</span>}
        </div>
        <div className="room-sub">
          <span>{room.nowPlaying?.title || (room.nowPlaying ? 'YouTube video' : 'Nothing queued')}</span>
          <span>Active {relative(room.lastActivityAt)}</span>
          <span className="tnum">Code {room.code}</span>
        </div>
      </div>
      <div className="room-side">
        <div className="avatar-stack" aria-label={`${room.memberCount} members`}>
          {room.members.map((m) => <Avatar key={m.id} user={m} size={28} />)}
        </div>
        <StatusChip room={room} />
      </div>
    </Tag>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState({ status: 'loading', items: [] });
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .get('/rooms')
      .then((d) => live && setRooms({ status: 'ready', items: d.rooms }))
      .catch((e) => live && setRooms({ status: 'error', error: e.message, items: [] }));
    return () => {
      live = false;
    };
  }, [attempt]);

  const join = (e) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean) navigate(`/join/${clean}`);
  };

  const active = rooms.items.filter((r) => r.status === 'open' && !r.left);
  const past = rooms.items.filter((r) => !(r.status === 'open' && !r.left));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hi, {user.displayName.split(' ')[0]}</h1>
          <p>Start something new or get back to a room you’re in.</p>
        </div>
      </div>

      <div className="quick">
        <div className="panel quick-card quick-public">
          <h2>Join a free public room</h2>
          <p>No code needed. Jump into a live room with people from around the world, in your language.</p>
          <div style={{ marginTop: 'var(--s2)' }}>
            <ButtonLink to="/discover" variant="primary" size="lg" icon="globe">Browse public rooms</ButtonLink>
          </div>
        </div>
        <div className="panel quick-card quick-primary">
          <h2>Start a room</h2>
          <p>Choose a film or paste a YouTube link. You’ll get a code and an invite link to share.</p>
          <div style={{ marginTop: 'var(--s2)' }}>
            <ButtonLink to="/rooms/new" variant="primary" size="lg" icon="plus">New room</ButtonLink>
          </div>
        </div>
        <form className="panel quick-card" onSubmit={join}>
          <h2>Join with a code</h2>
          <p>Enter the 8-character code your host sent you.</p>
          <div className="join-inline">
            <label htmlFor="dash-code" className="sr-only">Room code</label>
            <input
              id="dash-code"
              className="input"
              placeholder="ABCD2345"
              maxLength={9}
              autoComplete="off"
              spellCheck="false"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={!code.trim()}>Join</Button>
          </div>
        </form>
      </div>

      <DashboardExtras />

      <section className="rooms" aria-labelledby="active-rooms">
        <h2 id="active-rooms">Your rooms</h2>
        {rooms.status === 'loading' && (
          <div className="room-list" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 92 }} />)}
          </div>
        )}
        {rooms.status === 'error' && (
          <State icon="wifiOff" title="Couldn’t load your rooms" actions={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
            {rooms.error}
          </State>
        )}
        {rooms.status === 'ready' && !active.length && (
          <div className="panel panel-pad" style={{ textAlign: 'center' }}>
            <p className="muted">You’re not in any open rooms. Start one, or ask a friend for their code.</p>
          </div>
        )}
        {active.length > 0 && (
          <div className="room-list">
            {active.map((r) => <RoomRow key={r.code} room={r} />)}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="rooms" aria-labelledby="past-rooms" style={{ marginTop: 'var(--s7)' }}>
          <h2 id="past-rooms">Earlier</h2>
          <div className="room-list">
            {past.map((r) => <RoomRow key={r.code} room={r} />)}
          </div>
        </section>
      )}
    </>
  );
}
