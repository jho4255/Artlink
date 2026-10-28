import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formInputCls } from '@/lib/formStyles';
import { FormField } from '@/components/flow/FormParts';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useViewport } from '@/hooks/useViewport';
import {
  WEEKDAY_LABELS, applyPick, canPick, formatYmd, monthGrid, monthIndex, monthOf, openingMonth, rangeDays, shiftMonth,
  shortYmd, spokenYmd, stepMin, todayKst, toYmd, type MonthRef, type ScheduleValues, type ScheduleRange, type ScheduleStep, type Ymd,
} from '@/lib/scheduleCalendar';

/**
 * 공모 일정 고르기 — 칸 여러 개가 달력 하나를 나눠 쓴다 (2026-10-28 사용자 요청: Skyscanner 의 가는 날/오는 날 방식).
 * 판단은 `lib/scheduleCalendar.ts`(고를 수 있는 날·다음 칸·뒤 칸 비우기), 이 파일은 그리기만.
 *
 * - 칸을 누르면 달력이 열린다 — 넓은 화면은 칸들 바로 아래(두 달, 칸이 좁으면 한 달), **휴대폰은 아래에서 올라오는 창**(한 달).
 *   휴대폰에서 칸들 아래에 열면 칸 다섯 개 밑이라 날짜가 하단 탭바에 가렸다(실측 iPhone 13). Skyscanner 도 휴대폰은 따로 띄운다.
 *   고르면 **다음 칸으로 넘어가고** 마지막이면 닫힌다.
 * - 지난 날과 앞 칸보다 이른 날은 흐리게, 누를 수 없다. 고른 날에는 무슨 날인지(시작·마감·제출…) 작게 적는다.
 * - 지원 기간·전시 기간은 띠로 칠하고, 끝 날을 고르는 중에는 마우스를 올린 날까지 미리 칠한다.
 * - 바깥을 누르거나 Esc·[완료] 면 닫힌다.
 * ⚠️ 칸은 `<input type="date">` 가 아니라 버튼이다 — 손으로 칠 수는 없다(Skyscanner 도 그렇다). E2E 는 `pickSchedule`(e2e/lib/helpers.ts)로 고른다.
 */
export default function SchedulePicker({
  steps,
  ranges = [],
  values,
  onChange,
  errors,
  variant = 'form',
  required = true,
  floor: floorProp,
}: {
  steps: ScheduleStep[];
  ranges?: ScheduleRange[];
  values: ScheduleValues;
  /** 바뀐 칸만 — 뒤 칸을 비울 땐 '' 가 함께 온다. 부르는 쪽은 함수형으로 합칠 것(`setForm(prev => ({ ...prev, ...patch }))`) */
  onChange: (patch: Record<string, string>) => void;
  errors?: Set<string>;
  /** form = 공모 등록 폼(라벨·설명) · compact = 아트링크 주최 공모 카드(작은 라벨) */
  variant?: 'form' | 'compact';
  required?: boolean;
  /** 이보다 이른 날은 못 고른다 — 기본 오늘(KST) */
  floor?: Ymd;
}) {
  const floor = floorProp ?? todayKst();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [view, setView] = useState<MonthRef>(() => monthOf(floor));
  const [hover, setHover] = useState<Ymd | null>(null);
  const [two, setTwo] = useState(false);
  // 휴대폰 = Tailwind sm(640px) 미만 — 그땐 칸 아래가 아니라 아래에서 올라오는 창으로
  const sheet = useViewport().w < 640;

  // 넓으면 두 달 — 화면 폭이 아니라 이 칸의 폭으로 판단한다(주최 공모 카드는 PC 에서도 좁다)
  // (ResizeObserver 는 observe 하자마자 한 번 부른다 — 첫 폭도 여기서 잰다)
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTwo(el.getBoundingClientRect().width >= 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = (i: number) => {
    setActive(i);
    setHover(null);
    setView(openingMonth(steps, values, i, floor));
  };
  const close = () => { setActive(null); setHover(null); };
  // 창(휴대폰)은 그 자신이 aria-modal 이라 양보하면 안 닫힌다 — 칸 아래 패널일 때만 위에 뜬 창에 양보한다
  useEscapeKey(close, { enabled: active !== null, yieldToModal: !sheet });

  // 창이 떠 있는 동안 뒤 페이지가 같이 밀리지 않게
  useEffect(() => {
    if (active === null || !sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active, sheet]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (active === null) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [active]);

  // 처음 열 때 패널이 화면 밖이면 보이게(넓은 화면 — 휴대폰은 창이라 필요 없다). 칸을 옮겨 다닐 땐 움직이지 않는다
  const wasOpen = useRef(false);
  useEffect(() => {
    const isOpen = active !== null;
    if (isOpen && !wasOpen.current && !sheet) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    wasOpen.current = isOpen;
  }, [active, sheet]);

  const pick = (day: Ymd) => {
    if (active === null || !canPick(steps, values, active, day, floor)) return;
    const { patch, next } = applyPick(steps, values, active, day, floor);
    onChange(patch);
    setHover(null);
    if (next === null) { close(); return; }
    setActive(next);
    // 다음 칸의 첫날이 지금 보이는 달 뒤면 그 달로 넘긴다
    const nextMin = monthOf(stepMin(steps, { ...values, ...patch }, next, floor));
    const lastVisible = monthIndex(view) + months.length - 1;
    if (monthIndex(nextMin) > lastVisible) setView(nextMin);
  };

  // 끝 날을 고르는 중이면 마우스를 올린 날까지 미리 칠한다
  const preview = useMemo(() => {
    if (active === null || !hover) return values;
    const r = ranges.find((x) => x.to === steps[active].key);
    if (!r || !toYmd(values[r.from]) || !canPick(steps, values, active, hover, floor)) return values;
    return { ...values, [r.to]: hover };
  }, [active, hover, values, ranges, steps, floor]);

  const marksOn = useMemo(() => {
    const m = new Map<Ymd, string[]>();
    steps.forEach((s) => {
      const v = toYmd(values[s.key]);
      if (v) m.set(v, [...(m.get(v) ?? []), s.mark]);
    });
    return m;
  }, [steps, values]);

  const minYmd = active === null ? floor : stepMin(steps, values, active, floor);
  const firstMonth = monthOf(floor);
  const months = two && !sheet ? [view, shiftMonth(view, 1)] : [view];
  const canPrev = monthIndex(view) > monthIndex(firstMonth);
  const canNext = monthIndex(view) < monthIndex(firstMonth) + 36;

  /** 앞에서 고른 칸이 이 칸을 막고 있으면 그 이유 한 줄 */
  const constraint = (() => {
    if (active === null) return null;
    for (let j = active - 1; j >= 0; j--) {
      const v = toYmd(values[steps[j].key]);
      if (!v) continue;
      if (minYmd <= floor) return null;
      const gapAll = steps.slice(j + 1, active + 1).reduce((s, x) => s + x.gap, 0);
      return `${steps[j].label} ${shortYmd(v)}${gapAll > 0 ? ' 다음 날부터' : '부터'} 고를 수 있어요.`;
    }
    return null;
  })();

  const fieldButton = (s: ScheduleStep, i: number) => {
    const v = toYmd(values[s.key]);
    const bad = !!errors?.has(s.key);
    const on = active === i;
    return (
      <button
        type="button"
        id={s.id}
        data-form-error={bad || undefined}
        data-schedule-field={s.key}
        aria-expanded={on}
        aria-controls={on ? panelId : undefined}
        aria-label={`${s.label}${v ? ` ${spokenYmd(v)}` : ' 고르기'}`}
        onClick={() => (on ? close() : open(i))}
        className={cn(
          variant === 'form' ? formInputCls(bad) : cn('w-full rounded-lg border p-2 text-sm', bad ? 'border-accent bg-accent/5' : 'border-gray-200'),
          'flex min-h-[44px] items-center gap-2 text-left',
          on && 'border-gray-900 ring-1 ring-gray-900',
        )}
      >
        <CalendarDays size={15} className="shrink-0 text-gray-400" aria-hidden />
        <span className={cn('min-w-0 truncate tabular-nums', v ? 'text-gray-900' : 'text-gray-400')}>{v ? formatYmd(v) : '날짜 선택'}</span>
      </button>
    );
  };

  const completeRanges = ranges
    .map((r) => ({ r, a: toYmd(values[r.from]), b: toYmd(values[r.to]) }))
    .filter((x) => x.a && x.b && x.b >= x.a);

  return (
    <div ref={rootRef} className="min-w-0">
      {variant === 'form' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {steps.map((s, i) => (
            <FormField
              key={s.key}
              className={cn('min-w-0', s.wide && 'sm:col-span-2')}
              label={`${s.label}${required ? ' *' : ''}`}
              error={!!errors?.has(s.key)}
              htmlFor={s.id}
              hint={s.hint}
            >
              <div className={cn(s.wide && 'sm:max-w-[calc(50%-0.5rem)]')}>{fieldButton(s, i)}</div>
            </FormField>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {steps.map((s, i) => (
            <div key={s.key} className={cn('min-w-0', s.wide && 'col-span-2')}>
              <label htmlFor={s.id} className={cn('text-xs', errors?.has(s.key) ? 'font-medium text-accent' : 'text-gray-500')}>
                {s.label}{required ? ' *' : ''}
              </label>
              <div className="mt-0.5">{fieldButton(s, i)}</div>
            </div>
          ))}
        </div>
      )}

      {active !== null && (sheet ? (
        // 휴대폰 — 아래에서 올라오는 창. 하단 탭바(z-40)보다 위(z-50). 바깥(어두운 곳)을 누르면 닫힌다
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={close}>
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={`${steps[active].label} 달력`}
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div aria-hidden className="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-gray-200" />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{steps[active].label}을 골라 주세요</p>
              {constraint && <p className="mt-0.5 break-keep text-xs text-gray-500">{constraint}</p>}
            </div>
            <button type="button" onClick={close} className="-mr-1 -mt-1 min-h-[40px] shrink-0 px-2 text-sm text-gray-500 hover:text-gray-900">완료</button>
          </div>

          {/* 칸 순서 — 지금 고르는 칸이 어디인지, 눌러서 옮겨 갈 수도 있다 */}
          {steps.length > 2 && (
            <ol className="mb-3 flex flex-wrap gap-1.5" aria-label="고를 날짜">
              {steps.map((s, i) => {
                const v = toYmd(values[s.key]);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => open(i)}
                      aria-current={i === active ? 'step' : undefined}
                      className={cn(
                        'min-h-[32px] rounded-full border px-2.5 text-xs whitespace-nowrap',
                        i === active ? 'border-gray-900 bg-gray-900 text-white' : v ? 'border-gray-300 text-gray-700' : 'border-dashed border-gray-300 text-gray-400',
                      )}
                    >
                      {s.mark}{v ? ` ${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : ''}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="relative">
            <button
              type="button"
              aria-label="이전 달"
              disabled={!canPrev}
              onClick={() => setView((v) => shiftMonth(v, -1))}
              className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-200 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="다음 달"
              disabled={!canNext}
              onClick={() => setView((v) => shiftMonth(v, 1))}
              className="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-200"
            >
              <ChevronRight size={18} />
            </button>
            <div className={cn('grid gap-6', months.length === 2 && 'grid-cols-2')}>
              {months.map((m) => (
                <Month
                  key={`${m.y}-${m.m0}`}
                  month={m}
                  floor={floor}
                  minYmd={minYmd}
                  activeKey={steps[active].key}
                  values={preview}
                  realValues={values}
                  marks={marksOn}
                  ranges={ranges}
                  hover={hover}
                  onHover={setHover}
                  onPick={pick}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
            {completeRanges.map(({ r, a, b }) => (
              <span key={r.from} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-4 rounded-sm bg-gray-200" />
                {r.label} {rangeDays(a as Ymd, b as Ymd)}일
              </span>
            ))}
            <span>흐린 날은 고를 수 없어요.</span>
          </div>
          </div>
        </div>
      ) : (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={`${steps[active].label} 달력`}
          className="mt-3 rounded-xl border border-gray-200 bg-white p-3 sm:p-4"
          onMouseLeave={() => setHover(null)}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{steps[active].label}을 골라 주세요</p>
              {constraint && <p className="mt-0.5 break-keep text-xs text-gray-500">{constraint}</p>}
            </div>
            <button type="button" onClick={close} className="-mr-1 -mt-1 min-h-[40px] shrink-0 px-2 text-sm text-gray-500 hover:text-gray-900">완료</button>
          </div>

          {/* 칸 순서 — 지금 고르는 칸이 어디인지, 눌러서 옮겨 갈 수도 있다 */}
          {steps.length > 2 && (
            <ol className="mb-3 flex flex-wrap gap-1.5" aria-label="고를 날짜">
              {steps.map((s, i) => {
                const v = toYmd(values[s.key]);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => open(i)}
                      aria-current={i === active ? 'step' : undefined}
                      className={cn(
                        'min-h-[32px] rounded-full border px-2.5 text-xs whitespace-nowrap',
                        i === active ? 'border-gray-900 bg-gray-900 text-white' : v ? 'border-gray-300 text-gray-700' : 'border-dashed border-gray-300 text-gray-400',
                      )}
                    >
                      {s.mark}{v ? ` ${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : ''}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="relative">
            <button
              type="button"
              aria-label="이전 달"
              disabled={!canPrev}
              onClick={() => setView((v) => shiftMonth(v, -1))}
              className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-200 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="다음 달"
              disabled={!canNext}
              onClick={() => setView((v) => shiftMonth(v, 1))}
              className="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-200"
            >
              <ChevronRight size={18} />
            </button>
            <div className={cn('grid gap-6', months.length === 2 && 'grid-cols-2')}>
              {months.map((m) => (
                <Month
                  key={`${m.y}-${m.m0}`}
                  month={m}
                  floor={floor}
                  minYmd={minYmd}
                  activeKey={steps[active].key}
                  values={preview}
                  realValues={values}
                  marks={marksOn}
                  ranges={ranges}
                  hover={hover}
                  onHover={setHover}
                  onPick={pick}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
            {completeRanges.map(({ r, a, b }) => (
              <span key={r.from} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-4 rounded-sm bg-gray-200" />
                {r.label} {rangeDays(a as Ymd, b as Ymd)}일
              </span>
            ))}
            <span>흐린 날은 고를 수 없어요.</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Month({ month, floor, minYmd, activeKey, values, realValues, marks, ranges, hover, onHover, onPick }: {
  month: MonthRef;
  floor: Ymd;
  minYmd: Ymd;
  activeKey: string;
  /** 칠하기용(미리보기 포함) */
  values: ScheduleValues;
  /** 실제로 고른 값 */
  realValues: ScheduleValues;
  marks: Map<Ymd, string[]>;
  ranges: ScheduleRange[];
  hover: Ymd | null;
  onHover: (d: Ymd | null) => void;
  onPick: (d: Ymd) => void;
}) {
  const weeks = monthGrid(month.y, month.m0);
  const today = floor;
  return (
    <div className="min-w-0">
      <p className="mb-2 flex h-9 items-center justify-center text-sm font-medium text-gray-900">{month.y}년 {month.m0 + 1}월</p>
      <div className="grid grid-cols-7 text-center text-[11px] text-gray-400">
        {WEEKDAY_LABELS.map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>
      <div role="grid" aria-label={`${month.y}년 ${month.m0 + 1}월`}>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className="grid grid-cols-7">
            {week.map((day, di) => {
              if (!day) return <span key={di} role="gridcell" aria-hidden className="h-11" />;
              const disabled = day < minYmd;
              const chosen = marks.get(day);
              // 띠 — 이 날이 들어가는 기간
              let band: { start: boolean; end: boolean } | null = null;
              for (const r of ranges) {
                const a = toYmd(values[r.from]);
                const b = toYmd(values[r.to]);
                if (a && b && b >= a && day >= a && day <= b) { band = { start: day === a, end: day === b }; break; }
              }
              const previewEnd = hover === day && !disabled && toYmd(realValues[activeKey]) !== day;
              const isActiveValue = toYmd(realValues[activeKey]) === day;
              return (
                <span key={di} role="gridcell" className="relative h-11">
                  {band && !(band.start && band.end) && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 bg-gray-100"
                      style={{ left: band.start ? '50%' : 0, right: band.end ? '50%' : 0 }}
                    />
                  )}
                  <button
                    type="button"
                    data-schedule-day={day}
                    disabled={disabled}
                    aria-label={`${spokenYmd(day)}${chosen ? ` · ${chosen.join('·')}` : ''}`}
                    aria-pressed={isActiveValue}
                    onClick={() => onPick(day)}
                    onMouseEnter={() => onHover(day)}
                    onFocus={() => onHover(day)}
                    className={cn(
                      'relative mx-auto flex h-11 w-11 max-w-full flex-col items-center justify-center rounded-full text-sm tabular-nums',
                      disabled ? 'cursor-not-allowed text-gray-300' : 'cursor-pointer text-gray-900 hover:bg-gray-200',
                      // ⚠️ hover 는 누를 수 있는 날에만 — 고를 수 없는 날에도 걸면 막 고른 날 위에 마우스가 남아 진하게 보였다(WebKit 실측)
                      chosen && 'bg-gray-900 text-white',
                      chosen && !disabled && 'hover:bg-gray-800',
                      chosen && disabled && 'bg-gray-400',
                      isActiveValue && 'ring-2 ring-gray-900 ring-offset-1',
                      previewEnd && !chosen && 'ring-1 ring-gray-900',
                    )}
                  >
                    <span className={cn('leading-none', (chosen || day === today) && '-mt-0.5')}>{Number(day.slice(8, 10))}</span>
                    {chosen ? (
                      <span className="mt-0.5 max-w-full truncate px-0.5 text-[9px] leading-none">{chosen.join('·')}</span>
                    ) : day === today ? (
                      <span className={cn('mt-0.5 text-[9px] leading-none', disabled ? 'text-gray-300' : 'text-gray-500')}>오늘</span>
                    ) : null}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
