/**
 * 관리자 화면 개편(2026-11-21, CLAUDE.md 규칙 89) — 화면 쪽 규칙.
 * 서버 쪽은 backend `admin-console.test.ts`. 여기서는 표 칸의 말(날짜·시간) · 운영 조회의 단계 묶음·한 줄 사정 ·
 * 화면이 서버와 같은 API·같은 규칙을 부르는지(소스)를 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agoText, daysWaited, hoursText, seenText, shortDate } from '@/lib/adminFormat';
import { GROUP_OF, hostLine, rowNote, rowStage, type OvRow } from '@/lib/adminOversight';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');
const NOW = new Date('2026-11-21T05:00:00Z');   // KST 14:00

describe('표 칸의 짧은 말(lib/adminFormat)', () => {
  it('시간 · 지난 시간 · 날짜 — KST', () => {
    expect(hoursText(null)).toBe('—');
    expect(hoursText(0.4)).toBe('24분');
    expect(hoursText(5.2)).toBe('5시간');
    expect(hoursText(72)).toBe('3일');
    expect(agoText('2026-11-21T04:30:00Z', NOW)).toBe('30분 전');
    expect(agoText('2026-11-20T05:00:00Z', NOW)).toBe('어제');
    expect(agoText('2026-11-18T05:00:00Z', NOW)).toBe('3일 전');
    expect(daysWaited('2026-11-19T04:00:00Z', NOW)).toBe(2);
    expect(shortDate('2026-11-20T16:00:00Z', NOW)).toBe('11.21');   // UTC 16시 = KST 다음 날 1시
    expect(shortDate('2025-03-02T00:00:00Z', NOW)).toBe('2025.3.2');
    expect(seenText(null, NOW)).toBe('기록 없음');
    expect(seenText('2026-11-21T00:07:00Z', NOW)).toBe('오늘 09:07');
    expect(seenText('2026-11-20T10:00:00Z', NOW)).toBe('어제');
  });
});

const base: OvRow = {
  id: 1, title: '공모', type: 'GROUP', region: 'SEOUL', status: 'APPROVED', imageUrl: null, hostType: 'GALLERY', galleryId: 3,
  recruitOnly: false, recruitmentClosed: false, confirmed: false, ended: false, settledAt: null, settlementRequestedAt: null,
  deadline: '2026-12-01T00:00:00.000Z', deadlineStart: null, exhibitStartDate: '2026-12-20T00:00:00.000Z', exhibitDate: '2027-01-05T00:00:00.000Z', submissionDeadline: null,
  capacity: 5, capacityMask: null, viewCount: 10, createdAt: '2026-11-01T00:00:00.000Z', reviewedAt: null, closed: false,
  gallery: { id: 3, name: '갤러리 온결' }, managerGalleries: [],
  counts: { apps: { total: 4, submitted: 2, accepted: 2, rejected: 0 }, submissions: { started: 1, complete: 1 }, sales: 0, approvals: { total: 0, approved: 0, issue: 0 }, favorites: 0, attachmentDownloads: 0 },
  stall: null,
};

describe('운영 조회 — 단계 묶음 · 한 줄 사정(lib/adminOversight)', () => {
  it('단계 이름은 갤러리 [내 공모]와 같은 stageOf · 묶음은 다섯 + 승인 대기', () => {
    expect(GROUP_OF[rowStage(base).key]).toBe('recruit');
    expect(rowNote(base)).toBe('검토 대기 2명');
    expect(GROUP_OF[rowStage({ ...base, recruitmentClosed: true }).key]).toBe('prepare');
    expect(rowNote({ ...base, recruitmentClosed: true })).toBe('출품 자료 1/2');
    expect(GROUP_OF[rowStage({ ...base, status: 'PENDING' }).key]).toBe('pending');
    expect(GROUP_OF[rowStage({ ...base, settledAt: '2026-11-01T00:00:00Z', ended: true }).key]).toBe('wrap');
  });

  it('★ 멈춘 사정이 있으면 그것이 한 줄이다(서버 stallOf 가 정한다)', () => {
    expect(rowNote({ ...base, stall: { kind: 'settlement', text: '전시 종료 12일째 · 정산 요청 전' } })).toBe('전시 종료 12일째 · 정산 요청 전');
  });

  it('주최 글 — 아트링크 주최는 운영 갤러리(없으면 직접 운영)', () => {
    expect(hostLine(base)).toBe('갤러리 온결');
    expect(hostLine({ hostType: 'ADMIN', gallery: null, managerGalleries: [], recruitOnly: true })).toBe('아트링크 주최 · 직접 운영 · 공모만 진행');
    expect(hostLine({ hostType: 'ADMIN', gallery: null, managerGalleries: [{ name: 'A' }, { name: 'B' }] })).toBe('아트링크 주최 · A 외 1곳');
  });
});

describe('화면이 부르는 것(소스 가드)', () => {
  it('★ 메뉴 배지 · 통계 처리할 일은 같은 API 하나(/admin/todo-counts)', () => {
    expect(src('hooks/useAdminTodo.ts')).toMatch(/api\.get\('\/admin\/todo-counts'\)/);
    expect(src('components/layout/MyPageSideMenu.tsx')).toMatch(/useAdminTodo\(\)/);
    expect(src('components/layout/Navbar.tsx')).toMatch(/useAdminTodo\(\)/);
    const tabs = src('components/admin/stats/StatsTabs.tsx');
    expect(tabs).toMatch(/api\.get\(`\/admin\/stats\/\$\{tab\}\?days=\$\{days\}`\)/);
    expect(tabs).toMatch(/useStats<any>\('summary', days\)/);
  });

  it('★ 관리자 화면엔 프로필 카드가 없다 · [주최 공모]의 공모 화면은 그 일만 하는 화면', () => {
    const my = src('pages/MyPage.tsx');
    expect(my).toMatch(/const adminWork = user\.role === 'ADMIN' && currentTab !== 'profile'/);
    expect(my).toMatch(/const hostedFocus = currentTab === 'hosted-exhibitions'/);
  });

  it('★ 깔때기(비회원 → 가입 · 가입한 작가 → 지원)는 넣지 않는다 — 사용자 결정(2026-11-21)', () => {
    const tabs = src('components/admin/stats/StatsTabs.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(tabs).not.toMatch(/가입하기까지|지원하기까지|Funnel/);
  });

  it('★ 혜택 관리는 없다 — 화면이 /benefits API 를 부르지 않는다', () => {
    expect(src('pages/MyPage.tsx')).not.toMatch(/BenefitManageSection|\/benefits/);
    expect(src('lib/myPageMenu.ts')).not.toMatch(/benefit-manage/);
  });

  it('주최 공모 — 줄을 누르면 공모 한 건 화면(갤러리 [내 공모]와 같은 부품) · 옛 &panel=applicants 는 지원자 탭', () => {
    const hosted = src('components/admin/HostedExhibitionsSection.tsx');
    expect(hosted).toMatch(/<ExhibitionWorkspace[\s\S]{0,200}backLabel="주최 공모"/);
    expect(hosted).toMatch(/searchParams\.get\('panel'\) === 'applicants' \? 'applicants'/);
    expect(hosted).not.toMatch(/<ApplicantManager/);   // 카드 안에 펼치던 지원자 관리는 공모 화면의 [지원자] 탭으로
  });

  it('승인 관리 — 결정하면 다음 요청으로 · 거절은 사유 필수 · 삭제 요청은 확인창', () => {
    const a = src('components/admin/ApprovalsSection.tsx');
    expect(a).toMatch(/select\(after \? after\.key : null\)/);
    expect(a).toMatch(/disabled=\{!reason\.trim\(\) \|\| decide\.isPending\}/);
    expect(a).toMatch(/if \(selected\.kind === 'delete-request'\) \{ setConfirmDelete\(true\); return; \}/);
    expect(a).toMatch(/\/approvals\/history/);
    // 포스터를 자르지 않는다(규칙 18 — 예전 object-cover h-32)
    expect(a).not.toMatch(/object-cover/);
  });
});
