/**
 * 커뮤니티 데모 채우기 (2026-11-13, 블로그형 편집기 확인용) — 가상의 필진·회원·운영 계정과 글·댓글·좋아요·쓰던 글을 만든다.
 *
 * ⚠️ 로컬 전용(데모 DB `artlink` 또는 실서버 복제본 `artlink_prod`). NODE_ENV=production 이거나 DB·API 가 localhost 가 아니면 멈춘다.
 * ⚠️ 이 스크립트가 만든 것만 지운다(--clean):
 *    계정 = 이메일 `@community-demo.example.com`(보내지 않는 주소) · 탭 = AppSetting `community-demo-seed` 에 적어 둔 id ·
 *    사진 = 그 계정들이 올린 글 사진(PostAsset)과 그 파일.
 * ⚠️ 실제 가입자 이름으로 글을 쓰지 않는다 — 글쓴이·댓글·좋아요는 전부 가상 계정이다.
 * 사진은 데모 그림(frontend/public/demo-art, 절차적 생성)과 그 그림을 ArtLook 으로 벽에 건 렌더(scratchpad/community-editor/media —
 * `node scratchpad/community-editor/demo-media.mjs` 로 만든다). 실제 가입자 작품은 쓰지 않는다.
 *
 * 글·사진은 **실제 API**(POST /api/upload/post-image · POST /api/community · PUT /api/community/writers/:id)로 올린다 —
 * 등록 검증(postDoc publish 모드)·썸네일(t240·t800·t1280)·사진 기록이 화면에서 올릴 때와 같은 길을 탄다.
 * 그래서 **백엔드가 같은 DB 로 떠 있어야 한다**(첫 탭을 만든 뒤 API 로 보이는지 확인하고, 안 보이면 되돌리고 멈춘다).
 * 날짜·조회수·댓글·좋아요는 DB 에 바로 쓴다(지난 3주에 걸쳐 쓴 것처럼).
 *
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-community-demo.ts           # 채우기
 *   cd backend && DATABASE_URL=<로컬 DB 주소> npx tsx scripts/seed-community-demo.ts --clean   # 지우기
 * (DATABASE_URL 을 안 주면 backend/.env 의 주소 — 보통 데모 DB)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { cleanupPostImages } from '../src/lib/postAssets';

const prisma = new PrismaClient();
const DOMAIN = '@community-demo.example.com';
const SETTING_KEY = 'community-demo-seed';
const API = process.env.API || 'http://localhost:4000/api';
const ROOT = path.resolve(__dirname, '../..');
const ART_DIR = path.join(ROOT, 'frontend/public/demo-art');
const MEDIA_DIR = path.join(ROOT, 'scratchpad/community-editor/media');

// ── 안전 확인 ────────────────────────────────────────────────────────────────
function assertLocal() {
  if (process.env.NODE_ENV === 'production') throw new Error('운영(NODE_ENV=production)에서는 돌리지 않습니다.');
  const raw = process.env.DATABASE_URL || '';
  let host = '';
  let db = '';
  try { const u = new URL(raw); host = u.hostname; db = u.pathname.replace(/^\//, ''); } catch { /* 아래에서 멈춘다 */ }
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error('로컬 DB(localhost)에서만 돌립니다. DATABASE_URL 을 확인하세요.');
  const api = new URL(API);
  if (api.hostname !== 'localhost' && api.hostname !== '127.0.0.1') throw new Error('로컬 API(localhost)에서만 돌립니다.');
  return db;
}

// ── 계정 ─────────────────────────────────────────────────────────────────────
type Role = 'ARTIST' | 'GALLERY' | 'VISITOR' | 'ADMIN';
interface Person { key: string; name: string; role: Role; handle?: string; writer?: boolean }
const PEOPLE: Person[] = [
  { key: 'han', name: '한지우', role: 'ARTIST', handle: 'hanjiwoo.studio', writer: true },
  { key: 'do', name: '도하린', role: 'ARTIST', handle: 'harin.mokpan', writer: true },
  { key: 'oh', name: '오세린', role: 'ARTIST', handle: 'serin.objects', writer: true },
  { key: 'gal', name: '갤러리 한켠', role: 'GALLERY', writer: true },
  { key: 'seo', name: '서도윤', role: 'VISITOR', writer: true },
  { key: 'kim', name: '김민서', role: 'ARTIST' },
  { key: 'lee', name: '이준호', role: 'ARTIST' },
  { key: 'jung', name: '정하은', role: 'ARTIST' },
  { key: 'choi', name: '최유진', role: 'VISITOR' },
  { key: 'ops', name: 'ArtLink 운영팀', role: 'ADMIN' },
];
const emailOf = (key: string) => `${key}${DOMAIN}`;

// 필진 작가의 홈페이지 — 글의 작성자 카드 [홈페이지] 가 빈 화면이 아니게. 작품은 데모 그림 주소 그대로(파일을 만들지 않는다)
const PORTFOLIOS: Record<string, { tagline: string; statement: string; works: { file: string; title: string; year: string; medium: string; size: string }[] }> = {
  han: {
    tagline: '물과 빛이 지나간 자리를 그립니다',
    statement: '마르기 전에 멈추는 것. 물감이 종이 위에서 스스로 길을 찾는 시간을 기다렸다가, 그 흔적 위에 다시 물을 얹는다. 번짐은 실수가 아니라 재료가 대답하는 방식이라고 믿는다.',
    works: [
      { file: 'water-memory.jpg', title: '물의 기억', year: '2025', medium: 'Acrylic on canvas', size: '116.8 × 91 cm' },
      { file: 'dawn-window.jpg', title: '새벽 창', year: '2025', medium: 'Oil on canvas', size: '72.7 × 60.6 cm' },
      { file: 'blue-wall.jpg', title: '푸른 벽', year: '2024', medium: 'Acrylic on canvas', size: '90.9 × 72.7 cm' },
      { file: 'quiet-afternoon.jpg', title: '조용한 오후', year: '2024', medium: 'Oil on canvas', size: '60.6 × 80.3 cm' },
    ],
  },
  do: {
    tagline: '목판 위에서 천천히 깎아 내는 시간',
    statement: '한 장을 찍기 위해 열흘을 깎는다. 칼이 지나간 자리만 종이에 남는다는 단순한 규칙이 좋아서 목판을 한다.',
    works: [
      { file: 'red-hill.jpg', title: '붉은 언덕', year: '2025', medium: '목판화, 한지', size: '45 × 60 cm' },
      { file: 'horizon.jpg', title: '수평선', year: '2024', medium: '목판화, 한지', size: '30 × 72 cm' },
      { file: 'winter-garden.jpg', title: '겨울 정원', year: '2025', medium: '목판화', size: '40 × 50 cm' },
    ],
  },
  oh: {
    tagline: '버려진 재료로 공간을 다시 짓습니다',
    statement: '철거 현장에서 주운 창틀·문짝·타일로 작업한다. 누군가 살았던 공간의 크기가 재료에 그대로 남아 있다.',
    works: [
      { file: 'small-room.jpg', title: '작은 방', year: '2025', medium: '창틀, 아크릴', size: '110 × 80 cm' },
      { file: 'forgotten-alley.jpg', title: '잊힌 골목', year: '2024', medium: '혼합 재료', size: '100 × 76 cm' },
      { file: 'square-garden.jpg', title: '네모 정원', year: '2025', medium: '나무 패널에 아크릴', size: '60 × 60 cm' },
    ],
  },
};

// ── 탭 ───────────────────────────────────────────────────────────────────────
interface TabSpec { key: string; name: string; slug: string; order: number; writePolicy: 'all' | 'writers' | 'admin'; layout: 'list' | 'card'; allowAnonymous: boolean; description: string }
const NEW_TABS: TabSpec[] = [
  { key: 'worklog', name: '작업일지', slug: 'worklog', order: -6, writePolicy: 'writers', layout: 'card', allowAnonymous: false, description: '작업실에서 보낸 하루하루의 기록' },
  { key: 'tips', name: '꿀팁', slug: 'tips', order: -5, writePolicy: 'writers', layout: 'card', allowAnonymous: false, description: '작업·지원·전시에 바로 쓰는 요령' },
  { key: 'reviews', name: '전시 후기', slug: 'reviews', order: -4, writePolicy: 'writers', layout: 'card', allowAnonymous: false, description: '필진이 보고 온 전시 이야기' },
  { key: 'prep', name: '전시 준비', slug: 'prep', order: -3, writePolicy: 'writers', layout: 'card', allowAnonymous: false, description: '첫 전시를 앞둔 분들을 위한 준비 노트' },
  { key: 'qna', name: '질문', slug: 'qna', order: -2, writePolicy: 'all', layout: 'list', allowAnonymous: true, description: '작업·지원·전시, 무엇이든 물어보세요' },
];
// 없을 때만 만든다(복제본에는 '자유게시판'·'공지사항'이 이미 있다 — 그대로 쓴다)
const FALLBACK_TABS: (TabSpec & { match: string })[] = [
  { key: 'free', match: '자유', name: '자유', slug: 'free', order: 20, writePolicy: 'all', layout: 'list', allowAnonymous: true, description: '' },
  { key: 'notice', match: '공지', name: '공지', slug: 'notice', order: 30, writePolicy: 'admin', layout: 'list', allowAnonymous: false, description: '' },
];

// ── 문서 만들기 ──────────────────────────────────────────────────────────────
type Seg = string | { t: string; b?: boolean; i?: boolean; hl?: boolean; href?: string };
type Node = Record<string, unknown>;
const inline = (segs: Seg[]): Node[] => segs.map((s) => {
  if (typeof s === 'string') return { type: 'text', text: s };
  const marks: Node[] = [];
  if (s.b) marks.push({ type: 'bold' });
  if (s.i) marks.push({ type: 'italic' });
  if (s.hl) marks.push({ type: 'highlight' });
  if (s.href) marks.push({ type: 'link', attrs: { href: s.href } });
  return marks.length ? { type: 'text', text: s.t, marks } : { type: 'text', text: s.t };
});
const P = (...segs: Seg[]): Node => ({ type: 'paragraph', content: inline(segs) });
const H2 = (t: string): Node => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });
const H3 = (t: string): Node => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: t }] });
const item = (x: Seg | Seg[]): Node => ({ type: 'listItem', content: [P(...(Array.isArray(x) ? x : [x]))] });
const UL = (...items: (Seg | Seg[])[]): Node => ({ type: 'bulletList', content: items.map(item) });
const OL = (...items: (Seg | Seg[])[]): Node => ({ type: 'orderedList', content: items.map(item) });
const QUOTE = (t: string, pull = false): Node => ({ type: 'blockquote', ...(pull ? { attrs: { variant: 'pull' } } : {}), content: [P(t)] });
const CALLOUT = (tone: 'tip' | 'note', ...paras: Node[]): Node => ({ type: 'callout', attrs: { tone }, content: paras });
const HR: Node = { type: 'horizontalRule' };
/** 사진 자리 — 올린 뒤 주소·치수로 바뀐다. 이름은 `art:<데모 그림>` 또는 `m:<렌더>` */
const FIG = (img: string, size: 'text' | 'wide' | 'full' = 'text', caption = ''): Node => ({ $fig: img, size, caption });
const GAL = (imgs: string[], layout: 'row' | 'grid' | 'slide' = 'row', caption = '', size: 'text' | 'wide' | 'full' = 'text'): Node => ({ $gal: imgs, layout, caption, size });
/** 동영상 자리 — media/<이름>.webm 을 올린다(demo-video.py 가 만든다). 치수는 화면이 재는 값이라 여기 적는다 */
const VID = (name: string, width: number, height: number, caption = ''): Node => ({ $vid: name, width, height, caption });
/** 투표 — 보기 id 는 고정(다시 채워도 같은 표) */
const POLL = (question: string, options: string[], multiple = false, endsInDays: number | null = null): Node => ({
  type: 'poll',
  attrs: {
    question,
    options: options.map((text, i) => ({ id: `opt${i + 1}x`, text })),
    multiple,
    endsAt: endsInDays == null ? null : new Date(Date.now() + endsInDays * 24 * 60 * 60 * 1000).toISOString(),
  },
});

interface PostSpec {
  key: string; tab: string; author: string; anonymous?: boolean; title: string;
  daysAgo: number; views: number; likes: number; notice?: boolean;
  doc: Node[];
  /** [작성자 key, 글, 익명?, 이 목록에서 몇 번째 댓글에 단 답글인가?, 지운 댓글(답글이 남아 자리만)?] */
  comments?: [string, string, boolean?, number?, boolean?][];
  /** 투표 — [투표한 사람 key, 고른 보기 번호(0부터, 복수 선택이면 배열)] */
  votes?: [string, number | number[]][];
  /** 투표를 이미 마감한 것으로 */
  pollClosed?: boolean;
}

const POSTS: PostSpec[] = [
  // ── 작업일지 ──
  {
    key: 'han-water', tab: 'worklog', author: 'han', title: '물 번짐을 붙잡는 세 번의 겹칠', daysAgo: 3.1, views: 512, likes: 7,
    doc: [
      P('이번 연작은 ‘마르기 전에 멈추는 것’에서 시작했다. 물감이 종이 위에서 스스로 길을 찾는 시간을 기다렸다가, 그 흔적 위에 다시 물을 얹는다. 지난 두 달 동안 같은 크기의 그림 여섯 점을 나란히 놓고 작업했다.'),
      FIG('m:detail-water-memory', 'wide', '두 번째 겹칠이 마르기 직전. 가장자리만 살짝 들려 있다.'),
      H2('첫 번째 — 물을 먼저 깐다'),
      P('붓에 물감을 묻히기 전에 깨끗한 물로 화면 전체를 한 번 적신다. 이때 ', { t: '물의 양이 그날 그림의 성격을 정한다', b: true }, '. 많으면 번짐이 넓게 퍼지고, 적으면 붓 자국이 또렷하게 남는다. 요즘은 넓은 평붓으로 두 번 오가는 정도가 가장 마음에 든다.'),
      H2('두 번째 — 기다리는 시간을 재지 않는다'),
      P('예전에는 타이머를 맞춰 놓고 10분, 15분씩 기다렸다. 그런데 작업실 습도가 날마다 달라서 같은 시간이 같은 상태를 만들지 않았다. 지금은 손등을 화면 가까이 대 보고 ', { t: '서늘한 기운이 사라지기 직전', i: true }, '에 다음 색을 얹는다.'),
      QUOTE('번짐은 실수가 아니라 종이가 대답하는 방식이다.', true),
      H2('세 번째 — 지우는 것도 그리는 일'),
      P('마지막 겹칠은 더하는 대신 걷어 낸다. 마른 붓으로 가장자리를 닦아 내면 빛이 지나간 자리처럼 밝은 띠가 생긴다. 이 띠가 몇 개 생기느냐에 따라 그림의 시간이 달라 보인다.'),
      GAL(['art:water-memory', 'art:dawn-window', 'art:blue-wall'], 'row', '왼쪽부터 〈물의 기억〉, 〈새벽 창〉, 〈푸른 벽〉'),
      CALLOUT('note', P('다음 작업일지에서는 종이를 바꿔 본 결과를 적을게요. 300g 냉압지와 640g 황목을 비교하고 있어요.')),
    ],
    comments: [
      ['choi', '번짐을 ‘대답’이라고 쓰신 문장이 오래 남네요.'],
      ['do', '세 번째 겹칠 사진 좋아요. 종이 바꾼 결과도 기다릴게요.'],
      ['han', '감사합니다. 다음 주에 꼭 올릴게요!', false, 1],
      ['do', '황목도 꼭 같이 비교해 주세요!', false, 2],
      ['han', '문장 하나 붙잡는 데 한참 걸렸어요 ㅎㅎ', false, 0],
    ],
  },
  {
    key: 'do-woodcut', tab: 'worklog', author: 'do', title: '목판 한 장을 깎는 데 걸린 열하루', daysAgo: 6.2, views: 289, likes: 5,
    doc: [
      P('〈붉은 언덕〉은 45×60cm 목판 한 장이다. 밑그림부터 시험 찍기까지 꼬박 열하루가 걸렸다. 작업하는 동안 날마다 짧게 적어 둔 것을 옮긴다.'),
      FIG('m:detail-red-hill', 'text', '칼자국이 겹치는 부분. 여기서만 이틀을 썼다.'),
      H2('쓴 도구'),
      UL('둥근칼 3mm · 6mm', '세모칼 하나', '숫돌 1000방 · 6000방', ['바렌 대신 ', { t: '나무 숟가락', b: true }]),
      H2('열하루'),
      OL('1–2일: 밑그림을 먹지로 옮기고 먹으로 다시 긋기', '3–7일: 큰 면 걷어 내기 — 결 방향을 따라서만', '8–10일: 선 다듬기, 칼을 하루에 세 번 갈았다', '11일: 시험 찍기 다섯 장'),
      P('가장 오래 걸린 건 언덕의 윤곽이었다. 칼이 결을 거슬러 들어가면 나무가 뜯겨 나간다. 결이 바뀌는 자리마다 판을 돌려 가며 깎았다.'),
      FIG('art:red-hill', 'wide', '시험 찍기 세 번째 장. 이 장이 가장 마음에 든다.'),
      P('찍어 놓고 보면 깎는 데 쓴 시간은 하나도 보이지 않는다. 그래도 그 시간이 있어야 선이 이렇게 고르게 나온다.'),
    ],
    comments: [['oh', '열하루… 칼은 어디 제품 쓰세요?'], ['do', '일본 제품 둥근칼에 국산 세모칼 섞어 써요. 칼보다 숫돌이 더 중요하더라고요.', false, 0], ['jung', '판화 처음인데 숟가락으로 찍는 거 저도 해 봐야겠어요.', true]],
  },
  {
    key: 'oh-windows', tab: 'worklog', author: 'oh', title: '버려진 창틀 열두 개를 주웠다', daysAgo: 9.1, views: 198, likes: 4,
    doc: [
      P('동네 재개발 현장에서 창틀 열두 개를 얻었다. 철거하시던 분께 사정을 말씀드리니 트럭에 실어 작업실 앞까지 가져다주셨다. 창틀마다 크기도 칠도 달랐다. 누군가 수십 년을 그 창 앞에서 살았다는 게 손에 잡혔다.'),
      GAL(['art:small-room', 'art:forgotten-alley', 'art:city-walk', 'art:square-garden'], 'grid', '창틀 크기에 맞춰 다시 그린 장면들'),
      P('그림은 창틀 안쪽 치수에 맞춰 그렸다. 창 너머에 있었을 법한 장면을 상상해서. 어떤 창은 골목을, 어떤 창은 작은 방을 향했을 것 같았다.'),
      H3('재료 기록'),
      UL('창틀 칠은 벗기지 않고 그대로 — 갈라진 자리에 바니시만 얇게', '그림은 나무 패널에 아크릴, 창틀 뒤에서 나사로 고정', '유리는 빼고 보관(운송 때 깨질 위험)'),
      P('다음 달 오픈 스튜디오에서 처음 보여 드린다. 창틀이 무거워서 벽에 거는 방법은 아직 고민 중이다.'),
    ],
  },
  {
    key: 'han-studio', tab: 'worklog', author: 'han', title: '작업실 이사, 그리고 북쪽 창', daysAgo: 15.3, views: 76, likes: 2,
    doc: [
      P('5년 쓴 작업실을 정리하고 조금 더 높은 층으로 옮겼다. 고른 이유는 하나, 북쪽으로 큰 창이 있어서다. 북쪽 빛은 하루 종일 크게 변하지 않아 색을 보기에 좋다.'),
      FIG('m:wall-plaster', 'text', '새 작업실 북쪽 벽. 오후 세 시의 빛.'),
      P('짐을 다 풀지도 않았는데 첫 그림을 벽에 걸어 봤다. 같은 그림인데 예전 작업실에서보다 훨씬 차분해 보인다. 당분간은 이 벽 앞에서만 마무리를 하려고 한다.'),
    ],
  },
  // ── 꿀팁 ──
  {
    key: 'han-photo', tab: 'tips', author: 'han', title: '작품 사진, 휴대폰 하나로 제대로 찍는 법', daysAgo: 2.1, views: 834, likes: 9,
    doc: [
      P('공모 지원서에서 가장 먼저 보이는 건 작품 사진이다. 비싼 장비 없이 휴대폰 하나로도 충분히 좋은 사진을 찍을 수 있다. 몇 해 동안 지원서를 내면서 정리한 방법을 나눈다.'),
      CALLOUT('tip', P({ t: '가장 중요한 한 가지', b: true }, ' — 그림과 휴대폰을 평행하게. 비스듬하면 사각형이 사다리꼴이 되고, 보는 사람은 그림 크기를 가늠할 수 없어요.')),
      H2('1. 빛 — 해가 직접 들지 않는 창가'),
      P('직사광선은 그림 위에 반사를 만든다. 북쪽 창가나 흐린 날 오후가 가장 좋다. 실내 조명은 끄고, 창빛 하나만 쓴다.'),
      H2('2. 각도 — 그림 정중앙 높이에서'),
      P('휴대폰 렌즈가 그림의 정중앙을 바라보게 한다. 삼각대가 없으면 책을 쌓아 높이를 맞추고 2초 타이머를 쓰면 흔들림도 없다. 광각 렌즈(0.5배)는 가장자리를 휘게 하니 ', { t: '1배 또는 2배', hl: true }, '로 찍는다.'),
      H2('3. 색 — 흰 종이 한 장을 같이 찍는다'),
      P('그림 옆에 흰 종이를 대고 한 장, 빼고 한 장 찍는다. 나중에 보정할 때 흰 종이가 하얗게 보이도록 맞추면 색이 거의 정확해진다.'),
      GAL(['m:detail-quiet-afternoon', 'art:quiet-afternoon'], 'row', '부분과 전체. 둘 다 찍어 두면 지원서에 쓰기 좋다.'),
      H2('4. 크기는 세로×가로'),
      P('사진과 함께 크기를 적을 땐 세로를 먼저 쓴다. 아트링크 홈페이지에 올릴 때도 같은 순서다. ', { t: '내 홈페이지에서 작품 정보 채우기', href: '/mypage?tab=homepage-edit' }),
    ],
    comments: [['kim', '흰 종이 같이 찍는 거 바로 해 봤는데 색이 확 달라지네요.'], ['lee', '북쪽 빛 팁 좋네요. 저는 늘 형광등 아래서 찍었어요.'], ['gal', '갤러리 입장에서도 정말 중요한 내용입니다. 비스듬한 사진은 크기 가늠이 안 돼요.'], ['choi', '삼각대 없으면 어떻게 하세요?', true], ['han', '책 몇 권 쌓고 그 위에 올려요. 타이머 2초 쓰면 흔들림도 없어요.', false, 3], ['choi', '오, 책 쌓기 바로 해 볼게요!', true, 4]],
  },
  {
    key: 'gal-apply', tab: 'tips', author: 'gal', title: '공모 지원서에서 갤러리가 먼저 보는 것', daysAgo: 4.2, views: 377, likes: 6,
    doc: [
      P('저희는 한 해에 여섯 번 공모를 엽니다. 지원서가 많을 땐 한 공모에 이백 통이 넘게 옵니다. 그 많은 지원서를 어떤 순서로 읽는지 솔직하게 적어 봅니다.'),
      FIG('m:show-living', 'text', '저희 전시장의 작은 방. 이 벽에 걸릴 그림을 고르는 일입니다.'),
      H2('첫 장의 사진 석 장'),
      P('지원서를 열면 작품 사진 석 장을 먼저 봅니다. 여기서 ', { t: '사진의 질', b: true }, '이 생각보다 큰 차이를 만듭니다. 색이 틀어졌거나 비스듬한 사진은 좋은 그림도 덜 좋아 보이게 합니다.'),
      H2('작가노트는 짧게, 구체적으로'),
      P('작가노트는 세 문단이면 충분합니다. 무엇을, 왜, 어떻게 그리는지.'),
      QUOTE('‘나는 존재와 부재 사이를 탐구한다’보다 ‘나는 할머니 집의 장판 무늬를 그린다’가 훨씬 기억에 남습니다.'),
      H2('이력은 최근 것부터'),
      UL('전시 이력은 최근 순으로', '단체전이 많으면 대표적인 것만 다섯 개 정도', '수상·선정은 따로 묶어서'),
      CALLOUT('note', P('마감 하루 전에 지원서가 가장 많이 몰립니다. 사흘 전에 내시면 그만큼 천천히 읽힙니다.')),
    ],
    comments: [['kim', '작가노트 예시 문장 너무 와닿아요.'], ['han', '마감 사흘 전에 내기, 이번엔 꼭 지켜볼게요.']],
  },
  {
    key: 'do-size', tab: 'tips', author: 'do', title: '작품 크기 표기, 세로×가로로 통일하세요', daysAgo: 11.2, views: 88, likes: 3,
    doc: [
      P('지원서·캡션·도록을 보면 크기 표기가 제각각인 경우가 많다. 국내외 모두 관례는 ', { t: '세로 × 가로', b: true }, ' 순서다. 가로를 먼저 쓰면 심사하는 쪽에서는 그림이 눕혀진 줄 안다.'),
      CALLOUT('tip', P('예) 72.7 × 60.6 cm — 20호, 세로 그림'), P('입체 작품은 높이 × 너비 × 깊이')),
      P('한 번 정해 두면 홈페이지·포트폴리오·지원서에 같은 값을 그대로 쓰면 된다.'),
    ],
  },
  // ── 전시 후기 ──
  {
    key: 'seo-cloudy', tab: 'reviews', author: 'seo', title: '흐린 날 오후, 작은 전시장에서', daysAgo: 0.8, views: 403, likes: 6,
    doc: [
      P('회사 근처 골목에 작은 전시장이 생긴 지 한 달쯤 됐다. 점심시간마다 지나치다가 흐린 토요일 오후에 처음 들어가 봤다.'),
      FIG('m:show-salon', 'full', '들어서자마자 보이는 첫 벽.'),
      P('방은 둘뿐이다. 첫 방에는 붉은 톤의 큰 그림이 한 점, 그 맞은편 벽은 비워 두었다. 비운 벽 때문에 그림 한 점이 방 전체를 쓰는 느낌이었다.'),
      GAL(['m:show-cube', 'm:show-collector'], 'row', '두 번째 방. 조명이 그림마다 따로 떨어진다.'),
      P('두 번째 방은 작은 그림 여러 점. 조명이 그림마다 따로 떨어져서 그림 사이의 벽이 어둡게 남는다. 한 점씩 따로 보게 만드는 배치였다.'),
      VID('show-salon-walk', 960, 540, '첫 벽 앞으로 천천히 걸어 들어가며 찍었다.'),
      QUOTE('좋은 전시는 나올 때 걸음이 느려진다.', true),
      P('나와서 골목을 다시 걸을 때 벽돌 색이 조금 다르게 보였다. 다음 전시도 가 볼 생각이다.'),
    ],
    comments: [['oh', '저도 지난주에 다녀왔어요. 두 번째 방 조명 정말 좋았죠.'], ['seo', '맞아요, 그림마다 빛이 따로 떨어지는 게 인상적이었어요.', false, 0], ['choi', '영상 보니까 가 보고 싶어지네요. 어디예요?']],
  },
  {
    key: 'oh-small', tab: 'reviews', author: 'oh', title: '작은 전시장이 더 오래 남는 이유', daysAgo: 8.3, views: 176, likes: 4,
    doc: [
      FIG('m:show-boutique', 'wide'),
      P('큰 미술관 전시를 보고 나오면 몇 점이 기억에 남는지 세어 보곤 한다. 대개 두세 점이다. 작은 전시장에서는 반대로 거의 모든 그림이 남는다.'),
      H2('걸음이 그림 앞에서 멈춘다'),
      P('방이 작으면 동선이 짧고, 짧은 동선에서는 사람이 오래 머문다. 한 벽에 한 점만 거는 전시라면 더 그렇다.'),
      FIG('art:winter-garden', 'text', '이번 전시에서 가장 오래 본 그림.'),
      P('작가로서 배운 것도 있다. 내 그림이 걸릴 방의 크기를 먼저 생각하면 그림의 크기와 점수를 정하기가 훨씬 쉬워진다.'),
    ],
  },
  {
    key: 'seo-walls', tab: 'reviews', author: 'seo', title: '벽 색이 그림을 바꾼다 — 세 전시를 보고', daysAgo: 13.1, views: 121, likes: 3,
    doc: [
      P('이번 달에 본 전시 세 곳은 벽 색이 모두 달랐다. 짙은 회색, 붉은 벽돌, 올리브색. 같은 크기의 그림도 벽에 따라 전혀 다른 무게로 걸렸다.'),
      GAL(['m:wall-charcoal', 'm:wall-brick', 'm:wall-olive', 'm:wall-leaf'], 'slide', '같은 크기의 그림도 벽에 따라 다른 무게로 걸린다. 옆으로 넘겨 보세요.'),
      P('짙은 벽에서는 그림이 앞으로 나오고, 밝은 벽에서는 벽과 함께 숨을 쉰다. 벽돌 벽은 그림보다 벽이 먼저 보일 때가 있었다. 아트링크의 ArtLook 으로 내 방 벽에 미리 걸어 보는 것도 꽤 도움이 된다.'),
    ],
  },
  // ── 전시 준비 ──
  {
    key: 'gal-checklist', tab: 'prep', author: 'gal', title: '전시 2주 전 체크리스트', daysAgo: 5.1, views: 265, likes: 5,
    doc: [
      P('첫 전시를 앞둔 작가님들께 늘 드리는 목록입니다. 저희 갤러리 기준이지만 대부분의 전시장에서 비슷할 거예요.'),
      H2('2주 전'),
      UL('작품 목록과 캡션 확정 — 작품명, 연도, 재료, 크기(세로×가로)', '운송 일정과 포장 방법 정하기', '작품 보험 여부 확인'),
      H2('1주 전'),
      UL('홍보 이미지와 보도자료 전달', '설치 도면 — 벽마다 어떤 그림을 걸지', '오프닝 날짜·시간 공유'),
      H2('설치 당일'),
      UL('수평계, 줄자, 마스킹테이프, 연필', '그림 뒷면 고리 상태 점검', '캡션은 마지막에 — 그림 위치가 끝까지 바뀔 수 있어요'),
      CALLOUT('note', P('캡션의 크기 표기는 세로×가로로. 도록과 캡션이 다르면 관람객이 먼저 알아챕니다.')),
    ],
    comments: [['oh', '캡션 크기 표기 통일, 매번 설치 전날 고치게 되더라고요.'], ['lee', '운송 보험은 보통 어디서 드세요?', true], ['gal', '작품 운송 업체에서 같이 드는 경우가 많아요. 견적 받을 때 함께 물어보세요.']],
  },
  {
    key: 'oh-install', tab: 'prep', author: 'oh', title: '설치 전날 밤, 수평계와 마스킹테이프', daysAgo: 10.2, views: 41, likes: 2,
    doc: [
      P('설치는 늘 전날 밤에 끝난다. 아니, 끝나야 한다. 이번에는 처음으로 순서를 정해 놓고 해 봤다.'),
      OL('벽에 마스킹테이프로 그림 자리를 먼저 붙인다', '눈높이(바닥에서 그림 중심까지 145cm)를 기준선으로', '가장 큰 그림부터 걸고 나머지는 그 그림에 맞춘다', '수평계는 그림 윗변에, 마지막에 한 번 더'),
      FIG('m:wall-olive', 'text', '테이프 자리에 맞춰 건 첫 그림.'),
      P('이 순서대로 하니 밤 열한 시가 아니라 아홉 시에 끝났다. 남은 두 시간은 조명을 맞추는 데 썼다.'),
    ],
  },
  {
    key: 'han-statement', tab: 'prep', author: 'han', title: '첫 개인전, 작가노트를 세 번 고쳐 쓴 이야기', daysAgo: 18.2, views: 152, likes: 4,
    doc: [
      P('첫 개인전 작가노트를 세 번 고쳐 썼다. 처음 쓴 글은 지금 읽으면 무슨 말인지 나도 모르겠다.'),
      H2('첫 번째 — 멋있어 보이려고 쓴 글'),
      QUOTE('“나의 작업은 시간의 층위와 기억의 잔여를 탐구한다.”'),
      P('갤러리 대표님이 읽고 한 줄로 물으셨다. “그래서 뭘 그리세요?”'),
      H2('두 번째 — 그리는 것을 쓴 글'),
      P('물, 창, 빛. 그리는 대상을 적으니 글이 짧아졌다. 그런데 왜 그리는지가 빠졌다.'),
      H2('세 번째 — 왜 그리는지를 쓴 글'),
      QUOTE('비 오는 날 작업실 창에 맺힌 물방울이 마르는 걸 보다가, 마르기 전의 시간을 붙잡고 싶어졌다.', true),
      P('세 번째 글로 전시를 열었다. 오프닝에서 그 문장을 읽고 말을 걸어 주신 분이 여럿이었다.'),
    ],
  },
  // ── 질문 ──
  {
    key: 'kim-back', tab: 'qna', author: 'kim', title: '캔버스 뒷면에 작품 정보 적을 때 뭘로 쓰세요?', daysAgo: 1.2, views: 133, likes: 3,
    doc: [P('작품명, 연도, 서명을 캔버스 뒷면에 적으려는데 유성펜은 번질까 봐 걱정돼요. 다들 뭘로 쓰시나요?')],
    comments: [['do', '연필이요. 유성펜은 시간이 지나면 앞으로 번져 나와요.'], ['han', '저는 라벨지에 인쇄해서 붙여요. 서명만 손으로.'], ['lee', '연필 + 라벨지 둘 다 쓰는 것도 방법이겠네요.'], ['kim', '연필로 해 볼게요. 감사합니다!', false, 0]],
  },
  {
    key: 'anon-portfolio', tab: 'qna', author: 'jung', anonymous: true, title: '첫 공모 지원인데 포트폴리오에 몇 점 넣는 게 좋을까요?', daysAgo: 3.3, views: 164, likes: 4,
    doc: [P('그동안 그린 게 마흔 점쯤 되는데 다 넣어야 할지, 골라서 넣어야 할지 모르겠어요. 공고에는 점수 제한이 없어요.')],
    comments: [['gal', '공고에 정해진 수가 없다면 10~15점이 읽기 좋아요. 시리즈가 보이게 묶어 주세요.'], ['jung', '감사합니다! 시리즈별로 묶어 볼게요.', true, 0], ['kim', '저도 궁금했던 거예요.']],
  },
  {
    key: 'lee-noframe', tab: 'qna', author: 'lee', title: '액자 없이 캔버스만 걸어도 괜찮을까요?', daysAgo: 7.1, views: 64, likes: 2,
    doc: [P('다음 달 단체전에 이 그림을 내는데, 액자 없이 캔버스만 걸어도 괜찮을지 고민이에요.'), FIG('art:long-summer', 'text', '내려는 그림. 옆면까지 칠해 두었어요.')],
    comments: [['oh', '옆면까지 칠했으면 그대로 거셔도 예뻐요. 캔버스 옆면 정리만 신경 쓰세요.'], ['lee', '네, 그대로 걸어 볼게요!', false, 0]],
  },
  {
    key: 'choi-buy', tab: 'qna', author: 'choi', title: '그림 처음 사 보려는데, 어디서부터 보면 될까요?', daysAgo: 12.2, views: 58, likes: 3,
    doc: [P('집에 그림을 한 점 걸고 싶은데 어디서부터 봐야 할지 모르겠어요. 예산은 백만 원 안쪽이에요.')],
    comments: [['seo', '처음엔 작은 그림 한 점을 오래 보시는 걸 추천해요. 가격은 작가님께 직접 물어봐도 괜찮아요.'], ['gal', '갤러리에 오시면 언제든 물어보세요. 작품 보증서 받는 것도 잊지 마시고요.']],
  },
  // ── 자유 ──
  {
    key: 'jung-window', tab: 'free', author: 'jung', title: '오늘 작업실 창밖', daysAgo: 0.1, views: 97, likes: 5,
    doc: [P('창밖 보고 바로 그린 작은 그림이에요. 오늘은 이거 하나로 만족.'), FIG('art:winter-garden', 'text')],
    comments: [['han', '창밖 색이 그대로네요.'], ['choi', '작은 그림 너무 좋아요.']],
  },
  {
    key: 'anon-block', tab: 'free', author: 'lee', anonymous: true, title: '그림 안 그려지는 날 다들 뭐 하세요?', daysAgo: 2.3, views: 241, likes: 6,
    doc: [P('일주일째 붓을 못 들고 있어요. 이럴 때 다들 어떻게 하시나요?')],
    comments: [
      ['kim', '산책이요. 그냥 걷다 보면 하나쯤 떠올라요.', true],
      ['jung', '다른 작가님들 작업일지 읽어요 ㅎㅎ'],
      ['choi', '', true, undefined, true],
      ['han', '공감해요. 그럴 땐 그냥 쉬어도 괜찮더라고요.', false, 2],
      ['do', '칼 갈아요. 손이 바쁘면 머리가 쉬어서요.'],
      ['lee', '다들 감사해요. 오늘은 산책 가 봅니다.', true],
    ],
  },
  {
    key: 'choi-weekend', tab: 'free', author: 'choi', title: '주말에 본 전시 중에 제일 좋았던 것', daysAgo: 6.4, views: 37, likes: 1,
    doc: [P('토요일에 세 군데를 돌았는데, 제일 작은 곳이 제일 좋았어요. 다들 요즘 좋았던 전시 있으세요?')],
    comments: [['kim', '어떤 전시였는지 궁금해요!']],
  },
  // ── 투표 ──
  {
    key: 'gal-poll', tab: 'free', author: 'gal', title: '다음 단체전 주제, 같이 골라 주세요', daysAgo: 1.6, views: 268, likes: 5,
    doc: [
      P('저희 갤러리에서 내년 봄 단체전을 준비하고 있어요. 주제를 정하기 전에 작가님들 생각을 먼저 듣고 싶어서 투표를 올립니다.'),
      POLL('다음 단체전 주제는 무엇이 좋을까요?', ['도시의 밤', '물과 빛', '작은 방', '계절의 끝'], false, 6),
      P('고른 이유를 댓글로 남겨 주시면 공고를 쓸 때 참고할게요. 가장 많이 나온 주제로 2월에 공고를 올릴 예정이에요.'),
    ],
    votes: [['han', 1], ['do', 0], ['oh', 2], ['kim', 1], ['lee', 1], ['choi', 3], ['seo', 2], ['jung', 1]],
    comments: [['han', '물과 빛이요. 요즘 그리는 것과 딱 맞아서요 ㅎㅎ'], ['oh', '작은 방에 한 표. 설치 작업도 같이 낼 수 있으면 좋겠어요.'], ['gal', '설치도 받을 생각이에요!', false, 1]],
  },
  {
    key: 'kim-poll', tab: 'qna', author: 'kim', title: '작품 사진, 다들 뭘로 찍으세요?', daysAgo: 9.4, views: 141, likes: 2, pollClosed: true,
    doc: [
      P('포트폴리오 사진을 다시 찍으려고 해요. 다들 무엇으로 찍는지 궁금해서 투표 올려 봐요. 여러 개 고르셔도 돼요.'),
      POLL('작품 사진을 무엇으로 찍나요?', ['휴대폰', '미러리스·DSLR', '스캐너(작은 그림)', '사진가에게 맡긴다'], true, 3),
    ],
    votes: [['han', [0]], ['do', [1, 2]], ['oh', [1]], ['lee', [0]], ['choi', [0, 3]], ['seo', [1]], ['jung', [0]], ['gal', [3]]],
    comments: [['han', '휴대폰이요. 북쪽 창 앞에서 찍으면 충분하더라고요.'], ['kim', '오 그 글 봤어요! 따라 해 볼게요.', false, 0]],
  },
  // ── 공지 ──
  {
    key: 'ops-notice', tab: 'notice', author: 'ops', notice: true, title: '커뮤니티가 새로워졌어요 — 필진 칼럼을 시작합니다', daysAgo: 0.5, views: 210, likes: 4,
    doc: [
      P('아트링크 커뮤니티에 새 글쓰기와 필진 탭이 생겼어요.'),
      H2('무엇이 달라졌나요'),
      UL('글 중간에 사진을 원하는 자리에 넣을 수 있어요 — 크게·작게, 여러 장은 모아서', '동영상(25MB 까지)과 투표도 넣을 수 있어요', '쓰는 동안 자동으로 저장돼요. 휴대폰에서 쓰다가 컴퓨터에서 이어 써도 돼요', '인용구·강조 문장·팁 상자로 글에 리듬을 줄 수 있어요', '댓글에는 답글을 달 수 있어요'),
      H2('필진 칼럼'),
      P('작업일지 · 꿀팁 · 전시 후기 · 전시 준비 탭은 필진이 씁니다. 필진의 새 글은 이웃에게 알림으로 가요. 필진으로 참여하고 싶으시면 ', { t: '1:1 문의', href: '/support' }, '로 알려 주세요.'),
      CALLOUT('note', P('질문 · 자유 탭은 지금처럼 누구나, 익명으로도 쓸 수 있어요.')),
    ],
    comments: [['han', '필진 글 기대돼요.']],
  },
];

// 이웃(팔로우) — 필진이 새 글을 올리면 이 사람들에게 알림이 간다
const FOLLOWS: [string, string][] = [['choi', 'han'], ['seo', 'han'], ['kim', 'han'], ['kim', 'do'], ['jung', 'oh'], ['lee', 'gal'], ['choi', 'seo']];

// ── 도우미 ───────────────────────────────────────────────────────────────────
const DAY = 24 * 60 * 60 * 1000;
// 정해진 순서의 난수(mulberry32) — 다시 채워도 같은 좋아요·시각이 나온다
let seed = 7;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

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
  if (!name.includes(':')) {
    const v = path.join(MEDIA_DIR, `${name}.webm`);
    if (!fs.existsSync(v)) throw new Error(`동영상이 없습니다: ${path.relative(ROOT, v)} — 먼저 \`python3 scratchpad/community-editor/demo-video.py\` 를 돌려 주세요.`);
    return v;
  }
  const [kind, file] = name.split(':') as [string, string];
  const p = kind === 'art' ? path.join(ART_DIR, `${file}.jpg`) : path.join(MEDIA_DIR, `${file}.jpg`);
  if (!fs.existsSync(p)) {
    throw new Error(kind === 'm'
      ? `사진이 없습니다: ${path.relative(ROOT, p)} — 먼저 \`node scratchpad/community-editor/demo-media.mjs\` 를 돌려 주세요(vite 5173 필요).`
      : `데모 그림이 없습니다: ${path.relative(ROOT, p)}`);
  }
  return p;
}

interface Uploaded { url: string; width: number | null; height: number | null }
const uploads = new Map<string, Uploaded>();   // `${userId}|${name}`
async function upload(userId: number, token: string, name: string): Promise<Uploaded> {
  const k = `${userId}|${name}`;
  const hit = uploads.get(k);
  if (hit) return hit;
  const buf = fs.readFileSync(sourcePath(name));
  for (let attempt = 0; attempt < 4; attempt++) {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }), `${name.replace(':', '-')}.jpg`);
    const r = await fetch(`${API}/upload/post-image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (r.status === 429 || r.status === 503) { await new Promise((res) => setTimeout(res, 4000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`사진 올리기 실패(${name}) → ${r.status} ${(await r.text()).slice(0, 200)}`);
    const out = (await r.json()) as Uploaded;
    uploads.set(k, out);
    return out;
  }
  throw new Error(`사진 올리기 실패(${name}) — 요청 한도`);
}

/** 동영상 올리기(글쓰기 화면과 같은 길 — /upload/post-video) */
async function uploadVideo(token: string, name: string): Promise<string> {
  const buf = fs.readFileSync(sourcePath(name));
  for (let attempt = 0; attempt < 4; attempt++) {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array(buf)], { type: 'video/webm' }), `${name}.webm`);
    const r = await fetch(`${API}/upload/post-video`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (r.status === 429 || r.status === 503) { await new Promise((res) => setTimeout(res, 4000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`동영상 올리기 실패(${name}) → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return ((await r.json()) as { url: string }).url;
  }
  throw new Error(`동영상 올리기 실패(${name}) — 요청 한도`);
}

/** 사진 자리($fig/$gal)·동영상 자리($vid)를 올린 파일로 바꾼다 */
async function resolveDoc(nodes: Node[], userId: number, token: string): Promise<Node[]> {
  const out: Node[] = [];
  for (const n of nodes) {
    if (typeof n.$fig === 'string') {
      const u = await upload(userId, token, n.$fig);
      out.push({ type: 'figure', attrs: { src: u.url, width: u.width, height: u.height, alt: '', caption: n.caption ?? '', size: n.size ?? 'text' } });
    } else if (Array.isArray(n.$gal)) {
      const items = [];
      for (const name of n.$gal as string[]) {
        const u = await upload(userId, token, name);
        items.push({ src: u.url, width: u.width, height: u.height, alt: '' });
      }
      out.push({ type: 'gallery', attrs: { layout: n.layout ?? 'row', items, caption: n.caption ?? '', size: n.size ?? 'text' } });
    } else if (typeof n.$vid === 'string') {
      const url = await uploadVideo(token, n.$vid);
      out.push({ type: 'video', attrs: { src: url, width: n.width ?? null, height: n.height ?? null, caption: n.caption ?? '' } });
    } else {
      out.push(n);
    }
  }
  return out;
}

// ── 지우기 ───────────────────────────────────────────────────────────────────
async function clean() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const assets = await prisma.postAsset.findMany({ where: { userId: { in: ids } }, select: { url: true, userId: true } });
  const posts = await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.postDraft.deleteMany({ where: { authorId: { in: ids } } });
  let files = 0;
  for (const id of ids) files += await cleanupPostImages(assets.filter((a) => a.userId === id).map((a) => a.url), id);
  await prisma.portfolio.deleteMany({ where: { userId: { in: ids } } });   // 작품은 따라 지워진다(데모 그림 주소라 파일은 없다)
  const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });  // 댓글·좋아요·이웃·알림·필진은 따라 지워진다
  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  let tabs = 0;
  if (setting) {
    const tabIds = (JSON.parse(setting.value) as { tabIds?: number[] }).tabIds ?? [];
    tabs = (await prisma.postCategory.deleteMany({ where: { id: { in: tabIds } } })).count;
    await prisma.appSetting.delete({ where: { key: SETTING_KEY } });
  }
  console.log(`지움: 계정 ${del.count} · 글 ${posts.count} · 사진 파일 ${files} · 탭 ${tabs}`);
}

// ── 채우기 ───────────────────────────────────────────────────────────────────
async function fill(dbName: string) {
  if (await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } })) {
    console.log('이미 채워져 있습니다. 다시 채우려면 먼저 --clean 으로 지우세요.');
    return;
  }
  if (await prisma.user.count({ where: { email: { endsWith: DOMAIN } } })) {
    throw new Error('예전에 만든 데모 계정이 남아 있습니다. --clean 으로 지운 뒤 다시 돌려 주세요.');
  }
  for (const p of POSTS) for (const n of p.doc) {
    if (typeof n.$fig === 'string') sourcePath(n.$fig);
    if (Array.isArray(n.$gal)) (n.$gal as string[]).forEach(sourcePath);
    if (typeof n.$vid === 'string') sourcePath(n.$vid);
  }

  // 1) 탭 — 만든 것만 적어 둔다(지울 때 이것만)
  const tabIds: number[] = [];
  const tabByKey = new Map<string, number>();
  for (const t of NEW_TABS) {
    const exists = await prisma.postCategory.findFirst({ where: { OR: [{ name: t.name }, { slug: t.slug }] } });
    if (exists) { tabByKey.set(t.key, exists.id); continue; }
    const c = await prisma.postCategory.create({
      data: { name: t.name, slug: t.slug, order: t.order, writePolicy: t.writePolicy, writeAdminOnly: t.writePolicy === 'admin', layout: t.layout, allowAnonymous: t.allowAnonymous, description: t.description },
    });
    tabIds.push(c.id);
    tabByKey.set(t.key, c.id);
  }
  for (const t of FALLBACK_TABS) {
    const exists = await prisma.postCategory.findFirst({ where: { name: { contains: t.match } }, orderBy: { order: 'asc' } });
    if (exists) { tabByKey.set(t.key, exists.id); continue; }
    const c = await prisma.postCategory.create({
      data: { name: t.name, slug: t.slug, order: t.order, writePolicy: t.writePolicy, writeAdminOnly: t.writePolicy === 'admin', layout: t.layout, allowAnonymous: t.allowAnonymous, description: t.description || null },
    });
    tabIds.push(c.id);
    tabByKey.set(t.key, c.id);
  }
  await prisma.appSetting.create({ data: { key: SETTING_KEY, value: JSON.stringify({ tabIds, at: new Date().toISOString() }) } });

  // 2) 계정
  const users = new Map<string, { id: number; role: string }>();
  for (const p of PEOPLE) {
    const u = await prisma.user.create({ data: { email: emailOf(p.key), name: p.name, role: p.role, provider: 'LOCAL', handle: p.handle ?? null } });
    users.set(p.key, { id: u.id, role: u.role });
  }
  const U = (k: string) => users.get(k)!;
  const T = (k: string) => tokenFor(U(k));

  // 3) API 가 같은 DB 를 보는지 — 운영 토큰으로 탭 목록을 받아 방금 만든 탭이 보이는지
  const apiTabs = await call<{ id: number }[]>('GET', '/community/categories', T('ops')).catch((e: Error) => {
    throw new Error(`API(${API})에 닿지 않습니다 — 백엔드를 같은 DB 로 띄운 뒤 다시 돌려 주세요. (${e.message.slice(0, 120)})`);
  });
  const want = tabByKey.get('worklog')!;
  if (!apiTabs.some((t) => t.id === want)) {
    await clean();
    throw new Error(`API 가 다른 DB 를 보고 있습니다(방금 만든 탭이 안 보임). 백엔드를 ${dbName} 로 띄운 뒤 다시 돌려 주세요.`);
  }

  // 4) 필진의 홈페이지(작가 셋)
  for (const [k, pf] of Object.entries(PORTFOLIOS)) {
    const created = await prisma.portfolio.create({ data: { userId: U(k).id, tagline: pf.tagline, statement: pf.statement } });
    let order = 0;
    for (const w of pf.works) {
      const dims = await (await import('sharp')).default(path.join(ART_DIR, w.file)).metadata();
      await prisma.portfolioImage.create({
        data: { portfolioId: created.id, url: `/demo-art/${w.file}`, width: dims.width ?? null, height: dims.height ?? null, order: order++, title: w.title, year: w.year, medium: w.medium, sizeText: w.size },
      });
    }
  }

  // 5) 필진으로 넣기(실제 API — 그 사람에게 '필진이 되었어요' 알림이 간다) · 이웃
  for (const p of PEOPLE.filter((x) => x.writer)) await call('PUT', `/community/writers/${U(p.key).id}`, T('ops'));
  await prisma.follow.createMany({ data: FOLLOWS.map(([a, b]) => ({ followerId: U(a).id, followingId: U(b).id })), skipDuplicates: true });

  // 6) 글 — 오래된 것부터(번호가 시간 순서가 되게)
  const now = Date.now();
  const sorted = [...POSTS].sort((a, b) => b.daysAgo - a.daysAgo);
  const created: { spec: PostSpec; id: number; at: Date }[] = [];
  for (const spec of sorted) {
    const author = U(spec.author);
    const token = T(spec.author);
    const doc = { type: 'doc', content: await resolveDoc(spec.doc, author.id, token) };
    const tabId = tabByKey.get(spec.tab);
    if (!tabId) throw new Error(`탭이 없습니다: ${spec.tab}`);
    const res = await call<{ id: number }>('POST', '/community', token, {
      title: spec.title, doc, categoryId: tabId, anonymous: !!spec.anonymous,
      ...(spec.notice ? { notice: true, pinned: true } : {}),
    });
    const at = new Date(now - spec.daysAgo * DAY - Math.floor(rand() * 3) * 60 * 60 * 1000);
    created.push({ spec, id: res.id, at });
    process.stdout.write(`  · ${spec.title}\n`);
  }

  // 7) 날짜·조회수 · 댓글(답글 · 지운 자리) · 좋아요 · 투표
  const everyone = PEOPLE.map((p) => p.key);
  let polls = 0;
  for (const { spec, id, at } of created) {
    const comments = spec.comments ?? [];
    let t = at.getTime();
    const made: { id: number; parentId: number | null }[] = [];
    for (const [k, body, anon, to, deleted] of comments) {
      t += (20 + Math.floor(rand() * 240)) * 60 * 1000;
      const target = to != null ? made[to] : undefined;
      if (to != null && !target) throw new Error(`${spec.key}: ${to}번째 댓글이 없습니다(답글은 앞 댓글에만 단다)`);
      const c = await prisma.postComment.create({
        data: {
          postId: id, authorId: U(k).id, body: deleted ? '' : body, anonymous: !!anon, createdAt: new Date(Math.min(t, now - 60_000)),
          ...(target ? { parentId: target.parentId ?? target.id, replyToId: target.id } : {}),
          ...(deleted ? { deletedAt: new Date(Math.min(t + 30 * 60 * 1000, now - 60_000)) } : {}),
        },
      });
      made.push({ id: c.id, parentId: c.parentId });
    }
    if (spec.votes?.length) {
      polls++;
      const data = spec.votes.flatMap(([k, pick]) => (Array.isArray(pick) ? pick : [pick]).map((i) => ({ postId: id, userId: U(k).id, optionId: `opt${i + 1}x` })));
      await prisma.postPollVote.createMany({ data, skipDuplicates: true });
    }
    if (spec.pollClosed) {
      // 이미 마감한 투표 — 글이 올라간 뒤 마감 시각을 지난 날로(문서 속 정의와 Post.poll 둘 다)
      const row = await prisma.post.findUnique({ where: { id }, select: { doc: true, poll: true } });
      const ended = new Date(at.getTime() + 3 * DAY).toISOString();
      const doc2 = JSON.parse(JSON.stringify(row?.doc ?? null));
      for (const n of doc2?.content ?? []) if (n.type === 'poll') n.attrs.endsAt = ended;
      await prisma.post.update({ where: { id }, data: { doc: doc2, poll: { ...(row?.poll as object), endsAt: ended } } });
    }
    const likers = everyone.filter((k) => k !== spec.author).sort(() => rand() - 0.5).slice(0, spec.likes);
    await prisma.postLike.createMany({
      data: likers.map((k, i) => ({ postId: id, userId: U(k).id, createdAt: new Date(Math.min(at.getTime() + (i + 1) * 47 * 60 * 1000, now - 60_000)) })),
      skipDuplicates: true,
    });
    const likeCount = await prisma.postLike.count({ where: { postId: id } });
    await prisma.post.update({
      where: { id },
      data: { createdAt: at, updatedAt: at, viewCount: spec.views, likeCount, commentCount: comments.filter((c) => !c[4]).length, ...(spec.notice ? { pinnedAt: at } : {}) },
    });
  }

  // 8) 쓰던 글 하나 — 한지우로 들어가 [글쓰기]를 누르면 '쓰던 글'로 보인다
  const han = U('han');
  const hanTok = T('han');
  const draftDoc = {
    type: 'doc',
    content: await resolveDoc([
      P('지난 작업일지에서 말한 종이 비교. 300g 냉압지와 640g 황목에 같은 물의 양으로 첫 겹칠을 올려 봤다.'),
      FIG('art:dawn-window', 'text', '왼쪽 냉압지, 오른쪽 황목 — 사진은 내일 다시 찍을 것'),
      P('황목은 물을 오래 붙잡고 있어서 두 번째 겹칠까지 기다리는 시간이 거의 두 배였다. '),
    ], han.id, hanTok),
  };
  const draft = await call<{ id: number }>('POST', '/community/drafts', hanTok, { title: '종이를 바꿔 봤다 — 냉압지와 황목', doc: draftDoc, categoryId: tabByKey.get('worklog') });
  await prisma.postDraft.update({ where: { id: draft.id }, data: { updatedAt: new Date(now - 3 * 60 * 60 * 1000) } });

  console.log(`\n채움(${dbName}): 계정 ${PEOPLE.length} · 탭 새로 ${tabIds.length} · 글 ${created.length} · 사진 ${uploads.size}장 · 투표 ${polls} · 쓰던 글 1`);
  console.log('개발자 로그인에서 "community-demo" 로 찾으면 이 계정들이 나옵니다:');
  for (const p of PEOPLE) console.log(`  ${p.name.padEnd(10)} ${p.role.padEnd(8)} ${emailOf(p.key)}${p.writer ? '  (필진)' : ''}`);
}

async function main() {
  const db = assertLocal();
  if (process.argv.includes('--clean')) await clean();
  else await fill(db);
}

main()
  .catch((e) => { console.error('실패:', (e as Error).message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
