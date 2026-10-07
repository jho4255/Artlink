import { VISITOR_ROLE_HINT } from '@/lib/utils';
import type { SignupRole } from '@/lib/signupRole';

/**
 * 역할 고르기 [아티스트 · 갤러리 · 일반] — 회원가입 화면(`/signup`)과 이메일 가입 화면(거기서 바꿀 수 있다)이 같이 쓴다 (2026-10-08).
 * 이름은 카카오 가입 정보 입력(AuthCallbackPage)과 같게.
 */
export const ROLE_CHOICES: { value: SignupRole; label: string; desc: string }[] = [
  { value: 'ARTIST', label: '아티스트', desc: '홈페이지 · 공모 지원' },
  { value: 'GALLERY', label: '갤러리', desc: '공모 올리기 · 운영' },
  { value: 'VISITOR', label: '일반', desc: VISITOR_ROLE_HINT },
];

export default function RoleChoice({ value, onChange, labelledBy }: {
  value: SignupRole | null;
  onChange: (role: SignupRole) => void;
  /** 이 묶음의 이름이 적힌 요소 id(“어떤 회원이신가요?”) */
  labelledBy: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-2">
      {ROLE_CHOICES.map((r) => (
        <button
          key={r.value}
          type="button"
          role="radio"
          aria-checked={value === r.value}
          onClick={() => onChange(r.value)}
          className={`cursor-pointer rounded-lg border px-2 py-3 text-center transition-colors ${
            value === r.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'
          }`}
        >
          <span className="block text-sm font-medium text-gray-900">{r.label}</span>
          <span className="mt-0.5 block break-keep text-[11px] leading-snug text-gray-400">{r.desc}</span>
        </button>
      ))}
    </div>
  );
}
