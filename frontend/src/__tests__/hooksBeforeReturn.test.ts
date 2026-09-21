/**
 * 훅은 early return 위에 — 소스 가드 (2026-09-21)
 *
 * `if (isLoading) return <스켈레톤/>` 아래에 `useMemo`·`useState`·커스텀 훅을 두면 컴파일도 테스트(jsdom 은 로딩 분기를
 * 잘 안 지난다)도 통과하는데, 실제로는 **데이터가 도착하는 순간** 훅 개수가 늘어 React #310 이 나고 ErrorBoundary 가
 * "화면을 불러오지 못했어요"를 띄운다. 2026-09-19 배포에서 `PortfolioPage`(작가 홈페이지)와 `MyPage` 홈페이지 편집 탭이
 * 정확히 그렇게 실서버에서 통째로 죽었다. 발견은 사용자 신고였다 — 그래서 소스를 훑는다.
 *
 * 규칙(휴리스틱): 컴포넌트 본문 최상위(들여쓰기 2칸)에서 `if (...) return` 이 한 번 나온 뒤에는
 * 같은 들여쓰기의 `useXxx(` 호출이 있으면 실패. 조건부 훅이 정당한 경우는 없다(React 규칙).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const COMPONENT_START = /^(export default |export )?(async )?function [A-Z]\w*\(|^(export )?const [A-Z]\w* = (\(|React\.memo|memo\(|forwardRef)/;
const EARLY_RETURN = /^  if \(.*\) return\b/;
const HOOK_CALL = /^  (?:(?:const|let) [^=]+= )?(?:use[A-Z]\w*)\(/;

describe('훅은 early return 위에 있어야 한다', () => {
  const files = [...walk(join(__dirname, '../pages')), ...walk(join(__dirname, '../components'))];
  it('pages/·components/ 전수 — early return 뒤의 최상위 훅 호출 0건', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf-8').split('\n');
      let returnAt: number | null = null;
      lines.forEach((line, idx) => {
        if (COMPONENT_START.test(line)) returnAt = null;
        else if (returnAt === null && EARLY_RETURN.test(line)) returnAt = idx + 1;
        else if (returnAt !== null && HOOK_CALL.test(line)) offenders.push(`${f.replace(/.*\/src\//, 'src/')}:${idx + 1} (early return at ${returnAt}) ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
