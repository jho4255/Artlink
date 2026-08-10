import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Career, CareerEntry, CareerKey } from '@/types';

export interface CareerCategory { key: CareerKey; label: string; placeholder?: string }

/** 지원서 기본 3종. 포트폴리오는 여기에 학력·수상을 더해 5종을 쓴다(PORTFOLIO_CATEGORIES). */
export const APPLY_CATEGORIES: CareerCategory[] = [
  { key: 'artFair', label: '아트페어', placeholder: '예: 2026 아트링크 주관 아트페어 참여' },
  { key: 'solo', label: '개인전', placeholder: '예: 2025 개인전 《빛의 결》 (서울)' },
  { key: 'group', label: '단체전', placeholder: '예: 2024 청년작가 단체전 (부산)' },
];

/**
 * 포트폴리오용 경력 항목. 레퍼런스 포트폴리오의 CV는 모두
 * [학력 → 개인전 → 단체전 → 아트페어 → 수상]을 이 순서로 싣는다.
 */
export const PORTFOLIO_CATEGORIES: CareerCategory[] = [
  { key: 'education', label: '학력', placeholder: '예: 2013 ○○대학교 서양화과 졸업' },
  { key: 'solo', label: '개인전', placeholder: '예: 2025 개인전 《빛의 결》, ○○갤러리, 서울' },
  { key: 'group', label: '단체전', placeholder: '예: 2024 단체전 《각양각색》, ○○미술관, 서울' },
  { key: 'artFair', label: '아트페어', placeholder: '예: 2025 화랑미술제, 코엑스, 서울' },
  { key: 'award', label: '수상 및 선정', placeholder: '예: 2024 ○○미술대전 우수상' },
];

type NoneState = Partial<Record<CareerKey, boolean>>;

interface CareerEditorProps {
  value: Career;
  onChange: (career: Career) => void;
  /** 편집할 항목. 미지정 시 지원서 기본 3종 */
  categories?: CareerCategory[];
  /** "없음" 체크 상태 (지원서 모드). 미제공 시 체크박스 없이 단순 편집(포트폴리오 모드) */
  none?: NoneState;
  onNoneChange?: (none: NoneState) => void;
  /** 검증 에러로 강조할 카테고리 키 집합 */
  errorKeys?: Set<string>;
}

// 엔트리 ↔ 텍스트 (한 줄 = 한 건). 기존 [연도][내용] 데이터는 "연도 내용" 한 줄로 합쳐 표시.
const entriesToText = (entries?: CareerEntry[]) =>
  (entries ?? []).map((e) => [e.year, e.content].filter(Boolean).join(' ')).join('\n');

/**
 * 경력 편집기 — 각 항목이 자유 입력 칸(textarea, 한 줄=한 건).
 * - 포트폴리오/지원서 공용. 지원서에서는 none/onNoneChange를 넘겨 "없음" 체크 게이트를 사용.
 */
export default function CareerEditor({ value, onChange, categories = APPLY_CATEGORIES, none, onNoneChange, errorKeys }: CareerEditorProps) {
  const showNone = !!none && !!onNoneChange;
  const keys = categories.map((c) => c.key);
  const keySig = keys.join(',');

  // 카테고리별 자유 입력 원문(raw). value가 외부에서 교체되면(포트폴리오 불러오기 등) 동기화.
  const [raw, setRaw] = useState<Partial<Record<CareerKey, string>>>(() =>
    Object.fromEntries(keys.map((k) => [k, entriesToText(value[k])])),
  );
  useEffect(() => {
    setRaw((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        const incoming = entriesToText(value[k]);
        // raw도 저장 시와 동일하게 줄별 trim 후 비교 — 안 그러면 입력 중 끝 공백이 즉시 지워짐(스페이스 안 먹힘)
        const currentNormalized = (prev[k] ?? '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
        if (incoming !== currentNormalized) next[k] = incoming;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.artFair, value.solo, value.group, value.education, value.award, keySig]);

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
      {categories.map(({ key, label, placeholder }) => {
        const noneChecked = showNone && !!none![key];
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
                <label className="flex items-center gap-1.5 px-1 -my-2 min-h-[44px] text-xs text-gray-500 cursor-pointer select-none">
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
                value={raw[key] ?? ''}
                onChange={(e) => setText(key, e.target.value)}
                placeholder={`${placeholder ?? ''}\n(한 줄에 한 건씩 자유롭게 입력하세요)`}
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
