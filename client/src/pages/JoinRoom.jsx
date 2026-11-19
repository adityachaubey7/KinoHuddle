import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink, Field, PageLoading, State } from '../components/ui.jsx';
import { api } from '../lib/api.js';

const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const clean = (s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Shared copy for every way a room can be off-limits. */
export function RoomProblem({ code, message }) {
  const map = {
    ROOM_NOT_FOUND: ['No room with that code', 'Check the code with your host. Codes are 8 characters and don’t use 0, O, 1, I or L.', 'search'],
    ROOM_CLOSED: ['This room is closed', 'The host ended this room. Ask them to open a new one.', 'door'],
    ROOM_EXPIRED: ['This room expired', 'Rooms close after a day without activity. Ask the host to start a new one.', 'clock'],
    ROOM_FULL: ['This room is full', message || 'Ask the host to raise the limit or make space.', 'users'],
    ROOM_LOCKED: ['This room is locked', 'The host isn’t letting new people in right now.', 'lock'],
    REMOVED: ['You can’t join this room', 'The host removed you from this room.', 'lock'],
    NOT_A_MEMBER: ['You’re not in this room yet', 'Join it first using the code or invite link.', 'lock'],
  };
  const [title, body, icon] = map[code] || ['Couldn’t open this room', message || 'Try again in a moment.', 'alert'];
  return (
    <State icon={icon} title={title} actions={<><ButtonLink to="/dashboard" variant="primary">Go to dashboard</ButtonLink><ButtonLink to="/join" variant="ghost">Enter another code</ButtonLink></>}>
      {body}
    </State>
  );
}

function CodeForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const submit = (e) => {
    e.preventDefault();
    let value = code.trim();
    // Accept a pasted invite link too.
    const m = /\/(?:join|room)\/([A-Za-z0-9-]+)/.exec(value);
    if (m) value = m[1];
    const c = clean(value);
    if (!CODE_RE.test(c)) return setError('Room codes are 8 letters and numbers, like K7M4QX2P.');
    navigate(`/join/${c}`);
  };
  return (
    <div className="form-page" style={{ maxWidth: 480 }}>
      <h1>Join a room</h1>
      <p className="lede">Paste the invite link or type the code your host shared.</p>
      <form className="panel panel-pad" onSubmit={submit} noValidate>
        <Field label="Room code or invite link" error={error}>
          {(p) => (
            <input
              {...p}
              className="input"
              autoFocus
              autoComplete="off"
              spellCheck="false"
              placeholder="K7M4QX2P"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.4rem', letterSpacing: '0.14em' }}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block style={{ marginTop: 'var(--s5)' }} disabled={!code.trim()}>
          Find room
        </Button>
      </form>
    </div>
  );
}

function JoinPreview({ code }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading' });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get(`/rooms/${encodeURIComponent(code)}`)
      .then((d) => {
        if (!live) return;
        if (d.access === 'member') navigate(`/room/${d.room.code}`, { replace: true });
        else if (d.access === 'removed') setState({ status: 'error', code: 'REMOVED' });
        else setState({ status: 'ready', room: d.room });
      })
      .catch((e) => live && setState({ status: 'error', code: e.code, message: e.message }));
    return () => {
      live = false;
    };
  }, [code, navigate]);

  const join = async () => {
    setJoining(true);
    try {
      const d = await api.post(`/rooms/${encodeURIComponent(code)}/join`);
      navigate(`/room/${d.room.code}`, { replace: true });
    } catch (e) {
      setState({ status: 'error', code: e.code, message: e.message });
    }
  };

  if (state.status === 'loading') return <PageLoading label="Finding room" />;
  if (state.status === 'error') return <RoomProblem code={state.code} message={state.message} />;

  const { room } = state;
  if (room.status === 'closed') return <RoomProblem code="ROOM_CLOSED" />;
  if (room.status === 'expired') return <RoomProblem code="ROOM_EXPIRED" />;
  if (room.locked) return <RoomProblem code="ROOM_LOCKED" />;
  if (room.full) return <RoomProblem code="ROOM_FULL" message={`All ${room.maxMembers} places are taken.`} />;

  return (
    <div className="form-page" style={{ maxWidth: 520 }}>
      <p className="muted" style={{ marginBottom: 'var(--s2)' }}>{room.hostName} invited you to</p>
      <h1>{room.name}</h1>
      <div className="panel panel-pad" style={{ marginTop: 'var(--s5)', display: 'grid', gap: 'var(--s4)' }}>
        <div className="code-display" aria-label={`Room code ${room.code.split('').join(' ')}`}>{room.code}</div>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 20px', fontSize: 'var(--t-sm)' }}>
          <dt className="faint">Watching</dt>
          <dd style={{ margin: 0 }}>{room.nowPlaying || 'Nothing yet'}</dd>
          <dt className="faint">People</dt>
          <dd style={{ margin: 0 }} className="tnum">{room.memberCount} of {room.maxMembers}</dd>
        </dl>
        <Button variant="primary" size="lg" block loading={joining} onClick={join}>Join room</Button>
      </div>
    </div>
  );
}

export default function JoinRoom() {
  const { code } = useParams();
  if (!code) return <CodeForm />;
  const c = clean(code);
  if (!CODE_RE.test(c)) return <RoomProblem code="ROOM_NOT_FOUND" />;
  return <JoinPreview key={c} code={c} />;
}
