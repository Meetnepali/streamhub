import {
  ChevronDown,
  ChevronUp,
  Flag,
  Languages,
  MapPin,
  MoreVertical,
  Pencil,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { api, ApiError, errorMessage } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';
import { Composer } from './Composer';
import { useComments } from './context';
import { ConfirmModal, Modal } from './Modal';
import { languageName, REPORT_REASONS, type CommentDTO, type Reaction, type ReportReason } from './types';

const TOKEN_RE = /(@[a-zA-Z0-9_.]{3,30}|https?:\/\/[^\s<>"']+)/g;

/** Renders text as React nodes (never HTML), highlighting real @mentions and linkifying http(s) URLs. */
function RichText({ text, mentions }: { text: string; mentions: string[] }) {
  const known = new Set(mentions.map((m) => m.toLowerCase()));
  const parts = text.split(TOKEN_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        if (part.startsWith('@')) {
          const name = part.slice(1).replace(/\.+$/, '');
          return known.has(name.toLowerCase()) ? (
            <span key={i} className="cm-mention">{part}</span>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          );
        }
        return (
          <a key={i} href={part} target="_blank" rel="nofollow noopener noreferrer ugc" className="cm-link">
            {part}
          </a>
        );
      })}
    </>
  );
}

function location(c: CommentDTO) {
  return [c.location?.city, c.location?.country].filter(Boolean).join(', ');
}

interface TranslationState {
  text?: string;
  showing: boolean;
  loading: boolean;
  error?: string;
  lang?: string;
}

export function CommentItem({
  comment,
  onRemoved,
  isReply,
  onThreadReply,
}: {
  comment: CommentDTO;
  onRemoved: (id: string) => void;
  isReply?: boolean;
  /** For replies: posts into the parent thread (one nesting level). */
  onThreadReply?: (content: string) => Promise<boolean>;
}) {
  const { user, targetLang, postComment, requireLogin, notify } = useComments();
  const [c, setC] = useState(comment);
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replies, setReplies] = useState<CommentDTO[] | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [tr, setTr] = useState<TranslationState>({ showing: false, loading: false });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setC(comment), [comment]);
  useEffect(() => {
    // Target language changed: drop stale translation.
    setTr({ showing: false, loading: false });
  }, [targetLang]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const removed = c.content === null;

  async function react(type: Reaction) {
    if (!user) return requireLogin();
    const next = c.myReaction === type ? null : type;
    const prev = c;
    // Optimistic
    setC({
      ...c,
      myReaction: next,
      likeCount: c.likeCount + (next === 'LIKE' ? 1 : 0) - (c.myReaction === 'LIKE' ? 1 : 0),
      dislikeCount: c.dislikeCount + (next === 'DISLIKE' ? 1 : 0) - (c.myReaction === 'DISLIKE' ? 1 : 0),
    });
    try {
      const r = await api.post<{ likeCount: number; dislikeCount: number; myReaction: Reaction | null }>(
        `/comments/${c.id}/reaction`,
        { type: next },
      );
      setC((cur) => ({ ...cur, ...r }));
    } catch (err) {
      setC(prev);
      notify(errorMessage(err), 'error');
    }
  }

  async function translate() {
    if (tr.text && tr.lang === targetLang) return setTr({ ...tr, showing: !tr.showing });
    setTr({ showing: true, loading: true });
    try {
      const r = await api.post<{ text: string; sameLanguage?: boolean }>(`/comments/${c.id}/translate`, { targetLang });
      if (r.sameLanguage) {
        setTr({ showing: false, loading: false });
        notify(`This comment is already in ${languageName(targetLang)}.`, 'info');
        return;
      }
      setTr({ text: r.text, showing: true, loading: false, lang: targetLang });
    } catch (err) {
      setTr({
        showing: false,
        loading: false,
        error: err instanceof ApiError && err.code === 'TRANSLATION_FAILED' ? 'Couldn’t translate right now. Try again later.' : errorMessage(err),
      });
    }
  }

  async function saveEdit(content: string) {
    try {
      const r = await api.patch<{ comment: CommentDTO }>(`/comments/${c.id}`, { content, version: c.version });
      setC(r.comment);
      setTr({ showing: false, loading: false });
      setEditing(false);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EDIT_CONFLICT' && err.details?.comment) {
        setC(err.details.comment);
        notify('This comment was edited elsewhere — we loaded the latest version. Re-apply your change if needed.', 'warning');
        return false;
      }
      notify(errorMessage(err), 'error');
      return false;
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      const r = await api.delete<{ keptAsPlaceholder: boolean }>(`/comments/${c.id}`);
      setConfirmDelete(false);
      if (r.keptAsPlaceholder || (replies?.length ?? c.replyCount) > 0) {
        setC({ ...c, content: null, placeholder: 'This comment was deleted', author: null, location: null, status: 'DELETED', canEdit: false, canDelete: false });
      } else onRemoved(c.id);
      notify('Comment deleted', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function loadReplies() {
    setLoadingReplies(true);
    try {
      const r = await api.get<{ items: CommentDTO[] }>(`/comments/${c.id}/replies`);
      setReplies(r.items);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoadingReplies(false);
    }
  }

  async function toggleReplies() {
    if (!showReplies && replies === null) await loadReplies();
    setShowReplies((s) => !s);
  }

  async function submitReply(content: string) {
    const created = await postComment(content, c.id);
    if (!created) return false;
    if (!showReplies && replies === null) await loadReplies();
    else setReplies((r) => [...(r ?? []), created]);
    setShowReplies(true);
    setC((cur) => ({ ...cur, replyCount: cur.replyCount + 1 }));
    setReplying(false);
    return true;
  }

  const replyHandle = !isReply ? null : c.author?.username;
  const loc = location(c);
  const displayed = tr.showing && tr.text ? tr.text : c.content;

  const menuItems: ReactNode[] = [];
  if (!removed) {
    if (c.canEdit) menuItems.push(<button key="e" onClick={() => { setEditing(true); setMenuOpen(false); }}><Pencil size={15} /> Edit</button>);
    if (c.canDelete) menuItems.push(<button key="d" onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}><Trash2 size={15} /> Delete</button>);
    if (!c.isAuthor) menuItems.push(<button key="r" onClick={() => { setMenuOpen(false); if (!user) return requireLogin(); setReportOpen(true); }}><Flag size={15} /> Report</button>);
  }

  return (
    <div className={`cm-item ${isReply ? 'reply' : ''}`}>
      {c.author ? <Avatar name={c.author.name} src={c.author.avatarUrl} size={isReply ? 28 : 38} /> : <span className="cm-avatar-ghost" style={{ width: isReply ? 28 : 38, height: isReply ? 28 : 38 }} />}
      <div className="cm-main">
        <div className="cm-meta">
          {c.author ? <span className="cm-user">@{c.author.username}</span> : <span className="cm-user muted">[deleted]</span>}
          {loc && (
            <span className="subtle cm-loc">
              <MapPin size={12} /> {loc}
            </span>
          )}
          <span className="subtle" title={formatDateTime(c.createdAt)}>{timeAgo(c.createdAt)}</span>
          {c.edited && <span className="subtle" title={c.editedAt ? `Edited ${formatDateTime(c.editedAt)}` : undefined}>(edited)</span>}
          {c.status === 'FLAGGED' && (c.isAuthor || user?.role === 'ADMIN') && <span className="badge warning">Under review</span>}
          {c.status === 'HIDDEN' && user?.role === 'ADMIN' && <span className="badge danger">Hidden</span>}
        </div>

        {editing ? (
          <Composer
            initialValue={c.content ?? ''}
            submitLabel="Save"
            autoFocus
            alwaysExpanded
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
          />
        ) : removed ? (
          <p className="cm-text cm-removed">{c.placeholder}</p>
        ) : (
          <>
            <p className="cm-text" dir="auto" lang={tr.showing ? tr.lang : c.language ?? undefined}>
              <RichText text={displayed ?? ''} mentions={c.mentions} />
            </p>
            {tr.showing && tr.text && (
              <p className="subtle cm-translated-note">
                Translated from {languageName(c.language)} to {languageName(tr.lang ?? targetLang)}
              </p>
            )}
            {tr.error && <p className="cm-inline-error">{tr.error}</p>}
          </>
        )}

        {!editing && !removed && (
          <div className="cm-actions">
            <button className={`cm-act ${c.myReaction === 'LIKE' ? 'on' : ''}`} onClick={() => void react('LIKE')} aria-pressed={c.myReaction === 'LIKE'} title="Like">
              <ThumbsUp size={15} /> {c.likeCount > 0 && c.likeCount}
            </button>
            <button className={`cm-act ${c.myReaction === 'DISLIKE' ? 'on' : ''}`} onClick={() => void react('DISLIKE')} aria-pressed={c.myReaction === 'DISLIKE'} title="Dislike">
              <ThumbsDown size={15} /> {c.dislikeCount > 0 && c.dislikeCount}
            </button>
            <button className="cm-act" onClick={() => (user ? setReplying((r) => !r) : requireLogin())}>
              Reply
            </button>
            <button className="cm-act" onClick={() => void translate()} disabled={tr.loading}>
              <Languages size={15} /> {tr.loading ? 'Translating…' : tr.showing ? 'Show original' : 'Translate'}
            </button>
            {menuItems.length > 0 && (
              <div className="menu" ref={menuRef}>
                <button className="cm-act" onClick={() => setMenuOpen((o) => !o)} aria-label="More actions">
                  <MoreVertical size={15} />
                </button>
                {menuOpen && <div className="menu-panel cm-menu">{menuItems}</div>}
              </div>
            )}
            {c.canEdit && c.editableUntil && (
              <span className="subtle cm-window" title="You can edit or delete until this time">
                editable until {new Date(c.editableUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {replying && (
          <Composer
            placeholder={`Reply to @${c.author?.username ?? 'comment'}…`}
            submitLabel="Reply"
            autoFocus
            alwaysExpanded
            initialValue={replyHandle ? `@${replyHandle} ` : ''}
            onSubmit={isReply && onThreadReply ? async (content) => (await onThreadReply(content)) && (setReplying(false), true) : submitReply}
            onCancel={() => setReplying(false)}
          />
        )}

        {!isReply && c.replyCount > 0 && (
          <button className="cm-replies-toggle" onClick={() => void toggleReplies()} disabled={loadingReplies}>
            {showReplies ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {loadingReplies ? 'Loading…' : `${showReplies ? 'Hide' : 'View'} ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}`}
          </button>
        )}

        {!isReply && showReplies && replies && (
          <div className="cm-replies">
            {replies.map((r) => (
              <CommentItem
                key={r.id}
                comment={r}
                isReply
                onThreadReply={submitReply}
                onRemoved={(id) => {
                  setReplies((list) => list?.filter((x) => x.id !== id) ?? null);
                  setC((cur) => ({ ...cur, replyCount: Math.max(0, cur.replyCount - 1) }));
                }}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete comment?"
          message={
            c.replyCount > 0
              ? 'Your comment will be removed. Replies will stay, under a “deleted” placeholder.'
              : 'This will permanently remove your comment.'
          }
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={() => void doDelete()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {reportOpen && <ReportModal commentId={c.id} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function ReportModal({ commentId, onClose }: { commentId: string; onClose: () => void }) {
  const { notify } = useComments();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/comments/${commentId}/report`, { reason, details: details.trim() || undefined });
      notify('Thanks — a moderator will review this comment.', 'success');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_REPORTED') {
        notify(err.message, 'info');
        onClose();
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Report comment" onClose={onClose}>
      <div className="stack" style={{ gap: 8 }}>
        {REPORT_REASONS.map((r) => (
          <label key={r.value} className={`cm-reason ${reason === r.value ? 'on' : ''}`}>
            <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} />
            <span>
              <strong>{r.label}</strong>
              <span className="subtle" style={{ display: 'block' }}>{r.hint}</span>
            </span>
          </label>
        ))}
        <textarea
          className="textarea"
          placeholder={reason === 'OTHER' ? 'Tell us what’s wrong (required)' : 'Additional details (optional)'}
          maxLength={500}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        <p className="subtle" style={{ margin: 0 }}>Reported comments are reviewed by a moderator; they aren’t removed automatically.</p>
        {error && <div className="alert error">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn danger" onClick={() => void submit()} disabled={busy || !reason || (reason === 'OTHER' && !details.trim())}>
            {busy ? 'Reporting…' : 'Report'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
