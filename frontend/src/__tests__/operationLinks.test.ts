/**
 * 공모 운영자의 '일터' 주소는 역할마다 다르다 (2026-10-02)
 *
 * 운영 화면의 [← 내 공모]·[지원자 보기]·할 일 버튼이 전부 갤러리의 `/mypage?tab=my-exhibitions…` 로 가서,
 * 관리자가 누르면 프로필(닉네임 입력 칸)이 떴다. 주소가 문자열이라 타입이 못 잡고, 틀려도 빈 화면이 아니라
 * 멀쩡한 프로필이 떠서 아무도 몰랐다. 그래서 순수 함수와 **소스**를 함께 본다.
 * 실제로 눌러서 어디로 가는지는 e2e `63-operator-links.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { galleryOperationHref, operatorWorkspace } from '@/lib/operationLinks';
import { aliasTab, isMyPageTab, myPageTabs, resolveTab } from '@/lib/myPageMenu';

const tabOf = (href: string) => new URLSearchParams(href.split('?')[1]).get('tab');
const exOf = (href: string) => new URLSearchParams(href.split('?')[1]).get('ex');

describe('operatorWorkspace — 지원자 보기·목록으로가 가는 곳', () => {
  it('갤러리는 [내 공모] 의 그 카드로 — 지원자 탭을 연 채로', () => {
    const ws = operatorWorkspace('GALLERY', 'GALLERY', 7)!;
    expect(ws.label).toBe('내 공모');
    expect(ws.listHref).toBe('/mypage?tab=my-exhibitions&ex=7');
    expect(ws.applicantsHref).toBe('/mypage?tab=my-exhibitions&ex=7&panel=applicants');
    expect(ws.canDecide).toBe(true);
  });

  it('갤러리는 위임받은 아트링크 주최 공모도 [내 공모] 에서 운영한다', () => {
    expect(operatorWorkspace('GALLERY', 'ADMIN', 18)!.applicantsHref).toBe('/mypage?tab=my-exhibitions&ex=18&panel=applicants');
  });

  it('★ 관리자 · 아트링크 주최 → [주최 공모] 의 그 카드(지원자 관리)', () => {
    const ws = operatorWorkspace('ADMIN', 'ADMIN', 19)!;
    expect(ws.label).toBe('주최 공모');
    expect(ws.applicantsHref).toBe('/mypage?tab=hosted-exhibitions&ex=19&panel=applicants');
    expect(ws.canDecide).toBe(true);
  });

  it('★ 관리자 · 갤러리 주최 → [운영 조회] 의 그 공모 지원 현황(조회 전용)', () => {
    const ws = operatorWorkspace('ADMIN', 'GALLERY', 7)!;
    expect(ws.label).toBe('운영 조회');
    expect(ws.applicantsHref).toBe('/mypage?tab=oversight&ex=7');
    expect(ws.listHref).toBe(ws.applicantsHref);
    expect(ws.canDecide).toBe(false);
    // 주최 구분을 모르면(옛 응답) 갤러리 주최로 본다 — 운영 조회는 모든 공모를 보여 주므로 어느 쪽이든 열린다
    expect(operatorWorkspace('ADMIN', undefined, 7)!.label).toBe('운영 조회');
  });

  it('작가·일반·비로그인은 공모를 운영하지 않는다 → null', () => {
    for (const role of ['ARTIST', 'VISITOR', null, undefined, '']) expect(operatorWorkspace(role, 'GALLERY', 7)).toBeNull();
    expect(operatorWorkspace('GALLERY', 'GALLERY', null)).toBeNull();
    expect(operatorWorkspace('GALLERY', 'GALLERY', '')).toBeNull();
  });

  it('★ 돌려주는 주소의 탭은 **그 역할에 실제로 있는 탭**이다 — 없으면 프로필로 떨어진다', () => {
    const cases: [string, string][] = [['GALLERY', 'GALLERY'], ['GALLERY', 'ADMIN'], ['ADMIN', 'GALLERY'], ['ADMIN', 'ADMIN']];
    for (const [role, host] of cases) {
      const ws = operatorWorkspace(role, host, 5)!;
      for (const href of [ws.listHref, ws.applicantsHref]) {
        expect(isMyPageTab(role, tabOf(href)), `${role}/${host}: ${href}`).toBe(true);
        expect(resolveTab(role, tabOf(href))).toBe(tabOf(href));
        expect(exOf(href)).toBe('5');
      }
      expect(myPageTabs(role).find((t) => t.id === tabOf(ws.listHref))!.label).toBe(ws.label);
    }
    expect(isMyPageTab('GALLERY', tabOf(galleryOperationHref(5)))).toBe(true);
  });
});

describe('다른 역할의 탭 주소로 들어왔을 때 (안전망)', () => {
  it('★ 관리자가 갤러리의 [내 공모] 주소를 열면 [운영 조회] 로 — 프로필이 아니다', () => {
    expect(resolveTab('ADMIN', 'my-exhibitions')).toBe('oversight');
    expect(aliasTab('ADMIN', 'my-exhibitions')).toBe('oversight');
  });

  it('제 역할의 탭이면 건드리지 않는다 · 대응하는 탭이 없으면 예전처럼 프로필', () => {
    expect(aliasTab('GALLERY', 'my-exhibitions')).toBeNull();
    expect(resolveTab('GALLERY', 'my-exhibitions')).toBe('my-exhibitions');
    expect(aliasTab('ADMIN', 'oversight')).toBeNull();
    expect(aliasTab('ARTIST', 'my-exhibitions')).toBeNull();
    expect(resolveTab('ARTIST', 'my-exhibitions')).toBe('profile');
    expect(aliasTab('ADMIN', 'portfolio')).toBeNull();
    expect(aliasTab('ADMIN', null)).toBeNull();
  });
});

describe('★ 여러 역할이 들어오는 화면에 역할 전용 탭 주소를 손으로 적지 않는다', () => {
  const SRC = resolve(__dirname, '..');
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // 운영자(갤러리·위임 갤러리·관리자)가 함께 쓰는 화면들
  const shared = [
    'pages/OperationPage.tsx',
    'pages/OperationClassicPage.tsx',
    'pages/OperationPrintPage.tsx',
    'pages/ExhibitionDetailPage.tsx',
    'components/shared/ApplicantManager.tsx',
    'components/shared/JoinCodePanel.tsx',
    ...readdirSync(join(SRC, 'components/operation')).filter((f) => f.endsWith('.tsx')).map((f) => `components/operation/${f}`),
  ];
  // 한 역할에만 있는 운영 탭 — 이 주소를 다른 역할이 열면 프로필(또는 안전망 탭)로 떨어진다
  const OPERATOR_ONLY = /tab=(my-exhibitions|my-galleries|my-shows|scraps|hosted-exhibitions|oversight|approvals)\b/;

  it.each(shared)('%s', (file) => {
    const hits = strip(readFileSync(join(SRC, file), 'utf-8')).split('\n').filter((l) => OPERATOR_ONLY.test(l));
    expect(hits, `역할 전용 탭 주소가 박혀 있다 — lib/operationLinks.ts 의 operatorWorkspace 를 쓸 것:\n${hits.join('\n')}`).toEqual([]);
  });

  it('운영 화면은 operatorWorkspace 로 갈 곳을 정한다', () => {
    const op = strip(readFileSync(join(SRC, 'pages/OperationPage.tsx'), 'utf-8'));
    expect(op).toContain('operatorWorkspace(user?.role, access.hostType, id)');
    expect(op).toMatch(/workspace\??\.applicantsHref/);
    expect(op).toMatch(/workspace\??\.listHref/);
  });
});
