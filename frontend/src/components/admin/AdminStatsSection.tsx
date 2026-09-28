import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { dayLabel, fmtAvg, niceMax, summarizeVisitors, trimBeforeSince, type VisitorRow } from '@/lib/visitStatsView';

/**
 * Admin [통계] 탭 (2026-09-28) — 지금은 **일간 방문자(회원/비회원)** 하나. 새 지표는 이 탭 안에 섹션으로 더한다.
 *
 * 세는 규칙은 서버 `backend/src/lib/visitStats.ts`: 기기×KST 날짜 한 줄, 회원 = 그날 서로 다른 회원 수(관리자 제외),
 * 비회원 = 로그인 안 한 기기 수. 비회원으로 들어와 로그인하면 회원 1명.
 *
 * 화면 구성(dataviz 절차): 한눈에 볼 숫자는 **KPI 타일**(오늘·어제·최근 7일 평균), 날짜별 흐름은 **쌓은 막대**(회원 아래·비회원 위,
 * 합이 곧 그날 방문자), 정확한 값은 **표**. 색은 2계열 팔레트를 검증기로 확인했다(파랑 #2a78d6 · 주황 #eb6834, 흰 바탕 대비·색각 차이 통과).
 * ⚠️ 빨강(accent)은 쓰지 않는다 — 사이트에서 빨강은 D-day·오류 같은 '상태' 색이다(CLAUDE.md 47).
 */
const MEMBER = '#2a78d6';
const GUEST = '#eb6834';
const PERIODS = [7, 30, 90] as const;
const CHART_H = 180;

interface VisitorStats { rows: VisitorRow[]; since: string | null }

export default function AdminStatsSection() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const { data, isLoading, isError } = useQuery<VisitorStats>({
    queryKey: ['admin-visitor-stats', days],
    queryFn: () => api.get(`/admin/stats/visitors?days=${days}`).then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,   // 기간을 바꾸는 동안 화면이 비었다 채워지며 튀지 않게
  });

  const rows = trimBeforeSince(data?.rows ?? [], data?.since ?? null);
  const sum = summarizeVisitors(rows);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-serif text-gray-900">통계</h2>
        <p className="mt-1 text-sm text-gray-500">사이트를 찾은 사람 수를 날마다 셉니다. 날짜는 한국 시간 기준입니다.</p>
      </div>

      <section className="rounded-2xl border border-gray-200 p-4 md:p-6" aria-labelledby="stats-daily-visitors">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="stats-daily-visitors" className="text-base font-medium text-gray-900">일간 방문자</h3>
          <div role="group" aria-label="기간" className="flex rounded-lg border border-gray-200 p-0.5 text-sm">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => setDays(p)}
                className={`min-h-[36px] rounded-md px-3 ${days === p ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
              >
                {p}일
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 h-64 animate-pulse rounded-xl bg-gray-50" />
        ) : isError ? (
          <p className="mt-5 text-sm text-accent">통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
        ) : !data?.since ? (
          <p className="mt-5 rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
            아직 기록이 없습니다. 방문이 생기면 여기에 하루 단위로 쌓입니다.
          </p>
        ) : (
          <>
            <KpiRow sum={sum} />
            <VisitorChart rows={rows} />
            <p className="mt-3 text-xs leading-relaxed text-gray-400">
              같은 기기로 하루에 여러 번 들어와도 1명 · 비회원으로 들어와 그날 로그인하면 회원 1명 · 한 회원이 기기 둘로 들어와도 1명 ·
              관리자 방문은 빼고 셉니다 · 집계 시작 {data.since}
            </p>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-900">표로 보기</summary>
              <VisitorTable rows={rows} />
            </details>
          </>
        )}
      </section>
    </div>
  );
}

function KpiRow({ sum }: { sum: ReturnType<typeof summarizeVisitors> }) {
  // ⚠️ 오늘을 어제와 빼서 비교하지 말 것 — 오늘은 아직 진행 중이라 아침마다 '어제보다 -8명' 처럼 줄어든 것으로 읽힌다
  const tile = (label: string, total: string, members: string, guests: string) => (
    <div className="min-w-0 rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{total}<span className="ml-0.5 text-sm font-normal text-gray-500">명</span></p>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs tabular-nums text-gray-600">
        <span className="inline-flex items-center gap-1"><Swatch color={MEMBER} />회원 {members}</span>
        <span className="inline-flex items-center gap-1"><Swatch color={GUEST} />비회원 {guests}</span>
      </p>
    </div>
  );
  return (
    <div data-testid="visitor-kpis" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {sum.today && tile('오늘 (지금까지)', String(sum.today.total), String(sum.today.members), String(sum.today.guests))}
      {sum.yesterday
        ? tile('어제', String(sum.yesterday.total), String(sum.yesterday.members), String(sum.yesterday.guests))
        : <div className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-400">어제 기록이 없습니다(집계 첫날).</div>}
      {sum.avg && tile(sum.avg.days >= 7 ? '최근 7일 하루 평균' : `최근 ${sum.avg.days}일 하루 평균`,
        fmtAvg(sum.avg.total), fmtAvg(sum.avg.members), fmtAvg(sum.avg.guests))}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />;
}

/**
 * 쌓은 막대 — 회원(아래) + 비회원(위) = 그날 방문자. 두 조각 사이 2px 흰 틈, 윗끝만 4px 둥글게(바닥은 기준선에 붙는다).
 * 막대마다 누르거나 올리면 그날 숫자가 뜬다(칸 전체가 누를 자리 — 막대보다 넓다). 가로 라벨은 듬성듬성 + 늘 오늘.
 */
function VisitorChart({ rows }: { rows: VisitorRow[] }) {
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

function VisitorTable({ rows }: { rows: VisitorRow[] }) {
  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-gray-100">
      <table data-testid="visitor-table" className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">날짜</th>
            <th className="px-3 py-2 text-right font-medium">회원</th>
            <th className="px-3 py-2 text-right font-medium">비회원</th>
            <th className="px-3 py-2 text-right font-medium">합계</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => {
            const { weekday } = dayLabel(r.date);
            return (
              <tr key={r.date} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-700">{r.date} ({weekday})</td>
                <td className="px-3 py-1.5 text-right text-gray-900">{r.members}</td>
                <td className="px-3 py-1.5 text-right text-gray-900">{r.guests}</td>
                <td className="px-3 py-1.5 text-right font-medium text-gray-900">{r.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
