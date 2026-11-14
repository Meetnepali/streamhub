import { AlertTriangle, Mic, MicOff, ShieldCheck, Video, VideoOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MeetingClient, MeetingState } from './MeetingClient';
import type { MeetingSummary } from './types';
import { MediaVideo } from './VideoTile';

export function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value?: string;
  onChange: (id: string) => void;
}) {
  if (!devices.length) return null;
  return (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Default</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PermissionHelp({ state }: { state: MeetingState }) {
  const { audio, video } = state.permissions;
  const denied = [audio === 'denied' && 'microphone', video === 'denied' && 'camera'].filter(Boolean) as string[];
  const missing = [audio === 'unavailable' && 'microphone', video === 'unavailable' && 'camera'].filter(Boolean) as string[];
  if (!denied.length && !missing.length) return null;
  return (
    <div className="alert warning prejoin-perm">
      <AlertTriangle size={16} />
      <div>
        {denied.length > 0 && (
          <p>
            <strong>Access to your {denied.join(' and ')} is blocked.</strong> Click the camera/lock icon in your browser’s
            address bar, set {denied.join(' and ')} to “Allow”, then reload this page. You can still join without{' '}
            {denied.length === 2 ? 'them' : 'it'}.
          </p>
        )}
        {missing.length > 0 && <p>No {missing.join(' or ')} was found (or it’s in use by another app).</p>}
      </div>
    </div>
  );
}

export function PreJoin({
  client,
  state,
  info,
  userName,
  onJoin,
}: {
  client: MeetingClient;
  state: MeetingState;
  info: MeetingSummary;
  userName: string;
  onJoin: (passcode?: string) => void;
}) {
  const [passcode, setPasscode] = useState('');
  const { local, devices, selected, error, status } = state;
  const needsPasscode =
    info.requiresPasscode || error?.code === 'PASSCODE_REQUIRED' || error?.code === 'WRONG_PASSCODE';
  const joining = status === 'joining';

  function submit(e: FormEvent) {
    e.preventDefault();
    onJoin(needsPasscode ? passcode : undefined);
  }

  return (
    <div className="prejoin">
      <div className="prejoin-preview">
        <div className="prejoin-video">
          {local.cam && local.stream?.getVideoTracks().length ? (
            <MediaVideo stream={local.stream} muted mirror={local.facingMode === 'user'} />
          ) : (
            <div className="tile-avatar"><span>{userName.charAt(0).toUpperCase()}</span></div>
          )}
          <div className="prejoin-toggles">
            <button
              type="button"
              className={`ctrl ${local.mic ? '' : 'off'}`}
              onClick={() => void client.setMic(!local.mic)}
              title={local.mic ? 'Mute microphone' : 'Unmute microphone'}
            >
              {local.mic ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button
              type="button"
              className={`ctrl ${local.cam ? '' : 'off'}`}
              onClick={() => void client.setCam(!local.cam)}
              title={local.cam ? 'Turn camera off' : 'Turn camera on'}
            >
              {local.cam ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          </div>
          {local.mic && (
            <div className="level-meter" aria-hidden>
              <span style={{ width: `${Math.round(local.level * 100)}%` }} />
            </div>
          )}
        </div>
        <PermissionHelp state={state} />
      </div>

      <form className="prejoin-panel" onSubmit={submit}>
        <div>
          <h1>{info.title}</h1>
          <p className="muted">
            Hosted by {info.isHost ? 'you' : info.hostName} · {info.participantCount} in the call
          </p>
          <p className="e2ee-note"><ShieldCheck size={14} /> End-to-end encrypted (peer-to-peer)</p>
        </div>
        <p>Joining as <strong>{userName}</strong></p>
        <DeviceSelect label="Microphone" devices={devices.audioinput} value={selected.audioinput} onChange={(id) => void client.selectDevice('audioinput', id)} />
        <DeviceSelect label="Camera" devices={devices.videoinput} value={selected.videoinput} onChange={(id) => void client.selectDevice('videoinput', id)} />
        <DeviceSelect label="Speaker" devices={devices.audiooutput} value={selected.audiooutput} onChange={(id) => void client.selectDevice('audiooutput', id)} />
        <label className="checkbox">
          <input type="checkbox" checked={local.noiseSuppression} onChange={(e) => void client.setNoiseSuppression(e.target.checked)} />
          Background noise suppression
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={local.dataSaver} onChange={(e) => client.setDataSaver(e.target.checked)} />
          Data saver (lower video quality on slow networks)
        </label>
        {needsPasscode && (
          <div className="field">
            <label htmlFor="pj-pass">Meeting passcode</label>
            <input id="pj-pass" className="input" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus required />
          </div>
        )}
        {error && <div className="alert error">{error.message}</div>}
        {info.isLocked && !info.isHost && <div className="alert info">This meeting is locked. Only the host and co-hosts can join right now.</div>}
        <button className="btn primary block" disabled={joining}>
          {joining ? 'Joining…' : 'Join now'}
        </button>
        <Link to="/meet" className="btn ghost block">Back</Link>
      </form>
    </div>
  );
}
