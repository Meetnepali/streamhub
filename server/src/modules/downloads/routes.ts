import type { Request } from 'express';
import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { basicClientInfo } from '../../lib/clientInfo.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { MEDIA_DIR } from '../../lib/paths.js';
import { prisma } from '../../lib/prisma.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import {
  activeStreams,
  assertCanDownload,
  assertPlanStillValid,
  authorizeDownload,
  getQuota,
  retryDownload,
  type RequestMeta,
} from './service.js';

export const router = Router();
router.use(requireAuth);

function requestMeta(req: Request): RequestMeta {
  const info = basicClientInfo(req);
  return {
    ip: info.ip,
    userAgent: info.userAgent.slice(0, 500),
    browser: info.browser,
    os: info.os,
    deviceType: info.deviceType,
    deviceKey: info.deviceKey,
  };
}

const fileUrl = (token: string) => `/api/downloads/file/${token}`;

router.get(
  '/quota',
  asyncHandler(async (req, res) => {
    res.json(await getQuota(req.user!));
  }),
);

router.post(
  '/authorize',
  asyncHandler(async (req, res) => {
    const { videoId } = z.object({ videoId: z.string().min(1) }).parse(req.body);
    const meta = requestMeta(req);
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    await assertCanDownload(req.user!, video, meta.deviceKey);
    const { download, quota, reused } = await authorizeDownload(req.user!, video!, meta);
    res.status(reused ? 200 : 201).json({
      downloadId: download.id,
      url: fileUrl(download.token),
      countsToQuota: download.countsToQuota,
      reused,
      expiresAt: download.tokenExpiresAt,
      quota,
    });
  }),
);

router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const original = await prisma.download.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { video: true },
    });
    if (!original) throw new HttpError(404, 'Download not found', 'NOT_FOUND');
    const { download, quota } = await retryDownload(req.user!, original, requestMeta(req));
    res.json({ downloadId: download.id, url: fileUrl(download.token), countsToQuota: download.countsToQuota, quota });
  }),
);

function safeFilename(title: string) {
  const base = title.normalize('NFKD').replace(/[^\w\s.-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'video';
  return `${base}.mp4`;
}

router.get(
  '/file/:token',
  asyncHandler(async (req, res) => {
    const download = await prisma.download.findUnique({ where: { token: req.params.token }, include: { video: true } });
    if (!download || download.userId !== req.user!.id) throw new HttpError(404, 'Download link not found', 'NOT_FOUND');
    if (download.tokenExpiresAt < new Date()) throw new HttpError(410, 'This download link has expired', 'TOKEN_EXPIRED');

    const range = req.headers.range;
    // One-time token: a fresh fetch only while AUTHORIZED; afterwards only Range resumes are allowed.
    if (download.status === 'COMPLETED' || download.status === 'FAILED') {
      throw new HttpError(410, 'This download link was already used', 'TOKEN_USED');
    }
    if (download.status !== 'AUTHORIZED' && !range) {
      throw new HttpError(409, 'This link can only be used to resume the download', 'TOKEN_USED');
    }
    if (activeStreams.has(download.id)) throw new HttpError(409, 'This download is already in progress', 'IN_PROGRESS');

    // Re-validate entitlement and device at fetch time.
    assertPlanStillValid(req.user!, download, download.video);
    await assertCanDownload(req.user!, download.video, download.deviceKey);

    const filePath = path.resolve(MEDIA_DIR, download.video.videoPath);
    if (!filePath.startsWith(MEDIA_DIR + path.sep) || !existsSync(filePath)) {
      await prisma.download.update({
        where: { id: download.id },
        data: { status: 'FAILED', failureReason: 'File missing on server', countsToQuota: false },
      });
      throw new HttpError(404, 'The video file is unavailable. Your quota was not charged.', 'FILE_MISSING');
    }

    const size = statSync(filePath).size;
    let start = 0;
    let end = size - 1;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) {
        res.setHeader('Content-Range', `bytes */${size}`);
        throw new HttpError(416, 'Invalid range', 'BAD_RANGE');
      }
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(m[2]));
      }
      if (start > end || start >= size) {
        res.setHeader('Content-Range', `bytes */${size}`);
        throw new HttpError(416, 'Range not satisfiable', 'BAD_RANGE');
      }
    }

    await prisma.download.update({
      where: { id: download.id },
      data: { status: 'IN_PROGRESS', startedAt: download.startedAt ?? new Date(), fileSizeBytes: BigInt(size) },
    });

    const filename = safeFilename(download.video.title);
    res.status(range ? 206 : 200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);

    activeStreams.add(download.id);
    let sent = 0;
    let finished = false;
    const stream = createReadStream(filePath, { start, end });
    stream.on('data', (chunk) => {
      sent += chunk.length;
    });

    const settle = async (outcome: 'COMPLETED' | 'INTERRUPTED' | 'FAILED', reason?: string) => {
      activeStreams.delete(download.id);
      // bytesSent = how far into the file the client now has (resumes start mid-file).
      const reached = BigInt(start + sent);
      const prev = await prisma.download.findUnique({ where: { id: download.id }, select: { bytesSent: true } });
      const bytesSent = prev && prev.bytesSent > reached ? prev.bytesSent : reached;
      const completed = outcome === 'COMPLETED' && end === size - 1;
      await prisma.download.update({
        where: { id: download.id },
        data: {
          bytesSent,
          status: completed ? 'COMPLETED' : outcome === 'COMPLETED' ? 'IN_PROGRESS' : outcome,
          completedAt: completed ? new Date() : undefined,
          failureReason: completed ? null : (reason ?? undefined),
          // Nothing delivered → refund.
          ...(outcome !== 'COMPLETED' && bytesSent === 0n ? { countsToQuota: false } : {}),
        },
      });
    };

    res.on('finish', () => {
      finished = true;
      void settle('COMPLETED').catch(console.error);
    });
    res.on('close', () => {
      if (finished) return;
      stream.destroy();
      void settle('INTERRUPTED', 'Connection closed before the download finished').catch(console.error);
    });
    stream.on('error', (err) => {
      if (finished) return;
      finished = true;
      void settle('FAILED', `Read error: ${err.message}`).catch(console.error);
      res.destroy(err);
    });
    stream.pipe(res);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize } = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const where = { userId: req.user!.id };
    const [rows, total, quota] = await Promise.all([
      prisma.download.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { video: { select: { id: true, title: true, durationSec: true, isPremium: true } } },
      }),
      prisma.download.count({ where }),
      getQuota(req.user!),
    ]);
    const now = Date.now();
    res.json({
      items: rows.map((d) => ({
        id: d.id,
        video: { ...d.video, thumbnailUrl: `/api/videos/${d.video.id}/thumbnail` },
        status: d.status,
        plan: d.plan,
        countsToQuota: d.countsToQuota,
        fileSizeBytes: d.fileSizeBytes,
        bytesSent: d.bytesSent,
        failureReason: d.failureReason,
        createdAt: d.createdAt,
        completedAt: d.completedAt,
        browser: d.browser,
        os: d.os,
        deviceType: d.deviceType,
        // Still-valid link for a just-authorized download (e.g. user refreshed mid-flow).
        url: d.status === 'AUTHORIZED' && d.tokenExpiresAt.getTime() > now ? fileUrl(d.token) : null,
      })),
      total,
      page,
      pageSize,
      quota,
    });
  }),
);

router.get(
  '/admin/audit',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        userId: z.string().optional(),
        videoId: z.string().optional(),
        status: z.enum(['AUTHORIZED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'INTERRUPTED']).optional(),
      })
      .parse(req.query);
    const where = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.videoId ? { videoId: q.videoId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.download.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * 50,
        take: 50,
        include: {
          user: { select: { id: true, email: true, username: true } },
          video: { select: { id: true, title: true } },
        },
      }),
      prisma.download.count({ where }),
    ]);
    res.json({ items: rows.map(({ token: _t, ...d }) => d), total, page: q.page, pageSize: 50 });
  }),
);
