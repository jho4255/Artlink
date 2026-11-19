import Thumb from '@/components/shared/Thumb';
import { displayName } from '@/lib/utils';
import type { ChatPerson } from '@/lib/chatTypes';

/**
 * ArtTalk 의 얼굴 (2026-11-19 개편, 결정 D4) — 사람은 **이름 첫 글자 원**, 단톡은 그 공모의 포스터.
 * 프로필 사진(`avatar`)을 쓰지 않는다 — 대개 카카오 프로필 사진이라 홈페이지도 작가가 켜야 보여 준다(규칙 77).
 * 운영(아트링크) 계정은 검은 원, 탈퇴한 회원은 점선 원.
 */
function firstChar(p: ChatPerson): string {
  const name = displayName(p).trim();
  return Array.from(name)[0] ?? '?';   // 이모지처럼 두 칸짜리 글자를 반으로 자르지 않게
}

export function PersonAvatar({ person, size = 40, operator = false }: { person?: ChatPerson | null; size?: number; operator?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (!person || person.deleted) {
    return <span aria-hidden style={style} className="inline-block shrink-0 rounded-full border border-dashed border-gray-300" />;
  }
  const dark = operator || person.role === 'ADMIN';
  return (
    <span
      aria-hidden
      style={style}
      className={`grid shrink-0 place-items-center font-medium ${dark ? 'rounded-md bg-gray-900 text-white' : 'rounded-full bg-gray-100 text-gray-600'}`}
    >
      {firstChar(person)}
    </span>
  );
}

/** 단톡 — 포스터를 자르지 않고(contain) 작은 네모 안에 */
export function PosterAvatar({ src, size = 40 }: { src?: string | null; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size }} className="grid shrink-0 place-items-center overflow-hidden rounded-lg bg-gray-100">
      {src ? <Thumb src={src} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : null}
    </span>
  );
}
