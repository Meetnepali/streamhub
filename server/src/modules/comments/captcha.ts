import { randomUUID } from 'node:crypto';
import svgCaptcha from 'svg-captcha';

const TTL_MS = 5 * 60_000;
const store = new Map<string, { answer: string; userId: string; expiresAt: number }>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}

export function createCaptcha(userId: string) {
  sweep();
  const c = svgCaptcha.create({ size: 5, noise: 3, ignoreChars: '0oO1ilI', color: true, background: '#f4f4f5' });
  const token = randomUUID();
  store.set(token, { answer: c.text.toLowerCase(), userId, expiresAt: Date.now() + TTL_MS });
  return { token, svg: c.data };
}

/** One-shot: a token is consumed whether or not the answer is right. */
export function verifyCaptcha(userId: string, token: string | undefined, answer: string | undefined) {
  if (!token || !answer) return false;
  const entry = store.get(token);
  store.delete(token);
  if (!entry || entry.userId !== userId || entry.expiresAt < Date.now()) return false;
  return entry.answer === answer.trim().toLowerCase();
}

/** Users who solved a CAPTCHA recently get a short grace period. */
const solvedUntil = new Map<string, number>();
export function markSolved(userId: string) {
  solvedUntil.set(userId, Date.now() + 10 * 60_000);
}
export function recentlySolved(userId: string) {
  return (solvedUntil.get(userId) ?? 0) > Date.now();
}
