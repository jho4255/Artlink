/**
 * 가운데 내비게이션 정의 (`lib/navLinks.ts`)
 *
 * 이 목록 **하나**를 데스크톱 상단 중앙과 모바일 하단 탭바가 같이 쓴다. 그래서 여기가 틀어지면
 * 두 화면이 동시에 틀어지고, 반대로 한 곳만 고치는 실수는 구조적으로 불가능하다.
 *
 * 여기서 지키는 것:
 *   1. **비로그인도 볼 수 있는 페이지만.** 로그인 전용을 넣으면 눌렀다가 로그인 화면으로 튕긴다.
 *   2. [작가] 는 **홈과 갤러리 사이** (2026-09-10 사용자 지정 순서).
 *   3. 경로가 실제 라우트와 맞는가 — 문자열이라 타입이 안 잡아 준다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NAV_LINKS } from '@/lib/navLinks';

const appSource = readFileSync(join(__dirname, '../App.tsx'), 'utf-8');

describe('NAV_LINKS', () => {
  it('★ 순서: 홈 · 작가 · 갤러리 · 전시 · 모집공고 · 커뮤니티', () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual(['홈', '작가', '갤러리', '전시', '모집공고', '커뮤니티']);
  });

  it('★ [작가] 는 홈과 갤러리 **사이**에 있다', () => {
    const labels = NAV_LINKS.map((l) => l.label);
    expect(labels.indexOf('작가')).toBe(labels.indexOf('홈') + 1);
    expect(labels.indexOf('갤러리')).toBe(labels.indexOf('작가') + 1);
  });

  it('★ [작가] 는 /artists 로 간다 — 홈 앵커로 보내지 않는다', () => {
    const artists = NAV_LINKS.find((l) => l.label === '작가');
    expect(artists?.path).toBe('/artists');
    // 홈으로 보내면 [홈]과 같은 주소가 되어 탭이 둘일 이유가 없어진다
    expect(artists?.path).not.toBe('/');
  });

  /**
   * ⚠️ 경로는 문자열이라 타입도 컴파일러도 안 잡아 준다.
   *    라우트를 안 만들고 탭만 넣으면 **에러 없이 빈 화면**이 뜬다.
   */
  it('★ 모든 탭 경로에 실제 라우트가 있다', () => {
    for (const link of NAV_LINKS) {
      expect(appSource, `${link.label}(${link.path}) 라우트가 App.tsx 에 없다`)
        .toContain(`path="${link.path}"`);
    }
  });

  it('경로·라벨이 중복되지 않는다', () => {
    expect(new Set(NAV_LINKS.map((l) => l.path)).size).toBe(NAV_LINKS.length);
    expect(new Set(NAV_LINKS.map((l) => l.label)).size).toBe(NAV_LINKS.length);
  });

  it('아이콘이 빠진 항목이 없다 (하단 탭바가 아이콘으로 그린다)', () => {
    for (const link of NAV_LINKS) expect(link.icon).toBeTruthy();
  });

  /**
   * ⚠️ 로그인해야 쓸 수 있는 페이지를 여기 두면 비로그인이 눌렀다가 튕긴다.
   *    (마이페이지·소식이 그래서 우측 사이드바/햄버거 안에 있다)
   */
  it('★ 로그인 전용 경로가 섞이지 않았다', () => {
    const loginOnly = ['/mypage', '/feed', '/messages'];
    for (const p of loginOnly) {
      expect(NAV_LINKS.some((l) => l.path.startsWith(p))).toBe(false);
    }
  });
});
