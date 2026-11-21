import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * 페이지 안 탭 막대 — 갤러리 홈페이지(2026-09-27). 작가 홈페이지의 탭 막대(`HomepageView` 의 TabBar)와 **같은 모양**이다:
 * 글자 탭 + 밑줄, 강조색 없음(빨강은 D-day·판매완료 같은 '상태'에 아껴 둔다), 넘치면 가로로 밀어 본다(줄바꿈하면 막대 높이가 튄다).
 * 작가 쪽은 작가가 고른 테마 색(`--hp-*`)을 따라야 해서 따로 두고, 여기는 사이트 기본 색을 쓴다.
 *
 * `sticky` 면 상단바 바로 아래(h-16 / lg:h-20)에 붙는다. 부모 컨테이너의 좌우 여백(px-6 md:px-12)만큼 넓혀 배경이 끝까지 찬다.
 */
export interface PageTab<T extends string> {
  id: T;
  label: string;
  /** 탭 옆 작은 숫자 — '6' · 공모 한 건 화면의 '1/4'(2026-11-20) */
  count?: number | string;
  /** 다 채운 탭에 ✓ (출품 자료 편집기의 출품리스트·약력·작가노트, 2026-09-29) */
  done?: boolean;
  /** 아직 열 수 없는 탭(정산은 전시 종료 뒤, 2026-11-20) — 회색, 누르면 아무 일도 없다. 이유는 `hint`(title) */
  disabled?: boolean;
  hint?: string;
}

export default function PageTabBar<T extends string>({ tabs, active, onSelect, sticky = true, idPrefix, label, site = false, trailing }: {
  tabs: PageTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  sticky?: boolean;
  /** 탭·패널 id 접두 — aria-controls 로 짝을 맞춘다 */
  idPrefix: string;
  label: string;
  /**
   * 홈페이지('내 사이트' 모드, 2026-11-14 규칙 82) — ArtLink 상단바 대신 사이트 머리(56 / lg 72)가 있다. 그 바로 아래에 붙는다.
   * PC 에서도 이 막대다 — 탭을 머리에 두었더니 "잘 안 보인다"고 했다(2026-11-15). 색은 `var(--hp-…)`.
   */
  site?: boolean;
  /** 탭 줄 오른쪽 — 갤러리 홈페이지의 문의하기 · 이웃 추가 · 찜 · 공유(`TabActions`, 2026-11-15). 탭 줄과 함께 머리 밑에 붙어 따라온다 */
  trailing?: ReactNode;
}) {
  const stickyCls = !sticky ? '' : site
    ? 'sticky top-14 z-30 -mx-6 bg-[var(--hp-bg)] px-6 md:-mx-12 md:px-12 lg:top-[72px]'
    : 'sticky top-16 z-30 -mx-6 bg-white px-6 md:-mx-12 md:px-12 lg:top-20';
  return (
    <div className={`${stickyCls} border-b border-gray-200`}>
      <div className="flex items-stretch gap-3">
      {/* 오른쪽에 버튼이 붙으면(갤러리 홈페이지) 휴대폰에선 탭이 옆으로 넘친다 — 끝을 흐리게 해 밀면 더 있다는 걸 알린다 */}
      <div role="tablist" aria-label={label} className={`flex min-w-0 flex-1 gap-6 overflow-x-auto [scrollbar-width:none] md:gap-8 [&::-webkit-scrollbar]:hidden ${trailing ? 'pr-6 [mask-image:linear-gradient(to_right,black_calc(100%_-_28px),transparent)]' : ''}`}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`${idPrefix}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${idPrefix}-panel-${t.id}`}
              aria-disabled={t.disabled || undefined}
              title={t.disabled ? t.hint : undefined}
              onClick={() => { if (!t.disabled) onSelect(t.id); }}
              className={`relative min-h-[44px] shrink-0 whitespace-nowrap py-3 text-[14px] md:text-[15px] ${t.disabled ? 'cursor-default text-gray-300' : on ? 'cursor-pointer font-semibold text-gray-900' : 'cursor-pointer text-gray-500 hover:text-gray-900'}`}
            >
              {t.label}
              {(typeof t.count === 'number' || (typeof t.count === 'string' && t.count)) && <span className="ml-1.5 text-[12px] font-normal tabular-nums text-gray-400">{t.count}</span>}
              {t.done && <Check size={13} strokeWidth={2.5} aria-label="채움" className="ml-1 inline-block -translate-y-px text-gray-400" />}
              {on && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-gray-900" />}
            </button>
          );
        })}
      </div>
      {trailing}
      </div>
    </div>
  );
}
