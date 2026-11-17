/**
 * 홈 확인용 데모 (2026-11-14) — 복제본은 9월 데이터라 오늘 기준으로 홈 아래 칸이 거의 다 빈다
 * (모집 중 공고 0 · 진행중인 전시 0 · 주목할 갤러리 0, 배너 사진은 실서버에서 지워져 404).
 * 칸은 보여 줄 게 없으면 스스로 숨으므로 로컬에서는 홈 배치를 확인할 수가 없다. 실서버처럼 보이게
 * 커뮤니티 데모의 **가상 갤러리 계정**(갤러리 한켠)으로 다음을 만든다:
 *   · 가상 갤러리 셋(승인) — 주목할 갤러리(이달의 갤러리) 셋
 *   · 모집 중 공고 넷(마감 D-1·3·6·12) — 마감임박 공모
 *   · 진행 중인 전시 셋 — 진행중인 전시
 *   · 배너 한 장(맨 앞, 데모 그림 둘을 오른쪽에 둔 3:1) — 누르면 첫 공고로
 *   · 사진이 없어진(404) 원래 배너는 잠깐 치워 둔다(10초마다 깨진 그림이 돌아온다) — --clean 이 그대로 되살린다
 *
 * ⚠️ 로컬 전용(데모 DB `artlink` 또는 실서버 복제본 `artlink_prod`). NODE_ENV=production 이거나 DB 가 localhost 가 아니면 멈춘다.
 * ⚠️ 먼저 `scripts/seed-community-demo.ts` 로 가상 계정(@community-demo.example.com)을 만들어 둘 것.
 * ⚠️ 만든 것은 승인 상태라 로컬 [갤러리]·[전시]·[모집공고] 목록에도 뜬다 — 확인이 끝나면 --clean.
 * 사진은 데모 그림(frontend/public/demo-art)과 그 그림을 ArtLook 으로 건 렌더 — 실제 작품이 아니다. 주소·전화도 지어낸 값이다.
 *
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-home-demo.ts           # 채우기
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-home-demo.ts --clean   # 지우기
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OWNER_EMAIL = 'gal@community-demo.example.com';
const SETTING_KEY = 'home-demo-seed';
const ROOT = path.resolve(__dirname, '../..');
const ART = path.join(ROOT, 'frontend/public/demo-art');
const RENDERS = path.join(ROOT, 'scratchpad/community-editor/media');   // ArtLook 렌더(있으면) — 없으면 데모 그림
const OUT_DIR = path.join(__dirname, '../uploads/home-demo');            // 디스크 모드에서 /uploads/home-demo/… 로 나간다
const OUT_URL = '/uploads/home-demo';

function assertLocal(): string {
  if (process.env.NODE_ENV === 'production') throw new Error('운영(NODE_ENV=production)에서는 돌리지 않습니다.');
  let host = '';
  let db = '';
  try { const u = new URL(process.env.DATABASE_URL || ''); host = u.hostname; db = u.pathname.replace(/^\//, ''); } catch { /* 아래에서 멈춘다 */ }
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error('로컬 DB(localhost)에서만 돌립니다. DATABASE_URL 을 확인하세요.');
  if (process.env.R2_ACCOUNT_ID) throw new Error('R2 설정이 켜져 있으면 /uploads 로 내보낼 수 없습니다(로컬 디스크 모드에서만).');
  return db;
}

/** 오늘(한국 날짜)에서 n일 뒤 — 날짜 칸이 저장하는 것과 같은 UTC 자정(CLAUDE.md 14) */
function kstDay(n: number): Date {
  const kst = new Date(Date.now() + 9 * 3600_000);
  kst.setUTCDate(kst.getUTCDate() + n);
  return new Date(`${kst.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** 갤러리 대표 사진 — ArtLook 렌더가 있으면 그걸 복사해 쓰고, 없으면 데모 그림 */
function galleryImage(render: string, fallback: string): string {
  const src = path.join(RENDERS, render);
  if (!fs.existsSync(src)) return `/demo-art/${fallback}`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(src, path.join(OUT_DIR, render));
  return `${OUT_URL}/${render}`;
}

/** 배너 — 데모 그림 둘을 밝은 바탕 오른쪽에(3:1). 글씨는 넣지 않는다(제목은 슬라이드 제목이 왼쪽 아래 빈 바탕에 쓴다) */
async function makeBanner(): Promise<string> {
  const W = 2400;
  const H = 800;
  const h = 580;
  const files = ['small-room.jpg', 'water-memory.jpg'];
  const tiles = await Promise.all(files.map(async (f) => {
    const buf = await sharp(path.join(ART, f)).resize({ height: h }).jpeg({ quality: 90 }).toBuffer();
    const { width = h } = await sharp(buf).metadata();
    return { buf, width };
  }));
  const gap = 70;
  const total = tiles.reduce((a, t) => a + t.width, 0) + gap * (tiles.length - 1);
  // 그림은 오른쪽에 — 배너 제목이 왼쪽 아래 빈 바탕 위에 앉게(그림 위에 글씨가 겹치지 않게)
  let x = W - 140 - total;
  const composite = tiles.map((t) => { const c = { input: t.buf, left: x, top: Math.round((H - h) / 2) }; x += t.width + gap; return c; });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ece7df' } }).composite(composite).jpeg({ quality: 88 }).toFile(path.join(OUT_DIR, 'banner.jpg'));
  return `${OUT_URL}/banner.jpg`;
}

const GALLERIES = [
  { name: '갤러리 한켠', region: 'SEOUL', render: 'show-cube.jpg', fallback: 'quiet-afternoon.jpg', description: '작은 전시를 오래 여는 동네 갤러리(가상).' },
  { name: '갤러리 북쪽창', region: 'BUSAN', render: 'show-salon.jpg', fallback: 'horizon.jpg', description: '바다가 보이는 언덕 위 전시장(가상).' },
  { name: '작은방 프로젝트', region: 'GYEONGGI_SOUTH', render: 'show-living.jpg', fallback: 'square-garden.jpg', description: '집처럼 꾸민 방에서 여는 전시(가상).' },
];

const CALLS = [
  { title: '겨울 단체전 《작은 방들》 참여 작가 모집', type: 'GROUP', region: 'SEOUL', days: 1, image: '/demo-art/small-room.jpg', capacity: 8,
    description: '작은 크기의 회화·드로잉으로 꾸미는 겨울 단체전입니다. 30호 이하 작품 2~3점을 출품할 작가를 찾습니다.' },
  { title: '신진 작가 개인전 공모 — 2027 봄 시즌', type: 'SOLO', region: 'SEOUL', days: 3, image: '/demo-art/water-memory.jpg', capacity: 2,
    description: '첫 개인전을 준비하는 작가를 위한 공모입니다. 전시 기간 2주, 설치·홍보를 함께 준비합니다.' },
  { title: '바다를 주제로 한 드로잉전 작가 모집', type: 'GROUP', region: 'BUSAN', days: 6, image: '/demo-art/horizon.jpg', capacity: 10,
    description: '바다와 수평선을 주제로 한 드로잉·판화 작업을 모읍니다.' },
  { title: '연말 소품전 《선물》 출품 작가 모집', type: 'GROUP', region: 'SEOUL', days: 12, image: '/demo-art/winter-garden.jpg', capacity: 12,
    description: '연말 선물로 건넬 수 있는 소품 위주의 판매 전시입니다.' },
];

const SHOWS = [
  { g: 0, title: '한지우 개인전 《물이 지나간 자리》', poster: '/demo-art/water-memory.jpg', from: -6, to: 15, artists: ['한지우'], fee: '무료' },
  { g: 1, title: '단체전 《수평선 아래》', poster: '/demo-art/horizon.jpg', from: -2, to: 20, artists: ['도하린', '오세린', '이준호'], fee: '무료' },
  { g: 2, title: '《작은 방, 긴 오후》', poster: '/demo-art/quiet-afternoon.jpg', from: -10, to: 6, artists: ['정하은', '김민서'], fee: '3,000원' },
];

interface Seeded { galleryIds?: number[]; galleryId?: number; exhibitionIds?: number[]; showIds?: number[]; gotmIds?: number[]; heroId?: number; parkedHeroes?: Record<string, unknown>[] }

/** 배너 사진이 지금 열리는가 — 로컬 파일(/uploads·/demo-art)은 늘 열린다고 본다 */
async function reachable(url: string): Promise<boolean> {
  if (!/^https?:\/\//.test(url)) return true;
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

async function clean() {
  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) { console.log('지울 홈 데모가 없습니다.'); return; }
  const v = JSON.parse(setting.value) as Seeded;
  const galleryIds = v.galleryIds ?? (v.galleryId ? [v.galleryId] : []);
  if (v.heroId) await prisma.heroSlide.deleteMany({ where: { id: v.heroId } });
  // 치워 둔 원래 배너를 같은 번호·같은 값으로 되살린다
  for (const row of v.parkedHeroes ?? []) {
    const r = row as { id: number; createdAt: string; updatedAt: string };
    await prisma.heroSlide.create({ data: { ...(row as object), createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) } as never });
  }
  // 갤러리를 지우면 공고·전시·이달의 갤러리가 따라 지워진다(onDelete: Cascade) — 그래도 남는 게 없게 하나씩
  const gotm = await prisma.galleryOfMonth.deleteMany({ where: { galleryId: { in: galleryIds } } });
  const shows = await prisma.show.deleteMany({ where: { id: { in: v.showIds ?? [] } } });
  const ex = await prisma.exhibition.deleteMany({ where: { id: { in: v.exhibitionIds ?? [] } } });
  const g = await prisma.gallery.deleteMany({ where: { id: { in: galleryIds } } });
  await prisma.appSetting.delete({ where: { key: SETTING_KEY } });
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  console.log(`지움: 배너 ${v.heroId ? 1 : 0} · 주목할 갤러리 ${gotm.count} · 전시 ${shows.count} · 공고 ${ex.count} · 갤러리 ${g.count}`);
}

async function fill(dbName: string) {
  if (await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } })) {
    console.log('이미 채워져 있습니다. 다시 채우려면 먼저 --clean 으로 지우세요.');
    return;
  }
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true, role: true, name: true } });
  if (!owner || owner.role !== 'GALLERY') throw new Error(`가상 갤러리 계정 ${OWNER_EMAIL} 가 없습니다 — 먼저 seed-community-demo.ts 를 돌려 주세요.`);

  const seeded: Seeded = { galleryIds: [], exhibitionIds: [], showIds: [], gotmIds: [] };
  const save = () => prisma.appSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: JSON.stringify(seeded) }, update: { value: JSON.stringify(seeded) } });

  for (const g of GALLERIES) {
    const row = await prisma.gallery.create({
      data: {
        name: g.name, ownerId: owner.id, ownerName: owner.name, status: 'APPROVED', region: g.region,
        address: '(예시 주소)', phone: '000-0000-0000', mainImage: galleryImage(g.render, g.fallback), description: g.description,
      },
    });
    seeded.galleryIds!.push(row.id);
    await save();
  }
  const [mainGallery] = seeded.galleryIds!;

  for (const c of CALLS) {
    const ex = await prisma.exhibition.create({
      data: {
        title: c.title, type: c.type, region: c.region, capacity: c.capacity, description: c.description, imageUrl: c.image,
        status: 'APPROVED', hostType: 'GALLERY', galleryId: mainGallery,
        deadlineStart: kstDay(-10), deadline: kstDay(c.days),
        submissionDeadline: kstDay(c.days + 5), exhibitStartDate: kstDay(c.days + 10), exhibitDate: kstDay(c.days + 24),
      },
    });
    seeded.exhibitionIds!.push(ex.id);
  }
  await save();

  for (const s of SHOWS) {
    const g = GALLERIES[s.g];
    const show = await prisma.show.create({
      data: {
        title: s.title, description: `${g.name}에서 열리는 전시입니다(가상).`, startDate: kstDay(s.from), endDate: kstDay(s.to),
        openingHours: '11:00-19:00', admissionFee: s.fee, location: `${g.name} (예시 주소)`, region: g.region,
        artists: JSON.stringify(s.artists), posterImage: s.poster, status: 'APPROVED', galleryId: seeded.galleryIds![s.g],
      },
    });
    seeded.showIds!.push(show.id);
  }
  await save();

  for (const galleryId of seeded.galleryIds!) {
    const row = await prisma.galleryOfMonth.create({ data: { galleryId, expiresAt: kstDay(30) } });
    seeded.gotmIds!.push(row.id);
  }
  await save();

  // 사진이 없어진 원래 배너는 잠깐 치운다(복제본은 9월 데이터라 그 사진이 실서버에서 지워졌다)
  seeded.parkedHeroes = [];
  for (const h of await prisma.heroSlide.findMany()) {
    if (await reachable(h.imageUrl)) continue;
    seeded.parkedHeroes.push(h as unknown as Record<string, unknown>);
    await save();
    await prisma.heroSlide.delete({ where: { id: h.id } });
  }
  const minOrder = (await prisma.heroSlide.aggregate({ _min: { order: true } }))._min.order ?? 0;
  const hero = await prisma.heroSlide.create({
    data: {
      title: CALLS[0].title, description: '예시 배너 — 로컬 확인용', imageUrl: await makeBanner(),
      linkUrl: `/exhibitions/${seeded.exhibitionIds![0]}`, order: minOrder - 1,
    },
  });
  seeded.heroId = hero.id;
  await save();
  console.log(`채움(${dbName}): 갤러리 ${seeded.galleryIds!.length}(주목할 갤러리) · 모집 중 공고 ${seeded.exhibitionIds!.length} · 진행 중 전시 ${seeded.showIds!.length} · 배너 1` +
    (seeded.parkedHeroes.length ? ` · 사진 없는 원래 배너 ${seeded.parkedHeroes.length}개 잠깐 치움(--clean 이 되살린다)` : ''));
}

(async () => {
  const db = assertLocal();
  if (process.argv.includes('--clean')) await clean();
  else await fill(db);
})()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
