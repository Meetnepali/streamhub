const KEY = 'sh_device_key';
let cached: string | null = null;

/** Random id identifying this browser profile; sent as X-Device-Key for trusted-device checks. */
export function getDeviceKey(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = crypto.randomUUID();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached ??= crypto.randomUUID();
  }
  return cached;
}
