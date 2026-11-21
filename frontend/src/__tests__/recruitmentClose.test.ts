/**
 * 모집 마감은 되돌릴 수 없다 · 수락·거절은 마감 뒤에만 · 남은 검토 대기는 선정을 마칠 때 미선정(알림 없음) · 작가의 지원서 고치기·취소
 * (2026-11-21 사용자 결정, CLAUDE.md 규칙 90). 판단은 순수 함수로, 되돌리기 쉬운 한 줄은 소스로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canChangeApplication, isPendingStatus, DECIDE_AFTER_CLOSE, SELECTION_REMIND_DAYS } from '@/lib/applicationWindow';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const readBackend = (rel: string) => readFileSync(join(SRC, '../../backend/src', rel), 'utf8');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('지원서를 고치거나 취소할 수 있나 — 서버와 같은 규칙', () => {
  const open = { status: 'APPROVED', recruitmentClosed: false, ended: false, deadline: day(3) };
  it('검토 대기 · 모집이 열려 있을 때만', () => {
    expect(canChangeApplication({ status: 'SUBMITTED' }, open)).toBe(true);
    expect(canChangeApplication({ status: 'REVIEWED' }, open)).toBe(true);
    for (const status of ['ACCEPTED', 'REJECTED']) expect(canChangeApplication({ status }, open)).toBe(false);
    expect(canChangeApplication({ status: 'SUBMITTED' }, { ...open, recruitmentClosed: true })).toBe(false);
    expect(canChangeApplication({ status: 'SUBMITTED' }, { ...open, ended: true })).toBe(false);
    expect(canChangeApplication({ status: 'SUBMITTED' }, { ...open, status: 'PENDING' })).toBe(false);
    expect(canChangeApplication({ status: 'SUBMITTED' }, { ...open, deadline: day(-2) })).toBe(false);
    // 접수 마감일 당일은 아직 열려 있다(KST 달력 날짜 — 규칙 14)
    expect(canChangeApplication({ status: 'SUBMITTED' }, { ...open, deadline: new Date().toISOString() })).toBe(true);
    expect(canChangeApplication(null, open)).toBe(false);
  });

  it('서버(lib/applicationWindow.ts)와 같은 조건을 본다 — 한쪽만 고치면 버튼이 보이는데 400 이 난다', () => {
    const be = readBackend('lib/applicationWindow.ts');
    expect(be).toContain("export const PENDING_STATUSES = ['SUBMITTED', 'REVIEWED'] as const;");
    expect(be).toMatch(/ex\.status !== 'APPROVED' \|\| ex\.recruitmentClosed \|\| ex\.ended \|\| isDeadlinePassedKst/);
    expect(isPendingStatus('SUBMITTED') && isPendingStatus('REVIEWED') && !isPendingStatus('ACCEPTED')).toBe(true);
  });
});

describe('모집 마감 확인창 — 되돌릴 수 없다를 강조 · 알림 이야기는 하지 않는다', () => {
  const lc = read('hooks/useLifecycle.tsx');
  it('★ 맨 위 빨간 한 줄(ConfirmDialog warning) — "모집 마감은 되돌릴 수 없어요."', () => {
    expect(lc).toContain("export const CLOSE_WARNING = '모집 마감은 되돌릴 수 없어요.';");
    expect(lc).toMatch(/kind, body: \{ recruitmentClosed: true \}, title: '모집을 마감할까요\?', confirmText: '모집 마감',\s+warning: CLOSE_WARNING,/);
    expect(lc).toContain('warning={pending?.warning}');
    const cd = read('components/shared/ConfirmDialog.tsx');
    expect(cd).toContain('data-confirm-warning');
  });
  it('★ 마감은 아무도 미선정으로 바꾸지 않는다 — 이제 선정한다는 말 · 체크박스(D2)·rejectPending·작가 알림 이야기는 없다', () => {
    expect(lc).toContain("'작가는 낸 지원서를 더 고치거나 취소할 수 없어요.'");
    expect(lc).toContain('`이제 지원자 ${n}명 가운데 수락할 작가를 고를 수 있어요.`');
    // 선정 마감일이 있는 새 공고는 그날이 지나면 미선정이 된다는 것까지(규칙 90)
    expect(lc).toContain('`선정 마감일(${md(selectionDeadline)})이 지나면 수락하지 않은 지원자는 미선정이 돼요.`');
    // 미선정이 된다는 말은 선정을 마치는 전환(전시 확정·전시 종료)에만 — [선정 마치기]는 자기 문장이 있다
    expect(lc).toContain("const leftover = (n: number) => (n > 0 ? [`검토 대기 ${n}명은 미선정이 돼요.`] : []);");
    expect(lc.match(/\.\.\.leftover\(n\)/g)?.length).toBe(2);
    expect(lc).not.toContain('rejectPending');
    expect(lc).not.toContain('미선정으로 처리');
    expect(lc).not.toMatch(/type="checkbox"/);
    expect(lc).not.toMatch(/작가에게 알림은/);
  });
  it('★ [⋯] 의 되돌리기는 전시 확정·전시 종료만 — 모집 마감(1단계)은 되돌리지 않는다', () => {
    expect(lc).toContain('const canBack = !!access && stage > 1 && stage <= maxAdvance && !locked;');
    expect(lc).not.toContain('{ recruitmentClosed: false }');
    const be = readBackend('routes/operation.ts');
    expect(be).toContain("if (!recruitmentClosed && curRecruitmentClosed) throw new AppError('모집 마감은 되돌릴 수 없어요.', 400);");
  });
  it('★ [선정 마치기] — 선정 마감일이 없는 옛 공고만, [⋯] 메뉴에만 · 되돌릴 수 없다를 빨간 줄로(2026-11-21 사용자 결정)', () => {
    expect(lc).toContain('api.post(`/operations/${exhibitionId}/finish-selection`)');
    expect(lc).toMatch(/title: '선정을 마칠까요\?', confirmText: '선정 마치기',\s+warning: '선정을 마치면 되돌릴 수 없어요.',/);
    expect(lc).toContain('if (!over || selectionDeadline) return;');
    expect(lc).not.toContain('다시 수락할 수 있어요');
    const ws = read('components/workspace/ExhibitionWorkspace.tsx');
    expect(ws).toContain("...(approved && !selectionDeadline && over && pending > 0 && !access.ended && !settled ? [{ id: 'finish', label: '선정 마치기'");
    // 할 일 줄은 [선정 마치기]를 내지 않는다(flowLabels 가 finish-selection 을 돌려주지 않는다)
    expect(read('lib/flowLabels.ts')).not.toMatch(/id: 'finish-selection'/);
  });
});

describe('수락은 접수가 끝난 뒤 ~ 선정 마감일 — 서버와 같은 말 · 같은 규칙', () => {
  it('화면 문구·간격은 서버와 같다', () => {
    expect(DECIDE_AFTER_CLOSE).toBe('접수가 끝난 뒤에 수락할 수 있어요.');
    const win = readBackend('lib/applicationWindow.ts');
    expect(win).toContain(`export const DECIDE_AFTER_CLOSE = '${DECIDE_AFTER_CLOSE}';`);
    // 접수가 끝났다 = 모집 마감 또는 접수 마감일 경과 — 화면(selectionStarted)도 같은 둘을 본다
    expect(win).toContain('return ex.recruitmentClosed || isDeadlinePassedKst(new Date(ex.deadline), now);');
    expect(read('lib/applicationWindow.ts')).toContain('return !!ex.recruitmentClosed || (!!ex.deadline && getDday(ex.deadline) < 0);');
    const route = readBackend('routes/exhibition.ts');
    expect(route).toContain('if (!acceptedRevert && !selectionStarted(exhibition)) throw new AppError(DECIDE_AFTER_CLOSE, 400);');
    expect(route).toContain('if (!acceptedRevert && selectionDeadlinePassed(exhibition)) throw new AppError(SELECTION_OVER, 400);');
    expect(route).toContain("if (status === 'REJECTED' && !acceptedRevert) throw new AppError(NO_REJECT, 400);");
    // 며칠 전부터 알리나(서버) = 며칠 전부터 빨갛게(화면)
    expect(readBackend('lib/selectionDeadline.ts')).toContain(`export const SELECTION_REMIND_DAYS = ${SELECTION_REMIND_DAYS};`);
  });
  it('★ 접수 중·선정 마감일 뒤엔 지원자 화면이 읽기만 — 결정 줄에 이유 한 줄, 체크박스·일괄 줄 없음(관리자도)', () => {
    const am = read('components/shared/ApplicantManager.tsx');
    expect(am).toContain('const beforeClose = !selectionStarted(windowEx);');
    expect(am).toContain('const selectionOver = selectionDeadlinePassed(windowEx);');
    expect(am).toContain('const decisionsLocked = endedLocked || beforeClose || selectionOver;');
    const ws = read('components/workspace/ExhibitionWorkspace.tsx');
    expect(ws).toContain('recruitmentClosed={!!access.recruitmentClosed}');
    expect(ws).toContain('selectionDeadline={selectionDeadline}');
  });
});

describe('거절은 없고, 선정이 끝나면 되돌릴 수 없다(2026-11-21 사용자 결정)', () => {
  const am = read('components/shared/ApplicantManager.tsx');
  it('★ [거절]·[선택 거절]·[수락으로 바꾸기]가 없다 · 미선정 줄은 까닭만', () => {
    // 주석(지난 기록)은 빼고 코드만 본다
    const code = am.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/>거절<\/button>/);
    expect(code).not.toContain('선택 거절');
    expect(code).not.toContain('수락으로 바꾸기');
    expect(code).not.toContain('setRejectTarget');
    expect(am).toContain("const closedOut = (app: ApplicantRow) => app.status === 'REJECTED' && !!app.closedOutAt;");
    expect(am).toContain("const view = closedOut(app) ? { label: '미선정' } : applicationStatusView(app.status, 'gallery');");
    expect(am).toContain("? '미선정 — 선정 마감일이 지나 바꿀 수 없어요.'");
    expect(am).toContain(": '미선정 — 선정이 끝나 바꿀 수 없어요.'");
    // 거르기 탭에 '거절'이 없다 — 결과가 미선정인 지원은 '미선정'으로
    expect(am).toContain("{ id: 'REJECTED' as const, label: '미선정', n: counts.REJECTED }");
  });
  it('작가가 고친 지원서는 줄에 \'수정됨\', 지원서 머리에 고친 날', () => {
    expect(am.match(/app\.editedAt \? `\$\{shortDate\(app\.editedAt\)\} 수정` : null/g)?.length).toBe(1);
    expect(am).toContain("const subStatus = app.editedAt && isPending(app.status) ? '수정됨' : null;");
  });
});

describe('작가 — 지원서 고치기·취소의 길', () => {
  it('[내 전시]의 그 공모 화면 — 고칠 수 있을 때만 [지원서 수정]·[지원 취소], 취소는 확인창(빨간 버튼)을 거친다', () => {
    const aw = read('components/workspace/ArtistExhibitionWorkspace.tsx');
    expect(aw).toContain('const changeable = canChangeApplication(app, ex);');
    expect(aw).toContain('to={`/exhibitions/${exhibitionId}/apply/edit`} state={{ fromWorkspace: true }}');
    expect(aw).toContain('api.delete(`/exhibitions/${exhibitionId}/my-application`)');
    expect(aw).toContain('title="지원을 취소할까요?"');
    expect(aw).toMatch(/cancelText="그대로 두기"\s+confirmText="지원 취소"\s+variant="danger"/);
    // 지우면 이 화면이 비므로 먼저 공고 상세로 옮긴다(순서가 바뀌면 '찾지 못했어요'를 띄운 채 떠난다)
    expect(aw).toMatch(/onSuccess: \(\) => \{\s+navigate\(`\/exhibitions\/\$\{exhibitionId\}`, \{ replace: true \}\);/);
  });
  it('고치기는 지원서 화면의 edit 모드 — 낸 내용으로 채우고, 약관 확인 창 없이 PUT', () => {
    expect(read('App.tsx')).toContain('<Route path="/exhibitions/:id/apply/edit" element={<ProtectedRoute><ApplyPage key="edit" mode="edit" /></ProtectedRoute>} />');
    const ap = read('pages/ApplyPage.tsx');
    expect(ap).toContain('api.put(`/exhibitions/${id}/my-application`, payload)');
    expect(ap).toContain("if (user.role !== 'ARTIST' || !canChangeApplication(myApp, exhibition)) return <Navigate to={workspaceHref} replace />;");
    expect(ap).toContain('data-edit-bar');
    expect(ap).toContain("{editMutation.isPending ? '저장 중…' : '수정 저장'}");
  });
});
