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

  it('공백만 있는 글은 안 쓴 것', () => {
    const c = computeCompleteness({ images: [], statement: '   ', biography: '\n' });
    expect(c.items.find((i) => i.key === 'statement')!.done).toBe(false);
    expect(c.items.find((i) => i.key === 'biography')!.done).toBe(false);
  });
});
