import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError, errorMessage } from '../lib/api';
import type { User } from '../lib/types';
import './auth.css';

export function RegisterPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', username: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      const { user } = await api.post<{ user: User }>('/auth/register', form);
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION') setFieldErrors(err.details?.fieldErrors ?? {});
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (k: string) => fieldErrors[k]?.[0] && <span className="subtle" style={{ color: 'var(--danger)' }}>{fieldErrors[k][0]}</span>;

  return (
    <div className="center-page">
      <div className="auth-card">
        <form className="card stack" onSubmit={onSubmit}>
          <div>
            <h1>Create your account</h1>
            <p className="muted" style={{ margin: 0 }}>Start free. Upgrade any time.</p>
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className="input" value={form.name} onChange={set('name')} required autoComplete="name" />
            {fieldError('name')}
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" className="input" value={form.username} onChange={set('username')} required autoComplete="username" />
            {fieldError('username')}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={form.email} onChange={set('email')} required autoComplete="email" />
            {fieldError('email')}
          </div>
          <div className="field">
            <label htmlFor="phone">Mobile number (optional, for SMS codes)</label>
            <input id="phone" type="tel" className="input" placeholder="+91XXXXXXXXXX" value={form.phone} onChange={set('phone')} autoComplete="tel" />
            {fieldError('phone')}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" className="input" minLength={8} value={form.password} onChange={set('password')} required autoComplete="new-password" />
            {fieldError('password')}
          </div>
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
