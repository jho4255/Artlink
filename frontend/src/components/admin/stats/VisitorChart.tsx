/**
 * 일간 방문자 막대(회원 아래 · 비회원 위) — [통계]의 [요약]·[방문] 탭이 같이 쓴다(2026-11-21 에 AdminStatsSection 에서 떼어 냈다).
 * 색은 검증된 2색(파랑 #2a78d6 · 주황 #eb6834) — 빨강(accent)은 상태 색이라 쓰지 않는다(규칙 47).
 */
import { useState } from 'react';
import { dayLabel, fmtAvg, niceMax, type VisitorRow } from '@/lib/visitStatsView';

export const MEMBER = '#2a78d6';
export const GUEST = '#eb6834';
const CHART_H = 180;

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />;
}

/**
 * 쌓은 막대 — 회원(아래) + 비회원(위) = 그날 방문자. 두 조각 사이 2px 흰 틈, 윗끝만 4px 둥글게(바닥은 기준선에 붙는다).
 * 막대마다 누르거나 올리면 그날 숫자가 뜬다(칸 전체가 누를 자리 — 막대보다 넓다). 가로 라벨은 듬성듬성 + 늘 오늘.
 */
export function VisitorChart({ rows }: { rows: VisitorRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...rows.map((r) => r.total)));
  const every = rows.length <= 10 ? 1 : rows.length <= 40 ? 7 : 14;
  const h = (n: number) => (n / max) * CHART_H;
  const tip = hover !== null ? rows[hover] : null;

  return (
    <figure className="mt-6" aria-label="일간 방문자 막대 그래프">
      <div className="mb-3 flex gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5"><Swatch color={MEMBER} />회원</span>
        <span className="inline-flex items-center gap-1.5"><Swatch color={GUEST} />비회원</span>
      </div>
      <div className="flex">
        {/* 세로축 눈금 — 0 · 절반 · 끝 */}
        <div className="relative mr-2 w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-400" style={{ height: CHART_H }}>
          {[max, max / 2, 0].map((v, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: CHART_H - h(v) }}>{fmtAvg(v)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {[max, max / 2].map((v, i) => (
            <div key={i} aria-hidden className="absolute inset-x-0 border-t border-dashed border-gray-200" style={{ top: CHART_H - h(v) }} />
          ))}
          <div aria-hidden className="absolute inset-x-0 border-t border-gray-300" style={{ top: CHART_H }} />
          <div data-testid="visitor-bars" className="relative flex items-end" style={{ height: CHART_H }} onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => {
              const mh = h(r.members);
              const gh = h(r.guests);
              const { md, weekday } = dayLabel(r.date);
              return (
                <button
                  key={r.date}
                  type="button"
                  aria-label={`${md}(${weekday}) 회원 ${r.members}명 · 비회원 ${r.guests}명 · 합계 ${r.total}명`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover(i)}
                  className={`flex h-full min-w-0 flex-1 cursor-default flex-col-reverse items-center px-[1px] focus:outline-none ${hover === i ? 'bg-gray-100/70' : ''}`}
                >
                  {/* 막대 폭은 칸의 70%, 최대 28px — 7일일 때 막대가 칸을 꽉 채우지 않게 */}
                  <span className="flex w-[70%] max-w-[28px] flex-col-reverse">
                    {r.members > 0 && (
                      <span className={`block w-full ${r.guests > 0 ? '' : 'rounded-t-[4px]'}`} style={{ height: mh, background: MEMBER }} />
                    )}
                    {r.guests > 0 && (
                      <span className={`block w-full rounded-t-[4px] ${r.members > 0 ? 'mb-[2px]' : ''}`} style={{ height: gh, background: GUEST }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {/* 가로축 라벨 — 듬성듬성 + 마지막(오늘)은 늘 */}
          <div className="mt-1.5 flex text-[11px] tabular-nums text-gray-400">
            {rows.map((r, i) => {
              const show = i === rows.length - 1 || (rows.length - 1 - i) % every === 0;
              return <span key={r.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{show ? dayLabel(r.date).md : ''}</span>;
            })}
          </div>
          {tip && hover !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm"
              style={{ left: `clamp(56px, ${((hover + 0.5) / rows.length) * 100}%, calc(100% - 56px))` }}
            >
              <p className="font-medium text-gray-900">{dayLabel(tip.date).md} ({dayLabel(tip.date).weekday})</p>
              <p className="mt-1 flex items-center gap-1.5 text-gray-600"><Swatch color={MEMBER} />회원 <b className="ml-auto pl-3 tabular-nums text-gray-900">{tip.members}</b></p>
              <p className="flex items-center gap-1.5 text-gray-600"><Swatch color={GUEST} />비회원 <b className="ml-auto pl-3 tabular-nums text-gray-900">{tip.guests}</b></p>
              <p className="mt-1 flex border-t border-gray-100 pt-1 text-gray-600">합계 <b className="ml-auto pl-3 tabular-nums text-gray-900">{tip.total}</b></p>
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}
