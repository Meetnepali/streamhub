import { Hand, MicOff, Monitor, WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MeetingRole, Quality } from './types';

/** <video> bound to a MediaStream, with optional output-device routing. */
export function MediaVideo({
  stream,
  muted,
  mirror,
  sinkId,
  className,
}: {
  stream: MediaStream | null | undefined;
  muted?: boolean;
  mirror?: boolean;
  sinkId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== (stream ?? null)) el.srcObject = stream ?? null;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && sinkId && !muted) void el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, muted]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

export function QualityBars({ quality }: { quality: Quality }) {
  const level = quality === 'good' ? 3 : quality === 'fair' ? 2 : quality === 'poor' ? 1 : 0;
  const label = quality === 'unknown' ? 'Connecting…' : `Connection: ${quality}`;
  return (
    <span className={`quality-bars q-${quality}`} title={label} aria-label={label}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= level ? 'on' : ''} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}

export interface TileProps {
  name: string;
  stream: MediaStream | null | undefined;
  videoOn: boolean;
  mic: boolean;
  speaking: boolean;
  quality: Quality;
  handRaised?: boolean;
  role?: MeetingRole;
  connected?: boolean;
  isSelf?: boolean;
  mirror?: boolean;
  sinkId?: string;
  kind?: 'cam' | 'screen';
  avatarUrl?: string | null;
  className?: string;
}

export function VideoTile({
  name,
  stream,
  videoOn,
  mic,
  speaking,
  quality,
  handRaised,
  role,
  connected = true,
  isSelf,
  mirror,
  sinkId,
  kind = 'cam',
  avatarUrl,
  className = '',
}: TileProps) {
  return (
    <div
      className={`tile ${speaking && mic ? 'speaking' : ''} ${kind === 'screen' ? 'screen' : ''} ${className}`}
      data-rec-tile={kind}
      data-rec-name={kind === 'screen' ? `${name} (screen)` : name}
      data-rec-video={videoOn ? 'on' : 'off'}
    >
      {/* The element stays mounted while the camera is off so remote audio keeps playing. */}
      <MediaVideo stream={stream} muted={isSelf || kind === 'screen'} mirror={mirror} sinkId={sinkId} className={videoOn ? '' : 'hidden-video'} />
      {!videoOn && (
        <div className="tile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{name.trim().charAt(0).toUpperCase()}</span>}
        </div>
      )}
      {!connected && (
        <div className="tile-overlay">
          <WifiOff size={18} /> Reconnecting…
        </div>
      )}
      {handRaised && (
        <div className="tile-hand" title="Hand raised">
          <Hand size={16} />
        </div>
      )}
      <div className="tile-label">
        {kind === 'screen' ? <Monitor size={13} /> : !mic && <MicOff size={13} className="mic-off" />}
        <span className="tile-name">
          {name}
          {isSelf && ' (You)'}
          {kind === 'screen' && ' · presenting'}
        </span>
        {role && role !== 'PARTICIPANT' && kind === 'cam' && <span className="tile-role">{role === 'HOST' ? 'Host' : 'Co-host'}</span>}
        {kind === 'cam' && <QualityBars quality={quality} />}
      </div>
    </div>
  );
}
