import { useState, useEffect } from 'react';
import { Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Career, CareerEntry } from '@/types';

type CareerKey = keyof Career;

const CATEGORIES: { key: CareerKey; label: string }[] = [
  { key: 'artFair', label: '아트페어' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
];

interface NoneState {
  artFair: boolean;
  solo: boolean;
  group: boolean;
}

interface CareerEditorProps {
  value: Career;
  onChange: (career: Career) => void;
  /** "없음" 체크 상태 (지원서 모드). 미제공 시 체크박스 없이 단순 편집(포트폴리오 모드) */
  none?: NoneState;
  onNoneChange?: (none: NoneState) => void;
  /** 검증 에러로 강조할 카테고리 키 집합 */
  errorKeys?: Set<string>;
}

/**
 * 경력 편집기 — 아트페어/개인전/단체전 각각 [연도][내용] 행을 +/-로 추가·삭제.
 * - 포트폴리오/지원서 공용. 지원서에서는 none/onNoneChange를 넘겨 "없음" 체크 게이트를 사용.
 */
export default function CareerEditor({ value, onChange, none, onNoneChange, errorKeys }: CareerEditorProps) {
  const showNone = !!none && !!onNoneChange;

  const setEntries = (key: CareerKey, entries: CareerEntry[]) => {
    onChange({ ...value, [key]: entries });
  };

  // 아트페어: 자유 입력(여러 줄). 한 줄 = 한 건. 이력이 많을 때 +/- 없이 한 번에 입력.
  const entriesToText = (entries: CareerEntry[]) =>
    entries.map((e) => [e.year, e.content].filter(Boolean).join(' ')).join('\n');
  const [artFairRaw, setArtFairRaw] = useState(() => entriesToText(value.artFair));
  useEffect(() => {
    // 외부에서 value.artFair가 교체되면(포트폴리오 불러오기 등) 동기화
    const incoming = entriesToText(value.artFair);
    const currentFiltered = artFairRaw.split('\n').filter((l) => l.trim()).join('\n');
    if (incoming !== currentFiltered) setArtFairRaw(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.artFair]);
  const setArtFairText = (text: string) => {
    setArtFairRaw(text);
    const entries = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => ({ year: '', content: line }));
    setEntries('artFair', entries);
  };

  const addRow = (key: CareerKey) => {
    setEntries(key, [...value[key], { year: '', content: '' }]);
  };

  const updateRow = (key: CareerKey, idx: number, patch: Partial<CareerEntry>) => {
    setEntries(key, value[key].map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const removeRow = (key: CareerKey, idx: number) => {
    setEntries(key, value[key].filter((_, i) => i !== idx));
  };

  const toggleNone = (key: CareerKey, checked: boolean) => {
    if (!none || !onNoneChange) return;
    onNoneChange({ ...none, [key]: checked });
    if (checked) setEntries(key, []); // 없음 체크 시 해당 카테고리 비움
  };

  return (
    <div className="space-y-4">
      {CATEGORIES.map(({ key, label }) => {
        const entries = value[key];
        const noneChecked = showNone && none![key];
        const hasError = errorKeys?.has(key);
        return (
          <div
            key={key}
            className={cn(
              'rounded-lg border p-3',
              hasError ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-200',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={cn('text-sm font-medium', hasError ? 'text-red-600' : 'text-gray-700')}>
                {label}
              </span>
              <div className="flex items-center gap-3">
                {showNone && (
                  <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={noneChecked}
                      onChange={(e) => toggleNone(key, e.target.checked)}
                    />
                    없음
                  </label>
                )}
                {key !== 'artFair' && (
                  <button
                    type="button"
                    onClick={() => addRow(key)}
                    disabled={noneChecked}
                    className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Plus size={14} /> 추가
                  </button>
                )}
              </div>
            </div>

            {noneChecked ? (
              <p className="text-xs text-gray-400 py-1">없음으로 표시됩니다.</p>
            ) : key === 'artFair' ? (
              <textarea
                value={artFairRaw}
                onChange={(e) => setArtFairText(e.target.value)}
                placeholder={'예: 2026 아트링크 주관 아트페어 참여\n(한 줄에 한 건씩 자유롭게 입력하세요)'}
                rows={4}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm resize-y leading-relaxed focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder:text-gray-300"
              />
            ) : entries.length === 0 ? (
              <p className="text-xs text-gray-400 py-1">[추가] 버튼으로 경력을 입력하세요.</p>
            ) : (
              <div className="space-y-2">
                {entries.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.year}
                      onChange={(e) => updateRow(key, idx, { year: e.target.value })}
                      placeholder="연도"
                      className="w-20 shrink-0 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                    <input
                      type="text"
                      value={entry.content}
                      onChange={(e) => updateRow(key, idx, { content: e.target.value })}
                      placeholder="내용 (전시명 / 장소 등)"
                      className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(key, idx)}
                      aria-label="삭제"
                      className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 cursor-pointer"
                    >
                      <Minus size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
