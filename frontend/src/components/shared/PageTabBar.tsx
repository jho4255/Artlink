/**
 * 페이지 안 탭 막대 — 갤러리 홈페이지(2026-09-27). 작가 홈페이지의 탭 막대(`HomepageView` 의 TabBar)와 **같은 모양**이다:
 * 글자 탭 + 밑줄, 강조색 없음(빨강은 D-day·판매완료 같은 '상태'에 아껴 둔다), 넘치면 가로로 밀어 본다(줄바꿈하면 막대 높이가 튄다).
 * 작가 쪽은 작가가 고른 테마 색(`--hp-*`)을 따라야 해서 따로 두고, 여기는 사이트 기본 색을 쓴다.
 *
 * `sticky` 면 상단바 바로 아래(h-16 / lg:h-20)에 붙는다. 부모 컨테이너의 좌우 여백(px-6 md:px-12)만큼 넓혀 배경이 끝까지 찬다.
 */
export interface PageTab<T extends string> { id: T; label: string; count?: number }

export default function PageTabBar<T extends string>({ tabs, active, onSelect, sticky = true, idPrefix, label }: {
  tabs: PageTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  sticky?: boolean;
  /** 탭·패널 id 접두 — aria-controls 로 짝을 맞춘다 */
  idPrefix: string;
  label: string;
}) {
  return (
    <div className={`${sticky ? 'sticky top-16 z-30 -mx-6 bg-white px-6 md:-mx-12 md:px-12 lg:top-20' : ''} border-b border-gray-200`}>
      <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto [scrollbar-width:none] md:gap-8 [&::-webkit-scrollbar]:hidden">
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
              onClick={() => onSelect(t.id)}
              className={`relative min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap py-3 text-[14px] md:text-[15px] ${on ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              {t.label}
              {typeof t.count === 'number' && <span className="ml-1.5 text-[12px] font-normal tabular-nums text-gray-400">{t.count}</span>}
              {on && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-gray-900" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
