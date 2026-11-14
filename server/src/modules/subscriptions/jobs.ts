import { config } from '../../config.js';
import { PLANS } from '../../lib/plans.js';
import { prisma } from '../../lib/prisma.js';
import { fmtDate, planChangeEmail } from './service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Expire finished subscriptions and move users onto whatever comes next: a scheduled
 * downgrade if one has started, otherwise FREE. Only plan fields change — downloads,
 * comments and watch history are untouched.
 */
export async function downgradeExpiredSubscriptions() {
  const now = new Date();
  await prisma.subscription.updateMany({
    where: { status: { in: ['ACTIVE', 'CANCELLED'] }, expiryDate: { lte: now } },
    data: { status: 'EXPIRED' },
  });

  const users = await prisma.user.findMany({
    where: { plan: { not: 'FREE' }, OR: [{ planExpiresAt: null }, { planExpiresAt: { lte: now } }] },
  });
  for (const user of users) {
    const next = await prisma.subscription.findFirst({
      where: { userId: user.id, status: { in: ['ACTIVE', 'CANCELLED'] }, startDate: { lte: now }, expiryDate: { gt: now } },
      orderBy: { expiryDate: 'desc' },
    });
    if (next) {
      await prisma.user.update({ where: { id: user.id }, data: { plan: next.plan, planExpiresAt: next.expiryDate } });
      await planChangeEmail(
        user,
        `Your ${PLANS[next.plan].name} plan is now active`,
        `<p>Your previous plan ended and your scheduled <b>${PLANS[next.plan].name}</b> plan has started. It’s valid until ${fmtDate(next.expiryDate)}.</p>`,
      );
    } else {
      // Conditional so a payment activated in the meantime isn't overwritten.
      const { count } = await prisma.user.updateMany({
        where: { id: user.id, plan: user.plan, planExpiresAt: user.planExpiresAt },
        data: { plan: 'FREE', planExpiresAt: null },
      });
      if (count) {
        await planChangeEmail(
          user,
          'Your StreamHub subscription has ended',
          `<p>Your <b>${PLANS[user.plan].name}</b> plan expired, so your account is now on the Free plan. Your profile, downloads history and watch progress are all kept.</p>
           <p><a href="${config.clientUrl}/plans">Renew anytime</a> to unlock premium features again.</p>`,
        );
      }
    }
  }
  if (users.length) console.log(`[subscriptions] processed ${users.length} expired plan(s)`);
}

/**
 * Razorpay one-off orders can't charge a saved card automatically, so "auto-renew" means:
 * email a reminder 3 days before expiry with a one-click renew link. Runs daily, so the
 * [2d, 3d) window reminds each subscription exactly once.
 */
export async function sendRenewalReminders() {
  const now = Date.now();
  const subs = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'CANCELLED'] },
      startDate: { lte: new Date(now) },
      expiryDate: { gte: new Date(now + 2 * DAY_MS), lt: new Date(now + 3 * DAY_MS) },
    },
    include: { user: true },
  });
  for (const sub of subs) {
    const scheduled = await prisma.subscription.count({
      where: { userId: sub.userId, status: { in: ['ACTIVE', 'CANCELLED'] }, startDate: { gte: sub.expiryDate } },
    });
    if (scheduled) continue;
    const name = PLANS[sub.plan].name;
    await planChangeEmail(
      sub.user,
      sub.autoRenew ? `Renew your ${name} plan — expires ${fmtDate(sub.expiryDate)}` : `Your ${name} plan ends on ${fmtDate(sub.expiryDate)}`,
      sub.autoRenew
        ? `<p>Your <b>${name}</b> plan expires on <b>${fmtDate(sub.expiryDate)}</b>. Renew now to keep your premium features without interruption — the new period is added on top of your current one.</p>
           <p><a href="${config.clientUrl}/subscription" style="display:inline-block;background:#e11d48;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Renew in one click</a></p>`
        : `<p>You turned off auto-renew, so your <b>${name}</b> plan ends on <b>${fmtDate(sub.expiryDate)}</b> and your account moves to Free. Changed your mind? <a href="${config.clientUrl}/subscription">Turn auto-renew back on</a>.</p>`,
    );
  }
}
