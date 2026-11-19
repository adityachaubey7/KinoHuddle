import { Link } from 'react-router-dom';
import { countdown, formatWhen, zoneAbbr } from '../lib/format.js';

const PHASE = {
  upcoming: null,
  ongoing: <span className="chip chip-sync"><span className="dot" /> Happening now</span>,
  completed: <span className="chip">Finished</span>,
  cancelled: <span className="chip chip-bad">Cancelled</span>,
};

/** One watch party in a list. Dates are stored in UTC and rendered in the viewer's own time zone. */
export default function EventRow({ event }) {
  const d = new Date(event.startsAt);
  return (
    <Link className="event-row" to={`/events/${event.id}`}>
      <div className="event-date" aria-hidden="true">
        <span className="mon">{d.toLocaleDateString([], { month: 'short' })}</span>
        <span className="day">{d.getDate()}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="event-title">{event.title}</div>
        <div className="event-sub">
          <span>{formatWhen(event.startsAt)} {zoneAbbr(event.startsAt)}</span>
          {event.phase === 'upcoming' && <span>{countdown(event.startsAt)}</span>}
          <span>Hosted by {event.isHost ? 'you' : event.host.displayName}</span>
          <span>{event.goingCount} going</span>
        </div>
      </div>
      <div className="event-side">
        {event.isHost && <span className="chip chip-warn">Host</span>}
        {event.myRsvp === 'going' && !event.isHost && <span className="chip chip-sync">Going</span>}
        {event.myRsvp === 'not_going' && <span className="chip">Not going</span>}
        {event.invited && !event.myRsvp && <span className="chip chip-warn">Invited</span>}
        {event.visibility === 'public' && <span className="chip">Public</span>}
        {PHASE[event.phase]}
      </div>
    </Link>
  );
}
