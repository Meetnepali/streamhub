import cron from 'node-cron';
import { downgradeExpiredSubscriptions, sendRenewalReminders } from '../modules/subscriptions/jobs.js';
import { sweepStaleDownloads } from '../modules/downloads/jobs.js';

export function startJobs() {
  // Downgrade expired plans to FREE every 10 minutes (entitlements are also checked live on every request).
  cron.schedule('*/10 * * * *', () => void downgradeExpiredSubscriptions().catch(console.error));
  // Renewal reminders daily at 09:00 IST.
  cron.schedule('0 9 * * *', () => void sendRenewalReminders().catch(console.error), { timezone: 'Asia/Kolkata' });
  // Mark abandoned downloads as interrupted.
  cron.schedule('*/5 * * * *', () => void sweepStaleDownloads().catch(console.error));
  void downgradeExpiredSubscriptions().catch(console.error);
}
