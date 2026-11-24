/**
 * 갤러리 결과물 — 빈 단 정리 (2026-11-25, 규칙 92 보강).
 *
 * 실제로 겪은 것:
 *  - 지원서: 사진 단이 1쪽에서 끝나도 2쪽부터 글이 반 폭에 갇혔다(강윤서 8쪽 중 7쪽의 오른쪽 절반이 비었다)
 *  - 출품 자료: 단체전 120줄 같은 긴 갈래가 한 단만 쪽을 넘어 이어지고 옆 단이 비었다
 *  - 문단 마지막 줄에 '시작한다.' 한 어절만 남는 줄이 데모 38개 문서에 245줄
 * → cvFlow(쪽마다 왼쪽 → 오른쪽) · keepLastTwo(끝 두 어절을 한 조각) · splitToFit(사진 옆에 들어갈 만큼 문장 끝에서)
 * vitest 는 PDF 를 그리지 않는다 — 실제 쪽 모양은 하니스로 본다(scratchpad/output-audit-2026-11).
 */
import { describe, it, expect } from 'vitest';
import { cvFlow, lineCount, approxMeasure, type Measure } from '@/lib/galleryDocs/cvFlow';
import { keepLastTwo, txt, FB_CJK, type Run } from '@/lib/galleryDocs/text';
import { splitToFit } from '@/lib/galleryDocs/submissionDoc';
import { textOf } from './docTestUtils';

/** 글자마다 0.5em — 계산을 손으로 따라갈 수 있게 */
const half: Measure = (t, size) => Array.from(t).length * size * 0.5;

type Col = { stack: { table: { body: unknown[][] } }[] };
const pagesOf = (out: unknown[]) => out.map((p) => (p as { columns: Col[] }).columns.map((c) => c.stack));
const heads = (segs: Col['stack']) => segs.map((s) => textOf(s.table.body[0]![0]));
const years = (segs: Col['stack']) => segs.map((s) => s.table.body.slice(1).map((r) => textOf(r[0])));

describe('lineCount — 어절 단위로 채운다', () => {
  it('폭에 맞춰 줄을 센다 · 줄바꿈은 새 줄 · 한 줄보다 긴 낱말은 안에서 끊긴다', () => {
    expect(lineCount('aaaa bbbb cccc', 100, 10, half)).toBe(1);   // 25 + 25 + 20
    expect(lineCount('aaaa bbbb cccc', 50, 10, half)).toBe(2);    // 'aaaa bbbb' 45 → 'cccc'
    expect(lineCount('aa\nbb', 100, 10, half)).toBe(2);
    expect(lineCount('a'.repeat(30), 50, 10, half)).toBe(3);      // 150pt 낱말 → 세 줄
    expect(lineCount('', 50, 10, half)).toBe(1);
  });

  it('대강 재기 — 한글이 영문보다 넓다', () => {
    expect(approxMeasure('가', 10)).toBeGreaterThan(approxMeasure('a', 10));
    expect(approxMeasure('가', 10, true)).toBeGreaterThan(approxMeasure('가', 10));
  });
});

describe('cvFlow — 약력 두 단을 쪽마다 왼쪽 → 오른쪽으로', () => {
  const rows = (n: number, from = 2000) => Array.from({ length: n }, (_, k) => ({ year: String(from + Math.floor(k / 3)), content: `단체전 ${k + 1}` }));
  const opts = { colW: 240, gap: 30, firstH: 300, pageH: 700, measure: half };

  it('갈래가 다 비었으면 아무것도 없다', () => {
    expect(cvFlow([{ label: '개인전', items: [] }], opts)).toEqual([]);
  });

  it('짧으면 나누지 않고 왼쪽 단에만(아홉 줄짜리 갈래를 두 단으로 쪼개지 않게)', () => {
    const out = cvFlow([{ label: '개인전', items: rows(3) }], opts);
    expect(out).toHaveLength(1);
    const [[left, right]] = pagesOf(out) as [[Col['stack'], Col['stack']]];
    expect(heads(left)).toEqual(['개인전']);
    expect(right).toEqual([]);
  });

  it('한 쪽에 들어가면 갈래 경계에서 반씩 — 갈래를 쪼개지 않는다', () => {
    const out = cvFlow([{ label: '학력', items: rows(6) }, { label: '개인전', items: rows(6) }], opts);
    expect(out).toHaveLength(1);
    const [[left, right]] = pagesOf(out) as [[Col['stack'], Col['stack']]];
    expect(heads(left)).toEqual(['학력']);
    expect(heads(right)).toEqual(['개인전']);
  });

  it("★ 긴 갈래는 쪽마다 두 단을 채우고 넘어간다 — 다음 단 맨 위에 '(계속)'과 연도를 다시", () => {
    const out = cvFlow([{ label: '개인전', items: rows(3) }, { label: '단체전', items: rows(120) }], opts);
    const pages = pagesOf(out);
    expect(pages.length).toBeGreaterThan(2);
    // 마지막 쪽 말고는 오른쪽 단이 비지 않는다(예전엔 한 단만 이어졌다)
    pages.slice(0, -1).forEach(([, right], k) => expect(right!.length, `쪽 ${k + 1}`).toBeGreaterThan(0));
    // 첫 묶음은 지금 쪽에서, 그 뒤는 새 쪽에서
    expect((out[0] as { pageBreak?: string }).pageBreak).toBeUndefined();
    out.slice(1).forEach((p) => expect((p as { pageBreak?: string }).pageBreak).toBe('before'));
    // 이어지는 단의 머리는 '단체전  (계속)' · 맨 위 줄에 연도를 다시 쓴다(같은 해라 비워 둔 줄이어도)
    const allSegs = pages.flat().flat();
    expect(heads(allSegs).filter((h) => h === '단체전')).toHaveLength(1);
    expect(heads(allSegs).filter((h) => h.includes('(계속)')).length).toBe(allSegs.length - 2);
    allSegs.forEach((s) => expect(years([s])[0]![0]).toMatch(/^\d{4}$/));
    // 줄은 빠짐도 겹침도 없다
    const contents = allSegs.flatMap((s) => s.table.body.slice(1).map((r) => textOf(r[1])));
    expect(contents).toEqual([...rows(3), ...rows(120)].map((r) => r.content));
  });

  it('시작 쪽에 머리 + 한 줄도 안 들어가면 다음 쪽 맨 위에서 시작한다', () => {
    const out = cvFlow([{ label: '개인전', items: rows(3) }], { ...opts, firstH: 30 });
    expect((out[0] as { pageBreak?: string }).pageBreak).toBe('before');
  });

  it('표 머리는 쪽이 넘어가도 다시 나오고 머리만 쪽 끝에 남지 않는다(추정이 빗나갔을 때의 안전망)', () => {
    const out = cvFlow([{ label: '단체전', items: rows(40) }], opts);
    const t = (pagesOf(out)[0]![0]![0] as unknown as { table: { headerRows: number; keepWithHeaderRows: number; dontBreakRows: boolean } }).table;
    expect([t.headerRows, t.keepWithHeaderRows, t.dontBreakRows]).toEqual([1, 1, true]);
  });
});

describe('keepLastTwo — 문단 끝 두 어절을 한 조각으로', () => {
  const runsOf = (c: unknown) => (c as { text: Run[] }).text;
  const last = (r: Run[]) => r[r.length - 1]!;

  it("마지막 줄에 한 어절만 남지 않게 — 끝 두 어절을 noWrap 한 조각으로(noNewLine 으로 묶지 않는다)", () => {
    const r = runsOf(keepLastTwo(txt('색이 비치면 화면이 숨을 쉬기 시작한다.')));
    expect(last(r)).toEqual({ text: '쉬기 시작한다.', noWrap: true });
    expect(r.map((x) => x.text).join('')).toBe('색이 비치면 화면이 숨을 쉬기 시작한다.');
  });

  it('문단 안 줄바꿈마다 따로 · 세 어절 미만 · 긴 마지막 어절 · 대체 글꼴 조각은 그대로', () => {
    const two = runsOf(keepLastTwo(txt('첫 줄의 끝 두 어절\n둘째 줄도 끝 두 어절')));
    expect(two.filter((x) => x.text.includes(' 어절')).map((x) => x.text)).toEqual(['두 어절', '두 어절']);
    expect(runsOf(keepLastTwo(txt('두 어절'))).map((x) => x.text)).toEqual(['두 ', '어절']);
    expect(last(runsOf(keepLastTwo(txt('세 어절 가나다라마바사아자차')))).text).toBe('가나다라마바사아자차');
    const han = runsOf(keepLastTwo(txt('나의 첫 개인展')));
    expect(han.some((x) => x.font === FB_CJK)).toBe(true);
    expect(han.map((x) => x.text).join('')).toBe('나의 첫 개인展');
    expect(han.find((x) => x.text.includes('첫 개인'))).toBeUndefined();
  });
});

describe('splitToFit — 사진 옆에 들어갈 만큼, 되도록 문장 끝에서', () => {
  const text = '첫 문장은 짧다. 둘째 문장은 조금 더 길게 이어진다. 셋째 문장이 마지막이다.';

  it('허용 줄 수 안에서 문장 끝에서 자르고, 앞뒤를 이으면 원문', () => {
    const lineH = 10 * 1.1929 * 1.75;
    const [head, rest] = splitToFit(text, 80, lineH * 2, 10, 1.75, half);
    expect(head.endsWith('.')).toBe(true);
    expect(`${head} ${rest}`).toBe(text);
    expect(lineCount(head, 80, 10, half)).toBeLessThanOrEqual(2);
  });

  it('다 들어가면 통째로 · 한 줄도 안 들어가면 전부 뒤로', () => {
    expect(splitToFit(text, 1000, 100, 10, 1.75, half)).toEqual([text, '']);
    expect(splitToFit(text, 80, 5, 10, 1.75, half)).toEqual(['', text]);
  });
});
