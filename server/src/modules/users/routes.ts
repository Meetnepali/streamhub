import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { PLANS, effectivePlan } from '../../lib/plans.js';
import { prisma } from '../../lib/prisma.js';
import { themeForLoginTime } from '../../lib/time.js';
import { requireAuth } from '../../middleware/auth.js';
import { publicUser } from '../auth/service.js';

export const router = Router();
router.use(requireAuth);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).nullable().optional(),
        avatarUrl: z.string().url().max(500).nullable().optional(),
      })
      .parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
    res.json({ user: publicUser(user) });
  }),
);

/** Manual theme choice persists across sessions and devices. AUTO goes back to the login-time rule. */
router.put(
  '/me/theme',
  asyncHandler(async (req, res) => {
    const { theme } = z.object({ theme: z.enum(['LIGHT', 'DARK', 'AUTO']) }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data:
        theme === 'AUTO'
          ? { theme: themeForLoginTime(), themeManuallySet: false }
          : { theme, themeManuallySet: true },
    });
    res.json({ user: publicUser(user) });
  }),
);

router.put(
  '/me/password',
  asyncHandler(async (req, res) => {
    const { current, next } = z.object({ current: z.string(), next: z.string().min(8).max(128) }).parse(req.body);
    if (!(await bcrypt.compare(current, req.user!.passwordHash))) throw new HttpError(400, 'Current password is wrong');
    await prisma.$transaction([
      prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await bcrypt.hash(next, 12) } }),
      prisma.session.updateMany({
        where: { userId: req.user!.id, revokedAt: null, id: { not: req.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    res.json({ ok: true });
  }),
);

/** Current entitlements — used by the client to gate UI. */
router.get(
  '/me/entitlements',
  asyncHandler(async (req, res) => {
    const tier = effectivePlan(req.user!);
    res.json({ plan: tier, expiresAt: tier === 'FREE' ? null : req.user!.planExpiresAt, features: PLANS[tier] });
  }),
);

/** @mention autocomplete. */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = z.string().trim().max(30).parse(req.query.q ?? '');
    if (!q) return res.json({ items: [] });
    const items = await prisma.user.findMany({
      where: { username: { startsWith: q, mode: 'insensitive' } },
      select: { id: true, username: true, name: true, avatarUrl: true },
      take: 8,
    });
    res.json({ items });
  }),
);
