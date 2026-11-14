import { MailCheck, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError, errorMessage } from '../lib/api';
import type { User } from '../lib/types';
import './auth.css';

interface OtpChallenge {
  challengeId: string;
  channel: 'EMAIL' | 'SMS';
  destination: string;
  smsAvailable: boolean;
  reasons: string[];
  expiresAt: string;
}

const REASON_LABEL: Record<string, string> = {
  NEW_BROWSER: 'New browser',
  NEW_DEVICE: 'New device',
  NEW_IP: 'New IP address',
  NEW_LOCATION: 'New location',
};

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);

  if (user && !challenge) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ user: User } | ({ otpRequired: true } & OtpChallenge)>('/auth/login', { identifier, password });
      if ('otpRequired' in res) setChallenge(res);
      else {
        setUser(res.user);
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <OtpStep
        challenge={challenge}
        onChallengeChange={setChallenge}
        onVerified={(u) => {
          setUser(u);
          navigate(from, { replace: true });
        }}
        onCancel={() => setChallenge(null)}
      />
    );
  }

  return (
    <div className="center-page">
      <div className="auth-card">
        <form className="card stack" onSubmit={onSubmit}>
          <div>
            <h1>Welcome back</h1>
            <p className="muted" style={{ margin: 0 }}>Sign in to continue watching.</p>
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="field">
            <label htmlFor="identifier">Email or username</label>
            <input id="identifier" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="auth-footer">
          New to StreamHub? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}

function OtpStep({
  challenge,
  onChallengeChange,
  onVerified,
  onCancel,
}: {
  challenge: OtpChallenge;
  onChallengeChange: (c: OtpChallenge) => void;
  onVerified: (u: User) => void;
  onCancel: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(30);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function verify(code: string) {
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post<{ user: User }>('/auth/otp/verify', { challengeId: challenge.challengeId, code, trustDevice: trust });
      onVerified(user);
    } catch (err) {
      const left = err instanceof ApiError ? err.details?.attemptsLeft : undefined;
      setError(left !== undefined ? `${errorMessage(err)} — ${left} attempt${left === 1 ? '' : 's'} left` : errorMessage(err));
      setDigits(Array(6).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i: number, value: string) {
    const clean = value.replace(/\D/g, '');
    if (clean.length > 1) {
      // Pasted a full code.
      const next = clean.slice(0, 6).split('');
      while (next.length < 6) next.push('');
      setDigits(next);
      if (clean.length >= 6) void verify(clean.slice(0, 6));
      else inputs.current[clean.length]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) inputs.current[i + 1]?.focus();
    if (next.every(Boolean)) void verify(next.join(''));
  }

  async function resend(channel: 'EMAIL' | 'SMS') {
    setError('');
    setInfo('');
    try {
      const res = await api.post<{ channel: 'EMAIL' | 'SMS'; destination: string; expiresAt: string }>('/auth/otp/resend', {
        challengeId: challenge.challengeId,
        channel,
      });
      onChallengeChange({ ...challenge, ...res });
      setInfo(`A new code was sent to ${res.destination}`);
      setCooldown(30);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="center-page">
      <div className="auth-card">
        <div className="card stack">
          <div className="row">
            <span className="security-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <ShieldCheck size={22} />
            </span>
            <div>
              <h1 style={{ fontSize: 20 }}>Verify it’s you</h1>
              <div className="subtle">We sent a 6-digit code to {challenge.destination}</div>
            </div>
          </div>
          <div className="reason-chips">
            {challenge.reasons.map((r) => (
              <span key={r} className="badge warning">{REASON_LABEL[r] ?? r}</span>
            ))}
          </div>
          {error && <div className="alert error">{error}</div>}
          {info && <div className="alert success">{info}</div>}
          <div className="otp-inputs">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={6}
                value={d}
                disabled={busy}
                aria-label={`Digit ${i + 1}`}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
                }}
              />
            ))}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            Trust this browser — skip codes on this device for a while
          </label>
          <button className="btn primary block" disabled={busy || digits.some((d) => !d)} onClick={() => void verify(digits.join(''))}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 8 }}>
            <button className="btn ghost sm" disabled={cooldown > 0} onClick={() => void resend('EMAIL')}>
              <MailCheck size={14} /> {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
            </button>
            {challenge.smsAvailable && (
              <button className="btn ghost sm" disabled={cooldown > 0} onClick={() => void resend('SMS')}>
                Send via SMS instead
              </button>
            )}
          </div>
          <button className="btn ghost sm" onClick={onCancel}>Back to sign in</button>
        </div>
      </div>
    </div>
  );
}
