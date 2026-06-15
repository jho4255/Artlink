import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Career, CareerEntry } from '@/types';

type CareerKey = keyof Career;

const CATEGORIES: { key: CareerKey; label: string }[] = [
  { key: 'artFair', label: '아트페어' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
];

const PLACEHOLDERS: Record<CareerKey, string> = {
  artFair: '예: 2026 아트링크 주관 아트페어 참여\n(한 줄에 한 건씩 자유롭게 입력하세요)',
  solo: '예: 2025 개인전 《빛의 결》 (서울)\n(한 줄에 한 건씩 자유롭게 입력하세요)',
  group: '예: 2024 청년작가 단체전 (부산)\n(한 줄에 한 건씩 자유롭게 입력하세요)',
};

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

// 엔트리 ↔ 텍스트 (한 줄 = 한 건). 기존 [연도][내용] 데이터는 "연도 내용" 한 줄로 합쳐 표시.
const entriesToText = (entries: CareerEntry[]) =>
  entries.map((e) => [e.year, e.content].filter(Boolean).join(' ')).join('\n');

/**
 * 경력 편집기 — 아트페어/개인전/단체전 모두 자유 입력 칸(textarea, 한 줄=한 건).
 * - 포트폴리오/지원서 공용. 지원서에서는 none/onNoneChange를 넘겨 "없음" 체크 게이트를 사용.
 */
export default function CareerEditor({ value, onChange, none, onNoneChange, errorKeys }: CareerEditorProps) {
  const showNone = !!none && !!onNoneChange;

  // 카테고리별 자유 입력 원문(raw). value가 외부에서 교체되면(포트폴리오 불러오기 등) 동기화.
  const [raw, setRaw] = useState<Record<CareerKey, string>>(() => ({
    artFair: entriesToText(value.artFair),
    solo: entriesToText(value.solo),
    group: entriesToText(value.group),
  }));
  useEffect(() => {
    setRaw((prev) => {
      const next = { ...prev };
      (Object.keys(prev) as CareerKey[]).forEach((k) => {
        const incoming = entriesToText(value[k]);
        // raw도 저장 시와 동일하게 줄별 trim 후 비교 — 안 그러면 입력 중 끝 공백이 즉시 지워짐(스페이스 안 먹힘)
        const currentNormalized = prev[k].split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
        if (incoming !== currentNormalized) next[k] = incoming;
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.artFair, value.solo, value.group]);

  const setText = (key: CareerKey, text: string) => {
    setRaw((prev) => ({ ...prev, [key]: text }));
    const entries = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => ({ year: '', content: line }));
    onChange({ ...value, [key]: entries });
  };

  const toggleNone = (key: CareerKey, checked: boolean) => {
    if (!none || !onNoneChange) return;
    onNoneChange({ ...none, [key]: checked });
    if (checked) { // 없음 체크 시 해당 카테고리 비움
      setRaw((prev) => ({ ...prev, [key]: '' }));
      onChange({ ...value, [key]: [] });
    }
  };

  return (
    <div className="space-y-4">
      {CATEGORIES.map(({ key, label }) => {
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
            </div>

            {noneChecked ? (
              <p className="text-xs text-gray-400 py-1">없음으로 표시됩니다.</p>
            ) : (
              <textarea
                value={raw[key]}
                onChange={(e) => setText(key, e.target.value)}
                placeholder={PLACEHOLDERS[key]}
                rows={4}
                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm resize-y leading-relaxed focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder:text-gray-300"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
