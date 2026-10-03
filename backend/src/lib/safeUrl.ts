import { matchR2Base } from './r2Urls';

/**
 * 사용자 제공 파일 URL 정규화 — 저장형 XSS(javascript:/data: 등) 방지.
 * 동일 출처 상대경로(/uploads/..)와 http(s)만 허용. 그 외 스킴은 null로 폐기.
 *
 * ⚠️ `//host/…`·`/\host/…` 는 '/' 로 시작하지만 **같은 출처 경로가 아니다** — 브라우저는 프로토콜 상대 주소로 읽어
 *    다른 호스트로 요청을 보낸다(2026-10-03 점검: 지원서 작품 사진에 `//tracker…/p.png` 가 그대로 저장됐다).
 */
export function safeFileUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!t) return null;
  if (t.startsWith('/')) {
    if (t.startsWith('//') || t.startsWith('/\\')) return null;
    return t; // 동일 출처 업로드 경로
  }
  try {
    const p = new URL(t);
    return p.protocol === 'http:' || p.protocol === 'https:' ? t : null;
  } catch {
    return null;
  }
}

/**
 * 우리 서버가 내준 정적 경로 — 업로드(디스크 모드) · 데모 그림 · 공용 이미지(`frontend/public`).
 * 시드·E2E 가 `/demo-art/…`·`/images/…` 를 작품 사진으로 쓴다.
 */
const OWN_PATH_PREFIXES = ['/uploads/', '/demo-art/', '/images/'];

/**
 * **우리 저장소 주소만** — 같은 출처의 위 경로 또는 R2 공개 주소(`lib/r2Urls.ts`). 아니면 null.
 *
 * 지원서 작품 사진·포트폴리오 파일·공모 포스터·홍보 사진·출품 자료·작가 홈페이지 작품처럼 **남(갤러리·방문자)의 화면에 그려지는**
 * 파일 주소에 쓴다. `safeFileUrl` 만으로는 임의의 http(s) 주소가 통과해, 갤러리가 지원서를 여는 순간 외부로 요청이 나가고
 * [파일 보기]가 외부 사이트로 갔다(2026-10-03 점검 S3). 화면은 언제나 우리 업로드 API 로 올린 뒤 그 주소를 보낸다.
 * ⚠️ 프로필 사진은 카카오 주소라 여기 넣지 않는다(`safeFileUrl` 그대로).
 */
export function ownFileUrl(u: unknown): string | null {
  const s = safeFileUrl(u);
  if (!s) return null;
  if (s.startsWith('/')) {
    // `/uploads/../api/…` 같은 경로 되돌리기는 브라우저가 풀어서 다른 곳을 가리킨다(`%2e%2e` 도 같다)
    if (s.includes('\\') || /(^|\/)(\.|%2e){2}(\/|$|\?|#)/i.test(s)) return null;
    return OWN_PATH_PREFIXES.some((p) => s.startsWith(p)) ? s : null;
  }
  return matchR2Base(s) ? s : null;
}
