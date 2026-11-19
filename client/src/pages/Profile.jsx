import { useEffect, useState } from 'react';
import { Avatar, Button, Field } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

const COLORS = ['#F2B33D', '#5CC8B8', '#E86A5C', '#8F9BFF', '#C68AE8', '#7BC96F'];

export default function Profile() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ displayName: user.displayName, bio: user.bio || '', avatarColor: user.avatarColor });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rooms, setRooms] = useState(null);

  useEffect(() => {
    api.get('/rooms').then((d) => setRooms(d.rooms)).catch(() => setRooms([]));
  }, []);

  const dirty = form.displayName !== user.displayName || form.bio !== (user.bio || '') || form.avatarColor !== user.avatarColor;

  const save = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (form.displayName.trim().length < 2) errs.displayName = 'Use at least 2 characters.';
    if (form.bio.length > 160) errs.bio = 'Use 160 characters or fewer.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const d = await api.patch('/users/me', { displayName: form.displayName.trim(), bio: form.bio.trim(), avatarColor: form.avatarColor });
      setUser(d.user);
      toast('Profile saved');
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(Object.keys(err.fields || {}).length ? '' : err.message);
    } finally {
      setSaving(false);
    }
  };

  const hosted = rooms?.filter((r) => r.isHost).length ?? '–';
  const joined = rooms?.length ?? '–';

  return (
    <div className="form-page">
      <div className="profile-head">
        <Avatar user={{ ...user, ...form }} size={84} />
        <div>
          <h1 style={{ marginBottom: 4 }}>{form.displayName || user.displayName}</h1>
          <p className="muted">Member since {new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}</p>
          <div className="stat-row">
            <span><strong className="tnum">{joined}</strong>rooms joined</span>
            <span><strong className="tnum">{hosted}</strong>hosted</span>
            <span><strong className="tnum">{user.watchlist.length}</strong>saved titles</span>
          </div>
        </div>
      </div>

      <form className="panel panel-pad" onSubmit={save} noValidate>
        {formError && <p className="form-alert" role="alert" style={{ marginBottom: 'var(--s4)' }}>{formError}</p>}
        <Field label="Display name" hint="This is how you appear in rooms and chat." error={errors.displayName}>
          {(p) => <input {...p} className="input" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
        </Field>
        <Field label="About you" hint={`${form.bio.length}/160`} error={errors.bio}>
          {(p) => <textarea {...p} className="textarea" maxLength={160} placeholder="Favourite films, comfort shows, snack of choice…" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />}
        </Field>
        <div className="field" style={{ marginTop: 'var(--s4)' }}>
          <span className="label" id="color-label">Avatar colour</span>
          <div className="swatches" role="radiogroup" aria-labelledby="color-label">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={form.avatarColor === c}
                aria-label={`Colour ${c}`}
                className="swatch"
                style={{ background: c }}
                onClick={() => setForm({ ...form, avatarColor: c })}
              />
            ))}
          </div>
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save profile</Button>
          {dirty && (
            <Button type="button" variant="quiet" onClick={() => setForm({ displayName: user.displayName, bio: user.bio || '', avatarColor: user.avatarColor })}>
              Discard changes
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
