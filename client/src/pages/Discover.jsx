import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button, State, Thumb } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { countryOptions, flag, languageName, languageOptions, TOPICS, TOPIC_EMOJI, TOPIC_LABEL, countryName } from '../lib/geo.js';
import { useLobby } from '../lib/useLobby.js';

const FILTER_KEYS = ['topic', 'language', 'country', 'q', 'hasSpace', 'playing', 'sort'];

function RoomCard({ room, onJoin, joining }) {
  const live = room.onlineCount > 0;
  const unavailable = room.full || room.locked;
  return (
    <article className={`dcard ${live ? 'is-live' : ''}`}>
      <div className="dcard-media">
        {room.nowPlaying ? <Thumb id={room.nowPlaying.videoId} quality="mqdefault" /> : <span className="dcard-empty" aria-hidden="true">{TOPIC_EMOJI[room.topic] || '🎬'}</span>}
        {live && (
          <span className="live-badge"><span className="live-dot" aria-hidden="true" />LIVE</span>
        )}
        <span className="dcard-count"><Icon name="users" size={14} />{room.onlineCount}<span className="sr-only"> watching now</span></span>
      </div>
      <div className="dcard-body">
        <div className="dcard-tags">
          <span className="chip">{TOPIC_EMOJI[room.topic]} {TOPIC_LABEL[room.topic] || room.topic}</span>
          <span className="chip" title={countryName(room.country)}>{flag(room.country)} {room.country || 'Worldwide'}</span>
          {room.language !== 'multi' && <span className="chip">{languageName(room.language)}</span>}
        </div>
        <h3 className="dcard-name" dir="auto">{room.name}</h3>
        <p className="dcard-now" dir="auto">
          {room.nowPlaying ? (room.isPlaying ? '▶ ' : '⏸ ') + (room.nowPlaying.title || 'YouTube video') : 'Nothing playing yet'}
        </p>
        <div className="dcard-foot">
          <span className="faint tnum">{room.memberCount}/{room.maxMembers} members</span>
          <Button
            variant="primary"
            size="sm"
            loading={joining}
            disabled={unavailable}
            onClick={() => onJoin(room)}
            aria-label={`Join ${room.name}`}
          >
            {room.full ? 'Full' : room.locked ? 'Locked' : 'Join'}
          </Button>
        </div>
      </div>
    </article>
  );
}

export default function Discover() {
  const { user } = useAuth();
  const { error: toastError } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', rooms: [], next: null, stats: null, error: '' });
  const [more, setMore] = useState(false);
  const [joining, setJoining] = useState('');
  const [quick, setQuick] = useState(false);
  const [search, setSearch] = useState(params.get('q') || '');
  const [attempt, setAttempt] = useState(0);
  const reqId = useRef(0);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const qs = FILTER_KEYS.filter((k) => filters[k]).map((k) => `${k}=${encodeURIComponent(filters[k])}`).join('&');

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Debounced search box -> URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') || '') !== search.trim()) setFilter('q', search.trim());
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const id = ++reqId.current;
    setState((s) => ({ ...s, status: s.rooms.length ? 'refreshing' : 'loading' }));
    api
      .get(`/rooms/public?limit=12${qs ? `&${qs}` : ''}`)
      .then((d) => id === reqId.current && setState({ status: 'ready', rooms: d.rooms, next: d.nextCursor, stats: d.stats, error: '' }))
      .catch((e) => id === reqId.current && setState({ status: 'error', rooms: [], next: null, stats: null, error: e.message }));
  }, [qs, attempt]);

  const loadMore = async () => {
    setMore(true);
    try {
      const d = await api.get(`/rooms/public?limit=12&cursor=${state.next}${qs ? `&${qs}` : ''}`);
      setState((s) => ({
        ...s,
        rooms: [...s.rooms, ...d.rooms.filter((r) => !s.rooms.some((x) => x.code === r.code))],
        next: d.nextCursor,
      }));
    } catch (e) {
      toastError(e.message);
    }
    setMore(false);
  };

  // Live counts and now-playing while the page is open.
  const onUpdate = useCallback((card) => {
    setState((s) => ({
      ...s,
      rooms: s.rooms.map((r) => (r.code === card.code ? card : r)),
      stats: s.stats,
    }));
  }, []);
  const onRemove = useCallback(({ code }) => {
    setState((s) => ({ ...s, rooms: s.rooms.filter((r) => r.code !== code) }));
  }, []);
  useLobby(Boolean(user), { onUpdate, onRemove });

  const needSignIn = () =>
    navigate('/signin', { state: { from: `/discover${qs ? `?${qs}` : ''}`, reason: 'Sign in (it’s free) to jump into a room.' } });

  const join = async (room) => {
    if (!user) return needSignIn();
    setJoining(room.code);
    try {
      await api.post(`/rooms/${room.code}/join-public`);
      navigate(`/room/${room.code}`);
    } catch (e) {
      toastError(e.message);
      setJoining('');
    }
  };

  const quickJoin = async () => {
    if (!user) return needSignIn();
    setQuick(true);
    try {
      const body = {};
      if (filters.language) body.language = filters.language;
      if (filters.topic) body.topic = filters.topic;
      if (filters.country) body.country = filters.country;
      const { room } = await api.post('/rooms/public/quick-join', body);
      navigate(`/room/${room.code}`);
    } catch (e) {
      toastError(e.message);
      setQuick(false);
    }
  };

  const total = state.stats;
  const hasFilters = FILTER_KEYS.some((k) => k !== 'sort' && filters[k]);

  return (
    <>
      <section className="disc-hero">
        <div className="disc-hero-inner">
          <p className="eyebrow">🌍 Free public rooms</p>
          <h1>Watch together, <em>anywhere.</em></h1>
          <p className="disc-lede">
            No codes, no invite links. Pick a room, press join, and you’re watching in sync with people from around the world.
          </p>
          <div className="hero-actions">
            <Button variant="primary" size="lg" icon="play" loading={quick} onClick={quickJoin} className="glow">
              Join a free room
            </Button>
            <Button size="lg" onClick={() => navigate(user ? '/rooms/new?public=1' : '/signup')} icon="plus">
              Host your own
            </Button>
          </div>
          {total && (
            <p className="disc-ticker" aria-live="polite">
              <span className="live-dot" aria-hidden="true" />
              <strong className="tnum">{total.watching}</strong> watching now across <strong className="tnum">{total.rooms}</strong> public rooms
            </p>
          )}
        </div>
      </section>

      <div className="page disc-body">
        <div className="disc-filters" role="search">
          <div className="disc-search">
            <Icon name="search" size={18} />
            <label htmlFor="disc-q" className="sr-only">Search rooms</label>
            <input id="disc-q" className="input" type="search" placeholder="Search rooms" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="sr-only" htmlFor="f-topic">Topic</label>
          <select id="f-topic" className="select" value={filters.topic} onChange={(e) => setFilter('topic', e.target.value)}>
            <option value="">All topics</option>
            {TOPICS.map((t) => <option key={t} value={t}>{TOPIC_EMOJI[t]} {TOPIC_LABEL[t]}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-lang">Language</label>
          <select id="f-lang" className="select" value={filters.language} onChange={(e) => setFilter('language', e.target.value)}>
            <option value="">Any language</option>
            <option value="multi">Everyone welcome</option>
            {languageOptions().map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-country">Country</label>
          <select id="f-country" className="select" value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
            <option value="">All countries</option>
            {countryOptions().map(([c, n]) => <option key={c} value={c}>{flag(c)} {n}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-sort">Sort</label>
          <select id="f-sort" className="select" value={filters.sort || 'active'} onChange={(e) => setFilter('sort', e.target.value === 'active' ? '' : e.target.value)}>
            <option value="active">Most active</option>
            <option value="newest">Newest</option>
          </select>
        </div>
        <div className="disc-toggles">
          <button type="button" className="pill" aria-pressed={filters.hasSpace === 'true'} onClick={() => setFilter('hasSpace', filters.hasSpace === 'true' ? '' : 'true')}>Has space</button>
          <button type="button" className="pill" aria-pressed={filters.playing === 'true'} onClick={() => setFilter('playing', filters.playing === 'true' ? '' : 'true')}>Playing now</button>
          {hasFilters && (
            <button type="button" className="pill pill-clear" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>
              Clear filters
            </button>
          )}
        </div>

        {state.status === 'loading' && (
          <div className="disc-grid" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}
          </div>
        )}
        {state.status === 'error' && (
          <State icon="wifiOff" title="Couldn’t load public rooms" actions={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
            {state.error}
          </State>
        )}
        {(state.status === 'ready' || state.status === 'refreshing') && !state.rooms.length && (
          <State
            icon="globe"
            title={hasFilters ? 'No rooms match those filters' : 'No public rooms yet'}
            actions={
              <>
                {hasFilters && <Button onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button>}
                <Button variant="primary" onClick={() => navigate(user ? '/rooms/new?public=1' : '/signup')}>Start one</Button>
              </>
            }
          >
            {hasFilters ? 'Try a different language or country, or be the first to start one.' : 'Be the first. Start a free public room and let the world drop in.'}
          </State>
        )}
        {state.rooms.length > 0 && (
          <div className={`disc-grid ${state.status === 'refreshing' ? 'is-stale' : ''}`}>
            {state.rooms.map((r) => <RoomCard key={r.code} room={r} onJoin={join} joining={joining === r.code} />)}
          </div>
        )}
        {state.next && (
          <div style={{ textAlign: 'center', marginTop: 'var(--s6)' }}>
            <Button loading={more} onClick={loadMore}>Show more rooms</Button>
          </div>
        )}
        <p className="faint disc-note">
          Public rooms are visible to everyone in them, including chat. Be kind, and don’t share personal information.
        </p>
      </div>
    </>
  );
}
