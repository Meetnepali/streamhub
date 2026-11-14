import { createHash } from 'node:crypto';

export type BlockReason =
  | 'PROFANITY'
  | 'SPAM'
  | 'DUPLICATE'
  | 'REPEATED_CHARS'
  | 'MALICIOUS_LINK'
  | 'RATE_LIMIT'
  | 'CAPTCHA';

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  PROFANITY: 'Your comment contains language that isn’t allowed. Please keep it respectful.',
  SPAM: 'Your comment looks like spam or self-promotion, so it wasn’t posted.',
  DUPLICATE: 'You already posted this comment. Try saying something new.',
  REPEATED_CHARS: 'Comments made only of repeated characters, symbols or emojis aren’t allowed.',
  MALICIOUS_LINK: 'Your comment contains a link that looks unsafe, so it wasn’t posted.',
  RATE_LIMIT: 'You’re commenting too fast. Please wait a moment before posting again.',
  CAPTCHA: 'Please complete the CAPTCHA to continue posting.',
};

// ───────── Profanity ─────────

/**
 * Normalized (lowercase, de-accented, de-leeted, repeated letters collapsed) abusive words.
 * English plus common Hindi/Hinglish romanized abuse and a few Devanagari forms.
 * Matched on word boundaries to avoid the Scunthorpe problem.
 */
const PROFANITY = [
  // English
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'ashole',
  'dick', 'dickhead', 'cunt', 'pussy', 'whore', 'slut', 'retard', 'faggot', 'fag', 'nigger', 'nigga',
  'wanker', 'twat', 'prick', 'cock', 'jackass', 'douchebag', 'kys',
  // Hindi / Hinglish (romanized)
  'chutiya', 'chutia', 'chutiye', 'madarchod', 'bhenchod', 'behenchod', 'bhosdike', 'bhosdi',
  'bhosda', 'gandu', 'gaandu', 'gand', 'lauda', 'loda', 'lavda', 'lund', 'randi', 'harami', 'haramkhor',
  'kamina', 'kamine', 'kutta', 'kutti', 'saala', 'saali', 'chod', 'chodu', 'jhatu', 'tatti', 'bsdk',
  // Spanish / misc
  'puta', 'puto', 'mierda', 'cabron', 'pendejo', 'merde', 'putain', 'scheisse',
];

const DEVANAGARI_PROFANITY = ['चूतिया', 'मादरचोद', 'भेनचोद', 'बहनचोद', 'भोसडी', 'गांडू', 'रंडी', 'हरामी', 'कमीना', 'लौड़ा', 'साला'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '+': 't' };

export function normalizeForMatching(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!+]/g, (c) => LEET[c] ?? c)
    // f.u.c.k / f-u-c-k / f u c k → fuck (single letters separated by punctuation/space)
    .replace(/\b(?:[a-z][\s.\-_*]){2,}[a-z]\b/g, (m) => m.replace(/[\s.\-_*]/g, ''))
    .replace(/[*_.\-]/g, '')
    // collapse 3+ repeats: fuuuuck → fuck (keep doubles: "ass", "kutta")
    .replace(/([a-z])\1{2,}/g, '$1$1');
}

const PROFANITY_RE = new RegExp(`(?:^|[^a-z])(${PROFANITY.join('|')})(?:s|es|ed|ing)?(?=$|[^a-z])`, 'i');

const PROFANITY_SET = new Set(PROFANITY);

/** Catch masked words like "ch*tiya" / "f#ck": each mask char stands for exactly one letter. */
function maskedProfanity(text: string) {
  const tokens = text.toLowerCase().match(/[a-z0-9@$!*#]*[*#][a-z0-9@$!*#]*/g) ?? [];
  for (const token of tokens) {
    const letters = token.replace(/[0134578@$!+]/g, (c) => LEET[c] ?? c);
    if ((letters.match(/[a-z]/g) ?? []).length < 2) continue;
    const re = new RegExp(`^${letters.replace(/[*#]/g, '[a-z]')}$`);
    for (const word of PROFANITY_SET) if (re.test(word)) return true;
  }
  return false;
}

export function containsProfanity(text: string) {
  if (maskedProfanity(text)) return true;
  const norm = normalizeForMatching(text);
  // also test the variant where doubled letters collapse to single (fuuck → fuck)
  const single = norm.replace(/([a-z])\1+/g, '$1');
  if (PROFANITY_RE.test(norm) || PROFANITY_RE.test(single)) return true;
  return DEVANAGARI_PROFANITY.some((w) => text.includes(w));
}

// ───────── Links ─────────

const URL_RE = /\b((?:https?|ftp|javascript|data|vbscript|file):[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|in|co|ly|gl|gd|cc|me|to|xyz|top|ru|tk|ml|ga|cf|gq|click|link|info|biz|shop|site|online|live|win|loan|zip|mov)\b[^\s<>"']*)/gi;

const SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'rebrand.ly', 'bl.ink', 'v.gd', 's.id'];
const BAD_TLDS = ['xyz', 'top', 'tk', 'ml', 'ga', 'cf', 'gq', 'click', 'loan', 'win', 'zip', 'mov', 'ru'];

export function extractLinks(text: string) {
  return text.match(URL_RE) ?? [];
}

export function isMaliciousLink(raw: string) {
  const lower = raw.toLowerCase();
  if (/^(javascript|data|vbscript|file):/.test(lower)) return true;
  let host: string;
  try {
    host = new URL(/^[a-z]+:/.test(lower) ? lower : `http://${lower}`).hostname;
  } catch {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true; // raw IP
  if (host.startsWith('xn--') || host.includes('.xn--')) return true; // punycode lookalikes
  if (SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) return true;
  const tld = host.split('.').pop() ?? '';
  if (BAD_TLDS.includes(tld)) return true;
  if (/@/.test(lower.replace(/^[a-z]+:\/\//, '').split('/')[0])) return true; // user@host obfuscation
  return false;
}

// ───────── Spam ─────────

const SPAM_PATTERNS = [
  /\b(buy|order)\s+now\b/i,
  /\bfree\s+(money|followers|subscribers|likes|views|iphone|gift\s*card|recharge)\b/i,
  /\b(click|visit|check)\s+(here|my\s+(channel|profile|link|bio))\b/i,
  /\bsub(scribe)?\s*(4|for)\s*sub\b/i,
  /\b(earn|make)\s+(\$|₹|rs\.?\s*)?\d+[k]?\s*(per|a|\/)\s*(day|hour|week)\b/i,
  /\b(whats\s*app|telegram|dm)\s+(me|now)\b.*\d{6,}/i,
  /\b(crypto|bitcoin|forex)\s+(investment|signals|profit)\b/i,
  /\bwork\s+from\s+home\b.*\b(earn|income)\b/i,
  /\b(promo|discount|coupon)\s+code\b/i,
  /\b(100%|guaranteed)\s+(profit|returns|income)\b/i,
];

export function looksLikeSpam(text: string) {
  if (extractLinks(text).length > 2) return true;
  if (SPAM_PATTERNS.some((re) => re.test(text))) return true;
  // SHOUTING with long length
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 30 && letters === letters.toUpperCase()) return true;
  // the same word repeated many times
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length >= 6) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    if (Math.max(...counts.values()) / words.length > 0.6) return true;
  }
  return false;
}

// ───────── Repeated characters / emoji-only ─────────

export function isRepeatedJunk(text: string) {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return true;
  // Any single character repeated 10+ times in a row
  if (/(.)\1{9,}/u.test(compact)) return true;
  const hasWordChars = /[\p{L}\p{N}]/u.test(compact);
  if (!hasWordChars) {
    // Only symbols/emojis: allow a short reaction (≤ 3 graphemes), block longer runs.
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(compact)];
    if (graphemes.length > 3) return true;
    if (new Set(graphemes.map((g) => g.segment)).size === 1 && graphemes.length > 1) return true;
  }
  // Mostly special characters
  const special = compact.replace(/[\p{L}\p{N}]/gu, '').length;
  if (compact.length >= 8 && special / compact.length > 0.7) return true;
  return false;
}

// ───────── Content checks pipeline ─────────

export function checkContent(text: string): BlockReason | null {
  const links = extractLinks(text);
  if (links.some(isMaliciousLink)) return 'MALICIOUS_LINK';
  if (containsProfanity(text)) return 'PROFANITY';
  if (isRepeatedJunk(text)) return 'REPEATED_CHARS';
  if (looksLikeSpam(text)) return 'SPAM';
  return null;
}

export function contentHash(text: string) {
  const norm = text.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return createHash('sha256').update(norm).digest('hex');
}

// ───────── Language detection ─────────

const SCRIPTS: [RegExp, string][] = [
  [/[ऀ-ॿ]/, 'hi'], // Devanagari (Hindi/Marathi — refined below)
  [/[ঀ-৿]/, 'bn'],
  [/[஀-௿]/, 'ta'],
  [/[ఀ-౿]/, 'te'],
  [/[઀-૿]/, 'gu'],
  [/[਀-੿]/, 'pa'],
  [/[ಀ-೿]/, 'kn'],
  [/[ഀ-ൿ]/, 'ml'],
  [/[؀-ۿ]/, 'ar'],
  [/[぀-ヿ]/, 'ja'],
  [/[가-힯]/, 'ko'],
  [/[一-鿿]/, 'zh'],
  [/[Ѐ-ӿ]/, 'ru'],
  [/[฀-๿]/, 'th'],
];

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'this', 'that', 'was', 'with', 'for', 'you', 'what', 'have', 'it', 'not', 'great', 'video'],
  es: ['el', 'la', 'los', 'las', 'que', 'es', 'muy', 'pero', 'por', 'con', 'una', 'para', 'gracias', 'como'],
  fr: ['le', 'les', 'est', 'une', 'des', 'et', 'pas', 'très', 'pour', 'avec', 'merci', 'cette', 'mais', 'c\'est'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'sehr', 'mit', 'ein', 'eine', 'danke', 'auch'],
  pt: ['o', 'os', 'não', 'muito', 'obrigado', 'uma', 'com', 'para', 'mas', 'você', 'é'],
  it: ['il', 'che', 'non', 'molto', 'grazie', 'sono', 'una', 'per', 'questo', 'è'],
  // Romanized Hindi (Hinglish)
  hi: ['hai', 'hain', 'bahut', 'accha', 'acha', 'kya', 'nahi', 'mera', 'tera', 'aap', 'kaise', 'bhai', 'yaar', 'thik', 'kyu', 'karo', 'video', 'mast'],
};

const MARATHI_HINTS = ['आहे', 'आणि', 'नाही', 'खूप', 'छान', 'मी', 'तुम्ही'];

export function detectLanguage(text: string): string {
  for (const [re, lang] of SCRIPTS) {
    if (re.test(text)) {
      if (lang === 'hi' && MARATHI_HINTS.some((w) => text.includes(w))) return 'mr';
      if (lang === 'zh' && /[぀-ヿ]/.test(text)) return 'ja';
      return lang;
    }
  }
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let best = 'en';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const score = words.filter((w) => list.includes(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

export function extractMentions(text: string) {
  return [...new Set([...text.matchAll(/(?:^|[^\w@])@([a-zA-Z0-9_.]{3,30})/g)].map((m) => m[1].replace(/\.+$/, '').toLowerCase()))];
}
