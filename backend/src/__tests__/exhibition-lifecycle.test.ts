/**
 * 방치된 공모 정리 규칙 (lib/exhibitionLifecycle.ts)
 *
 * ── 왜 있나 ────────────────────────────────────────────────
 * 실서버에 [전시종료] 버튼조차 안 누른 채 방치된 공모가 있다(전시가 끝난 지 39일).
 * 정산을 아예 안 쓰는 갤러리도 있다. 그러면 작가·갤러리·Admin 목록 모두에서
 * 몇 년 전 전시가 영원히 '진행중' 으로 쌓인다.
 *
 * ── 지켜야 하는 균형 ────────────────────────────────────────
 * ⚠️ 너무 세게 잡으면 → **정산을 하던 갤러리의 작업이 목록에서 사라진다**.
 *    방치를 정리하려는 규칙이 진행 중인 작업을 방해하면 안 된다.
 * ⚠️ 너무 약하게 잡으면 → 원래 문제(영원히 진행중)가 그대로다.
 */
import { describe, it, expect } from 'vitest';
import {
  isExhibitionClosed, isSettlementStarted, isStaleAfterExhibit, STALE_AFTER_DAYS,
} from '../lib/exhibitionLifecycle';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-19T05:00:00.000Z');           // KST 8/19 14:00
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe('isSettlementStarted — 갤러리가 정산에 손을 댔는가', () => {
  it('판매를 하나라도 입력했으면 시작한 것', () => {
    expect(isSettlementStarted({ exhibitDate: daysAgo(30), saleCount: 1 })).toBe(true);
  });

  it('확인 요청을 보냈으면 시작한 것', () => {
    expect(isSettlementStarted({ exhibitDate: daysAgo(30), settlementRequestedAt: daysAgo(1) })).toBe(true);
  });

  it('아무것도 안 했으면 시작 안 한 것', () => {
    expect(isSettlementStarted({ exhibitDate: daysAgo(30) })).toBe(false);
    expect(isSettlementStarted({ exhibitDate: daysAgo(30), saleCount: 0 })).toBe(false);
  });
});

describe('isStaleAfterExhibit — 전시 종료 후 20일', () => {
  it(`${STALE_AFTER_DAYS}일이 지나면 방치로 본다`, () => {
    expect(isStaleAfterExhibit({ exhibitDate: daysAgo(21) }, NOW)).toBe(true);
    expect(isStaleAfterExhibit({ exhibitDate: daysAgo(39) }, NOW)).toBe(true);
  });

  it('아직 20일이 안 됐으면 방치가 아니다', () => {
    expect(isStaleAfterExhibit({ exhibitDate: daysAgo(19) }, NOW)).toBe(false);
    expect(isStaleAfterExhibit({ exhibitDate: daysAgo(11) }, NOW)).toBe(false);
  });

  it('전시가 아직 안 끝났으면 당연히 아니다', () => {
    expect(isStaleAfterExhibit({ exhibitDate: new Date(NOW.getTime() + 10 * DAY) }, NOW)).toBe(false);
  });

  it('종료일이 없으면 판정하지 않는다 (임의로 내리지 않는다)', () => {
    expect(isStaleAfterExhibit({ exhibitDate: null }, NOW)).toBe(false);
  });

  /**
   * 날짜는 KST 달력 기준이어야 한다.
   * 순수 UTC 로 재면 마감이 KST 오전 9시에 넘어가는 오프바이원이 생긴다(CLAUDE.md 14).
   */
  it('경계는 KST 달력 날짜 단위로 움직인다', () => {
    const exactly20 = daysAgo(STALE_AFTER_DAYS);
    // 같은 순간을 KST 새벽/밤에 재도 판정이 뒤집히면 안 된다
    const kstEarly = new Date('2026-08-19T15:10:00.000Z');   // KST 8/20 00:10
    const kstLate = new Date('2026-08-19T14:50:00.000Z');    // KST 8/19 23:50
    expect(isStaleAfterExhibit({ exhibitDate: exactly20 }, kstLate)).toBe(false);
    expect(isStaleAfterExhibit({ exhibitDate: exactly20 }, kstEarly)).toBe(true);
  });
});

describe('isExhibitionClosed — 목록에서 종료로 내릴 것인가', () => {
  it('정산이 완료됐으면 종료 (원래 규칙)', () => {
    expect(isExhibitionClosed({ exhibitDate: daysAgo(1), settledAt: daysAgo(1) }, NOW)).toBe(true);
  });

  it('전시 종료 20일이 지났고 정산을 시작도 안 했으면 종료', () => {
    expect(isExhibitionClosed({ exhibitDate: daysAgo(39) }, NOW)).toBe(true);
  });

  /** 이게 이 파일의 핵심 — 하던 일을 뺏으면 안 된다 */
  it('20일이 지났어도 정산을 시작했으면 진행중에 남는다', () => {
    expect(isExhibitionClosed({ exhibitDate: daysAgo(39), saleCount: 3 }, NOW)).toBe(false);
    expect(isExhibitionClosed({ exhibitDate: daysAgo(39), settlementRequestedAt: daysAgo(2) }, NOW)).toBe(false);
  });

  it('20일 전이면 정산을 안 했어도 진행중', () => {
    expect(isExhibitionClosed({ exhibitDate: daysAgo(11) }, NOW)).toBe(false);
  });

  it('정산 완료는 정산 시작 여부와 무관하게 항상 종료', () => {
    expect(isExhibitionClosed({ exhibitDate: daysAgo(1), settledAt: daysAgo(1), saleCount: 5 }, NOW)).toBe(true);
  });

  it('문자열 날짜(API 응답 형태)도 받는다', () => {
    expect(isExhibitionClosed({ exhibitDate: daysAgo(39).toISOString() }, NOW)).toBe(true);
    expect(isExhibitionClosed({ exhibitDate: 'not-a-date' }, NOW)).toBe(false);
  });
});
