import { prisma } from '../../lib/prisma.js';
import { activeStreams } from './service.js';

const STALL_MS = 10 * 60_000;

/**
 * - AUTHORIZED links that expired unused → FAILED and refunded (nothing was delivered).
 * - IN_PROGRESS downloads not streaming in this process for 10+ minutes → INTERRUPTED
 *   (refunded only if no bytes were delivered).
 */
export async function sweepStaleDownloads() {
  const now = new Date();
  await prisma.download.updateMany({
    where: { status: 'AUTHORIZED', tokenExpiresAt: { lt: now } },
    data: { status: 'FAILED', failureReason: 'Download link expired before use', countsToQuota: false },
  });

  const stale = await prisma.download.findMany({
    where: { status: 'IN_PROGRESS', startedAt: { lt: new Date(now.getTime() - STALL_MS) } },
    select: { id: true, bytesSent: true },
  });
  for (const d of stale) {
    if (activeStreams.has(d.id)) continue;
    await prisma.download.update({
      where: { id: d.id },
      data: {
        status: 'INTERRUPTED',
        failureReason: 'Download stalled',
        ...(d.bytesSent === 0n ? { countsToQuota: false } : {}),
      },
    });
  }
}
