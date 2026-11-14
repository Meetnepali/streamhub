const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Wall-clock parts of `date` in Asia/Kolkata. */
export function istParts(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/** IST calendar date as YYYY-MM-DD — the key for daily quotas, which reset at IST midnight. */
export function istDateKey(date = new Date()): string {
  const p = istParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** IST month as YYYY-MM. */
export function istMonthKey(date = new Date()): string {
  return istDateKey(date).slice(0, 7);
}

/** UTC instant of the next IST midnight. */
export function nextIstMidnight(date = new Date()): Date {
  const p = istParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1) - IST_OFFSET_MS);
}

/** UTC instant of the start of the current IST month. */
export function istMonthStart(date = new Date()): Date {
  const p = istParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, 1) - IST_OFFSET_MS);
}

/** UTC instant of the start of the current IST day. */
export function istDayStart(date = new Date()): Date {
  const p = istParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - IST_OFFSET_MS);
}

/** 05:00–11:59 IST → light, everything else → dark. */
export function themeForLoginTime(date = new Date()): 'LIGHT' | 'DARK' {
  const { hour } = istParts(date);
  return hour >= 5 && hour < 12 ? 'LIGHT' : 'DARK';
}
