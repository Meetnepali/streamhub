export type Reaction = 'LIKE' | 'DISLIKE';
export type SortMode = 'relevant' | 'newest' | 'oldest' | 'most_liked';
export type ReportReason = 'SPAM' | 'HARASSMENT' | 'OFFENSIVE' | 'HATE_SPEECH' | 'MISINFORMATION' | 'OTHER';

export interface CommentDTO {
  id: string;
  videoId: string;
  parentId: string | null;
  content: string | null;
  placeholder: string | null;
  status: 'VISIBLE' | 'FLAGGED' | 'HIDDEN' | 'DELETED';
  language: string | null;
  author: { id: string; username: string; name: string; avatarUrl: string | null } | null;
  location: { city: string | null; country: string | null } | null;
  createdAt: string;
  editedAt: string | null;
  edited: boolean;
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  myReaction: Reaction | null;
  version: number;
  mentions: string[];
  isAuthor: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editableUntil: string | null;
}

export interface CommentPage {
  items: CommentDTO[];
  nextCursor: number | null;
  total: number;
  editWindowMinutes: number;
}

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
  { code: 'mr', label: 'मराठी (Marathi)' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'zh', label: '中文 (Chinese)' },
  { code: 'ja', label: '日本語 (Japanese)' },
];

export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'SPAM', label: 'Spam or misleading', hint: 'Ads, scams, repetitive or irrelevant content' },
  { value: 'HARASSMENT', label: 'Harassment or bullying', hint: 'Targets or threatens a person' },
  { value: 'OFFENSIVE', label: 'Offensive content', hint: 'Abusive, vulgar or sexual language' },
  { value: 'HATE_SPEECH', label: 'Hate speech', hint: 'Attacks a group based on identity' },
  { value: 'MISINFORMATION', label: 'Misinformation', hint: 'False or harmful information' },
  { value: 'OTHER', label: 'Something else', hint: 'Tell us more below' },
];

export const BLOCK_REASON_TITLES: Record<string, string> = {
  PROFANITY: 'Language not allowed',
  SPAM: 'Looks like spam',
  DUPLICATE: 'Duplicate comment',
  REPEATED_CHARS: 'Not enough to say',
  MALICIOUS_LINK: 'Unsafe link',
  RATE_LIMIT: 'Slow down',
  CAPTCHA: 'Verification needed',
};

const LANG_KEY = 'sh_comment_lang';

export function getPreferredLang(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (navigator.language || 'en').split('-')[0];
  return LANGUAGES.some((l) => l.code === nav) ? nav : 'en';
}

export function setPreferredLang(code: string) {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* storage unavailable */
  }
}

export function languageName(code: string | null) {
  if (!code) return 'Unknown';
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
