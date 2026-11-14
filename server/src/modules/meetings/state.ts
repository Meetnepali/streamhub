import type { Meeting, MeetingRole } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';

/** In-memory state of a live room. The DB is the source of truth for settings; this mirrors it plus presence. */
export interface LiveParticipant {
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
  /** Host is recording locally — shown to everyone. */
  recording: boolean;
  quality: 'good' | 'fair' | 'poor' | 'unknown';
  canScreenShare: boolean | null;
  canChat: boolean | null;
  joinedAt: number;
  /** false while inside the reconnect grace period. */
  connected: boolean;
  leaveTimer?: NodeJS.Timeout;
}

export interface LiveRoom {
  meetingId: string;
  roomCode: string;
  title: string;
  hostId: string;
  isLocked: boolean;
  allowScreenShare: boolean;
  allowChat: boolean;
  maxParticipants: number;
  startedAt: number;
  participants: Map<string, LiveParticipant>;
}

export const liveRooms = new Map<string, LiveRoom>();

export function liveCount(roomCode: string) {
  return liveRooms.get(roomCode)?.participants.size ?? 0;
}

export function roomFromMeeting(m: Meeting): LiveRoom {
  return {
    meetingId: m.id,
    roomCode: m.roomCode,
    title: m.title,
    hostId: m.hostId,
    isLocked: m.isLocked,
    allowScreenShare: m.allowScreenShare,
    allowChat: m.allowChat,
    maxParticipants: m.maxParticipants,
    startedAt: m.startedAt?.getTime() ?? Date.now(),
    participants: new Map(),
  };
}

const LETTERS = 'abcdefghijkmnopqrstuvwxyz';
function randomLetters(n: number) {
  return Array.from({ length: n }, () => LETTERS[randomInt(LETTERS.length)]).join('');
}

/** abc-defg-hij (~25^10 ≈ 9.5e13 combinations). */
export async function generateRoomCode() {
  for (;;) {
    const code = `${randomLetters(3)}-${randomLetters(4)}-${randomLetters(3)}`;
    if (!(await prisma.meeting.findUnique({ where: { roomCode: code } }))) return code;
  }
}

/** Accepts a code with or without dashes, any case, or a full meeting link. */
export function normalizeRoomCode(input: string) {
  const last = input.trim().split('/').filter(Boolean).pop() ?? '';
  const letters = last.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length !== 10) return last.toLowerCase();
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}

export function canModerate(role: MeetingRole) {
  return role === 'HOST' || role === 'COHOST';
}

export function effectiveCanScreenShare(room: LiveRoom, p: LiveParticipant) {
  if (canModerate(p.role)) return true;
  return p.canScreenShare ?? room.allowScreenShare;
}

export function effectiveCanChat(room: LiveRoom, p: LiveParticipant) {
  if (canModerate(p.role)) return true;
  return p.canChat ?? room.allowChat;
}

export function publicParticipant(room: LiveRoom, p: LiveParticipant) {
  const { leaveTimer: _t, ...rest } = p;
  return { ...rest, effectiveCanScreenShare: effectiveCanScreenShare(room, p), effectiveCanChat: effectiveCanChat(room, p) };
}

export function publicRoom(room: LiveRoom) {
  return {
    meetingId: room.meetingId,
    roomCode: room.roomCode,
    title: room.title,
    hostId: room.hostId,
    isLocked: room.isLocked,
    allowScreenShare: room.allowScreenShare,
    allowChat: room.allowChat,
    maxParticipants: room.maxParticipants,
    startedAt: room.startedAt,
  };
}

/** Participants (host included) may access meeting files. */
export async function isMeetingMember(meetingId: string, userId: string) {
  const row = await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId, userId } } });
  if (row && !row.removed) return true;
  const m = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { hostId: true } });
  return m?.hostId === userId;
}
