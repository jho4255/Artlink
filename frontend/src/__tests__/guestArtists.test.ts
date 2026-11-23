/**
 * 비회원 작가 (2026-11-23, CLAUDE.md 규칙 91) — 공모 운영자가 가입하지 않은 작가를 넣고 출품 자료·판매·정산을 직접 채운다.
 * 할 일 줄의 말(회원만 안내 · 비회원은 갤러리가 채운다 · 비회원만이면 확인 요청 없이 정산 완료)과 화면 소스 가드.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { galleryNextTask, type GallerySnapshot } from '@/lib/flowLabels';
import { GUEST_NAME_MAX, guestNameProblem, splitGuests } from '@/lib/guestArtists';

const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(SRC, f), 'utf-8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// '오늘' 이 2026-06-01 인 KST D-day
const dday = (d: string | Date) => {
  const iso = d instanceof Date ? d.toISOString() : String(d);
  const day = (s: string) => Math.floor(Date.parse(s.slice(0, 10) + 'T00:00:00Z') / 86400000);
  return day(iso) - day('2026-06-01');
};
const future = '2026-07-01';
const snap = (o: Partial<GallerySnapshot> = {}): GallerySnapshot => ({
  status: 'APPROVED', recruitOnly: false, recruitmentClosed: true, confirmed: false, ended: false, settled: false,
  settlementRequested: false, deadline: '2026-05-20', exhibitStartDate: future, exhibitDate: future,
  pending: 0, accepted: 0, submissionsIncomplete: 0, sales: 0, approvals: { total: 0, approved: 0, issue: 0 }, ...o,
});
const task = (o: Partial<GallerySnapshot>) => galleryNextTask(snap(o), dday);

describe('이름 규칙 — 서버와 같다', () => {
  it('글자 수 상한이 서버 GUEST_NAME_MAX 와 같다', () => {
    const server = readFileSync(resolve(SRC, '../../backend/src/lib/guestArtists.ts'), 'utf-8');
    expect(server).toContain(`export const GUEST_NAME_MAX = ${GUEST_NAME_MAX};`);
  });
  it('비었거나 너무 길면 이유 · 앞뒤 공백은 뗀다', () => {
    expect(guestNameProblem('   ')).toBe('작가 이름을 적어 주세요.');
    expect(guestNameProblem('가'.repeat(GUEST_NAME_MAX + 1))).toContain(`${GUEST_NAME_MAX}자`);
    expect(guestNameProblem(`  ${'가'.repeat(GUEST_NAME_MAX)}  `)).toBeNull();
  });
  it('splitGuests — 회원 / 비회원', () => {
    const { members, guests } = splitGuests([{ id: 1 }, { id: 2, guest: true }, { id: 3, guest: false }]);
    expect(members.map(r => r.id)).toEqual([1, 3]);
    expect(guests.map(r => r.id)).toEqual([2]);
  });
});

describe('할 일 줄 — 비회원 작가', () => {
  it('★ 비회원만 있어도 "선정한 작가가 없어요"라 하지 않는다', () => {
    expect(task({ accepted: 0, guests: 0 }).text).toBe('선정한 작가가 없어요.');
    expect(task({ accepted: 0, guests: 2 }).text).not.toBe('선정한 작가가 없어요.');
  });

  it('★ 안내 보내기는 회원의 빈 자료만 센다 — 비회원의 빈 자료는 갤러리가 채울 일', () => {
    const t = task({ accepted: 2, submissionsIncomplete: 1, guests: 3, guestIncomplete: 3 });
    expect(t.primary).toEqual({ id: 'remind-submissions', label: '1명에게 안내 보내기' });
    const g = task({ accepted: 2, submissionsIncomplete: 0, guests: 3, guestIncomplete: 2 });
    expect(g.text).toBe('비회원 작가 2명의 출품 자료가 비어 있어요');
    expect(g).toMatchObject({ tone: 'attention', target: 'submissions', action: '자료 입력' });
    expect(g.primary).toBeUndefined();
    expect(g.secondary).toEqual({ id: 'confirm', label: '전시 확정' });
    // 다 채웠으면 전시 확정
    expect(task({ accepted: 1, guests: 1, guestIncomplete: 0 }).primary?.id).toBe('confirm');
  });

  it('잠긴 뒤(확정)엔 회원·비회원의 빈 자료를 함께 센다', () => {
    expect(task({ confirmed: true, accepted: 1, submissionsIncomplete: 1, guests: 2, guestIncomplete: 1 }).text)
      .toBe('출품 자료가 비어 있는 작가가 2명 있어요');
  });

  it('★ 비회원만 있는 공모의 정산 — 확인 요청 없이 [정산 완료]', () => {
    const t = task({ confirmed: true, ended: true, accepted: 0, guests: 2, sales: 1 });
    expect(t.text).toBe('판매 내역을 확인하고 정산을 마무리하세요.');
    expect(t.primary).toEqual({ id: 'complete-settlement', label: '정산 완료' });
    // 회원이 있으면 예전처럼 확인 요청
    expect(task({ confirmed: true, ended: true, accepted: 1, guests: 2 }).primary?.id).toBe('request-settlement');
  });
});

describe('화면 소스 가드', () => {
  it('[출품 자료] — 비회원 작가 추가·이름 바꾸기·빼기 · 비회원은 "갤러리가 입력"', () => {
    const src = code('pages/OperationPage.tsx');
    expect(src).toContain('비회원 작가 추가');
    expect(src).toContain('/guest-artists');
    expect(src).toContain('이름 바꾸기');
    expect(src).toContain('이 작가 빼기');
    expect(src).toContain('갤러리가 입력');
    expect(src).toMatch(/proxyFor=\{\{ id: user\.id, name, guest \}\}/);
  });

  it('★ 출품 자료 안내 창은 비회원을 받는 사람에서 뺀다', () => {
    expect(code('pages/OperationPage.tsx')).toMatch(/rows\.filter\(\(\{ guest, submission \}\) => !guest && submissionMissingParts/);
  });

  it('★ 비회원 대신 입력 — 작가 알림 문구·홈페이지에서 불러오기가 없다', () => {
    const src = code('pages/OperationPage.tsx');
    expect(src).toContain('proxyFor?.guest ? `${proxyFor.name} 출품 자료를 저장했어요.`');
    expect(src).toContain('{proxyFor?.guest ? null : !hasContent(cv) ?');
  });

  it('★ 정산 — 확인 수는 회원만 · 비회원 머리는 "확인 요청 없음" · 완료 확인창이 한 줄로 말한다', () => {
    const ctl = code('components/operation/settlementController.tsx');
    expect(ctl).toContain('const memberRows = (data?.artists ?? []).filter(x => !x.guest);');
    expect(ctl).toContain('const unanswered = memberRows.filter(');
    expect(ctl).toContain('은 확인 요청 없이 끝나요.');
    expect(ctl).toContain('guestOnly');
    const sec = code('components/operation/SettlementSection.tsx');
    expect(sec).toContain('확인 요청 없음');
    expect(sec).toContain('const canReask = !guest &&');
  });

  it('공모 화면·목록 — 회원/비회원 수를 따로 넘긴다', () => {
    const ws = code('components/workspace/ExhibitionWorkspace.tsx');
    expect(ws).toContain('guests: guestSubs.length');
    expect(ws).toContain('guestIncomplete,');
    expect(ws).toContain("const settleArtists = (ctl.data?.artists ?? []).filter(a => !a.guest);");
    const my = code('pages/MyPage.tsx');
    expect(my).toContain('submissions.required - submissions.complete - guestIncomplete');
  });

  it('요약 탭 — 비회원 작가엔 홈페이지 링크가 없다', () => {
    expect(code('components/workspace/WorkspaceSummary.tsx')).toMatch(/a\.guest\s*\?\s*<span className="justify-self-end"><GuestChip \/><\/span>/);
  });
});
