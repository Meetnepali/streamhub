import { config } from '../../config.js';
import { HttpError } from '../../lib/http.js';

export const SUPPORTED_LANGS = ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'es', 'fr', 'de', 'pt', 'it', 'ar', 'zh', 'ja', 'ko', 'ru'];

async function libreTranslate(text: string, target: string) {
  const res = await fetch(`${config.comments.libreTranslateUrl.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'auto', target, format: 'text', api_key: config.comments.libreTranslateKey || undefined }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`LibreTranslate ${res.status}`);
  const data = (await res.json()) as { translatedText?: string; detectedLanguage?: { language?: string } };
  if (!data.translatedText) throw new Error('empty translation');
  return { text: data.translatedText, sourceLang: data.detectedLanguage?.language ?? null };
}

async function myMemory(text: string, source: string, target: string) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${source}|${target}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = (await res.json()) as { responseStatus: number | string; responseData?: { translatedText?: string } };
  const out = data.responseData?.translatedText;
  if (Number(data.responseStatus) !== 200 || !out || /^(MYMEMORY WARNING|INVALID|PLEASE SELECT)/i.test(out)) {
    throw new Error(`MyMemory: ${out ?? data.responseStatus}`);
  }
  return { text: out, sourceLang: source };
}

export async function translateText(text: string, sourceLang: string | null, target: string) {
  try {
    if (config.comments.libreTranslateUrl) return await libreTranslate(text, target);
    const src = sourceLang && sourceLang !== target ? sourceLang : 'en';
    if (src === target) return { text, sourceLang: src };
    return await myMemory(text, src, target);
  } catch (err) {
    console.warn('[comments] translation failed:', (err as Error).message);
    throw new HttpError(502, 'Translation is unavailable right now. Please try again later.', 'TRANSLATION_FAILED');
  }
}
