/**
 * 정산서 PDF (2026-11-24 글자 PDF 로 다시 짬, 규칙 92).
 *
 * 작가가 받는 [내 정산서]에는 **갤러리 몫 금액 줄을 찍지 않는다** — 화면(내 정산 내역)과 같은 서식 규칙.
 * 갤러리가 받는 같은 작가의 정산서는 그 줄이 있어야 한다 — 여기가 무너지면 갤러리 운영 기록에서 자기 몫이 사라진다.
 */
import { describe, it, expect } from 'vitest';
import {
  approvalCell, buildArtistSettlementDoc, buildSettlementDoc, filterArtistByMethod, filterSettlementByMethod, settlementImages,
  type DocSettlement, type DocSettlementArtist,
} from '@/lib/galleryDocs/settlementDoc';
import type { DocContext } from '@/lib/galleryDocs/types';
import { docText, fakeImg, imagesOf } from './docTestUtils';

const ctx: DocContext = { exTitle: '겹과 결', issuer: '갤러리 온', period: '2027. 3. 20 – 4. 6', issued: '2027. 4. 9.', contact: '02-123-4567 · 서울 종로구' };

const w = (o: Record<string, unknown>) => ({ index: 0, title: '', image: '', size: '', medium: '', year: '', listPrice: '', sold: false, soldPrice: 0, paymentMethod: 'CARD', ...o });

const artist = {
  user: { id: 1, name: '홍길동', email: 'a@b.com' },
  galleryRatio: 30, artistRatio: 70,
  total: 1_500_000, cardTotal: 1_000_000, cashTotal: 500_000, cardFee: 33_000, settleBase: 1_467_000,
  galleryAmount: 440_100, artistAmount: 1_026_900,
  works: [
    w({ index: 0, title: '푸른 밤', image: '/uploads/a.jpg', size: '72.7x60.6cm', medium: 'oil on canvas', year: '2026', sold: true, soldPrice: 1_000_000, paymentMethod: 'CARD' }),
    w({ index: 1, title: '여름', image: '/uploads/b.jpg', sold: true, soldPrice: 500_000, paymentMethod: 'CASH' }),
    w({ index: 2, title: '안 팔린 작품', image: '/uploads/c.jpg' }),
  ],
  approval: { status: 'APPROVED', autoApproved: false, respondedAt: '2027-04-08T15:30:00.000Z' },
} as unknown as DocSettlementArtist;

const quiet = { user: { id: 2, name: '김작가' }, galleryRatio: 40, artistRatio: 60, total: 0, galleryAmount: 0, artistAmount: 0, works: [w({ title: '그대로' })], approval: { status: 'PENDING' } } as unknown as DocSettlementArtist;
const guest = { user: { id: 3, name: '박손님', guest: true }, guest: true, galleryRatio: 40, artistRatio: 60, total: 0, galleryAmount: 0, artistAmount: 0, works: [], approval: null } as unknown as DocSettlementArtist;

const settlement = {
  artists: [artist, quiet, guest],
  cardFeeRate: 3.3,
  grand: { total: 1_500_000, cardTotal: 1_000_000, cashTotal: 500_000, cardFee: 33_000, settleBase: 1_467_000, galleryAmount: 440_100, artistAmount: 1_026_900, soldCount: 2 },
} as unknown as DocSettlement;

describe('작가별 정산서 — 갤러리용(기본)과 작가 본인용', () => {
  const forGallery = docText(buildArtistSettlementDoc(ctx, artist, undefined, { cardFeeRate: 3.3 }, fakeImg));
  const forArtist = docText(buildArtistSettlementDoc(ctx, artist, undefined, { forArtist: true, cardFeeRate: 3.3 }, fakeImg));

  it('계산 순서가 다 있다 — 판매 합계 → 카드 수수료 → 정산 대상 → 갤러리 → 작가 지급액', () => {
    for (const s of ['판매 합계', '1,500,000원', '카드 수수료', '카드 판매 1,000,000원 × 3.3%', '−33,000원', '정산 대상', '1,467,000원', '갤러리', '−440,100원', '작가 지급액', '1,026,900원']) {
      expect(forGallery, s).toContain(s);
    }
    expect(forGallery).toContain('판매 2점 · 정산 비율 갤러리 30 : 작가 70');
  });

  it('★ 작가 본인용은 갤러리 몫 줄이 빠진다 — 나머지(판매작·합계·비율·내 지급액)는 그대로', () => {
    expect(forArtist).not.toContain('−440,100원');
    for (const s of ['푸른 밤', '여름', '1,500,000원', '정산 비율 갤러리 30 : 작가 70', '1,026,900원']) expect(forArtist, s).toContain(s);
  });

  it('판매되지 않은 작품은 싣지 않는다 · 판매작 그림은 비율 그대로(fit)', () => {
    expect(forGallery).not.toContain('안 팔린 작품');
    const doc = buildArtistSettlementDoc(ctx, artist, undefined, {}, fakeImg);
    expect(imagesOf(doc).map((n) => [n.image, Array.isArray(n.fit), n.width, n.height])).toEqual([
      ['data:image/jpeg;thumb;/uploads/a.jpg', true, undefined, undefined],
      ['data:image/jpeg;thumb;/uploads/b.jpg', true, undefined, undefined],
    ]);
    expect(settlementImages([artist])).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
  });

  it('확인 기록 · 발행처 · 표기 정리', () => {
    expect(forGallery).toContain('2027. 4. 9. 작가가 이 금액을 확인했습니다.');
    expect(forGallery).toContain('갤러리 온 · 02-123-4567 · 서울 종로구');
    expect(forGallery).toContain('Oil on canvas · 72.7 × 60.6 cm · 2026');
    const auto = { ...artist, approval: { status: 'APPROVED', autoApproved: true, respondedAt: '2027-04-11T16:00:00.000Z' } } as DocSettlementArtist;
    expect(docText(buildArtistSettlementDoc(ctx, auto, undefined, {}, fakeImg))).toContain('2027. 4. 12. 확인 기한이 지나 자동으로 확인되었습니다.');
  });
});

describe('결제수단으로 나눈 정산서 — 카드 수수료는 카드 정산서에만', () => {
  it('현금 정산서에는 수수료가 없고, 카드 정산서에만 있다(두 장을 더해도 두 번 빠지지 않는다)', () => {
    const cash = filterArtistByMethod(artist, 'CASH', 3.3);
    const card = filterArtistByMethod(artist, 'CARD', 3.3);
    expect([cash.total, cash.cardFee, cash.works.map((x) => x.title)]).toEqual([500_000, 0, ['여름']]);
    expect([card.total, card.cardFee, card.works.map((x) => x.title)]).toEqual([1_000_000, 33_000, ['푸른 밤']]);
    expect((cash.cardFee ?? 0) + (card.cardFee ?? 0)).toBe(33_000);
    expect(cash.galleryAmount + cash.artistAmount).toBe(cash.settleBase);
  });
  it('전체를 거르면 합계도 다시 센다', () => {
    const cash = filterSettlementByMethod(settlement, 'CASH');
    expect(cash.grand).toMatchObject({ total: 500_000, cardFee: 0, soldCount: 1 });
    expect(docText(buildSettlementDoc(ctx, settlement, 'CASH', fakeImg))).toContain('현금 판매 500,000원');
    expect(docText(buildSettlementDoc(ctx, { ...settlement, artists: [quiet] }, 'CARD', fakeImg))).toContain('카드로 판매된 작품이 없어요.');
  });
});

describe('전체 정산서 — 갤러리 전용', () => {
  const text = docText(buildSettlementDoc(ctx, settlement, undefined, fakeImg));

  it('요약 숫자 · 결제수단 한 줄 · 발행 정보', () => {
    for (const s of ['정산서', '전체', '2점', '1,500,000원', '440,100원', '1,026,900원', '카드 판매 1,000,000원 · 현금 판매 500,000원 · 카드 수수료 3.3% −33,000원', '갤러리 온', '전시 2027. 3. 20 – 4. 6', '발행 2027. 4. 9.']) {
      expect(text, s).toContain(s);
    }
  });

  it('작가별 정산 표는 판매가 있는 작가만 · 판매 없는 작가는 한 줄로(비회원 표시)', () => {
    expect(text).toContain('작가별 정산');
    expect(text).toContain('판매 없음 2명 — 김작가 · 박손님(비회원)');
    expect(text).not.toContain('그대로');           // 판매 없는 작가의 작품은 판매 내역에 없다
    expect(text).toContain('판매 내역');
  });

  it('작가 확인 칸 — 날짜 · 자동 · 이의 · 확인 전 · 비회원', () => {
    expect(approvalCell(artist)).toBe('4. 9.');
    expect(approvalCell({ ...artist, approval: { status: 'APPROVED', autoApproved: true, respondedAt: '2027-04-11T16:00:00.000Z' } } as DocSettlementArtist)).toBe('자동 4. 12.');
    expect(approvalCell({ ...artist, approval: { status: 'ISSUE' } } as DocSettlementArtist)).toBe('이의');
    expect(approvalCell(quiet)).toBe('확인 전');
    expect(approvalCell(guest)).toBe('비회원');
    expect(approvalCell({ ...artist, approval: null } as DocSettlementArtist)).toBe('—');
  });
});
