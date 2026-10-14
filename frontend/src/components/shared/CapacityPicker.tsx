/**
 * 모집 인원 칸 — [숫자로 · 0명 · 00명] (2026-10-14 사용자 요청)
 *
 * '0명'·'00명'은 국내 공고의 관례다(정확한 수를 밝히지 않고 한 자릿수·두 자릿수만 알린다).
 * 공고·목록에는 그 글자만 나가고, 수락은 0명 = 9명 · 00명 = 99명까지 된다(사용자 결정 — 규칙은 lib/utils.ts CAPACITY_MASKS).
 *
 * 쓰는 곳: 갤러리 공모 등록(MyPage) · 아트링크 주최 등록(HostedExhibitionsSection) · [지원자]의 [모집 인원 변경](ApplicantManager).
 * ⚠️ 고르는 단추는 `<input type="radio">` 가 아니라 `role="radio"` 버튼이다 — 칸 안의 `input` 은 숫자 칸 하나뿐이어야
 *    [모집 인원 변경] 의 E2E(66 G)가 그 칸을 바로 집는다.
 */
import { cn, CAPACITY_MASKS, CAPACITY_MAX, type CapacityMask } from '@/lib/utils';

export interface CapacityValue {
  capacity: number;
  capacityMask: CapacityMask | null;
}

const CHOICES: { mask: CapacityMask | null; label: string }[] = [
  { mask: null, label: '숫자로' },
  { mask: 'ONE', label: CAPACITY_MASKS.ONE.label },
  { mask: 'TWO', label: CAPACITY_MASKS.TWO.label },
];

interface Props {
  value: CapacityValue;
  onChange: (v: CapacityValue) => void;
  /** 숫자 칸의 id — 바깥 label 의 htmlFor 와 맞춘다 */
  inputId?: string;
  error?: boolean;
  /** 이미 수락한 수 — 이보다 작은 한도는 고를 수 없다(서버도 막는다) */
  min?: number;
  autoFocus?: boolean;
  inputClassName?: string;
}

export default function CapacityPicker({ value, onChange, inputId, error = false, min = 1, autoFocus = false, inputClassName }: Props) {
  const mask = value.capacityMask ?? null;
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="모집 인원 적는 방법" className="inline-flex rounded-lg border border-gray-200 p-0.5">
        {CHOICES.map((c) => {
          const on = mask === c.mask;
          const tooSmall = c.mask != null && CAPACITY_MASKS[c.mask].max < min;
          return (
            <button
              key={c.label}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={tooSmall}
              title={tooSmall ? `이미 ${min}명을 수락해서 고를 수 없어요` : undefined}
              onClick={() => onChange({ ...value, capacityMask: c.mask })}
              className={cn(
                'min-h-[36px] rounded-md px-3 text-sm transition-colors',
                on ? 'bg-gray-900 font-medium text-white' : 'text-gray-600 hover:text-gray-950',
                tooSmall && 'cursor-not-allowed opacity-40 hover:text-gray-600',
              )}
            >{c.label}</button>
          );
        })}
      </div>
      {mask == null ? (
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={min}
            max={CAPACITY_MAX}
            data-form-error={error || undefined}
            value={value.capacity || ''}
            onChange={(e) => onChange({ capacity: Number(e.target.value), capacityMask: null })}
            autoFocus={autoFocus}
            className={cn(
              'h-10 w-24 rounded-lg border px-3 text-right text-sm tabular-nums focus:outline-none',
              error ? 'border-accent' : 'border-gray-200 focus:border-gray-400',
              inputClassName,
            )}
          />
          <span className="text-sm text-gray-700">명</span>
        </div>
      ) : (
        <p className="text-xs text-gray-500" data-capacity-mask-note>
          공고에는 ‘{CAPACITY_MASKS[mask].label}’으로 적히고, {CAPACITY_MASKS[mask].max}명까지 수락할 수 있어요.
        </p>
      )}
    </div>
  );
}
