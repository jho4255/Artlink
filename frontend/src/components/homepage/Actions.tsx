import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * 홈페이지 버튼 한 벌 (2026-11-14, CLAUDE.md 규칙 82 — 사용자 지적 "웹에서 문의하기·이웃 추가·공유 디자인이 튄다, 일관성이 없다").
 *
 * 작가 홈페이지 · 갤러리 홈페이지 · 작품 페이지가 **이것만** 쓴다:
 *  · 탭 줄 오른쪽 묶음(`TabActions`, 2026-11-15) — [문의하기] · 이웃 추가 · (찜) · 공유 · QR. 전부 **같은 '아이콘 + 글자' 모양**이고
 *    [문의하기](`InquiryAction`)만 **테마 강조색 · 굵은 글자**로 다르다. ⚠️ 이 줄에 채움 상자를 섞지 말 것 — 검은 [문의하기] 하나가 글자 링크들
 *    사이에 '띡' 놓여 있었다(사용자 지적). 탭 줄이 내리면 머리 밑에 붙어 따라오므로 어디까지 내려가도 보인다.
 *  · 혼자 서는 주 버튼(`PrimaryAction`) — 채움 · 높이 44 · 각짐. 문의 창의 [보내기] · 작품 페이지의 [작품 문의하기] 처럼 **둘레에 다른 단추가 나란히 없는 자리**만.
 *  · 보조(`LinkAction`) — 아이콘 14 + 글자 14 · 보조 글자색 → 마우스를 올리면 글자색 + 밑줄 · 테두리·배경 없음.
 *  · 주인 도구(`OwnerLink`) — 테두리 1px · 높이 40. [수정] 하나.
 * 색은 `var(--hp-…)` 만 — 작가가 고른 배경(어두운 색 포함)에서도 읽혀야 한다. 회색 클래스·둥근 알약·반투명 흰 바탕을 쓰지 말 것
 * (`homepageChrome.test.ts` 가 소스를 훑어 막는다).
 */
export const LINK_ACTION =
  'inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap text-[14px] text-[var(--hp-sub)] underline-offset-4 hover:text-[var(--hp-ink)] hover:underline disabled:cursor-default disabled:opacity-40';

export function PrimaryAction({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex h-11 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap bg-[var(--hp-ink)] px-5 text-[14px] font-medium text-[var(--hp-bg)] transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-50 ${className}`}
    />
  );
}

export function LinkAction({ icon: Icon, iconClassName, children, className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; iconClassName?: string }) {
  return (
    <button type={type} {...props} className={`${LINK_ACTION} ${className}`}>
      {Icon && <Icon size={14} aria-hidden className={iconClassName} />}
      {children}
    </button>
  );
}

/** [문의하기] — 다른 버튼과 같은 '아이콘 + 글자' 모양, 테마 강조색 · 굵은 글자로만 강조한다(2026-11-15) */
export const INQUIRY_ACTION =
  'inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-[var(--hp-accent)] underline-offset-4 hover:underline';

export function InquiryAction({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={INQUIRY_ACTION}>
      <MessageCircle size={15} strokeWidth={2.2} aria-hidden />
      문의하기
    </button>
  );
}

/**
 * 탭 줄 오른쪽 버튼 묶음 (2026-11-15 사용자: "문의하기·이웃 추가·공유·QR 은 작품/방명록 줄 오른쪽으로 — 내리면서도 볼 수 있게").
 * PC(lg↑)는 [문의하기] · 나머지를 한 줄로. 그 아래(휴대폰·태블릿)는 탭이 자리를 써야 해서 [문의하기] + [⋯](나머지를 작은 목록으로).
 * 순서는 부르는 쪽이 지킨다(문의 → 이웃 → 찜 → 공유 → QR). ⚠️ 두 배치를 CSS 로 둘 다 그려 감추지 말 것 — 같은 단추가 두 벌이 된다.
 * 목록은 바깥을 누르거나 Esc 로 닫히고, 안의 단추를 누르면 닫힌다(이웃 추가는 알림 글로 결과를 알린다).
 */
export function TabActions({ onInquiry, children }: { onInquiry?: (() => void) | null; children?: ReactNode }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEscapeKey(() => setOpen(false), { enabled: open, yieldToModal: true });
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const inquiry = onInquiry ? <InquiryAction onClick={onInquiry} /> : null;
  if (wide) {
    return <div className="flex shrink-0 items-center gap-5" data-testid="homepage-actions">{inquiry}{children}</div>;
  }
  return (
    <div ref={boxRef} className="relative flex shrink-0 items-center gap-1" data-testid="homepage-actions">
      {inquiry}
      {children && (
        <>
          <button
            type="button"
            aria-label="더 보기"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
            className="grid h-11 w-10 cursor-pointer place-items-center text-[var(--hp-sub)] hover:text-[var(--hp-ink)]"
          >
            <MoreHorizontal size={19} aria-hidden />
          </button>
          {open && (
            /* 안의 단추를 누르면 닫는다 — 공유·QR 은 다른 창이 뜨고, 이웃 추가는 알림 글로 알린다 */
            <div
              id={menuId}
              onClick={() => setOpen(false)}
              className="absolute right-0 top-full z-40 flex min-w-[168px] flex-col border border-[var(--hp-line)] bg-[var(--hp-bg)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] [&>*]:w-full [&>*]:justify-start [&>*]:px-4"
              data-testid="homepage-actions-menu"
            >
              {children}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function OwnerLink({ to, children, testId }: { to: string; children: ReactNode; testId?: string }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--hp-ink)] px-3.5 text-[14px] font-medium text-[var(--hp-ink)] hover:opacity-80"
    >
      {children}
    </Link>
  );
}
