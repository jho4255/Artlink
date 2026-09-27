import { describe, it, expect } from 'vitest';
import { galleryTabs, resolveGalleryTab, galleryTabParam } from '@/lib/galleryTabs';

const base = { hasAbout: false, openCallCount: 0, visibleArtistCount: 0, historyCount: 0, reviewCount: 0, isOwner: false };
const ids = (t: { id: string }[]) => t.map((x) => x.id);

describe('갤러리 홈페이지 탭', () => {
  it('다 채운 갤러리 — 소개 · 모집 중 · 함께한 작가 · 지난 전시 · 리뷰 순, 개수를 단다', () => {
    const t = galleryTabs({ ...base, hasAbout: true, openCallCount: 2, visibleArtistCount: 5, historyCount: 3, reviewCount: 4 });
    expect(ids(t)).toEqual(['about', 'calls', 'artists', 'history', 'reviews']);
    expect(t.find((x) => x.id === 'calls')?.count).toBe(2);
    expect(t.find((x) => x.id === 'reviews')?.count).toBe(4);
  });

  it('방문자에게 빈 탭은 없다 — 리뷰만은 늘 있다(쓰러 오는 곳)', () => {
    expect(ids(galleryTabs(base))).toEqual(['reviews']);
    expect(galleryTabs(base)[0].count).toBeUndefined();
  });

  it('주인에겐 채울 자리(소개·지난 전시)가 비어 있어도 보인다', () => {
    expect(ids(galleryTabs({ ...base, isOwner: true }))).toEqual(['about', 'history', 'reviews']);
  });

  it('숨긴 작가만 남으면 방문자에겐 탭이 없고, 관리자에겐 있다 — 다시 보이게 할 자리', () => {
    const c = { ...base, visibleArtistCount: 0, hiddenArtistCount: 2 };
    expect(ids(galleryTabs(c))).not.toContain('artists');
    const mgr = galleryTabs({ ...c, isOwner: true, canManageArtists: true });
    expect(ids(mgr)).toContain('artists');
    // 탭 숫자는 방문자에게 보이는 수 — 0 이면 달지 않는다
    expect(mgr.find((x) => x.id === 'artists')?.count).toBeUndefined();
  });

  it('모르는 탭·지금 없는 탭은 첫 탭 — 첫 탭은 주소에 안 싣는다', () => {
    const t = galleryTabs({ ...base, hasAbout: true, reviewCount: 1 });
    expect(resolveGalleryTab('calls', t)).toBe('about');
    expect(resolveGalleryTab('nope', t)).toBe('about');
    expect(resolveGalleryTab('reviews', t)).toBe('reviews');
    expect(resolveGalleryTab(null, t)).toBe('about');
    expect(galleryTabParam('about', t)).toBeNull();
    expect(galleryTabParam('reviews', t)).toBe('reviews');
  });
});
