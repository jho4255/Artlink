/**
 * 공모 조회수 — 공모를 올린 갤러리·관리자만 본다(2026-10-05 사용자 요청).
 * 누가 볼지는 **서버가** 정한다(backend lib/viewCount.ts canSeeExhibitionViews — 값을 실을지 말지). 화면은 값이 왔으면 그린다.
 * jsdom 에 렌더 도구가 없어 소스를 대조한다(favoriteButtons.test.ts 와 같은 방식).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');
const backend = (rel: string) => readFileSync(resolve(__dirname, '../../../backend/src', rel), 'utf-8');

describe('공모 조회수 — 올린 갤러리에게만', () => {
  it('공모 상세의 배지는 서버가 실어 준 값을 그린다(owner)', () => {
    expect(src('pages/ExhibitionDetailPage.tsx')).toMatch(/<ViewCountBadge count=\{exhibition\.viewCount\} owner\b/);
  });

  it('갤러리·전시 상세는 관리자에게만 — 그 응답엔 아직 누구에게나 값이 실린다', () => {
    for (const f of ['pages/GalleryDetailPage.tsx', 'pages/ShowDetailPage.tsx']) {
      const badge = src(f).match(/<ViewCountBadge[^>]*>/g) ?? [];
      expect(badge.length, f).toBeGreaterThan(0);
      for (const b of badge) expect(b, f).not.toMatch(/\bowner\b/);
    }
  });

  it('배지는 owner 가 아니면 관리자 판정을 그대로 둔다', () => {
    const s = src('components/shared/ViewCountBadge.tsx');
    expect(s).toMatch(/if \(!isAdmin && !owner\) return null/);
  });

  it('[내 공모] 카드는 값이 있을 때만 조회수를 그린다(위임받은 아트링크 공모는 null)', () => {
    expect(src('pages/MyPage.tsx')).toMatch(/isApproved && item\.viewCount != null &&/);
  });

  it('서버 — 공개 응답에서 조회수를 빼는 목록에 viewCount 가 있다', () => {
    expect(backend('lib/sanitize.ts')).toMatch(/EXHIBITION_INTERNAL_KEYS = \[[^\]]*'viewCount'/);
    // 운영 권한(canOperate)과 다른 기준 — 위임 갤러리는 못 본다
    expect(backend('lib/viewCount.ts')).toMatch(/ex\.hostType !== 'ADMIN'/);
  });
});
