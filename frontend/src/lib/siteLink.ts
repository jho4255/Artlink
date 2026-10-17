import { safeHttpUrl } from './utils';

/**
 * 관리자가 적은 링크(히어로 배너 [자세히 보기] · 사이드바 광고)를 어디서 열지 정한다 (2026-10-17).
 *
 * ⚠️ `http` 로 시작하면 새 창이라고 판정하지 말 것 — 관리자는 우리 화면도 `https://artlink.cc/exhibitions` 처럼 **전체 주소**로 적는다
 *    (실서버 배너가 그랬다). 그걸 새 창으로 열면 ① 휴대폰에서 뒤로가기로 홈에 못 돌아오고 ② `window.open` 이 이 탭의 sessionStorage 를
 *    **복사**해 가서, 비회원 둘러보기 기록(방문 번호·화면 순번, 규칙 64)이 두 탭에서 같은 순번을 쓴다 → 원래 탭으로 돌아와 본 화면을
 *    서버가 버린다(크롬·WebKit 실측: 홈 → 새 탭 모집공고 → 닫고 작가 → 갤러리 가 '홈 → 모집공고 → 갤러리' 로 남았다).
 *
 * 우리 사이트 주소면 앱 안 경로(`route`, 같은 탭) · 바깥 주소면 `external`(새 창, noopener) · 쓸 수 없는 주소면 null.
 * 우리 사이트라도 화면이 아니라 **파일**(업로드·약관 txt·ArtLook·API)이면 예전처럼 새 창 — 라우터로 보내면 없는 화면이 뜬다.
 */
export const SITE_HOSTS = ['artlink.cc', 'www.artlink.cc', 'artlink-stmq.onrender.com'];

const FILE_PREFIX = /^\/(api|uploads|terms|artlook|images|demo-art)(\/|$)/;
const FILE_EXT = /\.(pdf|hwpx?|docx?|xlsx?|pptx?|zip|txt|png|jpe?g|gif|webp|svg|html?)$/i;

export type SiteLink = { kind: 'route'; path: string } | { kind: 'external'; url: string };

export function resolveSiteLink(raw?: string | null, origin: string = window.location.origin): SiteLink | null {
  // 서버가 '/…' 또는 http(s) 전체 주소로 정리해 저장한다(hero.ts normalizeLinkUrl · ad.ts safeLink). javascript: 등은 여기서 null
  const safe = safeHttpUrl(raw);
  if (!safe) return null;
  let u: URL;
  try { u = new URL(safe, origin); } catch { return null; }
  const own = u.origin === new URL(origin).origin || SITE_HOSTS.includes(u.hostname.toLowerCase());
  if (own && !FILE_PREFIX.test(u.pathname) && !FILE_EXT.test(u.pathname)) return { kind: 'route', path: `${u.pathname}${u.search}${u.hash}` };
  return { kind: 'external', url: u.toString() };
}

/** 위 판정대로 연다 — 앱 화면은 `navigate`(같은 탭), 그 밖은 새 창(noopener: 이 탭의 sessionStorage 를 복사해 가지 않는다) */
export function openSiteLink(raw: string | null | undefined, navigate: (path: string) => void): void {
  const link = resolveSiteLink(raw);
  if (!link) return;
  if (link.kind === 'route') navigate(link.path);
  else window.open(link.url, '_blank', 'noopener');
}
