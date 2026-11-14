import { EyeOff, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../components/Avatar';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';
import { Modal } from './Modal';
import { BLOCK_REASON_TITLES, languageName, REPORT_REASONS } from './types';
import './comments.css';

type Action = 'HIDE' | 'RESTORE' | 'DISMISS_REPORTS';

interface ReportGroup {
  comment: { id: string; content: string; status: string; language: string | null; createdAt: string; likeCount: number; dislikeCount: number };
  author: { id: string; username: string; name: string; avatarUrl: string | null };
  video: { id: string; title: string };
  reportCount: number;
  reasonCounts: Record<string, number>;
  latestReportAt: string | null;
  reports: { id: string; reason: string; details: string | null; reporter: string; createdAt: string; status: string }[];
  moderation: { action: string; note: string | null; moderator: string; createdAt: string }[];
}

interface Attempt {
  id: string;
  blockReason: string | null;
  content: string;
  ip: string | null;
  createdAt: string;
  user: { username: string; name: string };
}

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));

const ACTION_COPY: Record<Action, { title: string; button: string; danger?: boolean }> = {
  HIDE: { title: 'Hide this comment', button: 'Hide comment', danger: true },
  RESTORE: { title: 'Restore this comment', button: 'Restore' },
  DISMISS_REPORTS: { title: 'Dismiss reports', button: 'Dismiss reports' },
};

export function AdminModerationPage() {
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED' | 'attempts'>('OPEN');

  return (
    <div className="container">
      <h1 className="page-title">Comment moderation</h1>
      <p className="page-subtitle">Review reported comments and automatically blocked posting attempts.</p>
      <div className="tabs">
        <button className={`tab ${tab === 'OPEN' ? 'active' : ''}`} onClick={() => setTab('OPEN')}>Open reports</button>
        <button className={`tab ${tab === 'RESOLVED' ? 'active' : ''}`} onClick={() => setTab('RESOLVED')}>Resolved</button>
        <button className={`tab ${tab === 'attempts' ? 'active' : ''}`} onClick={() => setTab('attempts')}>Blocked attempts</button>
      </div>
      {tab === 'attempts' ? <AttemptsLog /> : <ReportQueue key={tab} status={tab} />}
    </div>
  );
}

function ReportQueue({ status }: { status: 'OPEN' | 'RESOLVED' }) {
  const [items, setItems] = useState<ReportGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ group: ReportGroup; action: Action } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ items: ReportGroup[] }>(`/comments/admin/reports?status=${status}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorMessage(e)));
  }, [status]);

  useEffect(load, [load]);

  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.post(`/comments/admin/comments/${pending.group.comment.id}/action`, { action: pending.action, note: note.trim() || undefined });
      setFlash(`${ACTION_COPY[pending.action].button} — done.`);
      setPending(null);
      setNote('');
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="alert error">{error}</div>;
  if (!items) return <div className="row" style={{ justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <span className="muted">{items.length} {items.length === 1 ? 'comment' : 'comments'}</span>
        <div className="spacer" />
        <button className="btn sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </div>
      {flash && <div className="alert success">{flash}</div>}
      {items.length === 0 && (
        <div className="card empty">
          <ShieldCheck size={32} style={{ margin: '0 auto 8px' }} />
          {status === 'OPEN' ? 'No open reports. All clear!' : 'No resolved reports yet.'}
        </div>
      )}
      {items.map((g) => (
        <div key={g.comment.id} className="card mod-card">
          <div className="row wrap">
            <Avatar name={g.author.name} src={g.author.avatarUrl} size={32} />
            <div>
              <div style={{ fontWeight: 700 }}>@{g.author.username}</div>
              <div className="subtle">
                on <Link to={`/watch/${g.video.id}`} style={{ textDecoration: 'underline' }}>{g.video.title}</Link> ·{' '}
                <span title={formatDateTime(g.comment.createdAt)}>{timeAgo(g.comment.createdAt)}</span> · {languageName(g.comment.language)}
              </div>
            </div>
            <div className="spacer" />
            <span className={`badge ${g.comment.status === 'HIDDEN' ? 'danger' : g.comment.status === 'FLAGGED' ? 'warning' : g.comment.status === 'DELETED' ? '' : 'success'}`}>
              {g.comment.status}
            </span>
            <span className="badge accent">{g.reportCount} {g.reportCount === 1 ? 'report' : 'reports'}</span>
          </div>

          <p className="mod-content" dir="auto">{g.comment.content}</p>

          <div className="row wrap" style={{ gap: 6 }}>
            {Object.entries(g.reasonCounts).map(([reason, n]) => (
              <span key={reason} className="badge">{REASON_LABEL[reason] ?? reason} × {n}</span>
            ))}
            <span className="subtle">👍 {g.comment.likeCount} · 👎 {g.comment.dislikeCount}</span>
          </div>

          <details>
            <summary className="subtle" style={{ cursor: 'pointer' }}>Report details & history</summary>
            <ul className="mod-reports">
              {g.reports.map((r) => (
                <li key={r.id}>
                  <strong>@{r.reporter}</strong> — {REASON_LABEL[r.reason] ?? r.reason}
                  {r.details && <>: “{r.details}”</>} <span className="subtle">({timeAgo(r.createdAt)}{r.status !== 'OPEN' ? `, ${r.status}` : ''})</span>
                </li>
              ))}
              {g.moderation.map((m, i) => (
                <li key={`m${i}`}>
                  <em>{m.action}</em> by @{m.moderator} {m.note && <>— “{m.note}”</>} <span className="subtle">({timeAgo(m.createdAt)})</span>
                </li>
              ))}
            </ul>
          </details>

          {g.comment.status === 'DELETED' && status === 'OPEN' && (
            <div className="row wrap">
              <span className="subtle">The author deleted this comment.</span>
              <button className="btn sm" onClick={() => setPending({ group: g, action: 'DISMISS_REPORTS' })}>Close reports</button>
            </div>
          )}
          {g.comment.status !== 'DELETED' && (
            <div className="row wrap">
              {g.comment.status !== 'HIDDEN' && (
                <button className="btn danger sm" onClick={() => setPending({ group: g, action: 'HIDE' })}><EyeOff size={14} /> Hide</button>
              )}
              {g.comment.status === 'HIDDEN' && (
                <button className="btn sm" onClick={() => setPending({ group: g, action: 'RESTORE' })}><RotateCcw size={14} /> Restore</button>
              )}
              {status === 'OPEN' && g.comment.status !== 'HIDDEN' && (
                <button className="btn sm" onClick={() => setPending({ group: g, action: 'DISMISS_REPORTS' })}><ShieldCheck size={14} /> Keep & dismiss</button>
              )}
            </div>
          )}
        </div>
      ))}

      {pending && (
        <Modal title={ACTION_COPY[pending.action].title} onClose={() => setPending(null)}>
          <p className="mod-content" style={{ marginBottom: 12 }}>{pending.group.comment.content}</p>
          <div className="field">
            <label htmlFor="mod-note">Moderator note (optional)</label>
            <textarea id="mod-note" className="textarea" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
            <button className={`btn ${ACTION_COPY[pending.action].danger ? 'danger' : 'primary'}`} onClick={() => void apply()} disabled={busy}>
              {busy ? 'Saving…' : ACTION_COPY[pending.action].button}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AttemptsLog() {
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState('');
  const [data, setData] = useState<{ items: Attempt[]; total: number; pageSize: number; byReason: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api
      .get<{ items: Attempt[]; total: number; pageSize: number; byReason: Record<string, number> }>(
        `/comments/admin/attempts?page=${page}${reason ? `&reason=${reason}` : ''}`,
      )
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [page, reason]);

  if (error) return <div className="alert error">{error}</div>;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 6 }}>
        <button className={`btn sm ${reason === '' ? 'primary' : ''}`} onClick={() => { setReason(''); setPage(1); }}>All</button>
        {Object.keys(BLOCK_REASON_TITLES).map((r) => (
          <button key={r} className={`btn sm ${reason === r ? 'primary' : ''}`} onClick={() => { setReason(r); setPage(1); }}>
            {BLOCK_REASON_TITLES[r]} {data?.byReason[r] ? `(${data.byReason[r]})` : ''}
          </button>
        ))}
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        {!data ? (
          <div className="row" style={{ justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
        ) : data.items.length === 0 ? (
          <div className="empty">No blocked attempts.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>When</th><th>User</th><th>Reason</th><th>Content</th><th>IP</th></tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td title={formatDateTime(a.createdAt)} style={{ whiteSpace: 'nowrap' }}>{timeAgo(a.createdAt)}</td>
                  <td>@{a.user.username}</td>
                  <td><span className="badge warning">{BLOCK_REASON_TITLES[a.blockReason ?? ''] ?? a.blockReason}</span></td>
                  <td className="mod-attempt-content" title={a.content} dir="auto">{a.content}</td>
                  <td className="subtle">{a.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="muted">Page {page} of {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
