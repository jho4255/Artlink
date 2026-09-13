/**
 * 작가 목록 초성 묶기 (`lib/artistIndex.ts`) — [작가] 탭 왼쪽의 ㄱ/ㄴ/ㄷ 펼쳐보기
 *
 * ⚠️ **여기는 초성을 계산하지 않는다.** 판정은 서버(`backend/src/lib/hangulIndex.ts`)가 하고
 *    응답의 `initial` 로 내려온다 — 규칙이 둘이면 한쪽만 고치는 순간 칸 안에 엉뚱한 이름이 섞인다.
 *    이 파일이 지키는 건 **묶기**와 **처음에 펼쳐 둘 칸** 둘뿐이다.
 */
import { describe, it, expect } from 'vitest';
import { groupByInitial, initiallyExpanded, AUTO_EXPAND_MAX } from '@/lib/artistIndex';

const a = (id: number, name: string, initial?: string) => ({ id, name, initial });

describe('groupByInitial', () => {
  it('같은 칸끼리 묶는다', () => {
    const groups = groupByInitial([
      a(1, '강민서', 'ㄱ'), a(2, '김하윤', 'ㄱ'), a(3, '나윤호', 'ㄴ'), a(4, '한서아', 'ㅎ'),
    ]);
    expect(groups.map((g) => [g.initial, g.artists.map((x) => x.name)])).toEqual([
      ['ㄱ', ['강민서', '김하윤']],
      ['ㄴ', ['나윤호']],
      ['ㅎ', ['한서아']],
    ]);
  });

  it('★ 서버가 준 순서를 그대로 지킨다 (다시 정렬하지 않는다)', () => {
    // 서버가 칸 순서 → 이름순으로 이미 정렬해 준다. 브라우저 localeCompare 로 다시 정렬하면
    // 서버와 다른 답이 나올 수 있다.
    const groups = groupByInitial([a(1, '한서아', 'ㅎ'), a(2, '강민서', 'ㄱ')]);
    expect(groups.map((g) => g.initial)).toEqual(['ㅎ', 'ㄱ']);
  });

  it('★ 정렬이 흐트러져도 같은 칸이 두 번 나타나지 않는다', () => {
    // 이어진 것만 묶으면 여기서 'ㄱ' 칸이 두 개가 되어, 빈 칸을 펼치는 것처럼 보인다
    const groups = groupByInitial([a(1, '강민서', 'ㄱ'), a(2, '나윤호', 'ㄴ'), a(3, '김하윤', 'ㄱ')]);
    expect(groups.map((g) => g.initial)).toEqual(['ㄱ', 'ㄴ']);
    expect(groups[0].artists.map((x) => x.name)).toEqual(['강민서', '김하윤']);
  });

  it('★ initial 이 없으면 # 칸으로 — 이름이 통째로 사라지는 것보다 낫다', () => {
    const groups = groupByInitial([a(1, '누군가'), a(2, '강민서', 'ㄱ')]);
    expect(groups.flatMap((g) => g.artists).map((x) => x.name).sort()).toEqual(['강민서', '누군가']);
    expect(groups.find((g) => g.initial === '#')?.artists).toHaveLength(1);
  });

  it('아무도 없으면 빈 배열', () => {
    expect(groupByInitial([])).toEqual([]);
  });

  it('★ 한 명도 잃지 않는다', () => {
    const list = Array.from({ length: 50 }, (_, i) => a(i, `작가${i}`, 'ㅈ'));
    expect(groupByInitial(list).flatMap((g) => g.artists)).toHaveLength(50);
  });
});

describe('initiallyExpanded — 처음에 펼쳐 둘 칸', () => {
  const groups = groupByInitial([a(1, '강민서', 'ㄱ'), a(2, '나윤호', 'ㄴ'), a(3, '한서아', 'ㅎ')]);

  it('★ 작가가 적으면 전부 펼친 채로 시작한다 (이름 보려고 또 누르게 하지 않는다)', () => {
    expect([...initiallyExpanded(groups, 3)]).toEqual(['ㄱ', 'ㄴ', 'ㅎ']);
    expect(initiallyExpanded(groups, AUTO_EXPAND_MAX).size).toBe(3);
  });

  it('★ 작가가 많으면 전부 접은 채로 시작한다 (왼쪽 칸이 수천 px 이 되면 작품 격자가 밀린다)', () => {
    expect(initiallyExpanded(groups, AUTO_EXPAND_MAX + 1).size).toBe(0);
  });
});
