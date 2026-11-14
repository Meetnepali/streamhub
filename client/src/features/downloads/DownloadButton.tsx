import { Download, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, errorMessage } from '../../lib/api';
import { ERROR_COPY, downloadsApi, startBrowserDownload, type Quota } from './api';
import './downloads.css';

export function DownloadButton({ videoId, title }: { videoId: string; title: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'warning'; title: string; text: string; upgrade?: boolean } | null>(null);
  const lockRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    downloadsApi.quota().then(setQuota).catch(() => {});
  }, [user, videoId]);

  useEffect(() => {
    if (!message || message.kind !== 'success') return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const tooltip = quota
    ? `${quota.remainingToday} of ${quota.dailyLimit} downloads left today · ${quota.remainingThisMonth} this month`
    : 'Download for offline viewing';

  async function onClick() {
    if (!user) return navigate('/login', { state: { from: `/watch/${videoId}` } });
    if (lockRef.current) return; // double-click guard (the server dedupes too)
    lockRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await downloadsApi.authorize(videoId);
      setQuota(res.quota);
      startBrowserDownload(res.url, `${title}.mp4`);
      setMessage({
        kind: 'success',
        title: 'Download started',
        text: res.countsToQuota
          ? `${res.quota.remainingToday} download${res.quota.remainingToday === 1 ? '' : 's'} left today.`
          : 'Re-download — this one doesn’t count against your quota.',
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      const copy = (code && ERROR_COPY[code]) || { title: 'Download failed' };
      if (err instanceof ApiError && err.details?.quota) setQuota(err.details.quota);
      setMessage({ kind: 'error', title: copy.title, text: errorMessage(err), upgrade: copy.upgrade });
    } finally {
      setBusy(false);
      setTimeout(() => (lockRef.current = false), 1500);
    }
  }

  return (
    <div className="dl-button-wrap">
      <button className="btn" onClick={() => void onClick()} disabled={busy} title={tooltip} aria-label={`Download ${title}`}>
        {busy ? <Loader2 size={16} className="dl-spin" /> : <Download size={16} />}
        Download
        {quota && <span className="dl-pill">{quota.remainingToday}</span>}
      </button>
      {message && (
        <div className={`dl-popover alert ${message.kind}`} role="status">
          <strong>{message.title}</strong>
          <div>{message.text}</div>
          <div className="row" style={{ marginTop: 6, gap: 12 }}>
            {message.upgrade && <Link to="/plans" className="dl-link">View plans →</Link>}
            <Link to="/downloads" className="dl-link">My downloads</Link>
            <button className="dl-link dl-dismiss" onClick={() => setMessage(null)}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}
