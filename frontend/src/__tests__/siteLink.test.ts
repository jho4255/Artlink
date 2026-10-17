import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSiteLink, resolveSiteLink } from '@/lib/siteLink';

// 관리자가 적은 배너·광고 링크를 어디서 여는가 (2026-10-17 — 실서버 배너가 https://artlink.cc/exhibitions 라 새 탭이 열렸다)
const O = 'https://artlink.cc';

describe('resolveSiteLink — 우리 사이트면 같은 탭', () => {
  it('★ 우리 사이트의 전체 주소는 앱 안 경로로(실서버 배너 그대로)', () => {
    expect(resolveSiteLink('https://artlink.cc/exhibitions', O)).toEqual({ kind: 'route', path: '/exhibitions' });
    expect(resolveSiteLink('https://www.artlink.cc/exhibitions/12?tab=a#x', O)).toEqual({ kind: 'route', path: '/exhibitions/12?tab=a#x' });
    expect(resolveSiteLink('http://ARTLINK.cc/@kim.su', O)).toEqual({ kind: 'route', path: '/@kim.su' });
    expect(resolveSiteLink('https://artlink-stmq.onrender.com/artists', O)).toEqual({ kind: 'route', path: '/artists' });
  });

  it('지금 열린 주소(로컬 개발 등)도 우리 사이트다', () => {
    expect(resolveSiteLink('http://localhost:5173/galleries', 'http://localhost:5173')).toEqual({ kind: 'route', path: '/galleries' });
  });

  it('경로는 그대로 앱 안으로', () => {
    expect(resolveSiteLink('/exhibitions?scope=open', O)).toEqual({ kind: 'route', path: '/exhibitions?scope=open' });
  });

  it('바깥 사이트는 새 창', () => {
    expect(resolveSiteLink('https://instagram.com/artlink', O)).toEqual({ kind: 'external', url: 'https://instagram.com/artlink' });
    // 이미지 저장소는 우리 화면이 아니다
    expect(resolveSiteLink('https://img.artlink.cc/a.jpg', O)?.kind).toBe('external');
    // 비슷한 이름의 남의 도메인
    expect(resolveSiteLink('https://artlink.cc.evil.com/x', O)?.kind).toBe('external');
  });

  it('우리 사이트라도 화면이 아니라 파일이면 새 창(라우터로 보내면 없는 화면이 뜬다)', () => {
    expect(resolveSiteLink('https://artlink.cc/uploads/a.pdf', O)).toEqual({ kind: 'external', url: 'https://artlink.cc/uploads/a.pdf' });
    expect(resolveSiteLink('/terms/artist_apply_real.txt', O)).toEqual({ kind: 'external', url: 'https://artlink.cc/terms/artist_apply_real.txt' });
    expect(resolveSiteLink('/artlook/index.html', O)?.kind).toBe('external');
  });

  it('쓸 수 없는 주소는 아무 일도 없다', () => {
    expect(resolveSiteLink('javascript:alert(1)', O)).toBeNull();
    expect(resolveSiteLink('//evil.com/x', O)).toBeNull();
    expect(resolveSiteLink('', O)).toBeNull();
    expect(resolveSiteLink(null, O)).toBeNull();
  });
});

describe('openSiteLink', () => {
  afterEach(() => vi.restoreAllMocks());

  it('우리 화면은 navigate 만, 바깥은 noopener 새 창(이 탭의 sessionStorage 를 복사해 가지 않게)', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const nav = vi.fn();
    openSiteLink(`${window.location.origin}/exhibitions`, nav);
    expect(nav).toHaveBeenCalledWith('/exhibitions');
    expect(open).not.toHaveBeenCalled();
    openSiteLink('https://instagram.com/x', nav);
    expect(open).toHaveBeenCalledWith('https://instagram.com/x', '_blank', 'noopener');
    expect(nav).toHaveBeenCalledTimes(1);
  });
});

describe('소스 가드 — 배너·광고는 이 판정을 거친다', () => {
  it.each(['components/home/HeroSlider.tsx', 'components/shared/AdSlot.tsx'])('%s', (f) => {
    const src = readFileSync(resolve(__dirname, '..', f), 'utf8');
    expect(src).toContain('openSiteLink(');
    // 'http 로 시작하면 새 창' 판정을 되살리지 않는다
    expect(src).not.toMatch(/startsWith\('http'\)/);
    expect(src).not.toMatch(/window\.open\(/);
  });
});
