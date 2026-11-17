import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * 홈페이지 머리 (2026-11-14, CLAUDE.md 규칙 82) — 작가·갤러리 홈페이지에서 ArtLink 상단바 대신 선다.
 *
 * 왼쪽에 **주인 이름**(누르면 그 홈페이지 첫 화면), 오른쪽에 (주인에게만) [수정] · 작은 ArtLink 글자(홈으로).
 * ⚠️ **탭을 여기 두지 말 것** — 2026-11-14 엔 PC 에서 탭을 이 머리 오른쪽에 두고 표지 아래 탭 줄을 감췄는데, 사용자가 "탭이 우측 상단에
 *    생겨서 잘 안 보인다"고 했다(2026-11-15). 탭 줄은 PC·휴대폰 모두 표지 바로 아래 하나이고, 내리면 이 머리 밑에 붙어 따라온다.
 *
 * - 높이는 `lib/siteMode.ts SITE_HEADER_H`(56 / lg 72) — 클래스 `h-14 lg:h-[72px]` 와 함께 바뀌어야 한다.
 * - 색은 `var(--hp-…)` — 페이지 루트가 얹은 테마를 따른다. 변수가 없으면(로딩 중 HandleRoute) 흰 바탕·검정 글자.
 * - 로딩 중에는 이름 자리를 비운 채 **같은 높이**로 그린다(데이터가 와도 머리가 튀지 않게).
 */
export default function SiteHeader({
  title, titleTo, ownerAction,
}: {
  title?: string | null;
  titleTo?: string;
  ownerAction?: ReactNode;
}) {
  const scrollTop = () => window.scrollTo({ top: 0 });
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ background: 'var(--hp-bg, #ffffff)', borderColor: 'var(--hp-line, #e5e7eb)' }}
      data-testid="site-header"
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-6 md:px-12 lg:h-[72px] lg:gap-8">
        {title ? (
          titleTo ? (
            <Link
              to={titleTo}
              onClick={scrollTop}
              className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] lg:text-[21px]"
              style={{ color: 'var(--hp-ink, #111827)', fontFamily: 'var(--hp-title-font)' }}
              data-testid="site-title"
            >
              {title}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-[17px] font-semibold lg:text-[21px]" style={{ color: 'var(--hp-ink, #111827)', fontFamily: 'var(--hp-title-font)' }}>{title}</span>
          )
        ) : null}

        <span className="flex-1" />

        {/* 오른쪽 — ml-auto 로 끝에 붙인다(이름이 짧아도 ArtLink 글자가 이름 바로 옆에 붙지 않게) */}
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {ownerAction}
          <ArtLinkMark />
        </div>
      </div>
    </header>
  );
}

/** 작은 ArtLink 글자 — 상단바가 없는 홈페이지에서 아트링크로 돌아가는 길(로고 규칙: Art 글자색 + Link 빨강) */
export function ArtLinkMark({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="ArtLink 홈으로"
      className={`inline-flex min-h-[44px] shrink-0 items-center font-serif text-[15px] font-bold tracking-tight lg:text-[17px] ${className}`}
      data-testid="artlink-mark"
    >
      <span style={{ color: 'var(--hp-ink, #111827)' }}>Art</span><span className="text-accent">Link</span>
    </Link>
  );
}
