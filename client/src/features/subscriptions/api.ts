import { api } from '../../lib/api';
import type { PlanTier } from '../../lib/types';

export type Period = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type PaymentAction = 'NEW' | 'UPGRADE' | 'DOWNGRADE' | 'RENEW';

export interface PlanFeatures {
  tier: PlanTier;
  name: string;
  rank: number;
  tagline: string;
  prices: Record<Period, number>;
  downloadsPerDay: number;
  downloadsPerMonth: number;
  dailyWatchMinutes: number | null;
  maxQuality: string;
  premiumVideos: boolean;
  offlineDownloads: boolean;
  adFree: boolean;
  priorityAccess: boolean;
  exclusiveCourses: boolean;
  fasterStreaming: boolean;
}

export interface PlansResponse {
  plans: PlanFeatures[];
  periods: { period: Period; days: number }[];
  comparison: { key: string; label: string; values: Record<PlanTier, string | boolean> }[];
  policies: Record<'upgrade' | 'downgrade' | 'renewal' | 'cancellation', string>;
  paymentsEnabled: boolean;
}

export interface Quote {
  plan: PlanTier;
  period: Period;
  action: PaymentAction;
  eligible: boolean;
  reason?: string;
  price: number;
  credit: number;
  amount: number;
  startsAt: string;
  expiresAt: string;
}

export interface Subscription {
  id: string;
  plan: PlanTier;
  period: Period;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUPERSEDED';
  startDate: string;
  expiryDate: string;
  autoRenew: boolean;
  cancelledAt: string | null;
  totalDays?: number;
  remainingDays?: number;
}

export interface PaymentRow {
  id: string;
  plan: PlanTier;
  period: Period;
  action: PaymentAction;
  amount: number;
  currency: string;
  status: 'CREATED' | 'PAID' | 'FAILED' | 'CANCELLED';
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  invoiceNumber: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface MySubscription {
  plan: PlanTier;
  features: PlanFeatures;
  subscription: Subscription | null;
  scheduled: Subscription | null;
  nextRenewalDate: string | null;
  lastExpired: Subscription | null;
  quotes: Quote[];
  payments: PaymentRow[];
  paymentsEnabled: boolean;
}

export interface OrderResponse {
  keyId: string;
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  quote: Quote;
  reused: boolean;
  prefill: { name: string; email: string; contact?: string };
  description: string;
}

export const subscriptionsApi = {
  plans: () => api.get<PlansResponse>('/subscriptions/plans'),
  me: () => api.get<MySubscription>('/subscriptions/me'),
  createOrder: (plan: PlanTier, period: Period) => api.post<OrderResponse>('/subscriptions/orders', { plan, period }),
  verify: (body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    api.post<{ status: 'PAID'; alreadyProcessed: boolean; subscription: Subscription | null }>('/subscriptions/verify', body),
  failed: (orderId: string, reason: string, code?: string) =>
    api.post(`/subscriptions/payments/${orderId}/failed`, { reason, code }),
  cancelOrder: (orderId: string) => api.post(`/subscriptions/payments/${orderId}/cancel`),
  orderStatus: (orderId: string) => api.get<{ status: PaymentRow['status'] }>(`/subscriptions/payments/${orderId}`),
  cancel: () => api.post('/subscriptions/cancel'),
  resume: () => api.post('/subscriptions/resume'),
};

export const PERIOD_LABEL: Record<Period, string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };
export const PERIOD_SHORT: Record<Period, string> = { MONTHLY: 'mo', QUARTERLY: 'quarter', YEARLY: 'yr' };
export const PERIOD_MONTHS: Record<Period, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** Savings vs paying monthly for the same span, as a whole percent. */
export function savingsPercent(plan: PlanFeatures, period: Period) {
  const monthlyEquivalent = plan.prices.MONTHLY * PERIOD_MONTHS[period];
  if (!monthlyEquivalent || period === 'MONTHLY') return 0;
  return Math.round((1 - plan.prices[period] / monthlyEquivalent) * 100);
}

export const ACTION_LABEL: Record<PaymentAction, string> = {
  NEW: 'Subscribe',
  UPGRADE: 'Upgrade',
  DOWNGRADE: 'Downgrade',
  RENEW: 'Renew',
};
