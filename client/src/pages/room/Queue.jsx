import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Button, Thumb } from '../../components/ui.jsx';
import { parseYouTube } from '../../lib/youtube.js';

/**
 * The room's shared watch queue. All data comes from the server's snapshot; every button sends a request
 * and the list only changes when the server broadcasts the result.
 */
export default function Queue({ queue, me, isHost, canModerate, canControl, offline, nowPlaying, onAdd, onVote, onRemove, onMove, onMode, onPlayNow, onSkip }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);

  if (!queue) return <div className="queue"><p className="queue-empty" style={{ margin: 'var(--s4)' }}>Loading the queue…</p></div>;

  const manual = queue.mode === 'manual';
  const items = queue.items;

  const add = async (e) => {
    e.preventDefault();
    if (!parseYouTube(url)) return setError('Use a YouTube link like youtube.com/watch?v=… or youtu.be/…');
    setAdding(true);
    const res = await onAdd(url.trim());
    setAdding(false);
    if (res?.ok) {
      setUrl('');
      setError('');
    } else setError(res?.error?.message || 'Couldn’t add that video.');
  };

  const run = async (key, fn) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  return (
    <div className="queue">
      <div className="queue-body">
        <section className="queue-section" aria-labelledby="q-now">
          <h3 id="q-now">Now playing</h3>
          {queue.current ? (
            <div className="queue-now">
              <div className="queue-thumb"><Thumb id={queue.current.videoId} quality="mqdefault" /></div>
              <div style={{ minWidth: 0 }}>
                <div className="queue-title">{nowPlaying || queue.current.title || 'YouTube video'}</div>
                {canControl && (
                  <Button size="sm" variant="quiet" icon="skip" style={{ marginTop: 4, paddingLeft: 0 }} disabled={offline || !items.length || busy === 'skip'} loading={busy === 'skip'} onClick={() => run('skip', onSkip)}>
                    {items.length ? 'Skip to next' : 'Nothing queued'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="queue-empty">Nothing is playing. Add a video and it starts right away.</p>
          )}
        </section>

        <section className="queue-section" aria-labelledby="q-add">
          <h3 id="q-add">Add to queue <span className="faint tnum" style={{ textTransform: 'none', letterSpacing: 0 }}>{items.length}/{queue.max}</span></h3>
          <form onSubmit={add} noValidate>
            <div className="queue-add">
              <label className="sr-only" htmlFor="queue-url">YouTube link to add to the queue</label>
              <input id="queue-url" className="input" placeholder="https://youtu.be/…" value={url} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'queue-err' : undefined} onChange={(e) => { setUrl(e.target.value); setError(''); }} />
              <Button type="submit" variant="primary" icon="plus" loading={adding} disabled={offline || !url.trim()}>Add</Button>
            </div>
            {error && <p id="queue-err" className="field-error" role="alert" style={{ marginTop: 6 }}>{error}</p>}
          </form>
        </section>

        <section className="queue-section" aria-labelledby="q-next">
          <h3 id="q-next">
            Up next
            {isHost && (
              <span className="segmented" role="group" aria-label="Queue order" style={{ padding: 2 }}>
                <button type="button" aria-pressed={!manual} onClick={() => onMode('votes')} disabled={offline} style={{ padding: '4px 10px', fontSize: 'var(--t-xs)' }}>By votes</button>
                <button type="button" aria-pressed={manual} onClick={() => onMode('manual')} disabled={offline} style={{ padding: '4px 10px', fontSize: 'var(--t-xs)' }}>Manual</button>
              </span>
            )}
          </h3>
          {!items.length ? (
            <p className="queue-empty">The queue is empty. Add something for everyone to watch next.</p>
          ) : (
            <>
              <p className="queue-hint" style={{ marginBottom: 'var(--s2)' }}>
                {manual ? 'The host sets the order.' : 'Most votes plays first; ties go to whoever added first.'}
              </p>
              <ol className="queue-list">
                {items.map((it, i) => {
                  const voted = it.voters.includes(me.id);
                  const mine = it.addedBy?.id === me.id;
                  return (
                    <li key={it.id} className={`queue-item ${i === 0 ? 'next' : ''}`}>
                      <span className="queue-pos" aria-label={`Position ${it.position}`}>{it.position}</span>
                      <div className="queue-thumb"><Thumb id={it.videoId} quality="mqdefault" /></div>
                      <div style={{ minWidth: 0 }}>
                        <div className="queue-title">{it.title || 'YouTube video'}</div>
                        <div className="queue-sub">Added by {mine ? 'you' : it.addedBy?.displayName || 'someone who left'}{it.pinned && !manual ? ' · Play next' : ''}</div>
                      </div>
                      <div className="queue-actions">
                        <button
                          className="vote-btn"
                          aria-pressed={voted}
                          aria-label={`${voted ? 'Remove your vote from' : 'Vote for'} ${it.title || 'this video'}, ${it.votes} vote${it.votes === 1 ? '' : 's'}`}
                          disabled={offline || busy === `v${it.id}`}
                          onClick={() => run(`v${it.id}`, () => onVote(it.id, !voted))}
                        >
                          <Icon name="thumb" size={14} /> {it.votes}
                        </button>
                        {canControl && <Button size="sm" variant="quiet" icon="play" disabled={offline} onClick={() => run(`p${it.id}`, () => onPlayNow(it.id))}>Play now</Button>}
                        {canModerate && !manual && i > 0 && <Button size="sm" variant="quiet" icon="arrowUp" disabled={offline} onClick={() => run(`m${it.id}`, () => onMove(it.id, 0))}>Play next</Button>}
                        {canModerate && manual && (
                          <>
                            <button className="btn btn-quiet btn-icon btn-sm" aria-label={`Move ${it.title || 'video'} up`} disabled={offline || i === 0} onClick={() => run(`m${it.id}`, () => onMove(it.id, i - 1))}><Icon name="arrowUp" size={16} /></button>
                            <button className="btn btn-quiet btn-icon btn-sm" aria-label={`Move ${it.title || 'video'} down`} disabled={offline || i === items.length - 1} onClick={() => run(`m${it.id}`, () => onMove(it.id, i + 1))}><Icon name="arrowDown" size={16} /></button>
                          </>
                        )}
                        {(canModerate || mine) && (
                          <button className="btn btn-quiet btn-icon btn-sm" aria-label={`Remove ${it.title || 'video'} from the queue`} disabled={offline} onClick={() => run(`r${it.id}`, () => onRemove(it.id))}><Icon name="trash" size={16} /></button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
