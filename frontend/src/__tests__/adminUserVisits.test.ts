/**
 * Admin [사용자 관리] — 2026-11-21 개편(components/admin/UserManageSection.tsx, 규칙 89). 서버 규칙은 backend `routes/admin.ts`
 * `pagedUsers`·`lib/visitStats.ts`, 회귀는 backend `admin-console.test.ts`·`visit-stats.test.ts`. 여기서는 화면이 그 API 를 맞게 부르는지 소스로 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const section = readFileSync(resolve(__dirname, '../components/admin/UserManageSection.tsx'), 'utf-8');

describe('Admin 사용자 관리 — 표 · 오늘 방문 · 최근 7일', () => {
  it("표 모드(paged=1)로 부르고, '오늘 방문' 탭은 역할 대신 visited=today", () => {
    expect(section).toMatch(/new URLSearchParams\(\{ paged: '1', page: String\(page\), sort \}\)/);
    expect(section).toMatch(/if \(role === 'TODAY'\) params\.set\('visited', 'today'\)/);
    expect(section).toMatch(/\{ id: 'TODAY', label: '오늘 방문' \}/);
  });

  it("단위는 '날'이다 — '방문 횟수'라고 쓰지 않는다(기록이 기기 × 하루 한 줄이라 하루에 몇 번 왔는지는 모른다)", () => {
    expect(section).toMatch(/aria-label=\{`최근 7일 중 \$\{n\}일 방문`\}/);
    expect(section).toMatch(/최근 7일 중 \{data\.visits\.days7\}일/);
    expect(section).not.toMatch(/방문 횟수|방문횟수/);
  });

  it('★ 역할은 확인창을 거쳐 바꾼다 — 고르는 즉시 바뀌지 않는다', () => {
    expect(section).toMatch(/onChange=\{\(e\) => \{ setNextRole\(e\.target\.value\); setRoleOpen\(true\); \}\}/);
    expect(section).toMatch(/onConfirm=\{\(\) => roleMutation\.mutate\(nextRole\)\}/);
  });

  it('다른 화면에서 그 회원을 찾아 들어온다(?role=&q=) — [신고 관리]의 ArtTalk 신고', () => {
    expect(section).toMatch(/searchParams\.get\('role'\)/);
    expect(section).toMatch(/searchParams\.get\('q'\)/);
    const reports = readFileSync(resolve(__dirname, '../components/admin/ChatReportsSection.tsx'), 'utf-8');
    expect(reports).toMatch(/\/mypage\?tab=user-manage&role=/);
  });
});
