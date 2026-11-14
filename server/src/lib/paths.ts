import path from 'node:path';

/** server/media — videos/, thumbs/, captions/ (Video.*Path values are relative to this). */
export const MEDIA_DIR = path.resolve(import.meta.dirname, '../../media');
/** server/uploads — user uploads (meeting chat files, recordings). */
export const UPLOADS_DIR = path.resolve(import.meta.dirname, '../../uploads');
