import { getDeviceKey } from '../../lib/deviceKey';
import type { ProgressResponse } from './types';

export interface ProgressPayload {
  positionSec: number;
  durationSec: number;
  watchedDeltaSec: number;
}

/** keepalive lets the final save survive page unload / navigation. */
export async function saveProgress(videoId: string, payload: ProgressPayload, keepalive = false): Promise<ProgressResponse | null> {
  try {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/progress`, {
      method: 'PUT',
      credentials: 'include',
      keepalive,
      headers: { 'Content-Type': 'application/json', 'X-Device-Key': getDeviceKey() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProgressResponse;
  } catch {
    return null;
  }
}
