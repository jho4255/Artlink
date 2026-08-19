/**
 * 정산 지문 순수함수 테스트 (lib/settlementFingerprint.ts)
 *
 * 이 함수가 틀리면 두 방향 모두 실무에서 아프다.
 *  · 너무 예민하면 → 금액이 그대로인데도 수락이 풀려 작가를 헛되이 다시 붙잡는다
 *  · 너무 둔하면  → 작가가 못 본 금액으로 정산이 완료된다 (돈 문제라 더 나쁘다)
 */
import { describe, it, expect } from 'vitest';
import { settlementFingerprint, fingerprintsOf } from '../lib/settlementFingerprint';

describe('settlementFingerprint', () => {
  it('판매가·결제수단·비율이 같으면 순서가 달라도 같은 지문', () => {
    const a = settlementFingerprint(
      [{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }, { artworkIndex: 2, soldPrice: 300, paymentMethod: 'CASH' }], 30);
    const b = settlementFingerprint(
      [{ artworkIndex: 2, soldPrice: 300, paymentMethod: 'CASH' }, { artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }], 30);
    expect(a).toBe(b);
  });

  it('판매가가 바뀌면 지문이 달라진다', () => {
    const before = settlementFingerprint([{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }], 30);
    const after = settlementFingerprint([{ artworkIndex: 0, soldPrice: 200, paymentMethod: 'CARD' }], 30);
    expect(after).not.toBe(before);
  });

  it('결제수단이 바뀌면 지문이 달라진다 (현금/카드는 작가 수령 방식이 다르다)', () => {
    const card = settlementFingerprint([{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }], 30);
    const cash = settlementFingerprint([{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CASH' }], 30);
    expect(cash).not.toBe(card);
  });

  it('비율만 바뀌어도 지문이 달라진다', () => {
    expect(settlementFingerprint([], 30)).not.toBe(settlementFingerprint([], 40));
  });

  it('판매 작품이 늘거나 줄면 지문이 달라진다', () => {
    const one = settlementFingerprint([{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }], 0);
    const two = settlementFingerprint(
      [{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }, { artworkIndex: 1, soldPrice: 0, paymentMethod: 'CARD' }], 0);
    expect(two).not.toBe(one);
  });

  it('결제수단이 비어 있으면 CARD 로 본다 (DB 기본값과 같게)', () => {
    const blank = settlementFingerprint([{ artworkIndex: 0, soldPrice: 100, paymentMethod: null }], 0);
    const card = settlementFingerprint([{ artworkIndex: 0, soldPrice: 100, paymentMethod: 'CARD' }], 0);
    expect(blank).toBe(card);
  });
});

describe('fingerprintsOf', () => {
  const sales = [
    { artistUserId: 1, artworkIndex: 0, soldPrice: 1000, paymentMethod: 'CARD' },
    { artistUserId: 2, artworkIndex: 0, soldPrice: 2000, paymentMethod: 'CARD' },
  ];
  const ratios = [{ artistUserId: 1, galleryRatio: 30 }, { artistUserId: 2, galleryRatio: 40 }];

  it('작가별로 자기 판매분만 반영한다 (남의 금액 변경에 끌려가면 안 된다)', () => {
    const before = fingerprintsOf([1, 2], sales, ratios);
    const after = fingerprintsOf([1, 2], [sales[0]!, { ...sales[1]!, soldPrice: 9999 }], ratios);
    expect(after.get(1)).toBe(before.get(1));   // 1번은 그대로 → 수락 유지
    expect(after.get(2)).not.toBe(before.get(2));
  });

  it('판매도 비율도 없는 작가에게도 지문이 생긴다 (undefined 비교 방지)', () => {
    const fps = fingerprintsOf([1, 2, 3], sales, ratios);
    expect(fps.get(3)).toBe('r0|');
    expect(fps.has(3)).toBe(true);
  });
});

/**
 * 카드 수수료율이 지문에 들어간다 (2026-08-19).
 *
 * 여기서 제일 무서운 건 형식 변경이다. 실서버에는 **작가가 이미 수락해 둔 지문**이
 * 문자열로 저장돼 있어서, 수수료를 붙이면서 형식이 조금이라도 달라지면 그 수락이 전부 풀린다
 * (2026-08-17 백필 마이그레이션으로 겨우 막았던 사고와 같다).
 * 그래서 **수수료 0 = 예전과 한 글자도 다르지 않아야** 한다.
 */
describe('카드 수수료율과 지문', () => {
  const sale = [{ artworkIndex: 0, soldPrice: 1_000_000, paymentMethod: 'CARD' }];

  it('수수료 0 이면 예전 형식 그대로 — 이미 저장된 지문이 깨지면 안 된다', () => {
    // 실서버에 저장돼 있는 형식. 이 문자열이 바뀌면 기존 수락이 전부 무효가 된다.
    expect(settlementFingerprint(sale, 40)).toBe('r40|0:1000000:CARD');
    expect(settlementFingerprint(sale, 40, 0)).toBe('r40|0:1000000:CARD');
    expect(settlementFingerprint([], 0, 0)).toBe('r0|');
  });

  it('수수료율을 안 넘겨도(구버전 호출) 0 으로 본다', () => {
    expect(settlementFingerprint(sale, 40)).toBe(settlementFingerprint(sale, 40, 0));
  });

  it('수수료율이 붙으면 지문이 달라진다 — 작가 지급액이 줄었으니 다시 확인받아야 한다', () => {
    expect(settlementFingerprint(sale, 40, 2.2)).not.toBe(settlementFingerprint(sale, 40, 0));
    expect(settlementFingerprint(sale, 40, 2.2)).not.toBe(settlementFingerprint(sale, 40, 3.3));
  });

  it('같은 수수료율은 표기가 달라도 같은 지문 (2.2 / 2.20 / 부동소수 오차)', () => {
    const base = settlementFingerprint(sale, 40, 2.2);
    expect(settlementFingerprint(sale, 40, 2.20)).toBe(base);
    expect(settlementFingerprint(sale, 40, 2.2000000000000002)).toBe(base);
  });

  it('음수·NaN·null 은 0 으로 본다 (수수료가 지급액을 늘리는 일은 없다)', () => {
    const zero = settlementFingerprint(sale, 40, 0);
    expect(settlementFingerprint(sale, 40, -5)).toBe(zero);
    expect(settlementFingerprint(sale, 40, NaN)).toBe(zero);
    expect(settlementFingerprint(sale, 40, undefined as any)).toBe(zero);
  });

  /**
   * 이 두 개가 이 블록의 핵심이다.
   * 처음엔 지문에 '수수료율'을 그대로 넣었더니 **현금으로만 판 작가까지 재확인 대상**이 됐다.
   * 그 사람 지급액은 1원도 안 변하는데 다시 붙잡는 셈이다. 그래서 율이 아니라
   * 그 작가가 실제로 부담하는 수수료 **금액**을 넣는다.
   */
  it('현금으로만 판 작가는 수수료율이 붙어도 지문이 그대로 — 헛되이 다시 붙잡지 않는다', () => {
    const cashOnly = [{ artworkIndex: 0, soldPrice: 1_000_000, paymentMethod: 'CASH' }];
    expect(settlementFingerprint(cashOnly, 40, 2.2)).toBe(settlementFingerprint(cashOnly, 40, 0));
  });

  it('판매가 아예 없는 작가도 수수료율에 흔들리지 않는다', () => {
    expect(settlementFingerprint([], 40, 2.2)).toBe('r40|');
  });

  it('카드 판매가 섞여 있으면 카드분에서 계산한 금액이 들어간다', () => {
    const mixed = [
      { artworkIndex: 0, soldPrice: 1_000_000, paymentMethod: 'CARD' },
      { artworkIndex: 1, soldPrice: 500_000, paymentMethod: 'CASH' },
    ];
    // 카드 1,000,000 × 2.2% = 22,000 (현금 500,000 은 제외)
    expect(settlementFingerprint(mixed, 40, 2.2)).toBe('r40|0:1000000:CARD,1:500000:CASH|f22000');
  });

  it('fingerprintsOf 도 수수료율을 반영한다 (전 작가 공통값)', () => {
    const sales = [
      { artistUserId: 1, artworkIndex: 0, soldPrice: 1000, paymentMethod: 'CARD' },
      { artistUserId: 2, artworkIndex: 0, soldPrice: 2000, paymentMethod: 'CARD' },
    ];
    const ratios = [{ artistUserId: 1, galleryRatio: 30 }, { artistUserId: 2, galleryRatio: 40 }];
    const before = fingerprintsOf([1, 2], sales, ratios, 0);
    const after = fingerprintsOf([1, 2], sales, ratios, 2.2);
    expect(after.get(1)).not.toBe(before.get(1));
    expect(after.get(2)).not.toBe(before.get(2));
  });
});
