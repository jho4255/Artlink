/**
 * [PDF 내려받기] 글자 밀림 · 제목 잘림 (2026-10-15, 김현수 작가 신고) — index.css 의 한 줄이 계속 맞는 그림을 겨누는지 지킨다.
 *
 * html2canvas 는 글자 기준선을 1px GIF(`SMALL_IMAGE`)로 잰다. Tailwind 기본값(img{display:block})을 그 GIF 도 받으면
 * 기준선이 한 줄만큼 어긋나 PDF 의 모든 글자가 아래로 밀리고, 높이가 딱 맞는 칸에서 아래가 잘린다.
 * 고침은 그 GIF 주소만 겨눈 CSS 규칙이라 — html2canvas 를 올려 GIF 주소가 바뀌면 **에러 없이 조용히** 다시 깨진다.
 * 이 테스트가 먼저 깨지게 둔다. 실제로 밀리는지는 브라우저 하니스 `scratchpad/pf/textshift.mjs` 가 잰다(jsdom 은 못 그린다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const front = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(front, p), 'utf-8');

/** html2canvas 가 기준선을 재는 그림 — 앱이 실제로 묶는 파일(module)과 main 둘 다에서 */
function measureImages(): string[] {
  const pkg = JSON.parse(read('node_modules/html2canvas/package.json')) as { main: string; module?: string };
  return [pkg.module, pkg.main].filter((f): f is string => !!f).map((f) => {
    const m = read(join('node_modules/html2canvas', f)).match(/SMALL_IMAGE = '([^']+)'/);
    if (!m) throw new Error(`${f} 에서 SMALL_IMAGE 를 찾지 못했습니다 — html2canvas 의 기준선 재는 방식이 바뀌었는지 볼 것`);
    return m[1]!;
  });
}

describe('html2canvas 기준선 그림 — Tailwind 의 img{display:block} 을 받지 않게', () => {
  const css = read('src/index.css');

  it('index.css 가 html2canvas 의 측정 그림을 정확히 겨눈다', () => {
    const imgs = measureImages();
    expect(new Set(imgs).size).toBe(1);
    const rule = new RegExp(`img\\[src="${imgs[0]!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"\\]\\s*\\{\\s*display:\\s*inline;`);
    expect(css).toMatch(rule);
  });

  it('그 규칙은 @layer 밖에 있다 — 안에 두면 preflight 를 못 이긴다', () => {
    const at = css.indexOf('img[src="data:image/gif');
    expect(at).toBeGreaterThan(0);
    // 규칙 앞까지 중괄호가 다 닫혀 있어야 최상위다
    const before = css.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, '');
    const depth = [...before].reduce((n, ch) => n + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0);
    expect(depth).toBe(0);
  });

  it('다른 img 의 display 는 건드리지 않는다', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|[\s,}])img\s*\{[^}]*display/);
  });
});
