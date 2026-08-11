import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { composeSize, splitSize } from '@/lib/artwork';
import type { ArtworkStatus, PortfolioImage } from '@/types';

export interface ArtworkMetaDraft {
  title: string;
  series: string;
  medium: string;
  sizeText: string;
  year: string;
  description: string;
  status: ArtworkStatus | '';
}

export function toDraft(img: PortfolioImage): ArtworkMetaDraft {
  return {
    title: img.title ?? '',
    series: img.series ?? '',
    medium: img.medium ?? '',
    sizeText: img.sizeText ?? '',
    year: img.year ?? '',
    description: img.description ?? '',
    status: img.status ?? '',
  };
}

const STATUSES: { value: ArtworkStatus | ''; label: string }[] = [
  { value: '', label: '표기 안 함' },
  { value: 'AVAILABLE', label: '판매 가능' },
  { value: 'SOLD', label: '판매 완료' },
  { value: 'NFS', label: '비매' },
];

const field = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400';
const label = 'text-xs font-medium text-gray-500 block mb-1';

interface Props {
  image: PortfolioImage;
  /** 이미 등록된 시리즈명 — 오타로 시리즈가 갈라지지 않게 자동완성으로 제시한다 */
  seriesOptions: string[];
  saving?: boolean;
  onSave: (draft: ArtworkMetaDraft) => void;
  onClose: () => void;
}

/**
 * 작품 정보 입력 — 포트폴리오의 핵심 보강.
 *
 * 레퍼런스 포트폴리오는 예외 없이 작품마다 [제목/재료/크기/연도]를 붙인다. 우리 쪽엔 이 정보가
 * 아예 없어서 PDF를 만들면 캡션이 통째로 빠진 "이미지 더미"가 나왔다. 여기서 그 값을 받는다.
 * 크기는 가로·세로 숫자로만 받아 `composeSize`로 한 형식(72.7×90.9 cm)으로 합성한다.
 */
export default function ArtworkMetaModal({ image, seriesOptions, saving, onSave, onClose }: Props) {
  const [d, setD] = useState<ArtworkMetaDraft>(() => toDraft(image));
  const parsed = useMemo(() => splitSize(d.sizeText), [d.sizeText]);
  const [w, setW] = useState(parsed.w);
  const [h, setH] = useState(parsed.h);

  // 다른 작품으로 갈아끼우면 폼도 그 작품 값으로 새로 채운다
  useEffect(() => {
    const next = toDraft(image);
    setD(next);
    const p = splitSize(next.sizeText);
    setW(p.w); setH(p.h);
  }, [image.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<ArtworkMetaDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const setSize = (nw: string, nh: string) => { setW(nw); setH(nh); set({ sizeText: composeSize(nw, nh) }); };

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="작품 정보"
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-[15px]">작품 정보</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="닫기"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-4 items-center">
            <img src={image.url} alt="" className="w-24 h-24 object-contain bg-gray-50 rounded-lg flex-none" />
            <div className="flex-1 min-w-0">
              <label className={label}>작품명</label>
              <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="예: 리본이 피는 나무" className={field} />
            </div>
          </div>

            <div>
              <label className={label}>시리즈 <span className="font-normal text-gray-400">— 같은 시리즈끼리 묶여서 실립니다</span></label>
              <input
                value={d.series}
                onChange={(e) => set({ series: e.target.value })}
                list="artwork-series-options"
                placeholder="예: 산 시리즈 (없으면 비워두세요)"
                className={field}
              />
              <datalist id="artwork-series-options">
                {seriesOptions.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>

            <div>
              <label className={label}>크기</label>
              <div className="flex items-center gap-2">
                <input value={w} onChange={(e) => setSize(e.target.value, h)} placeholder="가로" inputMode="decimal" className={`${field} text-center`} />
                <span className="text-gray-400 text-sm">×</span>
                <input value={h} onChange={(e) => setSize(w, e.target.value)} placeholder="세로" inputMode="decimal" className={`${field} text-center`} />
                <span className="text-xs text-gray-500 shrink-0">cm</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>재료</label>
                <input value={d.medium} onChange={(e) => set({ medium: e.target.value })} placeholder="예: Acrylic on canvas" className={field} />
              </div>
              <div>
                <label className={label}>제작연도</label>
                <input value={d.year} onChange={(e) => set({ year: e.target.value })} placeholder="예: 2025" inputMode="numeric" className={field} />
              </div>
            </div>

            <div>
              <label className={label}>판매 상태</label>
              <div className="flex gap-1.5 flex-wrap">
                {STATUSES.map((s) => (
                  <button
                    key={s.value || 'none'}
                    onClick={() => set({ status: s.value })}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      d.status === s.value ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >{s.label}</button>
                ))}
              </div>
            </div>

            <div>
              <label className={label}>작품 설명 <span className="font-normal text-gray-400">— 포맷 C에서 작품 옆에 실립니다</span></label>
              <textarea
                value={d.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="이 작품에 담은 이야기를 적어보세요. (선택)"
                rows={4}
                className={`${field} resize-y leading-relaxed`}
              />
            </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button
            onClick={() => onSave(d)}
            disabled={saving}
            className="flex-1 py-2.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}저장
          </button>
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-500">취소</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
