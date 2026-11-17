import { cn } from '@/lib/utils';
import { savedAtLabel } from '@/lib/formDraft';

export interface MissingField { key: string; label: string }

/**
 * 등록 화면 하단 고정 줄(2026-11-15 — 갤러리·공모·전시 등록 공통). 지원서·홈페이지 편집과 같은 자리:
 * 휴대폰은 하단 탭바 위, PC 는 화면 맨 아래. 예전엔 [등록 요청]이 폼 맨 끝(휴대폰 3,009px)에 있었다.
 *  · 왼쪽 — '남은 필수 N · 칸 이름'(누르면 그 칸으로) · 임시저장 시각
 *  · 오른쪽 — [미리보기](좁은 화면만) · [임시저장] · [등록 요청]
 * ⚠️ 이 줄은 폼을 감싼 상자의 **마지막 자식**으로 둘 것 — sticky 는 그 상자 안에서만 붙는다.
 */
export default function StickySubmitBar({ missing, onJump, savedAt, onSaveDraft, onPreview, onCancel, submitLabel, onSubmit, pending }: {
  missing: MissingField[];
  onJump: (key: string) => void;
  savedAt?: number | null;
  onSaveDraft?: () => void;
  onPreview?: () => void;
  onCancel?: () => void;
  submitLabel: string;
  onSubmit: () => void;
  pending?: boolean;
}) {
  const first = missing[0];
  return (
    <div data-submit-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mt-10 border-t border-gray-200 bg-white/95 backdrop-blur lg:bottom-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <div className="order-1 flex min-w-0 flex-1 items-center justify-between gap-3 text-[13px] text-gray-500 sm:justify-start sm:text-sm">
          <p className="min-w-0">
            {first ? (
              <button type="button" onClick={() => onJump(first.key)} className="min-h-[32px] text-left text-accent underline underline-offset-4">
                남은 필수 {missing.length} · {missing.slice(0, 2).map((m) => m.label).join(', ')}{missing.length > 2 ? ' …' : ''}
              </button>
            ) : (
              <span className="text-gray-700">필수 항목을 다 채웠어요</span>
            )}
            {savedAt ? <span className="ml-3 hidden text-gray-500 sm:inline">{savedAtLabel(savedAt)} 임시저장됨</span> : null}
          </p>
          {/* 휴대폰 — 큰 단추는 [미리보기]·[등록 요청] 둘. 임시저장은 이 줄 오른쪽 글자 단추(넓은 화면은 아래 테두리 단추) */}
          {onSaveDraft && onPreview && (
            <button type="button" onClick={onSaveDraft} className="min-h-[32px] shrink-0 text-gray-700 underline underline-offset-4 sm:hidden">임시저장</button>
          )}
        </div>
        <div className="order-2 flex w-full items-center gap-2 sm:w-auto">
          {onCancel && (
            <button type="button" onClick={onCancel} className="hidden min-h-[44px] px-2 text-sm text-gray-500 hover:text-gray-900 sm:block">취소</button>
          )}
          {onPreview && (
            <button type="button" onClick={onPreview} className="min-h-[46px] rounded-lg border border-gray-300 bg-white px-4 text-[15px] text-gray-800 hover:bg-gray-50">
              미리보기
            </button>
          )}
          {onSaveDraft && (
            <button type="button" onClick={onSaveDraft} className={cn('min-h-[46px] rounded-lg border border-gray-300 bg-white px-4 text-[15px] text-gray-800 hover:bg-gray-50', onPreview && 'hidden sm:block')}>
              임시저장
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending}
            className="min-h-[46px] flex-1 rounded-lg bg-gray-900 px-6 text-[15px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50 sm:flex-none"
          >
            {pending ? '보내는 중…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
