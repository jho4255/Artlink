/**
 * R2 공개 주소 관리 — 도메인 전환기를 안전하게 넘기기 위한 모듈 (2026-08-04)
 *
 * ## 배경
 * 이미지 주소가 Cloudflare의 **Public Development URL**(`pub-<hash>.r2.dev`)이었다.
 * 이름 그대로 개발용이고 속도 제한이 걸려 있어 프로덕션에 부적합해서
 * 커스텀 도메인(`img.artlink.cc`)으로 옮긴다.
 *
 * ## 전환기의 함정
 * DB에 **이미 저장된 이미지 주소는 전부 옛 도메인**이다. `R2_PUBLIC_URL`을 새 도메인으로
 * 그냥 바꾸면 두 곳이 조용히 깨진다.
 *   1) 이미지 프록시의 SSRF 허용 검사 → 옛 주소가 400으로 막혀 폴백이 죽는다
 *   2) 업로드 파일 정리(`deleteUploadedFile`) → 옛 주소를 "우리 것"으로 못 알아봐 **삭제가 안 된다**
 *      (고아 파일이 계속 쌓인다)
 *
 * ## 규칙
 * `R2_PUBLIC_URL`에 **쉼표로 여러 개**를 넣을 수 있다.
 *   R2_PUBLIC_URL="https://img.artlink.cc,https://pub-xxxx.r2.dev"
 *   - **첫 번째**  = 신규 업로드에 쓸 정식 주소
 *   - **전체**     = 프록시 허용·파일 삭제 시 "우리 것"으로 인정할 주소들
 * 값이 하나면 예전과 완전히 동일하게 동작한다(하위호환).
 */

/** 설정된 공개 주소들 (앞뒤 공백·끝 슬래시 제거, 빈 값 제외) */
export function r2PublicBases(): string[] {
  return (process.env.R2_PUBLIC_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** 신규 업로드에 사용할 정식 주소 (목록의 첫 번째). 미설정이면 빈 문자열 */
export function r2CanonicalBase(): string {
  return r2PublicBases()[0] || '';
}

/**
 * 이 URL이 우리 R2 공개 주소 중 하나인가.
 * 호스트를 **정확히 일치**로 비교하고 프로토콜·경로 접두사까지 확인한다
 * (`evil.com/?x=https://img.artlink.cc/` 같은 우회 차단).
 * 일치하면 그때 쓴 base를 함께 돌려준다(키 추출에 필요).
 */
export function matchR2Base(url: string): string | null {
  let target: URL;
  try { target = new URL(url); } catch { return null; }
  const host = (u: URL) => u.hostname.replace(/\.$/, '').toLowerCase();

  for (const base of r2PublicBases()) {
    let allowed: URL;
    try { allowed = new URL(base); } catch { continue; }
    if (
      target.protocol === allowed.protocol &&
      host(target) === host(allowed) &&
      url.startsWith(base + '/')
    ) {
      return base;
    }
  }
  return null;
}
