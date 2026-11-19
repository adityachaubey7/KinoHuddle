import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import TitleCard from '../components/TitleCard.jsx';
import { Button, ButtonLink, State, Thumb } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useWatchlist } from '../context/WatchlistContext.jsx';
import { useCatalog } from '../lib/useCatalog.js';

const FEATURED = 'spring';
const CATS = [
  ['all', 'All'],
  ['movies', 'Movies'],
  ['anime', 'Anime'],
  ['cartoons', 'Cartoons'],
];

/** Bulb positions around the marquee frame, as percentages. */
function bulbs() {
  const out = [];
  const top = 16;
  const side = 5;
  for (let i = 0; i < top; i++) out.push({ left: `${(i / (top - 1)) * 100}%`, top: '0%' });
  for (let i = 1; i <= side; i++) out.push({ left: '100%', top: `${(i / (side + 1)) * 100}%` });
  for (let i = top - 1; i >= 0; i--) out.push({ left: `${(i / (top - 1)) * 100}%`, top: '100%' });
  for (let i = side; i >= 1; i--) out.push({ left: '0%', top: `${(i / (side + 1)) * 100}%` });
  return out;
}
const BULBS = bulbs();

function Hero({ featured }) {
  const { user } = useAuth();
  return (
    <section className="hero" aria-labelledby="hero-title">
      {featured && (
        <div className="hero-media" aria-hidden="true">
          <Thumb id={featured.youtubeId} eager />
        </div>
      )}
      <div className="hero-inner">
        <div className="marquee">
          <div className="marquee-bulbs" aria-hidden="true">
            {BULBS.map((b, i) => (
              <span key={i} style={{ left: b.left, top: b.top, '--i': i, transform: 'translate(-50%, -50%)' }} />
            ))}
          </div>
          <h1 id="hero-title">
            <span>Same film.</span>
            <span>Same second.</span>
            <span>Different couches.</span>
          </h1>
        </div>
        <p className="hero-copy">
          Open a private room, send the link, and everyone’s player stays on the same frame. Pause for snacks, rewind the good part, and talk it through in chat while it plays.
        </p>
        <div className="hero-actions">
          <ButtonLink to="/discover" variant="primary" size="lg" icon="globe">
            Join a free room
          </ButtonLink>
          <ButtonLink to={user ? '/rooms/new' : '/signup'} size="lg" icon="plus">
            Start a room
          </ButtonLink>
          <ButtonLink to="/join" variant="ghost" size="lg">
            Join with a code
          </ButtonLink>
        </div>
        {featured && (
          <div className="hero-feature">
            <Icon name="film" size={18} />
            <span>
              Tonight’s pick: <strong>{featured.title}</strong>, {featured.year}, {featured.minutes} min.{' '}
              <Link to={`/title/${featured.slug}`}>See details</Link>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ['Open a room', 'Pick something from the catalog or paste any YouTube link. You get a private room with its own code.'],
    ['Share the link', 'Friends open the invite, sign in, and land in the same room. You can see who’s here and who dropped off.'],
    ['Press play once', 'Play, pause and seek reach everyone at once. Players that drift more than a second get pulled back in line.'],
  ];
  return (
    <section className="how" aria-label="How SyncSpace works">
      {steps.map(([h, p], i) => (
        <div className="how-step" key={h}>
          <span className="num" aria-hidden="true">{i + 1}</span>
          <div>
            <h3>{h}</h3>
            <p>{p}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

function WatchlistBand({ items }) {
  const { list } = useWatchlist();
  const saved = list.map((s) => items.find((t) => t.slug === s)).filter(Boolean);
  if (!saved.length) return null;
  return (
    <section className="watchlist-band" aria-labelledby="wl-title">
      <div className="section-head">
        <h2 id="wl-title" className="section-title" style={{ fontSize: 'var(--t-2xl)' }}>Your watchlist</h2>
        <Link to="/watchlist">See all {saved.length}</Link>
      </div>
      <div className="rail">
        {saved.map((t) => <TitleCard key={t.slug} title={t} />)}
      </div>
    </section>
  );
}

export default function Home() {
  const { status, items, genres, error, retry } = useCatalog();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const category = params.get('category') || 'all';
  const genre = params.get('genre') || 'all';
  const length = params.get('length') || 'any';
  const sort = params.get('sort') || 'featured';

  const set = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (!value || value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const results = useMemo(() => {
    let r = items.slice();
    if (category !== 'all') r = r.filter((t) => t.category === category);
    if (genre !== 'all') r = r.filter((t) => t.genres.includes(genre));
    if (length === 'short') r = r.filter((t) => t.minutes < 5);
    if (length === 'medium') r = r.filter((t) => t.minutes >= 5);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((t) => [t.title, t.synopsis, t.channel, ...t.genres].some((s) => s.toLowerCase().includes(needle)));
    if (sort === 'newest') r.sort((a, b) => b.year - a.year);
    if (sort === 'oldest') r.sort((a, b) => a.year - b.year);
    if (sort === 'title') r.sort((a, b) => a.title.localeCompare(b.title));
    return r;
  }, [items, category, genre, length, q, sort]);

  const filtered = q || category !== 'all' || genre !== 'all' || length !== 'any';
  const featured = items.find((t) => t.slug === FEATURED);

  return (
    <>
      <Hero featured={featured} />
      <HowItWorks />
      {status === 'ready' && <WatchlistBand items={items} />}

      <section className="catalog" id="catalog" aria-labelledby="catalog-title">
        <div className="section-head">
          <div>
            <h2 id="catalog-title" className="section-title">What’s showing</h2>
            <p className="section-sub">
              Free films from Blender Studio’s open-movie archive, plus official anime trailers. Any YouTube link works in a room too.
            </p>
          </div>
        </div>

        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Category">
            {CATS.map(([value, label]) => (
              <button key={value} aria-pressed={category === value} onClick={() => set('category', value, 'all')}>
                {label}
              </button>
            ))}
          </div>
          <div className="toolbar-filters">
            <label className="sr-only" htmlFor="f-genre">Genre</label>
            <select id="f-genre" className="select" value={genre} onChange={(e) => set('genre', e.target.value, 'all')}>
              <option value="all">All genres</option>
              {genres.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <label className="sr-only" htmlFor="f-length">Length</label>
            <select id="f-length" className="select" value={length} onChange={(e) => set('length', e.target.value, 'any')}>
              <option value="any">Any length</option>
              <option value="short">Under 5 min</option>
              <option value="medium">5 min or more</option>
            </select>
            <label className="sr-only" htmlFor="f-sort">Sort by</label>
            <select id="f-sort" className="select" value={sort} onChange={(e) => set('sort', e.target.value, 'featured')}>
              <option value="featured">Featured</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>
          <div className="search" role="search">
            <Icon name="search" size={19} />
            <label className="sr-only" htmlFor="f-q">Search titles</label>
            <input
              id="f-q"
              className="input"
              type="search"
              placeholder="Search by title, genre or studio"
              value={q}
              onChange={(e) => set('q', e.target.value, '')}
              autoComplete="off"
            />
            {q && (
              <button className="btn btn-quiet btn-sm clear" onClick={() => set('q', '', '')}>
                Clear
              </button>
            )}
          </div>
        </div>

        {status === 'loading' && (
          <div className="grid" aria-busy="true" aria-label="Loading titles">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <div className="skeleton" style={{ aspectRatio: '16/9' }} />
                <div className="skeleton" style={{ height: 14, width: '60%', marginTop: 12 }} />
              </div>
            ))}
          </div>
        )}
        {status === 'error' && (
          <State icon="wifiOff" title="Couldn’t load the catalog" actions={<Button onClick={retry}>Try again</Button>}>
            {error}
          </State>
        )}
        {status === 'ready' && (
          <>
            <p className="result-meta" aria-live="polite">
              {filtered ? `${results.length} of ${items.length} titles` : `${items.length} titles`}
            </p>
            {results.length ? (
              <div className="grid">
                {results.map((t) => <TitleCard key={t.slug} title={t} />)}
              </div>
            ) : (
              <State
                icon="search"
                title={q ? `Nothing matches “${q}”` : 'No titles match these filters'}
                actions={<Button onClick={() => setParams({}, { replace: true, preventScrollReset: true })}>Clear filters</Button>}
              >
                Try a different word or loosen a filter. You can also paste any YouTube link when you create a room.
              </State>
            )}
          </>
        )}
      </section>
    </>
  );
}
