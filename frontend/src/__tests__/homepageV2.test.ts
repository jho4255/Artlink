/**
 * 작가 홈페이지 v2 순수 함수 — 정렬 격자 · 미술관식 캡션 · 주소 규칙 · 테마 (2026-09-16)
 */
import { describe, it, expect } from 'vitest';
import { justifyRows } from '@/lib/justifiedRows';
import { museumCaption } from '@/lib/artwork';
import { normalizeHandle, validateHandle, suggestHandle, artistPath, artistUrl } from '@/lib/handle';
import { resolveHomepageTheme, themeKeysFrom, pickHeroImage, changedThemeKeys, themeSavePatch, keepWebOnlyKeys } from '@/lib/homepageTheme';
import { normalizePdfDesign } from '@/lib/portfolioFormats';

const W = 1000, GAP = 20, H = 300;
const sumWidth = (row: { width: number }[]) => row.reduce((s, c) => s + c.width, 0) + GAP * (row.length - 1);

describe('justifyRows — 정렬 격자', () => {
  it('꽉 찬 행은 폭에 정확히 맞고 한 행의 높이는 같다', () => {
    const items = [1.5, 0.8, 1, 1.2, 0.7, 1.3, 1].map((aspect, i) => ({ item: i, aspect }));
    const rows = justifyRows(items, { containerWidth: W, targetHeight: H, gap: GAP });
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(0, -1)) {
      expect(Math.abs(sumWidth(row) - W)).toBeLessThan(0.5);
      const hs = new Set(row.map((c) => Math.round(c.height * 100)));
      expect(hs.size).toBe(1);
      expect(row[0]!.height).toBeLessThanOrEqual(H + 0.5);
    }
  });

  it('마지막 행은 늘리지 않는다 — 한 점만 남아도 혼자 커지지 않는다', () => {
    const items = [1, 1, 1, 1].map((aspect, i) => ({ item: i, aspect }));
    const rows = justifyRows(items, { containerWidth: W, targetHeight: H, gap: GAP });
    const last = rows[rows.length - 1]!;
    expect(last[0]!.height).toBeLessThanOrEqual(H + 0.5);
    if (last.length === 1) expect(last[0]!.width).toBeLessThanOrEqual(H + 0.5);
  });

  it('파노라마 한 점은 행을 혼자 차지하고 폭에 맞춰 낮아진다', () => {
    const rows = justifyRows([{ item: 'pano', aspect: 4 }, { item: 'a', aspect: 1 }], { containerWidth: W, targetHeight: H, gap: GAP });
    expect(rows[0]!.length).toBe(1);
    expect(rows[0]![0]!.width).toBeCloseTo(W, 0);
    expect(rows[0]![0]!.height).toBeCloseTo(W / 4, 0);
  });

  it('비율을 모르면 정사각으로 본다 · 이상한 값은 상한·하한으로 묶는다', () => {
    const rows = justifyRows([{ item: 1 }, { item: 2, aspect: 0 }, { item: 3, aspect: 99 }], { containerWidth: W, targetHeight: H, gap: GAP });
    const cells = rows.flat();
    expect(cells.find((c) => c.item === 1)!.aspect).toBe(1);
    expect(cells.find((c) => c.item === 2)!.aspect).toBe(1);
    expect(cells.find((c) => c.item === 3)!.aspect).toBe(6);
  });

  it('maxPerRow — 모바일은 한 행에 둘까지', () => {
    const items = [0.7, 0.7, 0.7, 0.7, 0.7].map((aspect, i) => ({ item: i, aspect }));
    const rows = justifyRows(items, { containerWidth: 360, targetHeight: 200, gap: 12, maxPerRow: 2 });
    expect(rows.every((r) => r.length <= 2)).toBe(true);
  });

  it('빈 입력·폭 0 은 빈 결과', () => {
    expect(justifyRows([], { containerWidth: W, targetHeight: H, gap: GAP })).toEqual([]);
    expect(justifyRows([{ item: 1, aspect: 1 }], { containerWidth: 0, targetHeight: H, gap: GAP })).toEqual([]);
  });
});

describe('museumCaption — 작품명, 연도 / 재료 / 크기', () => {
  it('전부 있으면 세 줄', () => {
    expect(museumCaption({ title: '새벽의 창', year: '2025', medium: '캔버스에 유채', sizeText: '72.7×90.9 cm' }))
      .toEqual({ head: '새벽의 창, 2025', medium: '캔버스에 유채', size: '72.7×90.9 cm' });
  });
  it('제목이 없으면 연도만, 있는 것만 조립', () => {
    expect(museumCaption({ title: '', year: '2024', medium: '', sizeText: '30×30 cm' })).toEqual({ head: '2024', medium: '', size: '30×30 cm' });
    expect(museumCaption({ title: '무제', year: null, medium: null, sizeText: null })).toEqual({ head: '무제', medium: '', size: '' });
  });
  it('전부 비면 null — 캡션 자리를 아예 안 그린다', () => {
    expect(museumCaption({ title: ' ', year: null, medium: undefined, sizeText: '' })).toBeNull();
  });
});

describe('handle — 화면 규칙은 서버와 같다', () => {
  it('정리·검증', () => {
    expect(normalizeHandle(' @Kiiryang ')).toBe('kiiryang');
    expect(validateHandle('kiiryang')).toBeNull();
    expect(validateHandle('ab')).toMatch(/3~30/);
    expect(validateHandle('한글아이디')).toMatch(/영문/);
    expect(validateHandle('.a.b')).toMatch(/마침표/);
    expect(validateHandle('admin')).toMatch(/쓸 수 없는/);
  });
  it('인스타 아이디 제안', () => {
    expect(suggestHandle('https://www.instagram.com/Eunyeongma_Artist/')).toBe('eunyeongma_artist');
    expect(suggestHandle('https://instagram.com/ab')).toBeNull();
    expect(suggestHandle(null)).toBeNull();
  });
  it('주소 — 핸들이 있으면 /@handle, 없으면 숫자', () => {
    expect(artistPath({ id: 7, handle: 'kiiryang' })).toBe('/@kiiryang');
    expect(artistPath({ id: 7, handle: null })).toBe('/portfolio/7');
    expect(artistUrl({ id: 7, handle: 'kiiryang' }, 42, 'https://artlink.cc')).toBe('https://artlink.cc/@kiiryang?work=42');
    expect(artistUrl({ id: 7 }, null, 'https://artlink.cc')).toBe('https://artlink.cc/portfolio/7');
  });
});

describe('homepageTheme — designConfig 를 웹 테마로', () => {
  it('아무것도 없으면 사이트 기본 톤(흰·검정·강조 빨강·고딕)', () => {
    const t = resolveHomepageTheme(null);
    expect(t.isDefault).toBe(true);
    expect(t.bg).toBe('#FFFFFF');
    expect(t.accent.toLowerCase()).toBe('#c4302b');
    expect(t.dark).toBe(false);
    expect(t.serif).toBe(false);
  });
  it('직접 고른 뒤(webTheme)에는 PDF 디자인과 같은 키를 쓴다 · 어두운 배경 판정 · mono 강조는 글자색', () => {
    const t = resolveHomepageTheme({ bg: 'ink', ink: 'cream', accent: 'mono', font: 'noto', webTheme: true });
    expect(t.isDefault).toBe(false);
    expect(t.dark).toBe(true);
    expect(t.accent).toBe(t.ink);
    expect(t.serif).toBe(true);
    expect(t.titleFont).toMatch(/Noto Serif KR/);
  });
  it('모르는 키는 기본으로 · 대표작 id 검증', () => {
    expect(themeKeysFrom({ bg: 'neon', ink: 42, font: 'comic', heroImageId: -1 })).toEqual({ bg: 'white', ink: 'black', accent: 'red', font: 'gothic', heroImageId: null });
    expect(themeKeysFrom({ heroImageId: 12 }).heroImageId).toBe(12);
  });
  // ── 2026-09-17 배포 전 점검에서 나온 셋 ──
  // ① 이 기능 전에 PDF 제작 화면을 만진 작가는 그때 값이 designConfig 에 자동 저장돼 있다(글꼴은 안 골라도 '명조').
  //    그대로 웹에 입히면 본인이 고른 적 없는데 공개 홈페이지가 바뀐다 → 직접 고른 뒤(webTheme)부터만 적용.
  it('★ PDF 용으로만 저장된 디자인은 웹에 입히지 않는다 — 표식이 없으면 사이트 기본 톤', () => {
    const legacy = { bg: 'ink', ink: 'cream', accent: 'gold', font: 'noto', page: 'a4-portrait', coverLayout: 'fullTint' };
    const t = resolveHomepageTheme(legacy);
    expect(t.isDefault).toBe(true);
    expect(t.bg).toBe('#FFFFFF');
    expect(t.serif).toBe(false);
    // 대표작은 웹 전용 키라 표식과 무관하다
    expect(themeKeysFrom({ ...legacy, heroImageId: 5 }).heroImageId).toBe(5);
  });

  // ② 홈페이지를 저장할 때마다(스타일을 안 건드려도) 웹 기본 키 전체를 써 넣어 PDF 가 조용히 바뀌었다
  //    (자동 편집 꺼짐 · 명조→고딕 · 무채→빨강).
  it('★ 스타일을 안 건드렸으면 designConfig 를 보내지 않는다 — PDF 기본(명조·무채·자동 편집)을 덮지 않는다', () => {
    expect(themeSavePatch(null, themeKeysFrom(null))).toBeNull();
    const legacy = { bg: 'ink', ink: 'cream', font: 'noto' };
    expect(themeSavePatch(legacy, themeKeysFrom(legacy))).toBeNull();
    const pdf = normalizePdfDesign(null);
    expect([pdf.auto, pdf.font, pdf.accent]).toEqual([true, 'myeongjo', 'mono']);
  });
  it('★ 대표작만 바꾸면 그 키만 — 표식도 색도 건드리지 않는다', () => {
    const saved = themeKeysFrom(null);
    expect(themeSavePatch(null, { ...saved, heroImageId: 7 })).toEqual({ heroImageId: 7 });
  });
  it('★ 처음 고를 땐 화면에서 본 네 값을 전부 쓰고 표식을 켠다 — 남아 있던 PDF 값이 섞이지 않게', () => {
    const legacy = { bg: 'ink', ink: 'cream', accent: 'gold', font: 'noto' };      // PDF 용 어두운 디자인
    const picked = { ...themeKeysFrom(legacy), bg: 'ivory' };                      // 웹에서 배경만 아이보리로
    const patch = themeSavePatch(legacy, picked)!;
    expect(patch).toEqual({ bg: 'ivory', ink: 'black', accent: 'red', font: 'gothic', webTheme: true });
    // 저장 결과를 다시 읽으면 미리보기에서 본 그대로다(크림색 글자가 아이보리 배경에 얹히지 않는다)
    const t = resolveHomepageTheme({ ...legacy, ...patch });
    expect(t.keys).toMatchObject({ bg: 'ivory', ink: 'black', accent: 'red', font: 'gothic' });
  });
  it('★ 이미 고른 적이 있으면 바뀐 키만', () => {
    const saved = { bg: 'ivory', ink: 'black', accent: 'red', font: 'gothic', webTheme: true };
    expect(themeSavePatch(saved, { ...themeKeysFrom(saved), accent: 'blue' })).toEqual({ accent: 'blue' });
    expect(changedThemeKeys(themeKeysFrom(saved), themeKeysFrom(saved))).toEqual({});
  });
  it('★ 웹에서 배경을 골라도 PDF 자동 편집은 꺼지지 않는다 (auto 를 지금 값으로 못박아 저장)', () => {
    const prev = {};
    const merged = { ...prev, ...themeSavePatch(prev, { ...themeKeysFrom(prev), bg: 'ivory' }), auto: normalizePdfDesign(prev).auto };
    expect(normalizePdfDesign(merged).auto).toBe(true);
    expect(normalizePdfDesign(merged).bg).toBe('ivory');
    // 못박지 않으면 bg 가 '저장된 선택'으로 읽혀 꺼진다 — 이 단언이 그 함정의 증거다
    expect(normalizePdfDesign({ bg: 'ivory' }).auto).toBe(false);
  });

  // ③ PDF 제작 화면은 designConfig 를 통째로 갈아끼운다 — 홈페이지에서 고른 대표작·표식이 조용히 사라졌다
  it('★ PDF 쪽 저장이 웹 전용 키(대표작·표식)를 들고 간다', () => {
    const saved = { bg: 'ivory', webTheme: true, heroImageId: 12, coverLayout: 'matted' };
    const next = keepWebOnlyKeys(normalizePdfDesign({ ...saved, bg: 'sand' }), saved) as unknown as Record<string, unknown>;
    expect(next.bg).toBe('sand');
    expect(next.heroImageId).toBe(12);
    expect(next.webTheme).toBe(true);
    // 없던 건 만들지 않는다
    const none = keepWebOnlyKeys(normalizePdfDesign(null), null) as unknown as Record<string, unknown>;
    expect('webTheme' in none).toBe(false);
    expect('heroImageId' in none).toBe(false);
  });
  it('대표작 — 지정한 게 있고 살아 있으면 그것, 아니면 첫 작품', () => {
    const imgs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(pickHeroImage(imgs, { heroImageId: 2 })?.id).toBe(2);
    expect(pickHeroImage(imgs, { heroImageId: 99 })?.id).toBe(1);
    expect(pickHeroImage(imgs, { heroImageId: null })?.id).toBe(1);
    expect(pickHeroImage([], { heroImageId: null })).toBeNull();
  });
});
