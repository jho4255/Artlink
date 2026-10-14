/**
 * 모집 인원 '0명'·'00명' (2026-10-14 사용자 요청 · 결정: 0명 = 9명까지, 00명 = 99명까지 수락)
 * 화면 거울(lib/utils.ts CAPACITY_MASKS)이 서버(backend/src/lib/capacity.ts)와 같은지 · 공고에 숫자를 그대로 찍는 자리가 없는지 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CAPACITY_MASKS, capacityText, capacityLimit, capacityWithLimit, capacityPayload } from '@/lib/utils';
import { galleryNextTask, type GallerySnapshot } from '@/lib/flowLabels';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

describe('규칙 — 서버와 같다', () => {
  it('★ 0명 = 9 · 00명 = 99 (서버 lib/capacity.ts 와 같은 글자·한도)', () => {
    expect(CAPACITY_MASKS).toEqual({ ONE: { label: '0명', max: 9 }, TWO: { label: '00명', max: 99 } });
    const server = read('backend/src/lib/capacity.ts');
    expect(server).toMatch(/ONE: \{ label: '0명', max: 9 \}/);
    expect(server).toMatch(/TWO: \{ label: '00명', max: 99 \}/);
  });

  it('공고 글자 · 운영자 한도 · 정원 문구 · 보낼 값', () => {
    expect(capacityText({ capacity: 5 })).toBe('5명');
    expect(capacityText({ capacity: 9, capacityMask: 'ONE' })).toBe('0명');
    expect(capacityText({ capacity: 99, capacityMask: 'TWO' })).toBe('00명');
    expect(capacityLimit({ capacity: 5 })).toBe('5');
    expect(capacityLimit({ capacity: 9, capacityMask: 'ONE' })).toBe('최대 9');
    expect(capacityWithLimit({ capacity: 9, capacityMask: 'ONE' })).toBe('0명 — 최대 9명');
    expect(capacityPayload({ capacity: 3, capacityMask: 'TWO' })).toEqual({ capacity: 99, capacityMask: 'TWO' });
    expect(capacityPayload({ capacity: 3, capacityMask: null })).toEqual({ capacity: 3, capacityMask: null });
  });

  it('갤러리 할 일 — 0명 공고가 9명 다 차면 정원 문구에 한도를 밝힌다', () => {
    const base: GallerySnapshot = {
      status: 'APPROVED', recruitOnly: true, recruitmentClosed: false, confirmed: false, ended: false, settled: false, settlementRequested: false,
      pending: 1, accepted: 9, capacity: 9, capacityMask: 'ONE', submissionsIncomplete: 0, sales: 0, approvals: { total: 0, approved: 0, issue: 0 },
    } as GallerySnapshot;
    expect(galleryNextTask(base, () => 5).text).toContain('정원(0명 — 최대 9명)이 찼어요');
  });
});

describe('공고에 숫자를 그대로 찍지 않는다 — 0명 공고에 9명이 뜬다', () => {
  it('★ 목록·상세·갤러리 페이지·주최 공모·초대 코드가 capacityText 계열을 쓴다', () => {
    const files = [
      'frontend/src/pages/ExhibitionsPage.tsx', 'frontend/src/pages/ExhibitionDetailPage.tsx', 'frontend/src/pages/GalleryDetailPage.tsx',
      'frontend/src/pages/JoinExhibitionPage.tsx', 'frontend/src/components/admin/HostedExhibitionsSection.tsx',
      'frontend/src/components/shared/JoinCodePanel.tsx', 'frontend/src/pages/MyPage.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/\{(ex|exhibition|item|data|ex\.exhibition)\.capacity\}명/);
      expect(src, f).toMatch(/capacity(Text|Limit|WithLimit)\(/);
    }
  });

  it('세 등록·변경 자리가 같은 고르는 칸(CapacityPicker)을 쓰고, 보낼 땐 capacityPayload 를 거친다', () => {
    for (const f of ['frontend/src/pages/MyPage.tsx', 'frontend/src/components/admin/HostedExhibitionsSection.tsx', 'frontend/src/components/shared/ApplicantManager.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/<CapacityPicker/);
      expect(src, f).toMatch(/capacityPayload\(/);
    }
  });
});
