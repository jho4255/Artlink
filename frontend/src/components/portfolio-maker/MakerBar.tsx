import { Check, FileDown, Images, Loader2, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CUSTOMIZE_TABS, type CustomizeTab } from '@/lib/portfolioMaker';

export type DesignSaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 아래 바 — [꾸미기] · [작품 고르기] · 디자인 저장 상태 · **[PDF 저장]** (2026-10-03).
 *
 * 좁은 화면에는 그 위에 **편집 탭 줄** [표지 · 작품 · 약력 · 색·글꼴 · 이름·연락처] 이 늘 보인다(2026-10-03 사용자 결정 —
 * "표지 고치기를 안 눌러도 편집 화면이 보여야 한다, 못 찾을 수도"). 누르면 그 탭의 시트가 올라온다. 넓은 화면은 편집 패널이
 * 처음부터 열려 있으므로 탭 줄 대신 [꾸미기](패널 열고 닫기) 하나다.
 *
 * 화면 아래에 붙어 따라온다. 미리보기를 어디까지 내려 보고 있든 저장과 꾸미기가 손에 닿는다
 * (예전: PC 는 [PDF 저장] 이 첫 화면 밖 y856, 휴대폰은 세부 설정을 다 지난 y884 였다).
 *
 * ⚠️ 모바일에서는 **하단 탭바 위**에 붙인다 — 홈페이지 편집 화면의 저장 바와 같은 클래스(규칙 60).
 *    `bottom-0` 이면 탭바(fixed z-40) 밑에 깔려 눌리지 않는다.
 * ⚠️ 버튼 줄은 **한 줄**이어야 한다(좁은 화면의 탭 줄은 그 위에 따로 한 줄). 꺾이면 그만큼 미리보기를 덮는다 — 그래서 380px 아래에서는 아이콘을 빼고,
 *    저장 상태 글자는 sm 이상에서만 보인다. 화면의 주 버튼(검정)은 [PDF 저장] 하나다.
 * 디자인은 고르는 즉시 저장된다 — 예전엔 아무 표시가 없어 'PDF 저장' 과 헷갈렸다. 여기 작은 글자로 말해 준다.
 */
export default function MakerBar({ customizing, onCustomize, onTab, onPickWorks, selected, total, saveState, onRetrySave, onSave }: {
  customizing: boolean;
  onCustomize: () => void;
  /** 좁은 화면의 탭 줄 — 그 탭의 편집 시트를 연다 */
  onTab: (t: CustomizeTab) => void;
  onPickWorks: () => void;
  /** 실리는 작품 수 / 전체 작품 수 */
  selected: number;
  total: number;
  saveState: DesignSaveState;
  onRetrySave: () => void;
  onSave: () => void;
}) {
  const secondary = 'inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50 sm:px-4';
  const icon = 'hidden min-[380px]:inline';
  return (
    <div data-maker-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 -mx-6 mt-8 border-t border-gray-200 bg-white/95 px-6 py-2 backdrop-blur md:-mx-12 md:px-12 lg:bottom-0 lg:py-3">
      {/* 좁은 화면에는 저장 상태 글자가 없다(한 줄을 지키려고) — 다만 **실패**는 알려야 한다. 그때만 바 위에 한 줄이 더 생긴다 */}
      {saveState === 'error' && (
        <p role="alert" className="mb-2 flex items-center justify-between gap-2 text-xs text-accent sm:hidden">
          디자인을 저장하지 못했어요
          <button type="button" onClick={onRetrySave} className="-my-2 inline-flex min-h-[40px] shrink-0 items-center px-1 font-medium underline underline-offset-4">다시 시도</button>
        </p>
      )}
      {/* 좁은 화면 — 편집 탭 줄. 폭은 글자만큼(flex-auto): 다섯이 320px 화면에서도 한 줄에 든다 */}
      <div role="group" aria-label="편집" className="mb-2 flex gap-0.5 rounded-lg bg-gray-100 p-0.5 lg:hidden">
        {CUSTOMIZE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className="inline-flex min-h-[40px] flex-auto items-center justify-center whitespace-nowrap rounded-md px-1 text-[13px] font-medium text-gray-800 hover:bg-white min-[380px]:text-sm"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCustomize} aria-pressed={customizing} className={cn(secondary, 'hidden lg:inline-flex', customizing ? 'border-gray-900' : 'border-gray-300')}>
          <SlidersHorizontal size={15} aria-hidden className={icon} /> 꾸미기
        </button>
        <button type="button" onClick={onPickWorks} className={cn(secondary, 'border-gray-300')}>
          <Images size={15} aria-hidden className={icon} /> 작품 고르기
          <span className="hidden font-normal tabular-nums text-gray-500 sm:inline">{selected}/{total}</span>
        </button>
        <p role="status" className="mx-auto hidden min-w-0 items-center gap-1 truncate px-2 text-xs text-gray-500 sm:flex">
          {saveState === 'saving' && <><Loader2 size={12} className="animate-spin" aria-hidden /> 디자인 저장 중…</>}
          {saveState === 'saved' && <><Check size={12} aria-hidden /> 디자인 저장됨</>}
          {saveState === 'error' && (
            <span className="text-accent">
              디자인을 저장하지 못했어요 · <button type="button" onClick={onRetrySave} className="underline underline-offset-4">다시 시도</button>
            </span>
          )}
          {saveState === 'idle' && '고른 디자인은 바로 저장됩니다'}
        </p>
        <button type="button" onClick={onSave} className="ml-auto inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 sm:ml-0 sm:px-5">
          <FileDown size={15} aria-hidden className={icon} /> PDF 저장
        </button>
      </div>
    </div>
  );
}
