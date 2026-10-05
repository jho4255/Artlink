/**
 * 작가 홈페이지 편집 화면 — 묶음·들어오는 길·다음 작품 (2026-10-02)
 *
 * 화면은 jsdom 에서 굳이 그리지 않는다(레이아웃을 못 잰다). 판정을 순수 함수로 빼 두고 여기서 본다.
 * 실제로 눌러서 무슨 일이 나는지는 e2e `62-homepage-editor.spec.ts`, 화면 안에 들어오는지는 `scratchpad/homepage-edit/walk.js`.
 */
import { describe, it, expect } from 'vitest';
import {
  entryInfoImageId, EDIT_SECTIONS, editHref, editSectionForTab, nextUncaptionedId, previewTabFor, recentValues, resolveEditEntry, sectionDone, tileLabel, uncaptionedCount,
} from '@/lib/homepageEdit';

const w = (id: number, over: Partial<{ title: string; medium: string; sizeText: string; year: string }> = {}) =>
  ({ id, title: null, medium: null, sizeText: null, year: null, ...over });
const searchOf = (href: string) => href.slice(href.indexOf('?'));

describe('묶음 — 작품이 첫 화면이다', () => {
  it('순서는 작품 · 소개 · 약력 · 파일 · 꾸미기', () => {
    expect(EDIT_SECTIONS.map((s) => s.label)).toEqual(['작품', '소개', '약력', '파일', '꾸미기']);
    expect(EDIT_SECTIONS[0]!.id).toBe('works');
  });

  it('주소에 묶음이 없거나 모르는 값이면 작품으로 — 빈 화면을 만들지 않는다', () => {
    expect(resolveEditEntry('?tab=homepage-edit')).toEqual({ section: 'works', focus: null, info: false, work: null });
    expect(resolveEditEntry('?tab=homepage-edit&section=nope').section).toBe('works');
    expect(resolveEditEntry('').section).toBe('works');
  });

  it('editHref 로 만든 주소는 resolveEditEntry 로 그대로 읽힌다', () => {
    for (const s of EDIT_SECTIONS) expect(resolveEditEntry(searchOf(editHref(s.id))).section).toBe(s.id);
    expect(editHref()).toBe('/mypage?tab=homepage-edit');
  });

  it('칸을 지정하면 묶음은 칸에서 정해진다(작가노트 → 소개, 약력 → 약력, 주소 → 꾸미기)', () => {
    expect(resolveEditEntry(searchOf(editHref('works', { focus: 'statement' })))).toEqual({ section: 'intro', focus: 'statement', info: false, work: null });
    expect(resolveEditEntry(searchOf(editHref(undefined, { focus: 'biography' })))).toEqual({ section: 'cv', focus: 'biography', info: false, work: null });
    expect(resolveEditEntry(searchOf(editHref(undefined, { focus: 'handle' })))).toEqual({ section: 'style', focus: 'handle', info: false, work: null });
    // 모르는 칸은 무시
    expect(resolveEditEntry('?tab=homepage-edit&section=cv&focus=zzz')).toEqual({ section: 'cv', focus: null, info: false, work: null });
    // 객체에 원래 있는 이름(toString 등)을 칸으로 착각하지 않는다
    expect(resolveEditEntry('?tab=homepage-edit&focus=toString').focus).toBeNull();
  });

  it('작품 정보 창 바로 열기는 작품 묶음에서만', () => {
    expect(resolveEditEntry(searchOf(editHref('works', { info: true }))).info).toBe(true);
    expect(editHref('intro', { info: true })).not.toContain('do=info');
    expect(resolveEditEntry('?tab=homepage-edit&section=cv&do=info').info).toBe(false);
  });

  it('그 작품의 정보 창 — ArtLook [크기 입력하기] (2026-10-04)', () => {
    const href = editHref('works', { info: true, work: 42 });
    expect(href).toBe('/mypage?tab=homepage-edit&section=works&do=info&work=42');
    expect(resolveEditEntry(searchOf(href))).toEqual({ section: 'works', focus: null, info: true, work: 42 });
    // info 없이 work 만 붙지 않는다 · 이상한 번호는 버린다
    expect(editHref('works', { work: 42 })).not.toContain('work=');
    expect(resolveEditEntry('?tab=homepage-edit&do=info&work=-3').work).toBeNull();
    expect(resolveEditEntry('?tab=homepage-edit&do=info&work=1.5').work).toBeNull();
    expect(resolveEditEntry('?tab=homepage-edit&work=7').work).toBeNull();   // 창을 열 때만 뜻이 있다
  });

  it('들어오며 열 작품 — 고른 작품이 있으면 그것, 지워졌으면 정보 없는 첫 작품', () => {
    const imgs = [
      { id: 1, title: '봄', medium: null, sizeText: null, year: null },
      { id: 2, title: null, medium: null, sizeText: null, year: null },
      { id: 3, title: '여름', medium: '유채', sizeText: '30×30', year: '2024' },
    ] as never[];
    expect(entryInfoImageId(imgs, 3)).toBe(3);      // 정보가 다 있어도 고른 작품이면 그것
    expect(entryInfoImageId(imgs, 99)).toBe(2);     // 없는 작품 → 정보 없는 첫 작품
    expect(entryInfoImageId(imgs, null)).toBe(2);
  });
});

describe('묶음 탭의 ✓', () => {
  it('채운 묶음만 — 꾸미기는 선택이라 ✓ 가 없다', () => {
    expect(sectionDone({ workCount: 0 })).toEqual({ works: false, intro: false, cv: false, file: false, style: false });
    expect(sectionDone({ workCount: 2, statement: '노트', biography: ' ', portfolioFileUrl: '/uploads/a.pdf' }))
      .toEqual({ works: true, intro: true, cv: false, file: true, style: false });
  });

  it('[작품]은 정보 없는 작품이 남아 있으면 ✓ 가 아니다 — 바로 아래 할 일 줄과 다른 말을 하지 않는다', () => {
    expect(sectionDone({ workCount: 4, uncaptioned: 2 }).works).toBe(false);
    expect(sectionDone({ workCount: 4, uncaptioned: 0 }).works).toBe(true);
  });

  it('약력은 글이 없어도 항목별 경력이 있으면 채운 것 — 홈페이지 [약력] 탭이 그렇게 생긴다', () => {
    expect(sectionDone({ workCount: 0, career: { solo: [{ year: '', content: '2025 개인전' }], group: [], artFair: [] } }).cv).toBe(true);
    expect(sectionDone({ workCount: 0, career: { solo: [], group: [], artFair: [] } }).cv).toBe(false);
  });
});

describe('공개 홈페이지의 [수정] 은 보던 탭의 묶음으로 연다', () => {
  it('작가노트 → 소개 · 약력 → 약력 · 포트폴리오 → 파일 · 그 밖은 작품', () => {
    expect(editSectionForTab('note')).toBe('intro');
    expect(editSectionForTab('cv')).toBe('cv');
    expect(editSectionForTab('file')).toBe('file');
    for (const t of [null, undefined, '', 'works', 'guestbook', 'zzz']) expect(editSectionForTab(t)).toBe('works');
  });

  it('저장하고 돌아간 탭에서 다시 [수정] 을 누르면 같은 묶음이다(왕복)', () => {
    for (const s of ['works', 'intro', 'cv', 'file'] as const) expect(editSectionForTab(previewTabFor(s))).toBe(s);
  });
});

describe('미리보기가 따라 열 탭', () => {
  it('묶음마다 그 내용이 보이는 홈페이지 탭', () => {
    expect(previewTabFor('works')).toBe('works');
    expect(previewTabFor('intro')).toBe('note');
    expect(previewTabFor('intro', 'statement')).toBe('note');
    expect(previewTabFor('intro', 'series')).toBe('works');
    expect(previewTabFor('cv')).toBe('cv');
    expect(previewTabFor('file')).toBe('file');
    expect(previewTabFor('style')).toBe('works');
  });

  it('한 줄 소개·주소는 탭이 아니라 이름 줄에 있다 — 지금 탭을 그대로 둔다', () => {
    expect(previewTabFor('intro', 'tagline')).toBeNull();
    expect(previewTabFor('style', 'handle')).toBeNull();
  });
});

describe('[저장하고 다음 작품]', () => {
  const images = [w(1, { title: '가' }), w(2), w(3, { year: '2025' }), w(4), w(5)];

  it('정보 없는 작품을 순서대로 — 방금 저장한 작품은 뺀다', () => {
    expect(uncaptionedCount(images)).toBe(3);
    expect(nextUncaptionedId(images, null)).toBe(2);
    expect(nextUncaptionedId(images, 2)).toBe(4);
    expect(nextUncaptionedId(images, 4)).toBe(5);
  });

  it('끝에 닿으면 앞에서 남은 것으로 돌아온다', () => {
    expect(nextUncaptionedId(images, 5)).toBe(2);
    // 정보가 있는 작품에서 시작해도 그 뒤의 빈 작품부터
    expect(nextUncaptionedId(images, 3)).toBe(4);
  });

  it('남은 게 없으면 null — 그때 창은 [저장]만 보여 준다', () => {
    expect(nextUncaptionedId([w(1, { title: '가' }), w(2)], 2)).toBeNull();
    expect(nextUncaptionedId([w(1)], 1)).toBeNull();
    expect(nextUncaptionedId([], null)).toBeNull();
  });
});

describe('이미 쓴 재료·연도', () => {
  const images = [
    { id: 1, medium: 'Oil on canvas', year: '2024' },
    { id: 2, medium: ' Acrylic on canvas ', year: '2025' },
    { id: 3, medium: 'Oil on canvas', year: '2025' },
    { id: 4, medium: null, year: '' },
    { id: 5, medium: '장지에 채색', year: '2023' },
  ];

  it('많이 쓴 순, 같으면 뒤에 올린 작품의 값이 먼저 — 앞뒤 공백은 떼고 빈 값은 뺀다', () => {
    expect(recentValues(images, 'medium')).toEqual(['Oil on canvas', '장지에 채색', 'Acrylic on canvas']);
    expect(recentValues(images, 'year', 2)).toEqual(['2025', '2023']);
  });

  it('지금 고치는 작품의 값은 뺀다(자기 값을 자기에게 권하지 않는다)', () => {
    expect(recentValues(images, 'medium', 3, 5)).toEqual(['Oil on canvas', 'Acrylic on canvas']);
  });

  it('쓴 게 없으면 빈 배열', () => {
    expect(recentValues([{ id: 1, medium: null, year: null }], 'medium')).toEqual([]);
  });
});

describe('작품 타일 아래 한 줄', () => {
  it('홈페이지 캡션의 첫 줄 — 작품명, 연도', () => {
    expect(tileLabel({ title: '머무는 빛', year: '2025', medium: 'Oil on canvas', sizeText: '72.7×60.6 cm' })).toBe('머무는 빛, 2025');
    expect(tileLabel({ title: '', year: '2024', medium: null, sizeText: null })).toBe('2024');
  });

  it('작품명·연도가 없으면 재료, 그것도 없으면 크기', () => {
    expect(tileLabel({ title: null, year: null, medium: 'Oil on canvas', sizeText: '72.7×60.6 cm' })).toBe('Oil on canvas');
    expect(tileLabel({ title: null, year: null, medium: ' ', sizeText: '72.7×60.6 cm' })).toBe('72.7×60.6 cm');
  });

  it("★ 정보가 하나도 없으면 null — '무제' 로 채우지 않는다(넣은 것처럼 보인다)", () => {
    expect(tileLabel({ title: null, year: null, medium: null, sizeText: null })).toBeNull();
    expect(tileLabel({ title: '  ', year: '', medium: '', sizeText: '' })).toBeNull();
  });
});
