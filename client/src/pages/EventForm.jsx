import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Field, PageLoading, State, Switch, ButtonLink } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { fromInputValue, localZone, toInputValue } from '../lib/format.js';
import { parseYouTube } from '../lib/youtube.js';

const TOPICS = ['general', 'movies', 'anime', 'cartoons', 'music', 'sports', 'gaming'];
const DURATIONS = [[60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']];
const REMINDERS = [[5, '5 minutes before'], [15, '15 minutes before'], [60, '1 hour before'], [1440, '1 day before']];

/** Create (/events/new) or edit (/events/:id/edit) a scheduled watch party. */
export default function EventForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const zone = localZone();
  const [loaded, setLoaded] = useState(editing ? 'loading' : 'ready');
  const [form, setForm] = useState(() => {
    const start = new Date(Date.now() + 24 * 3600 * 1000);
    start.setMinutes(0, 0, 0);
    return {
      title: '', description: '', start: toInputValue(start), durationMinutes: 120, reminderLeadMinutes: 15,
      visibility: 'private', maxMembers: 10, guestControl: false, topic: 'general', videoUrl: '',
    };
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    api.get(`/events/${id}`)
      .then(({ event }) => {
        if (!event.isHost || event.phase === 'completed' || event.status === 'cancelled') return setLoaded('blocked');
        setForm((f) => ({ ...f, title: event.title, description: event.description, start: toInputValue(event.startsAt), durationMinutes: event.durationMinutes, reminderLeadMinutes: event.reminderLeadMinutes, visibility: event.visibility }));
        setLoaded('ready');
      })
      .catch(() => setLoaded('blocked'));
  }, [editing, id]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (form.title.trim().length < 2) errs.title = 'Use at least 2 characters.';
    if (!form.start || Number.isNaN(new Date(form.start).getTime())) errs.start = 'Choose a date and time.';
    else if (new Date(form.start).getTime() < Date.now() + 60_000) errs.start = 'Pick a time in the future.';
    if (!editing && form.videoUrl.trim() && !parseYouTube(form.videoUrl)) errs.videoUrl = 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…';
    if (!editing && !(Number(form.maxMembers) >= 2 && Number(form.maxMembers) <= 50)) errs.maxMembers = 'Choose between 2 and 50 people.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim(),
        startsAt: fromInputValue(form.start), // the wall-clock time you typed, converted to an exact UTC instant
        timeZone: zone,
        durationMinutes: Number(form.durationMinutes),
        reminderLeadMinutes: Number(form.reminderLeadMinutes),
      };
      const d = editing
        ? await api.patch(`/events/${id}`, body)
        : await api.post('/events', { ...body, visibility: form.visibility, maxMembers: Number(form.maxMembers), guestControl: form.guestControl, topic: form.topic, videoUrl: form.videoUrl.trim() });
      toast(editing ? 'Watch party updated' : 'Watch party scheduled');
      navigate(`/events/${d.event.id}`, { replace: editing });
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(Object.keys(err.fields || {}).length ? '' : err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loaded === 'loading') return <PageLoading label="Loading watch party" />;
  if (loaded === 'blocked') {
    return <State icon="lock" title="You can’t edit this watch party" actions={<ButtonLink to="/events" variant="primary">Back to watch parties</ButtonLink>}>Only the organiser can edit an upcoming party.</State>;
  }

  return (
    <div className="form-page">
      <h1>{editing ? 'Edit watch party' : 'Schedule a watch party'}</h1>
      <p className="lede">{editing ? 'Changes notify everyone who said they’re going.' : 'Pick a time. SyncSpace opens the room 15 minutes before and reminds people who are going.'}</p>
      <form onSubmit={submit} noValidate>
        {formError && <p className="form-alert" role="alert" style={{ marginBottom: 'var(--s4)' }}>{formError}</p>}
        <section className="form-section">
          <Field label="Title" error={errors.title}>
            {(p) => <input {...p} className="input" maxLength={80} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Friday movie night" />}
          </Field>
          <Field label="Description (optional)" error={errors.description}>
            {(p) => <textarea {...p} className="textarea" maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} />}
          </Field>
        </section>

        <section className="form-section">
          <h2>When</h2>
          <div className="field-row">
            <Field label="Start" error={errors.startsAt || errors.start} hint={`Your time zone: ${zone}. Everyone sees it in their own.`}>
              {(p) => <input {...p} className="input" type="datetime-local" value={form.start} onChange={(e) => set('start', e.target.value)} />}
            </Field>
            <Field label="Expected length" error={errors.durationMinutes}>
              {(p) => <select {...p} className="select" value={form.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)}>{DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
            </Field>
          </div>
          <Field label="Remind people" error={errors.reminderLeadMinutes}>
            {(p) => <select {...p} className="select" value={form.reminderLeadMinutes} onChange={(e) => set('reminderLeadMinutes', e.target.value)}>{REMINDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          </Field>
        </section>

        {!editing && (
          <section className="form-section">
            <h2>Room</h2>
            <div className="field-row">
              <Field label="Who can find it">
                {(p) => (
                  <select {...p} className="select" value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
                    <option value="private">Private: invite link only</option>
                    <option value="public">Public: listed for everyone</option>
                  </select>
                )}
              </Field>
              <Field label="Capacity" error={errors.maxMembers}>
                {(p) => <input {...p} className="input" type="number" min={2} max={50} value={form.maxMembers} onChange={(e) => set('maxMembers', e.target.value)} />}
              </Field>
            </div>
            {form.visibility === 'public' && (
              <Field label="Topic">
                {(p) => <select {...p} className="select" value={form.topic} onChange={(e) => set('topic', e.target.value)}>{TOPICS.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>}
              </Field>
            )}
            <Field label="First video (optional)" hint="You can also use the shared queue once everyone is in." error={errors.videoUrl}>
              {(p) => <input {...p} className="input" placeholder="https://youtu.be/…" value={form.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} />}
            </Field>
            <div style={{ marginTop: 'var(--s4)' }}>
              <Switch checked={form.guestControl} onChange={(v) => set('guestControl', v)} label="Everyone controls playback" description="Off: only you can play, pause and seek." />
            </div>
          </section>
        )}

        <div className="form-actions">
          <Button type="submit" variant="primary" size="lg" loading={saving}>{editing ? 'Save changes' : 'Schedule party'}</Button>
          <Button type="button" variant="quiet" size="lg" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
