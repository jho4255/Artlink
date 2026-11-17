/**
 * ArtStory 데모 채우기 (2026-11-14, 홈 공개 확인용) — 커뮤니티 데모의 **가상 계정**들로 소식·좋아요·댓글·신고를 만든다.
 *
 * ⚠️ 로컬 전용(데모 DB `artlink` 또는 실서버 복제본 `artlink_prod`). NODE_ENV=production 이거나 DB·API 가 localhost 가 아니면 멈춘다.
 * ⚠️ 먼저 `scripts/seed-community-demo.ts` 로 가상 계정(@community-demo.example.com)을 만들어 둘 것 — 이 스크립트는 계정을 만들지 않는다.
 * ⚠️ 실제 가입자 이름으로 쓰지 않는다 — 글쓴이·좋아요·댓글·신고는 전부 가상 계정. 관리자 알림이 실제 운영 계정에 가지 않게
 *    '신고 3명 → 저절로 내림'은 만들지 않는다(신고 2건 · 가상 운영 계정이 내린 소식 1건만).
 * 사진은 데모 그림(frontend/public/demo-art)과 그 그림을 ArtLook 으로 건 렌더(scratchpad/community-editor/media) — 실제 작품이 아니다.
 * 소식·사진은 **실제 API**(POST /api/upload/image · POST /api/stories)로 올린다 — 백엔드가 같은 DB 로 떠 있어야 한다.
 * 시각은 DB 에 바로 고쳐 쓴다(지난 사흘에 걸쳐 올린 것처럼).
 *
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-story-demo.ts           # 채우기
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-story-demo.ts --clean   # 지우기
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { deleteUploadedFiles } from '../src/lib/storage';

const prisma = new PrismaClient();
const DOMAIN = '@community-demo.example.com';
const SETTING_KEY = 'story-demo-seed';
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

interface Demo {
  who: string;                 // 가상 계정 key (`han` → han@community-demo.example.com)
  photos?: string[];           // 'art:파일' | 'm:파일'
  /** 사진 위 글(사진 번호 i) — 올리기 화면의 [Aa] 와 같은 값 */
  overlays?: { i: number; text: string; x?: number; y?: number; size?: 's' | 'm' | 'l'; style?: 'plain' | 'dark' | 'light' }[];
  caption: string;
  bg?: string;                 // 글만 소식 바탕색
  visibility?: 'PUBLIC' | 'NEIGHBORS';
  minutesAgo: number;
  likes?: string[];            // 좋아요 누를 가상 계정
  comments?: [string, string][];
  reportBy?: string[];         // 신고할 가상 계정(2명 이하 — 저절로 내려가지 않게)
  hideByOps?: boolean;         // 가상 운영 계정이 내린다
}

const STORIES: Demo[] = [
  { who: 'han', photos: ['art:water-memory', 'm:detail-water-memory'], caption: '북쪽 창 앞으로 이젤을 옮겼다. 오후 빛이 종이에 고르게 떨어진다.', minutesAgo: 38,
    likes: ['do', 'gal', 'oh', 'seo', 'choi'], comments: [['do', '창 쪽이 훨씬 낫네요.'], ['gal', '다음 주에 작업실 들러도 될까요?']] },
  { who: 'gal', photos: ['m:show-cube'], overlays: [{ i: 0, text: '금요일 저녁 6시 오픈', y: 0.84, style: 'dark' }], caption: '다음 주 단체전 설치 중이에요. 금요일 저녁 6시에 문 엽니다.', minutesAgo: 70,
    likes: ['han', 'oh', 'kim', 'jung', 'lee', 'choi'], comments: [['oh', '금요일에 갈게요.']] },
  { who: 'kim', caption: '내일 오픈 스튜디오 해요.\n오후 2시부터 6시까지,\n편하게 들러 주세요.', bg: 'slate', minutesAgo: 125, likes: ['han', 'seo'] },
  { who: 'do', photos: ['art:red-hill', 'm:detail-red-hill', 'm:wall-brick'], overlays: [{ i: 0, text: '세 번째 판', y: 0.16, size: 'l' }], caption: '세 번째 판을 찍었다. 빨강을 한 번 더 겹쳤다.', minutesAgo: 190,
    likes: ['han', 'kim', 'gal'], comments: [['han', '두 번째 사진의 칼자국이 좋아요.']] },
  { who: 'oh', photos: ['art:small-room'], overlays: [{ i: 0, text: '작은 방, 18×14cm', y: 0.88, size: 's', style: 'light' }], caption: '주운 창틀에 맞춰 그린 작은 방.', minutesAgo: 250, likes: ['gal', 'jung'] },
  { who: 'seo', photos: ['m:show-salon'], caption: '오늘 본 전시. 조명이 그림마다 따로 떨어진다.', minutesAgo: 320,
    likes: ['han', 'do'], comments: [['jung', '어디 전시인가요?'], ['seo', '성수동이에요. 이번 주 일요일까지래요.']] },
  { who: 'jung', photos: ['art:winter-garden'], caption: '창밖을 보고 바로 그린 작은 그림.', minutesAgo: 480, likes: ['oh'] },
  { who: 'lee', caption: '작업실 이사 끝.\n벽이 하얘서 아직 낯설다.', bg: 'forest', minutesAgo: 600, likes: ['kim', 'do'] },
  { who: 'choi', photos: ['m:show-living'], caption: '처음으로 그림을 한 점 샀다. 거실 벽이 갑자기 조용해졌다.', minutesAgo: 1300,
    likes: ['han', 'gal', 'kim', 'oh'], comments: [['gal', '좋은 자리를 찾았네요.']] },
  { who: 'han', photos: ['art:dawn-window'], caption: '새벽 창, 마무리 붓질.', minutesAgo: 1500, likes: ['do'] },
  { who: 'oh', photos: ['art:square-garden'], caption: '다음 시리즈 스케치. 이웃에게만 먼저.', visibility: 'NEIGHBORS', minutesAgo: 1600 },
  { who: 'do', caption: '판화 공방 회원 모집 중이에요.\n토요일 오전반, 네 명.', bg: 'ochre', minutesAgo: 2400, likes: ['lee'] },
  { who: 'gal', photos: ['m:show-collector'], caption: '지난 전시 철수하는 날. 다음 달에 다시 채웁니다.', minutesAgo: 2700, likes: ['han'] },
  { who: 'kim', photos: ['art:horizon', 'art:long-summer'], overlays: [{ i: 1, text: '긴 여름', x: 0.3, y: 0.2 }], caption: '여름에 그린 두 점을 다시 꺼냈다.', minutesAgo: 2900, likes: ['jung', 'lee'] },
  { who: 'jung', photos: ['m:wall-olive'], caption: '올리브색 벽에 걸어 보니 그림이 따뜻해진다.', minutesAgo: 3900 },
  { who: 'lee', photos: ['art:city-walk'], caption: '퇴근길 스케치를 옮겨 그렸다.', minutesAgo: 4300, reportBy: ['choi', 'seo'] },
  { who: 'seo', caption: '오늘은 아무 데도 안 가고\n도록만 넘겨 봤다.', bg: 'plum', minutesAgo: 4500, hideByOps: true },
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

async function clean() {
  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) { console.log('지울 ArtStory 데모가 없습니다.'); return; }
  const ids = (JSON.parse(setting.value) as { storyIds?: number[] }).storyIds ?? [];
  const rows = await prisma.story.findMany({ where: { id: { in: ids } }, select: { images: true } });
  const del = await prisma.story.deleteMany({ where: { id: { in: ids } } });   // 좋아요·댓글·신고는 따라 지워진다
  await deleteUploadedFiles(rows.flatMap((r) => r.images));
  await prisma.notification.deleteMany({ where: { OR: ids.map((id) => ({ linkUrl: { startsWith: `/feed?story=${id}` } })) } });
  await prisma.appSetting.delete({ where: { key: SETTING_KEY } });
  console.log(`지움: 소식 ${del.count} · 사진 파일 ${rows.flatMap((r) => r.images).length}`);
}

async function fill(dbName: string) {
  if (await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } })) {
    console.log('이미 채워져 있습니다. 다시 채우려면 먼저 --clean 으로 지우세요.');
    return;
  }
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true, role: true, email: true, name: true } });
  const byKey = new Map(users.map((u) => [u.email.replace(DOMAIN, ''), u]));
  const need = new Set(STORIES.flatMap((s) => [s.who, ...(s.likes ?? []), ...(s.comments ?? []).map((c) => c[0]), ...(s.reportBy ?? [])]));
  for (const k of need) if (!byKey.has(k)) throw new Error(`가상 계정 ${k}${DOMAIN} 가 없습니다 — 먼저 seed-community-demo.ts 를 돌려 주세요.`);
  const ops = byKey.get('ops');
  if (!ops || ops.role !== 'ADMIN') throw new Error(`가상 운영 계정 ops${DOMAIN} 가 없습니다.`);
  for (const s of STORIES) for (const ph of s.photos ?? []) sourcePath(ph);
  const tok = (k: string) => tokenFor(byKey.get(k)!);

  const storyIds: number[] = [];
  const save = () => prisma.appSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: JSON.stringify({ storyIds }) }, update: { value: JSON.stringify({ storyIds }) } });
  // 오래된 것부터 올린다(id 와 시각 순서가 같게)
  for (const s of [...STORIES].sort((a, b) => b.minutesAgo - a.minutesAgo)) {
    const t = tok(s.who);
    const images: string[] = [];
    for (const ph of s.photos ?? []) images.push(await upload(t, ph));
    const overlays = (s.overlays ?? []).map((o) => ({ x: 0.5, y: 0.5, size: 'm', style: 'plain', ...o }));
    const st = await call<{ id: number }>('POST', '/stories', t, { caption: s.caption, images, overlays, visibility: s.visibility ?? 'PUBLIC', bg: images.length ? null : (s.bg ?? 'slate') });
    storyIds.push(st.id);
    await save();
    const at = new Date(Date.now() - s.minutesAgo * 60_000);
    await prisma.story.update({ where: { id: st.id }, data: { createdAt: at } });
    for (const k of s.likes ?? []) await call('POST', `/stories/${st.id}/like`, tok(k));
    for (const [k, body] of s.comments ?? []) await call('POST', `/stories/${st.id}/comments`, tok(k), { body });
    for (const k of s.reportBy ?? []) await call('POST', `/stories/${st.id}/report`, tok(k), { reason: 'SPAM' });
    if (s.hideByOps) await call('PATCH', `/stories/${st.id}/hidden`, tokenFor(ops), { hidden: true });
    // 댓글·좋아요도 그 소식 뒤의 시각으로
    await prisma.storyComment.updateMany({ where: { storyId: st.id }, data: { createdAt: new Date(at.getTime() + 20 * 60_000) } });
    process.stdout.write('.');
  }

  // 화면에서 보이는지 — 비회원 공개 목록
  const pub = await fetch(`${API}/stories/public?rail=1`).then((r) => r.json() as Promise<{ stories: unknown[] }>);
  console.log(`\n채움(${dbName}): 소식 ${storyIds.length} · 홈 줄에 ${pub.stories.length}장`);
  console.log('개발자 로그인에서 "community-demo" 로 찾으면 가상 계정이 나옵니다(운영: ops@community-demo.example.com).');
}

async function main() {
  const db = assertLocal();
  if (process.argv.includes('--clean')) await clean();
  else await fill(db);
}

main()
  .catch((e) => { console.error('실패:', (e as Error).message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
