/**
 * 별점이 화면으로 **되돌아오지 않게** 소스를 감시한다 (2026-09-10)
 *
 * ## 왜 소스를 훑는가
 * 별점은 기능이 아니라 **없어진 것**이라, 사라졌다는 사실을 확인할 렌더 테스트가 없다.
 * 그런데 되살아나기는 아주 쉽다 —
 *   · `Gallery.rating` 컬럼이 **DB 에 그대로 남아 있고**(옛 값이 든 채로 동결)
 *   · 갤러리 목록·상세 API 는 모델을 통째로 내려주므로 응답에도 `rating` 이 실려 있다
 * 그래서 누가 `{gallery.rating}` 한 줄만 적으면 **몇 달 전 평균이 아무 경고 없이 화면에 뜬다**.
 * 타입에서 뺐지만 `any` 를 한 번만 거치면 그 방어도 지나간다(이 저장소는 `as any` 가 흔하다).
 *
 * `retiredApis.test.ts` 가 옛 API 주소를 소스로 감시하는 것과 같은 방식이다.
 *
 * ⚠️ 별(Star) 아이콘 자체는 금지가 아니다 — 엽서 대표작·하이라이트·이달의 갤러리 메뉴가 쓴다.
 *    금지하는 건 **별점 값을 그리는 것**이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  // 주석은 뺀다 — "별점을 없앴다" 라고 적어 둔 설명까지 걸리면 가드가 잔소리가 된다
  code: readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, ''),
}));

describe('별점 UI 되살아나기 방지', () => {
  it('테스트가 실제 소스를 읽고 있다 (경로가 틀리면 이 가드는 늘 통과한다)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.path.includes('GalleriesPage'))).toBe(true);
  });

  /** `gallery.rating` · `g.rating` · `item.gallery.rating` … 어떤 모양이든 값을 읽으면 잡는다 */
  it('★ 어디서도 rating 값을 읽지 않는다', () => {
    const offenders = files
      .filter((f) => /\.rating\b/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `별점 값을 읽는 곳: ${offenders.join(', ')}`).toEqual([]);
  });

  /** 필터·정렬도 함께 없앴다 — 서버가 무시하므로 눌러도 아무 일이 없는 '고장난 컨트롤'이 된다 */
  it('★ minRating 필터 · sortBy=rating 정렬을 다시 만들지 않는다', () => {
    const offenders = files
      .filter((f) => /minRating|minGalleryRating|sortBy === 'rating'|'sortBy', 'rating'/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `별점 필터·정렬이 남은 곳: ${offenders.join(', ')}`).toEqual([]);
  });

  it("★ 리뷰를 보낼 때 rating 을 실어 보내지 않는다 (서버가 안 받는다)", () => {
    const offenders = files
      .filter((f) => /\brating:\s*(reviewRating|\d)/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `리뷰 payload 에 별점이 남은 곳: ${offenders.join(', ')}`).toEqual([]);
  });
});
