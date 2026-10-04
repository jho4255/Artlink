import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 비회원 둘러보기 (2026-10-03, Admin [통계] 탭) — 로그인하지 않은 방문이 **무엇을 보고 얼마나 머물렀는지** 남기는 화면 쪽.
 * 서버 규칙·집계는 `backend/src/lib/guestActivity.ts`. 들어온 경로(광고·검색·이전 사이트)는 남기지 않는다(사용자 결정).
 *
 * - **방문 하나 = 이 탭**. 방문 id 는 방문마다 새로 만드는 무작위 값(sessionStorage) — 기기 번호(`visitBeacon` 의 localStorage id)와
 *   다른 값이라 이 기록은 계정과 이어지지 않는다. **탭이 열려 있는 한 같은 방문이다** — 띄워 둔 탭으로 몇 시간 뒤 돌아와도, 새로고침해도 이어진다.
 *   ⚠️ 쉬는 시간으로 방문을 끊지 말 것(2026-10-04 사용자 결정). 예전엔 30분 쉬면 새 방문이었는데, 띄워 둔 탭으로 돌아왔을 때 보고 있던 화면
 *   (모집공고 등)이 새 방문의 '처음 본 화면'이 되어 실제로 들어온 화면과 섞였다.
 * - **화면 하나 = 주소(경로 + `tab`·`work` 만) + 그 화면이 보이는 동안 머문 시간.** 창이 가려지면 시간을 멈춘다.
 *   0.7초도 안 머물고 넘어간 화면(주소 정리·로그인으로 보내기 같은 자동 이동)은 남기지 않는다.
 * - 보내는 때: 화면을 옮겼을 때(5초에 한 번까지) · 창이 가려지거나 닫힐 때(sendBeacon — 닫는 순간에도 간다) · 첫 화면은 3·15·35초에 한 번씩
 *   (첫 화면에서 바로 닫으면 가려짐 신호가 안 오는 인앱 브라우저가 있어 '바로 나감'을 놓치지 않으려고).
 * - 창을 닫거나 다른 사이트로 떠날 때(pagehide)는 '떠남'(`left`)을 함께 보낸다 — 그래야 마지막 기록 뒤 30분을 기다리지 않고
 *   '나감'으로 확정된다. 앱 전환(가려짐만)은 떠남이 아니다. 같은 방문이 이어지면(새로고침·카카오에서 돌아옴) 서버가 떠남을 지운다.
 * - **로그인하면 그 방문을 '로그인'(가입을 마쳤으면 '가입')으로 닫고 멈춘다.** 로그인한 뒤의 화면은 남기지 않는다.
 * - **이 브라우저로 로그인한 적이 있으면 기록하지 않는다**(`artlink-member-device`) — 회원이 로그아웃한 채 둘러보는 걸 비회원으로 세지 않으려고.
 *   ⚠️ 그래서 운영자가 자기 브라우저로 확인하면 아무것도 안 쌓인다 — 시크릿 창으로 볼 것.
 * - 실패해도 조용히 — 통계 때문에 화면이 흔들리면 안 된다. 다시 보내지도 않는다.
 */

const VISIT_KEY = 'artlink-guest-visit';
const SIGNUP_KEY = 'artlink-guest-signup';
const MEMBER_KEY = 'artlink-member-device';
const ENDPOINT = '/api/guest-activity';
/** 이보다 짧게 머문 화면은 자동 이동으로 보고 남기지 않는다 */
export const MIN_VIEW_MS = 700;
const FLUSH_GAP_MS = 5000;
const VIEW_MAX_MS = 30 * 60 * 1000;
/** 서버 `GUEST_MAX_VIEWS` 와 같은 값 */
export const MAX_VIEWS = 300;
/** 문서의 첫 화면을 미리 보내 두는 때(ms) — '바로 나감'(30초) 판정의 앞뒤 */
const EARLY_CHECKPOINTS = [3000, 15000, 35000];
/** 한 번에 보내는 화면 수 — 서버 `GUEST_MAX_BATCH` 와 같은 값(넘치면 나눠 보낸다) */
export const MAX_BATCH = 10;
/** 검색 로봇 — 자바스크립트를 돌리는 것도 있다(구글·빙·네이버 Yeti·다음). ⚠️ 'naver' 를 넣지 말 것 — 네이버 앱 인앱 브라우저(실사용자)가 걸린다.
 *  HeadlessChrome 은 빼지 않는다(우리 E2E·하니스가 그걸로 돈다) */
const BOT_RE = /bot|crawl|spider|slurp|lighthouse|yeti|daumoa|inspectiontool|googleother/i;

/** 남길 주소 — 경로 + `tab`·`work` 만(짧은 영숫자 값만). ⚠️ 서버 `normalizeGuestPath` 와 같은 규칙 */
export function guestPath(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ['tab', 'work']) {
    const v = q.get(k);
    if (v && /^[A-Za-z0-9_-]{1,40}$/.test(v)) keep.set(k, v);
  }
  const path = (pathname || '/').replace(/\/{2,}/g, '/');
  const s = keep.toString();
  return s ? `${path}?${s}` : path;
}

export interface GuestVisit { id: string; seq: number; last: number }
export interface GuestBeacon { visitId: string; views: { seq: number; path: string; ms: number }[]; outcome?: 'LOGIN' | 'SIGNUP'; left?: true }
/** early — 이 문서(페이지 로드)의 첫 화면. 3·15·35초에 미리 보낸다 */
interface View { seq: number | null; path: string; acc: number; since: number | null; early: boolean }

export interface TrackerDeps {
  now: () => number;
  visible: () => boolean;
  send: (body: GuestBeacon) => void;
  load: () => GuestVisit | null;
  save: (v: GuestVisit) => void;
  newId: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}

/** 기록기 — 상태 기계만(브라우저 API 는 `deps` 로 받는다 — 테스트가 시계를 돌린다) */
export class GuestTracker {
  active = false;
  private visit: GuestVisit | null = null;
  private cur: View | null = null;
  private queue: GuestBeacon['views'] = [];
  private lastFlushAt = 0;
  private flushTimer: unknown = null;
  private earlyTimers: unknown[] = [];
  private lastSentCur = '';
  private hadView = false;

  constructor(private deps: TrackerDeps) {}

  start() { this.active = true; }

  /** 화면이 바뀌었다(주소가 바뀌었거나, 주소는 그대로인데 단계가 바뀌었다 — 가입 정보 입력) */
  navigate(path: string) {
    if (!this.active || this.cur?.path === path) return;
    const now = this.deps.now();
    const first = this.ensureVisit(now);
    // 첫 화면이 곧바로 다른 주소로 넘어갔으면(`/explore` → `/artists`) 넘어간 화면이 그 '첫 화면' 몫을 이어받는다
    const prev = this.cur;
    const inheritEarly = !!prev && prev.early && prev.seq == null && this.elapsed(prev, now) < MIN_VIEW_MS;
    this.endView(now);
    // 이 문서의 첫 화면(처음 온 방문이든 새로고침·카카오에서 돌아온 방문이든)은 미리 보내 둔다 — 첫 화면에서 곧바로 닫으면
    // 가려짐 신호가 안 오는 인앱 브라우저가 있고, 돌아온 방문은 새 화면이 들어가야 서버가 '떠남'을 지운다
    const early = first || !this.hadView || inheritEarly;
    this.hadView = true;
    this.cur = { seq: null, path, acc: 0, since: this.deps.visible() ? now : null, early };
    this.touch(now);
    if (early) this.armEarly();
    this.scheduleFlush(now);
  }

  /**
   * 창이 가려졌다(앱 전환·탭 전환) — 시간을 멈추고 지금까지를 보낸다.
   * `left` = 창을 닫거나 다른 사이트로 떠난다(pagehide). 그때만 서버가 그 방문을 '나감'으로 확정한다.
   */
  hidden(left = false) {
    if (!this.active || !this.cur) return;
    const now = this.deps.now();
    this.pause(now);
    this.flush(now, undefined, left);
  }

  /** 뒤로가기 캐시(bfcache)에서 되살아났다 — 같은 화면을 새로 본 것으로 친다(새 화면이 들어가야 서버의 '떠남'이 풀린다) */
  restored() {
    if (!this.active || !this.cur) return;
    const now = this.deps.now();
    const path = this.cur.path;
    this.endView(now);
    this.cur = { seq: null, path, acc: 0, since: this.deps.visible() ? now : null, early: true };
    this.touch(now);
    this.armEarly();
  }

  /** 다시 보인다 — 얼마나 쉬었든 같은 방문의 같은 화면을 이어서 센다(머문 시간은 보이는 동안만이라 쉰 시간은 안 들어간다) */
  shown() {
    if (!this.active || !this.cur) return;
    const now = this.deps.now();
    if (this.cur.since == null) this.cur.since = now;
    this.touch(now);
  }

  /** 로그인·가입으로 이 방문을 닫는다 — 그 뒤로는 아무것도 남기지 않는다 */
  finish(outcome: 'LOGIN' | 'SIGNUP') {
    if (!this.active) return;
    const now = this.deps.now();
    this.endView(now);
    if (this.visit) this.flush(now, outcome);
    this.stop();
  }

  stop() {
    this.active = false;
    this.cur = null;
    this.queue = [];
    if (this.flushTimer) this.deps.clearTimer(this.flushTimer);
    this.flushTimer = null;
    this.earlyTimers.forEach((t) => this.deps.clearTimer(t));
    this.earlyTimers = [];
  }

  /** 방문이 없으면 연다. 새로 열었으면 true. 이 탭에 남은 방문(새로고침·카카오에서 돌아옴·오래 띄워 둔 탭)이 있으면 언제든 잇는다 */
  private ensureVisit(now: number): boolean {
    if (this.visit) return false;
    const stored = this.deps.load();
    if (stored) { this.visit = stored; return false; }
    this.visit = { id: this.deps.newId(), seq: 0, last: now };
    this.deps.save(this.visit);
    return true;
  }

  private touch(now: number) {
    if (!this.visit) return;
    this.visit.last = now;
    this.deps.save(this.visit);
  }

  private elapsed(v: View, now: number) {
    return Math.min(VIEW_MAX_MS, v.acc + (v.since != null ? Math.max(0, now - v.since) : 0));
  }

  private pause(now: number) {
    if (this.cur && this.cur.since != null) { this.cur.acc += Math.max(0, now - this.cur.since); this.cur.since = null; }
  }

  private assign(): number | null {
    if (!this.visit || this.visit.seq >= MAX_VIEWS) return null;
    const s = this.visit.seq;
    this.visit.seq += 1;
    this.deps.save(this.visit);
    return s;
  }

  private endView(now: number) {
    const v = this.cur;
    if (!v) return;
    this.cur = null;
    this.earlyTimers.forEach((t) => this.deps.clearTimer(t));
    this.earlyTimers = [];
    const ms = this.elapsed(v, now);
    if (v.seq == null && ms < MIN_VIEW_MS) return;   // 곧바로 넘어간 화면
    const seq = v.seq ?? this.assign();
    if (seq == null) return;
    this.queue.push({ seq, path: v.path, ms: Math.round(ms) });
  }

  private flush(now: number, outcome?: 'LOGIN' | 'SIGNUP', left = false) {
    if (this.flushTimer) { this.deps.clearTimer(this.flushTimer); this.flushTimer = null; }
    if (!this.visit) return;
    const views = this.queue.splice(0);
    const v = this.cur;
    if (v) {
      const ms = Math.round(this.elapsed(v, now));
      if (v.seq != null || ms >= MIN_VIEW_MS) {
        if (v.seq == null) v.seq = this.assign();
        const key = `${this.visit.id}:${v.seq}:${ms}`;   // 가려짐과 pagehide 가 잇달아 와도 같은 값은 한 번만
        if (v.seq != null && key !== this.lastSentCur) { views.push({ seq: v.seq, path: v.path, ms }); this.lastSentCur = key; }
      }
    }
    if (!views.length && !outcome && !left) return;
    this.lastFlushAt = now;
    this.touch(now);
    // 서버는 한 번에 10개까지만 받는다 — 넘치면 나눠 보내고, 결과·떠남 표시는 마지막 묶음에
    const id = this.visit.id;
    for (let i = 0; i < Math.max(1, views.length); i += MAX_BATCH) {
      const last = i + MAX_BATCH >= views.length;
      // 보내기가 던져도 기록기는 계속 산다(그 묶음만 빠진다)
      try {
        this.deps.send({ visitId: id, views: views.slice(i, i + MAX_BATCH), ...(last && outcome ? { outcome } : {}), ...(last && left ? { left: true as const } : {}) });
      } catch { /* 조용히 */ }
    }
  }

  private scheduleFlush(now: number) {
    if (!this.queue.length || this.flushTimer) return;
    const wait = FLUSH_GAP_MS - (now - this.lastFlushAt);
    if (wait <= 0) { this.flush(now); return; }
    this.flushTimer = this.deps.setTimer(() => { this.flushTimer = null; if (this.active) this.flush(this.deps.now()); }, wait);
  }

  private armEarly() {
    this.earlyTimers.forEach((t) => this.deps.clearTimer(t));
    this.earlyTimers = EARLY_CHECKPOINTS.map((ms) => this.deps.setTimer(() => {
      if (this.active && this.cur?.early && this.cur.since != null) this.flush(this.deps.now());
    }, ms));
  }
}

/* ───────────── 브라우저에 붙이기 ───────────── */

function storageGet(s: () => Storage, key: string): string | null { try { return s().getItem(key); } catch { return null; } }
function storageSet(s: () => Storage, key: string, value: string) { try { s().setItem(key, value); } catch { /* 막힌 환경 — 메모리 값으로 버틴다 */ } }
function storageDel(s: () => Storage, key: string) { try { s().removeItem(key); } catch { /* 조용히 */ } }
const session = () => sessionStorage;
const local = () => localStorage;

function newVisitId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

function sendBeaconBody(body: GuestBeacon) {
  const json = JSON.stringify(body);
  // text/plain — sendBeacon 은 헤더를 못 단다. 이 형식이면 미리 묻는 요청(preflight)도 없다
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return;
  } catch { /* 아래로 */ }
  try {
    void fetch(ENDPOINT, { method: 'POST', body: json, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true, credentials: 'omit' })
      .catch(() => { /* 통계용 — 조용히 */ });
  } catch { /* 조용히 */ }
}

let tracker: GuestTracker | null = null;
let memoryVisit: GuestVisit | null = null;

/** 통계 코드는 무엇이 잘못돼도 던지지 않는다 — 기록 하나가 빠질 뿐 화면은 그대로여야 한다 */
function safely(fn: () => void): void {
  try { fn(); } catch { /* 조용히 */ }
}

function browserTracker(): GuestTracker {
  if (tracker) return tracker;
  const t = new GuestTracker({
    now: () => Date.now(),
    visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    send: sendBeaconBody,
    load: () => {
      const raw = storageGet(session, VISIT_KEY);
      if (raw) {
        try {
          const v = JSON.parse(raw);
          if (v && typeof v.id === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(v.id) && Number.isInteger(v.seq) && Number.isFinite(v.last)) return v as GuestVisit;
        } catch { /* 망가진 값 — 새 방문 */ }
      }
      return memoryVisit;
    },
    save: (v) => { memoryVisit = { ...v }; storageSet(session, VISIT_KEY, JSON.stringify(v)); },
    newId: newVisitId,
    setTimer: (fn, ms) => setTimeout(() => safely(fn), ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  document.addEventListener('visibilitychange', () => safely(() => (document.visibilityState === 'hidden' ? t.hidden() : t.shown())));
  // 떠남 — 창을 닫거나 다른 사이트로 간다. 뒤로가기 캐시에 들어가는 경우(persisted)도 일단 떠난 것으로 보고, 되살아나면 다시 잇는다
  window.addEventListener('pagehide', () => safely(() => t.hidden(true)));
  window.addEventListener('pageshow', (e) => safely(() => { if (e.persisted) t.restored(); }));
  tracker = t;
  return t;
}

/** 이 브라우저에서 비회원 기록을 해도 되는가 — 로그인한 적 있는 브라우저·검색 로봇은 빼고 */
export function guestTrackingAllowed(ua: string, memberDevice: boolean): boolean {
  return !memberDevice && !BOT_RE.test(ua);
}

/** 가입을 마쳤다 — 로그인으로 바뀌는 순간 이 방문을 '가입'으로 닫는다(`AuthCallbackPage` 가입 완료에서 부른다) */
export function noteGuestSignup() { storageSet(session, SIGNUP_KEY, '1'); }

/**
 * 주소는 그대로인데 단계가 바뀌었다 — 카카오 로그인 뒤 **가입 정보 입력**(`/auth/register`).
 * 그 칸에서 그만두는 사람이 몇인지가 가입 전환의 핵심이라 따로 남긴다. 서버가 이 이름을 안다(`guestPageKind`).
 */
export function noteGuestStep(path: string) { safely(() => { if (tracker?.active) tracker.navigate(path); }); }

/**
 * App 맨 위에서 한 번 — 로그인 안 했을 때만 기록하고, 로그인하는 순간 그 방문을 닫는다.
 * ⚠️ 라우터 안에서 불러야 한다(`useLocation`).
 */
export function useGuestActivity(isAuthenticated: boolean) {
  const { pathname, search } = useLocation();
  const path = guestPath(pathname, search);
  // ⚠️ 아래 둘은 App 맨 위의 effect 다 — 여기서 던지면 ErrorBoundary 까지 올라가 **화면 전체**가 죽는다. 통계 때문에 사이트가 멈추면 안 되므로 전부 삼킨다
  useEffect(() => safely(() => {
    if (typeof window === 'undefined') return;
    if (isAuthenticated) {
      storageSet(local, MEMBER_KEY, '1');
      if (tracker?.active) {
        const signup = storageGet(session, SIGNUP_KEY) === '1';
        storageDel(session, SIGNUP_KEY);
        tracker.finish(signup ? 'SIGNUP' : 'LOGIN');
      }
      return;
    }
    if (!guestTrackingAllowed(navigator.userAgent, storageGet(local, MEMBER_KEY) === '1')) return;
    browserTracker().start();
  }), [isAuthenticated]);
  useEffect(() => safely(() => {
    if (isAuthenticated) return;
    tracker?.navigate(path);
  }), [path, isAuthenticated]);
}
