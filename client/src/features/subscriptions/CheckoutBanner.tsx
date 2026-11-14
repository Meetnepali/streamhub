import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CheckoutState } from './useCheckout';

interface Props {
  state: CheckoutState;
  onDismiss: () => void;
  onCheckAgain: () => void;
}

/** Inline status for an in-flight or finished checkout. */
export function CheckoutBanner({ state, onDismiss, onCheckAgain }: Props) {
  if (state.status === 'idle' || state.status === 'open') return null;
  const kind =
    state.status === 'success' ? 'success' : state.status === 'failed' ? 'error' : state.status === 'pending' ? 'warning' : 'info';
  const Icon =
    state.status === 'success' ? CheckCircle2 : state.status === 'failed' || state.status === 'cancelled' ? XCircle : state.status === 'pending' ? Clock : Loader2;
  const working = state.status === 'creating' || state.status === 'verifying';

  return (
    <div className={`alert ${kind} sub-banner`} role="status">
      <Icon size={18} className={working ? 'sub-spin' : undefined} />
      <span className="sub-banner-text">{state.message}</span>
      {state.status === 'pending' && (
        <button className="btn sm" onClick={onCheckAgain}>Check again</button>
      )}
      {state.status === 'success' && (
        <Link className="btn sm" to="/subscription" onClick={onDismiss}>View subscription</Link>
      )}
      {!working && (
        <button className="btn sm ghost" onClick={onDismiss} aria-label="Dismiss">Dismiss</button>
      )}
    </div>
  );
}
