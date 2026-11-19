import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, Button, State } from '../components/ui.jsx';
import EventRow from '../components/EventRow.jsx';
import { api } from '../lib/api.js';

const TABS = [
  ['upcoming', 'Upcoming', 'scope=mine&phase=upcoming'],
  ['past', 'Past', 'scope=mine&phase=past'],
  ['public', 'Public', 'scope=public'],
];

export default function Events() {
  const [tab, setTab] = useState('upcoming');
  const [state, setState] = useState({ status: 'loading', items: [], next: null });
  const [more, setMore] = useState(false);

  const load = useCallback(async (cursor = 0, append = false) => {
    const qs = TABS.find(([k]) => k === tab)[2];
    try {
      const d = await api.get(`/events?${qs}&limit=12&cursor=${cursor}`);
      setState((prev) => ({ status: 'ready', items: append ? [...prev.items, ...d.events] : d.events, next: d.nextCursor }));
    } catch (e) {
      setState({ status: 'error', message: e.message, items: [], next: null });
    }
  }, [tab]);

  useEffect(() => {
    setState({ status: 'loading', items: [], next: null });
    load();
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Watch parties</h1>
          <p>Plan a time, invite people, and get a reminder when it’s about to start.</p>
        </div>
        <ButtonLink to="/events/new" variant="primary" icon="plus">Schedule a party</ButtonLink>
      </div>

      <div className="dash-section" style={{ marginTop: 0 }}>
        <div className="segmented" role="group" aria-label="Which parties to show" style={{ marginBottom: 'var(--s5)' }}>
          {TABS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {state.status === 'loading' && (
          <div className="event-list" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
          </div>
        )}
        {state.status === 'error' && (
          <State icon="wifiOff" title="Couldn’t load watch parties" actions={<Button onClick={() => load()}>Try again</Button>}>{state.message}</State>
        )}
        {state.status === 'ready' && !state.items.length && (
          <State
            icon="calendar"
            title={tab === 'public' ? 'No public parties are scheduled' : tab === 'past' ? 'Nothing in your history yet' : 'No upcoming parties'}
            actions={tab !== 'past' && <ButtonLink to="/events/new" variant="primary">Schedule one</ButtonLink>}
          >
            {tab === 'public' ? 'When someone schedules a public party it shows up here.' : tab === 'past' ? 'Finished and cancelled parties you took part in appear here.' : 'Schedule a party, or ask a friend to invite you.'}
          </State>
        )}
        {state.items.length > 0 && (
          <div className="event-list">
            {state.items.map((e) => <EventRow key={e.id} event={e} />)}
          </div>
        )}
        {state.next && (
          <div style={{ textAlign: 'center', marginTop: 'var(--s5)' }}>
            <Button loading={more} onClick={async () => { setMore(true); await load(Number(state.next), true); setMore(false); }}>Show more</Button>
          </div>
        )}
      </div>
    </>
  );
}
