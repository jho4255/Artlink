/**
 * 공모 흐름의 이름·다음 할 일 (`lib/flowLabels.ts`, 2026-09-29)
 *
 * 점검에서 가장 많이 걸린 건 말이었다 — 같은 단계를 갤러리 카드는 '정산 단계', 작가 카드는 '정산중',
 * 운영 화면은 '전시종료' 로 불렀고, 지원 결과는 '수락'·'선정'·'수락 (확정)' 이 섞였다.
 * 여기서 한 이름만 만든다. 예전 `myExhibitions.exhibitionStage` 가 지키던 순서 규칙도 그대로 옮겼다.
 */
import { describe, it, expect } from 'vitest';
import { stageOf, applicationStatusView, ddayText, galleryNextTask, artistNextTask, SUBMISSION_TERM, type GallerySnapshot } from '@/lib/flowLabels';

// '오늘' 이 2026-06-01 인 KST D-day
const dday = (d: string | Date) => {
  const iso = d instanceof Date ? d.toISOString() : String(d);
  const day = (s: string) => Math.floor(Date.parse(s.slice(0, 10) + 'T00:00:00Z') / 86400000);
  return day(iso) - day('2026-06-01');
};
const past = '2026-05-01', future = '2026-07-01';
const label = (ex: any) => stageOf(ex, dday)?.label;

describe('stageOf — 단계 이름은 하나', () => {
  it('모집 중 → 전시 준비 → 전시 확정 순서', () => {
    expect(label({ exhibitStartDate: future })).toBe('모집 중');
    expect(label({ exhibitStartDate: future, recruitmentClosed: true })).toBe('전시 준비');
    expect(label({ exhibitStartDate: future, recruitmentClosed: true, confirmed: true })).toBe('전시 확정');
  });

  it('전시 시작일이 되면 확정이 아니라 [전시 중] — 오늘이 시작일이어도(KST 달력 날짜, 규칙 14)', () => {
    expect(label({ exhibitStartDate: past, confirmed: true })).toBe('전시 중');
    expect(label({ exhibitStartDate: '2026-06-01T00:00:00.000Z', confirmed: true })).toBe('전시 중');
  });

  it('전시 종료와 정산 중을 구분한다 — 정산에 손을 댔거나 확인을 요청했으면 정산 중', () => {
    expect(label({ exhibitStartDate: past, ended: true })).toBe('전시 종료');
    expect(label({ exhibitStartDate: past, ended: true, settlementStarted: true })).toBe('정산 중');
    expect(label({ exhibitStartDate: past, ended: true, settlementRequestedAt: '2026-05-20' })).toBe('정산 중');
  });

  it('정산이 끝나면 정산 완료 — 자동 정리보다 먼저', () => {
    expect(label({ ended: true, settledAt: '2026-05-20' })).toBe('정산 완료');
    expect(label({ ended: false, closed: true, settledAt: '2026-05-20' })).toBe('정산 완료');
  });

  /** 갤러리가 [전시종료]를 누른 적이 없어 ended=false 인 채로 20일이 지난 경우 — 예전엔 '확정' 으로 떠 있었다 */
  it('자동 정리된 방치 공모는 [종료] — 전시 확정으로 뜨면 안 된다', () => {
    expect(label({ exhibitStartDate: past, confirmed: true, ended: false, closed: true })).toBe('종료');
  });

  it('갤러리가 직접 종료를 누른 공모는 자동 표기를 쓰지 않는다', () => {
    expect(label({ exhibitStartDate: past, ended: true, closed: true })).toBe('전시 종료');
  });

  it('승인 전·반려는 공모 상태가 먼저', () => {
    expect(stageOf({ status: 'PENDING' }, dday)).toMatchObject({ label: '승인 대기', variant: 'neutral' });
    expect(stageOf({ status: 'REJECTED' }, dday)).toMatchObject({ label: '반려', variant: 'attention' });
  });

  it('공모 정보가 없으면 null (배지를 그리지 않는다)', () => {
    expect(stageOf(null, dday)).toBeNull();
  });

  /**
   * 공모만 진행하는 공고 — 단계가 **모집 중 → 선정 완료** 둘뿐이다.
   * ⚠️ 여기가 어긋나면 작가에게 없는 일이 있는 것처럼 보인다(서버는 뒷 단계를 400 으로 막는다).
   */
  describe('★ 공모만 진행하는 공고', () => {
    it('모집 중 → 선정 완료', () => {
      expect(label({ recruitOnly: true, exhibitStartDate: future })).toBe('모집 중');
      expect(label({ recruitOnly: true, exhibitStartDate: future, recruitmentClosed: true })).toBe('선정 완료');
    });
    it('전시 시작일이 지나도 [전시 중] 이 되지 않는다', () => {
      expect(label({ recruitOnly: true, exhibitStartDate: past, recruitmentClosed: true })).toBe('선정 완료');
    });
    it('confirmed 가 켜져 있어도 [전시 확정] 이 되지 않는다 (서버가 시작일 경과로 자동 true 를 준다)', () => {
      expect(label({ recruitOnly: true, exhibitStartDate: past, confirmed: true })).toBe('모집 중');
    });
    it('자동 정리되면 [종료]', () => {
      expect(label({ recruitOnly: true, exhibitStartDate: past, recruitmentClosed: true, closed: true })).toBe('종료');
    });
  });

  it('색은 셋뿐 — 끝난 단계만 done, 반려만 attention', () => {
    const variants = new Set([
      { exhibitStartDate: future }, { recruitmentClosed: true, exhibitStartDate: future }, { confirmed: true, exhibitStartDate: future },
      { exhibitStartDate: past }, { ended: true }, { ended: true, settlementStarted: true }, { settledAt: 'x' },
    ].map(ex => stageOf(ex, dday)!.variant));
    expect([...variants].sort()).toEqual(['done', 'neutral']);
  });
});

describe('applicationStatusView — 보는 사람에 따라 동사가 다르다', () => {
  it('갤러리: 검토 대기 · 수락됨 · 거절 / 작가: 심사 중 · 선정 · 미선정', () => {
    expect(['SUBMITTED', 'ACCEPTED', 'REJECTED'].map(s => applicationStatusView(s, 'gallery').label)).toEqual(['검토 대기', '수락됨', '거절']);
    expect(['SUBMITTED', 'ACCEPTED', 'REJECTED'].map(s => applicationStatusView(s, 'artist').label)).toEqual(['심사 중', '선정', '미선정']);
  });
  it('폐지된 REVIEWED 는 접수와 같다', () => {
    expect(applicationStatusView('REVIEWED', 'gallery').label).toBe('검토 대기');
  });
  it("★ '확정' 이라는 말을 쓰지 않는다 — 전시 단계 이름이다", () => {
    for (const s of ['SUBMITTED', 'ACCEPTED', 'REJECTED']) {
      for (const v of ['gallery', 'artist'] as const) expect(applicationStatusView(s, v).label).not.toContain('확정');
    }
  });
});

describe('ddayText — 무엇까지 남았는지 함께', () => {
  it('마감 D-3 / D-DAY / 지난 날은 null', () => {
    expect(ddayText('마감', '2026-06-04', dday)).toBe('마감 D-3');
    expect(ddayText('전시', '2026-06-01', dday)).toBe('전시 D-DAY');
    expect(ddayText('마감', '2026-05-31', dday)).toBeNull();
    expect(ddayText('마감', null, dday)).toBeNull();
  });
});

const snap = (o: Partial<GallerySnapshot> = {}): GallerySnapshot => ({
  status: 'APPROVED', recruitOnly: false, recruitmentClosed: false, confirmed: false, ended: false, settled: false,
  settlementRequested: false, deadline: future, exhibitStartDate: future, exhibitDate: future,
  pending: 0, accepted: 0, submissionsIncomplete: 0, sales: 0, approvals: { total: 0, approved: 0, issue: 0 }, ...o,
});
const task = (o: Partial<GallerySnapshot>) => galleryNextTask(snap(o), dday);

describe('galleryNextTask — 갤러리가 지금 할 일 하나', () => {
  it('모집 중: 검토 대기 지원자가 있으면 그게 할 일(빨강)', () => {
    expect(task({ pending: 5 })).toMatchObject({ tone: 'attention', target: 'applicants' });
    expect(task({ pending: 5 }).text).toContain('5명');
    expect(task({})).toMatchObject({ tone: 'neutral', target: 'applicants' });
  });

  it('모집 기간이 지났는데 마감을 안 눌렀으면 → 모집 마감', () => {
    expect(task({ deadline: past })).toMatchObject({ tone: 'attention', target: 'stage', action: '모집 마감' });
  });

  it('전시 준비: 수락 0명 → 지원자 / 자료 미제출 → 출품 자료 / 다 모이면 → 전시 확정', () => {
    expect(task({ recruitmentClosed: true, accepted: 0 })).toMatchObject({ target: 'applicants', tone: 'attention' });
    const t = task({ recruitmentClosed: true, accepted: 3, submissionsIncomplete: 2 });
    expect(t).toMatchObject({ target: 'submissions', tone: 'attention' });
    expect(t.text).toContain(SUBMISSION_TERM);
    expect(task({ recruitmentClosed: true, accepted: 3 })).toMatchObject({ target: 'stage', action: '전시 확정' });
  });

  it('전시 기간이 지났는데 종료를 안 눌렀으면 → 전시 종료', () => {
    expect(task({ recruitmentClosed: true, confirmed: true, accepted: 2, exhibitStartDate: past, exhibitDate: '2026-05-20' }))
      .toMatchObject({ target: 'stage', action: '전시 종료', tone: 'attention' });
  });

  it('전시 종료 → 정산: 요청 전 · 이의 · 전원 확인 · 대기', () => {
    const ended = { recruitmentClosed: true, confirmed: true, ended: true, accepted: 3 };
    expect(task(ended)).toMatchObject({ target: 'settlement', tone: 'attention' });
    expect(task({ ...ended, settlementRequested: true, approvals: { total: 3, approved: 1, issue: 1 } }).text).toContain('이의');
    expect(task({ ...ended, settlementRequested: true, approvals: { total: 3, approved: 3, issue: 0 } })).toMatchObject({ action: '정산 마무리하기', tone: 'attention' });
    expect(task({ ...ended, settlementRequested: true, approvals: { total: 3, approved: 1, issue: 0 } })).toMatchObject({ tone: 'neutral' });
  });

  it('정산 완료 = done · 승인 대기 = 누를 곳 없음', () => {
    expect(task({ settled: true })).toMatchObject({ tone: 'done' });
    expect(task({ status: 'PENDING' })).toMatchObject({ tone: 'neutral', target: null });
  });

  // 2026-10-03 점검 P2 — 수락 2/2 인데 '지원을 받고 있어요' 였다. 작가 화면·지원은 그대로(사용자 결정: 갤러리에게만 알린다)
  it('★ 정원이 찼는데 모집 중이면 → 모집 마감 (검토 대기가 남아 있어도 — 더는 수락할 수 없다)', () => {
    expect(task({ capacity: 2, accepted: 2 })).toMatchObject({ tone: 'attention', target: 'stage', action: '모집 마감' });
    const t = task({ capacity: 2, accepted: 2, pending: 3 });
    expect(t.text).toContain('정원(2명)');
    expect(t.text).toContain('검토 대기 3명');
    expect(task({ recruitOnly: true, capacity: 1, accepted: 1, pending: 1 })).toMatchObject({ target: 'stage', action: '모집 마감' });
    // 정원을 모르면(null) 건너뛴다 · 자리가 남았으면 그대로 검토가 할 일
    expect(task({ accepted: 2, pending: 1 })).toMatchObject({ target: 'applicants' });
    expect(task({ capacity: 5, accepted: 2, pending: 1 })).toMatchObject({ target: 'applicants' });
    // 모집을 마감한 뒤엔 정원 문구가 아니다
    expect(task({ capacity: 2, accepted: 2, recruitmentClosed: true }).text).not.toContain('정원');
  });

  it('★ 공모만 진행: 선정 뒤로는 할 일이 없다(출품 자료·정산으로 보내지 않는다)', () => {
    expect(task({ recruitOnly: true, recruitmentClosed: true, accepted: 3, submissionsIncomplete: 3 })).toMatchObject({ tone: 'done' });
    expect(task({ recruitOnly: true, pending: 2 })).toMatchObject({ target: 'applicants' });
  });
});

describe('artistNextTask — 작가는 할 일이 있을 때만', () => {
  const base = { status: 'ACCEPTED', recruitOnly: false, confirmed: false, ended: false, settled: false, settlementRequested: false, submissionComplete: false, submissionDeadline: '2026-06-10', exhibitStartDate: future };
  it('수락 · 자료 미제출 → 제출해 주세요 + 마감', () => {
    const t = artistNextTask(base, dday)!;
    expect(t).toMatchObject({ tone: 'attention', target: 'submissions' });
    expect(t.text).toContain('마감 D-9');
  });
  it('다 냈으면 할 일 없음 / 공모만 진행도 없음', () => {
    expect(artistNextTask({ ...base, submissionComplete: true }, dday)).toBeNull();
    expect(artistNextTask({ ...base, recruitOnly: true }, dday)).toBeNull();
  });
  it('정산 확인 요청이 오면 그게 할 일', () => {
    expect(artistNextTask({ ...base, ended: true, submissionComplete: true, settlementRequested: true }, dday)).toMatchObject({ target: 'settlement', tone: 'attention' });
  });
  // 2026-10-03 점검 P2 — 확인·이의를 낸 뒤에도 '갤러리가 정산 확인을 요청했어요 [확인하기]' 가 남아 답이 안 들어간 줄 알았다
  it('★ 정산에 이미 답했으면 — 확인: 할 일 없음 / 이의: 기다림(회색) / 아직이면 빨강', () => {
    const req = { ...base, ended: true, submissionComplete: true, settlementRequested: true };
    expect(artistNextTask({ ...req, mySettlementStatus: 'APPROVED' }, dday)).toBeNull();
    expect(artistNextTask({ ...req, mySettlementStatus: 'ISSUE' }, dday)).toMatchObject({ tone: 'neutral', target: 'settlement' });
    expect(artistNextTask({ ...req, mySettlementStatus: 'PENDING' }, dday)).toMatchObject({ tone: 'attention' });
    expect(artistNextTask({ ...req, mySettlementStatus: null }, dday)).toMatchObject({ tone: 'attention' });
  });
  it('심사 중이면 안내만(누를 곳 없음), 미선정이면 없음', () => {
    expect(artistNextTask({ ...base, status: 'SUBMITTED' }, dday)).toMatchObject({ tone: 'neutral', target: null });
    expect(artistNextTask({ ...base, status: 'REJECTED' }, dday)).toBeNull();
  });
});
