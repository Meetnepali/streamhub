import { createContext, useContext } from 'react';
import type { User } from '../../lib/types';
import type { CommentDTO } from './types';

export type NoticeKind = 'success' | 'error' | 'info' | 'warning';

export interface CommentsContextValue {
  user: User | null;
  targetLang: string;
  /** Posts a comment (handles CAPTCHA + block messages). Resolves null when it wasn't posted. */
  postComment: (content: string, parentId?: string | null) => Promise<CommentDTO | null>;
  requireLogin: () => void;
  notify: (message: string, kind?: NoticeKind) => void;
}

export const CommentsContext = createContext<CommentsContextValue | null>(null);

export function useComments() {
  const ctx = useContext(CommentsContext);
  if (!ctx) throw new Error('useComments must be used inside CommentsSection');
  return ctx;
}
