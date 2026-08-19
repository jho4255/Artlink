/**
 * 작가 마이페이지 [내 전시] 분류 (lib/myExhibitions.ts)
 *
 * '전체' 탭을 없앴기 때문에 분류가 틀리면 **가진 게 있는데도 아무것도 없는 화면**이 된다.
 * 특히 기본 탭 선택은 빈 화면을 그대로 보여주게 되는 지점이라 테스트로 묶어 둔다.
 */
import { describe, it, expect } from 'vitest';
import { bucketOf, groupMyExhibitions, defaultBucket, nextSchedule, shortDate, exhibitionStage, MY_EXHIBITION_TABS } from '@/lib/myExhibitions';

const app = (status: string, settledAt: string | null = null) => ({
  status,
  exhibition: { settledAt },
});

describe('bucketOf', () => {
  it('아직 결과를 못 받은 지원은 심사중', () => {
    expect(bucketOf(app('SUBMITTED'))).toBe('REVIEWING');
    expect(bucketOf(app('REVIEWED'))).toBe('REVIEWING');
  });

  it('거절된 지원도 심사중에 남는다 ([확인] 을 놓치지 않게)', () => {
    expect(bucketOf(app('REJECTED'))).toBe('REVIEWING');
  });

  it('수락됐고 정산 전이면 진행중', () => {
    expect(bucketOf(app('ACCEPTED'))).toBe('ONGOING');
  });

  it('전시가 끝나도 정산 전이면 진행중 — 작가는 아직 대금을 기다린다', () => {
    expect(bucketOf({ status: 'ACCEPTED', exhibition: { settledAt: null } })).toBe('ONGOING');
  });

  it('정산까지 끝나면 진행종료', () => {
    expect(bucketOf(app('ACCEPTED', '2026-08-01T00:00:00Z'))).toBe('CLOSED');
  });

  /** 이게 이 파일에서 제일 중요한 케이스다 */
  it('거절당한 공모가 나중에 정산돼도 진행종료로 새지 않는다', () => {
    expect(bucketOf(app('REJECTED', '2026-08-01T00:00:00Z'))).toBe('REVIEWING');
  });

  it('공모 정보가 비어 있어도 죽지 않는다', () => {
    expect(bucketOf({ status: 'ACCEPTED' })).toBe('ONGOING');
    expect(bucketOf({ status: 'ACCEPTED', exhibition: null })).toBe('ONGOING');
  });
});

describe('groupMyExhibitions', () => {
  it('세 갈래로 빠짐없이 나눈다 (어디에도 안 들어가는 항목이 없어야 한다)', () => {
    const apps = [
      app('SUBMITTED'), app('REVIEWED'), app('REJECTED'),
      app('ACCEPTED'), app('ACCEPTED'),
      app('ACCEPTED', '2026-08-01T00:00:00Z'),
    ];
    const g = groupMyExhibitions(apps);
    expect(g.REVIEWING).toHaveLength(3);
    expect(g.ONGOING).toHaveLength(2);
    expect(g.CLOSED).toHaveLength(1);
    expect(g.REVIEWING.length + g.ONGOING.length + g.CLOSED.length).toBe(apps.length);
  });

  it('빈 목록도 세 갈래를 모두 돌려준다 (undefined 접근 방지)', () => {
    const g = groupMyExhibitions([]);
    expect(g.REVIEWING).toEqual([]);
    expect(g.ONGOING).toEqual([]);
    expect(g.CLOSED).toEqual([]);
  });
});

describe('defaultBucket — 처음 열었을 때 빈 화면이 되면 안 된다', () => {
  it('진행중이 있으면 진행중', () => {
    expect(defaultBucket([app('SUBMITTED'), app('ACCEPTED')])).toBe('ONGOING');
  });

  it('진행중이 없으면 심사중', () => {
    expect(defaultBucket([app('SUBMITTED'), app('ACCEPTED', '2026-08-01T00:00:00Z')])).toBe('REVIEWING');
  });

  it('끝난 것만 있으면 진행종료', () => {
    expect(defaultBucket([app('ACCEPTED', '2026-08-01T00:00:00Z')])).toBe('CLOSED');
  });

  it('아무것도 없으면 진행중 (빈 목록 안내 문구가 그 탭 기준으로 나온다)', () => {
    expect(defaultBucket([])).toBe('ONGOING');
  });
});

describe('탭 정의', () => {
  it('심사중 / 진행중 / 진행종료 세 개, 전체 탭은 없다', () => {
    expect(MY_EXHIBITION_TABS.map(t => t.label)).toEqual(['심사중', '진행중', '진행종료']);
  });
});

/**
 * 다음 일정 (nextSchedule)
 *
 * 작가가 가장 자주 놓치는 게 "자료 언제까지" 다. 여기가 틀리면
 * ① 기한을 잘못 알려주거나 ② 이미 지난 마감을 안 보여줘 작가가 모른 채 지나간다.
 */
// KST 달력 날짜 차이를 흉내내는 테스트용 getDday
const mkDday = (today: string) => (d: string | Date) => {
  const iso = d instanceof Date ? d.toISOString() : String(d);
  const day = (s: string) => Math.floor(Date.parse(s.slice(0, 10) + 'T00:00:00Z') / 86400000);
  return day(iso) - day(today);
};

describe('shortDate', () => {
  it('M/D 로 줄인다', () => {
    expect(shortDate('2026-08-15T00:00:00.000Z')).toBe('8/15');
    expect(shortDate('2026-12-03')).toBe('12/3');
  });
  it('이상한 값은 빈 문자열 (화면이 깨지지 않게)', () => {
    expect(shortDate('nope')).toBe('');
  });
});

describe('nextSchedule', () => {
  const dday = mkDday('2026-08-19');
  const ex = { submissionDeadline: '2026-08-22', exhibitStartDate: '2026-08-28', exhibitDate: '2026-08-30' };

  it('미제출 + 마감 전 → 자료제출 마감 D-3 / 전시시작 D-9', () => {
    const rows = nextSchedule(ex, false, dday);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: '자료제출 마감', dday: 'D-3', date: '8/22' });
    expect(rows[1]).toMatchObject({ label: '전시시작', dday: 'D-9', date: '8/28' });
  });

  it('제출 완료 → 자료제출 완료 / 전시시작', () => {
    const rows = nextSchedule(ex, true, dday);
    expect(rows[0]).toMatchObject({ label: '자료제출 완료', dday: null, tone: 'done' });
    expect(rows[1]).toMatchObject({ label: '전시시작', dday: 'D-9' });
  });

  /** 늦었어도 내야 하는 일이라 줄을 숨기면 안 된다 */
  it('미제출 + 마감 지남 → 줄을 지우지 않고 빨간색으로 남긴다', () => {
    const rows = nextSchedule({ ...ex, submissionDeadline: '2026-08-15' }, false, dday);
    expect(rows[0]).toMatchObject({ label: '자료제출 마감 지남', dday: null, date: '8/15', tone: 'urgent' });
    expect(rows[1]).toMatchObject({ label: '전시시작' });
  });

  it('마감 당일은 D-DAY', () => {
    const rows = nextSchedule({ ...ex, submissionDeadline: '2026-08-19' }, false, dday);
    expect(rows[0]).toMatchObject({ dday: 'D-DAY', tone: 'urgent' });
  });

  it('사흘 안쪽이면 빨간색 — 그때 알려야 아직 낼 수 있다', () => {
    expect(nextSchedule({ ...ex, submissionDeadline: '2026-08-22' }, false, dday)[0]!.tone).toBe('urgent');
    expect(nextSchedule({ ...ex, submissionDeadline: '2026-08-26' }, false, dday)[0]!.tone).toBe('normal');
  });

  /** 옛 공모에는 값이 없다 — 없는 기한을 지어내면 안 된다 */
  it('자료제출 마감일이 없으면 그 줄을 아예 만들지 않는다', () => {
    const rows = nextSchedule({ exhibitStartDate: '2026-08-28' }, false, dday);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('전시시작');
  });

  it('전시가 이미 시작했으면 전시시작 줄은 뺀다 (의미 없는 D-day)', () => {
    const rows = nextSchedule({ submissionDeadline: '2026-08-10', exhibitStartDate: '2026-08-12' }, true, dday);
    expect(rows.map(r => r.label)).toEqual(['자료제출 완료']);
  });

  it('전시 시작일이 없으면 종료일을 쓴다', () => {
    const rows = nextSchedule({ exhibitDate: '2026-08-30' }, false, dday);
    expect(rows[0]).toMatchObject({ label: '전시시작', date: '8/30' });
  });

  it('날짜가 아무것도 없으면 빈 배열 (카드에 빈 상자가 뜨지 않게)', () => {
    expect(nextSchedule({}, false, dday)).toEqual([]);
  });
});

describe('종료 판정은 서버 값을 따른다', () => {
  it('closed=true 면 정산 전이어도 진행종료 (전시 종료 20일 경과)', () => {
    expect(bucketOf({ status: 'ACCEPTED', exhibition: { settledAt: null, closed: true } })).toBe('CLOSED');
  });

  it('closed=false 면 진행중 (정산을 시작한 공모는 20일이 지나도 유지)', () => {
    expect(bucketOf({ status: 'ACCEPTED', exhibition: { settledAt: null, closed: false } })).toBe('ONGOING');
  });

  it('closed 가 없는 옛 응답은 정산 완료로만 판정한다', () => {
    expect(bucketOf({ status: 'ACCEPTED', exhibition: { settledAt: '2026-08-01' } })).toBe('CLOSED');
    expect(bucketOf({ status: 'ACCEPTED', exhibition: { settledAt: null } })).toBe('ONGOING');
  });
});

/**
 * 진행 단계 배지 (exhibitionStage)
 *
 * 배지가 뭉뚱그려지면 작가가 지금 무슨 상황인지 알 수 없다. 실제로 두 번 어긋났다:
 *  ① 전시가 이미 열렸는데 '확정' 으로 떠서 지금 전시 중인지 알 수 없었다
 *  ② 20일 규칙으로 자동 정리된 공모가 '확정' 으로 떠 있었다 (ended 플래그가 false 라서)
 */
describe('exhibitionStage', () => {
  const past = '2020-01-01', future = '2099-01-01';
  const label = (ex: any) => exhibitionStage(ex)?.label;

  /** '모집마감' 은 갤러리가 누르는 동작 이름이다 — 수락된 작가에게는 전시를 준비하는 기간이다 */
  it('모집중 → 전시 준비중 → 확정 순서', () => {
    expect(label({ exhibitStartDate: future })).toBe('모집중');
    expect(label({ exhibitStartDate: future, recruitmentClosed: true })).toBe('전시 준비중');
    expect(label({ exhibitStartDate: future, recruitmentClosed: true, confirmed: true })).toBe('확정');
  });

  it('전시 시작일이 지나면 확정이 아니라 [전시 진행중]', () => {
    expect(label({ exhibitStartDate: past, confirmed: true })).toBe('전시 진행중');
  });

  it('전시종료와 정산중을 구분한다 — 진행중 탭에 남아 있는 이유가 보여야 한다', () => {
    expect(label({ exhibitStartDate: past, ended: true })).toBe('전시종료');
    expect(label({ exhibitStartDate: past, ended: true, settlementStarted: true })).toBe('정산중');
  });

  it('정산이 끝나면 정산완료', () => {
    expect(label({ ended: true, settlementStarted: true, settledAt: '2026-08-01' })).toBe('정산완료');
  });

  /** 갤러리가 [전시종료]를 누른 적이 없어 ended=false 인 채로 20일이 지난 경우 */
  it('자동 정리된 방치 공모는 [종료(자동)] — 확정으로 뜨면 안 된다', () => {
    expect(label({ exhibitStartDate: past, confirmed: true, ended: false, closed: true })).toBe('종료(자동)');
  });

  it('갤러리가 직접 종료를 누른 공모는 자동 표기를 쓰지 않는다', () => {
    expect(label({ exhibitStartDate: past, ended: true, closed: true })).toBe('전시종료');
  });

  it('정산 완료가 자동 정리보다 우선한다', () => {
    expect(label({ ended: false, closed: true, settledAt: '2026-08-01' })).toBe('정산완료');
  });

  it('공모 정보가 없으면 null (배지를 그리지 않는다)', () => {
    expect(exhibitionStage(null)).toBeNull();
  });
});
