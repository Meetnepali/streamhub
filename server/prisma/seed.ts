import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { CATALOG } from '../scripts/catalog.js';

const prisma = new PrismaClient();
const MEDIA = path.resolve(import.meta.dirname, '../media');

async function main() {
  const passwordHash = await bcrypt.hash('Password@123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@streamhub.local' },
    update: {},
    create: { email: 'admin@streamhub.local', username: 'admin', name: 'Admin', role: 'ADMIN', passwordHash },
  });
  await prisma.user.upsert({
    where: { email: 'demo@streamhub.local' },
    update: {},
    create: { email: 'demo@streamhub.local', username: 'demo', name: 'Demo User', phone: '+919999999999', passwordHash },
  });

  for (const v of CATALOG) {
    const videoPath = `videos/${v.slug}.mp4`;
    const abs = path.join(MEDIA, videoPath);
    const data = {
      title: v.title,
      description: v.description,
      videoPath,
      thumbnailPath: `thumbs/${v.slug}.jpg`,
      captionsPath: `captions/${v.slug}.en.vtt`,
      durationSec: v.durationSec,
      fileSizeBytes: existsSync(abs) ? BigInt(statSync(abs).size) : 0n,
      isPremium: v.isPremium,
      channelName: v.channelName,
    };
    await prisma.video.upsert({ where: { id: v.slug }, update: data, create: { id: v.slug, ...data } });
  }
  console.log(`Seeded ${CATALOG.length} videos. Logins: admin@streamhub.local / demo@streamhub.local — password Password@123`);
}

main().finally(() => prisma.$disconnect());
