import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import type { PortfolioImage } from '@/types';
import Thumb from '@/components/shared/Thumb';
import { artworkTitle, hasTitle } from '@/lib/artwork';
import { moveId } from '@/lib/portfolioVersions';

/**
 * 버전에 실을 **작품 고르기·순서 정하기** (2026-09-16).
 *
 * 위: 전체 작품 격자 — 누르면 선택/해제, 선택 순서가 번호로 찍힌다(그 순서가 곧 책의 순서).
 * 아래: 선택한 작품 띠 — ← → 로 순서를 바꾼다(드래그는 터치에서 안 되므로 버튼으로, 할 일 보드와 같은 이유).
 * 홈페이지 작품 순서는 건드리지 않는다.
 */
export default function PortfolioWorkPicker({ all, selected, onSave, onClose, saving }: {
  all: PortfolioImage[];
  /** 지금 버전의 선택(실릴 순서). 비어 있으면 '전체' */
  selected: number[];
  onSave: (ids: number[]) => void;
  onClose: () => void;
  saving?: boolean;
}) {
  // 지운 작품 id 는 배열에 남아 있다(FK 없음) — 그대로 번호를 매기면 격자 배지와 순서 띠의 번호가 어긋난다(감사 M9)
  const [ids, setIds] = useState<number[]>(() => {
    const existing = new Set(all.map((w) => w.id));
    const kept = selected.filter((id) => existing.has(id));
    return kept.length ? kept : all.map((w) => w.id);
  });
  const byId = useMemo(() => new Map(all.map((w) => [w.id, w] as const)), [all]);
  const order = useMemo(() => new Map(ids.map((id, i) => [id, i + 1] as const)), [ids]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: number) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allSelected = ids.length === all.length;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="작품 고르기">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-[15px] font-semibold">작품 고르기</h3>
            <p className="text-[11px] text-gray-400">누른 순서대로 실립니다 · {ids.length}/{all.length}점</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIds(allSelected ? [] : all.map((w) => w.id))}
              className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
              {allSelected ? '전체 해제' : '전체 선택'}
            </button>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="닫기"><X size={18} /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {all.map((w) => {
              const n = order.get(w.id);
              return (
                <button key={w.id} type="button" onClick={() => toggle(w.id)} title={hasTitle(w) ? artworkTitle(w) : undefined}
                  className={`relative aspect-square overflow-hidden rounded-md border-2 bg-gray-50 ${n ? 'border-gray-900' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                  <Thumb src={w.url} size="grid" alt="" className="h-full w-full object-contain" />
                  {n ? (
                    <span className="absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-gray-900 px-1.5 text-[11px] font-semibold text-white">{n}</span>
                  ) : (
                    <span className="absolute left-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-white/90 bg-black/20" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 선택 순서 띠 */}
        <div className="border-t border-gray-100 px-5 py-3">
          <p className="mb-2 text-[11px] font-medium text-gray-500">실릴 순서 <span className="font-normal text-gray-400">— ← → 로 옮기기</span></p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ids.map((id, i) => {
              const w = byId.get(id);
              if (!w) return null;
              return (
                <div key={id} className="flex shrink-0 flex-col items-center gap-1">
                  <div className="relative h-14 w-14 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    <Thumb src={w.url} size="grid" alt="" className="h-full w-full object-contain" />
                    <span className="absolute left-0.5 top-0.5 rounded bg-gray-900/80 px-1 text-[10px] text-white">{i + 1}</span>
                  </div>
                  <div className="flex gap-0.5">
                    <button type="button" onClick={() => setIds((c) => moveId(c, id, -1))} disabled={i === 0} aria-label="앞으로"
                      className="rounded p-0.5 text-gray-400 hover:text-gray-900 disabled:opacity-30"><ChevronLeft size={14} /></button>
                    <button type="button" onClick={() => setIds((c) => moveId(c, id, 1))} disabled={i === ids.length - 1} aria-label="뒤로"
                      className="rounded p-0.5 text-gray-400 hover:text-gray-900 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </div>
                </div>
              );
            })}
            {ids.length === 0 && <p className="text-xs text-gray-400">작품을 하나 이상 고르세요.</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button type="button" onClick={() => onSave(ids)} disabled={saving || ids.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            <Check size={14} /> {saving ? '저장 중…' : `${ids.length}점으로 저장`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
