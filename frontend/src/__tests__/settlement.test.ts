/**
 * 정산 화면 공용 규칙 (lib/settlement.ts)
 *
 * 금액 계산과 '처음에 무엇을 펼쳐둘지' 두 가지. 둘 다 화면을 열어보지 않으면 티가 안 나는 종류라
 * 여기서 못 잡으면 배포된 뒤에야 알게 된다.
 */
import { describe, it, expect } from 'vitest';
import { won, artistTotals, initialOpenArtistIds, settlementFormSignature, type EditArtist } from '@/lib/settlement';

const work = (sold: boolean, soldPrice: number) => ({
  index: 0, title: '', listPrice: '', sold, soldPrice, paymentMethod: 'CARD' as const,
});
const artist = (ratio: number, prices: number[]): EditArtist => ({
  user: { id: 1, name: 'A' },
  galleryRatio: ratio,
  works: prices.map((p, i) => ({ ...work(true, p), index: i })),
});

describe('won', () => {
  it('천 단위 구분과 원 단위를 붙인다', () => {
    expect(won(1000000)).toBe('1,000,000원');
  });
  it('0·null 도 깨지지 않는다 (판매 없는 작가가 흔하다)', () => {
    expect(won(0)).toBe('0원');
    expect(won(undefined as unknown as number)).toBe('0원');
  });
});

describe('artistTotals', () => {
  it('판매 표시된 작품만 합산한다', () => {
    const a: EditArtist = { user: { id: 1, name: 'A' }, galleryRatio: 0, works: [work(true, 100), { ...work(false, 999), index: 1 }] };
    expect(artistTotals(a).total).toBe(100);
  });

  it('갤러리 몫과 작가 몫의 합이 언제나 판매 합계와 같다 (정산서 숫자가 안 맞으면 분쟁이 된다)', () => {
    // 33% 처럼 딱 안 떨어지는 비율에서 양쪽을 따로 반올림하면 1원이 새거나 남는다
    for (const ratio of [0, 3, 33, 47, 50, 66, 100]) {
      for (const price of [1, 999, 1_000_001, 3_333_333]) {
        const t = artistTotals(artist(ratio, [price]));
        expect(t.galleryAmount + t.artistAmount).toBe(t.total);
      }
    }
  });

  it('비율 0/100 이면 한쪽이 전액', () => {
    expect(artistTotals(artist(0, [500])).artistAmount).toBe(500);
    expect(artistTotals(artist(100, [500])).galleryAmount).toBe(500);
  });
});

describe('initialOpenArtistIds', () => {
  const a = (id: number, status?: string) => ({ user: { id }, approval: status ? { status } : null });

  it('작가가 2명 이하면 모두 펼친다 (개인전에서 매번 한 번 더 누르게 하지 않는다)', () => {
    expect([...initialOpenArtistIds([a(1), a(2)])]).toEqual([1, 2]);
  });

  it('3명 이상이면 기본은 모두 접는다', () => {
    expect(initialOpenArtistIds([a(1), a(2), a(3)]).size).toBe(0);
  });

  it('문제를 제기한 작가는 3명 이상이어도 펼친다 (갤러리가 지금 볼 사람)', () => {
    const open = initialOpenArtistIds([a(1, 'APPROVED'), a(2, 'ISSUE'), a(3, 'PENDING'), a(4, 'ISSUE')]);
    expect([...open]).toEqual([2, 4]);
  });

  it('빈 목록도 안전', () => {
    expect(initialOpenArtistIds([]).size).toBe(0);
  });
});

/**
 * 저장 안 된 변경 감지.
 *
 * 이게 없어서 사고가 났다: 금액을 고치고 [이 작가에게 다시 확인 요청]을 눌렀더니
 * 저장이 안 된 채 요청만 나가 작가가 **옛 금액**을 다시 확인하게 됐고,
 * 목록을 다시 불러오면서 입력하던 값까지 사라졌다.
 */
describe('settlementFormSignature', () => {
  const base = () => [
    { user: { id: 2 }, galleryRatio: 30, works: [{ index: 0, sold: true, soldPrice: 1000, paymentMethod: 'CARD' }] },
    { user: { id: 1 }, galleryRatio: 40, works: [{ index: 1, sold: true, soldPrice: 2000, paymentMethod: 'CASH' }] },
  ];

  it('같은 내용이면 배열 순서가 달라도 같은 지문 (서버 응답 순서를 믿지 않는다)', () => {
    const a = settlementFormSignature(base());
    const b = settlementFormSignature([...base()].reverse());
    expect(a).toBe(b);
  });

  it('판매가가 바뀌면 달라진다', () => {
    const changed = base();
    changed[0]!.works[0]!.soldPrice = 9999;
    expect(settlementFormSignature(changed)).not.toBe(settlementFormSignature(base()));
  });

  it('비율이 바뀌면 달라진다', () => {
    const changed = base();
    changed[0]!.galleryRatio = 50;
    expect(settlementFormSignature(changed)).not.toBe(settlementFormSignature(base()));
  });

  it('결제수단이 바뀌면 달라진다', () => {
    const changed = base();
    changed[0]!.works[0]!.paymentMethod = 'CASH';
    expect(settlementFormSignature(changed)).not.toBe(settlementFormSignature(base()));
  });

  it('판매 체크를 풀면 달라진다', () => {
    const changed = base();
    changed[0]!.works[0]!.sold = false;
    expect(settlementFormSignature(changed)).not.toBe(settlementFormSignature(base()));
  });

  it('판매 안 한 작품의 금액은 지문에 영향이 없다 (체크 안 한 칸의 잔값으로 헛 경고 금지)', () => {
    const withGhost = base();
    withGhost[0]!.works.push({ index: 5, sold: false, soldPrice: 123456, paymentMethod: 'CARD' });
    expect(settlementFormSignature(withGhost)).toBe(settlementFormSignature(base()));
  });
});
