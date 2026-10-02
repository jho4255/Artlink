import { describe, it, expect } from 'vitest';
import { computeCompleteness, MIN_WORKS } from '@/lib/completeness';

const work = (over: Partial<{ title: string; medium: string; sizeText: string; year: string; showInExplore: boolean }> = {}) =>
  ({ title: null, medium: null, sizeText: null, year: null, showInExplore: false, ...over });

describe('computeCompleteness — 작가 홈페이지 완성도', () => {
  it('빈 포트폴리오는 0%', () => {
    const c = computeCompleteness({ images: [], statement: '', biography: '' });
    expect(c.percent).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.items.map((i) => i.done)).toEqual([false, false, false, false, false]);
    expect(c.items[0]!.progress).toBe(`0/${MIN_WORKS}`);
  });

  it('작품 수·캡션·공개는 진행률을 보여준다', () => {
    const c = computeCompleteness({
      images: [work({ title: '새벽', showInExplore: true }), work(), work(), work()],
      statement: '노트', biography: '약력',
    });
    const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
    expect(by.works!.done).toBe(true);
    expect(by.captions!).toMatchObject({ done: false, progress: '1/4' });
    expect(by.public!).toMatchObject({ done: true, progress: '1/4' });
    expect(by.statement!.done).toBe(true);
    expect(by.biography!.done).toBe(true);
    expect(c.done).toBe(4);
    expect(c.percent).toBe(80);
  });

  it('전부 채우면 complete', () => {
    const imgs = Array.from({ length: 3 }, () => work({ title: 't', medium: 'm', sizeText: 's', year: '2025', showInExplore: true }));
    const c = computeCompleteness({ images: imgs, statement: 's', biography: 'b' });
    expect(c.complete).toBe(true);
    expect(c.percent).toBe(100);
  });

  it('약력 글이 없어도 항목별 경력이 있으면 약력은 쓴 것 — 홈페이지 [약력] 탭이 그렇게 생긴다', () => {
    const by = (career: Parameters<typeof computeCompleteness>[0]['career']) =>
      computeCompleteness({ images: [], statement: '', biography: '', career }).items.find((i) => i.key === 'biography')!.done;
    expect(by({ solo: [{ year: '', content: '2025 개인전 〈빛〉' }], group: [], artFair: [] })).toBe(true);
    expect(by({ solo: [], group: [], artFair: [], education: [], award: [] })).toBe(false);
    expect(by(null)).toBe(false);
  });

  it('★ 줄을 누르면 그걸 채우는 묶음으로 간다 — 전부 같은 주소로 떨어지지 않는다', () => {
    const c = computeCompleteness({ images: [work(), work()], statement: '', biography: '' });
    const href = Object.fromEntries(c.items.map((i) => [i.key, i.href]));
    expect(href.works).toBe('/mypage?tab=homepage-edit&section=works');
    // 정보 없는 첫 작품의 입력 창을 바로 연다
    expect(href.captions).toBe('/mypage?tab=homepage-edit&section=works&do=info');
    expect(href.statement).toBe('/mypage?tab=homepage-edit&section=intro&focus=statement');
    expect(href.biography).toBe('/mypage?tab=homepage-edit&section=cv&focus=biography');
    expect(href.public).toBe('/mypage?tab=homepage-edit&section=works');
    // 작품이 0점이면 열 창이 없다
    expect(computeCompleteness({ images: [] }).items.find((i) => i.key === 'captions')!.href).toBe('/mypage?tab=homepage-edit&section=works');
  });

  it("'공개'라고 부르지 않는다 — 작품은 올리는 순간 내 홈페이지에 보인다", () => {
    const labels = computeCompleteness({ images: [] }).items.map((i) => i.label).join(' ');
    expect(labels).toContain('[작가] 탭에도 소개하기');
    expect(labels).not.toContain('공개');
  });

  it('공백만 있는 글은 안 쓴 것', () => {
    const c = computeCompleteness({ images: [], statement: '   ', biography: '\n' });
    expect(c.items.find((i) => i.key === 'statement')!.done).toBe(false);
    expect(c.items.find((i) => i.key === 'biography')!.done).toBe(false);
  });
});
