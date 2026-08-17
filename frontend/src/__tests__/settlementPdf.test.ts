/**
 * 정산서 PDF(HTML) 회귀 테스트.
 *
 * 작가가 받는 [내 정산서]에는 **갤러리 몫 금액을 찍지 않는다**. 화면(내 정산 내역)은 원래부터
 * 판매합계·비율·내 정산액만 보여주는데 PDF 만 갤러리 금액을 인쇄해 서로 어긋나 있었다.
 * 갤러리가 받는 같은 이름의 작가별 정산서는 **예전 그대로**여야 한다 — 여기가 무너지면
 * 갤러리 운영 기록에서 자기 몫이 사라진다.
 */
import { describe, it, expect } from 'vitest';
import { artistSettlementHtml, overallSettlementHtml } from '../lib/operationPdf';
import type { Settlement, SettlementArtist } from '../types';

const artist = {
  user: { id: 1, name: '홍길동', email: 'a@b.com' },
  galleryRatio: 30,
  artistRatio: 70,
  total: 1_000_000,
  galleryAmount: 300_000,
  artistAmount: 700_000,
  works: [
    { index: 0, title: '푸른 밤', image: '', size: '72.7×60.6 cm', medium: 'Oil', year: '2026', listPrice: '', sold: true, soldPrice: 1_000_000, paymentMethod: 'CARD' },
    { index: 1, title: '안 팔린 작품', image: '', size: '', medium: '', year: '', listPrice: '', sold: false, soldPrice: 0, paymentMethod: 'CARD' },
  ],
} as unknown as SettlementArtist;

describe('작가별 정산서 — 갤러리용(기본)', () => {
  const html = artistSettlementHtml('테스트 공모', artist);

  it('갤러리 정산 금액이 그대로 들어간다', () => {
    expect(html).toContain('갤러리 정산');
    expect(html).toContain('300,000원');
  });
  it('판매 합계·비율·작가 지급액도 함께', () => {
    expect(html).toContain('1,000,000원');
    expect(html).toContain('30% : 70%');
    expect(html).toContain('700,000원');
  });
});

describe('작가별 정산서 — 작가 본인용(hideGalleryAmount)', () => {
  const html = artistSettlementHtml('테스트 공모', artist, '정산서', true);

  it('갤러리 정산 금액 줄이 빠진다', () => {
    expect(html).not.toContain('갤러리 정산');
    expect(html).not.toContain('300,000원');
  });
  it('작가에게 필요한 정보는 그대로 남는다 (판매작·합계·비율·내 지급액)', () => {
    expect(html).toContain('푸른 밤');
    expect(html).toContain('1,000,000원');   // 판매 합계
    expect(html).toContain('30% : 70%');     // 합의한 비율 — 작가 몫의 근거라 남긴다
    expect(html).toContain('700,000원');     // 작가 정산 (지급액)
    expect(html).toContain('작가 정산 (지급액)');
  });
  it('판매되지 않은 작품은 어느 쪽에도 실리지 않는다', () => {
    expect(html).not.toContain('안 팔린 작품');
  });
});

describe('전체 정산서 — 갤러리 전용이라 손대지 않는다', () => {
  const settlement = {
    exhibitionTitle: '테스트 공모',
    artists: [artist],
    grand: { total: 1_000_000, galleryAmount: 300_000, artistAmount: 700_000, soldCount: 1 },
  } as unknown as Settlement;

  it('갤러리 정산 합계가 남아 있다', () => {
    const html = overallSettlementHtml(settlement);
    expect(html).toContain('갤러리 정산 합계');
    expect(html).toContain('300,000원');
  });
});
