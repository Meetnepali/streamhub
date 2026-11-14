export type Quality = 'good' | 'fair' | 'poor' | 'unknown';
export type MeetingRole = 'HOST' | 'COHOST' | 'PARTICIPANT';

export interface Participant {
  userId: string;
  socketId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: MeetingRole;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  handRaised: boolean;
  speaking: boolean;
  recording: boolean;
  quality: Quality;
  canScreenShare: boolean | null;
  canChat: boolean | null;
  effectiveCanScreenShare: boolean;
  effectiveCanChat: boolean;
  joinedAt: number;
  connected: boolean;
}

export interface RoomInfo {
  meetingId: string;
  roomCode: string;
  title: string;
  hostId: string;
  isLocked: boolean;
  allowScreenShare: boolean;
  allowChat: boolean;
  maxParticipants: number;
  startedAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  kind: 'text' | 'file';
  content: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: string;
}

export interface MeetingSummary {
  roomCode: string;
  title: string;
  hostName: string;
  isHost: boolean;
  requiresPasscode: boolean;
  isLocked: boolean;
  participantCount: number;
  maxParticipants: number;
  ended: boolean;
  removed: boolean;
}

export type PermissionState = 'granted' | 'denied' | 'unavailable' | 'prompt';

export type JoinErrorCode =
  | 'NOT_FOUND'
  | 'ENDED'
  | 'REMOVED'
  | 'LOCKED'
  | 'FULL'
  | 'PASSCODE_REQUIRED'
  | 'WRONG_PASSCODE'
  | 'UNAUTHENTICATED'
  | 'TIMEOUT'
  | 'INTERNAL'
  | string;
