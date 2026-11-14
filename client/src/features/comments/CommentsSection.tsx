import { Languages, MessageSquare, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { api, ApiError, errorMessage } from '../../lib/api';
import { CommentItem } from './CommentItem';
import { Composer } from './Composer';
import { CommentsContext, type NoticeKind } from './context';
import { Modal } from './Modal';
import {
  BLOCK_REASON_TITLES,
  getPreferredLang,
  LANGUAGES,
  setPreferredLang,
  type CommentDTO,
  type CommentPage,
  type SortMode,
} from './types';
import './comments.css';

const SORTS: { value: SortMode; label: string }[] = [
  { value: 'relevant', label: 'Most relevant' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'most_liked', label: 'Most liked' },
];

type CaptchaResult = { token: string; answer: string } | null;

export function CommentsSection({ videoId }: { videoId: string }) {
  const { user } = useAuth();
  const location = useLocation();
  const [sort, setSort] = useState<SortMode>('relevant');
  const [items, setItems] = useState<CommentDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState(getPreferredLang);
  const [notice, setNotice] = useState<{ message: string; kind: NoticeKind } | null>(null);
  const [blockNotice, setBlockNotice] = useState<{ title: string; message: string } | null>(null);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [captcha, setCaptcha] = useState<{ invalid: boolean; resolve: (r: CaptchaResult) => void } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  const notify = useCallback((message: string, kind: NoticeKind = 'info') => {
    setNotice({ message, kind });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4500);
  }, []);

  const load = useCallback(
    async (cursor = 0) => {
      const r = await api.get<CommentPage>(`/comments/video/${encodeURIComponent(videoId)}?sort=${sort}&cursor=${cursor}`);
      setTotal(r.total);
      setNextCursor(r.nextCursor);
      setItems((prev) => {
        if (cursor === 0) return r.items;
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...r.items.filter((c) => !seen.has(c.id))];
      });
    },
    [videoId, sort],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(0)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [load, user?.id]);

  const askCaptcha = (invalid: boolean) => new Promise<CaptchaResult>((resolve) => setCaptcha({ invalid, resolve }));

  const postComment = useCallback(
    async (content: string, parentId?: string | null): Promise<CommentDTO | null> => {
      if (!user) {
        setLoginPrompt(true);
        return null;
      }
      setBlockNotice(null);
      let captchaFields: { captchaToken?: string; captchaAnswer?: string } = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const { comment } = await api.post<{ comment: CommentDTO }>('/comments', { videoId, parentId, content, ...captchaFields });
          if (!comment.parentId) {
            setItems((prev) => [comment, ...prev]);
            setTotal((t) => t + 1);
          }
          return comment;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'CAPTCHA_REQUIRED') {
            const solved = await askCaptcha(!!err.details?.invalid);
            setCaptcha(null);
            if (!solved) return null;
            captchaFields = { captchaToken: solved.token, captchaAnswer: solved.answer };
            continue;
          }
          if (err instanceof ApiError && err.details?.reason) {
            setBlockNotice({ title: BLOCK_REASON_TITLES[err.details.reason] ?? 'Comment not posted', message: err.message });
            return null;
          }
          if (err instanceof ApiError && (err.code === 'PARENT_DELETED' || err.code === 'PARENT_NOT_FOUND')) {
            notify(err.message, 'warning');
            return null;
          }
          notify(errorMessage(err), 'error');
          return null;
        }
      }
      return null;
    },
    [user, videoId, notify],
  );

  const requireLogin = useCallback(() => setLoginPrompt(true), []);

  return (
    <CommentsContext.Provider value={{ user, targetLang, postComment, requireLogin, notify }}>
      <section className="cm-section">
        <div className="row wrap cm-header">
          <h2 className="cm-title">
            <MessageSquare size={20} /> {total} {total === 1 ? 'Comment' : 'Comments'}
          </h2>
          <div className="spacer" />
          <label className="row cm-control" title="Translate comments into">
            <Languages size={16} />
            <select
              className="select cm-select"
              value={targetLang}
              onChange={(e) => {
                setTargetLang(e.target.value);
                setPreferredLang(e.target.value);
              }}
              aria-label="Translate comments into"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <select className="select cm-select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label="Sort comments">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="cm-item cm-new">
          {user ? <Avatar name={user.name} src={user.avatarUrl} size={38} /> : <span className="cm-avatar-ghost" style={{ width: 38, height: 38 }} />}
          <div className="cm-main">
            {user ? (
              <Composer onSubmit={async (content) => !!(await postComment(content, null))} />
            ) : (
              <div className="cm-guest">
                <Link to="/login" state={{ from: location.pathname + location.search }} className="btn primary sm">Sign in</Link>
                <span className="muted">to join the conversation.</span>
              </div>
            )}
            {blockNotice && (
              <div className="alert warning cm-block" role="alert">
                <strong>{blockNotice.title}.</strong> {blockNotice.message}
                <button className="btn ghost sm" onClick={() => setBlockNotice(null)} style={{ marginLeft: 8 }}>Dismiss</button>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="row" style={{ justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>
        ) : error ? (
          <div className="alert error row">
            Couldn’t load comments: {error}
            <div className="spacer" />
            <button className="btn sm" onClick={() => { setLoading(true); load(0).then(() => setError(null)).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false)); }}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">No comments yet. Start the conversation!</div>
        ) : (
          <div className="cm-list">
            {items.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                onRemoved={(id) => {
                  setItems((list) => list.filter((x) => x.id !== id));
                  setTotal((t) => Math.max(0, t - 1));
                }}
              />
            ))}
            {nextCursor !== null && (
              <button
                className="btn block"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  load(nextCursor).catch((e) => notify(errorMessage(e), 'error')).finally(() => setLoadingMore(false));
                }}
              >
                {loadingMore ? 'Loading…' : 'Show more comments'}
              </button>
            )}
          </div>
        )}

        {notice && <div className={`alert ${notice.kind} cm-toast`} role="status">{notice.message}</div>}

        {loginPrompt && (
          <Modal title="Sign in to continue" onClose={() => setLoginPrompt(false)}>
            <p className="muted" style={{ marginTop: 0 }}>You need an account to comment, react, reply or report.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Link className="btn" to="/register" state={{ from: location.pathname }}>Create account</Link>
              <Link className="btn primary" to="/login" state={{ from: location.pathname + location.search }}>Sign in</Link>
            </div>
          </Modal>
        )}

        {captcha && <CaptchaModal invalid={captcha.invalid} onDone={captcha.resolve} />}
      </section>
    </CommentsContext.Provider>
  );
}

function CaptchaModal({ invalid, onDone }: { invalid: boolean; onDone: (r: CaptchaResult) => void }) {
  const [challenge, setChallenge] = useState<{ token: string; svg: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setChallenge(null);
    setAnswer('');
    api
      .get<{ token: string; svg: string }>('/comments/captcha')
      .then(setChallenge)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <Modal title="Quick check" onClose={() => onDone(null)}>
      <p className="muted" style={{ marginTop: 0 }}>
        You’ve been posting a lot. Type the characters below to confirm you’re human.
      </p>
      {invalid && <div className="alert error" style={{ marginBottom: 12 }}>That answer wasn’t right — here’s a new one.</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="cm-captcha">
          {challenge ? (
            // Server-generated SVG (svg-captcha), not user content.
            <span dangerouslySetInnerHTML={{ __html: challenge.svg }} />
          ) : (
            <div className="spinner" />
          )}
        </div>
        <button className="btn icon" onClick={refresh} title="New challenge" aria-label="New challenge">
          <RefreshCw size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (challenge && answer.trim()) onDone({ token: challenge.token, answer: answer.trim() });
        }}
      >
        <input
          className="input"
          autoFocus
          placeholder="Enter the characters"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error && <div className="alert error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn primary" disabled={!challenge || !answer.trim()}>Verify & post</button>
        </div>
      </form>
    </Modal>
  );
}
