export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function timeOfDay(date) {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function relative(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  const days = Math.round(diff / 86400);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function until(date) {
  const diff = (new Date(date).getTime() - Date.now()) / 1000;
  if (diff <= 0) return 'now';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min`;
  return `${Math.round(diff / 3600)} h`;
}

export const categoryLabel = { movies: 'Movies', anime: 'Anime', cartoons: 'Cartoons' };

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';

/** The viewer's own IANA time zone, e.g. "Asia/Kolkata". Events are stored in UTC and shown in this zone. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** "Sat, 14 Nov · 8:30 PM" in the viewer's time zone (or the one given). */
export function formatWhen(iso, timeZone) {
  const d = new Date(iso);
  const opts = timeZone ? { timeZone } : {};
  const day = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...opts });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...opts });
  return `${day} · ${time}`;
}

export const zoneAbbr = (iso, timeZone) =>
  new Intl.DateTimeFormat([], { timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) })
    .formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value || '';

/** Value for <input type="datetime-local"> in the viewer's local time. */
export function toInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local wall-clock text from <input type="datetime-local"> → an ISO instant in UTC. */
export const fromInputValue = (v) => (v ? new Date(v).toISOString() : '');

/** "in 3 days", "in 25 min", "started 5 min ago" */
export function countdown(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const text = abs < 90 ? 'a moment' : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 86400 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} day${Math.round(abs / 86400) > 1 ? 's' : ''}`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}
