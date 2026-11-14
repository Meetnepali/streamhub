import { Hand, Lock, MessageSquareOff, Mic, MicOff, MonitorOff, MoreVertical, Unlock, Video, VideoOff, X } from 'lucide-react';
import { useState } from 'react';
import type { MeetingClient } from './MeetingClient';
import type { Participant, RoomInfo } from './types';
import { QualityBars } from './VideoTile';

export function ParticipantsPanel({
  client,
  participants,
  room,
  self,
  onClose,
}: {
  client: MeetingClient;
  participants: Participant[];
  room: RoomInfo;
  self: Participant | undefined;
  onClose: () => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const isHost = self?.role === 'HOST';
  const canMod = self?.role === 'HOST' || self?.role === 'COHOST';
  const run = (fn: () => Promise<void>) => {
    setMenuFor(null);
    void fn().catch(() => {});
  };

  // Raised hands first (in the order they appear), then hosts, then everyone else.
  const roleRank = { HOST: 0, COHOST: 1, PARTICIPANT: 2 } as const;
  const sorted = [...participants].sort(
    (a, b) => Number(b.handRaised) - Number(a.handRaised) || roleRank[a.role] - roleRank[b.role] || a.joinedAt - b.joinedAt,
  );

  const manageable = (p: Participant) =>
    canMod && p.userId !== self?.userId && p.role !== 'HOST' && (isHost || p.role === 'PARTICIPANT');

  return (
    <aside className="side-panel">
      <header>
        <h3>People ({participants.length}/{room.maxParticipants})</h3>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close participants"><X size={16} /></button>
      </header>

      {canMod && (
        <div className="host-tools">
          <button className="btn sm" onClick={() => run(() => client.setLocked(!room.isLocked))}>
            {room.isLocked ? <Unlock size={14} /> : <Lock size={14} />} {room.isLocked ? 'Unlock meeting' : 'Lock meeting'}
          </button>
          <button className="btn sm" onClick={() => run(client.muteAll)}><MicOff size={14} /> Mute all</button>
          <label className="checkbox">
            <input type="checkbox" checked={room.allowChat} onChange={(e) => run(() => client.setRoomSettings({ allowChat: e.target.checked }))} />
            Everyone can chat
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={room.allowScreenShare} onChange={(e) => run(() => client.setRoomSettings({ allowScreenShare: e.target.checked }))} />
            Everyone can share screen
          </label>
        </div>
      )}

      <ul className="people">
        {sorted.map((p) => (
          <li key={p.userId} className={p.connected ? '' : 'disconnected'}>
            <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
              {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : p.name.charAt(0).toUpperCase()}
            </span>
            <div className="people-name">
              <div>
                {p.name}
                {p.userId === self?.userId && <span className="subtle"> (You)</span>}
              </div>
              <div className="subtle">
                {p.role === 'HOST' ? 'Host' : p.role === 'COHOST' ? 'Co-host' : 'Participant'}
                {!p.connected && ' · reconnecting'}
                {!p.effectiveCanChat && ' · chat off'}
                {!p.effectiveCanScreenShare && ' · no sharing'}
              </div>
            </div>
            <div className="people-icons">
              {p.handRaised && <Hand size={16} className="hand" />}
              {p.mic ? <Mic size={16} className={p.speaking ? 'talking' : ''} /> : <MicOff size={16} className="off" />}
              {p.cam ? <Video size={16} /> : <VideoOff size={16} className="off" />}
              <QualityBars quality={p.quality} />
            </div>
            {manageable(p) && (
              <div className="menu">
                <button className="btn ghost icon sm" onClick={() => setMenuFor(menuFor === p.userId ? null : p.userId)} aria-label={`Manage ${p.name}`}>
                  <MoreVertical size={16} />
                </button>
                {menuFor === p.userId && (
                  <div className="menu-panel">
                    {p.mic && <button onClick={() => run(() => client.muteParticipant(p.userId))}><MicOff size={14} /> Mute</button>}
                    {isHost && (
                      <button onClick={() => run(() => client.setRole(p.userId, p.role === 'COHOST' ? 'PARTICIPANT' : 'COHOST'))}>
                        {p.role === 'COHOST' ? 'Remove co-host' : 'Make co-host'}
                      </button>
                    )}
                    <button onClick={() => run(() => client.setPermissions(p.userId, { canScreenShare: !p.effectiveCanScreenShare }))}>
                      <MonitorOff size={14} /> {p.effectiveCanScreenShare ? 'Block screen sharing' : 'Allow screen sharing'}
                    </button>
                    <button onClick={() => run(() => client.setPermissions(p.userId, { canChat: !p.effectiveCanChat }))}>
                      <MessageSquareOff size={14} /> {p.effectiveCanChat ? 'Block chat' : 'Allow chat'}
                    </button>
                    <div className="menu-sep" />
                    <button className="danger-text" onClick={() => run(() => client.removeParticipant(p.userId))}>Remove from meeting</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
