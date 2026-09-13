/**
 * 초성 색인 (`lib/hangulIndex.ts`) — [작가] 탭 왼쪽의 ㄱ/ㄴ/ㄷ 펼쳐보기가 쓰는 규칙
 *
 * 여기서 못박는 것:
 *   1. **쌍자음은 홑자음 칸에** — 색인은 14칸이다. 'ㄲ' 칸을 따로 두면 '까치'를 찾으려고
 *      'ㄱ' 을 폈다가 없어서 되돌아 나와야 한다.
 *   2. **칸 순서 = 화면 순서** — 한글 14칸 → `A–Z` → `#`.
 *   3. **정렬과 칸이 어긋나지 않는다** — 어긋나면 'ㄱ' 칸 안에 'ㄴ' 이름이 섞인다.
 */
import { describe, it, expect } from 'vitest';
import { initialOf, sortByInitialThenName, INITIAL_ORDER } from '../hangulIndex';

describe('initialOf — 이름이 들어갈 색인 칸', () => {
  it('완성형 한글의 초성을 뽑는다', () => {
    expect(initialOf('강민서')).toBe('ㄱ');
    expect(initialOf('나윤호')).toBe('ㄴ');
    expect(initialOf('류지안')).toBe('ㄹ');
    expect(initialOf('한서아')).toBe('ㅎ');
    // 초성 계산은 중성·종성과 무관해야 한다 (588 로 나누는 게 맞는지)
    expect(initialOf('힣')).toBe('ㅎ');
    expect(initialOf('가')).toBe('ㄱ');
  });

  it('★ 쌍자음은 홑자음 칸에 합친다 (사전에 ㄲ 칸은 없다)', () => {
    expect(initialOf('까치작가')).toBe('ㄱ');
    expect(initialOf('따스한작가')).toBe('ㄷ');
    expect(initialOf('빵집')).toBe('ㅂ');
    expect(initialOf('쌍문동')).toBe('ㅅ');
    expect(initialOf('짜장')).toBe('ㅈ');
    // 색인 칸은 14개여야 한다
    expect(INITIAL_ORDER.filter((k) => k.length === 1 && k >= 'ㄱ' && k <= 'ㅎ')).toHaveLength(14);
  });

  it('자음 한 글자로 시작하는 이름도 그 칸에 넣는다', () => {
    expect(initialOf('ㄱ작가')).toBe('ㄱ');   // 호환 자모 U+3131
    expect(initialOf('ㅎ님')).toBe('ㅎ');
    expect(initialOf('ᄀ작가')).toBe('ㄱ'); // 첫가끝 자모 — 눈으로는 구분이 안 된다
  });

  it('라틴 문자는 대소문자를 한 칸에 (칸이 갈리면 못 찾는다)', () => {
    expect(initialOf('Anna Kim')).toBe('A–Z');
    expect(initialOf('zoe')).toBe('A–Z');
  });

  it('숫자·기호·모음·한자는 # 칸으로', () => {
    expect(initialOf('12번방')).toBe('#');
    expect(initialOf('_언더바')).toBe('#');
    expect(initialOf('ㅏ무개')).toBe('#'); // 모음은 색인 칸이 아니다
    expect(initialOf('金作家')).toBe('#');
  });

  it('빈 이름·공백만 있는 이름에도 죽지 않는다 (# 칸)', () => {
    expect(initialOf('')).toBe('#');
    expect(initialOf('   ')).toBe('#');
    expect(initialOf(undefined as unknown as string)).toBe('#');
  });

  it('앞뒤 공백은 무시한다 (" 강민서" 가 # 칸으로 새면 안 된다)', () => {
    expect(initialOf('  강민서 ')).toBe('ㄱ');
  });

  /** ⚠️ `name[0]` 으로 자르면 서로게이트 쌍이 반쪽만 잘려 깨진 코드포인트가 나온다 */
  it('★ 이모지로 시작해도 깨지지 않는다 (서로게이트 쌍)', () => {
    expect(initialOf('🎨작가')).toBe('#');
    expect(INITIAL_ORDER).toContain(initialOf('🎨작가'));
  });

  it('어떤 이름이든 반드시 색인 칸 안에 떨어진다', () => {
    for (const n of ['가', '힣', 'A', 'z', '1', '!', '', '  ', 'ㅏ', 'ㄳ', '🎨', 'ñ', 'あ']) {
      expect(INITIAL_ORDER, `"${n}" 이 목록에 없는 칸으로 갔다`).toContain(initialOf(n));
    }
  });
});

describe('sortByInitialThenName — 칸 순서 → 이름순', () => {
  const of = (...names: string[]) => names.map((name, i) => ({ id: i + 1, name }));

  it('★ 한글 → 영문 → 기타 순서다', () => {
    const out = sortByInitialThenName(of('12번방', 'Zoe', '한서아', 'Anna', '강민서'));
    expect(out.map((a) => a.name)).toEqual(['강민서', '한서아', 'Anna', 'Zoe', '12번방']);
  });

  it('★ 같은 칸 안에서는 가나다순', () => {
    const out = sortByInitialThenName(of('김하윤', '까치', '강민서', 'ㄱ작가'));
    // 쌍자음(까)은 홑자음 칸에 들어가되 **이름순에서는 뒤**다 — 국어사전 순서 그대로
    expect(out.map((a) => a.name)).toEqual(['ㄱ작가', '강민서', '김하윤', '까치']);
    expect(out.every((a) => a.initial === 'ㄱ')).toBe(true);
  });

  it('★ 같은 칸끼리 이어져 있다 (화면이 이어진 것끼리 묶는다)', () => {
    const out = sortByInitialThenName(of('한서아', '강민서', '나윤호', '김하윤', '홍지수'));
    const initials = out.map((a) => a.initial);
    const runs = initials.filter((v, i) => initials[i - 1] !== v);
    expect(runs).toEqual([...new Set(initials)]);
  });

  it('★ 동명이인은 id 로 가른다 (같은 요청에 목록이 흔들리면 안 된다)', () => {
    const a = sortByInitialThenName([{ id: 9, name: '김하윤' }, { id: 3, name: '김하윤' }]);
    const b = sortByInitialThenName([{ id: 3, name: '김하윤' }, { id: 9, name: '김하윤' }]);
    expect(a.map((x) => x.id)).toEqual([3, 9]);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it('원본 배열을 건드리지 않는다', () => {
    const input = of('한서아', '강민서');
    const before = input.map((a) => a.name);
    sortByInitialThenName(input);
    expect(input.map((a) => a.name)).toEqual(before);
  });

  it('다른 필드는 그대로 실어 나른다', () => {
    const out = sortByInitialThenName([{ id: 1, name: '강민서', avatar: null, workCount: 3 }]);
    expect(out[0]).toMatchObject({ id: 1, name: '강민서', workCount: 3, initial: 'ㄱ' });
  });
});
