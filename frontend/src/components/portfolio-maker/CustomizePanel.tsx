import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { CUSTOMIZE_TABS, type CustomizeTab } from '@/lib/portfolioMaker';
import type { PdfDesign, PortfolioBookData } from '@/lib/portfolioFormats';
import type { PortfolioImage } from '@/types';
import { CoverTab, CvTab, InfoTab, StyleTab, WorksTab } from './customizeTabs';

/** 좁은 화면에서 꾸미기 시트가 차지하는 높이(화면의 비율) — 그 위로 미리보기가 계속 보인다 */
export const SHEET_VH = 0.52;

/**
 * 꾸미기(편집) — 표지 · 작품 · 약력 · 색·글꼴 · 이름·연락처 (2026-10-03).
 *
 * 첫 판은 닫힌 채로 시작했다(다 펴면 누를 것 68개라 "이걸 다 정해야 하나" 로 읽혔다). 그런데 사용자 검토에서
 * "표지 고치기를 안 눌러도 편집 화면이 보여야 한다 — 못 찾을 수도" 가 나와 **처음부터 보이게** 바꿨다.
 *  - 넓은 화면: 미리보기 **오른쪽**에 붙는 패널(360px)이 열린 채로 시작한다. 패널 하나만 스크롤한다 —
 *    예전의 '스크롤 안의 스크롤'(1,126px 내용이 420px 상자)과 달리 패널 높이가 화면 높이를 다 쓴다.
 *  - 좁은 화면: 아래 바 위의 **탭 줄**이 늘 보이고(`MakerBar`), 누르면 아래에서 시트(화면의 52%)가 올라온다.
 *    **뒤 화면을 잠그지 않는다** — 위쪽에 미리보기가 보이고 스크롤도 된다. 하단 탭바·아래 바를 덮으므로 시트 머리에 [완료] 가 있다.
 *
 * 한 탭의 옵션은 그 쪽만 바꾼다. 맨 아래 [처음 상태로] 도 **그 탭만** 되돌린다(`resetTab`).
 * 묶음을 바꾸면 부모가 미리보기를 그 묶음이 바꾸는 쪽으로 데려간다(`pageIndexForTab`).
 */
export default function CustomizePanel({ wide, tab, onTab, onClose, onReset, undo, onUndo, design, patch, book, works }: {
  /** 넓은 화면(lg 이상)인가 — 패널이냐 시트냐 */
  wide: boolean;
  tab: CustomizeTab;
  onTab: (t: CustomizeTab) => void;
  onClose: () => void;
  /** [처음 상태로] — **지금 탭의 값만** 되돌린다(`resetTab`). 확인창은 부모가 띄운다 */
  onReset: (tab: CustomizeTab) => void;
  /** 방금 이 패널에서 되돌린 것 — "'표지'를 처음 상태로 돌렸어요 · 되돌리기" */
  undo: { label: string } | null;
  onUndo: () => void;
  design: PdfDesign;
  patch: (p: Partial<PdfDesign>) => void;
  book: PortfolioBookData;
  works: PortfolioImage[];
}) {
  const body = useRef<HTMLDivElement>(null);
  // 묶음을 바꾸면 그 묶음의 첫머리부터
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [tab]);

  // 넓은 화면 — 패널 높이를 **보이는 띠**(패널 윗선 ~ 아래 바)에 맞춘다.
  // 패널은 열린 채로 시작하는데, 페이지 맨 위에서는 머리(용지·디자인 줄) 아래 y≈400 에서 시작한다. 높이를 화면 기준(100vh−11.5rem)으로
  // 고정해 두면 아랫부분 ~300px 이 아래 바 뒤에 깔려 그 안의 항목에 손이 닿지 않았다(하니스 ④). 스크롤하면 위로 붙으며 커진다.
  const sticky = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wide) return;
    let raf = 0;
    const fit = () => {
      raf = 0;
      const el = sticky.current;
      if (!el) return;
      const top = Math.max(el.getBoundingClientRect().top, 96);
      const barTop = document.querySelector('[data-maker-bar]')?.getBoundingClientRect().top ?? window.innerHeight;
      el.style.maxHeight = `${Math.max(240, Math.min(barTop, window.innerHeight) - top - 16)}px`;
    };
    const ask = () => { if (!raf) raf = window.requestAnimationFrame(fit); };
    fit();
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    // 위의 내용이 늘거나 줄면(디자인 6종 펼치기 · 할 일 줄이 사라짐) 패널 윗선이 움직인다 — 스크롤 없이도 다시 맞춘다
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(ask) : null;
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener('scroll', ask);
      window.removeEventListener('resize', ask);
      ro?.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [wide]);
  // Esc 로 닫기 — 다만 이 위에 창(저장·작품 고르기·크게 보기)이 떠 있으면 그 창이 닫힐 차례다(Esc 는 맨 위의 것 하나만 닫는다)
  useEscapeKey(onClose, { yieldToModal: true });

  const tabs = (
    // 탭마다 누르는 폭 40px 이상 — 글자 폭 그대로 두면 '표지' 가 24px 이다. 320px 화면에서도 넷이 한 줄에 들어오게 안쪽 여백은 폭에 따라 준다
    <div role="tablist" aria-label="꾸미기" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] min-[380px]:gap-1.5 [&::-webkit-scrollbar]:hidden">
      {CUSTOMIZE_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`pfm-tab-${t.id}`}
            aria-selected={on}
            aria-controls="pfm-panel"
            onClick={() => onTab(t.id)}
            className={cn('relative min-h-[48px] min-w-[40px] shrink-0 whitespace-nowrap px-1 text-sm min-[380px]:px-2', on ? 'font-semibold text-gray-950' : 'text-gray-500 hover:text-gray-900')}
          >
            {t.label}
            {on && <span aria-hidden className="absolute inset-x-1 bottom-0 h-[2px] bg-gray-900 min-[380px]:inset-x-2" />}
          </button>
        );
      })}
    </div>
  );

  const content: ReactNode = (
    <>
      {tab === 'cover' && <CoverTab design={design} patch={patch} works={works} />}
      {tab === 'works' && <WorksTab design={design} patch={patch} workCount={works.length} />}
      {tab === 'cv' && <CvTab design={design} patch={patch} book={book} />}
      {tab === 'style' && <StyleTab design={design} patch={patch} />}
      {tab === 'info' && <InfoTab design={design} patch={patch} book={book} />}
      {/* [이름·연락처] 에는 두지 않는다 — 꺼 둔 전화번호가 '처음 상태로' 한 번에 다시 실리면 안 된다 */}
      {(tab !== 'info' || undo) && (
        <div className="mt-8 border-t border-gray-100 pt-3">
          {undo ? (
            <p role="status" className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
              {undo.label}
              <button type="button" onClick={onUndo} className="inline-flex min-h-[40px] items-center gap-1 font-medium text-gray-950 underline underline-offset-4">
                <Undo2 size={14} aria-hidden /> 되돌리기
              </button>
            </p>
          ) : (
            <button type="button" onClick={() => onReset(tab)} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-gray-600 underline-offset-4 hover:text-gray-950 hover:underline">
              <RotateCcw size={14} aria-hidden /> {CUSTOMIZE_TABS.find((t) => t.id === tab)?.label} 처음 상태로
            </button>
          )}
        </div>
      )}
    </>
  );

  if (wide) {
    return (
      <aside aria-label="꾸미기" data-customize="panel" className="w-[360px] shrink-0">
        {/* 상단바(5rem) 아래에 붙어 따라온다. 높이는 화면에서 상단바·아래 바를 뺀 만큼 — 안쪽만 스크롤한다 */}
        <div ref={sticky} className="sticky top-24 flex max-h-[calc(100vh-11.5rem)] flex-col rounded-xl border border-gray-200 bg-white">
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 pl-2 pr-1.5">
            {tabs}
            <button type="button" onClick={onClose} aria-label="꾸미기 닫기" className="flex h-11 w-11 shrink-0 items-center justify-center text-gray-500 hover:text-gray-900"><X size={18} /></button>
          </div>
          <div ref={body} role="tabpanel" id="pfm-panel" aria-labelledby={`pfm-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {content}
          </div>
        </div>
      </aside>
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-label="꾸미기"
      data-customize="sheet"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(17,24,39,0.10)]"
      style={{ height: `${SHEET_VH * 100}vh` }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 pl-3 pr-2 min-[380px]:pl-2">
        {tabs}
        <button type="button" onClick={onClose} className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg px-2 text-sm font-medium text-gray-950 hover:bg-gray-100 min-[380px]:px-3">완료</button>
      </div>
      <div ref={body} role="tabpanel" id="pfm-panel" aria-labelledby={`pfm-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">
        {content}
      </div>
    </div>,
    document.body,
  );
}
