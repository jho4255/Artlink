import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import {
  dayLabel, fmtAvg, niceMax, summarizeExports, summarizeVisitors, trimBeforeSince, type ExportRow, type VisitorRow,
} from '@/lib/visitStatsView';
import { fmtDuration, pct, stepText, visitEnd, visitTime, type GuestStats, type GuestVisitRow } from '@/lib/guestStatsView';

/**
 * Admin [통계] 탭 (2026-09-28) — **일간 방문자(회원/비회원)** · **비회원 둘러보기**(2026-10-03) · **포트폴리오 PDF 저장**(2026-10-03).
 * 새 지표는 이 탭 안에 섹션으로 더한다.
 * 기간(7·30·90일)은 맨 위에서 한 번 고르고 모든 섹션이 따른다 — 섹션마다 따로 두면 같은 이름의 버튼이 여러 벌 생긴다.
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
interface ExportStats { rows: ExportRow[]; since: string | null; totals: { saves: number; artists: number } }

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-serif text-gray-900">통계</h2>
          <p className="mt-1 text-sm text-gray-500">날마다 셉니다. 날짜는 한국 시간 기준입니다.</p>
        </div>
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

      <section className="rounded-2xl border border-gray-200 p-4 md:p-6" aria-labelledby="stats-daily-visitors">
        <h3 id="stats-daily-visitors" className="text-base font-medium text-gray-900">일간 방문자</h3>
        <p className="mt-0.5 text-sm text-gray-500">사이트를 찾은 사람 수.</p>

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

      <GuestSection days={days} />

      <ExportSection days={days} />
    </div>
  );
}

/**
 * 비회원 둘러보기 (2026-10-03, 사용자 요청 — 광고로 들어온 비회원의 가입이 적은 이유를 보려고).
 * 로그인하지 않은 방문이 **무엇을 보고 얼마나 머물렀는지**. 들어온 경로(광고·검색)는 남기지 않는다(사용자 결정).
 * 숫자는 서버 `backend/src/lib/guestActivity.ts` 가 세고, 화면 이름·공모 제목·작가 이름도 서버가 붙여 준다.
 * 색은 일간 방문자 그래프의 '비회원' 주황 하나 — 같은 대상(비회원 방문)이라 같은 색이다(색은 대상을 따른다).
 */
function GuestSection({ days }: { days: number }) {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError } = useQuery<GuestStats>({
    queryKey: ['admin-guest-stats', days],
    queryFn: () => api.get(`/admin/stats/guests?days=${days}`).then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const sum = data?.summary;
  const tile = (label: string, value: string, unit: string, sub: string) => (
    <div className="min-w-0 rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}<span className="ml-0.5 text-sm font-normal text-gray-500">{unit}</span></p>
      <p className="mt-0.5 text-xs tabular-nums text-gray-600">{sub}</p>
    </div>
  );
  const recent = data?.recent ?? [];
  const shown = showAll ? recent : recent.slice(0, 8);
  const maxLanding = Math.max(1, ...(data?.landings ?? []).map((l) => l.visits));
  const maxPage = Math.max(1, ...(data?.pages ?? []).map((p) => p.visits));

  return (
    <section className="rounded-2xl border border-gray-200 p-4 md:p-6" aria-labelledby="stats-guests">
      <h3 id="stats-guests" className="text-base font-medium text-gray-900">비회원 둘러보기</h3>
      <p className="mt-0.5 text-sm text-gray-500">로그인하지 않은 방문이 무엇을 보고 얼마나 머물렀는지. 들어온 경로(광고·검색)는 남기지 않습니다.</p>

      {isLoading ? (
        <div className="mt-5 h-64 animate-pulse rounded-xl bg-gray-50" />
      ) : isError ? (
        <p className="mt-5 text-sm text-accent">통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      ) : !data?.since || !sum ? (
        <p className="mt-5 rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          아직 기록이 없습니다. 로그인하지 않은 방문이 생기면 여기에 쌓입니다.
        </p>
      ) : sum.visits === 0 ? (
        <p className="mt-5 rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">이 기간에는 비회원 방문이 없습니다.</p>
      ) : (
        <>
          <div data-testid="guest-kpis" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tile('방문', String(sum.visits), '회', `한 방문 평균 ${fmtAvg(sum.avgViews)}화면`)}
            {tile('바로 나감', String(pct(sum.bounced, sum.visits)), '%', `${sum.bounced}회 · 화면 하나만 30초 안에`)}
            {tile('한 방문에 머문 시간', fmtDuration(sum.medianSeconds), '', '중간값 — 절반은 이보다 짧다')}
            {tile('가입', String(sum.signup), '회', `로그인 ${sum.login}회(이미 회원)`)}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-gray-900">처음 본 화면</h4>
              <p className="mt-0.5 text-xs text-gray-500">들어오자마자 본 화면 — 광고가 보낸 곳입니다.</p>
              <table data-testid="guest-landings" className="mt-2 w-full table-fixed text-sm tabular-nums">
                <thead className="text-xs text-gray-500">
                  <tr className="border-b border-gray-100">
                    <th className="py-1.5 pr-2 text-left font-medium">화면</th>
                    <th className="w-[34%] py-1.5 pr-2 text-left font-medium">방문</th>
                    <th className="w-[19%] py-1.5 text-right font-medium">바로 나감</th>
                    <th className="w-[11%] py-1.5 text-right font-medium">가입</th>
                  </tr>
                </thead>
                <tbody>
                  {data.landings.map((l) => (
                    <tr key={`${l.label}|${l.detail ?? ''}`} className="border-b border-gray-50 align-top">
                      <td className="min-w-0 py-1.5 pr-2 text-gray-800">
                        <span className="block truncate" title={l.detail ? `${l.label} 「${l.detail}」` : l.label}>
                          {l.label}{l.detail && <span className="text-gray-500"> 「{l.detail}」</span>}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2"><Bar value={l.visits} max={maxLanding} /></td>
                      <td className="py-1.5 text-right text-gray-900">{pct(l.bounced, l.visits)}%</td>
                      <td className="py-1.5 text-right text-gray-900">{l.signups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-gray-900">많이 본 화면</h4>
              <p className="mt-0.5 text-xs text-gray-500">그 화면을 한 번이라도 본 방문 수와, 한 번 볼 때 머문 평균 시간.</p>
              <table data-testid="guest-pages" className="mt-2 w-full table-fixed text-sm tabular-nums">
                <thead className="text-xs text-gray-500">
                  <tr className="border-b border-gray-100">
                    <th className="py-1.5 pr-2 text-left font-medium">화면</th>
                    <th className="w-[38%] py-1.5 pr-2 text-left font-medium">본 방문</th>
                    <th className="w-[24%] py-1.5 text-right font-medium">평균 머문 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pages.map((p) => (
                    <tr key={p.label} className="border-b border-gray-50">
                      <td className="py-1.5 pr-2 text-gray-800"><span className="block truncate">{p.label}</span></td>
                      <td className="py-1.5 pr-2"><Bar value={p.visits} max={maxPage} /></td>
                      <td className="py-1.5 text-right text-gray-900">{fmtDuration(p.avgSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.exits.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium text-gray-900">둘러보다 나간 곳</h4>
              <p className="mt-0.5 text-xs text-gray-500">바로 나가지 않고 둘러본 방문이 마지막으로 본 화면(가입·로그인한 방문은 빼고).</p>
              <ul data-testid="guest-exits" className="mt-2 flex flex-wrap gap-2 text-sm">
                {data.exits.map((e) => (
                  <li key={e.label} className="rounded-full border border-gray-200 px-3 py-1 text-gray-700">
                    {e.label} <span className="tabular-nums text-gray-900">{e.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6">
            <h4 className="text-sm font-medium text-gray-900">최근 방문</h4>
            <p className="mt-0.5 text-xs text-gray-500">본 순서대로 — 화면 이름 옆 숫자는 그 화면에 머문 시간입니다.</p>
            <ol data-testid="guest-recent" className="mt-2 divide-y divide-gray-100 border-y border-gray-100">
              {shown.map((v, i) => <GuestVisitItem key={`${v.startedAt}-${i}`} v={v} />)}
            </ol>
            {recent.length > 8 && (
              <button type="button" onClick={() => setShowAll((x) => !x)} className="mt-2 min-h-[40px] text-sm text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
                {showAll ? '접기' : `더 보기 (${recent.length - 8})`}
              </button>
            )}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-gray-400">
            방문 = 탭 하나(띄워 둔 탭에서 이어 보면 같은 방문) · 머문 시간은 화면이 보이는 동안만(한 화면 최대 30분) · 바로 나감 = 화면 하나만 보고 30초 안에 나감 ·
            이 브라우저로 로그인한 적이 있으면 세지 않습니다 · 계정·IP 와 잇지 않고 90일 뒤 지웁니다 · 1분마다 다시 셉니다 · 집계 시작 {data.since}
            {data.capped && ' · 방문이 많아 이 기간의 최근 5만 건만 셌습니다'}
          </p>
        </>
      )}
    </section>
  );
}

/** 표 안 가로 막대 — 값의 크기만(한 색). 숫자는 막대 옆 글자로 */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 min-w-0 flex-1">
        <span className="block h-2 rounded-r-[4px]" style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: GUEST }} />
      </span>
      <span className="w-8 shrink-0 text-right text-gray-900">{value}</span>
    </span>
  );
}

function GuestVisitItem({ v }: { v: GuestVisitRow }) {
  const end = visitEnd(v);
  return (
    <li className="py-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-gray-500">
        <span className="text-gray-700">{visitTime(v.startedAt)}</span>
        <span>· {fmtDuration(v.seconds)}</span>
        <span>· 화면 {v.views}개</span>
        {v.outcome === 'SIGNUP' && <span className="rounded-full border border-gray-900 px-2 py-px text-[11px] font-medium text-gray-900">가입</span>}
        {v.outcome === 'LOGIN' && <span className="rounded-full border border-gray-300 px-2 py-px text-[11px] text-gray-600">로그인</span>}
        {v.bounced && !v.ongoing && <span className="rounded-full bg-gray-100 px-2 py-px text-[11px] text-gray-600">바로 나감</span>}
      </p>
      {/* 낱말 안에서 끊지 않는다(keep-all) — '모집공고'가 '모\n집공고'로 갈라졌다. 띄어쓰기 없는 긴 이름만 anywhere 로(규칙 30).
          화살표·시간은 바로 앞뒤 낱말과 붙여 둔다(줄 끝에 화살표만 남지 않게) */}
      <p className="mt-1 text-sm leading-relaxed break-keep [overflow-wrap:anywhere]">
        {v.steps.map((s, i) => (
          <span key={i}>
            {i > 0 && <span aria-hidden className="text-gray-300">{' →\u00a0'}</span>}
            <span className="text-gray-900">{stepText(s)}</span>
            <span className="text-gray-400">{`\u00a0${fmtDuration(s.seconds)}`}</span>
          </span>
        ))}
        <span aria-hidden className="text-gray-300">{' →\u00a0'}</span>
        <span className={v.outcome === 'SIGNUP' ? 'font-medium text-gray-900' : 'text-gray-500'}>{end}</span>
      </p>
    </li>
  );
}

/**
 * 포트폴리오 PDF 저장 (2026-10-03) — 작가가 [포트폴리오] 탭에서 PDF 를 저장할 때마다 한 줄씩 쌓인다(`backend/src/lib/exportStats.ts`).
 * 만들기 화면을 고친 효과를 보려고 만들었다 — 그 전에는 몇 명이 이 기능을 쓰는지 알 길이 없었다.
 * 계열이 하나라 범례를 두지 않는다(제목이 곧 이름). 방식별 숫자는 표에서 본다.
 * ⚠️ '작가 수'를 날짜끼리 더하지 말 것 — 이틀에 걸쳐 저장한 한 사람이 2명이 된다. 전체 작가 수는 서버가 따로 센다(`totals.artists`).
 */
function ExportSection({ days }: { days: number }) {
  const { data, isLoading, isError } = useQuery<ExportStats>({
    queryKey: ['admin-export-stats', days],
    queryFn: () => api.get(`/admin/stats/portfolio-exports?days=${days}`).then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const rows = trimBeforeSince(data?.rows ?? [], data?.since ?? null);
  const sum = summarizeExports(rows);
  const tile = (label: string, value: string, unit: string, sub: string) => (
    <div className="min-w-0 rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}<span className="ml-0.5 text-sm font-normal text-gray-500">{unit}</span></p>
      <p className="mt-0.5 text-xs tabular-nums text-gray-600">{sub}</p>
    </div>
  );

  return (
    <section className="rounded-2xl border border-gray-200 p-4 md:p-6" aria-labelledby="stats-pdf-exports">
      <h3 id="stats-pdf-exports" className="text-base font-medium text-gray-900">포트폴리오 PDF 저장</h3>
      <p className="mt-0.5 text-sm text-gray-500">작가가 [포트폴리오] 탭에서 PDF·PPT 를 저장한 횟수.</p>

      {isLoading ? (
        <div className="mt-5 h-48 animate-pulse rounded-xl bg-gray-50" />
      ) : isError ? (
        <p className="mt-5 text-sm text-accent">통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      ) : !data?.since ? (
        <p className="mt-5 rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          아직 기록이 없습니다. 작가가 포트폴리오 PDF 를 저장하면 여기에 하루 단위로 쌓입니다.
        </p>
      ) : (
        <>
          <div data-testid="export-kpis" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {tile('최근 7일', String(sum.last7), '회', `이 기간(${rows.length}일) 합계 ${sum.total}회`)}
            {tile('지금까지', String(data.totals.saves), '회', `저장한 작가 ${data.totals.artists}명`)}
            {tile('홈페이지에도 올림', String(sum.uploaded), '회', `이 기간 저장의 ${sum.total ? Math.round((sum.uploaded / sum.total) * 100) : 0}%`)}
          </div>
          <ExportChart rows={rows} />
          <p className="mt-3 text-xs leading-relaxed text-gray-400">
            저장할 때마다 1회(같은 작가가 여러 번 저장하면 여러 번) · 인쇄 창은 창을 연 횟수(그 안에서 실제로 저장했는지는 알 수 없습니다) · 집계 시작 {data.since}
          </p>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-900">표로 보기</summary>
            <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-gray-100">
              <table data-testid="export-table" className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">날짜</th>
                    <th className="px-3 py-2 text-right font-medium">저장</th>
                    <th className="px-3 py-2 text-right font-medium">작가</th>
                    <th className="px-3 py-2 text-right font-medium">내려받기</th>
                    <th className="px-3 py-2 text-right font-medium">인쇄 창</th>
                    <th className="px-3 py-2 text-right font-medium">PPT</th>
                    <th className="px-3 py-2 text-right font-medium">홈페이지에 올림</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.date} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{r.date} ({dayLabel(r.date).weekday})</td>
                      <td className="px-3 py-1.5 text-right font-medium text-gray-900">{r.total}</td>
                      <td className="px-3 py-1.5 text-right text-gray-900">{r.artists}</td>
                      <td className="px-3 py-1.5 text-right text-gray-900">{r.download}</td>
                      <td className="px-3 py-1.5 text-right text-gray-900">{r.print}</td>
                      <td className="px-3 py-1.5 text-right text-gray-900">{r.pptx}</td>
                      <td className="px-3 py-1.5 text-right text-gray-900">{r.uploaded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/** 날짜별 저장 횟수 — 막대 하나짜리(계열 1개). 올리거나 누르면 그날의 횟수·작가 수가 뜬다 */
function ExportChart({ rows }: { rows: ExportRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 140;
  const max = niceMax(Math.max(0, ...rows.map((r) => r.total)));
  const every = rows.length <= 10 ? 1 : rows.length <= 40 ? 7 : 14;
  const h = (n: number) => (n / max) * H;
  const tip = hover !== null ? rows[hover] : null;
  return (
    <figure className="mt-6" aria-label="날짜별 포트폴리오 PDF 저장 막대 그래프">
      <div className="flex">
        <div className="relative mr-2 w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-400" style={{ height: H }}>
          {[max, max / 2, 0].map((v, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: H - h(v) }}>{fmtAvg(v)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {[max, max / 2].map((v, i) => (
            <div key={i} aria-hidden className="absolute inset-x-0 border-t border-dashed border-gray-200" style={{ top: H - h(v) }} />
          ))}
          <div aria-hidden className="absolute inset-x-0 border-t border-gray-300" style={{ top: H }} />
          <div data-testid="export-bars" className="relative flex items-end" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => {
              const { md, weekday } = dayLabel(r.date);
              return (
                <button
                  key={r.date}
                  type="button"
                  aria-label={`${md}(${weekday}) 저장 ${r.total}회 · 작가 ${r.artists}명`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover(i)}
                  className={`flex h-full min-w-0 flex-1 cursor-default flex-col-reverse items-center px-[1px] focus:outline-none ${hover === i ? 'bg-gray-100/70' : ''}`}
                >
                  {r.total > 0 && <span className="block w-[70%] max-w-[28px] rounded-t-[4px]" style={{ height: h(r.total), background: MEMBER }} />}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex text-[11px] tabular-nums text-gray-400">
            {rows.map((r, i) => {
              const show = i === rows.length - 1 || (rows.length - 1 - i) % every === 0;
              return <span key={r.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{show ? dayLabel(r.date).md : ''}</span>;
            })}
          </div>
          {tip && hover !== null && (
            // role="status" 를 쓰지 않는다 — 방문자 차트의 풍선과 같은 화면에 둘이 되면 낭독기·테스트가 어느 것인지 가릴 수 없다
            <div
              data-testid="export-tip"
              className="pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm"
              style={{ left: `clamp(56px, ${((hover + 0.5) / rows.length) * 100}%, calc(100% - 56px))` }}
            >
              <p className="font-medium text-gray-900">{dayLabel(tip.date).md} ({dayLabel(tip.date).weekday})</p>
              <p className="mt-1 flex text-gray-600">저장 <b className="ml-auto pl-3 tabular-nums text-gray-900">{tip.total}회</b></p>
              <p className="flex text-gray-600">작가 <b className="ml-auto pl-3 tabular-nums text-gray-900">{tip.artists}명</b></p>
            </div>
          )}
        </div>
      </div>
    </figure>
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
