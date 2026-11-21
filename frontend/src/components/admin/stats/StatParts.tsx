/**
 * 통계 탭 공용 조각(2026-11-21 개편, 규칙 89) — 쌓은 막대 · 앞 기간과 견주기 · 짧은 가로 막대.
 *
 * 차트 규칙(dataviz): 막대는 얇게 · 위 끝만 둥글게 · 쌓은 조각 사이 2px 틈 · 범례는 늘 · 눈금 선은 옅게 ·
 * 마우스를 올리거나 눌러 초점을 주면 그 칸의 값이 뜬다 · 정확한 값은 '표로 보기'.
 * 색은 대상을 따른다 — 회원/비회원은 방문 그래프의 파랑·주황(검증된 2색), 역할(작가/갤러리)은 진한 회색·중간 회색(밝기로 갈린다).
 * 빨강(accent)은 '살펴볼 것' 에만(규칙 47).
 */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { niceMax } from '@/lib/visitStatsView';
import { fmtNum } from '@/lib/adminFormat';

export interface Series { key: string; name: string; color: string }
export interface BarRow { label: string; tip?: string; values: Record<string, number> }

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-gray-600">
      {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><Swatch color={s.color} />{s.name}</span>)}
    </p>
  );
}

/** 쌓은 막대 — 아래에서 위로 series 순서. 칸 위에 합계를 적는다(showTotal) */
export function StackedBars({ rows, series, height = 180, showTotal = false, label, every = 1 }: {
  rows: BarRow[];
  series: Series[];
  height?: number;
  showTotal?: boolean;
  /** 화면 낭독기 이름 */
  label: string;
  /** 가로축 라벨을 몇 칸마다(마지막 칸은 늘) */
  every?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = rows.map((r) => series.reduce((n, s) => n + (r.values[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const h = (n: number) => (max ? (n / max) * height : 0);
  const tip = hover !== null ? rows[hover] : null;
  return (
    <figure aria-label={label} className="m-0">
      <div className="flex">
        <div className="relative mr-2 w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500" style={{ height }}>
          {[max, max / 2, 0].map((v, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: height - h(v) }}>{Number.isInteger(v) ? v : v.toFixed(1)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {[max, max / 2].map((v, i) => <div key={i} aria-hidden className="absolute inset-x-0 border-t border-dashed border-gray-200" style={{ top: height - h(v) }} />)}
          <div aria-hidden className="absolute inset-x-0 border-t border-gray-400" style={{ top: height }} />
          <div className="relative flex items-end" style={{ height }} onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => (
              <button
                key={r.label + i}
                type="button"
                aria-label={`${r.tip ?? r.label} ${series.map((s) => `${s.name} ${r.values[s.key] ?? 0}`).join(' · ')}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => setHover(i)}
                className={cn('flex h-full min-w-0 flex-1 cursor-default flex-col-reverse items-center px-[1px] focus:outline-none', hover === i && 'bg-gray-100/70')}
              >
                <span className="flex w-[68%] max-w-[30px] flex-col-reverse">
                  {series.map((s, si) => {
                    const v = r.values[s.key] ?? 0;
                    if (!v) return null;
                    const top = series.slice(si + 1).every((x) => !(r.values[x.key] ?? 0));
                    return <span key={s.key} className={cn('block w-full', top ? 'rounded-t-[4px]' : 'mb-[2px]')} style={{ height: h(v), background: s.color }} />;
                  })}
                </span>
                {showTotal && totals[i] > 0 && <span className="mb-1 text-[11.5px] font-semibold tabular-nums text-gray-900">{totals[i]}</span>}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex text-[11px] tabular-nums text-gray-500">
            {rows.map((r, i) => (
              <span key={r.label + i} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                {i === rows.length - 1 || (rows.length - 1 - i) % every === 0 ? r.label : ''}
              </span>
            ))}
          </div>
          {tip && hover !== null && (
            <div role="status" className="pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm"
              style={{ left: `clamp(56px, ${((hover + 0.5) / rows.length) * 100}%, calc(100% - 56px))` }}>
              <p className="font-medium text-gray-900">{tip.tip ?? tip.label}</p>
              {series.map((s) => (
                <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-gray-600"><Swatch color={s.color} />{s.name}<b className="ml-auto pl-3 tabular-nums text-gray-900">{tip.values[s.key] ?? 0}</b></p>
              ))}
              {series.length > 1 && <p className="mt-1 flex border-t border-gray-100 pt-1 text-gray-600">합계<b className="ml-auto pl-3 tabular-nums text-gray-900">{totals[hover]}</b></p>}
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

/** 표 안의 짧은 가로 막대 + 값 */
export function InlineBar({ value, max, children }: { value: number; max: number; children?: ReactNode }) {
  const w = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className="flex items-center gap-2.5">
      <span className="block h-2 flex-1 rounded-sm bg-gray-100"><span className="block h-2 rounded-sm bg-gray-800" style={{ width: `${w}%` }} /></span>
      <span className="w-12 shrink-0 text-right text-[13.5px] tabular-nums">{children ?? fmtNum(value)}</span>
    </span>
  );
}

/** '표로 보기' — 그래프의 정확한 값 */
export function TableToggle({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="min-h-[40px] cursor-pointer select-none py-2 text-gray-600 hover:text-gray-950">표로 보기</summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-[13px] tabular-nums">
          <thead><tr className="border-b border-gray-200 text-gray-500">{head.map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-gray-100">{r.map((c, j) => <td key={j} className="py-1.5 pr-3 text-gray-900">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
