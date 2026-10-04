import prisma from './prisma';
import { startOfTodayKstAsUtc } from './kstDate';
import { dayKey, kstDay } from './visitStats';

/**
 * 비회원 둘러보기 (2026-10-03, Admin [통계] 탭) — 로그인하지 않은 방문이 **무엇을 보고 얼마나 머물렀는지**.
 * 사용자 요청: 광고로 들어온 비회원의 가입이 적은 이유를 보려고. 들어온 경로(광고·검색·추천 주소)는 일부러 **남기지 않는다**(사용자 결정).
 *
 * ## 남기는 것 / 남기지 않는 것
 * - 방문 하나 = 화면이 **방문마다 새로** 만드는 무작위 id(탭 하나 — 탭이 열려 있는 한 같은 방문, 쉬는 시간으로 끊지 않는다. 2026-10-04 사용자 결정). 일간 방문자의 기기 번호(`DailyVisit.visitorId`)와
 *   **다른 값**이라 나중에 그 기기로 로그인해도 이 기록은 계정과 이어지지 않는다. 계정 번호·IP·기기 정보·입력 내용·검색어는 남기지 않는다.
 * - 화면 하나 = 경로(+ 허용한 `tab`·`work` 만) + 그 화면이 **보이는 동안** 머문 시간(상한 30분 — 창을 띄워 둔 채 자리를 비운 시간은 빼려고).
 *   ⚠️ 쿼리를 통째로 남기지 말 것 — 카카오 로그인 뒤 주소(`/auth/kakao/callback?code=…`)에 인증 코드가 실려 온다. 화면도 똑같이 거른다.
 * - 이 방문이 로그인·가입으로 이어졌으면 그 표시만(LOGIN · SIGNUP). 로그인한 뒤의 화면은 남기지 않는다.
 * - 90일 뒤 지운다(`pruneGuestActivity` — 스케줄러 없이 기록·통계 요청 때 프로세스당 한 시간에 한 번 훑는다).
 * 개인정보처리방침 1항(자동 생성 정보)에 적었다(`frontend/src/pages/PrivacyPage.tsx`).
 *
 * ⚠️ '확인하고 만들지' 말 것(CLAUDE.md 46) — 방문은 createMany skipDuplicates, 화면은 (visitId, seq) unique.
 *    화면은 같은 화면을 여러 번 보낸다(가려질 때마다 그때까지의 시간) — 그래서 머문 시간은 **더 큰 값으로만** 고친다(늦게 온 옛 값이 덮지 않게).
 */

export const GUEST_VISIT_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
/** 한 방문에서 받는 화면 수 상한 — 그 뒤는 버린다(봇·오작동이 표를 채우지 않게). 화면도 같은 값에서 멈춘다 */
export const GUEST_MAX_VIEWS = 300;
/**
 * 한 번에 받는 화면 수 상한 — 화면은 5초에 한 번까지만 보내므로 정상이면 한 번에 1~3개다(넘치면 화면이 10개씩 나눠 보낸다).
 * ⚠️ 키우지 말 것: 이 라우트는 로그인 없이 쓴다. 요청 하나가 만드는 줄 수(1 + 이 값) × IP 당 한도(`index.ts`)가 곧 한 IP 가 DB 에 쌓을 수 있는 양이다.
 */
export const GUEST_MAX_BATCH = 10;
/** 통계가 한 번에 메모리에 올리는 방문 수 — 나눠 읽는 단위(`guestStats` 의 ⚠️ 참고) */
export const GUEST_STATS_BATCH = 2_000;
/**
 * 통계가 세는 방문 수 상한 — 넘으면 최근 것부터 이만큼만 센다(`capped`, 화면이 밝힌다). 메모리는 묶음 단위라 이건 **시간** 상한이다.
 * 실측(로컬): 2만 방문 1.1초 · 10만 방문 6초. 운영 서버는 CPU 가 0.5 라 그보다 느리므로 5만에서 끊는다(90일 기준 하루 약 550 방문까지 전부 센다).
 */
export const GUEST_STATS_CAP = 50_000;
/** 같은 기간 통계를 이 시간 안에 다시 부르면 저장해 둔 답을 준다 — 기간을 바꿔 보거나 새로고침할 때마다 다시 세지 않게 */
export const GUEST_STATS_CACHE_MS = 60_000;
const statsCache = new Map<number, { at: number; value: GuestStats }>();
/** 테스트용 — 기록을 바꾼 뒤 바로 다시 셀 때 */
export function clearGuestStatsCache() { statsCache.clear(); }
/** `GUEST_ACTIVITY=off` 면 기록하지 않는다(받기만 하고 204) — 부하·저장 공간이 문제가 되면 배포 없이 끈다. 통계 화면은 그대로 열린다 */
export const guestActivityEnabled = () => process.env.GUEST_ACTIVITY !== 'off';
/** 한 화면에 머문 시간 상한 */
export const GUEST_VIEW_MAX_MS = 30 * 60 * 1000;
export const GUEST_KEEP_DAYS = 90;
/** '바로 나감' — 화면 하나만 보고 이 시간 안에 나갔고 로그인·가입으로 이어지지 않은 방문(사용자와 정한 기본값 30초) */
export const BOUNCE_MS = 30_000;
/**
 * 마지막 기록 뒤 이만큼 안 지났으면 '아직 보는 중일 수 있다'고 표시만 한다. 방문을 끊는 기준이 **아니다** — 그 탭에서 나중에 이어지면
 * 같은 방문에 붙고 표시도 다시 바뀐다(방문은 탭이 열려 있는 한 하나, 화면 `frontend/src/lib/guestActivity.ts`).
 */
export const GUEST_ONGOING_MS = 30 * 60 * 1000;
export const GUEST_STATS_MAX_DAYS = GUEST_KEEP_DAYS;
export const GUEST_OUTCOMES = ['LOGIN', 'SIGNUP'] as const;
export type GuestOutcome = (typeof GUEST_OUTCOMES)[number];

/** 남겨 두는 쿼리 — 어떤 탭·작품을 열었는지. 값은 짧은 영숫자만 */
const KEEP_QUERY = ['tab', 'work'] as const;

/**
 * 화면이 보낸 경로를 남길 모양으로. 우리 화면 경로(`/…`)만, 쿼리는 `tab`·`work` 만, 해시는 버린다. 아니면 null.
 * ⚠️ 화면 쪽 `frontend/src/lib/guestActivity.ts guestPath` 와 같은 규칙이다(화면이 먼저 거르고 서버가 한 번 더).
 */
export function normalizeGuestPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || s.length > 1000) return null;
  let url: URL;
  try { url = new URL(s, 'http://local'); } catch { return null; }
  if (url.host !== 'local') return null;
  const path = url.pathname.replace(/\/{2,}/g, '/');
  // eslint-disable-next-line no-control-regex
  if (path.length > 200 || /[\u0000-\u001f]/.test(path)) return null;
  const keep = new URLSearchParams();
  for (const k of KEEP_QUERY) {
    const v = url.searchParams.get(k);
    if (v && /^[A-Za-z0-9_-]{1,40}$/.test(v)) keep.set(k, v);
  }
  const q = keep.toString();
  return q ? `${path}?${q}` : path;
}

export interface GuestViewInput { seq: number; path: string; ms: number }

/** 화면이 보낸 화면 목록 → 받을 것만(순번 범위 · 경로 정리 · 시간 상한), 한 번에 `GUEST_MAX_BATCH` 개까지 */
export function cleanGuestViews(raw: unknown): GuestViewInput[] {
  if (!Array.isArray(raw)) return [];
  const out: GuestViewInput[] = [];
  for (const v of raw.slice(0, GUEST_MAX_BATCH)) {
    if (!v || typeof v !== 'object') continue;
    const { seq, path, ms } = v as Record<string, unknown>;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq >= GUEST_MAX_VIEWS) continue;
    const p = normalizeGuestPath(path);
    if (!p) continue;
    const dur = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.min(GUEST_VIEW_MAX_MS, Math.round(ms))) : 0;
    out.push({ seq, path: p, ms: dur });
  }
  return out;
}

export interface GuestRecordInput {
  views: GuestViewInput[];
  outcome?: GuestOutcome | null;
  /** 창을 닫거나 다른 사이트로 떠났다(pagehide) — 앱 전환(가려짐)과 달리 그 방문이 끝났다는 뜻 */
  left?: boolean;
}

/**
 * 기록 — 방문을 (없으면) 만들고, 화면을 넣거나 더 긴 시간으로 고치고, 결과·떠남 표시를 남긴다.
 * 떠났다던 방문에 **새 화면**이 들어오면 떠남 표시를 지운다(새로고침·카카오 로그인에서 돌아옴 — 같은 방문이 이어진다).
 * ⚠️ '새 화면'으로 판정할 것 — 이미 받은 화면의 시간만 고친 요청(늦게 도착한 가려짐 신호)이 떠남을 지우면 안 된다.
 */
export async function recordGuestActivity(visitId: string, input: GuestRecordInput, now: Date = new Date()): Promise<void> {
  const { views, outcome = null, left = false } = input;
  await prisma.guestVisit.createMany({ data: [{ id: visitId, startedAt: now, lastSeenAt: now }], skipDuplicates: true });
  let inserted = 0;
  if (views.length) {
    inserted = (await prisma.guestPageView.createMany({
      data: views.map((v) => ({ visitId, seq: v.seq, path: v.path, durationMs: v.ms })),
      skipDuplicates: true,
    })).count;
    // 이미 있던 화면이면 머문 시간만 늘린다(줄이지 않는다). 경로는 처음 받은 값 그대로 — 순번이 같은데 경로가 다르면 늦게 온 쪽이 틀린 것이다
    for (const v of views) {
      await prisma.guestPageView.updateMany({ where: { visitId, seq: v.seq, durationMs: { lt: v.ms } }, data: { durationMs: v.ms } });
    }
  }
  await prisma.guestVisit.update({
    where: { id: visitId },
    data: { lastSeenAt: now, ...(left ? { leftAt: now } : inserted > 0 ? { leftAt: null } : {}) },
  });
  if (outcome === 'SIGNUP') {
    await prisma.guestVisit.update({ where: { id: visitId }, data: { outcome: 'SIGNUP' } });
  } else if (outcome === 'LOGIN') {
    // 가입 표시를 로그인으로 낮추지 않는다
    await prisma.guestVisit.updateMany({ where: { id: visitId, outcome: null }, data: { outcome: 'LOGIN' } });
  }
  void pruneGuestActivity(now);
}

let lastPrunedAt = 0;
/** 90일 지난 방문을 지운다(화면은 cascade). 스케줄러 없이 — 프로세스당 한 시간에 한 번만 실제로 돈다 */
export async function pruneGuestActivity(now: Date = new Date(), force = false): Promise<number> {
  if (!force && now.getTime() - lastPrunedAt < 60 * 60 * 1000) return 0;
  lastPrunedAt = now.getTime();
  try {
    const cutoff = new Date(now.getTime() - GUEST_KEEP_DAYS * 86400000);
    const r = await prisma.guestVisit.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
    return r.count;
  } catch { return 0; }
}

/* ─────────────────────────────────────────────────────────────
   통계 — 경로를 화면 이름으로 바꾸는 것까지 서버가 한다(화면은 그리기만)
   ───────────────────────────────────────────────────────────── */

type RefKind = 'exhibition' | 'show' | 'gallery' | 'portfolio' | 'handle' | 'post';
interface PageKind { label: string; ref?: { kind: RefKind; key: string } }

/** 홈페이지 탭 이름(작가 `homepageTabs` · 갤러리 `galleryTabs` 의 `?tab=` 값) */
const TAB_LABELS: Record<string, string> = {
  note: '작가노트', cv: '약력', file: '포트폴리오', guestbook: '방명록',
  calls: '모집 중', artists: '함께한 작가', history: '지난 전시', reviews: '리뷰',
};

/** `@주소` 는 작가일 수도 갤러리일 수도 있다 — 이름을 찾기 전의 자리 표시 */
const HANDLE_LABEL = '작가·갤러리 홈페이지';

/**
 * 경로 → 화면 이름. 상세 화면은 `ref` 로 무엇을 봤는지(공모 제목·작가 이름…)를 찾는다.
 * `/auth/register` 는 실제 주소가 아니다 — 카카오 로그인 뒤 **가입 정보 입력** 단계에 화면이 붙이는 이름(주소는 그대로라 구분이 안 된다).
 */
export function guestPageKind(path: string): PageKind {
  const p = path.split('?')[0].replace(/\/+$/, '') || '/';
  let r: RegExpMatchArray | null;
  if (p === '/') return { label: '홈' };
  if (p === '/exhibitions') return { label: '모집공고' };
  if ((r = p.match(/^\/exhibitions\/(\d+)\/apply$/))) return { label: '지원서', ref: { kind: 'exhibition', key: r[1] } };
  if ((r = p.match(/^\/exhibitions\/(\d+)$/))) return { label: '공모 상세', ref: { kind: 'exhibition', key: r[1] } };
  if (p === '/artists' || p === '/explore') return { label: '작가' };
  if ((r = p.match(/^\/portfolio\/(\d+)$/))) return { label: '작가 홈페이지', ref: { kind: 'portfolio', key: r[1] } };
  if ((r = p.match(/^\/@([A-Za-z0-9._]{1,40})$/))) return { label: HANDLE_LABEL, ref: { kind: 'handle', key: r[1].toLowerCase() } };
  if (p === '/galleries') return { label: '갤러리' };
  if ((r = p.match(/^\/galleries\/(\d+)$/))) return { label: '갤러리 홈페이지', ref: { kind: 'gallery', key: r[1] } };
  if (p === '/shows') return { label: '전시' };
  if ((r = p.match(/^\/shows\/(\d+)$/))) return { label: '전시 상세', ref: { kind: 'show', key: r[1] } };
  if (p === '/community') return { label: '커뮤니티' };
  if ((r = p.match(/^\/community\/(\d+)$/))) return { label: '커뮤니티 글', ref: { kind: 'post', key: r[1] } };
  if (p === '/login') return { label: '로그인' };
  if (p === '/auth/kakao/callback') return { label: '카카오 로그인' };
  if (p === '/auth/register') return { label: '가입 정보 입력' };
  if (p === '/support') return { label: '고객센터' };
  if (p === '/terms' || p === '/privacy') return { label: '약관·개인정보' };
  if (/^\/join\/[^/]+$/.test(p)) return { label: '초대 코드' };
  return { label: '기타' };
}

/** 상세 화면 이름 찾기 — 기간 안에 나온 대상을 한 번에(대상 종류마다 쿼리 하나) */
async function resolveRefs(paths: string[]) {
  const sets: Record<RefKind, Set<string>> = { exhibition: new Set(), show: new Set(), gallery: new Set(), portfolio: new Set(), handle: new Set(), post: new Set() };
  for (const path of paths) {
    const ref = guestPageKind(path).ref;
    if (ref) sets[ref.kind].add(ref.key);
  }
  const ids = (s: Set<string>) => [...s].map(Number).filter((x) => Number.isSafeInteger(x) && x > 0 && x < 2 ** 31).slice(0, 1000);
  const handles = [...sets.handle].slice(0, 1000);
  const [exs, shows, galleries, users, handleUsers, handleGalleries, posts] = await Promise.all([
    prisma.exhibition.findMany({ where: { id: { in: ids(sets.exhibition) } }, select: { id: true, title: true } }),
    prisma.show.findMany({ where: { id: { in: ids(sets.show) } }, select: { id: true, title: true } }),
    prisma.gallery.findMany({ where: { id: { in: ids(sets.gallery) } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: ids(sets.portfolio) } }, select: { id: true, name: true, nickname: true } }),
    prisma.user.findMany({ where: { handle: { in: handles } }, select: { handle: true, name: true, nickname: true } }),
    prisma.gallery.findMany({ where: { handle: { in: handles } }, select: { handle: true, name: true } }),
    // 익명 글이 있을 수 있어 글쓴이는 싣지 않는다 — 제목만
    prisma.post.findMany({ where: { id: { in: ids(sets.post) } }, select: { id: true, title: true } }),
  ]);
  const names: Record<RefKind, Map<string, string>> = {
    exhibition: new Map(exs.map((e) => [String(e.id), e.title])),
    show: new Map(shows.map((s) => [String(s.id), s.title])),
    gallery: new Map(galleries.map((g) => [String(g.id), g.name])),
    portfolio: new Map(users.map((u) => [String(u.id), u.nickname || u.name])),
    handle: new Map(),
    post: new Map(posts.map((p) => [String(p.id), p.title])),
  };
  // `@주소` 는 작가·갤러리가 한 이름공간을 나눠 쓴다(CLAUDE.md 49) — 어느 쪽인지 여기서 가른다
  const handleKind = new Map<string, '작가 홈페이지' | '갤러리 홈페이지'>();
  for (const u of handleUsers) if (u.handle) { names.handle.set(u.handle, u.nickname || u.name); handleKind.set(u.handle, '작가 홈페이지'); }
  for (const g of handleGalleries) if (g.handle && !handleKind.has(g.handle)) { names.handle.set(g.handle, g.name); handleKind.set(g.handle, '갤러리 홈페이지'); }
  return (path: string) => {
    const kind = guestPageKind(path);
    if (!kind.ref) return { label: kind.label, detail: null as string | null };
    const label = kind.ref.kind === 'handle' ? handleKind.get(kind.ref.key) ?? HANDLE_LABEL : kind.label;
    return { label, detail: names[kind.ref.kind].get(kind.ref.key) ?? null };
  };
}

export interface GuestStep {
  label: string;
  /** 무엇을 봤는지 — 공모 제목·작가 이름 등(못 찾으면 null — 지워졌거나 주소가 틀렸다) */
  detail: string | null;
  /** 홈페이지 탭 이름(작가노트·약력…) */
  tab: string | null;
  /** 작품을 크게 열어 봤는가(`?work=`) */
  work: boolean;
  seconds: number;
  /** 같은 화면을 이어서 몇 번 봤는가(작품을 넘겨 보면 주소가 바뀐다 — 한 줄로 합친다) */
  repeat: number;
}
export interface GuestVisitRow {
  startedAt: string;
  seconds: number;
  views: number;
  outcome: GuestOutcome | null;
  bounced: boolean;
  /** 떠났다는 신호가 없고 마지막 기록이 30분 안 — 아직 보고 있을 수 있다(그래서 '나감'이라 단정하지 않는다) */
  ongoing: boolean;
  steps: GuestStep[];
}
export interface GuestPageRow { label: string; visits: number; views: number; avgSeconds: number }
export interface GuestLandingRow { label: string; detail: string | null; visits: number; bounced: number; signups: number }
export interface GuestStats {
  /** 기록을 시작한 날(KST) — 그 전은 '방문 없음'이 아니라 '세지 않음' */
  since: string | null;
  /** 기간 안 방문이 `GUEST_STATS_CAP` 을 넘어 최근 것만 셌다 */
  capped: boolean;
  summary: { visits: number; bounced: number; medianSeconds: number; avgViews: number; login: number; signup: number };
  /** 처음 본 화면(들어온 화면) — 광고가 보낸 곳. 들어온 경로(광고·검색)는 남기지 않는다 */
  landings: GuestLandingRow[];
  /** 많이 본 화면 — 그 화면을 본 방문 수 기준 */
  pages: GuestPageRow[];
  /** 둘러보다 나간 곳 — 바로 나간 방문·가입/로그인한 방문을 뺀 방문의 마지막 화면 */
  exits: { label: string; count: number }[];
  recent: GuestVisitRow[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const isBounce = (views: { durationMs: number }[], outcome: string | null) =>
  views.length === 1 && views[0].durationMs < BOUNCE_MS && !outcome;

/**
 * 바로 이어진 **같은 주소**는 한 화면으로 친다(머문 시간은 더한다) — 새로고침은 화면을 하나 더 본 게 아니다.
 * ⚠️ 이걸 거치지 않고 세면 '바로 나감'이 빠진다(2026-10-04 실측). 첫 방문자의 페이지는 서비스워커가 설치되며 7초쯤에 한 번
 * 다시 불러와졌고(그 새로고침은 `main.tsx` 에서 막았다), 사용자가 직접 당겨서 새로고침해도 같다 — 같은 화면이 두 줄이 되어
 * 화면 하나·30초 미만인 방문이 '화면 둘'로 세어졌다. 주소가 다르면 합치지 않는다(작품을 넘겨 본 `?work=` 셋은 셋이다).
 */
export function mergeRepeatedViews<T extends { path: string; durationMs: number }>(views: T[]): T[] {
  const out: T[] = [];
  for (const pv of views) {
    const prev = out[out.length - 1];
    if (prev && prev.path === pv.path) out[out.length - 1] = { ...prev, durationMs: prev.durationMs + pv.durationMs };
    else out.push(pv);
  }
  return out;
}

/**
 * 최근 `days` 일(오늘 포함, KST) 비회원 방문 집계 + 최근 방문 경로.
 * '바로 나감' = 화면 하나 · `BOUNCE_MS` 미만 · 로그인/가입 없음. 화면 수는 이어진 같은 주소를 하나로 친 뒤에 센다(`mergeRepeatedViews`).
 *
 * ⚠️⚠️ **방문을 한 번에 다 올리지 말 것 — `GUEST_STATS_BATCH` 개씩 나눠 읽는다.** 처음엔 기간 안 방문을 화면째로(`include views`) 한 번에
 * 읽었는데, 2만 방문(화면 12만 줄)에서 요청 하나가 서버 메모리를 **약 450MB** 더 썼다(실측 228 → 673MB, 운영 서버는 512MB) —
 * 관리자가 통계 탭을 여는 순간 서버가 죽을 수 있었다. 나눠 읽으면 메모리가 표 크기와 무관하다(묶음 하나 분량만 든다).
 * 이름 찾기는 기간 안의 **서로 다른 주소**만 모아 한 번에(사이트 내용 수만큼으로 묶인다).
 */
export async function guestStats(days: number, now: Date = new Date(), recentLimit = 40): Promise<GuestStats> {
  const n = Math.min(GUEST_STATS_MAX_DAYS, Math.max(1, Math.floor(days)));
  const hit = statsCache.get(n);
  if (hit && now.getTime() - hit.at < GUEST_STATS_CACHE_MS && now.getTime() >= hit.at) return hit.value;
  const value = await computeGuestStats(n, now, recentLimit);
  statsCache.set(n, { at: now.getTime(), value });
  return value;
}

async function computeGuestStats(n: number, now: Date, recentLimit: number): Promise<GuestStats> {
  void pruneGuestActivity(now);
  const from = new Date(startOfTodayKstAsUtc(now).getTime() - (n - 1) * 86400000);

  // 서로 다른 주소 — DB 가 묶는다(GROUP BY). 화면 줄을 다 끌어오지 않는다
  const distinct = await prisma.guestPageView.groupBy({ by: ['path'], where: { visit: { startedAt: { gte: from } } } });
  const resolve = await resolveRefs(distinct.map((d) => d.path));

  const stepsOf = (views: { path: string; durationMs: number }[]): GuestStep[] => {
    const out: GuestStep[] = [];
    for (const pv of views) {
      const { label, detail } = resolve(pv.path);
      const q = new URLSearchParams(pv.path.split('?')[1] ?? '');
      const tabKey = q.get('tab');
      const step: GuestStep = { label, detail, tab: tabKey ? TAB_LABELS[tabKey] ?? null : null, work: q.has('work'), seconds: 0, repeat: 1 };
      const prev = out[out.length - 1];
      if (prev && prev.label === step.label && prev.detail === step.detail && prev.tab === step.tab && prev.work === step.work) {
        prev.repeat++; prev.seconds += pv.durationMs;
      } else {
        step.seconds = pv.durationMs;
        out.push(step);
      }
    }
    // 합치는 동안 밀리초로 더했다 — 마지막에 한 번만 초로(줄마다 반올림하면 합이 어긋난다)
    return out.map((s) => ({ ...s, seconds: Math.round(s.seconds / 1000) }));
  };

  const pageAgg = new Map<string, { visits: number; views: number; ms: number }>();
  const landAgg = new Map<string, GuestLandingRow>();
  const exitAgg = new Map<string, number>();
  const totals: number[] = [];
  const recent: GuestVisitRow[] = [];
  let counted = 0; let bounced = 0; let login = 0; let signup = 0; let viewSum = 0;
  let processed = 0; let capped = false;
  let cursor: { startedAt: Date; id: string } | null = null;

  for (;;) {
    // 최근 것부터(시작 시각 ↓, 같으면 id ↓) — 같은 시각에 시작한 방문도 건너뛰거나 두 번 읽지 않게 id 를 함께 커서로
    const batch: { id: string; startedAt: Date; lastSeenAt: Date; leftAt: Date | null; outcome: string | null }[] = await prisma.guestVisit.findMany({
      where: {
        startedAt: { gte: from },
        ...(cursor ? { OR: [{ startedAt: { lt: cursor.startedAt } }, { startedAt: cursor.startedAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: GUEST_STATS_BATCH,
      select: { id: true, startedAt: true, lastSeenAt: true, leftAt: true, outcome: true },
    });
    if (!batch.length) break;
    const rows = await prisma.guestPageView.findMany({
      where: { visitId: { in: batch.map((b) => b.id) } },
      orderBy: [{ visitId: 'asc' }, { seq: 'asc' }],
      select: { visitId: true, path: true, durationMs: true },
    });
    const byVisit = new Map<string, { path: string; durationMs: number }[]>();
    for (const r of rows) {
      const list = byVisit.get(r.visitId);
      if (list) list.push(r); else byVisit.set(r.visitId, [r]);
    }

    for (const v of batch) {
      const raw = byVisit.get(v.id);
      if (!raw?.length) continue;
      const views = mergeRepeatedViews(raw);
      counted++;
      const total = views.reduce((sum, pv) => sum + pv.durationMs, 0);
      totals.push(total);
      viewSum += views.length;
      if (v.outcome === 'SIGNUP') signup++;
      else if (v.outcome === 'LOGIN') login++;
      const b = isBounce(views, v.outcome);
      if (b) bounced++;

      const seen = new Set<string>();
      for (const pv of views) {
        const { label } = resolve(pv.path);
        const a = pageAgg.get(label) ?? { visits: 0, views: 0, ms: 0 };
        a.views++; a.ms += pv.durationMs;
        if (!seen.has(label)) { a.visits++; seen.add(label); }
        pageAgg.set(label, a);
      }
      const land = resolve(views[0].path);
      const key = `${land.label}\u0000${land.detail ?? ''}`;
      const l = landAgg.get(key) ?? { label: land.label, detail: land.detail, visits: 0, bounced: 0, signups: 0 };
      l.visits++; if (b) l.bounced++; if (v.outcome === 'SIGNUP') l.signups++;
      landAgg.set(key, l);
      if (!b && !v.outcome) {
        const last = resolve(views[views.length - 1].path).label;
        exitAgg.set(last, (exitAgg.get(last) ?? 0) + 1);
      }
      if (recent.length < recentLimit) {
        recent.push({
          startedAt: v.startedAt.toISOString(),
          seconds: Math.round(total / 1000),
          views: views.length,
          outcome: (v.outcome as GuestOutcome | null) ?? null,
          bounced: b,
          ongoing: !v.outcome && !v.leftAt && now.getTime() - v.lastSeenAt.getTime() < GUEST_ONGOING_MS,
          steps: stepsOf(views),
        });
      }
    }

    processed += batch.length;
    const tail = batch[batch.length - 1];
    cursor = { startedAt: tail.startedAt, id: tail.id };
    if (batch.length < GUEST_STATS_BATCH) break;
    if (processed >= GUEST_STATS_CAP) { capped = true; break; }
  }

  const first = await prisma.guestVisit.findFirst({ orderBy: { startedAt: 'asc' }, select: { startedAt: true } });
  return {
    since: first ? dayKey(kstDay(first.startedAt)) : null,
    capped,
    summary: {
      visits: counted,
      bounced,
      medianSeconds: Math.round(median(totals) / 1000),
      avgViews: counted ? Math.round((viewSum / counted) * 10) / 10 : 0,
      login,
      signup,
    },
    landings: [...landAgg.values()].sort((x, y) => y.visits - x.visits || y.signups - x.signups).slice(0, 10),
    pages: [...pageAgg.entries()]
      .map(([label, a]) => ({ label, visits: a.visits, views: a.views, avgSeconds: Math.round(a.ms / a.views / 1000) }))
      .sort((x, y) => y.visits - x.visits || y.views - x.views)
      .slice(0, 12),
    exits: [...exitAgg.entries()].map(([label, count]) => ({ label, count })).sort((x, y) => y.count - x.count).slice(0, 8),
    recent,
  };
}
