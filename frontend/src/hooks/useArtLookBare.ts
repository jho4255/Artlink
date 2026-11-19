import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isArtLookEditor } from '@/lib/siteMode';

/**
 * 지금 ArtLook 을 **휴대폰 편집 전용 화면**으로 띄우는가(2026-11-17, PLAN WP4 · CLAUDE.md 규칙 85) —
 * 작가 · 마이페이지 [ArtLook] 탭 · 창 폭 1024px 미만. 그때 `Layout` 은 상단바·하단 탭바·푸터를 그리지 않고,
 * `MyPage` 는 여백 없이 iframe 을 화면 가득 둔다. ArtLook(public/artlook) 도 같은 미디어 쿼리를 바깥 창에서 직접 읽는다 — 값을 바꾸면 둘 다.
 */
export const ARTLOOK_BARE_MEDIA = '(min-width: 1024px)';
export function useArtLookBare(): boolean {
  const { pathname, search } = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const wide = useMediaQuery(ARTLOOK_BARE_MEDIA);
  return !wide && role === 'ARTIST' && isArtLookEditor(pathname, search);
}
