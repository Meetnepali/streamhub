import {
  Circle,
  Copy,
  Hand,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Settings,
  ShieldCheck,
  SwitchCamera,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError } from '../../lib/api';
import { formatBytes, formatDuration } from '../../lib/format';
import { ChatPanel } from './ChatPanel';
import { MeetingClient, type MeetingState } from './MeetingClient';
import { ParticipantsPanel } from './ParticipantsPanel';
import { DeviceSelect, PermissionHelp, PreJoin } from './PreJoin';
import { CallRecorder, downloadBlob } from './recorder';
import type { MeetingSummary } from './types';
import { VideoTile } from './VideoTile';
import './meetings.css';

const RESUME_KEY = (code: string) => `sh_meet:${code}`;
const TERMINAL_ERRORS = new Set(['NOT_FOUND', 'ENDED', 'REMOVED', 'UNAUTHENTICATED']);

export function MeetingRoomPage() {
  const { roomCode = '' } = useParams();
  const [client, setClient] = useState<MeetingClient | null>(null);

  useEffect(() => {
    const c = new MeetingClient(roomCode);
    setClient(c);
    return () => c.destroy();
  }, [roomCode]);

  if (!client) return <div className="meet-root center"><div className="spinner" /></div>;
  return <Room key={client.roomCode} client={client} />;
}

function Room({ client }: { client: MeetingClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const { user } = useAuth();
  const [info, setInfo] = useState<MeetingSummary | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const resumed = useRef(false);

  useEffect(() => {
    api
      .get<{ meeting: MeetingSummary }>(`/meetings/${client.roomCode}`)
      .then(({ meeting }) => setInfo(meeting))
      .catch((err) => setInfoError(err instanceof ApiError && err.status === 404 ? 'NOT_FOUND' : 'ERROR'));
  }, [client]);

  // Browser refresh mid-call: rejoin automatically with the same settings.
  useEffect(() => {
    if (!info || resumed.current) return;
    resumed.current = true;
    let saved: { passcode?: string; mic: boolean; cam: boolean } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME_KEY(client.roomCode)) ?? 'null');
    } catch {
      saved = null;
    }
    void (async () => {
      await client.startLocalMedia();
      if (saved && !info.ended && !info.removed) {
        if (!saved.mic) await client.setMic(false);
        if (!saved.cam) await client.setCam(false);
        await client.join(saved.passcode);
      }
    })();
  }, [info, client]);

  const join = (passcode?: string) => {
    try {
      sessionStorage.setItem(RESUME_KEY(client.roomCode), JSON.stringify({ passcode, mic: state.local.mic, cam: state.local.cam }));
    } catch {
      /* private mode */
    }
    void client.join(passcode);
  };

  // Keep the resume record in sync with mic/cam so a refresh restores them.
  useEffect(() => {
    if (state.status !== 'in-call') return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY(client.roomCode)) ?? '{}');
      sessionStorage.setItem(RESUME_KEY(client.roomCode), JSON.stringify({ ...saved, mic: state.local.mic, cam: state.local.cam }));
    } catch {
      /* ignore */
    }
  }, [state.status, state.local.mic, state.local.cam, client.roomCode]);

  const terminal = ['left', 'ended', 'removed', 'replaced'].includes(state.status) || (state.status === 'error' && TERMINAL_ERRORS.has(state.error?.code ?? ''));
  useEffect(() => {
    if (terminal) sessionStorage.removeItem(RESUME_KEY(client.roomCode));
  }, [terminal, client.roomCode]);

  if (infoError || info?.ended || info?.removed) {
    return <EndScreen kind={infoError === 'NOT_FOUND' ? 'notfound' : info?.removed ? 'removed' : info?.ended ? 'ended' : 'error'} />;
  }
  if (!info || !user) return <div className="meet-root center"><div className="spinner" /></div>;

  if (state.status === 'left') return <EndScreen kind="left" roomCode={client.roomCode} />;
  if (state.status === 'ended') return <EndScreen kind="ended" />;
  if (state.status === 'removed') return <EndScreen kind="removed" />;
  if (state.status === 'replaced') return <EndScreen kind="replaced" roomCode={client.roomCode} />;
  if (state.status === 'error' && state.error && TERMINAL_ERRORS.has(state.error.code)) {
    return <EndScreen kind={state.error.code === 'REMOVED' ? 'removed' : state.error.code === 'ENDED' ? 'ended' : 'error'} message={state.error.message} />;
  }

  if (state.status === 'in-call' || state.status === 'reconnecting') {
    return <InCall client={client} state={state} selfUserId={user.id} />;
  }

  return (
    <div className="meet-root">
      <PreJoin client={client} state={state} info={info} userName={user.name} onJoin={join} />
    </div>
  );
}

// ───────────────────────── In call ─────────────────────────

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function InCall({ client, state, selfUserId }: { client: MeetingClient; state: MeetingState; selfUserId: string }) {
  const navigate = useNavigate();
  const { room, participants, local, remote, peerQuality, messages, notices } = state;
  const [panel, setPanel] = useState<'chat' | 'people' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [seenMessages, setSeenMessages] = useState(messages.length);
  const [recording, setRecording] = useState<{ result?: { blob: Blob; durationSec: number }; uploading?: boolean; uploaded?: boolean; error?: string } | null>(null);
  const recorderRef = useRef<CallRecorder | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  const self = participants.find((p) => p.userId === selfUserId);
  const others = participants.filter((p) => p.userId !== selfUserId);
  const isHost = self?.role === 'HOST';
  const canMod = isHost || self?.role === 'COHOST';
  const sinkId = state.selected.audiooutput;
  const someoneRecording = participants.some((p) => p.recording) || local.recording;

  useEffect(() => {
    if (panel === 'chat') setSeenMessages(messages.length);
  }, [panel, messages.length]);
  const unread = panel === 'chat' ? 0 : Math.max(0, messages.length - seenMessages);
  const raisedHands = others.filter((p) => p.handRaised).length;

  // Stop recording if host status is lost or the call ends.
  useEffect(() => {
    if (!isHost && recorderRef.current) void stopRecording();
  }, [isHost]);
  useEffect(() => () => void recorderRef.current?.stop(), []);

  async function startRecording() {
    if (!CallRecorder.supported) return client.notify('Recording isn’t supported in this browser');
    const rec = new CallRecorder(() => stageRef.current, () => client.audioTracksForRecording());
    try {
      rec.start();
      recorderRef.current = rec;
      client.setRecording(true);
      setRecording({});
    } catch {
      client.notify('Couldn’t start recording');
    }
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    client.setRecording(false);
    const result = await rec.stop();
    // Always keep a local copy.
    downloadBlob(result.blob, `${room?.roomCode ?? 'meeting'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
    setRecording({ result });
  }

  async function uploadRecording() {
    if (!recording?.result) return;
    setRecording({ ...recording, uploading: true, error: undefined });
    const form = new FormData();
    form.append('durationSec', String(recording.result.durationSec));
    form.append('file', recording.result.blob, 'recording.webm');
    try {
      await api.post(`/meetings/${client.roomCode}/recordings`, form);
      setRecording({ ...recording, uploading: false, uploaded: true });
    } catch (err) {
      setRecording({ ...recording, uploading: false, error: err instanceof Error ? err.message : 'Upload failed' });
    }
  }

  async function leave(endForAll: boolean) {
    if (recorderRef.current) await stopRecording();
    if (endForAll) await client.endForAll().catch(() => {});
    await client.leave();
    navigate('/meet');
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${client.roomCode}`);
      client.notify('Meeting link copied');
    } catch {
      client.notify(`Room ID: ${client.roomCode}`);
    }
  }

  // ── stage layout ──
  const presenter = local.screen ? 'self' : others.find((p) => p.screen && p.connected)?.userId;
  const selfTile = (
    <VideoTile
      key="self"
      name={self?.name ?? 'You'}
      avatarUrl={self?.avatarUrl}
      stream={local.stream}
      videoOn={local.cam && !!local.stream?.getVideoTracks().length}
      mic={local.mic}
      speaking={local.speaking}
      quality={self?.quality ?? 'unknown'}
      handRaised={local.handRaised}
      role={self?.role}
      isSelf
      mirror={local.facingMode === 'user'}
    />
  );
  const otherTiles = others.map((p) => (
    <VideoTile
      key={p.userId}
      name={p.name}
      avatarUrl={p.avatarUrl}
      stream={remote[p.userId]?.cam}
      videoOn={p.cam && p.connected}
      mic={p.mic}
      speaking={p.speaking}
      quality={peerQuality[p.userId] ?? p.quality}
      handRaised={p.handRaised}
      role={p.role}
      connected={p.connected}
      sinkId={sinkId}
    />
  ));

  const layout = presenter ? 'spotlight' : others.length === 1 ? 'one-on-one' : 'gallery';
  const total = others.length + 1;
  const cols = total <= 1 ? 1 : total <= 4 ? 2 : 3;

  const duration = room ? formatDuration((now - room.startedAt) / 1000) : '0:00';
  const showSwitchCamera = local.cam && (client.isMobile || state.devices.videoinput.length > 1);
  const canScreenShare = !!navigator.mediaDevices?.getDisplayMedia && !client.isMobile;

  return (
    <div className="meet-root in-call">
      <header className="call-top">
        <div className="call-title">
          <strong>{room?.title}</strong>
          <button className="call-code" onClick={copyLink} title="Copy meeting link">{client.roomCode} <Copy size={12} /></button>
        </div>
        <span className="call-pill" title="Media flows directly between participants, encrypted with DTLS-SRTP. No server can see or hear it.">
          <ShieldCheck size={14} /> End-to-end encrypted (peer-to-peer)
        </span>
        {room?.isLocked && <span className="call-pill"><Lock size={13} /> Locked</span>}
        {someoneRecording && <span className="call-pill rec"><Circle size={10} fill="currentColor" /> Recording</span>}
        <span className="spacer" />
        <span className="call-timer">{duration}</span>
      </header>

      {state.status === 'reconnecting' && (
        <div className="reconnect-banner"><WifiOff size={16} /> Connection lost — reconnecting…</div>
      )}

      <div className="call-body">
        <div ref={stageRef} className={`stage ${layout}`} style={layout === 'gallery' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
          {layout === 'spotlight' && (
            <>
              <div className="spotlight-main">
                {presenter === 'self' ? (
                  <VideoTile name={self?.name ?? 'You'} stream={local.screenStream} videoOn mic={false} speaking={false} quality="good" kind="screen" isSelf />
                ) : (
                  (() => {
                    const p = others.find((o) => o.userId === presenter)!;
                    return <VideoTile name={p.name} stream={remote[p.userId]?.screen} videoOn mic={false} speaking={false} quality="good" kind="screen" />;
                  })()
                )}
              </div>
              <div className="filmstrip">
                {selfTile}
                {otherTiles}
              </div>
            </>
          )}
          {layout === 'one-on-one' && (
            <>
              {otherTiles}
              <div className="pip">{selfTile}</div>
            </>
          )}
          {layout === 'gallery' && (
            <>
              {selfTile}
              {otherTiles}
              {others.length === 0 && (
                <div className="waiting">
                  <p>You’re the only one here.</p>
                  <button className="btn sm" onClick={copyLink}><Copy size={14} /> Copy invite link</button>
                </div>
              )}
            </>
          )}
        </div>

        {panel === 'chat' && (
          <ChatPanel client={client} messages={messages} selfUserId={selfUserId} canChat={self?.effectiveCanChat ?? true} onClose={() => setPanel(null)} />
        )}
        {panel === 'people' && room && (
          <ParticipantsPanel client={client} participants={participants} room={room} self={self} onClose={() => setPanel(null)} />
        )}
      </div>

      <div className="notices">
        {notices.map((n) => <div key={n.id} className="notice">{n.text}</div>)}
      </div>

      <footer className="controls">
        <div className="controls-group">
          <button className={`ctrl ${local.mic ? '' : 'off'}`} onClick={() => void client.setMic(!local.mic)} title={local.mic ? 'Mute' : 'Unmute'}>
            {local.mic ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button className={`ctrl ${local.cam ? '' : 'off'}`} onClick={() => void client.setCam(!local.cam)} title={local.cam ? 'Stop video' : 'Start video'}>
            {local.cam ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          {showSwitchCamera && (
            <button className="ctrl" onClick={() => void client.switchCamera()} title={client.isMobile ? 'Switch front/rear camera' : 'Switch camera'}>
              <SwitchCamera size={20} />
            </button>
          )}
          {canScreenShare && (
            <button
              className={`ctrl ${local.screen ? 'active' : ''}`}
              onClick={() => (local.screen ? client.stopScreenShare() : void client.startScreenShare())}
              disabled={!local.screen && (self ? !self.effectiveCanScreenShare : false)}
              title={self && !self.effectiveCanScreenShare ? 'Screen sharing is disabled by the host' : local.screen ? 'Stop sharing' : 'Share screen'}
            >
              {local.screen ? <MonitorOff size={20} /> : <Monitor size={20} />}
            </button>
          )}
          <button className={`ctrl ${local.handRaised ? 'active' : ''}`} onClick={() => client.setHand(!local.handRaised)} title={local.handRaised ? 'Lower hand' : 'Raise hand'}>
            <Hand size={20} />
          </button>
          {isHost && (
            <button
              className={`ctrl ${local.recording ? 'recording' : ''}`}
              onClick={() => (local.recording ? void stopRecording() : void startRecording())}
              title={local.recording ? 'Stop recording' : 'Record (saved to your device)'}
            >
              <Circle size={18} fill={local.recording ? 'currentColor' : 'none'} />
            </button>
          )}
          <button className="ctrl" onClick={() => setSettingsOpen(true)} title="Settings"><Settings size={20} /></button>
        </div>
        <div className="controls-group">
          <button className={`ctrl ${panel === 'people' ? 'active' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')} title="Participants">
            <Users size={20} />
            <span className="ctrl-badge neutral">{participants.length}</span>
            {canMod && raisedHands > 0 && <span className="ctrl-badge">{raisedHands}✋</span>}
          </button>
          <button className={`ctrl ${panel === 'chat' ? 'active' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} title="Chat">
            <MessageSquare size={20} />
            {unread > 0 && <span className="ctrl-badge">{unread}</span>}
          </button>
          <button className="ctrl leave" onClick={() => (isHost ? setLeaveOpen(true) : void leave(false))} title="Leave call">
            <PhoneOff size={20} />
          </button>
        </div>
      </footer>

      {leaveOpen && (
        <div className="modal-backdrop" onClick={() => setLeaveOpen(false)}>
          <div className="modal meet-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Leave meeting?</h3>
            <p className="muted">If you leave, host controls pass to a co-host (or the longest-present participant).</p>
            <div className="stack">
              <button className="btn danger block" onClick={() => void leave(true)}>End meeting for everyone</button>
              <button className="btn block" onClick={() => void leave(false)}>Leave meeting</button>
              <button className="btn ghost block" onClick={() => setLeaveOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal meet-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row"><h3>Settings</h3><span className="spacer" /><button className="btn ghost icon sm" onClick={() => setSettingsOpen(false)}><X size={16} /></button></div>
            <div className="stack">
              <PermissionHelp state={state} />
              <DeviceSelect label="Microphone" devices={state.devices.audioinput} value={state.selected.audioinput} onChange={(id) => void client.selectDevice('audioinput', id)} />
              <DeviceSelect label="Camera" devices={state.devices.videoinput} value={state.selected.videoinput} onChange={(id) => void client.selectDevice('videoinput', id)} />
              <DeviceSelect label="Speaker" devices={state.devices.audiooutput} value={state.selected.audiooutput} onChange={(id) => void client.selectDevice('audiooutput', id)} />
              <label className="checkbox">
                <input type="checkbox" checked={local.noiseSuppression} onChange={(e) => void client.setNoiseSuppression(e.target.checked)} />
                Background noise suppression
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={local.dataSaver} onChange={(e) => client.setDataSaver(e.target.checked)} />
                Data saver — send lower-quality video
              </label>
              <p className="subtle">Video quality also adapts automatically to each participant’s connection.</p>
            </div>
          </div>
        </div>
      )}

      {recording?.result && (
        <div className="modal-backdrop">
          <div className="modal meet-modal">
            <h3>Recording saved</h3>
            <p className="muted">
              A copy ({formatBytes(recording.result.blob.size)}, {formatDuration(recording.result.durationSec)}) was downloaded to this device.
              You can also store it with the meeting — only the host can access it.
            </p>
            {recording.error && <div className="alert error">{recording.error}</div>}
            {recording.uploaded && <div className="alert success">Stored. Find it under Recent meetings → Recordings.</div>}
            <div className="stack" style={{ marginTop: 12 }}>
              {!recording.uploaded && (
                <button className="btn primary block" disabled={recording.uploading} onClick={() => void uploadRecording()}>
                  {recording.uploading ? 'Uploading…' : 'Save to meeting (host only)'}
                </button>
              )}
              <button className="btn block" onClick={() => downloadBlob(recording.result!.blob, `${client.roomCode}.webm`)}>Download again</button>
              <button className="btn ghost block" onClick={() => setRecording(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── End / error screens ─────────────────────────

function EndScreen({ kind, message, roomCode }: { kind: 'left' | 'ended' | 'removed' | 'replaced' | 'notfound' | 'error'; message?: string; roomCode?: string }) {
  const copy = useMemo(
    () =>
      ({
        left: ['You left the meeting', 'Hope it was a good one.'],
        ended: ['This meeting has ended', 'The host ended the meeting for everyone.'],
        removed: ['You were removed', 'The host removed you from this meeting. You can’t rejoin it.'],
        replaced: ['You joined from another tab or device', 'This window was disconnected because the same account joined elsewhere.'],
        notfound: ['Meeting not found', 'Check the link or room ID and try again.'],
        error: ['Couldn’t join', message ?? 'Something went wrong.'],
      })[kind],
    [kind, message],
  );
  return (
    <div className="meet-root center">
      <div className="end-card">
        <h1>{copy[0]}</h1>
        <p>{message && kind !== 'error' ? message : copy[1]}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {(kind === 'left' || kind === 'replaced') && roomCode && (
            <a className="btn" href={`/meet/${roomCode}`}>Rejoin</a>
          )}
          <Link className="btn primary" to="/meet">Back to Meet</Link>
        </div>
      </div>
    </div>
  );
}
