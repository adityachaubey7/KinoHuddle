import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button, Field, Switch, Thumb } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useWatchlist } from '../context/WatchlistContext.jsx';
import { api } from '../lib/api.js';
import { useCatalog } from '../lib/useCatalog.js';
import { countryOptions, flag, guessCountry, guessLanguage, languageOptions, TOPICS, TOPIC_EMOJI, TOPIC_LABEL } from '../lib/geo.js';
import { parseYouTube } from '../lib/youtube.js';

export default function CreateRoom() {
  const { user } = useAuth();
  const { list } = useWatchlist();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { items } = useCatalog();

  const [name, setName] = useState(`${user.displayName.split(' ')[0]}’s room`);
  const [picked, setPicked] = useState(params.get('title') || '');
  const [link, setLink] = useState('');
  const [maxMembers, setMaxMembers] = useState(10);
  const [guestControl, setGuestControl] = useState(false);
  const [isPublic, setIsPublic] = useState(params.get('public') === '1');
  const [topic, setTopic] = useState('general');
  const [language, setLanguage] = useState(guessLanguage());
  const [country, setCountry] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  // Saved titles first, then the rest.
  const ordered = useMemo(() => {
    const saved = items.filter((t) => list.includes(t.slug));
    return [...saved, ...items.filter((t) => !list.includes(t.slug))];
  }, [items, list]);

  const linkId = parseYouTube(link);
  const pickedTitle = items.find((t) => t.slug === picked);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (name.trim().length < 2) errs.name = 'Use at least 2 characters.';
    if (link.trim() && !linkId) errs.videoUrl = 'Use a YouTube link like youtube.com/watch?v=… or youtu.be/…';
    const max = Number(maxMembers);
    if (!Number.isInteger(max) || max < 2 || max > 50) errs.maxMembers = 'Choose between 2 and 50 people.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = { name: name.trim(), maxMembers: max, guestControl };
    if (isPublic) Object.assign(body, { visibility: 'public', topic, language, country: country || null });
    if (link.trim()) body.videoUrl = link.trim();
    else if (pickedTitle) {
      body.videoUrl = pickedTitle.youtubeId;
      body.videoTitle = pickedTitle.title;
    }
    setLoading(true);
    try {
      const { room } = await api.post('/rooms', body);
      navigate(`/room/${room.code}`, { state: { justCreated: true } });
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(Object.keys(err.fields || {}).length ? '' : err.message);
      setLoading(false);
    }
  };

  return (
    <div className="form-page">
      <h1>New room</h1>
      <p className="lede">
        {isPublic
          ? 'Public rooms are listed on Discover. Anyone can join in one click, no code needed.'
          : 'Private rooms: only people with the code or invite link can join.'}
      </p>
      <form onSubmit={submit} noValidate className="panel panel-pad">
        {formError && <p className="form-alert" role="alert" style={{ marginBottom: 'var(--s4)' }}>{formError}</p>}
        <div className="form-section">
          <Field label="Room name" error={errors.name}>
            {(p) => <input {...p} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>

        <div className="form-section">
          <h2>What are you watching?</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 'var(--s4)' }}>
            Optional. You can choose or change the video once you’re in the room.
          </p>
          {ordered.length > 0 && (
            <div className="picker" role="group" aria-label="Pick from the catalog">
              {ordered.map((t) => {
                const on = picked === t.slug && !link.trim();
                return (
                  <button
                    type="button"
                    key={t.slug}
                    className="pick"
                    aria-pressed={on}
                    onClick={() => {
                      setPicked(on ? '' : t.slug);
                      setLink('');
                    }}
                  >
                    <span className="pick-media">
                      <Thumb id={t.youtubeId} quality="mqdefault" />
                      {on && <span className="pick-check"><Icon name="check" size={14} strokeWidth={2.6} /></span>}
                    </span>
                    <span className="pick-title">{t.title}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="or">or paste a link</div>
          <Field label="YouTube link" hint="youtube.com/watch?v=…, youtu.be/…, or /shorts/… links work." error={errors.videoUrl}>
            {(p) => (
              <input
                {...p}
                className="input"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  if (errors.videoUrl) setErrors({ ...errors, videoUrl: undefined });
                }}
              />
            )}
          </Field>
          {link.trim() && linkId && (
            <p className="form-alert info" style={{ marginTop: 'var(--s3)' }}>
              Video found. If its owner blocks embedding, the room will say so and you can pick another.
            </p>
          )}
        </div>

        <div className="form-section">
          <h2>Room rules</h2>
          <Field label="Maximum people" hint="Including you. Between 2 and 50." error={errors.maxMembers}>
            {(p) => (
              <input {...p} className="input" type="number" min={2} max={50} style={{ maxWidth: 140 }} value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} />
            )}
          </Field>
          <div style={{ marginTop: 'var(--s5)' }}>
            <Switch
              checked={guestControl}
              onChange={setGuestControl}
              label="Let everyone control playback"
              description="When off, only you can play, pause, seek or change the video."
            />
          </div>
        </div>

        <div className="form-section">
          <h2>Who can join?</h2>
          <Switch
            checked={isPublic}
            onChange={(v) => {
              setIsPublic(v);
              if (v && !country) setCountry(guessCountry());
            }}
            label="Make this room public"
            description="Listed on Discover for anyone, anywhere. Chat is visible to everyone in the room."
          />
          {isPublic && (
            <div className="public-fields">
              <Field label="Topic">
                {(p) => (
                  <select {...p} className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
                    {TOPICS.map((t) => <option key={t} value={t}>{TOPIC_EMOJI[t]} {TOPIC_LABEL[t]}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Language">
                {(p) => (
                  <select {...p} className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="multi">Everyone welcome</option>
                    {languageOptions().map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Country" hint="Optional. Helps people nearby find you.">
                {(p) => (
                  <select {...p} className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">🌍 Worldwide</option>
                    {countryOptions().map(([c, n]) => <option key={c} value={c}>{flag(c)} {n}</option>)}
                  </select>
                )}
              </Field>
            </div>
          )}
        </div>

        <div className="form-actions">
          <Button type="submit" variant="primary" size="lg" loading={loading}>{isPublic ? 'Create public room' : 'Create room'}</Button>
          <Button type="button" variant="quiet" size="lg" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
