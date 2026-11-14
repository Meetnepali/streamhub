import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../../config.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { UPLOADS_DIR } from '../../lib/paths.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { generateRoomCode, isMeetingMember, liveCount, liveRooms, normalizeRoomCode } from './state.js';

export const router = Router();
router.use(requireAuth);

const FILES_DIR = path.join(UPLOADS_DIR, 'meetings');
const RECORDINGS_DIR = path.join(UPLOADS_DIR, 'recordings');

const ALLOWED_FILE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg', 'video/mp4',
]);

async function loadMeeting(roomCode: string) {
  const meeting = await prisma.meeting.findUnique({ where: { roomCode: normalizeRoomCode(roomCode) } });
  if (!meeting) throw new HttpError(404, 'Meeting not found', 'NOT_FOUND');
  return meeting;
}

function safeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file';
}

// ───────── Meeting CRUD ─────────

router.get('/ice-servers', (_req, res) => {
  const iceServers: RTCIceServerLike[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (config.meetings.turnUrl) {
    iceServers.push({
      urls: config.meetings.turnUrl.split(','),
      username: config.meetings.turnUsername,
      credential: config.meetings.turnCredential,
    });
  }
  res.json({ iceServers });
});
interface RTCIceServerLike {
  urls: string[];
  username?: string;
  credential?: string;
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).default('Quick meeting'),
  passcode: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v) => v || undefined),
  maxParticipants: z.coerce.number().int().min(2).max(config.meetings.maxParticipants).optional(),
  allowScreenShare: z.boolean().default(true),
  allowChat: z.boolean().default(true),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const meeting = await prisma.meeting.create({
      data: {
        roomCode: await generateRoomCode(),
        title: body.title,
        hostId: req.user!.id,
        passcodeHash: body.passcode ? await bcrypt.hash(body.passcode, 10) : null,
        maxParticipants: body.maxParticipants ?? config.meetings.maxParticipants,
        allowScreenShare: body.allowScreenShare,
        allowChat: body.allowChat,
        participants: { create: { userId: req.user!.id, role: 'HOST' } },
      },
    });
    res.status(201).json({ meeting: { roomCode: meeting.roomCode, title: meeting.title, id: meeting.id } });
  }),
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const rows = await prisma.meeting.findMany({
      where: { OR: [{ hostId: req.user!.id }, { participants: { some: { userId: req.user!.id, removed: false } } }] },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { host: { select: { name: true } }, _count: { select: { recordings: true } } },
    });
    res.json({
      items: rows.map((m) => ({
        roomCode: m.roomCode,
        title: m.title,
        hostName: m.host.name,
        isHost: m.hostId === req.user!.id,
        createdAt: m.createdAt,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        live: liveCount(m.roomCode),
        recordings: m.hostId === req.user!.id ? m._count.recordings : 0,
      })),
    });
  }),
);

router.get(
  '/:roomCode',
  asyncHandler(async (req, res) => {
    const m = await prisma.meeting.findUnique({
      where: { roomCode: normalizeRoomCode(req.params.roomCode) },
      include: { host: { select: { name: true } } },
    });
    if (!m) throw new HttpError(404, 'Meeting not found', 'NOT_FOUND');
    const seat = await prisma.meetingParticipant.findUnique({
      where: { meetingId_userId: { meetingId: m.id, userId: req.user!.id } },
    });
    const isHost = m.hostId === req.user!.id;
    res.json({
      meeting: {
        roomCode: m.roomCode,
        title: m.title,
        hostName: m.host.name,
        isHost,
        requiresPasscode: !!m.passcodeHash && !isHost && !(seat && !seat.removed),
        isLocked: liveRooms.get(m.roomCode)?.isLocked ?? m.isLocked,
        participantCount: liveCount(m.roomCode),
        maxParticipants: m.maxParticipants,
        ended: !!m.endedAt,
        removed: !!seat?.removed,
      },
    });
  }),
);

// ───────── Chat files ─────────

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(FILES_DIR, (req as Request & { meetingId: string }).meetingId);
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `${randomBytes(12).toString('hex')}__${safeName(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_FILE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new HttpError(415, 'This file type is not allowed', 'FILE_TYPE'));
  },
});

router.post(
  '/:roomCode/files',
  asyncHandler(async (req, _res, next) => {
    const meeting = await loadMeeting(req.params.roomCode);
    if (meeting.endedAt) throw new HttpError(410, 'Meeting has ended', 'ENDED');
    if (!(await isMeetingMember(meeting.id, req.user!.id))) throw new HttpError(403, 'Not a participant');
    (req as Request & { meetingId: string }).meetingId = meeting.id;
    next();
  }),
  (req, res, next) =>
    fileUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new HttpError(413, err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 25 MB' : err.message, 'UPLOAD'));
      }
      next(err);
    }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const id = req.file.filename.split('__')[0];
    res.status(201).json({
      file: {
        id,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        url: `/api/meetings/${normalizeRoomCode(req.params.roomCode)}/files/${id}`,
      },
    });
  }),
);

/** Resolve an uploaded chat file by id (also used by the socket to validate file messages). */
export function findMeetingFile(meetingId: string, fileId: string) {
  if (!/^[a-f0-9]{24}$/.test(fileId)) return null;
  const dir = path.join(FILES_DIR, meetingId);
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((f) => f.startsWith(`${fileId}__`));
  if (!name) return null;
  const abs = path.join(dir, name);
  return { abs, name: name.slice(fileId.length + 2), size: statSync(abs).size };
}

router.get(
  '/:roomCode/files/:fileId',
  asyncHandler(async (req, res) => {
    const meeting = await loadMeeting(req.params.roomCode);
    if (!(await isMeetingMember(meeting.id, req.user!.id))) throw new HttpError(403, 'Not a participant');
    const file = findMeetingFile(meeting.id, req.params.fileId);
    if (!file) throw new HttpError(404, 'File not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(file.abs, file.name);
  }),
);

// ───────── Recordings (host only) ─────────

async function requireHost(req: Request) {
  const meeting = await loadMeeting(req.params.roomCode);
  const live = liveRooms.get(meeting.roomCode);
  const isHost = (live?.hostId ?? meeting.hostId) === req.user!.id || meeting.hostId === req.user!.id;
  if (!isHost) throw new HttpError(403, 'Only the host can access recordings', 'FORBIDDEN');
  return meeting;
}

const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(RECORDINGS_DIR, { recursive: true });
      cb(null, RECORDINGS_DIR);
    },
    filename: (_req, _file, cb) => cb(null, `${randomBytes(12).toString('hex')}.webm`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^(video|audio)\/webm/.test(file.mimetype) || file.mimetype === 'video/mp4') cb(null, true);
    else cb(new HttpError(415, 'Recordings must be WebM or MP4', 'FILE_TYPE'));
  },
});

router.post(
  '/:roomCode/recordings',
  asyncHandler(async (req, _res, next) => {
    await requireHost(req);
    next();
  }),
  recordingUpload.single('file'),
  asyncHandler(async (req, res) => {
    const meeting = await loadMeeting(req.params.roomCode);
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const durationSec = Math.max(0, Math.round(Number(req.body.durationSec) || 0));
    const rec = await prisma.meetingRecording.create({
      data: {
        meetingId: meeting.id,
        hostId: req.user!.id,
        filePath: path.relative(UPLOADS_DIR, req.file.path),
        sizeBytes: req.file.size,
        durationSec,
      },
    });
    res.status(201).json({ recording: { id: rec.id, sizeBytes: rec.sizeBytes, durationSec, createdAt: rec.createdAt } });
  }),
);

router.get(
  '/:roomCode/recordings',
  asyncHandler(async (req, res) => {
    const meeting = await requireHost(req);
    const items = await prisma.meetingRecording.findMany({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sizeBytes: true, durationSec: true, createdAt: true },
    });
    res.json({ items: items.map((r) => ({ ...r, url: `/api/meetings/${meeting.roomCode}/recordings/${r.id}` })) });
  }),
);

router.get(
  '/:roomCode/recordings/:id',
  asyncHandler(async (req, res) => {
    const meeting = await requireHost(req);
    const rec = await prisma.meetingRecording.findFirst({ where: { id: req.params.id, meetingId: meeting.id } });
    if (!rec) throw new HttpError(404, 'Recording not found');
    const abs = path.join(UPLOADS_DIR, rec.filePath);
    if (!existsSync(abs)) throw new HttpError(404, 'Recording file missing');
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Disposition', `attachment; filename="${meeting.roomCode}-${rec.createdAt.toISOString().slice(0, 19)}.webm"`);
    createReadStream(abs).pipe(res);
  }),
);
