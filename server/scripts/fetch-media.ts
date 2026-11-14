/**
 * Generates the sample catalog into server/media with ffmpeg: an H.264/AAC MP4 (faststart, for
 * byte-range streaming), a JPEG thumbnail and a WebVTT caption track per video.
 * Videos are served same-origin, which hover-preview frame capture and controlled downloads rely on.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOG } from './catalog.js';

const MEDIA = path.resolve(import.meta.dirname, '../media');
for (const dir of ['videos', 'thumbs', 'captions']) mkdirSync(path.join(MEDIA, dir), { recursive: true });

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg is required: brew install ffmpeg (macOS) or apt install ffmpeg');
  process.exit(1);
}

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function vtt(title: string, durationSec: number) {
  const ts = (s: number) => new Date(s * 1000).toISOString().slice(11, 23);
  const lines = ['WEBVTT', ''];
  const step = Math.max(4, Math.floor(durationSec / 8));
  for (let t = 0, i = 1; t < durationSec; t += step, i++) {
    lines.push(String(i), `${ts(t)} --> ${ts(Math.min(durationSec, t + step - 0.5))}`, i === 1 ? title : `${title} — part ${i}`, '');
  }
  return lines.join('\n');
}

for (const v of CATALOG) {
  const video = path.join(MEDIA, 'videos', `${v.slug}.mp4`);
  const thumb = path.join(MEDIA, 'thumbs', `${v.slug}.jpg`);
  if (!existsSync(video)) {
    ffmpeg([
      '-f', 'lavfi', '-i', `${v.lavfi},format=yuv420p`,
      '-f', 'lavfi', '-i', `sine=frequency=${v.tone}:sample_rate=44100`,
      '-af', 'volume=0.08',
      '-t', String(v.durationSec),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '60',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart',
      video,
    ]);
    console.log('▶ generated', path.relative(MEDIA, video));
  } else console.log('✓ exists', path.relative(MEDIA, video));
  if (!existsSync(thumb)) ffmpeg(['-ss', String(Math.min(5, v.durationSec / 2)), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', thumb]);
  writeFileSync(path.join(MEDIA, 'captions', `${v.slug}.en.vtt`), vtt(v.title, v.durationSec));
}
console.log('Media ready in', MEDIA);
