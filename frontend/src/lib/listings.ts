/**
 * 모집공고 찾기 · 모집공고 상세 · 갤러리 찾기가 같이 쓰는 판단(2026-11-15 개편).
 *
 *  · 마감 표시(`deadlineView`) — 목록 카드 · 상세 머리 · 따라오는 [지원하기] 줄 · 갤러리 카드가 **같은 말**을 한다
 *  · 마감 묶음(`groupByDeadline`) — '마감 임박'(7일 안) → 'N월 마감'. 목록이 마감 순일 때만 쓴다
 *  · 있는 값만 거르기(`presentRegions`·`presentTypes`) — 공고가 하나도 없는 지역을 늘어놓지 않는다(눌러도 빈 화면이었다)
 *  · 짧은 주소(`addressArea`) — 갤러리 카드에 '서울 종로구' 처럼 동네까지만
 *
 * 날짜는 전부 **KST 달력 날짜**로 가른다(CLAUDE.md 규칙 14) — 마감일 당일은 종일 '오늘 마감'이다.
 */
import { REGION_CODES, regionLabels } from './utils';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 강조색(빨강)으로 보일 남은 날 — 7일 안(DESIGN.md: D-day ≤ 7 만 빨강). '마감 임박' 묶음도 같은 경계 */
export const HOT_DAYS = 7;

function kstParts(d: string | Date) {
  const k = new Date(new Date(d).getTime() + KST_OFFSET_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, day: k.getUTCDate(), wd: k.getUTCDay() };
}
function kstDayNumber(d: string | Date): number {
  const { y, m, day } = kstParts(d);
  return Math.floor(Date.UTC(y, m - 1, day) / DAY_MS);
}
/** 오늘(KST)부터 그날까지 남은 날 — 당일 0, 지났으면 음수 */
export function daysUntil(d: string | Date, now: Date = new Date()): number {
  return kstDayNumber(d) - kstDayNumber(now);
}

/** `11.24(화)` — KST 달력 날짜 */
export function shortDate(d: string | Date): string {
  const { m, day, wd } = kstParts(d);
  return `${m}.${day}(${WEEKDAYS[wd]})`;
}

export interface DeadlineLike {
  deadline: string;
  deadlineStart?: string | null;
  recruitmentClosed?: boolean;
  ended?: boolean;
}

export interface DeadlineView {
  state: 'open' | 'upcoming' | 'closed';
  /** 굵게 쓰는 앞 글자 — `D-9` · `오늘 마감` · `모집 예정` · `마감` · `조기 마감` */
  badge: string;
  /** 빨강으로 쓸까(7일 안 마감) */
  hot: boolean;
  /** 뒤에 붙는 날짜 — `11.24(화)까지` · `11.20(금)부터` · `11.12(목)`(마감) · 조기 마감이면 빈 글자 */
  date: string;
  /** 남은 날(모집 중일 때만 의미) */
  days: number;
}

/**
 * 공고 하나의 마감 표시. **마감 판정은 마감일만이 아니다** — 갤러리가 수동으로 모집을 닫았거나 전시를 끝냈으면
 * 마감일이 남아 있어도 마감이다(그걸 안 보면 마감된 공고에 D-9 가 뜬다). `closedScope` 는 [마감] 탭에서 온 것.
 */
export function deadlineView(ex: DeadlineLike, opts: { closedScope?: boolean; now?: Date } = {}): DeadlineView {
  const now = opts.now ?? new Date();
  const days = daysUntil(ex.deadline, now);
  if (opts.closedScope || days < 0 || ex.recruitmentClosed || ex.ended) {
    // 마감일이 지났으면 '마감 11.12(목)', 마감일 전에 닫았으면 '조기 마감'(날짜를 붙이면 아직 남은 마감일로 읽힌다)
    return days < 0
      ? { state: 'closed', badge: '마감', hot: false, date: shortDate(ex.deadline), days }
      : { state: 'closed', badge: '조기 마감', hot: false, date: '', days };
  }
  if (ex.deadlineStart && daysUntil(ex.deadlineStart, now) > 0) {
    return { state: 'upcoming', badge: '모집 예정', hot: false, date: `${shortDate(ex.deadlineStart)}부터`, days };
  }
  return { state: 'open', badge: days === 0 ? '오늘 마감' : `D-${days}`, hot: days <= HOT_DAYS, date: `${shortDate(ex.deadline)}까지`, days };
}

/**
 * 지금 모집 중인가 — 서버 `backend/src/lib/openCalls.ts openCallWhere` 와 같은 규칙(2026-11-15).
 * 모집공고 [모집 중] · 갤러리 목록 카드의 '모집 중' · 갤러리 홈페이지 [모집 중] 탭이 같은 답을 내야 한다.
 * 시작 전(모집 예정)은 아니다 — 모집공고 목록에도 시작일 전에는 나오지 않는다.
 */
export function isOpenCall(ex: DeadlineLike, now: Date = new Date()): boolean {
  return deadlineView(ex, { now }).state === 'open';
}

export interface ListGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * 마감 순 묶음 — '마감 임박'(7일 안) → '11월 마감' → '12월 마감' → '2027년 1월 마감'(해가 바뀌면 연도를 붙인다).
 * 넣은 순서와 상관없이 마감일 → id 순으로 다시 세운다(묶음이 두 번 나오지 않게).
 */
export function groupByDeadline<T extends { id: number; deadline: string }>(items: T[], now: Date = new Date()): ListGroup<T>[] {
  const thisYear = kstParts(now).y;
  const sorted = [...items].sort((a, b) => (new Date(a.deadline).getTime() - new Date(b.deadline).getTime()) || a.id - b.id);
  const groups: ListGroup<T>[] = [];
  for (const it of sorted) {
    let key: string;
    let label: string;
    if (daysUntil(it.deadline, now) <= HOT_DAYS) {
      key = 'soon';
      label = '마감 임박';
    } else {
      const { y, m } = kstParts(it.deadline);
      key = `${y}-${m}`;
      label = y === thisYear ? `${m}월 마감` : `${y}년 ${m}월 마감`;
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, label, items: [it] });
  }
  return groups;
}

/** 최신 등록 순 — 같으면 id 큰 것 먼저 */
export function sortNewest<T extends { id: number; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()) || b.id - a.id);
}

/** 공모 유형 — 순서가 곧 화면 순서 */
export const EXHIBITION_TYPE_CODES = ['SOLO', 'GROUP', 'ART_FAIR'] as const;

/**
 * 거르기 줄에 띄울 지역 — 목록에 실제로 있는 지역만, `REGION_CODES` 순서로.
 * 고른 지역은 목록에 없어도 남긴다(주소로 들어온 `?region=JEJU` 를 풀 길이 없어진다).
 */
export function presentRegions(items: { region: string }[], selected?: string | null): string[] {
  const have = new Set(items.map((i) => i.region));
  if (selected) have.add(selected);
  return REGION_CODES.filter((r) => have.has(r));
}

/** 거르기 줄에 띄울 유형 — `presentRegions` 와 같은 규칙 */
export function presentTypes(items: { type: string }[], selected?: string | null): string[] {
  const have = new Set(items.map((i) => i.type));
  if (selected) have.add(selected);
  return EXHIBITION_TYPE_CODES.filter((t) => have.has(t));
}

/** 시·도 이름을 짧게 — 주소 첫 낱말이 이것들이면 그 지역으로 읽는다 */
const SIDO: [RegExp, string][] = [
  [/^서울(특별시|시)?$/, '서울'],
  [/^부산(광역시|시)?$/, '부산'],
  [/^대구(광역시|시)?$/, '대구'],
  [/^인천(광역시|시)?$/, '인천'],
  [/^광주(광역시)?$/, '광주'],
  [/^대전(광역시|시)?$/, '대전'],
  [/^울산(광역시|시)?$/, '울산'],
  [/^세종(특별자치시|시)?$/, '세종'],
  [/^경기(도)?$/, '경기'],
  [/^강원(특별자치도|도)?$/, '강원'],
  [/^(충청북도|충북)$/, '충북'],
  [/^(충청남도|충남)$/, '충남'],
  [/^(전라북도|전북특별자치도|전북)$/, '전북'],
  [/^(전라남도|전남)$/, '전남'],
  [/^(경상북도|경북)$/, '경북'],
  [/^(경상남도|경남)$/, '경남'],
  [/^제주(특별자치도|도)?$/, '제주'],
];

/**
 * 갤러리 카드의 짧은 주소 — `서울특별시 영등포구 경인로 704, 1층` → `서울 영등포구`. 주소 칸은 자유 글이라
 * 시·도로 시작하지 않으면(`H 아트브릿지` 같은 것) 등록할 때 고른 지역 이름으로 대신한다.
 */
export function addressArea(address: string | null | undefined, region: string): string {
  const fallback = regionLabels[region] ?? '';
  const words = (address ?? '').trim().split(/\s+/).map((w) => w.replace(/[,·]+$/, '')).filter(Boolean);
  if (words.length === 0) return fallback;
  const [first, second] = words;
  const isDistrict = (w?: string) => !!w && /^[가-힣]{1,6}(시|군|구)$/.test(w);
  const sido = SIDO.find(([re]) => re.test(first))?.[1];
  if (sido) return isDistrict(second) ? `${sido} ${second}` : sido;
  // 시·도를 빼고 적은 주소(`수원시 팔달구 …`)
  if (/^[가-힣]{2,6}(시|군)$/.test(first)) return /^[가-힣]{1,6}구$/.test(second ?? '') ? `${first} ${second}` : first;
  return fallback;
}

export interface ScheduleStep {
  /** 공모: start·deadline·submission·exhibit · 전시: show-start·show-end */
  key: 'start' | 'deadline' | 'submission' | 'exhibit' | 'show-start' | 'show-end';
  label: string;
  /** `11.24(화)` · `12.1(화)까지` · `12.12(토) – 12.27(일)` */
  date: string;
  /** 지난 단계 · 다음 단계(하나) · 그 뒤 */
  state: 'past' | 'next' | 'future';
  /** 다음 단계에 붙는 말 — `9일 남음` · `오늘 마감` · `3일 뒤 시작` · `진행 중` · 지난 단계면 `조기 마감` */
  note?: string;
  /** 7일 안 마감 — 강조색 */
  hot?: boolean;
}

export interface ScheduleLike extends DeadlineLike {
  submissionDeadline?: string | null;
  recruitOnly?: boolean;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
}

/**
 * 공모 상세의 일정 띠 — 접수 시작 → 접수 마감 → 출품 자료 제출 → 전시. 값이 없는 단계는 그리지 않는다(없는 기한을 지어내지 않는다).
 * '다음 단계'는 하나뿐이다 — 아직 끝나지 않은 첫 단계. 갤러리가 모집을 일찍 닫았으면(수동 마감·전시 종료) 접수 단계는 지난 것으로 친다.
 * ⚠️ `exhibitDate` 가 전시 **종료일**이다(시작은 `exhibitStartDate`) — 이름이 헷갈린다(schema 주석).
 * 공모만 진행하는 공고는 출품 자료·전시 단계가 없다(서버도 그 날짜를 받지 않는다).
 */
export function scheduleSteps(ex: ScheduleLike, now: Date = new Date()): ScheduleStep[] {
  const closedEarly = !!(ex.recruitmentClosed || ex.ended);
  type Raw = { key: ScheduleStep['key']; label: string; date: string; end: string; start?: string | null };
  const raw: Raw[] = [];
  if (ex.deadlineStart) raw.push({ key: 'start', label: '접수 시작', date: shortDate(ex.deadlineStart), end: ex.deadlineStart });
  raw.push({ key: 'deadline', label: '접수 마감', date: shortDate(ex.deadline), end: ex.deadline });
  if (!ex.recruitOnly && ex.submissionDeadline) {
    raw.push({ key: 'submission', label: '출품 자료 제출', date: `${shortDate(ex.submissionDeadline)}까지`, end: ex.submissionDeadline });
  }
  if (!ex.recruitOnly && ex.exhibitDate) {
    raw.push({
      key: 'exhibit', label: '전시',
      date: ex.exhibitStartDate ? `${shortDate(ex.exhibitStartDate)} – ${shortDate(ex.exhibitDate)}` : `${shortDate(ex.exhibitDate)}까지`,
      end: ex.exhibitDate, start: ex.exhibitStartDate,
    });
  }

  let nextFound = false;
  return raw.map((r): ScheduleStep => {
    // 접수 시작은 그날 0시에 끝난 것으로 본다(당일부터 받는다) — 나머지는 그날이 지나야 끝난다
    const left = daysUntil(r.end, now);
    let done = r.key === 'start' ? left <= 0 : left < 0;
    if (closedEarly && (r.key === 'start' || r.key === 'deadline')) done = true;
    if (ex.ended) done = true;
    if (done) {
      const early = closedEarly && r.key === 'deadline' && left >= 0 && !ex.ended;
      return { key: r.key, label: r.label, date: r.date, state: 'past', note: early ? '조기 마감' : undefined };
    }
    if (nextFound) return { key: r.key, label: r.label, date: r.date, state: 'future' };
    nextFound = true;
    let note: string;
    let hot = false;
    if (r.key === 'start') note = `${left}일 뒤`;
    else if (r.key === 'deadline') { note = left === 0 ? '오늘 마감' : `${left}일 남음`; hot = left <= HOT_DAYS; }
    else if (r.key === 'submission') note = left === 0 ? '오늘까지' : `${left}일 남음`;
    else {
      const toStart = r.start ? daysUntil(r.start, now) : 0;
      note = toStart > 0 ? `${toStart}일 뒤 시작` : '진행 중';
    }
    return { key: r.key, label: r.label, date: r.date, state: 'next', note, hot };
  });
}

/** 경기 북부(시·군) — 나머지 경기는 남부. 지역 칸(REGION_CODES)이 경기를 둘로 나눠 쓴다 */
const GYEONGGI_NORTH = ['고양', '파주', '의정부', '양주', '동두천', '포천', '연천', '가평', '남양주', '구리'];
/** 짧은 시·도 이름 → 지역 코드(광주·세종·강원은 지역 칸에 없다 — 사람이 고른다) */
const SIDO_REGION: Record<string, string> = {
  서울: 'SEOUL', 인천: 'INCHEON', 대전: 'DAEJEON', 대구: 'DAEGU', 부산: 'BUSAN', 울산: 'ULSAN',
  충북: 'CHUNGBUK', 충남: 'CHUNGNAM', 경북: 'GYEONGBUK', 경남: 'GYEONGNAM', 전북: 'JEONBUK', 전남: 'JEONNAM', 제주: 'JEJU',
};

/**
 * 주소에서 지역 칸 값 — '서울 종로구 …' → SEOUL, '경기 고양시 …' → GYEONGGI_NORTH. 모르면 null(사람이 고른다).
 * 주소 검색(다음 우편번호)이 돌려주는 '서울 종로구 삼일대로 445' 와 사람이 친 '서울특별시 …' 둘 다 읽는다(`addressArea` 와 같은 시·도 표).
 */
export function regionFromAddress(address: string | null | undefined): string | null {
  const words = (address ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const sido = SIDO.find(([re]) => re.test(words[0]))?.[1];
  if (!sido) return null;
  if (sido === '경기') {
    const city = (words[1] ?? '').replace(/(시|군)$/, '');
    if (!city) return null;
    return GYEONGGI_NORTH.includes(city) ? 'GYEONGGI_NORTH' : 'GYEONGGI_SOUTH';
  }
  return SIDO_REGION[sido] ?? null;
}

/**
 * 이미 등록된 갤러리의 주소 점검(2026-11-15) — 주소 검색이 생기기 전에 자유 글로 적은 주소가 있다.
 *  · 'unknown' — 시·도·구를 읽을 수 없다('H 아트브릿지' · '서울' 만) → 카드가 지역 이름으로만 나온다
 *  · 'mismatch' — 주소의 지역과 지역 칸이 다르다(주소는 인천인데 지역은 서울) → 지역 거르기에서 엉뚱한 곳에 걸린다
 * 갤러리 주인에게만 '주소 다시 넣기'를 보이는 근거. 방문자 화면은 `addressArea` 가 지역 이름으로 대신해 깨지지 않는다.
 */
export function addressCheck(address: string | null | undefined, region: string): 'ok' | 'unknown' | 'mismatch' {
  const words = (address ?? '').trim().split(/\s+/).filter(Boolean);
  const sido = SIDO.find(([re]) => re.test(words[0] ?? ''))?.[1];
  if (!sido) return 'unknown';
  // 세종은 구가 없다('세종특별자치시 한누리대로 2130') — 시 다음 낱말이 있으면 읽힌 것으로 본다
  const hasDistrict = sido === '세종'
    ? words.length >= 2
    : words.length >= 2 && /^[가-힣]{1,6}(시|군|구)$/.test(words[1].replace(/[,·]+$/, ''));
  if (!hasDistrict) return 'unknown';
  const fromAddress = regionFromAddress(address);
  // 광주·세종·강원은 지역 칸에 없다 — 갤러리가 고른 지역을 믿는다
  if (!fromAddress) return 'ok';
  return fromAddress === region ? 'ok' : 'mismatch';
}

/* ───── 전시(Show) — 전시 찾기 · 전시 상세 · 전시 등록 미리보기 · 갤러리 카드가 같은 말을 한다(2026-11-15) ───── */

export interface ShowLike { startDate: string; endDate: string }

export interface ShowView {
  state: 'ongoing' | 'upcoming' | 'ended';
  /** 굵게 쓰는 앞 글자 — `전시 중` · `D-3 종료` · `오늘 종료` · `예정` · `종료` */
  badge: string;
  /** 빨강으로 쓸까 — 끝나기 7일 안(놓치기 전에 가야 한다) */
  hot: boolean;
  /** 뒤에 붙는 날짜 — `12.20(토)까지` · `12.1(월)부터` · `11.3(월) – 11.16(일)` */
  date: string;
}

/**
 * 전시 하나의 기간 표시 — 판정은 `getShowStatus`(lib/utils)와 같은 KST 달력 하루 기준.
 * 진행 중이면 끝나는 날을 앞에 둔다(가려면 언제까지인지가 먼저다), 끝나기 7일 안이면 'D-n 종료' 빨강.
 */
export function showView(s: ShowLike, now: Date = new Date()): ShowView {
  const toStart = daysUntil(s.startDate, now);
  const toEnd = daysUntil(s.endDate, now);
  if (toEnd < 0) return { state: 'ended', badge: '종료', hot: false, date: `${shortDate(s.startDate)} – ${shortDate(s.endDate)}` };
  if (toStart > 0) return { state: 'upcoming', badge: '예정', hot: false, date: `${shortDate(s.startDate)}부터` };
  if (toEnd <= HOT_DAYS) return { state: 'ongoing', badge: toEnd === 0 ? '오늘 종료' : `D-${toEnd} 종료`, hot: true, date: `${shortDate(s.endDate)}까지` };
  return { state: 'ongoing', badge: '전시 중', hot: false, date: `${shortDate(s.endDate)}까지` };
}

/**
 * [진행·예정] 탭 묶음 — '전시 중'(끝나는 날 가까운 순) → '예정'(시작하는 날 가까운 순). 끝난 전시는 [지난 전시] 탭이 갖는다.
 * [지난 전시] 는 최근에 끝난 순(`sortEnded`).
 */
export function groupShows<T extends ShowLike & { id: number }>(items: T[], now: Date = new Date()): ListGroup<T>[] {
  const ongoing = items.filter((s) => showView(s, now).state === 'ongoing')
    .sort((a, b) => kstDayNumber(a.endDate) - kstDayNumber(b.endDate) || a.id - b.id);
  const upcoming = items.filter((s) => showView(s, now).state === 'upcoming')
    .sort((a, b) => kstDayNumber(a.startDate) - kstDayNumber(b.startDate) || a.id - b.id);
  const out: ListGroup<T>[] = [];
  if (ongoing.length) out.push({ key: 'ongoing', label: '전시 중', items: ongoing });
  if (upcoming.length) out.push({ key: 'upcoming', label: '예정', items: upcoming });
  return out;
}

/** 지난 전시 — 최근에 끝난 순 */
export function sortEnded<T extends ShowLike & { id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => kstDayNumber(b.endDate) - kstDayNumber(a.endDate) || b.id - a.id);
}

/** 참여 작가 한 줄 — 세 명까지 이름, 넘으면 '외 N명' */
export function artistsLine(artists: { name: string }[] | null | undefined, max = 3): string {
  const names = (artists ?? []).map((a) => a.name.trim()).filter(Boolean);
  if (names.length === 0) return '';
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} 외 ${names.length - max}명`;
}

/** 전시 상세의 기간 띠 — 전시 시작 → 전시 종료(공모 상세의 일정 띠와 같은 모양, `ScheduleStrip`) */
export function showSteps(s: ShowLike, now: Date = new Date()): ScheduleStep[] {
  const v = showView(s, now);
  const start = { key: 'show-start' as const, label: '전시 시작', date: shortDate(s.startDate) };
  const end = { key: 'show-end' as const, label: '전시 종료', date: shortDate(s.endDate) };
  if (v.state === 'upcoming') {
    const n = daysUntil(s.startDate, now);
    return [{ ...start, state: 'next', note: `${n}일 뒤` }, { ...end, state: 'future' }];
  }
  if (v.state === 'ongoing') {
    const n = daysUntil(s.endDate, now);
    return [{ ...start, state: 'past' }, { ...end, state: 'next', note: n === 0 ? '오늘까지' : `${n}일 남음`, hot: n <= HOT_DAYS }];
  }
  return [{ ...start, state: 'past' }, { ...end, state: 'past' }];
}

/** 관람 시간 — 등록 폼은 '10:00-18:00' 으로 저장한다. 그 모양이면 '10:00 – 18:00', 아니면(옛 자유 글) 그대로 */
export function openingHoursText(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  return /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(t) ? t.replace('-', ' – ') : t;
}
