import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink, Field } from '../components/ui.jsx';
import { AuthFrame } from './Auth.jsx';
import { api } from '../lib/api.js';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [loading, setLoading] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);

  useEffect(() => {
    api.get('/auth/config').then((c) => setEmailEnabled(c.emailEnabled)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    setLoading(true);
    setError('');
    try {
      const d = await api.post('/auth/forgot-password', { email: email.trim() });
      setDone(d.message);
    } catch (err) {
      setError(err.fields?.email || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame imageId="eRsGyueVLvQ" quote="Everyone forgets a password. Nobody forgets the movie." caption="Sintel, Blender Studio, 2010">
      <h1>Reset your password</h1>
      {done ? (
        <>
          <p className="lede" role="status">{done}</p>
          <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>The link works once and expires in 30 minutes. Check your spam folder if it doesn’t arrive.</p>
          <ButtonLink to="/signin" block size="lg" style={{ marginTop: 'var(--s5)' }}>Back to sign in</ButtonLink>
        </>
      ) : (
        <>
          <p className="lede">Enter your email and we’ll send you a link to choose a new one.</p>
          {!emailEnabled && <p className="form-alert" role="alert" style={{ marginBottom: 'var(--s4)' }}>Email isn’t set up on this server, so password reset by email isn’t available. Ask the administrator.</p>}
          <form onSubmit={submit} noValidate>
            <Field label="Email" error={error}>
              {(p) => <input {...p} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={!emailEnabled} style={{ marginTop: 'var(--s5)' }}>Send reset link</Button>
          </form>
          <p className="auth-switch"><Link to="/signin">Back to sign in</Link></p>
        </>
      )}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('Include at least one letter and one number.');
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/signin', { replace: true, state: { reason: 'Password changed. Sign in with your new password.' } });
    } catch (err) {
      setError(err.fields?.password || err.message);
      setLoading(false);
    }
  };

  return (
    <AuthFrame imageId="_cMxraX_5RE" quote="A fresh start, same room." caption="Sprite Fright, Blender Studio, 2021">
      <h1>Choose a new password</h1>
      {!token ? (
        <>
          <p className="form-alert" role="alert">This link is missing its token. Open the link from your email again, or request a new one.</p>
          <ButtonLink to="/forgot-password" block size="lg" style={{ marginTop: 'var(--s5)' }}>Request a new link</ButtonLink>
        </>
      ) : (
        <>
          <p className="lede">This signs you out everywhere else.</p>
          <form onSubmit={submit} noValidate>
            <Field label="New password" hint="At least 8 characters, with a letter and a number." error={error}>
              {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" size="lg" block loading={loading} style={{ marginTop: 'var(--s5)' }}>Change password</Button>
          </form>
          {error.includes('expired') && <p className="auth-switch"><Link to="/forgot-password">Request a new link</Link></p>}
        </>
      )}
    </AuthFrame>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState(token ? 'working' : 'missing');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // React strict mode would otherwise use the single-use token twice
    started.current = true;
    api.post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((e) => { setMessage(e.message); setState('error'); });
  }, [token]);

  return (
    <AuthFrame imageId="eRsGyueVLvQ" quote="One quick check and you’re set." caption="Sintel, Blender Studio, 2010">
      <h1>Verify your email</h1>
      {state === 'working' && <p className="lede" role="status">Checking your link…</p>}
      {state === 'ok' && (
        <>
          <p className="lede" role="status">Your email is verified. Thank you.</p>
          <ButtonLink to="/dashboard" variant="primary" size="lg" block>Go to dashboard</ButtonLink>
        </>
      )}
      {(state === 'error' || state === 'missing') && (
        <>
          <p className="form-alert" role="alert">{state === 'missing' ? 'This link is missing its token.' : message}</p>
          <p className="muted" style={{ margin: 'var(--s4) 0' }}>Sign in and request a new verification email from your dashboard.</p>
          <ButtonLink to="/dashboard" size="lg" block>Go to dashboard</ButtonLink>
        </>
      )}
    </AuthFrame>
  );
}
