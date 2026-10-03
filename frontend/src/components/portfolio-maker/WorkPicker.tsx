import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import type { PortfolioImage } from '@/types';
import Thumb from '@/components/shared/Thumb';
import { artworkTitle, hasTitle } from '@/lib/artwork';
import { moveId } from '@/lib/portfolioVersions';
import { isDefaultSelection } from '@/lib/portfolioMaker';
import { cn } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * 작품 고르기 — PDF 에 실을 작품과 순서 (2026-10-03, 옛 `PortfolioWorkPicker`).
 *
 * 국내 공모는 '10점 이내 · A4 24장' 처럼 장수를 제한하는 곳이 많아, 전체 작품을 싣는 책 하나로는 제출 요건을 못 맞춘다.
 * 고른 작품과 순서는 **구성**으로 저장된다(서버 모델은 `PortfolioVersion` 그대로 — 화면에서만 '버전' 이라 부르지 않는다).
 *
 * 예전과 달라진 것:
 *  - [+ 버전] 을 누르면 설명도 이름 입력도 없이 '새 버전' 이 생기고 토스트만 "작품을 골라 보세요" 였다(고르는 창은 안 열렸다).
 *    지금은 아래 바의 [작품 고르기] 가 **이 창을 바로 연다**. 전체를 그대로 두면 아무것도 만들지 않는다.
 *  - 고르는 동안 "N점 · 약 M쪽" 을 보여 준다 — 제한(10점·24장)을 보며 고를 수 있다.
 *  - 이름을 이 창에서 정한다. 구성을 지우는 것도 여기서.
 *  - 순서 화살표 44px(예전 18px).
 * 홈페이지의 작품 순서는 건드리지 않는다.
 */
export default function WorkPicker({ all, initial, mode, initialName, saving, countPages, onApply, onDelete, onClose }: {
  all: PortfolioImage[];
  /** 처음에 골라져 있는 작품(실릴 순서). 비어 있으면 전체 */
  initial: number[];
  /** new = 전체 작품에서 새로 고른다 · edit = 저장해 둔 구성을 고친다 */
  mode: 'new' | 'edit';
  initialName: string;
  saving?: boolean;
  /** 그 작품들로 만들면 몇 쪽인가 — 미리보기와 같은 엔진으로 센다 */
  countPages: (ids: number[]) => number;
  onApply: (v: { ids: number[]; name: string }) => void;
  /** 이 구성 지우기(edit 일 때만) — 확인창은 부모가 띄운다 */
  onDelete?: () => void;
  onClose: () => void;
}) {
  // 지운 작품 id 는 배열에 남아 있을 수 있다(FK 없음) — 그대로 번호를 매기면 격자 배지와 순서 띠의 번호가 어긋난다
  const allIds = useMemo(() => all.map((w) => w.id), [all]);
  const [ids, setIds] = useState<number[]>(() => {
    const existing = new Set(allIds);
    const kept = initial.filter((id) => existing.has(id));
    return kept.length ? kept : allIds;
  });
  const [name, setName] = useState(initialName);
  const nameId = useId();
  const byId = useMemo(() => new Map(all.map((w) => [w.id, w] as const)), [all]);
  const order = useMemo(() => new Map(ids.map((id, i) => [id, i + 1] as const)), [ids]);
  const pages = useMemo(() => (ids.length ? countPages(ids) : 0), [ids, countPages]);

  useEscapeKey(onClose, { enabled: !saving });
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggle = (id: number) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allSelected = ids.length === all.length;
  // 전체를 홈페이지 순서 그대로 — 새로 만들 구성이 아니다(그게 곧 '전체 작품'이다)
  const untouched = mode === 'new' && isDefaultSelection(allIds, ids);
  const canApply = ids.length > 0 && !saving && (untouched || name.trim().length > 0);

  const arrow = 'grid h-11 w-10 place-items-center text-gray-500 hover:text-gray-950 disabled:opacity-25';
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={() => { if (!saving) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="작품 고르기"
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-950">작품 고르기</h3>
            <p className="mt-0.5 break-keep text-sm text-gray-600">
              실을 작품을 누르세요. 누른 순서대로 실립니다.
            </p>
            <p className="mt-1 text-sm font-medium tabular-nums text-gray-950" data-testid="picker-count">
              {ids.length}점{ids.length > 0 && <span className="font-normal text-gray-500"> · 약 {pages}쪽</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setIds(allSelected ? [] : allIds)}
              className="inline-flex min-h-[44px] items-center whitespace-nowrap px-2 text-sm text-gray-700 underline-offset-4 hover:underline"
            >
              {allSelected ? '전체 해제' : '전체 선택'}
            </button>
            <button type="button" onClick={onClose} disabled={saving} aria-label="닫기" className="-mr-2 grid h-11 w-11 place-items-center text-gray-500 hover:text-gray-900"><X size={20} /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {all.map((w) => {
              const n = order.get(w.id);
              const title = hasTitle(w) ? artworkTitle(w) : null;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => toggle(w.id)}
                  aria-pressed={!!n}
                  aria-label={`${title ?? '작품'}${n ? ` — ${n}번째로 실림` : ' — 싣지 않음'}`}
                  className={cn('relative aspect-square overflow-hidden rounded-lg border-2 bg-gray-50', n ? 'border-gray-900' : 'border-transparent opacity-50 hover:opacity-100')}
                >
                  <Thumb src={w.url} size="grid" alt="" className="h-full w-full object-contain" />
                  {n ? (
                    <span className="absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-gray-900 px-1.5 text-xs font-semibold tabular-nums text-white">{n}</span>
                  ) : (
                    <span aria-hidden className="absolute left-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-white bg-black/25" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 실릴 순서 — 드래그는 터치에서 안 되므로 버튼으로 옮긴다 */}
        <div className="shrink-0 border-t border-gray-200 px-5 pb-1 pt-3">
          <p className="text-xs font-medium text-gray-600">실릴 순서 <span className="font-normal text-gray-500">— 화살표로 앞뒤로 옮깁니다</span></p>
          <div className="mt-2 flex gap-1 overflow-x-auto pb-2">
            {ids.map((id, i) => {
              const w = byId.get(id);
              if (!w) return null;
              return (
                <div key={id} className="flex shrink-0 flex-col items-center">
                  <div className="relative h-14 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <Thumb src={w.url} size="grid" alt="" className="h-full w-full object-contain" />
                    <span className="absolute left-0.5 top-0.5 rounded bg-gray-900/85 px-1 text-xs font-medium tabular-nums text-white">{i + 1}</span>
                  </div>
                  <div className="flex">
                    <button type="button" onClick={() => setIds((c) => moveId(c, id, -1))} disabled={i === 0} aria-label={`${i + 1}번째 작품을 앞으로`} className={arrow}><ChevronLeft size={18} /></button>
                    <button type="button" onClick={() => setIds((c) => moveId(c, id, 1))} disabled={i === ids.length - 1} aria-label={`${i + 1}번째 작품을 뒤로`} className={arrow}><ChevronRight size={18} /></button>
                  </div>
                </div>
              );
            })}
            {ids.length === 0 && <p className="py-4 text-sm text-gray-500">작품을 하나 이상 골라 주세요.</p>}
          </div>
        </div>

        <div className="shrink-0 border-t border-gray-200 px-5 py-3">
          {!untouched && (
            <label htmlFor={nameId} className="mb-3 block">
              <span className="text-xs font-medium text-gray-600">이 구성의 이름 <span className="font-normal text-gray-500">— 다음에 다시 꺼내 쓸 수 있게 저장됩니다. 홈페이지의 작품 순서는 바뀌지 않아요.</span></span>
              <input
                id={nameId}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 제출용 1"
                className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-gray-500 focus:outline-none"
              />
            </label>
          )}
          <div className="flex items-center gap-2">
            {mode === 'edit' && onDelete && (
              <button type="button" onClick={onDelete} disabled={saving} className="mr-auto inline-flex min-h-[44px] items-center gap-1 text-sm text-accent underline-offset-4 hover:underline">
                <Trash2 size={14} aria-hidden /> 이 구성 지우기
              </button>
            )}
            <button type="button" onClick={onClose} disabled={saving} className="ml-auto min-h-[44px] px-3 text-sm text-gray-600 hover:text-gray-950">취소</button>
            <button
              type="button"
              disabled={!canApply}
              onClick={() => (untouched ? onClose() : onApply({ ids, name: name.trim() }))}
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <Check size={15} aria-hidden />
              {saving ? '저장 중…' : untouched ? '전체 작품 그대로' : mode === 'edit' ? `${ids.length}점으로 저장` : `${ids.length}점으로 만들기`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
