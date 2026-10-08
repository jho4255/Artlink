/**
 * 지역 목록 · 지역 바꾸기 권한 · 추가 질문 창의 목록 캐시 (2026-10-08 사용자 요청)
 * 서버 `backend/src/lib/regions.ts` 와 같은 값·같은 순서인지 소스로 대조한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { regionLabels, REGION_CODES } from '@/lib/utils';
import { canChangeRegion } from '@/lib/exhibitionHost';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

describe('지역 목록 — 서버와 같다', () => {
  it('★ 화면의 지역 코드 = 서버 REGIONS (값·순서) · 경북·경남·전북·전남이 있다', () => {
    const src = read('backend/src/lib/regions.ts');
    const m = src.match(/export const REGIONS = \[([\s\S]*?)\] as const;/);
    expect(m).toBeTruthy();
    const server = m![1]!.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    expect(REGION_CODES).toEqual(server);
    expect(regionLabels.GYEONGBUK).toBe('경북');
    expect(regionLabels.GYEONGNAM).toBe('경남');
    expect(regionLabels.JEONBUK).toBe('전북');
    expect(regionLabels.JEONNAM).toBe('전남');
  });

  it('화면마다 지역 배열을 따로 적지 않는다 — 한 곳만 늘리면 고르는 칸·필터가 서로 달라진다', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name) || p.endsWith(join('lib', 'utils.ts'))) continue;
        if (/\[\s*'SEOUL',\s*'INCHEON'/.test(readFileSync(p, 'utf-8'))) offenders.push(p.slice(root.length + 1));
      }
    };
    walk(join(root, 'frontend', 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('올린 공모의 지역 바꾸기 — 누가', () => {
  const galleryHosted = { hostType: 'GALLERY', canOperate: true };
  const adminHosted = { hostType: 'ADMIN', canOperate: true };
  it('갤러리 주최 공모는 그 갤러리와 관리자 · 아트링크 주최 공모는 관리자만(서버 규칙과 같다)', () => {
    expect(canChangeRegion(galleryHosted, { id: 3, role: 'GALLERY' })).toBe(true);
    expect(canChangeRegion({ hostType: 'GALLERY', canOperate: false }, { id: 9, role: 'GALLERY' })).toBe(false);
    expect(canChangeRegion(adminHosted, { id: 3, role: 'GALLERY' })).toBe(false);   // 위임 갤러리
    expect(canChangeRegion(adminHosted, { id: 4, role: 'ADMIN' })).toBe(true);
    expect(canChangeRegion(galleryHosted, { id: 1, role: 'ARTIST' })).toBe(false);
    expect(canChangeRegion(galleryHosted, null)).toBe(false);
  });

  it('공고 상세의 [지역] 줄이 [변경]을 그 규칙으로 보이고 PATCH /region 으로 보낸다', () => {
    const detail = read('frontend/src/pages/ExhibitionDetailPage.tsx');
    expect(detail).toMatch(/<RegionRow exhibition=\{exhibition\} canChange=\{canChangeRegion\(exhibition, user\)\} \/>/);
    expect(detail).toMatch(/api\.patch\(`\/exhibitions\/\$\{exhibition\.id\}\/region`/);
    expect(read('backend/src/routes/exhibition.ts')).toMatch(/router\.patch\('\/:id\/region'/);
  });
});

describe('추가 질문 수정 창 — 저장하면 여는 목록에 바로 반영', () => {
  it("★ 관리자 [주최 공모](hosted-exhibitions)·갤러리 [내 공모](my-exhibitions) 캐시를 받은 값으로 고친다", () => {
    // 예전엔 주최 공모 목록을 무효화하지 않아, 고치거나 지우고 다시 열면 옛 질문이 떠 저장이 안 된 것처럼 보였다
    const src = read('frontend/src/components/shared/CustomQuestionsEditor.tsx');
    expect(src).toMatch(/setQueriesData\(\{ queryKey: \['hosted-exhibitions'\] \}/);
    expect(src).toMatch(/setQueriesData\(\{ queryKey: \['my-exhibitions'\] \}/);
    expect(src).toMatch(/invalidateQueries\(\{ queryKey: \['hosted-exhibitions'\] \}\)/);
    // 이 창을 여는 곳의 목록 키가 바뀌면 위 두 줄도 같이 바꿔야 한다
    expect(read('frontend/src/components/admin/HostedExhibitionsSection.tsx')).toMatch(/queryKey: \['hosted-exhibitions'\]/);
    expect(read('frontend/src/pages/MyPage.tsx')).toMatch(/queryKey: \['my-exhibitions'\]/);
  });
});
