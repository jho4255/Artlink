/**
 * 무응답 자동 수락 기한 (lib/settlementDeadline.ts)
 *
 * 침묵을 동의로 바꾸는 계산이라 하루라도 밀리면 작가가 손해를 본다.
 * 특히 KST 경계에서 어긋나기 쉬워(CLAUDE.md 14) 실제 시각으로 못을 박아 둔다.
 */
import { describe, it, expect } from 'vitest';
import { autoApproveDeadline, isAutoApproveDue, daysLeft, AUTO_APPROVE_DAYS } from '../lib/settlementDeadline';

/** KST 시각을 UTC Date 로 (KST = UTC+9) */
const kst = (s: string) => new Date(`${s}+09:00`);

describe('autoApproveDeadline', () => {
  it('요청한 날의 KST 자정 끝에서 3일 뒤 — 온전한 3일을 준다', () => {
    // 8/17 아무 때나 물었으면 8/20 끝까지
    expect(autoApproveDeadline(kst('2026-08-17T10:00:00')).toISOString())
      .toBe(kst('2026-08-20T23:59:59.999').toISOString());
  });

  it('밤늦게 물어도 하루를 손해 보지 않는다 (72시간 방식이면 여기서 갈린다)', () => {
    const lateNight = autoApproveDeadline(kst('2026-08-17T23:50:00'));
    const earlyMorning = autoApproveDeadline(kst('2026-08-17T00:10:00'));
    expect(lateNight.toISOString()).toBe(earlyMorning.toISOString());
  });

  it('KST 자정 직전/직후는 다른 날로 센다', () => {
    const before = autoApproveDeadline(kst('2026-08-17T23:59:59'));
    const after = autoApproveDeadline(kst('2026-08-18T00:00:01'));
    expect(after.getTime() - before.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('월말을 넘어가도 맞는다', () => {
    expect(autoApproveDeadline(kst('2026-08-30T12:00:00')).toISOString())
      .toBe(kst('2026-09-02T23:59:59.999').toISOString());
  });
});

describe('isAutoApproveDue', () => {
  const asked = kst('2026-08-17T10:00:00');

  it('마감일 당일 23:59 까지는 아직 아니다', () => {
    expect(isAutoApproveDue(asked, kst('2026-08-20T23:59:00'))).toBe(false);
  });

  it('마감일이 지나면 대상', () => {
    expect(isAutoApproveDue(asked, kst('2026-08-21T00:00:01'))).toBe(true);
  });

  it('물어본 당일은 당연히 아니다', () => {
    expect(isAutoApproveDue(asked, kst('2026-08-17T23:59:59'))).toBe(false);
  });

  it('askedAt 이 없으면 영원히 false — 경고를 못 받은 옛 데이터에 소급 적용하지 않는다', () => {
    expect(isAutoApproveDue(null, kst('2030-01-01T00:00:00'))).toBe(false);
    expect(isAutoApproveDue(undefined, kst('2030-01-01T00:00:00'))).toBe(false);
  });
});

describe('daysLeft', () => {
  const asked = kst('2026-08-17T10:00:00');

  it('물어본 당일은 3일 남음', () => {
    expect(daysLeft(asked, kst('2026-08-17T15:00:00'))).toBe(AUTO_APPROVE_DAYS);
  });

  it('마감 당일은 0일 남음 (오늘까지)', () => {
    expect(daysLeft(asked, kst('2026-08-20T09:00:00'))).toBe(0);
  });

  it('지난 뒤엔 음수 대신 0', () => {
    expect(daysLeft(asked, kst('2026-08-25T09:00:00'))).toBe(0);
  });

  it('askedAt 이 없으면 null (기한 표시 자체를 하지 않는다)', () => {
    expect(daysLeft(null)).toBeNull();
  });
});
