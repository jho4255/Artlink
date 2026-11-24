/**
 * PDF 문서의 글자 (2026-11-24, 규칙 92) — 낱말 단위 줄바꿈 + 한자·이모지 대체 글꼴.
 *
 * 갤러리 결과물(작품 리스트·출품 자료·정산서·지원서)은 pdfmake 로 **글자가 글자로 남는 PDF** 를 만든다.
 * 예전엔 화면을 찍어 붙인 그림이라 글자를 복사·검색할 수 없었다. 대신 두 가지를 우리가 챙겨야 한다.
 *
 * 1. **줄바꿈은 낱말 단위(keep-all)** — pdfmake 의 줄 나누기(UAX#14)는 한글 음절 사이를 끊을 수 있는 자리로 본다.
 *    그대로 두면 '사건 / 은' 처럼 낱말이 쪼개지고, 양쪽 맞춤이 음절 사이를 벌려 「머 무 는 빛」이 된다.
 *    그래서 공백까지를 한 낱말로 묶어 `noWrap` 으로 넘긴다. 다만 **공백 없이 이어 쓴 긴 글**(실서버 작가노트 432자 무공백)은
 *    묶으면 칸 밖으로 나가므로 `KEEP_WORD_MAX` 자를 넘는 낱말은 묶지 않는다 — pdfmake 가 칸 폭에서 끊어 준다
 *    (화면의 `break-keep [overflow-wrap:anywhere]` 와 같은 규칙, 규칙 30).
 * 2. **Pretendard 에 없는 글자** — 한자(실서버 출품 자료의 32% 에 있다: 개인展·猫)·이모지는 대체 글꼴로 돌린다.
 *    글자마다 어느 글꼴인지 `glyphCoverage.ts` 로 가르고, 대체 글꼴은 문서를 만들 때 **그 글자만** 받아 심는다(render.ts).
 *    한 낱말 안에서 글꼴이 바뀌면(개인 + 展) 조각 사이에서 줄이 끊기지 않게 `noNewLine` 으로 붙인다.
 */
import type { Content } from 'pdfmake/interfaces';
import { pretendardHas } from './glyphCoverage';

/** 본문 글꼴 — render.ts 가 이 이름으로 Pretendard 를 등록한다 */
export const FONT = 'Pretendard';
/** 대체 글꼴 — 한자 등(구글 Noto Sans KR 에서 쓰인 글자만) */
export const FB_CJK = 'FbCjk';
/** 대체 글꼴 — 이모지(구글 Noto Emoji, 흑백) */
export const FB_EMOJI = 'FbEmoji';

/** 이 글자 수 이하인 낱말은 안에서 끊지 않는다 */
export const KEEP_WORD_MAX = 14;

const EMOJI = /\p{Extended_Pictographic}/u;

/** pdfmake 의 글자 조각 — `noNewLine` 은 타입에 없는 내부 속성이다(다음 조각과 같은 줄에 붙인다) */
export interface Run {
  text: string;
  font?: string;
  noWrap?: boolean;
  noNewLine?: boolean;
  bold?: boolean;
}

/**
 * 문서에 싣기 전 글자 정리 — 내용은 바꾸지 않고 **그릴 수 없는 것만** 덜어낸다.
 *  - 줄바꿈 통일(\r\n·U+2028·U+2029 → \n), 탭 → 공백
 *  - 이모지 변형 선택자(U+FE0E·FE0F)·결합자(U+200D) — 혼자서는 그리는 글자가 없고 빈칸·네모로 찍힌다
 *  - 그 밖의 제어 문자
 */
export function cleanText(s: unknown): string {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

/** 이 글자를 그릴 글꼴 — 없으면 본문 글꼴 */
function fontOf(ch: string): string | undefined {
  const cp = ch.codePointAt(0)!;
  if (pretendardHas(cp)) return undefined;
  return EMOJI.test(ch) ? FB_EMOJI : FB_CJK;
}

/**
 * 글 → pdfmake 글자 조각 배열.
 * @param maxWord 이보다 긴 낱말은 칸 폭에서 끊는다(좁은 칸은 더 작게 줄 것 — 예: 표의 '크기' 칸)
 */
export function runs(s: unknown, opts: { bold?: boolean; maxWord?: number } = {}): Run[] {
  const maxWord = opts.maxWord ?? KEEP_WORD_MAX;
  const text = cleanText(s);
  const out: Run[] = [];
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    if (li > 0) out.push({ text: '\n' });
    // 공백까지를 한 낱말로 — '사건은 ' · '없지만 '
    const tokens = line.split(/(?<=\s)(?=\S)/u).filter((t) => t.length > 0);
    for (const token of tokens) {
      const chars = Array.from(token);
      const keep = chars.filter((c) => !/\s/u.test(c)).length <= maxWord;
      // 글꼴이 같은 글자끼리 조각으로. 공백은 늘 본문 글꼴 — 대체 글꼴은 쓰인 글자만 받으므로 공백이 없을 수 있다
      const pieces: { text: string; font?: string }[] = [];
      for (const c of chars) {
        const f = /\s/u.test(c) ? undefined : fontOf(c);
        const last = pieces[pieces.length - 1];
        if (last && last.font === f) last.text += c;
        else pieces.push({ text: c, font: f });
      }
      pieces.forEach((p, i) => {
        const run: Run = { text: p.text };
        if (p.font) run.font = p.font;
        if (opts.bold) run.bold = true;
        if (keep) {
          run.noWrap = true;
          // 한 낱말 안에서 글꼴이 바뀌는 자리 — 다음 조각과 같은 줄에
          if (i < pieces.length - 1) run.noNewLine = true;
        }
        out.push(run);
      });
    }
  });
  return out.length ? out : [{ text: '' }];
}

/** 글 한 덩어리 — `{ text: runs(...) , ...style }` */
export function txt(s: unknown, style: Record<string, unknown> = {}, opts: { maxWord?: number } = {}): Content {
  return { text: runs(s, { bold: style.bold === true, maxWord: opts.maxWord }) as never, ...style } as Content;
}

/**
 * 문단 나누기 — 작가가 친 그대로 지킨다. 빈 줄이 문단 사이, 한 줄 바꿈은 문단 안 줄바꿈.
 * (포트폴리오 PDF 는 줄을 잇는 규칙이 있지만(규칙 45b) 갤러리가 받는 출품 자료는 작가가 낸 원문 그대로가 맞다)
 */
export function paragraphs(s: unknown): string[] {
  return cleanText(s)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, '').replace(/[ \t]+$/gm, ''))
    .filter((p) => p.trim().length > 0);
}

/**
 * 문서 정의에서 대체 글꼴로 그릴 글자를 모은다 — render.ts 가 이 글자만 받아 심는다.
 * 머리말·꼬리말처럼 함수로 만드는 조각은 `extras` 로 따로 넘긴다(정의 안에는 함수만 있다).
 */
export function collectFallbackChars(...nodes: unknown[]): { cjk: string; emoji: string } {
  const cjk = new Set<string>();
  const emoji = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const o = n as Record<string, unknown>;
    if (typeof o.text === 'string' && (o.font === FB_CJK || o.font === FB_EMOJI)) {
      const bucket = o.font === FB_CJK ? cjk : emoji;
      for (const c of Array.from(o.text)) if (!/\s/u.test(c)) bucket.add(c);
    }
    for (const k of Object.keys(o)) {
      if (k === 'image') continue; // 그림 데이터는 건너뛴다
      walk(o[k]);
    }
  };
  nodes.forEach(walk);
  const sorted = (s: Set<string>) => Array.from(s).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join('');
  return { cjk: sorted(cjk), emoji: sorted(emoji) };
}
