/**
 * 저장 상태 3색 + 대표작 서수 변환 회귀 테스트.
 *
 * repOrdinal은 실제로 겪은 버그를 고정한다: 저장 시 목록을 {...a}로 복제해 보내는데
 * 참조 비교(===)로 대표작을 찾으면 항상 실패 → 저장할 때마다 대표작이 서버에서 지워졌다.
 */
import { describe, it, expect } from 'vitest';
import { computeSaveState, isBlankArtwork, repOrdinal } from '../lib/saveState';

const art = (title: string, extra: Record<string, unknown> = {}) =>
  ({ image: '', title, size: '', width: '', height: '', medium: '', year: '', price: '', ...extra }) as any;
const blank = () => art('');

describe('isBlankArtwork', () => {
  it('모든 칸이 비면 true, 하나라도 있으면 false', () => {
    expect(isBlankArtwork(blank())).toBe(true);
    expect(isBlankArtwork(art('제목'))).toBe(false);
    expect(isBlankArtwork(art('', { image: 'x.jpg' }))).toBe(false);
    expect(isBlankArtwork(undefined)).toBe(true);
  });
});

describe('computeSaveState', () => {
  it('저장본과 다르면 unsaved, 같으면 draft 플래그에 따라', () => {
    const a = art('a');
    expect(computeSaveState(a, art('b'))).toBe('unsaved');
    expect(computeSaveState(a, art('a'))).toBe('saved');
    expect(computeSaveState(a, art('a'), true)).toBe('draft');
  });
});

describe('repOrdinal', () => {
  it('복제된 목록을 보내도(참조 다름) 인덱스 기준으로 살아남는다', () => {
    const list = [art('A'), art('B'), art('C')];
    const sent = list.map(a => ({ ...a, draft: false })); // 저장 시 실제로 보내는 형태
    expect(repOrdinal(list, 2, sent.length)).toBe(2);
  });

  it('앞에 빈 칸이 있으면 그만큼 당겨진다', () => {
    const list = [blank(), art('A'), blank(), art('B')];
    // 전체 인덱스 3(B) → 빈 칸 2개 제외하면 보낼 목록에서 1
    expect(repOrdinal(list, 3, 2)).toBe(1);
  });

  it('대표작이 빈 칸이거나 범위 밖이면 null', () => {
    const list = [art('A'), blank()];
    expect(repOrdinal(list, 1, 1)).toBe(null);   // 빈 칸을 대표작으로
    expect(repOrdinal(list, 5, 1)).toBe(null);   // 없는 인덱스
    expect(repOrdinal(list, null, 1)).toBe(null);
    expect(repOrdinal(list, 0, 0)).toBe(null);   // 보낼 목록이 비어 있음
  });
});
