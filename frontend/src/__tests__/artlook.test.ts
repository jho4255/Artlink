import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { openArtLook, ARTLOOK_STORAGE_KEY, type ArtLookWork } from '../lib/artlook';

/**
 * ArtLook 핸드오프 — 마이페이지(포트폴리오)와 운영페이지(판매작) 두 곳에서 같은 함수를 쓴다.
 * 넘기는 수단이 localStorage 라서, 저장이 막히는 환경(시크릿 모드)에서도 탭은 열려야 한다.
 */
describe('openArtLook', () => {
  let opened: string[];

  beforeEach(() => {
    localStorage.clear();
    opened = [];
    vi.spyOn(window, 'open').mockImplementation(((url: string) => { opened.push(url); return null; }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const work = (p: Partial<ArtLookWork> = {}): ArtLookWork => ({ url: 'https://img/1.jpg', ...p });

  it('작품을 localStorage 로 넘기고 새 탭을 연다', () => {
    const n = openArtLook([work({ title: '겨울 들판', artist: '마은영', kind: 'portfolio' })]);
    expect(n).toBe(1);
    expect(JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)).toEqual([
      { url: 'https://img/1.jpg', title: '겨울 들판', artist: '마은영', kind: 'portfolio' },
    ]);
    expect(opened).toEqual(['/artlook/index.html']);
  });

  it('index.html 을 명시해서 연다 — 정적 페이지라 SPA fallback 에 먹히면 안 된다', () => {
    openArtLook([work()]);
    expect(opened[0]).toBe('/artlook/index.html');
    expect(opened[0].endsWith('/artlook/')).toBe(false);
  });

  it('이미지 없는 작품은 걸러낸다 — 빈 칸이 액자에 걸리면 안 된다', () => {
    const n = openArtLook([work({ title: 'A' }), { url: '', title: 'B' }, work({ title: 'C' })]);
    expect(n).toBe(2);
    const sent = JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!);
    expect(sent.map((w: ArtLookWork) => w.title)).toEqual(['A', 'C']);
  });

  it('넘길 작품이 하나도 없으면 탭을 열지 않고 0 을 준다 — 호출부가 안내를 띄운다', () => {
    expect(openArtLook([])).toBe(0);
    expect(openArtLook([{ url: '' }])).toBe(0);
    expect(opened).toEqual([]);
    expect(localStorage.getItem(ARTLOOK_STORAGE_KEY)).toBeNull();
  });

  it('저장이 막혀도(시크릿 모드) 탭은 연다 — 여기서 예외가 나면 버튼이 죽는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(() => openArtLook([work()])).not.toThrow();
    expect(opened).toEqual(['/artlook/index.html']);
  });

  it('두 진입점을 kind 로 구분한다 — 결과물 파일명이 달라진다', () => {
    openArtLook([work({ kind: 'sold', exhibition: '봄 공모' })]);
    const sold = JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)[0];
    expect(sold.kind).toBe('sold');
    expect(sold.exhibition).toBe('봄 공모');

    openArtLook([work({ kind: 'portfolio' })]);
    const pf = JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)[0];
    expect(pf.kind).toBe('portfolio');
    expect(pf.exhibition).toBeUndefined();
  });

  it('다시 열면 이전 작품이 남지 않는다', () => {
    openArtLook([work({ title: '옛것' }), work({ title: '옛것2' })]);
    openArtLook([work({ title: '새것' })]);
    const sent = JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('새것');
  });
});
