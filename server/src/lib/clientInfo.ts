import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { UAParser } from 'ua-parser-js';

export interface GeoInfo {
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ClientInfo extends GeoInfo {
  ip: string | null;
  userAgent: string;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: 'Desktop' | 'Mobile' | 'Tablet';
  deviceModel: string | null;
  /** Random per-browser id the client keeps in localStorage and sends as X-Device-Key. */
  deviceKey: string | null;
  /** Hash of browser + OS + device type: identifies "the same browser on the same machine type". */
  fingerprint: string;
}

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;

export function getClientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const raw = (Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0])?.trim() || req.socket.remoteAddress || null;
  return raw?.replace(/^::ffff:/, '') ?? null;
}

export function isPrivateIp(ip: string | null) {
  return !ip || PRIVATE_IP.test(ip);
}

const geoCache = new Map<string, { at: number; ip: string | null; geo: GeoInfo }>();
const EMPTY_GEO: GeoInfo = { city: null, state: null, country: null, latitude: null, longitude: null };

/**
 * Resolve public IP + approximate location via ip-api.com (free tier, no key).
 * For private/loopback IPs (local dev) we look up the server's own public IP instead,
 * which is the user's public IP when running locally.
 */
export async function resolveGeo(ip: string | null): Promise<{ ip: string | null; geo: GeoInfo }> {
  const lookupSelf = isPrivateIp(ip);
  const key = lookupSelf ? 'self' : ip!;
  const cached = geoCache.get(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return { ip: cached.ip, geo: cached.geo };

  try {
    const url = `http://ip-api.com/json/${lookupSelf ? '' : encodeURIComponent(ip!)}?fields=status,query,city,regionName,country,lat,lon`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const data = (await res.json()) as {
      status: string; query: string; city: string; regionName: string; country: string; lat: number; lon: number;
    };
    if (data.status !== 'success') throw new Error('geo lookup failed');
    const out = {
      ip: data.query,
      geo: { city: data.city || null, state: data.regionName || null, country: data.country || null, latitude: data.lat, longitude: data.lon },
    };
    geoCache.set(key, { at: Date.now(), ...out });
    return out;
  } catch {
    return { ip, geo: EMPTY_GEO };
  }
}

export function parseUserAgent(ua: string) {
  const r = new UAParser(ua).getResult();
  const type = r.device.type;
  const deviceType: ClientInfo['deviceType'] = type === 'mobile' ? 'Mobile' : type === 'tablet' ? 'Tablet' : 'Desktop';
  const model = [r.device.vendor, r.device.model].filter(Boolean).join(' ') || null;
  return {
    browser: r.browser.name ?? null,
    browserVersion: r.browser.version ?? null,
    os: r.os.name ?? null,
    osVersion: r.os.version ?? null,
    deviceType,
    deviceModel: model,
  };
}

export function fingerprintOf(browser: string | null, os: string | null, deviceType: string) {
  return createHash('sha256').update(`${browser ?? '?'}|${os ?? '?'}|${deviceType}`).digest('hex').slice(0, 32);
}

/** Cheap, synchronous info (no geo). */
export function basicClientInfo(req: Request) {
  const userAgent = req.get('user-agent') ?? '';
  const ua = parseUserAgent(userAgent);
  const deviceKey = (req.get('x-device-key') ?? '').slice(0, 64) || null;
  return {
    ip: getClientIp(req),
    userAgent,
    ...ua,
    deviceKey,
    fingerprint: fingerprintOf(ua.browser, ua.os, ua.deviceType),
  };
}

export async function getClientInfo(req: Request): Promise<ClientInfo> {
  const basic = basicClientInfo(req);
  const { ip, geo } = await resolveGeo(basic.ip);
  return { ...basic, ip, ...geo };
}
