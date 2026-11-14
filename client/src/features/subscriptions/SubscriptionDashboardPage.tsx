import { CalendarClock, Check, Download, Minus, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../lib/api';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
import {
  ACTION_LABEL,
  PERIOD_LABEL,
  subscriptionsApi,
  type MySubscription,
  type PaymentRow,
  type PlanFeatures,
  type Quote,
} from './api';
import { CheckoutBanner } from './CheckoutBanner';
import { ConfirmModal } from './PlansPage';
import { useCheckout } from './useCheckout';
import './subscriptions.css';

const STATUS_BADGE: Record<PaymentRow['status'], string> = {
  PAID: 'success',
  CREATED: 'info',
  FAILED: 'danger',
  CANCELLED: '',
};

const FEATURE_LIST: { label: string; value: (f: PlanFeatures) => string | boolean }[] = [
  { label: 'Premium videos', value: (f) => f.premiumVideos },
  { label: 'Watch time', value: (f) => (f.dailyWatchMinutes ? `${f.dailyWatchMinutes} min/day` : 'Unlimited') },
  { label: 'Streaming quality', value: (f) => `Up to ${f.maxQuality}` },
  { label: 'Downloads', value: (f) => `${f.downloadsPerDay}/day · ${f.downloadsPerMonth}/month` },
  { label: 'Ad-free', value: (f) => f.adFree },
  { label: 'Faster streaming', value: (f) => f.fasterStreaming },
  { label: 'Priority content access', value: (f) => f.priorityAccess },
  { label: 'Exclusive courses', value: (f) => f.exclusiveCourses },
];

export function SubscriptionDashboardPage() {
  const [data, setData] = useState<MySubscription | null>(null);
  const [plans, setPlans] = useState<PlanFeatures[]>([]);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [confirm, setConfirm] = useState<Quote | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await subscriptionsApi.me());
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  const { state, start, reset, busy, checkPending } = useCheckout(load);

  useEffect(() => {
    void load();
    subscriptionsApi.plans().then((r) => setPlans(r.plans)).catch(() => {});
  }, [load]);

  if (!data) {
    return <div className="center-page">{error ? <div className="alert error">{error}</div> : <div className="spinner" />}</div>;
  }

  const sub = data.subscription;
  const usedPct = sub?.totalDays ? Math.min(100, Math.max(0, ((sub.totalDays - (sub.remainingDays ?? 0)) / sub.totalDays) * 100)) : 0;
  const renewQuote = sub ? data.quotes.find((q) => q.plan === sub.plan && q.period === sub.period) : undefined;
  const upgrades = data.quotes.filter((q) => q.action === 'UPGRADE' && q.period === (sub?.period ?? 'MONTHLY'));
  const newQuotes = data.plan === 'FREE' ? data.quotes.filter((q) => q.period === 'MONTHLY') : [];
  const planName = (tier: string) => plans.find((p) => p.tier === tier)?.name ?? tier;

  async function toggleAutoRenew() {
    if (!sub) return;
    setToggling(true);
    try {
      await (sub.autoRenew ? subscriptionsApi.cancel() : subscriptionsApi.resume());
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="container narrow stack">
      <div>
        <h1 className="page-title">Subscription</h1>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>Manage your plan, renewals and billing.</p>
      </div>

      {error && <div className="alert error">{error}</div>}
      <CheckoutBanner state={state} onDismiss={reset} onCheckAgain={() => void checkPending()} />

      <section className={`card sub-current tier-${data.plan}`}>
        <div className="row wrap">
          <div>
            <div className="subtle">Current plan</div>
            <div className="row" style={{ gap: 8 }}>
              <h2 className="sub-current-name">{data.features.name}</h2>
              <span className={`badge plan-${data.plan}`}>{data.plan}</span>
              {sub && (
                <span className={`badge ${sub.autoRenew ? 'success' : 'warning'}`}>
                  {sub.autoRenew ? 'Active' : 'Cancelled — ends at expiry'}
                </span>
              )}
            </div>
            {sub && <div className="muted">{PERIOD_LABEL[sub.period]} billing</div>}
          </div>
          <div className="spacer" />
          <Link to="/plans" className="btn">Compare plans</Link>
        </div>

        {sub ? (
          <>
            <div className="sub-validity">
              <div className="row">
                <span><b>{sub.remainingDays}</b> of {sub.totalDays} days left</span>
                <div className="spacer" />
                <span className="subtle">{formatDate(sub.startDate)} → {formatDate(sub.expiryDate)}</span>
              </div>
              <div className="sub-progress"><div style={{ width: `${usedPct}%` }} /></div>
            </div>
            <div className="sub-stats">
              <div>
                <div className="subtle">Next renewal</div>
                <div className="row" style={{ gap: 6 }}>
                  <CalendarClock size={16} />
                  {data.nextRenewalDate ? formatDate(data.nextRenewalDate) : 'Not renewing'}
                </div>
              </div>
              <div>
                <div className="subtle">Expires</div>
                <div>{formatDateTime(sub.expiryDate)}</div>
              </div>
              <div>
                <div className="subtle">Auto-renew</div>
                <label className="sub-switch">
                  <input type="checkbox" checked={sub.autoRenew} disabled={toggling} onChange={() => void toggleAutoRenew()} />
                  <span />
                  {sub.autoRenew ? 'On' : 'Off'}
                </label>
              </div>
            </div>
            <p className="subtle" style={{ margin: 0 }}>
              {sub.autoRenew
                ? 'We’ll email you 3 days before expiry with a one-click renewal. Razorpay test orders can’t charge a saved card automatically.'
                : `Your plan stays active until ${formatDate(sub.expiryDate)}, then moves to Free. Your data and watch history are kept.`}
            </p>
            <div className="row wrap">
              {renewQuote && (
                <button
                  className="btn primary"
                  disabled={!renewQuote.eligible || busy || !data.paymentsEnabled}
                  title={renewQuote.reason}
                  onClick={() => setConfirm(renewQuote)}
                >
                  <RefreshCw size={16} /> Renew now · {formatINR(renewQuote.amount)}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>
            {data.lastExpired
              ? `Your ${planName(data.lastExpired.plan)} plan expired on ${formatDate(data.lastExpired.expiryDate)}. Your data and watch history are safe — renew to get premium features back.`
              : 'You’re on the Free plan. Upgrade to unlock premium videos, more downloads and HD streaming.'}
          </p>
        )}

        {data.scheduled && (
          <div className="alert info">
            {planName(data.scheduled.plan)} ({PERIOD_LABEL[data.scheduled.period].toLowerCase()}) is scheduled to start on{' '}
            {formatDate(data.scheduled.startDate)} and run until {formatDate(data.scheduled.expiryDate)}.
          </div>
        )}
      </section>

      {(upgrades.length > 0 || newQuotes.length > 0) && (
        <section className="card">
          <h2><Sparkles size={18} style={{ verticalAlign: -3 }} /> {data.plan === 'FREE' ? 'Go premium' : 'Quick upgrade'}</h2>
          <div className="sub-quick">
            {[...upgrades, ...newQuotes].map((q) => (
              <div key={`${q.plan}-${q.period}`} className="sub-quick-item">
                <div>
                  <div style={{ fontWeight: 700 }}>{planName(q.plan)}</div>
                  <div className="subtle">
                    {PERIOD_LABEL[q.period]} · {formatINR(q.amount)}
                    {q.credit > 0 && ` (after ${formatINR(q.credit)} credit)`}
                  </div>
                </div>
                <button
                  className="btn sm primary"
                  disabled={!q.eligible || busy || !data.paymentsEnabled}
                  title={q.reason}
                  onClick={() => setConfirm(q)}
                >
                  {ACTION_LABEL[q.action]}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Your features</h2>
        <ul className="sub-features-grid">
          {FEATURE_LIST.map((f) => {
            const v = f.value(data.features);
            return (
              <li key={f.label}>
                {v === false ? <Minus size={16} className="sub-no" /> : <Check size={16} className="sub-yes" />}
                <span className={v === false ? 'muted' : ''}>{f.label}</span>
                {typeof v === 'string' && <span className="subtle" style={{ marginLeft: 'auto' }}>{v}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2>Billing history</h2>
        {data.payments.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>No payments yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.paidAt ?? p.createdAt)}</td>
                    <td>
                      {planName(p.plan)} <span className="subtle">· {PERIOD_LABEL[p.period]} · {ACTION_LABEL[p.action]}</span>
                    </td>
                    <td>{formatINR(p.amount)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[p.status]}`} title={p.failureReason ?? undefined}>
                        {p.status === 'CREATED' ? 'Pending' : p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="subtle sub-ref">
                      {p.invoiceNumber ?? '—'}
                      <br />
                      {p.razorpayPaymentId ?? p.razorpayOrderId}
                    </td>
                    <td>
                      {p.status === 'PAID' && (
                        <a className="btn sm" href={`/api/subscriptions/invoices/${p.id}/pdf`} download>
                          <Download size={14} /> Invoice
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirm && plans.length > 0 && (
        <ConfirmModal
          quote={confirm}
          plan={plans.find((p) => p.tier === confirm.plan)!}
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
