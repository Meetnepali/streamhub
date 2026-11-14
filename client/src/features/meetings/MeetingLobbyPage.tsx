import { Check, Copy, Keyboard, Lock, Plus, ShieldCheck, Users, Video } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import './meetings.css';

interface RecentMeeting {
  roomCode: string;
  title: string;
  hostName: string;
  isHost: boolean;
  createdAt: string;
  endedAt: string | null;
  live: number;
  recordings: number;
}

/** Accept a full link or a bare code. */
function extractCode(input: string) {
  const last = input.trim().split('/').filter(Boolean).pop() ?? '';
  const letters = last.toLowerCase().replace(/[^a-z]/g, '');
  return letters.length === 10 ? `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}` : last.toLowerCase();
}

export function MeetingLobbyPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [passcode, setPasscode] = useState('');
  const [allowChat, setAllowChat] = useState(true);
  const [allowScreenShare, setAllowScreenShare] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ roomCode: string; title: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<RecentMeeting[]>([]);

  useEffect(() => {
    api.get<{ items: RecentMeeting[] }>('/meetings/mine').then((r) => setRecent(r.items)).catch(() => {});
  }, [created]);

  const linkFor = (code: string) => `${window.location.origin}/meet/${code}`;

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const { meeting } = await api.post<{ meeting: { roomCode: string; title: string } }>('/meetings', {
        title: title.trim() || 'Quick meeting',
        passcode: passcode.trim() || undefined,
        allowChat,
        allowScreenShare,
      });
      setCreated(meeting);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Couldn’t copy — select the link and copy it manually.');
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const code = extractCode(joinInput);
    if (!code) return;
    navigate(`/meet/${code}`);
  }

  return (
    <div className="container meet-lobby">
      <h1 className="page-title">Meet</h1>
      <p className="page-subtitle">
        Secure one-to-one and group video calls. <ShieldCheck size={14} style={{ verticalAlign: '-2px' }} /> Calls are
        peer-to-peer and end-to-end encrypted.
      </p>

      {error && <div className="alert error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="meet-lobby-grid">
        <section className="card">
          <h2><Plus size={18} style={{ verticalAlign: '-3px' }} /> New meeting</h2>
          {created ? (
            <div className="stack">
              <div className="alert success">“{created.title}” is ready. Share this link with the people you want to invite.</div>
              <div className="meet-link-box">
                <code>{linkFor(created.roomCode)}</code>
                <button className="btn sm" onClick={() => copy(created.roomCode)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="subtle">Room ID: <strong>{created.roomCode}</strong>{passcode && ' · Passcode required'}</div>
              <div className="row">
                <Link to={`/meet/${created.roomCode}`} className="btn primary"><Video size={16} /> Start meeting</Link>
                <button className="btn ghost" onClick={() => { setCreated(null); setTitle(''); setPasscode(''); }}>Create another</button>
              </div>
            </div>
          ) : (
            <form className="stack" onSubmit={create}>
              <div className="field">
                <label htmlFor="m-title">Title</label>
                <input id="m-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team sync" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="m-pass">Passcode (optional)</label>
                <input id="m-pass" className="input" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Leave blank for link-only access" maxLength={32} />
              </div>
              <label className="checkbox"><input type="checkbox" checked={allowChat} onChange={(e) => setAllowChat(e.target.checked)} /> Participants can chat</label>
              <label className="checkbox"><input type="checkbox" checked={allowScreenShare} onChange={(e) => setAllowScreenShare(e.target.checked)} /> Participants can share their screen</label>
              <button className="btn primary" disabled={creating}>{creating ? 'Creating…' : 'Create meeting'}</button>
            </form>
          )}
        </section>

        <section className="card">
          <h2><Keyboard size={18} style={{ verticalAlign: '-3px' }} /> Join a meeting</h2>
          <form className="stack" onSubmit={join}>
            <div className="field">
              <label htmlFor="m-join">Meeting link or room ID</label>
              <input id="m-join" className="input" value={joinInput} onChange={(e) => setJoinInput(e.target.value)} placeholder="abc-defg-hij" />
            </div>
            <button className="btn" disabled={!joinInput.trim()}>Join</button>
          </form>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Recent meetings</h2>
        {recent.length === 0 ? (
          <div className="empty">Meetings you host or join will show up here.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Meeting</th><th>Host</th><th>Created</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.roomCode}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{m.title}</div>
                      <div className="subtle">{m.roomCode}</div>
                    </td>
                    <td>{m.isHost ? 'You' : m.hostName}</td>
                    <td className="muted">{formatDateTime(m.createdAt)}</td>
                    <td>
                      {m.endedAt ? (
                        <span className="badge">Ended</span>
                      ) : m.live ? (
                        <span className="badge success"><Users size={12} /> {m.live} in call</span>
                      ) : (
                        <span className="badge info">Open</span>
                      )}
                      {m.recordings > 0 && <span className="badge accent" style={{ marginLeft: 6 }}>{m.recordings} recording{m.recordings > 1 ? 's' : ''}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!m.endedAt && <Link className="btn sm" to={`/meet/${m.roomCode}`}>Join</Link>}
                      {m.isHost && m.recordings > 0 && <RecordingsLink roomCode={m.roomCode} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="subtle" style={{ marginTop: 12 }}>
        <Lock size={12} style={{ verticalAlign: '-1px' }} /> Up to 8 participants per call. Recordings are only visible to the host.
      </p>
    </div>
  );
}

function RecordingsLink({ roomCode }: { roomCode: string }) {
  const [items, setItems] = useState<{ id: string; url: string; durationSec: number; createdAt: string }[] | null>(null);
  return (
    <>
      <button
        className="btn sm ghost"
        onClick={() => api.get<{ items: typeof items }>(`/meetings/${roomCode}/recordings`).then((r) => setItems(r.items ?? []))}
      >
        Recordings
      </button>
      {items && (
        <div className="modal-backdrop" onClick={() => setItems(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Recordings</h3>
            <div className="stack">
              {items.map((r) => (
                <div key={r.id} className="row">
                  <span>{formatDateTime(r.createdAt)} · {Math.round(r.durationSec / 60)} min</span>
                  <span className="spacer" />
                  <a className="btn sm" href={r.url}>Download</a>
                </div>
              ))}
              <button className="btn" onClick={() => setItems(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
