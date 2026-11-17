import { shareLinkNative } from './native';

/**
 * 링크 공유 — 앱이면 안드로이드 공유 창, 휴대폰 브라우저면 공유 시트, 그 밖에는 주소 복사(2026-11-14, 작가·갤러리 홈페이지 공통).
 * 결과를 돌려준다 — 부르는 쪽이 '복사했어요' 를 알린다. 사용자가 공유 창을 닫았으면 'cancelled'(아무 말도 하지 않는다).
 */
export async function shareLink(title: string, url: string): Promise<'native' | 'shared' | 'copied' | 'cancelled'> {
  if (await shareLinkNative(title, url)) return 'native';   // 앱: WebView 엔 navigator.share 가 없다
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  try {
    if (nav?.share) { await nav.share({ title, url }); return 'shared'; }
    await nav?.clipboard?.writeText(url);
    return 'copied';
  } catch {
    return 'cancelled';   // 공유 시트를 닫았거나 클립보드 권한이 없다 — 조용히
  }
}
