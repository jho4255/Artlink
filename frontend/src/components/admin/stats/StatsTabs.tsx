/**
 * 관리자 [통계] 탭의 새 구역(2026-11-21 개편, CLAUDE.md 규칙 89) — 요약 · 회원 · 공모·지원 · 갤러리·전시 · 기능 사용.
 * ([방문] 탭은 원래 있던 일간 방문자 · 비회원 둘러보기 — AdminStatsSection.tsx)
 * 숫자는 서버 `lib/adminStats.ts` 가 센다(1분 저장). 화면은 그리기만.
 *
 * ⚠️ 깔때기(비회원 → 가입 · 가입한 작가 → 지원)는 넣지 않았다 — 사용자 결정(2026-11-21 "별로 필요없을듯").
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { cn, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import { stageOf } from '@/lib/flowLabels';
import { getDday } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { agoText, deltaText, fmtNum, fmtPct, hoursText, shortDate, won } from '@/lib/adminFormat';
import { Dot, NumberTile, SectionHead, EmptyLine, Th } from '@/components/admin/AdminUi';
import { InlineBar, Legend, StackedBars, TableToggle, type Series } from '@/components/admin/stats/StatParts';
import type { VisitorRow } from '@/lib/visitStatsView';
import { trimBeforeSince } from '@/lib/visitStatsView';
import { VisitorChart, MEMBER, GUEST } from '@/components/admin/stats/VisitorChart';

const ROLE_SERIES: Series[] = [
  { key: 'ARTIST', name: '작가', color: '#1f2937' },
  { key: 'GALLERY', name: '갤러리', color: '#6b7280' },
];
/** 숫자가 의미 있으려면 볼 만큼은 봐야 한다 — 이보다 적게 본 공모엔 '지원 없음' 점을 달지 않는다 */
const QUIET_VIEWS = 100;

function useStats<T>(tab: string, days: number) {
  return useQuery<T>({
    queryKey: ['admin-stats', tab, days],
    queryFn: () => api.get(`/admin/stats/${tab}?days=${days}`).then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

function Loading() { return <div className="mt-6 h-72 animate-pulse rounded-[10px] bg-gray-100" />; }
function Failed() { return <p className="mt-6 text-sm text-accent">통계를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>; }
const weekLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}.${Number(d)}`; };
const periodText = (p?: { from: string; to: string }) => (p ? `${weekLabel(p.from)} – ${weekLabel(p.to)}` : '');

/** 공모 한 줄의 단계 이름(갤러리 [내 공모]와 같은 말) + 마감 */
function callStage(c: any): string {
  const s = stageOf({ ...c, settlementStarted: c.sales > 0 || !!c.settlementRequestedAt });
  if (s?.key === 'recruiting' && c.deadline) {
    const d = getDday(c.deadline);
    return d >= 0 ? `모집 중 · D-${d}` : '모집 중';
  }
  return s?.label ?? '';
}
function hostOf(c: any): string {
  if (c.hostType === 'ADMIN') return `아트링크 주최${c.managerNames?.length ? ` · ${c.managerNames[0]}${c.managerNames.length > 1 ? ` 외 ${c.managerNames.length - 1}곳` : ''}` : ' · 직접 운영'}${c.recruitOnly ? ' · 공모만 진행' : ''}`;
  return `${c.gallery?.name ?? '—'}${c.recruitOnly ? ' · 공모만 진행' : ''}`;
}
/** 많이 보는데 지원이 없다 — 첨부파일로 바깥 접수하는 공고는 지원 0 이 정상이라 빼고 '첨부 받음'으로 본다 */
const quiet = (c: any) => c.viewCount >= QUIET_VIEWS && c.apps === 0 && !c.hasAttachments && !c.recruitmentClosed && getDday(c.deadline) >= 0;

// ───────────────────────────── 요약 ─────────────────────────────

export function SummaryTab({ days, onTab }: { days: number; onTab: (t: 'calls' | 'visits') => void }) {
  const { data: s, isLoading, isError } = useStats<any>('summary', days);
  const { data: v } = useQuery<{ rows: VisitorRow[]; since: string | null }>({
    queryKey: ['admin-visitor-stats', days],
    queryFn: () => api.get(`/admin/stats/visitors?days=${days}`).then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  if (isLoading) return <Loading />;
  if (isError || !s) return <Failed />;
  const t = s.todo;
  const k = s.kpis;
  const todos = [
    { label: '승인 대기', n: t.approvals, unit: '건', note: [t.approvalsByKind.gallery && `갤러리 ${t.approvalsByKind.gallery}`, t.approvalsByKind.exhibition && `공모 ${t.approvalsByKind.exhibition}`, t.approvalsByKind.show && `전시 ${t.approvalsByKind.show}`, t.approvalsByKind.edit && `수정 ${t.approvalsByKind.edit}`, t.approvalsByKind.delete && `삭제 ${t.approvalsByKind.delete}`].filter(Boolean).join(' · ') || '없음', to: '/mypage?tab=approvals' },
    { label: '신고', n: t.reports, unit: '건', note: t.reports ? `ArtTalk ${t.reportsByKind.chat} · 소식 ${t.reportsByKind.story}` : '없음', to: '/mypage?tab=report-manage' },
    { label: '1:1 문의', n: t.inquiries, unit: '건', note: t.oldestInquiryAt ? `가장 오래된 문의 ${agoText(t.oldestInquiryAt)}` : '없음', to: '/support' },
    { label: '검토 대기 지원', n: t.pendingApplications, unit: '명', note: '아트링크가 직접 운영하는 공모', to: '/mypage?tab=hosted-exhibitions' },
    { label: '3일 안에 마감', n: t.closingSoon, unit: '건', note: t.closingSoonEmpty ? `그중 지원 0건 ${t.closingSoonEmpty}` : '아트링크 주최', to: '/mypage?tab=hosted-exhibitions', quiet: true },
    { label: '멈춘 공모', n: t.stalled, unit: '건', note: '정산 요청 전 · 이의 · 마감 뒤 검토', to: '/mypage?tab=oversight' },
  ];
  const vrows = trimBeforeSince(v?.rows ?? [], v?.since ?? null);
  const best = vrows.reduce<VisitorRow | null>((b, r) => (!b || r.total > b.total ? r : b), null);
  const sumWeeks = s.weeklySignups.reduce((n: number, w: any) => n + w.ARTIST + w.GALLERY + w.VISITOR, 0);
  const visitorsCur = k.visitors.current;
  const visitorsPrev = k.visitors.previous;

  return (
    <div className="mt-6 space-y-10">
      <section aria-labelledby="stats-todo">
        <SectionHead id="stats-todo" title="지금 처리할 일" />
        <div className="mt-3 grid grid-cols-2 border-t border-gray-900 sm:grid-cols-3 xl:grid-cols-6">
          {todos.map((x) => (
            <Link key={x.label} to={x.to} className="block border-b border-gray-200 py-4 pr-4 hover:bg-gray-50">
              <p className="text-[13px] text-gray-600">{x.n > 0 && !x.quiet && <Dot className="mr-2" />}{x.label}</p>
              <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums text-gray-950">{x.n}<span className="ml-1 text-sm font-medium text-gray-600">{x.unit}</span></p>
              <p className="mt-1.5 truncate text-[12.5px] text-gray-500">{x.note}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="stats-kpis">
        <SectionHead id="stats-kpis" title={`최근 ${days}일`} note={`${periodText(s.period)} · 앞선 ${days}일과 견줌`} />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <NumberTile label="방문자 · 하루 평균" value={visitorsCur ? fmtNum(visitorsCur.total) : '—'} unit="명"
            sub={visitorsCur ? deltaText(Math.round(visitorsCur.total), visitorsPrev ? Math.round(visitorsPrev.total) : null, days, '명') : '아직 기록이 없어요'}
            note={visitorsCur ? `회원 ${fmtNum(visitorsCur.members)} · 비회원 ${fmtNum(visitorsCur.guests)}` : undefined} />
          <NumberTile label="신규 가입" value={fmtNum(k.signups.current)} unit="명" sub={deltaText(k.signups.current, k.signups.previous, days, '명')}
            note={`작가 ${k.signups.byRole.ARTIST ?? 0} · 갤러리 ${k.signups.byRole.GALLERY ?? 0}${k.signups.byRole.VISITOR ? ` · 일반 ${k.signups.byRole.VISITOR}` : ''}`} />
          <NumberTile label="공모 지원" value={fmtNum(k.applications.current)} unit="건" sub={deltaText(k.applications.current, k.applications.previous, days, '건')}
            note={`수락 ${k.applications.accepted} · 검토 대기 ${k.applications.pending} · 거절 ${k.applications.rejected}`} />
          <NumberTile label="모집 중 공모" value={fmtNum(k.openCalls.now)} unit="건" sub={`이 기간에 새로 ${k.openCalls.newInPeriod}건`}
            note={`아트링크 주최 ${k.openCalls.admin} · 갤러리 ${k.openCalls.gallery}`} />
          <NumberTile label="다시 온 회원" value={fmtNum(k.returning.current)} unit="명" sub={`회원 ${fmtNum(k.returning.members)}명 중 ${fmtPct(k.returning.members ? k.returning.current / k.returning.members : null)}`}
            note={`${days}일 중 이틀 이상 들어온 회원`} />
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <SectionHead title="일간 방문자">
            <button type="button" onClick={() => onTab('visits')} className="min-h-[40px] text-[13px] text-gray-700 underline underline-offset-4">방문 탭에서 자세히</button>
          </SectionHead>
          {vrows.length ? (
            <>
              <VisitorChart rows={vrows} />
              {best && best.total > 0 && <p className="mt-3 text-[13px] text-gray-700">가장 많은 날 <strong className="font-semibold">{shortDate(best.date)} {best.total}명</strong></p>}
            </>
          ) : <p className="mt-4 text-sm text-gray-500">아직 방문 기록이 없어요.</p>}
        </div>
        <div className="min-w-0">
          <SectionHead title="주별 신규 가입" note="최근 8주" />
          <div className="mt-3"><Legend series={ROLE_SERIES} /></div>
          <div className="mt-4">
            <StackedBars label="최근 8주 주별 신규 가입" series={ROLE_SERIES} showTotal
              rows={s.weeklySignups.map((w: any) => ({ label: weekLabel(w.week), tip: `${weekLabel(w.week)} 주`, values: { ARTIST: w.ARTIST, GALLERY: w.GALLERY } }))} />
          </div>
          <p className="mt-3 text-[13px] text-gray-700">
            8주 동안 {sumWeeks}명 · 가입 방법(이 기간) 카카오 {fmtPct(k.signups.current ? (k.signups.byProvider.KAKAO ?? 0) / k.signups.current : null)} · 이메일 {fmtPct(k.signups.current ? 1 - (k.signups.byProvider.KAKAO ?? 0) / k.signups.current : null)}
          </p>
        </div>
      </section>

      {s.stalled.length > 0 && (
        <section aria-labelledby="stats-stalled">
          <SectionHead id="stats-stalled" title="멈춘 공모" note={`${s.stalled.length}건 · 전시 끝나고 7일 넘게 정산 요청 전 · 정산 이의 · 마감 지나 3일 넘게 검토 대기`}>
            <Link to="/mypage?tab=oversight" className="min-h-[40px] text-[13px] text-gray-700 underline underline-offset-4">운영 조회에서 보기</Link>
          </SectionHead>
          <ul className="mt-2 border-t border-gray-900">
            {s.stalled.map((x: any) => (
              <li key={x.id} className="flex items-center justify-between gap-3 border-b border-gray-100 py-3">
                <Link to={`/mypage?tab=oversight&ex=${x.id}`} className="min-w-0 truncate text-[14.5px] font-medium hover:underline">{x.title}</Link>
                <span className="shrink-0 text-[13px] font-semibold text-accent"><Dot className="mr-1.5" />{x.stall.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="stats-calls">
        <SectionHead id="stats-calls" title="공모 성과" note="많이 본 공모 · 조회는 누적, 첨부 받음은 이 기간">
          <button type="button" onClick={() => onTab('calls')} className="min-h-[40px] text-[13px] text-gray-700 underline underline-offset-4">모두 보기</button>
        </SectionHead>
        <CallsTable rows={s.calls} />
      </section>

      <section aria-labelledby="stats-speed">
        <SectionHead id="stats-speed" title="운영 속도" note={`최근 ${days}일 · 걸린 시간의 중간값`} />
        <div className="mt-3 grid grid-cols-2 border-t border-gray-900 lg:grid-cols-4">
          {[
            ['승인 요청 → 결정', s.speed.approvals, s.speed.approvals.count ? `${s.speed.approvals.count}건 · 가장 오래 걸린 건 ${hoursText(s.speed.approvals.maxHours)}` : '처리한 요청이 없어요'],
            ['1:1 문의 → 답변', s.speed.inquiries, `${s.speed.inquiries.count}건 · 아직 답하지 않은 문의 ${s.speed.inquiries.open}`],
            ['지원 → 결과', s.speed.applications, `${s.speed.applications.count}건 · 초대 코드 참여는 빼고`],
            ['신고 → 처리', s.speed.reports, `${s.speed.reports.count}건 · ArtTalk 신고`],
          ].map(([label, v, note]: any) => (
            <div key={label} className="border-b border-gray-200 py-4 pr-4">
              <p className="text-[13px] text-gray-600">{label}</p>
              <p className="mt-1.5 text-[22px] font-semibold tracking-tight text-gray-950">{v.count ? hoursText(v.medianHours) : '—'}</p>
              <p className="mt-1 text-[12.5px] text-gray-500">{note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** 공모 성과 표 — 요약(8줄)과 [공모·지원] 탭(전부)이 같이 쓴다 */
function CallsTable({ rows }: { rows: any[] }) {
  const wide = useMediaQuery('(min-width: 768px)');
  if (!rows.length) return <div className="mt-3"><EmptyLine>아직 공모가 없어요.</EmptyLine></div>;
  const maxViews = Math.max(1, ...rows.map((c) => c.viewCount));
  // 휴대폰은 줄 목록 — 일곱 칸 표를 옆으로 밀게 두지 않는다
  if (!wide) {
    return (
      <ul className="mt-2 border-t border-gray-900" aria-label="공모 성과">
        {rows.map((c) => (
          <li key={c.id} className="border-b border-gray-100">
            <Link to={`/mypage?tab=oversight&ex=${c.id}`} className="block py-3">
              <span className="block truncate text-[14.5px] font-medium text-gray-950">{c.title}</span>
              <span className="mt-0.5 block text-[12.5px] tabular-nums text-gray-600">
                {callStage(c)} · 조회 {fmtNum(c.viewCount)} · 지원 {c.apps}{c.hasAttachments ? ` · 첨부 받음 ${fmtNum(c.periodAttachmentDownloads)}` : ''} · 찜 {c.favorites}
              </span>
              {quiet(c) && <span className="mt-0.5 block text-[12.5px] font-semibold text-accent"><Dot className="mr-1.5" />많이 보는데 지원이 없어요</span>}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <div role="table" aria-label="공모 성과" className="min-w-[760px] border-t border-gray-900">
        <div role="row" className="grid grid-cols-[minmax(0,1fr)_112px_200px_56px_88px_64px_48px] items-center gap-3.5 border-b border-gray-200 py-2.5">
          <Th>공모</Th><Th>단계</Th><Th>조회</Th><Th className="text-right">지원</Th><Th className="text-right">조회 100번당</Th><Th className="text-right">첨부 받음</Th><Th className="text-right">찜</Th>
        </div>
        {rows.map((c) => (
          <div role="row" key={c.id} className="grid grid-cols-[minmax(0,1fr)_112px_200px_56px_88px_64px_48px] items-center gap-3.5 border-b border-gray-100 py-2.5">
            <span role="cell" className="min-w-0">
              <Link to={`/mypage?tab=oversight&ex=${c.id}`} className="block truncate text-[14.5px] font-medium text-gray-950 hover:underline">{c.title}</Link>
              <span className="block truncate text-[12.5px] text-gray-500">
                {hostOf(c)}
                {quiet(c) && <span className="ml-2.5 font-semibold text-accent"><Dot className="mr-1.5" />많이 보는데 지원이 없어요</span>}
              </span>
            </span>
            <span role="cell" className="text-[13px] text-gray-700">{callStage(c)}</span>
            <span role="cell"><InlineBar value={c.viewCount} max={maxViews} /></span>
            <span role="cell" className="text-right text-[14px] font-semibold tabular-nums">{c.apps}</span>
            <span role="cell" className="text-right text-[13.5px] tabular-nums text-gray-700">{c.viewCount ? (c.apps / c.viewCount * 100).toFixed(1) : '—'}</span>
            <span role="cell" className="text-right text-[13.5px] tabular-nums text-gray-700">{c.hasAttachments ? fmtNum(c.periodAttachmentDownloads) : '—'}</span>
            <span role="cell" className="text-right text-[13.5px] tabular-nums text-gray-700">{c.favorites}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── 회원 ─────────────────────────────

export function MembersTab({ days }: { days: number }) {
  const { data: m, isLoading, isError } = useStats<any>('members', days);
  if (isLoading) return <Loading />;
  if (isError || !m) return <Failed />;
  const rt = m.roleTotals ?? {};
  const providerSeries: Series[] = [{ key: 'KAKAO', name: '카카오', color: MEMBER }, { key: 'EMAIL', name: '이메일', color: GUEST }];
  return (
    <div className="mt-6 space-y-10">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <NumberTile label="작가" value={fmtNum(rt.ARTIST ?? 0)} unit="명" />
        <NumberTile label="갤러리" value={fmtNum(rt.GALLERY ?? 0)} unit="명" />
        <NumberTile label="일반" value={fmtNum(rt.VISITOR ?? 0)} unit="명" />
        <NumberTile label="관리자" value={fmtNum(rt.ADMIN ?? 0)} unit="명" />
        <NumberTile label="탈퇴" value={fmtNum(m.withdrawn.total)} unit="명" sub={`최근 ${days}일 ${m.withdrawn.inPeriod}명`} />
      </section>

      <section className="grid gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionHead title="주별 신규 가입 — 역할" note="최근 12주" />
          <div className="mt-3"><Legend series={ROLE_SERIES} /></div>
          <div className="mt-4"><StackedBars label="주별 신규 가입 역할" series={ROLE_SERIES} showTotal every={2}
            rows={m.weekly.map((w: any) => ({ label: weekLabel(w.week), tip: `${weekLabel(w.week)} 주`, values: { ARTIST: w.ARTIST, GALLERY: w.GALLERY } }))} /></div>
        </div>
        <div className="min-w-0">
          <SectionHead title="주별 신규 가입 — 가입 방법" note="최근 12주" />
          <div className="mt-3"><Legend series={providerSeries} /></div>
          <div className="mt-4"><StackedBars label="주별 신규 가입 가입 방법" series={providerSeries} every={2}
            rows={m.weekly.map((w: any) => ({ label: weekLabel(w.week), tip: `${weekLabel(w.week)} 주`, values: { KAKAO: w.KAKAO, EMAIL: w.EMAIL } }))} /></div>
        </div>
      </section>

      <section>
        <SectionHead title="주간 활성 회원" note={`그 주에 하루라도 들어온 회원 · 관리자 제외${m.visitsSince ? ` · ${shortDate(m.visitsSince)}부터 기록` : ''}`} />
        <div className="mt-4"><StackedBars label="주간 활성 회원" series={[{ key: 'active', name: '활성 회원', color: MEMBER }]} showTotal every={2}
          rows={m.weekly.map((w: any) => ({ label: weekLabel(w.week), tip: `${weekLabel(w.week)} 주`, values: { active: w.active } }))} /></div>
        <TableToggle head={['주', '작가 가입', '갤러리 가입', '카카오', '이메일', '활성 회원']}
          rows={m.weekly.map((w: any) => [weekLabel(w.week), w.ARTIST, w.GALLERY, w.KAKAO, w.EMAIL, w.active])} />
      </section>

      <section>
        <SectionHead title="가입 주차별 재방문" note="그 주에 가입한 회원 중 다음 주(7~13일 뒤) · 4주 뒤(28~34일 뒤)에 다시 들어온 비율" />
        <div role="table" aria-label="가입 주차별 재방문" className="mt-2 border-t border-gray-900">
          <div role="row" className="grid grid-cols-[96px_72px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3.5 border-b border-gray-200 py-2.5">
            <Th>가입 주</Th><Th className="text-right">가입</Th><Th>다음 주</Th><Th>4주 뒤</Th>
          </div>
          {m.cohorts.slice().reverse().map((c: any) => (
            <div role="row" key={c.week} className="grid grid-cols-[96px_72px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3.5 border-b border-gray-100 py-2.5 text-[13.5px] tabular-nums">
              <span role="cell">{weekLabel(c.week)} 주</span>
              <span role="cell" className="text-right">{c.size}명</span>
              <span role="cell">{c.week1 == null ? <span className="text-gray-500">아직</span> : <InlineBar value={Math.round(c.week1 * 100)} max={100}>{fmtPct(c.week1)}</InlineBar>}</span>
              <span role="cell">{c.week4 == null ? <span className="text-gray-500">아직</span> : <InlineBar value={Math.round(c.week4 * 100)} max={100}>{fmtPct(c.week4)}</InlineBar>}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-gray-500">'아직'은 그 기간이 다 지나지 않았거나 방문 기록(2026.9.28~) 전에 가입한 주예요.</p>
      </section>
    </div>
  );
}

// ─────────────────────────────── 공모·지원 ───────────────────────────────

export function CallsTab({ days }: { days: number }) {
  const { data: c, isLoading, isError } = useStats<any>('calls', days);
  if (isLoading) return <Loading />;
  if (isError || !c) return <Failed />;
  const appSeries: Series[] = [
    { key: 'accepted', name: '수락', color: '#1f2937' },
    { key: 'rejected', name: '거절', color: '#6b7280' },
    { key: 'pending', name: '검토 대기', color: '#b8bec8' },
  ];
  const totalWeeks = c.weekly.reduce((n: number, w: any) => n + w.total, 0);
  const acceptedWeeks = c.weekly.reduce((n: number, w: any) => n + w.accepted, 0);
  const decided = c.weekly.reduce((n: number, w: any) => n + w.accepted + w.rejected, 0);
  const maxRegion = Math.max(1, ...c.regions.map((r: any) => r.calls));
  return (
    <div className="mt-6 space-y-10">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <NumberTile label="지원한 작가" value={fmtNum(c.applicants.inPeriod)} unit="명" sub={`최근 ${days}일 · 한 명당 ${fmtNum(c.applicants.perApplicant, 1)}건`} />
        <NumberTile label="수락률" value={fmtPct(decided ? acceptedWeeks / decided : null)} sub={`최근 12주 결정된 ${decided}건 중`} />
        <NumberTile label="다시 지원한 작가" value={fmtPct(c.applicants.repeatRate)} sub={`지원한 적 있는 작가 ${c.applicants.ever}명 중 두 번 이상`} />
        <NumberTile label="정원 충족" value={fmtPct(c.capacityFill.average)} sub={`모집이 끝난 숫자 정원 공모 ${c.capacityFill.calls}건 · 꽉 찬 ${c.capacityFill.full}건`} note="최근 6개월" />
      </section>

      <section>
        <SectionHead title="주별 지원" note={`최근 12주 · ${totalWeeks}건(상태는 지금 기준)`} />
        <div className="mt-3"><Legend series={appSeries} /></div>
        <div className="mt-4"><StackedBars label="주별 지원" series={appSeries} showTotal every={2}
          rows={c.weekly.map((w: any) => ({ label: weekLabel(w.week), tip: `${weekLabel(w.week)} 주`, values: { accepted: w.accepted, rejected: w.rejected, pending: w.pending } }))} /></div>
        <TableToggle head={['주', '지원', '수락', '거절', '검토 대기']} rows={c.weekly.map((w: any) => [weekLabel(w.week), w.total, w.accepted, w.rejected, w.pending])} />
      </section>

      <section className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <SectionHead title="지역별 — 공급과 관심" note={`최근 ${days}일에 올라온 공모 · 그 지역 공모에 들어온 지원 · 승인된 갤러리`} />
          {c.regions.length === 0 ? <p className="mt-3 text-sm text-gray-500">이 기간에 올라온 공모가 없어요.</p> : (
            <div role="table" aria-label="지역별 공모" className="mt-2 border-t border-gray-900">
              <div role="row" className="grid grid-cols-[72px_minmax(0,1fr)_64px_64px] items-center gap-3.5 border-b border-gray-200 py-2.5">
                <Th>지역</Th><Th>공모</Th><Th className="text-right">지원</Th><Th className="text-right">갤러리</Th>
              </div>
              {c.regions.map((r: any) => (
                <div role="row" key={r.region} className="grid grid-cols-[72px_minmax(0,1fr)_64px_64px] items-center gap-3.5 border-b border-gray-100 py-2.5 text-[13.5px] tabular-nums">
                  <span role="cell">{regionLabels[r.region] ?? r.region}</span>
                  <span role="cell"><InlineBar value={r.calls} max={maxRegion} /></span>
                  <span role="cell" className="text-right">{r.applications}</span>
                  <span role="cell" className="text-right text-gray-700">{r.galleries}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <SectionHead title="유형별" note={`최근 ${days}일에 올라온 공모`} />
          <ul className="mt-2 border-t border-gray-900">
            {c.types.map((t: any) => (
              <li key={t.type} className="flex items-center justify-between border-b border-gray-100 py-2.5 text-[13.5px] tabular-nums">
                <span>{exhibitionTypeLabels[t.type] ?? t.type}</span><span>{t.calls}건 · 조회 {fmtNum(t.views)}</span>
              </li>
            ))}
            {c.types.length === 0 && <li className="py-3 text-sm text-gray-500">없어요.</li>}
          </ul>
        </div>
      </section>

      <section>
        <SectionHead title="공모별 성과" note={`최근 ${days}일에 올라왔거나 지금 모집 중인 공모 ${c.rows.length}건 · 조회 많은 순`} />
        <CallsTable rows={c.rows} />
      </section>
    </div>
  );
}

// ─────────────────────────────── 갤러리·전시 ───────────────────────────────

export function GalleriesTab({ days }: { days: number }) {
  const { data: g, isLoading, isError } = useStats<any>('galleries', days);
  if (isLoading) return <Loading />;
  if (isError || !g) return <Failed />;
  const x = g.galleries;
  const shows = g.shows;
  const trade = g.trade;
  return (
    <div className="mt-6 space-y-10">
      <section>
        <SectionHead title="갤러리" />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <NumberTile label="갤러리 회원" value={fmtNum(x.accounts)} unit="명" sub={`등록한 갤러리 ${x.registered}곳`} note={`승인 ${x.approved} · 대기 ${x.pending} · 반려 ${x.rejected}`} />
          <NumberTile label="공모를 연 적 있는 갤러리" value={fmtNum(x.withCall)} unit="곳" sub={`승인된 ${x.approved}곳 중 ${fmtPct(x.approved ? x.withCall / x.approved : null)}`} note={`전시를 올린 적 있는 곳 ${x.withShow}`} />
          <NumberTile label={`최근 ${days}일 들어온 갤러리 회원`} value={fmtNum(x.activeOwners)} unit="명" sub={`이 기간 새로 등록한 갤러리 ${x.newInPeriod}곳`} />
          <NumberTile label={`최근 ${days}일 공모·전시를 올린 곳`} value={fmtNum(x.posted)} unit="곳" />
        </div>
      </section>

      <section>
        <SectionHead title="거래" note="정산까지 마친 공모의 판매 — 갤러리 몫은 카드 수수료 빼기 전" />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <NumberTile label={`최근 ${days}일 정산 완료`} value={fmtNum(trade.settledInPeriod)} unit="건" sub={`판매 ${trade.period.sales}점`} />
          <NumberTile label={`최근 ${days}일 판매 합계`} value={won(trade.period.amount)} sub={`갤러리 몫 ${won(trade.period.galleryShare)}`} />
          <NumberTile label="지금까지 판매" value={fmtNum(trade.all.sales)} unit="점" />
          <NumberTile label="지금까지 판매 합계" value={won(trade.all.amount)} sub={`갤러리 몫 ${won(trade.all.galleryShare)}`} />
        </div>
      </section>

      <section>
        <SectionHead title="전시" note={`지금 열려 있는 전시 ${shows.now}건 · 승인 ${shows.byStatus.APPROVED ?? 0} · 대기 ${shows.byStatus.PENDING ?? 0}`} />
        {shows.top.length === 0 ? <p className="mt-3 text-sm text-gray-500">아직 승인된 전시가 없어요.</p> : (
          <ul className="mt-2 border-t border-gray-900">
            {shows.top.map((s: any) => (
              <li key={s.id} className="flex items-center gap-3 border-b border-gray-100 py-2.5">
                <span className="h-12 w-9 shrink-0 bg-gray-100">{s.posterImage && <img src={s.posterImage} alt="" loading="lazy" className="h-12 w-9 object-contain" />}</span>
                <span className="min-w-0 flex-1">
                  <Link to={`/shows/${s.id}`} className="block truncate text-[14.5px] font-medium hover:underline">{s.title}</Link>
                  <span className="block truncate text-[12.5px] text-gray-500">{s.gallery?.name} · {shortDate(s.startDate)} – {shortDate(s.endDate)}</span>
                </span>
                <span className="shrink-0 text-[13.5px] tabular-nums text-gray-700">조회 {fmtNum(s.viewCount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────── 기능 사용 ───────────────────────────────

const FEATURE_ROWS: [string, string][] = [
  ['stories', 'ArtStory 소식'], ['storyLikes', '소식 좋아요'], ['storyComments', '소식 댓글'],
  ['posts', '커뮤니티 글'], ['postComments', '커뮤니티 댓글'], ['postLikes', '커뮤니티 좋아요'],
  ['directChats', 'ArtTalk 1:1 대화 시작'], ['messages', 'ArtTalk 메시지'], ['homepageInquiries', '홈페이지 비회원 문의'],
  ['artworkLikes', '작품 좋아요'], ['follows', '이웃 추가'], ['favorites', '찜'], ['reviews', '갤러리 리뷰'], ['guestbook', '방명록'], ['pdf', '포트폴리오 PDF 저장'],
];
const NOTE_LABEL: Record<string, string> = {
  CHAT_MESSAGE: 'ArtTalk 새 메시지', APPLICATION_STATUS: '지원 결과', NEW_APPLICANT: '새 지원자', APPROVAL_RESULT: '승인 결과',
  INQUIRY_REPLY: '문의 답변', INQUIRY_NEW: '새 1:1 문의', ARTWORK_LIKE: '작품 좋아요', NEIGHBOR_FOLLOW: '이웃 추가', STORY_COMMENT: '소식 댓글',
  STORY_LIKE: '소식 좋아요', POST_LIKE: '글 좋아요', POST_COMMENT: '글 댓글', COMMENT_REPLY: '답글', MENTION: '멘션',
  SUBMISSION_RECEIVED: '출품 자료', EXHIBITION_CONFIRMED: '전시 확정', SETTLEMENT_ALL_APPROVED: '정산 확인', SETTLEMENT_ISSUE: '정산 이의',
  HOMEPAGE_INQUIRY: '홈페이지 문의', CHAT_REPORT: 'ArtTalk 신고', EXHIBITION_DELETED: '공모 삭제',
};

export function UsageTab({ days }: { days: number }) {
  const { data: u, isLoading, isError } = useStats<any>('usage', days);
  if (isLoading) return <Loading />;
  if (isError || !u) return <Failed />;
  const maxCur = Math.max(1, ...FEATURE_ROWS.map(([k]) => u.features[k]?.current ?? 0));
  return (
    <div className="mt-6 space-y-10">
      <section>
        <SectionHead title="기능별 사용" note={`최근 ${days}일 · 앞선 ${days}일과 견줌`} />
        <div role="table" aria-label="기능별 사용" className="mt-2 border-t border-gray-900">
          <div role="row" className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,200px)] items-center gap-3.5 border-b border-gray-200 py-2.5">
            <Th>기능</Th><Th>이 기간</Th><Th>견줌</Th>
          </div>
          {FEATURE_ROWS.map(([k, label]) => {
            const f = u.features[k] ?? { current: 0, previous: 0 };
            return (
              <div role="row" key={k} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,200px)] items-center gap-3.5 border-b border-gray-100 py-2 text-[13.5px]">
                <span role="cell" className="truncate">{label}</span>
                <span role="cell"><InlineBar value={f.current} max={maxCur} /></span>
                <span role="cell" className="truncate text-[12.5px] tabular-nums text-gray-600">{deltaText(f.current, f.previous, days)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12.5px] text-gray-500">앱 알림을 받는 기기 {fmtNum(u.pushDevices)}대</p>
      </section>

      <section>
        <SectionHead title="알림" note={`최근 ${days}일에 보낸 벨 알림 · 읽은 비율`} />
        {u.notifications.length === 0 ? <p className="mt-3 text-sm text-gray-500">보낸 알림이 없어요.</p> : (
          <div role="table" aria-label="알림" className="mt-2 border-t border-gray-900">
            <div role="row" className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,200px)] items-center gap-3.5 border-b border-gray-200 py-2.5">
              <Th>종류</Th><Th className="text-right">보냄</Th><Th>읽음</Th>
            </div>
            {u.notifications.map((n: any) => (
              <div role="row" key={n.type} className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,200px)] items-center gap-3.5 border-b border-gray-100 py-2 text-[13.5px] tabular-nums">
                <span role="cell" className="truncate">{NOTE_LABEL[n.type] ?? n.type}</span>
                <span role="cell" className="text-right">{fmtNum(n.sent)}</span>
                <span role="cell" className={cn(n.sent && n.read / n.sent < 0.3 && 'text-gray-500')}><InlineBar value={Math.round((n.read / Math.max(1, n.sent)) * 100)} max={100}>{fmtPct(n.read / Math.max(1, n.sent))}</InlineBar></span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
