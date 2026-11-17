import prisma from './prisma';
import { logger } from './logger';

/**
 * 홈페이지 문의 (2026-11-14, CLAUDE.md 규칙 82) — **로그인하지 않은 방문자**가 작가·갤러리 홈페이지 [문의하기]로 남기는 글.
 * 로그인한 회원의 문의는 ArtTalk(갠톡)으로 간다. 여기는 받는 사람이 켰을 때만(Portfolio/Gallery.guestInquiry) 열린다.
 *
 * 로그인 없이 쓰는 길이라 **한도를 세 겹** 둔다:
 *  ① 접속 주소당 1시간 5건(서버 메모리 — `takeInquirySlot`) ② 받는 사람당 하루 30건(DB, `withKeyLock`) ③ 전역 요청 한도(index.ts, 15분 300)
 * 거기에 숨은 칸(봇이 채운다 — 채워 오면 성공한 척하고 버린다) · 링크 3개 넘는 글 거절 · 연락처는 이메일이나 전화번호 모양만.
 *
 * 이름·연락처는 개인정보다 — 1년 뒤 지운다(`pruneHomepageInquiries`, 스케줄러 없이 요청 때 시간당 한 번 · 비회원 통계와 같은 방식).
 * 받은 사람이 지우면 바로, 탈퇴하면 함께 지운다(routes/auth.ts). 개인정보처리방침 1·3·4항에 적었다.
 */
export const INQUIRY_NAME_MAX = 40;
export const INQUIRY_CONTACT_MAX = 100;
export const INQUIRY_MESSAGE_MAX = 1000;
/** 이보다 많은 링크가 든 글은 거절한다(광고 글) */
export const INQUIRY_LINK_MAX = 3;
export const INQUIRY_PER_IP_HOUR = 5;
export const INQUIRY_PER_OWNER_DAY = 30;
export const INQUIRY_RETENTION_DAYS = 365;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 받은 문의 화면 — 알림이 그 문의를 펼친 채로 연다 */
export const homepageInquiryLink = (id: number) => `/mypage?tab=received-inquiries&inquiry=${id}`;

/** 글 안의 링크 수 — http(s):// 또는 www. 로 시작하는 것 */
export function countLinks(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length;
}

/**
 * 연락처 모양 — 이메일(…@….…) 또는 숫자 8개 이상(전화번호). 아무 글이나 받으면 답할 길이 없는 문의가 쌓인다.
 * 국제번호·하이픈·괄호·공백은 받는다.
 */
export function isContactLike(raw: string): boolean {
  const s = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^[+(\d][\d\s()\-.]*$/.test(s) && (s.match(/\d/g) ?? []).length >= 8) return true;
  return false;
}

/* ───── ① 접속 주소당 1시간 5건 — 서버 메모리(인스턴스 하나, 재시작하면 비워진다 — 그 정도는 괜찮다) ───── */
const TRACK_MAX = 20_000;
const hits = new Map<string, number[]>();

/**
 * 한 건을 **먼저 잡는다**(저장 전에) — 판정과 세기 사이에 await 가 없다. 동시에 열 개를 보내도 다섯 개만 지난다(loginThrottle 과 같은 이유).
 * false 면 한도를 넘었다.
 */
export function takeInquirySlot(key: string, now: number = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < HOUR);
  if (list.length >= INQUIRY_PER_IP_HOUR) { hits.set(key, list); return false; }
  list.push(now);
  hits.delete(key);   // 넣은 순서 = 마지막으로 쓴 순서(비울 때 오래된 것부터)
  hits.set(key, list);
  if (hits.size > TRACK_MAX) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= HOUR)) hits.delete(k);
    // 그래도 많으면 오래 안 쓴 것부터 절반 — 서로 다른 주소로 쏟아부어 메모리를 늘리는 걸 막는다
    if (hits.size > TRACK_MAX) {
      let drop = Math.floor(hits.size / 2);
      for (const k of hits.keys()) { if (drop-- <= 0) break; hits.delete(k); }
    }
  }
  return true;
}

/** 테스트 전용 */
export function __resetInquiryThrottle(): void { hits.clear(); }

/* ───── 1년 지난 문의 지우기 — 요청 때 시간당 한 번 ───── */
let lastPrune = 0;
export async function pruneHomepageInquiries(now: number = Date.now(), force = false): Promise<number> {
  if (!force && now - lastPrune < HOUR) return 0;
  lastPrune = now;
  try {
    const { count } = await prisma.homepageInquiry.deleteMany({ where: { createdAt: { lt: new Date(now - INQUIRY_RETENTION_DAYS * DAY) } } });
    return count;
  } catch (e) {
    logger.warn('homepage-inquiry', `오래된 문의를 지우지 못했습니다: ${(e as Error).message}`);
    return 0;
  }
}

/** 받는 사람당 하루 상한을 셀 때의 시작 시각 */
export const ownerDaySince = (now: number = Date.now()) => new Date(now - DAY);
