import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Button, Field, Modal, Thumb } from '../../components/ui.jsx';
import { useWatchlist } from '../../context/WatchlistContext.jsx';
import { useCatalog } from '../../lib/useCatalog.js';
import { parseYouTube } from '../../lib/youtube.js';

/** Inline form used on the empty stage. */
export function LinkForm({ onLoad, onBrowse }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!parseYouTube(link)) return setError('Use a YouTube link like youtube.com/watch?v=… or youtu.be/…');
    setLoading(true);
    const res = await onLoad(link.trim());
    setLoading(false);
    if (!res?.ok) setError(res?.error?.message || 'Couldn’t load that video.');
  };
  return (
    <div className="inner" style={{ maxWidth: 560, width: '100%' }}>
      <h2>Pick something to watch</h2>
      <p>Paste a YouTube link or choose from the catalog. Everyone here will see it straight away.</p>
      <form className="stage-empty-form" onSubmit={submit} noValidate>
        <label className="sr-only" htmlFor="stage-link">YouTube link</label>
        <input
          id="stage-link"
          className="input"
          placeholder="https://youtu.be/…"
          value={link}
          aria-invalid={error ? 'true' : undefined}
          onChange={(e) => {
            setLink(e.target.value);
            setError('');
          }}
        />
        <Button type="submit" variant="primary" loading={loading}>Play</Button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      <Button variant="quiet" icon="film" onClick={onBrowse}>Browse the catalog</Button>
    </div>
  );
}

export default function VideoPicker({ onLoad, onClose }) {
  const { items } = useCatalog();
  const { list } = useWatchlist();
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(null);

  const ordered = [...items.filter((t) => list.includes(t.slug)), ...items.filter((t) => !list.includes(t.slug))];

  const load = async (value, title, key) => {
    setLoading(key);
    const res = await onLoad(value, title);
    setLoading(null);
    if (res?.ok) onClose();
    else setError(res?.error?.message || 'Couldn’t load that video.');
  };

  return (
    <Modal title="Change video" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 'var(--s4)' }}>The new video starts paused at the beginning for everyone.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!parseYouTube(link)) return setError('Use a YouTube link like youtube.com/watch?v=… or youtu.be/…');
          load(link.trim(), undefined, 'link');
        }}
        noValidate
      >
        <Field label="YouTube link" error={error}>
          {(p) => (
            <div style={{ display: 'flex', gap: 8 }}>
              <input {...p} className="input" placeholder="https://www.youtube.com/watch?v=…" value={link} onChange={(e) => { setLink(e.target.value); setError(''); }} />
              <Button type="submit" variant="primary" loading={loading === 'link'}>Load</Button>
            </div>
          )}
        </Field>
      </form>
      <div className="or">or choose from the catalog</div>
      <div className="picker" style={{ maxHeight: 300 }}>
        {ordered.map((t) => (
          <button key={t.slug} type="button" className="pick" disabled={Boolean(loading)} onClick={() => load(t.youtubeId, t.title, t.slug)}>
            <span className="pick-media">
              <Thumb id={t.youtubeId} quality="mqdefault" />
              {loading === t.slug && <span className="pick-check"><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /></span>}
              {list.includes(t.slug) && loading !== t.slug && <span className="pick-check" title="On your watchlist"><Icon name="bookmarkFill" size={12} /></span>}
            </span>
            <span className="pick-title">{t.title}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
