/**
 * 공모 흐름 개편(2026-11-20, 규칙 88) — 진행 띠 · 목록 보조 글 · 탭 고르기 · 목록 자리 · 화면 소스 가드
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  flowStrip, gallerySubText, artistSubText, viewForTarget, workspaceDefaultView, artistDefaultView, artistNextTask, galleryNextTask,
  type StripInput, type ArtistSnapshot, type GallerySnapshot,
} from '@/lib/flowLabels';
import { rememberListScroll, takeListScroll } from '@/lib/listScroll';
import { submissionState } from '@/lib/submissionChecklist';

const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(SRC, f), 'utf-8');
/** 주석을 뺀 소스 — 주석에 남긴 옛 이름(기록)은 검사하지 않는다 */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 2026-11-20 정오(KST). 날짜는 UTC 자정 = KST 09:00 (저장 규칙과 같다, 규칙 14)
const NOW = new Date('2026-11-20T03:00:00.000Z');
const day = (offset: number) => new Date(Date.UTC(2026, 10, 20 + offset)).toISOString();
const ddayFn = (d: string | Date) => Math.round((new Date(d).getTime() - Date.UTC(2026, 10, 20)) / 86400000);

const base: StripInput = { status: 'APPROVED', recruitOnly: false };

describe('flowStrip — 다섯 칸(갤러리)', () => {
  it('모집 중: 첫 칸이 지금 · 받은 지원 수(아직 아무도 결정하지 않는다, 규칙 90) · 7일 안 마감은 빨강', () => {
    const cells = flowStrip('gallery', { ...base, deadline: day(5), accepted: 0, pending: 3, capacity: 4, exhibitStartDate: day(30), exhibitDate: day(44) }, NOW);
    expect(cells.map(c => c.label)).toEqual(['모집', '전시 준비', '전시', '정산', '마무리']);
    expect(cells.map(c => c.state)).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
    expect(cells[0]).toMatchObject({ value: '지원 3', hot: true });
    expect(cells[0]!.note).toContain('마감');
    // 초대 코드로 들어온 수락이 있으면 함께
    expect(flowStrip('gallery', { ...base, deadline: day(5), accepted: 2, pending: 3, capacity: 4 }, NOW)[0]!.value).toBe('수락 2/4 · 지원 3');
    // 마감 뒤엔 수락/정원 · 대기
    expect(flowStrip('gallery', { ...base, recruitmentClosed: true, accepted: 2, pending: 3, capacity: 4 }, NOW)[0]!.value).toBe('수락 2/4 · 대기 3');
  });

  it('★ 공모만 진행: 마감 뒤 결정을 기다리는 지원이 남았으면 \'선정 중\' — 선정 칸이 지금 · 다 정하면 선정 완료', () => {
    const only = { ...base, recruitOnly: true, recruitmentClosed: true, accepted: 1, capacity: 3 };
    const selecting = flowStrip('gallery', { ...only, pending: 2 }, NOW);
    expect(selecting.map(c => c.state)).toEqual(['done', 'current']);
    expect(selecting[1]).toMatchObject({ label: '선정', value: '수락 1/3 · 대기 2' });
    const done = flowStrip('gallery', { ...only, pending: 0 }, NOW);
    expect(done[1]).toMatchObject({ state: 'current', value: '선정 완료' });
  });

  it('마감이 8일 넘게 남았으면 빨강이 아니다', () => {
    const cells = flowStrip('gallery', { ...base, deadline: day(12), accepted: 0, pending: 0 }, NOW);
    expect(cells[0]!.hot).toBe(false);
  });

  it('전시 준비: 출품 자료 c/r · 미제출이 있고 3일 안이면 빨강', () => {
    const cells = flowStrip('gallery', { ...base, recruitmentClosed: true, submissionDeadline: day(2), exhibitStartDate: day(10), exhibitDate: day(24), submissionsComplete: 1, submissionsRequired: 4 }, NOW);
    expect(cells.map(c => c.state)).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    expect(cells[1]).toMatchObject({ value: '출품 자료 1/4', hot: true });
    expect(cells[1]!.note).toMatch(/D-2/);
  });

  it('정산 중 · 이의가 있으면 정산 칸에 이의 n건(빨강)', () => {
    const cells = flowStrip('gallery', {
      ...base, recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: day(-2), settlementStarted: true,
      exhibitStartDate: day(-30), exhibitDate: day(-5), approvals: { total: 3, approved: 1, issue: 1 },
    }, NOW);
    expect(cells.map(c => c.state)).toEqual(['done', 'done', 'done', 'current', 'todo']);
    expect(cells[3]).toMatchObject({ value: '작가 확인 1/3', note: '이의 1건', hot: true });
  });

  it('정산 완료면 마무리 칸이 지금이고 날짜가 붙는다', () => {
    const cells = flowStrip('gallery', { ...base, recruitmentClosed: true, ended: true, settledAt: day(-1), exhibitDate: day(-10), approvals: { total: 2, approved: 2, issue: 0 } }, NOW);
    expect(cells.map(c => c.state)).toEqual(['done', 'done', 'done', 'done', 'current']);
    expect(cells[4]!.value).toBeTruthy();
    expect(cells[3]!.value).toBe('작가 확인 2/2');
  });

  it('공모만 진행: 두 칸(모집 · 선정)', () => {
    const open = flowStrip('gallery', { ...base, recruitOnly: true, deadline: day(3), accepted: 1, pending: 0 }, NOW);
    expect(open.map(c => c.label)).toEqual(['모집', '선정']);
    expect(open.map(c => c.state)).toEqual(['current', 'todo']);
    const done = flowStrip('gallery', { ...base, recruitOnly: true, recruitmentClosed: true }, NOW);
    expect(done.map(c => c.state)).toEqual(['done', 'current']);
  });

  it('승인 대기는 전부 앞으로 할 일', () => {
    expect(flowStrip('gallery', { status: 'PENDING' }, NOW).every(c => c.state === 'todo')).toBe(true);
  });
});

describe('flowStrip — 작가', () => {
  it('심사 중: 첫 칸 이름이 지원 · 값 심사 중 · 나머지는 앞으로', () => {
    const cells = flowStrip('artist', { ...base, applicationStatus: 'SUBMITTED', recruitmentClosed: true }, NOW);
    expect(cells[0]).toMatchObject({ label: '지원', state: 'current', value: '심사 중' });
    expect(cells.slice(1).every(c => c.state === 'todo')).toBe(true);
  });

  it('선정 · 자료를 아직 안 냈으면 전시 준비 칸에 마감(3일 안이면 빨강)', () => {
    const cells = flowStrip('artist', { ...base, recruitmentClosed: true, applicationStatus: 'ACCEPTED', submissionComplete: false, submissionDeadline: day(1) }, NOW);
    expect(cells[0]).toMatchObject({ state: 'done', value: '선정' });
    expect(cells[1]).toMatchObject({ state: 'current', hot: true });
    expect(cells[1]!.note).toMatch(/D-1/);
  });

  it('정산 확인 요청을 받았으면 빨강 · 확인했으면 확인함', () => {
    const ended = { ...base, recruitmentClosed: true, ended: true, settlementRequestedAt: day(-1), applicationStatus: 'ACCEPTED' as const, submissionComplete: true };
    expect(flowStrip('artist', { ...ended, mySettlementStatus: 'PENDING' }, NOW)[3]).toMatchObject({ value: '확인 요청', hot: true });
    expect(flowStrip('artist', { ...ended, mySettlementStatus: 'APPROVED' }, NOW)[3]).toMatchObject({ value: '확인함' });
    expect(flowStrip('artist', { ...ended, mySettlementStatus: 'ISSUE' }, NOW)[3]).toMatchObject({ value: '이의 보냄' });
  });
});

describe('목록 보조 글', () => {
  it('갤러리: 모집 중은 마감 D-n · 조회(값이 있을 때만)', () => {
    expect(gallerySubText({ stageKey: 'recruiting', deadline: day(9), viewCount: 124 }, ddayFn)).toBe('마감 D-9 · 조회 124');
    expect(gallerySubText({ stageKey: 'recruiting', deadline: day(9), viewCount: null }, ddayFn)).toBe('마감 D-9');
  });
  it('갤러리: 전시 준비는 출품 자료 마감, 지났으면 전시 시작', () => {
    expect(gallerySubText({ stageKey: 'preparing', submissionDeadline: day(6), exhibitStartDate: day(18) }, ddayFn)).toBe('출품 자료 마감 D-6');
    expect(gallerySubText({ stageKey: 'preparing', submissionDeadline: day(-1), exhibitStartDate: day(10) }, ddayFn)).toBe('전시 시작 D-10');
  });
  it('갤러리: 정산 중은 확인 요청 날짜 · 승인 대기는 없음', () => {
    expect(gallerySubText({ stageKey: 'settling', settlementRequestedAt: day(-2) }, ddayFn)).toMatch(/^확인 요청 /);
    expect(gallerySubText({ stageKey: 'review' }, ddayFn)).toBeNull();
  });
  it('작가: 심사 중은 지원 날짜, 선정 뒤엔 출품 자료', () => {
    expect(artistSubText({ applicationStatus: 'SUBMITTED', appliedAt: day(-3) }, ddayFn)).toMatch(/ 지원$/);
    expect(artistSubText({ applicationStatus: 'ACCEPTED', stageKey: 'preparing', submissionComplete: false, submissionDeadline: day(6) }, ddayFn)).toBe('출품 자료 마감 D-6');
    expect(artistSubText({ applicationStatus: 'ACCEPTED', stageKey: 'preparing', submissionComplete: true, exhibitStartDate: day(10) }, ddayFn)).toBe('출품 자료 제출 완료 · 시작 D-10');
    expect(artistSubText({ applicationStatus: 'ACCEPTED', stageKey: 'settling', settlementRequestedAt: day(-1), mySettlementStatus: 'APPROVED' }, ddayFn)).toBe('확인함 · 갤러리 마무리 대기');
  });
});

describe('탭 고르기', () => {
  it('할 일의 target → 탭(단계 전환·없음은 단계 기본 탭)', () => {
    expect(viewForTarget('applicants')).toBe('applicants');
    expect(viewForTarget('settlement')).toBe('settlement');
    expect(viewForTarget('stage')).toBeNull();
    expect(viewForTarget(null)).toBeNull();
  });
  it('갤러리 처음 탭은 단계가 정한다', () => {
    expect(workspaceDefaultView('recruiting')).toBe('applicants');
    expect(workspaceDefaultView('preparing')).toBe('submissions');
    expect(workspaceDefaultView('running')).toBe('submissions');
    expect(workspaceDefaultView('settling')).toBe('settlement');
    expect(workspaceDefaultView('settled')).toBe('summary');
    expect(workspaceDefaultView('settled', true)).toBe('applicants');
  });
  it('작가 처음 탭 — 심사 중은 지원서, 정산 요청이 왔으면 정산', () => {
    const s: ArtistSnapshot = { status: 'ACCEPTED', recruitOnly: false, confirmed: false, ended: false, settled: false, settlementRequested: false, submissionComplete: false };
    expect(artistDefaultView({ ...s, status: 'SUBMITTED' })).toBe('application');
    expect(artistDefaultView(s)).toBe('submissions');
    expect(artistDefaultView({ ...s, ended: true, settlementRequested: true })).toBe('settlement');
    expect(artistDefaultView({ ...s, recruitOnly: true })).toBe('notices');
  });
});

describe('할 일 — 이의와 그 처리(작가 · 갤러리가 같은 말)', () => {
  const g = (o: Partial<GallerySnapshot>): GallerySnapshot => ({
    status: 'APPROVED', recruitOnly: false, recruitmentClosed: true, confirmed: true, ended: true, settled: false, settlementRequested: true,
    pending: 0, accepted: 3, submissionsIncomplete: 0, sales: 2, approvals: { total: 3, approved: 1, issue: 1 }, ...o,
  });
  it('갤러리: 이의가 있으면 그 말이 먼저(정산 탭으로)', () => {
    expect(galleryNextTask(g({}))).toMatchObject({ tone: 'attention', target: 'settlement', action: '이의 보기' });
    expect(galleryNextTask(g({})).text).toContain('이의');
  });
  it('작가: 이의를 보낸 뒤엔 빨강이 아니다 · 다시 요청(PENDING)이 오면 다시 빨강', () => {
    const a: ArtistSnapshot = { status: 'ACCEPTED', recruitOnly: false, confirmed: true, ended: true, settled: false, settlementRequested: true, submissionComplete: true };
    expect(artistNextTask({ ...a, mySettlementStatus: 'ISSUE' })).toMatchObject({ tone: 'neutral', target: 'settlement' });
    expect(artistNextTask({ ...a, mySettlementStatus: 'PENDING' })).toMatchObject({ tone: 'attention', action: '확인하기' });
    expect(artistNextTask({ ...a, mySettlementStatus: 'APPROVED' })).toBeNull();
  });
});

describe('목록 자리 기억 · 출품 자료 상태', () => {
  it('한 번 쓰면 지우고, 30분이 지나면 되돌리지 않는다', () => {
    rememberListScroll('t', 420);
    expect(takeListScroll('t')).toBe(420);
    expect(takeListScroll('t')).toBeNull();
    rememberListScroll('t', 300);
    expect(takeListScroll('t', Date.now() + 31 * 60 * 1000)).toBeNull();
  });
  it('제출 완료 · 작성 중 · 시작 전', () => {
    const cv = { biography: '약력' };
    const note = { statement: '노트' } as never;
    expect(submissionState({ artworkList: [{}], cv, note })).toBe('complete');
    expect(submissionState({ artworkList: [{}], cv: {}, note: null })).toBe('partial');
    expect(submissionState({ artworkList: [], cv: {}, note: null })).toBe('none');
  });
});

describe('화면 소스 가드 — 되돌리기 쉬운 것', () => {
  const ws = read('components/workspace/ExhibitionWorkspace.tsx');
  const settle = read('components/operation/SettlementSection.tsx');
  const op = read('pages/OperationPage.tsx');
  const am = read('components/shared/ApplicantManager.tsx');
  const apply = read('pages/ApplyPage.tsx');

  it('주 버튼은 한 자리 — PC 는 할 일 줄, 휴대폰은 하단 탭바 위 고정 줄(둘 다 그리지 않는다)', () => {
    expect(ws).toMatch(/actions=\{wide && hasButtons \? buttons : undefined\}/);
    expect(ws).toMatch(/\{!wide && hasButtons &&/);
    expect(ws).toMatch(/data-workspace-bar className="sticky bottom-\[calc\(3\.5rem\+1px\+env\(safe-area-inset-bottom\)\)\] tabbar-hidden:bottom-0 z-30/);
  });

  it('정산 표의 열 이름은 \'판매\' — \'팔림\' 이 아니다(2026-11-20 사용자)', () => {
    expect(settle).toContain('>판매</span>');
    expect(code('components/operation/SettlementSection.tsx')).not.toContain('팔림');
    expect(code('pages/OperationPage.tsx')).not.toContain('팔림');
  });

  it('작가 정산: [이의 제기]·[정산 확인] · 이의는 창에서(role=dialog) · 옛 이름 \'정산 확인(수락)\'·\'문제 제기\' 없음', () => {
    expect(op).toContain('정산 확인');
    expect(op).not.toContain('정산 확인(수락)');
    expect(op).not.toContain('문제 제기');
    expect(op).toMatch(/function SettlementIssueDialog[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
    expect(op).toContain('이의 보내기');
  });

  it('지원자 심사: 넓은 화면은 두 칸, 좁은 화면은 한 장씩 창(role=dialog) · 결정하면 다음 검토 대기로', () => {
    expect(am).toMatch(/useMediaQuery\('\(min-width: 1180px\)'\)/);
    expect(am).toMatch(/function ApplicantSheet[\s\S]*role="dialog" aria-modal="true"/);
    // 정원이 다 차 선정이 끝났으면(서버 closedOut) 넘어갈 사람이 없다 — 그 밖엔 다음 검토 대기로
    expect(am).toMatch(/const next = closedOut > 0 \? null : nextPendingAfter\(v\.appId\)/);
  });

  it('지원서: 약관은 [지원하기] 확인 창 안(D5) — 폼 끝 약관 구역·\'위 약관에 동의합니다\' 없음', () => {
    expect(apply).not.toContain('위 약관에 동의합니다');
    expect(apply).not.toContain('id="apply-terms"');
    expect(apply).toMatch(/<SubmitSheet[\s\S]*terms=\{\{ url: '\/terms\/artist_apply_real\.txt'/);
    expect(apply).toContain('termsVersion: ARTIST_APPLY_TERMS_VERSION');
  });

  it('떠 있는 메뉴는 하단 고정 줄 위 · 화면 안 — 아래가 막히면 위로, 화면 밖이면 반대쪽 끝 맞춤(2026-11-20 E2E·앱에서 잡았다)', () => {
    const menu = read('components/flow/MenuButton.tsx');
    // 하단 고정 줄(z-30)과 같은 z 면 DOM 뒤의 줄이 메뉴 아래쪽을 덮어 [작품 원본] 이 안 눌렸다
    expect(menu).toContain('z-[35]');
    expect(menu).not.toMatch(/'absolute top-full z-30/);
    // 그려 보고 맨 아래 항목 자리를 잰다 → 막히면 위로
    expect(menu).toMatch(/elementFromPoint/);
    expect(menu).toContain('data-[up]:bottom-full');
    // 휴대폰에서 왼쪽에 놓인 [내려받기]의 메뉴가 오른쪽 끝 맞춤이라 화면 왼쪽 밖으로 잘렸다
    expect(menu).toContain('data-[flip-x]:left-0');
    expect(menu).toContain('data-[flip-x]:right-0');
    // 뒤집어도 넘치면 넘친 만큼 화면 안으로
    expect(menu).toContain('translateX(');
  });

  it('신뢰성 점검(2026-11-20)에서 고친 것 — 되돌리면 E2E 87·89 가 다시 잡는다', () => {
    const ctl = read('components/operation/settlementController.tsx');
    const art = read('components/workspace/ArtistExhibitionWorkspace.tsx');
    const confirm = read('components/shared/ConfirmDialog.tsx');
    // S12 확인창 연타 — 닫히는 동안 남는 옛 버튼도 같은 값을 보게 ref 로
    expect(confirm).toMatch(/if \(fired\.current\) return;/);
    // S12 작가 [정산 확인] 연타
    expect(op).toMatch(/if \(responding\.current\) return;/);
    // S6 결정이 실패하면 지원자 목록을 다시 받는다
    expect(am).toMatch(/onError: \(e: any\) => \{ toast\.error\(e\.response\?\.data\?\.error \|\| '상태 변경 실패'\); invalidate\(\); \}/);
    // S7 사람이 고친 정산 입력은 다시 받은 서버 값으로 덮지 않는다
    expect(ctl).toMatch(/if \(edited\.current && dirtyRef\.current\) return;/);
    // S5 같은 주소로 다시 들어오면(그 공모·전시의 알림) 새로 받는다
    expect(ws).toMatch(/if \(seenKey !== location\.key\)/);
    expect(art).toMatch(/if \(seenKey !== location\.key\)/);
    // REL-13 숫자가 오기 전엔 할 일을 말하지 않는다 · REL-04 받지 못하면 이유를 말한다
    expect(ws).toMatch(/const barText(: ReactNode)? = countsFailed \?/);
    expect(read('components/operation/SettlementSection.tsx')).toContain('정산 내역을 불러오지 못했어요');
    // WS-02 열 수 없는 탭은 고르지 않는다
    expect(ws).toMatch(/view && \(!access \|\| openable\(view\)\) \? view : defaultView/);
    expect(art).toMatch(/view && openable\(view\) \? view : artistDefaultView/);
  });

  it('자판이 뜨면 탭바 위 고정 줄은 바닥으로 — 탭바 높이만큼 떠 있지 않다(S8 · e2e 89 DEV-03 · 11-21 흐름 밖 셋)', () => {
    expect(read('index.css')).toMatch(/@custom-variant tabbar-hidden \(html\[data-tabbar-hidden\] &\);/);
    expect(read('components/layout/BottomTabBar.tsx')).toMatch(/toggleAttribute\('data-tabbar-hidden', typing\)/);
    const CALC = 'bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]';
    // 소스 전체에서 탭바 위에 붙는 고정 줄을 찾는다 — 새로 만든 줄이 빠지면 여기서 걸린다
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); }
        else if (p.endsWith('.tsx')) files.push(p);
      }
    };
    walk(SRC);
    const bars: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1);
      for (const line of readFileSync(f, 'utf-8').split('\n').filter((l) => l.includes(CALC))) {
        // 공고 상세 [지원하기] 줄은 그 화면에 글 칸이 없어 자판이 뜰 일이 없다(사용자 결정 — 세 곳만 고친다)
        if (line.includes('data-apply-bar')) continue;
        bars.push(rel);
        expect(line, rel).toContain('tabbar-hidden:bottom-0');
      }
    }
    // 공모 화면 · 출품 자료 · 정산(작가) · 지원서 · 지원자 일괄 · 등록 화면 셋(StickySubmitBar) · 홈페이지 편집 · 포트폴리오 만들기
    for (const want of ['components/form/StickySubmitBar.tsx', 'components/homepage-edit/HomepageEditor.tsx', 'components/portfolio-maker/MakerBar.tsx', 'components/workspace/ExhibitionWorkspace.tsx', 'pages/ApplyPage.tsx']) {
      expect(bars).toContain(want);
    }
    expect(bars.length).toBeGreaterThanOrEqual(8);
  });

  it('목록 줄의 할 일 버튼·미선정 [확인]은 연타해도 한 번(ART-03)', () => {
    const row = read('components/flow/ExhibitionRow.tsx');
    expect(row).not.toContain('onClick={onAction}');
    expect(row.match(/onClick=\{act\}/g)?.length).toBe(2);
    expect(read('pages/MyPage.tsx')).toMatch(/if \(acking\.current\.has\(appId\)\) return;/);
    expect(read('components/workspace/ArtistExhibitionWorkspace.tsx')).toMatch(/onClick=\{\(\) => ack\(app\.id\)\}/);
  });

  it('벨 알림·앱 알림 배너는 옮기기 전에 저장 안 한 입력을 묻는다(REL-20 — 가드는 navigate() 를 못 본다)', () => {
    expect(read('components/layout/Navbar.tsx')).toMatch(/if \(notif\.linkUrl && !confirmLeaveUnsaved\(\)\) return;\s+if \(!notif\.read\)/);
    expect(read('components/shared/PushBanner.tsx')).toMatch(/if \(!confirmLeaveUnsaved\(\)\) return; dismissPushBanner/);
    expect(read('hooks/useUnsavedChanges.ts')).toMatch(/export function confirmLeaveUnsaved\(\): boolean/);
  });

  it('공모 화면은 공모 번호로 새로 시작한다(key) — 다른 공모로 가면 쓰던 입력·창·선택이 남지 않는다(WS-09)', () => {
    expect(read('pages/MyPage.tsx')).toMatch(/<ArtistExhibitionWorkspace key=\{exId\}/);
    expect(read('pages/MyPage.tsx')).toMatch(/<ExhibitionWorkspace\s+key=\{workspaceId\}/);
    expect(read('pages/OperationPage.tsx')).toMatch(/<ExhibitionWorkspace key=\{id\} exhibitionId=\{Number\(id\)\} standalone \/>/);
  });

  it('목록 줄은 그 자리에서 실행하지 않는다 — 공모 화면으로 데려가고(act) 도착해서 묻는다', () => {
    const my = read('pages/MyPage.tsx');
    expect(my).toMatch(/onAction=\{\(\) => openExhibition\(item\.id, \{ view, act: task\.act \}\)\}/);
    expect(ws).toMatch(/actDone\.current = true;[\s\S]{0,700}runAct\(initialAct\)/);
    // 한 번 쓴 '도착해서 열 것'은 기록에서 지운다 — 새로고침·뒤로·앞으로에 확인창이 다시 뜨지 않게(2026-11-20 S4)
    expect(ws).toMatch(/window\.history\.replaceState\(\{ \.\.\.st, usr: \{ \.\.\.st\.usr, act: undefined \} \}/);
    // 확인창이 적을 숫자(지원자·출품 자료)가 다 온 뒤에 연다(S1)
    expect(ws).toMatch(/const actReady = [^;]*countsReady/);
  });
});
