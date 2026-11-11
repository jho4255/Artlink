/**
 * lib/scrollToTarget.ts (2026-11-11, CLAUDE.md 규칙 79) — 크롬 124(앱 WebView)는 overflow:hidden 요소의 scroll-margin-top 을
 * 무시해 scrollIntoView 가 맨 위에 붙였다. 알림으로 연 문의 제목이 상단바 뒤로 숨었다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrollToTarget } from '@/lib/scrollToTarget';

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('scrollToTarget', () => {
  it('요소의 scroll-margin-top 만큼 띄운 자리로 간다(지금 스크롤 위치를 더해서)', () => {
    const el = document.createElement('div');
    el.style.scrollMarginTop = '96px';
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 700 } as DOMRect);
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    const to = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    scrollToTarget(el);
    expect(to).toHaveBeenCalledWith({ top: 900 + 700 - 96, behavior: 'smooth' });
  });

  it('맨 위보다 위로는 가지 않는다 · 요소가 없으면 아무것도 안 한다', () => {
    const el = document.createElement('div');
    el.style.scrollMarginTop = '96px';
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const to = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    scrollToTarget(el, 'auto');
    expect(to).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    to.mockClear();
    scrollToTarget(null);
    expect(to).not.toHaveBeenCalled();
  });

  it('★ overflow-hidden 에 scroll-mt 를 준 딥링크 대상은 scrollIntoView 대신 이걸 쓴다', () => {
    const support = read('pages/SupportPage.tsx');
    expect(support).toMatch(/scrollToTarget\(document\.querySelector\(`\[data-inquiry=/);
    expect(support).not.toMatch(/data-inquiry=[^\n]*scrollIntoView/);
    const hosted = read('components/admin/HostedExhibitionsSection.tsx');
    expect(hosted).toMatch(/scrollToTarget\(document\.getElementById\(`hosted-ex-/);
    expect(hosted).not.toMatch(/hosted-ex-\$\{exId\}`\)\?\.scrollIntoView/);
  });
});
