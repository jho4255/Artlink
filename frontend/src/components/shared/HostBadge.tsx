/**
 * 아트링크 주최 표시 — 로고 워드마크만 찍는다.
 *
 * 목록 카드·상세의 갤러리명은 아트링크 주최 공모에서 **주관 갤러리**일 뿐이라,
 * 이게 없으면 "그 갤러리가 주최한 공모"로 오해하게 된다.
 * 모집공고 목록에서는 아예 갤러리명 자리를 이 로고가 대신한다.
 *
 * 칩(테두리·바탕)이나 "주최" 글자는 붙이지 않는다 — 로고 자체로 읽힌다는 판단(2026-08-14).
 * 크기는 놓이는 자리에 맞춰 호출부에서 `className` 으로 준다(기본 text-sm).
 *
 * 판정 규칙은 `lib/exhibitionHost.ts`(순수 함수 + 테스트)에 있다.
 */
import { isAdminHosted, type HostLike } from '@/lib/exhibitionHost';

/** Navbar 로고와 동일한 워드마크 (Navbar 를 바꾸면 여기도 같이 바꿀 것) */
export function ArtLinkWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-serif font-bold tracking-tight text-gray-900 ${className}`}>
      Art<span className="text-[#dc3545]">Link</span>
    </span>
  );
}

export default function HostBadge({ exhibition, className = '' }: { exhibition: HostLike | null | undefined; className?: string }) {
  if (!isAdminHosted(exhibition)) return null;
  return <ArtLinkWordmark className={`text-sm ${className}`} />;
}
