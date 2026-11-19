import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import TitleCard from '../components/TitleCard.jsx';
import { Button, PageLoading, State, Thumb } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useWatchlist } from '../context/WatchlistContext.jsx';
import { api } from '../lib/api.js';
import { categoryLabel } from '../lib/format.js';

export default function TitleDetail() {
  const { slug } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  const [preview, setPreview] = useState(false);
  const { user } = useAuth();
  const { has, toggle } = useWatchlist();
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setPreview(false);
    api
      .get(`/catalog/${encodeURIComponent(slug)}`)
      .then((d) => live && setState({ status: 'ready', ...d }))
      .catch((e) => live && setState({ status: e.status === 404 ? 'missing' : 'error', error: e.message }));
    return () => {
      live = false;
    };
  }, [slug]);

  if (state.status === 'loading') return <PageLoading label="Loading title" />;
  if (state.status === 'missing')
    return (
      <State icon="film" title="That title isn’t in the catalog" actions={<Link className="btn btn-primary" to="/">Browse titles</Link>}>
        It may have been removed, or the link is mistyped.
      </State>
    );
  if (state.status === 'error')
    return <State icon="wifiOff" title="Couldn’t load this title" actions={<Button onClick={() => navigate(0)}>Try again</Button>}>{state.error}</State>;

  const { item, related } = state;
  const saved = has(item.slug);
  const startRoom = () => {
    const target = `/rooms/new?title=${item.slug}`;
    if (user) navigate(target);
    else navigate('/signin', { state: { from: target, reason: 'Sign in to start a watch room.' } });
  };

  return (
    <>
      <section className="detail-hero">
        <div className="backdrop" aria-hidden="true">
          <Thumb id={item.youtubeId} eager />
        </div>
        <div className="detail-body">
          <Link to="/" className="btn btn-quiet btn-sm" style={{ justifySelf: 'start', marginLeft: -10 }}>
            <Icon name="arrowLeft" size={18} /> Browse
          </Link>
          <h1 className="detail-title">{item.title}</h1>
          <div className="detail-facts">
            <span className="chip">{categoryLabel[item.category]}</span>
            <span className="chip">{item.kind}</span>
            <span className="chip">{item.year}</span>
            <span className="chip">{item.minutes} min</span>
            {item.genres.map((g) => <span key={g} className="chip">{g}</span>)}
          </div>
          <p className="detail-synopsis">{item.synopsis}</p>
          <div className="detail-actions">
            <Button variant="primary" size="lg" icon="users" onClick={startRoom}>Watch together</Button>
            <Button variant="ghost" size="lg" icon={saved ? 'bookmarkFill' : 'bookmark'} aria-pressed={saved} onClick={() => toggle(item)}>
              {saved ? 'Saved' : 'Save to watchlist'}
            </Button>
            {!preview && (
              <Button variant="quiet" size="lg" icon="play" onClick={() => setPreview(true)}>Preview here</Button>
            )}
          </div>
          <p className="detail-source">From {item.channel} on YouTube.</p>
        </div>
      </section>

      {preview && (
        <section className="page" style={{ marginTop: 'var(--s5)' }} aria-label="Preview">
          <iframe
            className="preview-frame"
            src={`https://www.youtube-nocookie.com/embed/${item.youtubeId}?autoplay=1&rel=0`}
            title={`${item.title} preview`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </section>
      )}

      {related.length > 0 && (
        <section className="page" style={{ marginTop: 'var(--s8)' }} aria-labelledby="rel-title">
          <h2 id="rel-title" className="section-title" style={{ fontSize: 'var(--t-2xl)', marginBottom: 'var(--s5)' }}>
            More like this
          </h2>
          <div className="grid">
            {related.map((t) => <TitleCard key={t.slug} title={t} />)}
          </div>
        </section>
      )}
    </>
  );
}
