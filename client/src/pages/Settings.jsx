import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Modal, Switch } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

function Preferences() {
  const { user, setUser } = useAuth();
  const { toast, error } = useToast();
  const prefs = user.preferences || {};
  const clearHistory = async () => {
    try {
      const d = await api.del('/users/me/history');
      toast(d.deleted ? 'Watch history cleared' : 'Your history was already empty');
    } catch (e) {
      error(e.message);
    }
  };
  const update = async (key, value) => {
    const prev = user;
    setUser({ ...user, preferences: { ...prefs, [key]: value } });
    try {
      const d = await api.patch('/users/me', { preferences: { [key]: value } });
      setUser(d.user);
      toast('Preference saved');
    } catch (e) {
      setUser(prev);
      error(e.message);
    }
  };
  return (
    <section className="form-section">
      <h2>Watching</h2>
      <div style={{ display: 'grid', gap: 'var(--s5)' }}>
        <Switch
          checked={prefs.showReactions !== false}
          onChange={(v) => update('showReactions', v)}
          label="Show floating reactions"
          description="Emoji float over the video when someone reacts. They still appear in chat when this is off."
        />
        <Switch
          checked={prefs.saveHistory !== false}
          onChange={(v) => update('saveHistory', v)}
          label="Keep my watch history"
          description="Remembers recent videos and how far you got, so you can pick up later. Only you see it, and entries are deleted after 180 days."
        />
        <div>
          <Button variant="ghost" onClick={clearHistory}>Clear my watch history</Button>
        </div>
        <Switch
          checked={Boolean(prefs.reduceMotion)}
          onChange={(v) => update('reduceMotion', v)}
          label="Reduce motion"
          description="Turns off animations across SyncSpace, on top of your device setting."
        />
      </div>
    </section>
  );
}

function Password() {
  const { toast } = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.currentPassword) errs.currentPassword = 'Enter your current password.';
    if (form.newPassword.length < 8) errs.newPassword = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) errs.newPassword = 'Include at least one letter and one number.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await api.post('/users/me/password', form);
      setForm({ currentPassword: '', newPassword: '' });
      toast('Password changed. Other devices were signed out.');
    } catch (err) {
      setErrors(Object.keys(err.fields || {}).length ? err.fields : { currentPassword: err.message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="form-section">
      <h2>Password</h2>
      <form onSubmit={submit} noValidate>
        <Field label="Current password" error={errors.currentPassword}>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />}
        </Field>
        <Field label="New password" hint="At least 8 characters, with a letter and a number." error={errors.newPassword}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />}
        </Field>
        <div className="form-actions" style={{ marginTop: 'var(--s4)' }}>
          <Button type="submit" loading={saving}>Change password</Button>
        </div>
      </form>
    </section>
  );
}

function Sessions() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  return (
    <section className="form-section">
      <h2>Sessions</h2>
      <p className="muted" style={{ marginBottom: 'var(--s4)', fontSize: 'var(--t-sm)' }}>
        Signed in somewhere you shouldn’t be? This signs out every browser and device, including this one.
      </p>
      <Button variant="danger" onClick={() => setConfirm(true)}>Sign out everywhere</Button>
      {confirm && (
        <Modal
          title="Sign out everywhere?"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                variant="danger"
                loading={working}
                onClick={async () => {
                  setWorking(true);
                  await signOut({ everywhere: true });
                  navigate('/signin', { replace: true, state: { reason: 'You were signed out on every device.' } });
                }}
              >
                Sign out everywhere
              </Button>
            </>
          }
        >
          <p className="muted">You’ll need to sign in again on each device.</p>
        </Modal>
      )}
    </section>
  );
}

export default function Settings() {
  const { user } = useAuth();
  return (
    <div className="form-page">
      <h1>Settings</h1>
      <p className="lede">Signed in as {user.email}</p>
      <div className="panel panel-pad">
        <Preferences />
        <Password />
        <Sessions />
      </div>
    </div>
  );
}
