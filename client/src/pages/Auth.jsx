import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Thumb } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function AuthFrame({ children, imageId, quote, caption }) {
  return (
    <div className="auth">
      <figure className="auth-side" style={{ margin: 0 }}>
        <Thumb id={imageId} eager />
        <div>
          <blockquote>{quote}</blockquote>
          <figcaption>{caption}</figcaption>
        </div>
      </figure>
      <div className="auth-main">
        <div className="auth-card">{children}</div>
      </div>
    </div>
  );
}

export function SignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const from = location.state?.from || '/dashboard';

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (!form.email.trim()) errs.email = 'Enter your email.';
    if (!form.password) errs.password = 'Enter your password.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      await signIn(form.email, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(Object.keys(err.fields || {}).length ? '' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame imageId="eRsGyueVLvQ" quote="The room remembers where you left off." caption="Sintel, Blender Studio, 2010">
      <h1>Sign in</h1>
      <p className="lede">{location.state?.reason || 'Pick up where your rooms left off.'}</p>
      <form onSubmit={submit} noValidate>
        {formError && <p className="form-alert" role="alert" style={{ marginBottom: 'var(--s4)' }}>{formError}</p>}
        <Field label="Email" error={errors.email}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password" error={errors.password}>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <p style={{ marginTop: 'var(--s2)', fontSize: 'var(--t-sm)' }}><Link to="/forgot-password">Forgot your password?</Link></p>
        <Button type="submit" variant="primary" size="lg" block loading={loading} style={{ marginTop: 'var(--s5)' }}>
          Sign in
        </Button>
      </form>
      <p className="auth-switch">
        New to SyncSpace? <Link to="/signup" state={location.state}>Create an account</Link>
      </p>
    </AuthFrame>
  );
}

export function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const from = location.state?.from || '/dashboard';

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (form.displayName.trim().length < 2) errs.displayName = 'Use at least 2 characters.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email address.';
    if (form.password.length < 8) errs.password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) errs.password = 'Include at least one letter and one number.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      await signUp(form.displayName, form.email, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(Object.keys(err.fields || {}).length ? '' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame imageId="_cMxraX_5RE" quote="Bring the whole group. Nobody has to count down to three." caption="Sprite Fright, Blender Studio, 2021">
      <h1>Create your account</h1>
      <p className="lede">{location.state?.reason || 'You’ll need one to host or join a room.'}</p>
      <form onSubmit={submit} noValidate>
        {formError && <p className="form-alert" role="alert" style={{ marginBottom: 'var(--s4)' }}>{formError}</p>}
        <Field label="Display name" hint="Shown to people in your rooms." error={errors.displayName}>
          {(p) => <input {...p} className="input" autoComplete="nickname" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password" hint="At least 8 characters, with a letter and a number." error={errors.password}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={loading} style={{ marginTop: 'var(--s5)' }}>
          Create account
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/signin" state={location.state}>Sign in</Link>
      </p>
    </AuthFrame>
  );
}
