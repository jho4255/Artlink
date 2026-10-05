import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  openArtLook, stageArtLookWorks, clearArtLookWorks, portfolioArtLookWorks, readArtLookMessage, readComposeImages,
  ARTLOOK_STORAGE_KEY, ARTLOOK_URL, ARTLOOK_EMBED_URL, COMPOSE_STATE_KEY, STORY_IMAGE_MAX, type ArtLookWork,
} from '../lib/artlook';
import { useAuthStore } from '../stores/authStore';

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
    const n = openArtLook([work({ title: '겨울 들판', artist: '유하람', kind: 'portfolio' })]);
    expect(n).toBe(1);
    expect(JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)).toEqual([
      { url: 'https://img/1.jpg', title: '겨울 들판', artist: '유하람', kind: 'portfolio' },
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

/**
 * `stageArtLookWorks` — 마이페이지 [ArtLook] 탭이 쓰는 경로(새 탭이 아니라 **같은 페이지 안 iframe**).
 *
 * ⚠️ ArtLook 은 뜰 때 localStorage 를 **한 번만** 읽는다.
 *    그래서 iframe 을 그리기 **전에** 올려야 하고, 이 함수는 창을 열지 않아야 한다
 *    (열어 버리면 탭 안에서 볼 화면이 새 창으로도 튀어나온다).
 */
describe('stageArtLookWorks — iframe 용 사전 적재', () => {
  let opened: string[];

  beforeEach(() => {
    localStorage.clear();
    opened = [];
    vi.spyOn(window, 'open').mockImplementation(((url: string) => { opened.push(url); return null; }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const work = (p: Partial<ArtLookWork> = {}): ArtLookWork => ({ url: 'https://img/1.jpg', ...p });

  it('★ 창을 열지 않고 작품만 올린다', () => {
    const n = stageArtLookWorks([work(), work({ url: 'https://img/2.jpg' })]);
    expect(n).toBe(2);
    expect(opened).toEqual([]);
    expect(JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)).toHaveLength(2);
  });

  it('이미지 없는 작품은 걸러낸다 (빈 액자 방지)', () => {
    expect(stageArtLookWorks([work(), work({ url: '' })])).toBe(1);
  });

  it('보여줄 게 없으면 0 — 화면이 대신 안내한다', () => {
    expect(stageArtLookWorks([])).toBe(0);
    expect(localStorage.getItem(ARTLOOK_STORAGE_KEY)).toBeNull();
  });

  it('다시 올리면 이전 작품이 남지 않는다', () => {
    stageArtLookWorks([work(), work({ url: 'https://img/2.jpg' })]);
    stageArtLookWorks([work({ url: 'https://img/3.jpg' })]);
    expect(JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)).toHaveLength(1);
  });

  it('저장이 막혀도(시크릿 모드) 예외로 죽지 않는다 — 여기서 던지면 탭이 통째로 안 뜬다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => stageArtLookWorks([work()])).not.toThrow();
  });

  it('★ openArtLook 은 같은 적재를 하고 창까지 연다 (두 경로가 어긋나지 않게)', () => {
    const n = openArtLook([work()]);
    expect(n).toBe(1);
    expect(opened).toEqual([ARTLOOK_URL]);
    expect(JSON.parse(localStorage.getItem(ARTLOOK_STORAGE_KEY)!)).toHaveLength(1);
  });
});

describe('ArtLook 주소', () => {
  it('정적 페이지라 index.html 을 명시한다 (SPA fallback 회피)', () => {
    expect(ARTLOOK_URL).toBe('/artlook/index.html');
  });

  it('★ 임베드 주소는 ?embed=1 — 바깥에 이미 제목이 있어 머리말이 겹친다', () => {
    expect(ARTLOOK_EMBED_URL).toBe(`${ARTLOOK_URL}?embed=1`);
  });
});

/* ───────────── 2026-10-04 개편 (CLAUDE.md 규칙 65) ───────────── */

describe('portfolioArtLookWorks — 포트폴리오 작품을 넘기는 모양', () => {
  const img = (p: Record<string, unknown>) => ({ id: 1, url: 'https://img.artlink.cc/artlink/1790961720359-257661690.jpg', title: null, sizeText: null, ...p }) as never;

  it('★ 목록 칸용 썸네일(t800)을 함께 넘긴다 — 예전엔 68px 칸에 원본(30점 23MB)을 받았다', () => {
    const [w] = portfolioArtLookWorks([img({})], '작가');
    expect(w.thumb).toBe('https://img.artlink.cc/artlink/t800/1790961720359-257661690.jpg');
    expect(w.url).toBe('https://img.artlink.cc/artlink/1790961720359-257661690.jpg');   // 미리보기·저장은 원본
    expect(w.id).toBe(1);
    expect(w.kind).toBe('portfolio');
  });

  it("제목이 비면 비워 둔다('무제' 로 채우지 않는다 — 정보를 안 넣은 작품이 넣은 것처럼 보인다)", () => {
    const [a, b] = portfolioArtLookWorks([img({ title: '  ' }), img({ id: 2, title: ' 봄 ', sizeText: ' 30 × 40 cm ' })], '작가');
    expect(a.title).toBeUndefined();
    expect(b.title).toBe('봄');
    expect(b.sizeText).toBe('30 × 40 cm');
  });

  it('주소 없는 작품은 넘기지 않는다', () => {
    expect(portfolioArtLookWorks([img({ url: '' })], '작가')).toEqual([]);
  });
});

describe('로그아웃하면 넘겨 둔 작품 목록을 지운다', () => {
  it('★ 같은 컴퓨터의 다음 사람에게 앞사람 작품이 뜨지 않는다', () => {
    localStorage.setItem(ARTLOOK_STORAGE_KEY, JSON.stringify([{ url: 'https://img/1.jpg' }]));
    useAuthStore.getState().logout();
    expect(localStorage.getItem(ARTLOOK_STORAGE_KEY)).toBeNull();
  });

  it('저장이 막혀도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearArtLookWorks()).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('readArtLookMessage — iframe 이 보낸 말', () => {
  it('[작품 올리기] · [크기 입력하기]', () => {
    expect(readArtLookMessage({ type: 'artlook:goto', to: 'upload' })).toEqual({ type: 'goto', to: 'upload' });
    expect(readArtLookMessage({ type: 'artlook:goto', to: 'size', id: 7 })).toEqual({ type: 'goto', to: 'size', id: 7 });
  });

  it('모양이 틀리면 버린다 — 이상한 번호·모르는 곳·모르는 종류', () => {
    for (const d of [null, 'x', {}, { type: 'artlook:goto', to: 'size' }, { type: 'artlook:goto', to: 'size', id: -1 },
      { type: 'artlook:goto', to: 'size', id: 1.5 }, { type: 'artlook:goto', to: '/admin' }, { type: 'other' }]) {
      expect(readArtLookMessage(d), JSON.stringify(d)).toBeNull();
    }
  });

  it('[ArtStory에 올리기] — 이미지(jpeg/png)만, 서버 상한 안에서, 파일 이름은 다듬어서', () => {
    const blob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    expect(readArtLookMessage({ type: 'artlook:story', blob, name: '작가/작품:오크.jpg' })).toEqual({ type: 'story', blob, name: '작가작품오크.jpg' });
    expect(readArtLookMessage({ type: 'artlook:story', blob, name: 3 })).toMatchObject({ name: 'ArtLook.jpg' });
    expect(readArtLookMessage({ type: 'artlook:story', blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }), name: 'a' })).toBeNull();
    expect(readArtLookMessage({ type: 'artlook:story', blob: new Blob([], { type: 'image/jpeg' }), name: 'a' })).toBeNull();
    const huge = { size: STORY_IMAGE_MAX + 1, type: 'image/png' };
    Object.setPrototypeOf(huge, Blob.prototype);
    expect(readArtLookMessage({ type: 'artlook:story', blob: huge, name: 'a' })).toBeNull();
    expect(readArtLookMessage({ type: 'artlook:story', blob: 'data:image/png;base64,AAA', name: 'a' })).toBeNull();
  });
});

describe('readComposeImages — ArtStory 글쓰기 칸에 실을 사진', () => {
  it('우리 주소 모양의 문자열만, 10장까지', () => {
    const many = Array.from({ length: 12 }, (_, i) => `/uploads/${i}.jpg`);
    expect(readComposeImages({ [COMPOSE_STATE_KEY]: many })).toHaveLength(10);
    expect(readComposeImages({ [COMPOSE_STATE_KEY]: ['/uploads/a.jpg', 'https://img.artlink.cc/a.jpg', '//evil/x', 'javascript:alert(1)', 3, 'http://x/a.jpg'] }))
      .toEqual(['/uploads/a.jpg', 'https://img.artlink.cc/a.jpg']);
    expect(readComposeImages(null)).toEqual([]);
    expect(readComposeImages({ other: 1 })).toEqual([]);
  });
});

