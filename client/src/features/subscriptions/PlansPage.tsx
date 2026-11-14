import { Check, Minus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/api';
import { formatDate, formatINR } from '../../lib/format';
import type { PlanTier } from '../../lib/types';
import {
  ACTION_LABEL,
  PERIOD_LABEL,
  PERIOD_MONTHS,
  PERIOD_SHORT,
  savingsPercent,
  subscriptionsApi,
  type MySubscription,
  type Period,
  type PlanFeatures,
  type PlansResponse,
  type Quote,
} from './api';
import { CheckoutBanner } from './CheckoutBanner';
import { useCheckout } from './useCheckout';
import './subscriptions.css';

const PERIODS: Period[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];

function highlights(p: PlanFeatures) {
  return [
    p.premiumVideos ? 'All premium videos' : 'Free videos only',
    p.dailyWatchMinutes ? `${p.dailyWatchMinutes} min of watching per day` : 'Unlimited watch time',
    `Streaming up to ${p.maxQuality}`,
    `${p.downloadsPerDay} download${p.downloadsPerDay === 1 ? '' : 's'} per day`,
    p.adFree ? 'Ad-free viewing' : 'Ad-supported',
    ...(p.fasterStreaming ? ['Faster streaming'] : []),
    ...(p.priorityAccess ? ['Priority access to new content'] : []),
    ...(p.exclusiveCourses ? ['Exclusive premium courses'] : []),
  ];
}

export function PlansPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<PlansResponse | null>(null);
  const [mine, setMine] = useState<MySubscription | null>(null);
  const [period, setPeriod] = useState<Period>('MONTHLY');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Quote | null>(null);

  const loadMine = useCallback(async () => {
    if (!user) return setMine(null);
    try {
      setMine(await subscriptionsApi.me());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [user]);

  const { state, start, reset, busy, checkPending } = useCheckout(loadMine);

  useEffect(() => {
    subscriptionsApi.plans().then(setCatalog).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  if (!catalog) {
    return (
      <div className="center-page">
        {error ? <div className="alert error">{error}</div> : <div className="spinner" />}
      </div>
    );
  }

  const quoteFor = (tier: PlanTier) => mine?.quotes.find((q) => q.plan === tier && q.period === period);
  const currentTier = mine?.plan ?? null;

  function cta(plan: PlanFeatures) {
    if (!user) {
      return (
        <button
          className={`btn block ${plan.tier === 'GOLD' ? 'primary' : ''}`}
          onClick={() => navigate('/login', { state: { from: '/plans' } })}
        >
          {plan.tier === 'FREE' ? 'Sign up free' : 'Sign in to subscribe'}
        </button>
      );
    }
    if (plan.tier === 'FREE') {
      return (
        <button className="btn block" disabled>
          {currentTier === 'FREE' ? 'Current plan' : 'Included when paid plan ends'}
        </button>
      );
    }
    const q = quoteFor(plan.tier);
    if (!q) return <button className="btn block" disabled>Loading…</button>;
    return (
      <>
        <button
          className={`btn block ${q.action === 'UPGRADE' || q.action === 'NEW' ? 'primary' : ''}`}
          disabled={!q.eligible || busy || !catalog?.paymentsEnabled}
          title={q.reason}
          onClick={() => setConfirm(q)}
        >
          {ACTION_LABEL[q.action]}
          {q.action === 'UPGRADE' && q.credit > 0 ? ` · ${formatINR(q.amount)}` : ''}
        </button>
        {q.action === 'UPGRADE' && q.credit > 0 && (
          <div className="subtle sub-note">{formatINR(q.credit)} credit for unused time applied</div>
        )}
        {q.action === 'DOWNGRADE' && <div className="subtle sub-note">Starts {formatDate(q.startsAt)}, when your current plan ends</div>}
        {!q.eligible && q.reason && <div className="subtle sub-note">{q.reason}</div>}
      </>
    );
  }

  return (
    <div className="container">
      <div className="sub-hero">
        <h1 className="page-title">Choose your plan</h1>
        <p className="page-subtitle">Upgrade, downgrade or cancel anytime. Payments are processed securely by Razorpay (test mode).</p>
        <div className="sub-period-toggle" role="tablist">
          {PERIODS.map((p) => {
            const best = Math.max(...catalog.plans.map((pl) => savingsPercent(pl, p)));
            return (
              <button key={p} role="tab" aria-selected={period === p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
                {PERIOD_LABEL[p]}
                {best > 0 && <span className="badge success">Save {best}%</span>}
              </button>
            );
          })}
        </div>
      </div>

      {!catalog.paymentsEnabled && (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          Payments aren’t configured on this server. Add Razorpay Test Mode keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) to server/.env.
        </div>
      )}
      {error && <div className="alert error" style={{ marginBottom: 16 }}>{error}</div>}
      <CheckoutBanner state={state} onDismiss={reset} onCheckAgain={() => void checkPending()} />

      <div className="sub-plan-grid">
        {catalog.plans.map((plan) => {
          const price = plan.prices[period];
          const savings = savingsPercent(plan, period);
          const isCurrent = currentTier === plan.tier;
          return (
            <div key={plan.tier} className={`card sub-plan-card tier-${plan.tier} ${isCurrent ? 'current' : ''} ${plan.tier === 'GOLD' ? 'featured' : ''}`}>
              <div className="row">
                <h2 className="sub-plan-name">{plan.name}</h2>
                <div className="spacer" />
                {isCurrent && <span className="badge accent">Current</span>}
                {!isCurrent && plan.tier === 'GOLD' && <span className="badge warning">Best value</span>}
              </div>
              <p className="muted sub-tagline">{plan.tagline}</p>
              <div className="sub-price">
                {price === 0 ? (
                  <span className="sub-amount">Free</span>
                ) : (
                  <>
                    <span className="sub-amount">{formatINR(price)}</span>
                    <span className="muted">/{PERIOD_SHORT[period]}</span>
                  </>
                )}
              </div>
              <div className="subtle sub-price-note">
                {price > 0 && period !== 'MONTHLY'
                  ? `${formatINR(Math.round(price / PERIOD_MONTHS[period]))}/mo${savings ? ` · save ${savings}%` : ''}`
                  : ' '}
              </div>
              <ul className="sub-feature-list">
                {highlights(plan).map((h) => (
                  <li key={h}><Check size={16} /> {h}</li>
                ))}
              </ul>
              <div className="sub-cta">{cta(plan)}</div>
            </div>
          );
        })}
      </div>

      <section className="card sub-compare">
        <h2>Compare plans</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                {catalog.plans.map((p) => (
                  <th key={p.tier} className={currentTier === p.tier ? 'sub-col-current' : ''}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Price ({PERIOD_LABEL[period].toLowerCase()})</td>
                {catalog.plans.map((p) => (
                  <td key={p.tier} className={currentTier === p.tier ? 'sub-col-current' : ''}>
                    {p.prices[period] ? formatINR(p.prices[period]) : 'Free'}
                  </td>
                ))}
              </tr>
              {catalog.comparison.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  {catalog.plans.map((p) => {
                    const v = row.values[p.tier];
                    return (
                      <td key={p.tier} className={currentTier === p.tier ? 'sub-col-current' : ''}>
                        {v === true ? <Check size={16} className="sub-yes" /> : v === false ? <Minus size={16} className="sub-no" /> : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sub-policies">
        {Object.entries(catalog.policies).map(([k, v]) => (
          <div key={k} className="card">
            <h2 className="sub-policy-title">{k.charAt(0).toUpperCase() + k.slice(1)}</h2>
            <p className="muted">{v}</p>
          </div>
        ))}
      </section>

      {confirm && (
        <ConfirmModal
          quote={confirm}
          plan={catalog.plans.find((p) => p.tier === confirm.plan)!}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void start(confirm.plan, confirm.period);
          }}
        />
      )}
    </div>
  );
}

export function ConfirmModal({
  quote,
  plan,
  onClose,
  onConfirm,
}: {
  quote: Quote;
  plan: PlanFeatures;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>
          {ACTION_LABEL[quote.action]} to {plan.name} · {PERIOD_LABEL[quote.period]}
        </h3>
        <div className="sub-summary">
          <div><span className="muted">Plan price</span><span>{formatINR(quote.price)}</span></div>
          {quote.credit > 0 && (
            <div><span className="muted">Credit for unused time</span><span className="sub-yes">− {formatINR(quote.credit)}</span></div>
          )}
          <div className="sub-summary-total"><span>Total payable</span><span>{formatINR(quote.amount)}</span></div>
          <div><span className="muted">Starts</span><span>{quote.action === 'DOWNGRADE' ? formatDate(quote.startsAt) : 'Immediately'}</span></div>
          <div><span className="muted">Valid until</span><span>{formatDate(quote.expiresAt)}</span></div>
        </div>
        {quote.action === 'DOWNGRADE' && (
          <p className="subtle">You keep your current plan’s features until it ends. {plan.name} starts automatically after that.</p>
        )}
        {quote.action === 'RENEW' && <p className="subtle">The new period is added on top of your current expiry date.</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Not now</button>
          <button className="btn primary" onClick={onConfirm}>Pay {formatINR(quote.amount)}</button>
        </div>
      </div>
    </div>
  );
}
