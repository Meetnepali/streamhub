import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, errorMessage } from '../../lib/api';
import type { PlanTier } from '../../lib/types';
import { subscriptionsApi, type OrderResponse, type Period } from './api';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error: { code: string; description: string; reason?: string; metadata?: { order_id?: string; payment_id?: string } };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (r: RazorpayFailure) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

export type CheckoutStatus = 'idle' | 'creating' | 'open' | 'verifying' | 'success' | 'pending' | 'failed' | 'cancelled';

export interface CheckoutState {
  status: CheckoutStatus;
  message?: string;
  order?: OrderResponse;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Network-level failures (offline, proxy down) are worth retrying; API rejections are not. */
function isRetryable(err: unknown) {
  return !(err instanceof ApiError) || err.status >= 500;
}

export function useCheckout(onPaid?: () => void) {
  const { user, refresh } = useAuth();
  const [state, setState] = useState<CheckoutState>({ status: 'idle' });
  // A ref, not state: guards against double-clicks within the same render.
  const inFlight = useRef(false);

  const verifyWithRetry = useCallback(
    async (resp: RazorpaySuccess, order: OrderResponse) => {
      setState({ status: 'verifying', order, message: 'Confirming your payment…' });
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await subscriptionsApi.verify(resp);
          await refresh();
          setState({ status: 'success', order, message: 'Payment successful — your plan is updated. A receipt is on its way to your inbox.' });
          onPaid?.();
          return;
        } catch (err) {
          if (!isRetryable(err)) {
            setState({ status: 'failed', order, message: errorMessage(err) });
            return;
          }
          await sleep(1500 * (attempt + 1));
        }
      }
      setState({
        status: 'pending',
        order,
        message:
          'We received your payment but couldn’t confirm it yet (network issue). It will activate automatically — check again in a moment. You won’t be charged twice.',
      });
    },
    [refresh, onPaid],
  );

  const checkPending = useCallback(async () => {
    const order = state.order;
    if (!order) return;
    try {
      const { status } = await subscriptionsApi.orderStatus(order.orderId);
      if (status === 'PAID') {
        await refresh();
        setState({ status: 'success', order, message: 'Payment confirmed — your plan is updated.' });
        onPaid?.();
      } else {
        setState((s) => ({ ...s, message: `Still waiting for confirmation (status: ${status.toLowerCase()}). Try again shortly.` }));
      }
    } catch (err) {
      setState((s) => ({ ...s, message: errorMessage(err) }));
    }
  }, [state.order, refresh, onPaid]);

  const start = useCallback(
    async (plan: PlanTier, period: Period) => {
      if (inFlight.current || !user) return;
      if (!window.Razorpay) {
        setState({ status: 'failed', message: 'Payment checkout could not load. Check your connection or disable blockers for checkout.razorpay.com, then retry.' });
        return;
      }
      inFlight.current = true;
      setState({ status: 'creating', message: 'Preparing secure checkout…' });

      let order: OrderResponse;
      try {
        order = await subscriptionsApi.createOrder(plan, period);
      } catch (err) {
        inFlight.current = false;
        setState({ status: 'failed', message: errorMessage(err) });
        return;
      }

      let settled = false;
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'StreamHub',
        description: order.description,
        prefill: order.prefill,
        notes: { plan, period },
        theme: { color: '#e11d48' },
        retry: { enabled: true },
        handler: (resp: RazorpaySuccess) => {
          settled = true;
          void verifyWithRetry(resp, order).finally(() => {
            inFlight.current = false;
          });
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (settled) return;
            inFlight.current = false;
            void subscriptionsApi.cancelOrder(order.orderId).catch(() => {});
            setState((s) =>
              s.status === 'failed' ? s : { status: 'cancelled', order, message: 'Payment cancelled. You were not charged.' },
            );
          },
        },
      });
      // Razorpay keeps the modal open after a failure so the user can retry with another method.
      rzp.on('payment.failed', (r) => {
        void subscriptionsApi.failed(order.orderId, r.error.description, r.error.code).catch(() => {});
        setState({ status: 'failed', order, message: `Payment failed: ${r.error.description}` });
      });
      setState({ status: 'open', order });
      rzp.open();
    },
    [user, verifyWithRetry],
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);
  const busy = ['creating', 'open', 'verifying'].includes(state.status);

  return { state, start, reset, busy, checkPending };
}
