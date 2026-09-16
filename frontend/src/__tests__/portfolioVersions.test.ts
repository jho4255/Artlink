/**
 * 포트폴리오 PDF 버전 — 순수 함수(`lib/portfolioVersions.ts`).
 * 버전은 홈페이지 작품 위에 얹는 **선택과 순서**다. 지운 작품 id 가 배열에 남아도 화면이 죽거나 빈 칸을 그리면 안 된다.
 */
import { describe, it, expect } from 'vitest';
import { versionWorks, versionDesign, nextVersionName, moveId } from '../lib/portfolioVersions';
import type { PortfolioImage, PortfolioVersion } from '../types';

const img = (id: number): PortfolioImage => ({ id, url: `u${id}`, order: id } as PortfolioImage);
const ver = (workIds: number[], design: unknown = null): PortfolioVersion =>
  ({ id: 1, name: 'v', workIds, design, createdAt: '', updatedAt: '' });
const all = [img(1), img(2), img(3), img(4)];

describe('versionWorks', () => {
  it('workIds 순서대로 실제 작품을 돌려준다', () => {
    expect(versionWorks(all, ver([3, 1])).map((w) => w.id)).toEqual([3, 1]);
  });
  it('★ 지운 작품 id·중복은 조용히 건넌다 (빈 칸을 그리지 않는다)', () => {
    expect(versionWorks(all, ver([3, 99, 1, 3])).map((w) => w.id)).toEqual([3, 1]);
  });
  it('버전이 없거나 선택이 비면 전체 작품을 홈페이지 순서로 (= 기본)', () => {
    expect(versionWorks(all, null)).toBe(all);
    expect(versionWorks(all, ver([]))).toBe(all);
  });
});

describe('versionDesign · nextVersionName · moveId', () => {
  it('버전 디자인이 없으면 기본 디자인', () => {
    expect(versionDesign(ver([1], { bg: 'ink' }), { bg: 'white' })).toEqual({ bg: 'ink' });
    expect(versionDesign(ver([1]), { bg: 'white' })).toEqual({ bg: 'white' });
    expect(versionDesign(null, undefined)).toBeNull();
  });
  it('새 이름은 겹치지 않는다', () => {
    expect(nextVersionName([])).toBe('새 버전');
    expect(nextVersionName([{ name: '새 버전' }])).toBe('새 버전 2');
    expect(nextVersionName([{ name: '새 버전' }, { name: '새 버전 2' }])).toBe('새 버전 3');
    expect(nextVersionName([{ name: 'x' }], '공모용 복사')).toBe('공모용 복사');
  });
  it('순서 옮기기 — 끝에서는 그대로', () => {
    expect(moveId([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
  });
});
