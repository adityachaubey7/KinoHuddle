import TitleCard from '../components/TitleCard.jsx';
import { Button, ButtonLink, PageLoading, State } from '../components/ui.jsx';
import { useWatchlist } from '../context/WatchlistContext.jsx';
import { useCatalog } from '../lib/useCatalog.js';

export default function Watchlist() {
  const { status, items, error, retry } = useCatalog();
  const { list } = useWatchlist();
  const saved = list.map((s) => items.find((t) => t.slug === s)).filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Watchlist</h1>
          <p>Titles you’ve saved for your next room.</p>
        </div>
      </div>
      <div className="page">
        {status === 'loading' && <PageLoading />}
        {status === 'error' && <State icon="wifiOff" title="Couldn’t load your watchlist" actions={<Button onClick={retry}>Try again</Button>}>{error}</State>}
        {status === 'ready' && !saved.length && (
          <State icon="bookmark" title="Nothing saved yet" actions={<ButtonLink to="/" variant="primary">Browse titles</ButtonLink>}>
            Use the bookmark on any title to keep it here.
          </State>
        )}
        {status === 'ready' && saved.length > 0 && (
          <div className="grid">
            {saved.map((t) => <TitleCard key={t.slug} title={t} />)}
          </div>
        )}
      </div>
    </>
  );
}
