/**
 * Admin [사용자 관리] — '오늘 방문' 탭과 회원별 '최근 7일 중 N일 방문' (2026-10-25). 서버 규칙은 backend `lib/visitStats.ts`
 * (`memberVisitSummary`·`visitedTodayWhere`), 회귀는 backend `visit-stats.test.ts`. 여기서는 화면이 그 API 를 맞게 부르는지 소스로 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../pages/MyPage.tsx'), 'utf-8');
const section = src.slice(src.indexOf('// ========== Admin: 사용자 관리'), src.indexOf('// ========== Admin: 운영 조회'));

describe('Admin 사용자 관리 — 오늘 방문 · 최근 7일 방문', () => {
  it("'오늘 방문' 탭은 역할 대신 visited=today 로 부른다", () => {
    expect(section).toMatch(/\{ role: 'TODAY', label: '오늘 방문' \}/);
    expect(section).toMatch(/activeRole === 'TODAY' \? \{ visited: 'today' \} : \{ role: activeRole \}/);
  });

  it("탭 옆 숫자는 [통계] 탭과 같은 집계(오늘 회원 수)를 쓴다 — 두 화면이 다른 숫자를 말하면 안 된다", () => {
    expect(section).toMatch(/\/admin\/stats\/visitors\?days=1/);
  });

  it("단위는 '날'이다 — '방문 횟수'라고 쓰지 않는다(기록이 기기 × 하루 한 줄이라 하루에 몇 번 왔는지는 모른다)", () => {
    expect(section).toMatch(/최근 7일 중 \{u\.visitDays7 \?\? 0\}일 방문/);
    expect(section).not.toMatch(/방문 횟수|방문횟수/);
  });
});
