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
