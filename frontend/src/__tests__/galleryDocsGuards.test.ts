/**
 * 갤러리 결과물 — 소스를 훑는 가드 (2026-11-24, 규칙 92).
 * 문서가 다시 '쪽 그림 한 장'(html2canvas)으로 돌아가거나, 글꼴을 바꾸고 글자 범위 표를 안 고치거나,
 * pdfmake(0.9MB)가 모든 방문자에게 미리 받아지는 일을 막는다 — 셋 다 화면으로는 멀쩡해 보인다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PRETENDARD_RANGES } from '@/lib/galleryDocs/glyphCoverage';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('갤러리 문서는 글자가 살아 있는 PDF', () => {
  it('출품 자료·작품 리스트·정산서·지원서는 pdfmake 로 만든다 — 쪽을 그림으로 찍지 않는다', () => {
    const src = read('src/lib/operationPdf.ts');
    const imports = /(?:from\s+|import\()\s*['"](?:html2canvas|jspdf)['"]/;
    expect(src).not.toMatch(imports);
    expect(src).not.toMatch(/function (?:computePageCuts|htmlToPdfBlob)\b/);
    // 그리는 쪽(pdfmake·글꼴)은 누를 때 받는다 — 운영 화면 청크에 정적으로 묶지 않는다
    expect(src).toContain("import('./galleryDocs/render')");
    expect(src).not.toMatch(/from '\.\/galleryDocs\/render'/);
    for (const f of ['workList', 'submissionDoc', 'settlementDoc', 'applicationDoc', 'cvFlow']) {
      expect(read(`src/lib/galleryDocs/${f}.ts`), f).not.toMatch(imports);
      expect(read(`src/lib/galleryDocs/${f}.ts`), f).not.toMatch(/\bdocument\./);   // 빌더는 순수 함수(브라우저 일은 render.ts)
    }
  });

  it('도록은 전용 조판 — 포트폴리오 엔진을 작가마다 이어 붙이지 않는다(105쪽·빈 쪽 17쪽이 났다)', () => {
    const src = read('src/lib/boothKit.ts');
    expect(src).not.toMatch(/buildPortfolioPages|folioStart|skipContact/);
    expect(read('src/lib/portfolioFormats.ts')).not.toMatch(/folioStart\?:|skipContact\?:|runningHead\?:/);
  });

  it('pdfmake 는 누를 때만 받는다 — 이름을 붙인 청크로 떼고 PWA 미리받기에서 뺀다', () => {
    const vite = read('vite.config.ts');
    expect(vite).toMatch(/node_modules\/pdfmake\/'\)\)\) return 'assets\/pdfmake-\[name\]-\[hash\]\.js'/);
    expect(vite).toContain("'**/pdfmake-*.js'");
    expect(read('src/lib/galleryDocs/render.ts')).toContain("import('pdfmake/build/pdfmake')");
  });

  it('메뉴 이름은 규칙 59 의 말 — 출품 자료(작가 자료·제출 자료라 부르지 않는다)', () => {
    const src = read('src/hooks/useSubmissionDownloads.ts');
    for (const s of ['작품 캡션(HWP)', '작품 리스트(PDF)', '작품 리스트(엑셀)', '출품 자료 PDF(ZIP)', '작품 원본(ZIP)']) expect(src).toContain(s);
    expect(src).not.toMatch(/작가 자료|제출 자료 PDF|전체제출물/);
  });
});

describe('Pretendard 글자 범위 표 = 글꼴 파일', () => {
  it('보통·굵게 두 파일이 다 가진 글자와 표가 같다(글꼴을 바꾸면 표도 다시 뽑을 것)', () => {
    const regular = join(ROOT, 'src/assets/fonts/Pretendard-Regular.otf');
    const bold = join(ROOT, 'src/assets/fonts/Pretendard-Bold.otf');
    expect(existsSync(regular) && existsSync(bold) && existsSync(join(ROOT, 'src/assets/fonts/Pretendard-OFL.txt'))).toBe(true);
    const fontkit = createRequire(join(ROOT, 'package.json'))('fontkit') as { openSync: (p: string) => { characterSet: number[] } };
    const B = new Set(fontkit.openSync(bold).characterSet);
    const cps = [...new Set(fontkit.openSync(regular).characterSet)].filter((c) => B.has(c) && c >= 32).sort((x, y) => x - y);
    const ranges: [number, number][] = [];
    for (const c of cps) { const last = ranges[ranges.length - 1]; if (last && c === last[1] + 1) last[1] = c; else ranges.push([c, c]); }
    expect(ranges).toEqual(PRETENDARD_RANGES.map((r) => [...r]));
  });
});
