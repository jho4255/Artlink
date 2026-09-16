/**
 * 강조색은 **하나**다 — `--color-accent`(#c4302b) 하나만 쓰는지 소스를 감시한다 (2026-09-16)
 *
 * ## 왜
 * 2026-09-16 전수 조사에서 빨강이 셋이었다 —
 *   · 로고·화면 이름(Art**Link**, Home**Page** …)은 `#dc3545` 37곳
 *   · 디자인 토큰·D-day·판매완료는 `#c4302b` 57곳
 *   · 오류·삭제·알림 배지는 Tailwind `red-500/600` 86곳
 * 셋 다 "빨강"이라 눈으로는 한 색처럼 보이는데 나란히 놓이면 다르다(로고 옆 D-day 처럼).
 * 사용자가 **#c4302b 하나로 통일**하기로 정했다. 로고까지.
 *
 * ## 규칙
 * 색은 `index.css` 의 `@theme --color-accent` 한 곳에서만 정한다. 화면은 `text-accent` · `bg-accent/10` ·
 * `border-accent/40` 처럼 **토큰 클래스**로만 쓴다. 16진수를 클래스에 박거나(`text-[#c4302b]`) Tailwind 빨강
 * 팔레트(`text-red-500`)를 쓰면 이 가드가 잡는다 — 바꾸고 싶으면 토큰 값을 바꾼다.
 *
 * ⚠️ PDF 엔진(`lib/portfolio*.ts`)은 예외다. 거긴 화면 테마가 아니라 **작가가 고르는 인쇄 팔레트**라
 *    16진수를 직접 든다(html2canvas 는 CSS 변수를 못 읽는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const EXEMPT = [/^lib\/portfolio/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC)
  .map((path) => ({
    path: path.slice(SRC.length + 1),
    // 주석은 뺀다 — "#dc3545 를 없앴다" 라고 적어 둔 설명까지 걸리면 가드가 잔소리가 된다
    code: readFileSync(path, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }))
  .filter((f) => !EXEMPT.some((re) => re.test(f.path)));

describe('강조색 하나 (--color-accent)', () => {
  it('테스트가 실제 소스를 읽고 있다', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.path.includes('Navbar'))).toBe(true);
  });

  it('★ 옛 로고 빨강 #dc3545 는 어디에도 없다', () => {
    const offenders = files.filter((f) => /dc3545/i.test(f.code)).map((f) => f.path);
    expect(offenders, `#dc3545 가 남은 곳: ${offenders.join(', ')}`).toEqual([]);
  });

  it('★ 강조색을 16진수로 박지 않는다 — 토큰 클래스(text-accent …)로', () => {
    const offenders = files.filter((f) => /c4302b/i.test(f.code)).map((f) => f.path);
    expect(offenders, `#c4302b 를 직접 쓴 곳(토큰 클래스로 바꿀 것): ${offenders.join(', ')}`).toEqual([]);
  });

  it('★ Tailwind 빨강 팔레트(red-*)를 쓰지 않는다 — 오류·삭제도 같은 강조색', () => {
    const offenders = files
      .filter((f) => /\b(?:[a-z-]+:)?(?:text|bg|border|ring|fill|stroke|decoration|outline|shadow|from|to|via)-red-\d{2,3}\b/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `red-* 클래스가 남은 곳: ${offenders.join(', ')}`).toEqual([]);
  });

  it('토큰 자체는 index.css 한 곳에 있다', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf-8');
    expect(css).toMatch(/--color-accent:\s*#c4302b/);
  });
});
