/**
 * 찜(하트) 버튼 노출 규칙 + 모달 위 하단 탭바 (2026-09-19 전수 감사에서 나온 둘)
 *
 * 1. 찜 버튼은 **`canFavorite(user)` 하나**로 그린다 (CLAUDE.md 규칙 7 = Admin 만 제외).
 *    2026-09-16 에 '일반'(VISITOR) 역할을 넣을 때 갤러리 상세 한 곳만 화이트리스트를 늘렸고 목록 4곳·전시/공모 상세는
 *    `role === 'ARTIST'` 로 남아, 같은 갤러리가 목록엔 하트가 없고 상세엔 있는 화면이 됐다(실측). 서버는 역할 제한이 없다.
 *    화면이 `user?.role === 'ARTIST' && (` 식으로 하트를 직접 가르면 역할이 늘 때마다 같은 사고가 난다 → 소스를 훑어 막는다.
 *
 * 2. 모바일 하단 탭바(`BottomTabBar`)는 **z-40** 이어야 한다. 앱의 모달 대부분이 `fixed inset-0 z-50` 이고 포털을 안 써서
 *    DOM 상 탭바보다 앞에 온다. 같은 z-50 이면 뒤에 오는 탭바가 이겨 공모 지원 모달의 [지원하기]·[취소] 를 덮었다(실측).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canFavorite } from '@/lib/utils';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('canFavorite', () => {
  it('작가·갤러리·일반은 찜할 수 있고 Admin 과 비로그인은 못 한다', () => {
    expect(canFavorite({ role: 'ARTIST' })).toBe(true);
    expect(canFavorite({ role: 'GALLERY' })).toBe(true);
    expect(canFavorite({ role: 'VISITOR' })).toBe(true);
    expect(canFavorite({ role: 'ADMIN' })).toBe(false);
    expect(canFavorite(null)).toBe(false);
    expect(canFavorite(undefined)).toBe(false);
  });
});

describe('찜 버튼을 그리는 화면은 canFavorite 를 쓴다', () => {
  const pages = ['GalleriesPage', 'GalleryDetailPage', 'ExhibitionsPage', 'ExhibitionDetailPage', 'ShowsPage', 'ShowDetailPage'];
  for (const p of pages) {
    it(`★ ${p}.tsx — favMutation 앞에 역할 삼항식이 없다`, () => {
      const s = src(`pages/${p}.tsx`);
      expect(s.includes('canFavorite(')).toBe(true);
      // `role === 'ARTIST' && (` 바로 아래 몇 줄 안에서 favMutation 을 부르면 하트를 역할로 가른 것이다
      const re = /role === '(ARTIST|VISITOR)'[^\n]*&&\s*\(\s*\n(?:[^\n]*\n){0,6}[^\n]*favMutation/g;
      expect(s.match(re) ?? []).toEqual([]);
    });
  }
});

describe('BottomTabBar 는 모달(z-50) 아래에 있다', () => {
  it('★ z-40 이고 z-50 이 아니다', () => {
    const s = src('components/layout/BottomTabBar.tsx');
    expect(s).toMatch(/className="fixed inset-x-0 bottom-0 z-40 /);
    expect(s).not.toMatch(/bottom-0 z-50/);
  });
});
