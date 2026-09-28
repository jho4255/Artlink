import { describe, it, expect, beforeEach } from 'vitest';
import { dayLabel, fmtAvg, niceMax, summarizeVisitors, trimBeforeSince, type VisitorRow } from '@/lib/visitStatsView';
import { claimVisitSlot, kstToday, visitorId } from '@/lib/visitBeacon';
import { myPageTabs } from '@/lib/myPageMenu';

/** Admin [통계] — 일간 방문자 (2026-09-28). 서버 규칙은 backend `visit-stats.test.ts` 가 본다. */
const row = (date: string, members: number, guests: number): VisitorRow => ({ date, members, guests, total: members + guests });

describe('일간 방문자 화면 계산', () => {
  it('집계 시작일 전의 0 은 빼고 그린다 — "지난 3주 0명" 으로 읽히지 않게', () => {
    const rows = [row('2026-09-25', 0, 0), row('2026-09-26', 0, 0), row('2026-09-27', 1, 2), row('2026-09-28', 3, 4)];
    expect(trimBeforeSince(rows, '2026-09-27').map((r) => r.date)).toEqual(['2026-09-27', '2026-09-28']);
    expect(trimBeforeSince(rows, null)).toEqual([]);
  });

  it('오늘·어제·최근 7일 평균 — 기록이 7일이 안 되면 있는 날만으로', () => {
    const s = summarizeVisitors([row('2026-09-27', 2, 4), row('2026-09-28', 3, 1)]);
    expect(s.today).toMatchObject({ date: '2026-09-28', total: 4 });
    expect(s.yesterday).toMatchObject({ date: '2026-09-27', total: 6 });
    expect(s.avg).toEqual({ days: 2, members: 2.5, guests: 2.5, total: 5 });
    const nine = Array.from({ length: 9 }, (_, i) => row(`2026-09-${String(20 + i).padStart(2, '0')}`, i, 0));
    expect(summarizeVisitors(nine).avg).toMatchObject({ days: 7, members: 5 });   // 2..8 의 평균
    expect(summarizeVisitors([])).toEqual({ today: null, yesterday: null, avg: null });
  });

  it('세로축 끝은 1·2·5×10ⁿ(최소 5) · 날짜 라벨은 기기 시간대와 무관 · 평균은 소수 한 자리', () => {
    expect([0, 3, 5, 6, 11, 23, 57, 101, 480].map(niceMax)).toEqual([5, 5, 5, 10, 20, 50, 100, 200, 500]);
    expect(dayLabel('2026-09-28')).toEqual({ md: '9/28', weekday: '월' });
    expect(dayLabel('2026-10-04')).toEqual({ md: '10/4', weekday: '일' });
    expect(fmtAvg(5)).toBe('5');
    expect(fmtAvg(2.333)).toBe('2.3');
  });
});

describe('방문 기록 보내기', () => {
  beforeEach(() => localStorage.clear());

  it('하루 한 번 — 같은 날 같은 신원이면 다시 안 보낸다, 로그인하면 한 번 더', () => {
    const now = new Date('2026-09-28T03:00:00Z');
    expect(claimVisitSlot(null, now)).toBe(true);
    expect(claimVisitSlot(null, now)).toBe(false);
    expect(claimVisitSlot(7, now)).toBe(true);    // 로그인 — 회원으로 옮겨야 한다
    expect(claimVisitSlot(7, now)).toBe(false);
    expect(claimVisitSlot(7, new Date('2026-09-28T15:00:00Z'))).toBe(true);   // KST 자정이 지나면 새 날
  });

  it('날짜는 KST — UTC 15시가 넘으면 다음 날', () => {
    expect(kstToday(new Date('2026-09-27T14:59:00Z'))).toBe('2026-09-27');
    expect(kstToday(new Date('2026-09-27T15:00:00Z'))).toBe('2026-09-28');
  });

  it('기기 id 는 한 번 만들어 계속 쓴다 — 서버 형식(영숫자·하이픈 16~64자)에 맞는다', () => {
    const a = visitorId();
    expect(a).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(visitorId()).toBe(a);
  });
});

describe('[통계] 탭', () => {
  it('관리자 메뉴에만 있다', () => {
    const ids = (role: 'ADMIN' | 'ARTIST' | 'GALLERY' | 'VISITOR') => myPageTabs(role).map((t) => t.id);
    expect(ids('ADMIN')).toContain('stats');
    for (const r of ['ARTIST', 'GALLERY', 'VISITOR'] as const) expect(ids(r)).not.toContain('stats');
  });
});
