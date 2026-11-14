import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { effectivePlan, PERIOD_DAYS, PLANS } from '../../lib/plans.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { invoicePdf } from './invoice.js';
import {
  activatePayment,
  checkoutSignatureValid,
  currentSubscription,
  markPaymentFailed,
  PAID_TIERS,
  PERIODS,
  quote,
  razorpay,
  razorpayConfigured,
  scheduledSubscription,
  webhookSignatureValid,
} from './service.js';

export const router = Router();
export const webhookRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const planSchema = z.enum(['FREE', 'BRONZE', 'SILVER', 'GOLD']);
const periodSchema = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);

// ───────────── Public catalog ─────────────

const FEATURE_ROWS: { key: string; label: string; value: (p: (typeof PLANS)['FREE']) => string | boolean }[] = [
  { key: 'premiumVideos', label: 'Premium videos', value: (p) => p.premiumVideos },
  { key: 'dailyWatchMinutes', label: 'Daily watch time', value: (p) => (p.dailyWatchMinutes ? `${p.dailyWatchMinutes} min/day` : 'Unlimited') },
  { key: 'maxQuality', label: 'Streaming quality', value: (p) => `Up to ${p.maxQuality}` },
  { key: 'downloadsPerDay', label: 'Downloads per day', value: (p) => String(p.downloadsPerDay) },
  { key: 'downloadsPerMonth', label: 'Downloads per month', value: (p) => String(p.downloadsPerMonth) },
  { key: 'offlineDownloads', label: 'Offline downloads', value: (p) => p.offlineDownloads },
  { key: 'adFree', label: 'Ad-free viewing', value: (p) => p.adFree },
  { key: 'fasterStreaming', label: 'Faster streaming', value: (p) => p.fasterStreaming },
  { key: 'priorityAccess', label: 'Priority access to new content', value: (p) => p.priorityAccess },
  { key: 'exclusiveCourses', label: 'Exclusive premium courses', value: (p) => p.exclusiveCourses },
];

router.get('/plans', (_req, res) => {
  const plans = Object.values(PLANS).sort((a, b) => a.rank - b.rank);
  res.json({
    plans,
    periods: PERIODS.map((p) => ({ period: p, days: PERIOD_DAYS[p] })),
    comparison: FEATURE_ROWS.map((row) => ({
      key: row.key,
      label: row.label,
      values: Object.fromEntries(plans.map((p) => [p.tier, row.value(p)])),
    })),
    policies: {
      upgrade: 'Upgrades start immediately. Unused value of your current plan is credited against the new price.',
      downgrade: 'Downgrades are paid now and start automatically when your current plan ends — you keep your current features until then.',
      renewal:
        'Renewals add a new period on top of your current expiry. We email a reminder 3 days before expiry; renew in one click from your dashboard.',
      cancellation: 'Cancelling turns off auto-renew. Your plan stays active until its expiry date, then you move to Free. Your data and watch history are kept.',
    },
    paymentsEnabled: razorpayConfigured(),
  });
});

// ───────────── Authenticated ─────────────

router.use(requireAuth);

function subDto(sub: Awaited<ReturnType<typeof currentSubscription>>) {
  if (!sub) return null;
  const now = Date.now();
  return {
    ...sub,
    totalDays: Math.round((sub.expiryDate.getTime() - sub.startDate.getTime()) / DAY_MS),
    remainingDays: Math.max(0, Math.ceil((sub.expiryDate.getTime() - now) / DAY_MS)),
  };
}

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const tier = effectivePlan(user);
    const [current, scheduled, payments] = await Promise.all([
      tier === 'FREE' ? null : currentSubscription(user.id),
      scheduledSubscription(user.id),
      prisma.payment.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, plan: true, period: true, action: true, amount: true, currency: true, status: true,
          razorpayOrderId: true, razorpayPaymentId: true, invoiceNumber: true, failureReason: true, createdAt: true, paidAt: true,
        },
      }),
    ]);

    const quotes = await Promise.all(PAID_TIERS.flatMap((plan) => PERIODS.map((period) => quote(user, plan, period))));
    const lastExpired =
      tier === 'FREE'
        ? await prisma.subscription.findFirst({ where: { userId: user.id, status: 'EXPIRED' }, orderBy: { expiryDate: 'desc' } })
        : null;

    res.json({
      plan: tier,
      features: PLANS[tier],
      subscription: subDto(current),
      scheduled,
      nextRenewalDate: current && current.autoRenew ? current.expiryDate : null,
      lastExpired,
      quotes,
      payments,
      paymentsEnabled: razorpayConfigured(),
    });
  }),
);

router.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const { plan, period } = z.object({ plan: planSchema, period: periodSchema }).parse(req.body);
    const user = req.user!;
    const q = await quote(user, plan, period);
    if (!q.eligible) throw new HttpError(400, q.reason ?? 'This plan cannot be purchased right now', 'NOT_ELIGIBLE');
    const rzp = razorpay();

    const checkout = (p: { razorpayOrderId: string; id: string; amount: number; currency: string }, reused: boolean) => ({
      keyId: config.razorpay.keyId,
      orderId: p.razorpayOrderId,
      paymentId: p.id,
      amount: p.amount,
      currency: p.currency,
      quote: q,
      reused,
      prefill: { name: user.name, email: user.email, contact: user.phone ?? undefined },
      description: `${PLANS[plan].name} — ${period.toLowerCase()} (${q.action.toLowerCase()})`,
    });

    // Duplicate click / reopened tab: hand back the same open order instead of creating another.
    const existing = await prisma.payment.findFirst({
      where: {
        userId: user.id,
        plan,
        period,
        action: q.action,
        amount: q.amount,
        status: 'CREATED',
        createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return res.json(checkout(existing, true));

    let order;
    try {
      order = await rzp.orders.create({
        amount: q.amount,
        currency: 'INR',
        receipt: `sh_${user.id.slice(-10)}_${Date.now()}`,
        notes: { userId: user.id, plan, period, action: q.action },
      });
    } catch (err) {
      console.error('[razorpay] order create failed', err);
      const status = (err as { statusCode?: number }).statusCode;
      throw new HttpError(
        502,
        status === 401 ? 'Razorpay rejected the API keys. Check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.' : 'Could not reach the payment gateway. Please try again.',
        'GATEWAY_ERROR',
      );
    }

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        plan,
        period,
        action: q.action,
        amount: q.amount,
        currency: 'INR',
        razorpayOrderId: order.id,
      },
    });
    res.status(201).json(checkout(payment, false));
  }),
);

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

router.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const body = verifySchema.parse(req.body);
    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: body.razorpay_order_id } });
    if (!payment || payment.userId !== req.user!.id) throw new HttpError(404, 'Order not found', 'ORDER_NOT_FOUND');

    // Idempotent: a repeat call for an already-verified payment returns the same result.
    if (payment.status === 'PAID') {
      if (payment.razorpayPaymentId !== body.razorpay_payment_id) {
        throw new HttpError(409, 'This order was already paid with a different payment', 'DUPLICATE_PAYMENT');
      }
      const subscription = payment.subscriptionId ? await prisma.subscription.findUnique({ where: { id: payment.subscriptionId } }) : null;
      return res.json({ status: 'PAID', payment, subscription, alreadyProcessed: true });
    }

    razorpay(); // throws a clear error if keys are missing
    if (!checkoutSignatureValid(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
      await markPaymentFailed(body.razorpay_order_id, 'Signature verification failed');
      throw new HttpError(400, 'Payment verification failed. If money was deducted, it will be refunded by Razorpay.', 'SIGNATURE_INVALID');
    }

    // Double-check with Razorpay: right order, right amount, money actually authorized/captured.
    try {
      const remote = await razorpay().payments.fetch(body.razorpay_payment_id);
      if (remote.order_id !== payment.razorpayOrderId || Number(remote.amount) !== payment.amount) {
        await markPaymentFailed(payment.razorpayOrderId, 'Amount or order mismatch');
        throw new HttpError(400, 'Payment details did not match the order', 'PAYMENT_MISMATCH');
      }
      if (remote.status === 'authorized') {
        await razorpay().payments.capture(remote.id, payment.amount, payment.currency).catch((e) => console.warn('[razorpay] capture', e));
      } else if (remote.status !== 'captured') {
        throw new HttpError(402, `Payment is ${remote.status}`, 'PAYMENT_NOT_CAPTURED');
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Gateway unreachable: the signature already proves Razorpay issued this payment for this order.
      console.warn('[razorpay] payment fetch failed; trusting verified signature', err);
    }

    const result = await activatePayment(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature);
    res.json({ status: 'PAID', ...result });
  }),
);

router.post(
  '/payments/:orderId/failed',
  asyncHandler(async (req, res) => {
    const { reason, code } = z
      .object({ reason: z.string().max(300).default('Payment failed'), code: z.string().max(80).optional() })
      .parse(req.body ?? {});
    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: req.params.orderId } });
    if (!payment || payment.userId !== req.user!.id) throw new HttpError(404, 'Order not found');
    await markPaymentFailed(payment.razorpayOrderId, code ? `${code}: ${reason}` : reason);
    res.json({ ok: true });
  }),
);

router.post(
  '/payments/:orderId/cancel',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: req.params.orderId } });
    if (!payment || payment.userId !== req.user!.id) throw new HttpError(404, 'Order not found');
    await prisma.payment.updateMany({
      where: { id: payment.id, status: 'CREATED' },
      data: { status: 'CANCELLED', failureReason: 'Checkout closed by user' },
    });
    res.json({ ok: true });
  }),
);

/** Poll the status of an order — used by the client when verification was interrupted. */
router.get(
  '/payments/:orderId',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: req.params.orderId } });
    if (!payment || payment.userId !== req.user!.id) throw new HttpError(404, 'Order not found');
    res.json({ status: payment.status, invoiceNumber: payment.invoiceNumber });
  }),
);

router.post(
  '/cancel',
  asyncHandler(async (req, res) => {
    const current = await currentSubscription(req.user!.id);
    if (!current) throw new HttpError(400, 'You have no active paid subscription');
    const sub = await prisma.subscription.update({
      where: { id: current.id },
      data: { autoRenew: false, status: 'CANCELLED', cancelledAt: new Date() },
    });
    res.json({ subscription: sub });
  }),
);

router.post(
  '/resume',
  asyncHandler(async (req, res) => {
    const current = await currentSubscription(req.user!.id);
    if (!current) throw new HttpError(400, 'You have no active paid subscription');
    const sub = await prisma.subscription.update({
      where: { id: current.id },
      data: { autoRenew: true, status: 'ACTIVE', cancelledAt: null },
    });
    res.json({ subscription: sub });
  }),
);

router.get(
  '/invoices/:paymentId/pdf',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.paymentId },
      include: { user: true, subscription: true },
    });
    if (!payment || payment.userId !== req.user!.id) throw new HttpError(404, 'Invoice not found');
    if (payment.status !== 'PAID') throw new HttpError(400, 'Invoices are only available for successful payments');
    const pdf = await invoicePdf(payment, payment.user, payment.subscription);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payment.invoiceNumber ?? payment.id}.pdf"`);
    res.send(pdf);
  }),
);

// ───────────── Webhook (raw body) ─────────────

interface RazorpayWebhook {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string; amount: number; status: string; error_description?: string; error_code?: string } };
    order?: { entity: { id: string } };
  };
}

/**
 * Safety net for interrupted checkouts: if the browser never reached /verify (tab closed,
 * network drop), Razorpay's payment.captured webhook still activates the plan.
 */
webhookRouter.post(
  '/razorpay',
  asyncHandler(async (req, res) => {
    if (!config.razorpay.webhookSecret) throw new HttpError(503, 'Webhook secret not configured');
    const signature = req.get('x-razorpay-signature') ?? '';
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !webhookSignatureValid(raw, signature)) throw new HttpError(400, 'Invalid signature');

    const event = JSON.parse(raw.toString('utf8')) as RazorpayWebhook;
    const entity = event.payload.payment?.entity;
    if (entity?.order_id) {
      const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: entity.order_id } });
      if (payment) {
        if ((event.event === 'payment.captured' || event.event === 'order.paid') && Number(entity.amount) === payment.amount) {
          await activatePayment(entity.order_id, entity.id, null);
        } else if (event.event === 'payment.failed') {
          await markPaymentFailed(entity.order_id, entity.error_description ?? 'Payment failed');
        }
      }
    }
    res.json({ ok: true });
  }),
);
