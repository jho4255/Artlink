/**
 * 비회원 둘러보기 — Admin [통계] 탭의 글자 만들기(2026-10-03). 서버 `GET /api/admin/stats/guests`, 규칙은 backend `lib/guestActivity.ts`.
 * 화면 이름·상세 이름(공모 제목·작가 이름)은 서버가 붙여 내려준다 — 여기서는 시간·순서를 사람이 읽는 글자로만 바꾼다.
 */

export interface GuestStep {
  label: string;
  detail: string | null;
  tab: string | null;
  work: boolean;
  seconds: number;
  repeat: number;
}
export interface GuestVisitRow {
  startedAt: string;
  seconds: number;
  views: number;
  outcome: 'LOGIN' | 'SIGNUP' | null;
  bounced: boolean;
  ongoing: boolean;
  steps: GuestStep[];
}
export interface GuestStats {
  since: string | null;
  /** 기간 안 방문이 너무 많아 최근 것만 셌다(서버 `GUEST_STATS_CAP`) */
  capped?: boolean;
  summary: { visits: number; bounced: number; medianSeconds: number; avgViews: number; login: number; signup: number };
  landings: { label: string; detail: string | null; visits: number; bounced: number; signups: number }[];
  pages: { label: string; visits: number; views: number; avgSeconds: number }[];
  exits: { label: string; count: number }[];
  recent: GuestVisitRow[];
}

/** 12초 · 1분 5초 · 3분 · 1시간 2분 */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}초`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}분 ${r}초` : `${m}분`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

/** 0~100 정수. 분모가 0 이면 0 */
export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** 화면 한 칸 — `작가 홈페이지 「김작가」 · 약력`, `… · 작품 크게 보기 ×3` (머문 시간은 따로 그린다) */
export function stepText(s: GuestStep): string {
  let t = s.label;
  if (s.detail) t += ` 「${s.detail}」`;
  if (s.tab) t += ` · ${s.tab}`;
  if (s.work) t += ' · 작품 크게 보기';
  if (s.repeat > 1) t += ` ×${s.repeat}`;
  return t;
}

/** 방문이 어떻게 끝났는가 — 경로 맨 끝에 붙는다 */
export function visitEnd(v: Pick<GuestVisitRow, 'outcome' | 'ongoing'>): string {
  // '로그인'만 쓰면 바로 앞 화면 이름(로그인)과 겹쳐 '로그인 3초 → 로그인'이 된다
  if (v.outcome === 'SIGNUP') return '가입 완료';
  if (v.outcome === 'LOGIN') return '로그인 완료';
  if (v.ongoing) return '아직 보는 중일 수 있음';
  return '나감';
}

/** 시작 시각 — 한국 시간 `10/3 14:02` */
export function visitTime(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hh}:${mm}`;
}
