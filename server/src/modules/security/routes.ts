import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

export const router = Router();
router.use(requireAuth);

router.get(
  '/logins',
  asyncHandler(async (req, res) => {
    const { page, status } = z
      .object({ page: z.coerce.number().int().min(1).default(1), status: z.string().optional() })
      .parse(req.query);
    const where = { userId: req.user!.id, ...(status ? { status: status as never } : {}) };
    const [items, total] = await Promise.all([
      prisma.loginEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
      prisma.loginEvent.count({ where }),
    ]);
    res.json({ items, total, page, pageSize: 20 });
  }),
);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const grouped = await prisma.loginEvent.groupBy({
      by: ['status'],
      where: { userId: req.user!.id, createdAt: { gte: since } },
      _count: true,
    });
    res.json({ last30Days: Object.fromEntries(grouped.map((g) => [g.status, g._count])) });
  }),
);

router.get(
  '/devices',
  asyncHandler(async (req, res) => {
    const devices = await prisma.trustedDevice.findMany({
      where: { userId: req.user!.id, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
    const currentKey = req.get('x-device-key');
    res.json({
      items: devices.map(({ deviceKey, fingerprint: _f, ...d }) => ({
        ...d,
        isCurrent: deviceKey === currentKey,
        expired: d.trustedUntil < new Date(),
      })),
    });
  }),
);

router.delete(
  '/devices/:id',
  asyncHandler(async (req, res) => {
    const device = await prisma.trustedDevice.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!device) throw new HttpError(404, 'Device not found');
    await prisma.$transaction([
      prisma.trustedDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } }),
      // Removing trust also signs that device out.
      prisma.session.updateMany({ where: { trustedDeviceId: device.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  }),
);

router.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    res.json({ items: sessions.map((s) => ({ ...s, isCurrent: s.id === req.sessionId })) });
  }),
);

router.delete(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.session.updateMany({
      where: { id: req.params.id, userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new HttpError(404, 'Session not found');
    res.json({ ok: true });
  }),
);

router.post(
  '/sessions/revoke-others',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.session.updateMany({
      where: { userId: req.user!.id, revokedAt: null, id: { not: req.sessionId } },
      data: { revokedAt: new Date() },
    });
    res.json({ revoked: count });
  }),
);
