/**
 * 작가·갤러리 홈페이지 [소식] 탭 확인용 (2026-11-15, CLAUDE.md 규칙 82) — 가상 작가 '윤서진'(/@seojin.yoon)과
 * 가상 갤러리 '아트링크 갤러리'(/@artlink.gallery)에 ArtStory 소식·하이라이트를 올린다.
 *
 * ⚠️ 로컬 전용(데모 DB `artlink` 또는 실서버 복제본 `artlink_prod`). NODE_ENV=production 이거나 DB·API 가 localhost 가 아니면 멈춘다.
 * ⚠️ 먼저 `scripts/seed-intro-sample.ts` 로 두 가상 계정을 만들 것 — 이 스크립트는 계정을 만들지 않는다.
 * ⚠️ 실제 가입자 계정·작품은 쓰지 않는다. 사진은 데모 그림(frontend/public/demo-art, 절차적 생성)과 그 그림을 ArtLook 으로 건 렌더
 *    (scratchpad/community-editor/media — 없으면 `node scratchpad/community-editor/demo-media.mjs`).
 * 소식·사진·하이라이트는 **실제 API**(POST /api/upload/image · POST /api/stories · /api/stories/highlights…)로 올린다 —
 * 화면에서 올릴 때와 같은 검증을 탄다. 백엔드가 같은 DB 로 떠 있어야 한다. 시각만 DB 에 고쳐 쓴다(지난 열흘에 걸쳐 올린 것처럼).
 * 계정마다 6개 이하 — 하루 10개 상한(규칙 81)에 걸리지 않는다.
 *
 * 보이는 곳: /@seojin.yoon?tab=news · /@artlink.gallery?tab=news (홈 ArtStory 줄·[전체 보기]에도 나온다 — 전체공개라서)
 * 이웃 공개 소식 하나는 일부러 넣었다 — 비회원·이웃 아닌 사람에게는 [소식] 탭에서 빠져야 한다.
 *
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-intro-sample.ts
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-homepage-news-demo.ts           # 채우기
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-homepage-news-demo.ts --clean   # 지우기(소식·하이라이트·사진 파일)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { deleteUploadedFiles } from '../src/lib/storage';

const prisma = new PrismaClient();
const SETTING_KEY = 'homepage-news-demo-seed';
const ARTIST_EMAIL = 'intro-sample@artlink.test';
const GALLERY_EMAIL = 'intro-gallery@artlink.test';
const API = process.env.API || 'http://localhost:4000/api';
const ROOT = path.resolve(__dirname, '../..');
const ART_DIR = path.join(ROOT, 'frontend/public/demo-art');
const MEDIA_DIR = path.join(ROOT, 'scratchpad/community-editor/media');

function assertLocal(): string {
  if (process.env.NODE_ENV === 'production') throw new Error('운영(NODE_ENV=production)에서는 돌리지 않습니다.');
  let host = '';
  let db = '';
  try { const u = new URL(process.env.DATABASE_URL || ''); host = u.hostname; db = u.pathname.replace(/^\//, ''); } catch { /* 아래에서 멈춘다 */ }
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error('로컬 DB(localhost)에서만 돌립니다. DATABASE_URL 을 확인하세요.');
  const api = new URL(API);
  if (api.hostname !== 'localhost' && api.hostname !== '127.0.0.1') throw new Error('로컬 API(localhost)에서만 돌립니다.');
  return db;
}

type Who = 'artist' | 'gallery';
interface Demo {
  key: string;
  who: Who;
  photos?: string[];           // 'art:파일' | 'm:파일'
  overlays?: { i: number; text: string; x?: number; y?: number; size?: 's' | 'm' | 'l'; style?: 'plain' | 'dark' | 'light' }[];
  caption: string;
  bg?: 'slate' | 'earth' | 'forest' | 'plum' | 'ink' | 'ochre';
  visibility?: 'PUBLIC' | 'NEIGHBORS';
  hoursAgo: number;
  likedBy?: Who[];
}

const STORIES: Demo[] = [
  // 가상 작가 윤서진 — 작업 · 전시 소식 · 이웃 공개 하나
  { key: 'a-work', who: 'artist', photos: ['art:quiet-afternoon', 'm:detail-quiet-afternoon'], overlays: [{ i: 0, text: '오늘의 작업', y: 0.14, style: 'dark' }],
    caption: '오후 빛이 가장 길게 들어오는 시간에 마지막 층을 올렸다.', hoursAgo: 5, likedBy: ['gallery'] },
  { key: 'a-open', who: 'artist', caption: '《빛의 결》 전시가 시작됐어요.\n아트링크 갤러리에서 다음 달까지.', bg: 'slate', hoursAgo: 26, likedBy: ['gallery'] },
  { key: 'a-install', who: 'artist', photos: ['m:show-cube'], overlays: [{ i: 0, text: '설치 끝', y: 0.86, style: 'light' }],
    caption: '설치를 마친 전시장. 그림 사이 간격을 세 번 바꿨다.', hoursAgo: 50 },
  { key: 'a-three', who: 'artist', photos: ['art:long-summer', 'art:blue-wall', 'art:red-hill'], caption: '이번 전시에 걸리는 세 점.', hoursAgo: 74 },
  { key: 'a-neighbors', who: 'artist', photos: ['art:water-memory'], caption: '다음 시리즈를 위한 작은 습작 — 이웃에게만 먼저.', visibility: 'NEIGHBORS', hoursAgo: 100 },
  { key: 'a-studio', who: 'artist', photos: ['m:wall-plaster'], caption: '작업실 벽에 걸어 두고 한 주 동안 보는 중.', hoursAgo: 170 },
  // 가상 갤러리 아트링크 갤러리 — 지금 전시 · 행사 · 지난 전시
  { key: 'g-now', who: 'gallery', photos: ['m:show-salon'], overlays: [{ i: 0, text: '지금 전시 중', y: 0.12, style: 'dark' }],
    caption: '윤서진 개인전 《빛의 결》 — 다음 달까지, 화–일 11시부터 7시.', hoursAgo: 8, likedBy: ['artist'] },
  { key: 'g-talk', who: 'gallery', caption: '이번 토요일 오후 3시\n작가와의 대화가 있어요.\n예약 없이 오세요.', bg: 'ochre', hoursAgo: 30 },
  { key: 'g-sold', who: 'gallery', photos: ['m:show-collector', 'm:show-living'], caption: '지난 전시에서 새 주인을 찾은 그림들.', hoursAgo: 80 },
  { key: 'g-next', who: 'gallery', photos: ['m:show-boutique'], caption: '다음 시즌 공모를 준비하고 있습니다.', hoursAgo: 150 },
];

/** 하이라이트 — 이름 · 담을 소식(key) · 표지(key) */
const HIGHLIGHTS: { who: Who; name: string; stories: string[]; cover: string }[] = [
  { who: 'artist', name: '빛의 결', stories: ['a-three', 'a-install', 'a-open'], cover: 'a-three' },
  { who: 'gallery', name: '지난 전시', stories: ['g-sold', 'g-next'], cover: 'g-sold' },
];

function tokenFor(u: { id: number; role: string }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET 이 없습니다(backend/.env).');
  return jwt.sign({ userId: u.id, role: u.role }, secret, { expiresIn: '1h' });
}

async function call<T>(method: string, url: string, token: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(API + url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 5000 * (attempt + 1))); continue; }
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  throw new Error(`${method} ${url} → 429 (요청 한도) — 15분 뒤 다시 돌려 주세요.`);
}

function sourcePath(name: string): string {
  const [kind, file] = name.split(':') as [string, string];
  const p = kind === 'art' ? path.join(ART_DIR, `${file}.jpg`) : path.join(MEDIA_DIR, `${file}.jpg`);
  if (!fs.existsSync(p)) {
    throw new Error(kind === 'm'
      ? `사진이 없습니다: ${path.relative(ROOT, p)} — 먼저 \`node scratchpad/community-editor/demo-media.mjs\` 를 돌려 주세요.`
      : `데모 그림이 없습니다: ${path.relative(ROOT, p)}`);
  }
  return p;
}

async function upload(token: string, name: string): Promise<string> {
  const buf = fs.readFileSync(sourcePath(name));
  for (let attempt = 0; attempt < 4; attempt++) {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }), `${name.replace(':', '-')}.jpg`);
    const r = await fetch(`${API}/upload/image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (r.status === 429 || r.status === 503) { await new Promise((res) => setTimeout(res, 4000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`사진 올리기 실패(${name}) → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return ((await r.json()) as { url: string }).url;
  }
  throw new Error(`사진 올리기 실패(${name}) — 요청 한도`);
}

async function accounts() {
  const artist = await prisma.user.findUnique({ where: { email: ARTIST_EMAIL }, select: { id: true, role: true, handle: true } });
  const gallery = await prisma.user.findUnique({ where: { email: GALLERY_EMAIL }, select: { id: true, role: true } });
  if (!artist || !gallery) throw new Error('가상 작가·갤러리가 없습니다 — 먼저 `npx tsx scripts/seed-intro-sample.ts` 를 돌려 주세요.');
  return { artist, gallery };
}

async function clean() {
  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) { console.log('지울 홈페이지 소식 데모가 없습니다.'); return; }
  const saved = JSON.parse(setting.value) as { storyIds?: number[]; highlightIds?: number[] };
  const ids = saved.storyIds ?? [];
  const rows = await prisma.story.findMany({ where: { id: { in: ids } }, select: { images: true } });
  await prisma.storyHighlight.deleteMany({ where: { id: { in: saved.highlightIds ?? [] } } });
  const del = await prisma.story.deleteMany({ where: { id: { in: ids } } });   // 좋아요·댓글은 따라 지워진다
  await deleteUploadedFiles(rows.flatMap((r) => r.images));
  if (ids.length) await prisma.notification.deleteMany({ where: { OR: ids.map((id) => ({ linkUrl: { startsWith: `/feed?story=${id}` } })) } });
  await prisma.appSetting.delete({ where: { key: SETTING_KEY } });
  console.log(`지움: 소식 ${del.count} · 하이라이트 ${(saved.highlightIds ?? []).length} · 사진 파일 ${rows.flatMap((r) => r.images).length}`);
}

async function fill(dbName: string) {
  if (await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } })) {
    console.log('이미 채워져 있습니다. 다시 채우려면 먼저 --clean 으로 지우세요.');
    return;
  }
  const { artist, gallery } = await accounts();
  for (const s of STORIES) for (const ph of s.photos ?? []) sourcePath(ph);
  const tok: Record<Who, string> = { artist: tokenFor(artist), gallery: tokenFor(gallery) };

  const storyIds: number[] = [];
  const highlightIds: number[] = [];
  const byKey = new Map<string, number>();
  const save = () => prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify({ storyIds, highlightIds }) },
    update: { value: JSON.stringify({ storyIds, highlightIds }) },
  });

  // 오래된 것부터 올린다(id 와 시각 순서가 같게)
  for (const s of [...STORIES].sort((a, b) => b.hoursAgo - a.hoursAgo)) {
    const images: string[] = [];
    for (const ph of s.photos ?? []) images.push(await upload(tok[s.who], ph));
    const overlays = (s.overlays ?? []).map((o) => ({ x: 0.5, y: 0.5, size: 'm', style: 'plain', ...o }));
    const st = await call<{ id: number }>('POST', '/stories', tok[s.who], {
      caption: s.caption, images, overlays, visibility: s.visibility ?? 'PUBLIC', bg: images.length ? null : (s.bg ?? 'slate'),
    });
    storyIds.push(st.id);
    byKey.set(s.key, st.id);
    await save();
    await prisma.story.update({ where: { id: st.id }, data: { createdAt: new Date(Date.now() - s.hoursAgo * 3_600_000) } });
    for (const w of s.likedBy ?? []) await call('POST', `/stories/${st.id}/like`, tok[w]);
    process.stdout.write('.');
  }

  for (const h of HIGHLIGHTS) {
    const hl = await call<{ id: number }>('POST', '/stories/highlights', tok[h.who], { name: h.name, isPublic: true });
    highlightIds.push(hl.id);
    await save();
    for (const k of h.stories) await call('POST', `/stories/highlights/${hl.id}/stories/${byKey.get(k)}`, tok[h.who]);
    await call('PATCH', `/stories/highlights/${hl.id}`, tok[h.who], { coverStoryId: byKey.get(h.cover) });
  }

  // 화면에서 보이는지 — 비회원으로 두 홈페이지의 [소식] 수
  const pf = await fetch(`${API}/portfolio/${artist.id}`).then((r) => r.json() as Promise<{ storyCount?: number; highlightCount?: number }>);
  const g = await prisma.gallery.findFirst({ where: { ownerId: gallery.id }, select: { id: true, handle: true } });
  const gd = g ? await fetch(`${API}/galleries/${g.id}`).then((r) => r.json() as Promise<{ storyCount?: number; highlightCount?: number }>) : null;
  console.log(`\n채움(${dbName}): 소식 ${storyIds.length} · 하이라이트 ${highlightIds.length}`);
  console.log(`  작가 /@${artist.handle ?? artist.id}?tab=news — 비회원에게 소식 ${pf.storyCount ?? '?'} · 하이라이트 ${pf.highlightCount ?? '?'} (이웃 공개 1개는 빠진다)`);
  if (g) console.log(`  갤러리 /@${g.handle ?? `galleries/${g.id}`}?tab=news — 비회원에게 소식 ${gd?.storyCount ?? '?'} · 하이라이트 ${gd?.highlightCount ?? '?'}`);
}

async function main() {
  const db = assertLocal();
  if (process.argv.includes('--clean')) await clean();
  else await fill(db);
}

main()
  .catch((e) => { console.error('실패:', (e as Error).message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
