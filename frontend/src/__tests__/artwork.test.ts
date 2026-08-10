import { describe, it, expect } from 'vitest';
import {
  artworkTitle, captionInline, captionLines, careerLineText, composeSize, groupBySeries,
  hasCaption, isCareerEmpty, normalizeCareer, seriesNames, splitSize, statusLabel,
} from '../lib/artwork';
import type { PortfolioImage } from '../types';

const img = (p: Partial<PortfolioImage>): PortfolioImage =>
  ({ id: p.id ?? 1, url: p.url ?? 'u', order: p.order ?? 0, ...p }) as PortfolioImage;

describe('작품 캡션', () => {
  it('있는 항목만 이어붙인다 — 빈 값으로 구분자만 남는 캡션이 나오면 안 된다', () => {
    expect(captionInline(img({ sizeText: '50×50 cm', medium: '', year: '2025' }))).toBe('50×50 cm  /  2025');
    expect(captionInline(img({}))).toBe('');
    expect(captionLines(img({ medium: 'Oil', sizeText: '', year: '2024' }))).toEqual(['Oil', '2024']);
  });

  it('캡션 순서는 크기 → 재료 → 연도 (레퍼런스 관례)', () => {
    expect(captionInline(img({ sizeText: '50×50 cm', medium: 'Oil on canvas', year: '2025' })))
      .toBe('50×50 cm  /  Oil on canvas  /  2025');
  });

  it('제목이 없으면 무제 — 캡션 자리를 비우면 페이지 정렬이 흔들린다', () => {
    expect(artworkTitle(img({ title: '  ' }))).toBe('무제');
    expect(artworkTitle(img({ title: '겨울 들판' }))).toBe('겨울 들판');
  });

  it('판매 가능(AVAILABLE)은 표기하지 않는다 — 기본값이라 알릴 필요가 없다', () => {
    expect(statusLabel(img({ status: 'SOLD' }))).toBe('Sold');
    expect(statusLabel(img({ status: 'NFS' }))).toBe('비매');
    expect(statusLabel(img({ status: 'AVAILABLE' }))).toBe('');
    expect(statusLabel(img({}))).toBe('');
  });

  it('hasCaption — 네 항목 중 하나라도 있으면 true', () => {
    expect(hasCaption(img({}))).toBe(false);
    expect(hasCaption(img({ title: '', medium: '', sizeText: '', year: '' }))).toBe(false);
    expect(hasCaption(img({ year: '2025' }))).toBe(true);
  });
});

describe('크기 입력', () => {
  it('가로/세로를 한 형식으로 합성한다', () => {
    expect(composeSize('72.7', '90.9')).toBe('72.7×90.9 cm');
    expect(composeSize('50', '')).toBe('50 cm');
    expect(composeSize('', '')).toBe('');
  });

  it('저장된 문자열에서 가로/세로를 되읽는다 (x, ×, * 모두)', () => {
    expect(splitSize('72.7×90.9 cm')).toEqual({ w: '72.7', h: '90.9' });
    expect(splitSize('30 x 20')).toEqual({ w: '30', h: '20' });
    expect(splitSize('가변 설치')).toEqual({ w: '', h: '' });
    expect(splitSize(null)).toEqual({ w: '', h: '' });
  });
});

describe('시리즈 그룹핑', () => {
  const imgs = [
    img({ id: 1, series: '겨울' }),
    img({ id: 2, series: '' }),
    img({ id: 3, series: '정원' }),
    img({ id: 4, series: '겨울' }),
  ];

  it('등장 순서를 지키고, 시리즈 미지정 묶음은 맨 뒤로 보낸다', () => {
    const g = groupBySeries(imgs);
    expect(g.map((x) => x.name)).toEqual(['겨울', '정원', '']);
    expect(g[0]!.images.map((i) => i.id)).toEqual([1, 4]);
  });


  it('시리즈 설명을 이름으로 이어 붙인다', () => {
    const g = groupBySeries(imgs, [{ name: '겨울', note: '설명' }, { name: '없는시리즈', note: 'x' }]);
    expect(g[0]!.note).toBe('설명');
    expect(g[1]!.note).toBe('');
  });

  it('seriesNames — 중복 없이 등장 순서', () => {
    expect(seriesNames(imgs)).toEqual(['겨울', '정원']);
  });
});

describe('경력', () => {
  it('normalizeCareer — 옛 데이터(학력·수상 없음)도 빈 배열로 채워 내려준다', () => {
    const c = normalizeCareer({ artFair: [], solo: [{ year: '2025', content: '개인전' }], group: [] });
    expect(c.education).toEqual([]);
    expect(c.award).toEqual([]);
    expect(c.solo).toHaveLength(1);
  });

  it('isCareerEmpty — 확장 항목만 있어도 비어있지 않다', () => {
    expect(isCareerEmpty(null)).toBe(true);
    expect(isCareerEmpty({ artFair: [], solo: [], group: [] })).toBe(true);
    expect(isCareerEmpty({ artFair: [], solo: [], group: [], award: [{ year: '', content: '수상' }] })).toBe(false);
  });

  it('careerLineText — 연도가 없으면 내용만 (작가마다 표기가 자유롭다)', () => {
    expect(careerLineText({ year: '2025', content: '개인전' })).toBe('2025 개인전');
    expect(careerLineText({ year: '', content: '2025 개인전' })).toBe('2025 개인전');
  });
});
