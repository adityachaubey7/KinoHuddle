import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { relative } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

const ACTION_TEXT = {
  mute: 'muted', unmute: 'unmuted', ban: 'banned', unban: 'unbanned', remove: 'removed', promote: 'made moderator', demote: 'removed as moderator',
  slow_mode: 'changed slow mode', report_dismissed: 'dismissed a report about', report_actioned: 'acted on a report about', queue_remove: 'removed a queued video from',
};
const REASON = { spam: 'Spam', harassment: 'Harassment', hate: 'Hateful content', inappropriate: 'Inappropriate', other: 'Other' };

/** Reports, current restrictions and the audit log. Only opened for the host and moderators. */
export default function ModerationPanel({ code, isHost, onClose }) {
  const { toast, error } = useToast();
  const [state, setState] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const [reports, overview, log] = await Promise.all([
        api.get(`/rooms/${code}/reports?status=open`),
        api.get(`/rooms/${code}/moderation`),
        api.get(`/rooms/${code}/moderation/log?limit=15`),
      ]);
      setState({ status: 'ready', reports: reports.reports, ...overview, log: log.log });
    } catch (e) {
      setState({ status: 'error', message: e.message });
    }
  }, [code]);
  useEffect(() => { load(); }, [load]);

  const act = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      toast(success);
      await load();
    } catch (e) {
      error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const review = (r, body, success) => act(r.id, () => api.post(`/rooms/${code}/reports/${r.id}`, body), success);

  return (
    <Modal title="Moderation" wide onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {state.status === 'loading' && <div style={{ padding: 24, textAlign: 'center' }}><Spinner label="Loading moderation tools" /></div>}
      {state.status === 'error' && <><p className="field-error">{state.message}</p><Button onClick={load}>Try again</Button></>}
      {state.status === 'ready' && (
        <>
          <section className="mod-section" aria-labelledby="mod-reports">
            <h3 id="mod-reports">Open reports ({state.reports.length})</h3>
            {!state.reports.length && <p className="muted">Nothing to review.</p>}
            {state.reports.map((r) => (
              <div key={r.id} className="mod-row" style={{ display: 'block' }}>
                <div><strong>{r.target.displayName}</strong> <span className="chip chip-warn">{REASON[r.reason]}</span> <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>reported by {r.reporter.displayName} · {relative(r.createdAt)}</span></div>
                {r.messageText && <blockquote className="mod-quote">{r.messageText}</blockquote>}
                {r.details && <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>“{r.details}”</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <Button size="sm" variant="quiet" loading={busy === r.id} onClick={() => review(r, { decision: 'dismiss' }, 'Report dismissed')}>Dismiss</Button>
                  <Button size="sm" loading={busy === r.id} onClick={() => review(r, { decision: 'action', action: 'mute', minutes: 60 }, 'Muted for 1 hour')}>Mute 1 h</Button>
                  <Button size="sm" variant="danger" loading={busy === r.id} onClick={() => review(r, { decision: 'action', action: 'ban', minutes: 1440 }, 'Banned for 24 hours')}>Ban 24 h</Button>
                </div>
              </div>
            ))}
          </section>

          <section className="mod-section" aria-labelledby="mod-restrictions">
            <h3 id="mod-restrictions">Restrictions</h3>
            {!state.muted.length && !state.banned.length && <p className="muted">Nobody is muted or banned.</p>}
            {state.muted.map((m) => (
              <div key={`m${m.id}`} className="mod-row">
                <span><strong>{m.displayName}</strong> <span className="chip">Muted{m.until ? ` until ${new Date(m.until).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span></span>
                <Button size="sm" loading={busy === `m${m.id}`} onClick={() => act(`m${m.id}`, () => api.post(`/rooms/${code}/unmute`, { userId: m.id }), 'Unmuted')}>Unmute</Button>
              </div>
            ))}
            {state.banned.map((b) => (
              <div key={`b${b.id}`} className="mod-row">
                <span><strong>{b.displayName}</strong> <span className="chip chip-bad">{b.until ? `Banned until ${new Date(b.until).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Banned'}</span></span>
                <Button size="sm" disabled={b.byHost && !isHost} title={b.byHost && !isHost ? 'Only the host can lift a ban the host issued' : undefined} loading={busy === `b${b.id}`} onClick={() => act(`b${b.id}`, () => api.post(`/rooms/${code}/unban`, { userId: b.id }), 'Ban lifted')}>Unban</Button>
              </div>
            ))}
          </section>

          <section className="mod-section" aria-labelledby="mod-log">
            <h3 id="mod-log">Recent actions</h3>
            {!state.log.length ? <p className="muted">No moderation actions yet.</p> : (
              <ul className="mod-log">
                {state.log.map((l) => (
                  <li key={l.id}><strong>{l.actor}</strong> {ACTION_TEXT[l.action] || l.action}{l.target ? ` ${l.target}` : ''} <span className="faint">· {relative(l.createdAt)}</span></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}
