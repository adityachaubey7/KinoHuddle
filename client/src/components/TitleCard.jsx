import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Thumb } from './ui.jsx';
import { useWatchlist } from '../context/WatchlistContext.jsx';
import { categoryLabel } from '../lib/format.js';

export default function TitleCard({ title }) {
  const { has, toggle } = useWatchlist();
  const saved = has(title.slug);
  return (
    <article className="card">
      <Link to={`/title/${title.slug}`} className="card-media" aria-label={`${title.title}, ${title.kind.toLowerCase()}, ${title.year}`}>
        <Thumb id={title.youtubeId} quality="hqdefault" />
        {title.kind !== 'Short film' && (
          <span className="card-badge"><span className="chip">{title.kind}</span></span>
        )}
      </Link>
      <button
        className="card-save"
        aria-pressed={saved}
        aria-label={saved ? `Remove ${title.title} from watchlist` : `Save ${title.title} to watchlist`}
        onClick={() => toggle(title)}
      >
        <Icon name={saved ? 'bookmarkFill' : 'bookmark'} size={17} />
      </button>
      <div>
        <Link to={`/title/${title.slug}`} className="card-title" style={{ textDecoration: 'none' }}>{title.title}</Link>
        <div className="card-meta">
          {categoryLabel[title.category]}, {title.year}, {title.minutes} min
        </div>
      </div>
    </article>
  );
}
