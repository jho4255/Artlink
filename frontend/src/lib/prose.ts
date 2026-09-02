/**
 * 작가가 손으로 넣은 줄바꿈 정리 (rule-based, AI 없음)
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────
 * 작가들은 약력·작가노트를 **문장마다 엔터를 쳐서** 저장한다. 실데이터가 그렇다.
 *
 *   작가B  31자 / 101자 / 77자 / 106자   ← 문장마다 줄바꿈
 *
 * 이걸 `whitespace-pre-wrap` 으로 그대로 그리면, 각 문장의 마지막 줄이 화면 폭을 못 채워
 * **문단 오른쪽이 계단처럼 들쭉날쭉해진다**. 작가가 쓴 폭과 보는 사람의 화면 폭이 다르니 당연하다.
 *
 * 그렇다고 줄바꿈을 전부 없애면 안 된다. 이력은 줄바꿈이 **정보**다.
 *
 *   작가A  24자 / 20자 / 6자 / 18자 / 15자   ← 이력 한 줄씩. 이어붙이면 뭉개진다
 *
 * ── 어떻게 구분하나 ──────────────────────────────────────────
 * 실데이터에서 두 종류는 신호가 뚜렷하게 갈린다.
 *
 *   산문 : 줄이 길고(평균 25자↑) 종결어미(`다.` `습니다.` `.` `!` `?`)로 끝난다
 *   목록 : 줄이 짧고 연도/기호로 시작하거나 종결부호 없이 끝난다
 *
 * 그래서 **문단 단위로 판정**한다. 한 사람의 글에 둘이 섞여 있어도(최금곤: 제목 + 항목 + 산문)
 * 문단마다 따로 판정하므로 각자 맞게 처리된다.
 *
 * ⚠️ 원본을 고치지 않는다. 저장은 그대로 두고 **보여줄 때만** 정리한다.
 *    작가가 다시 편집할 때는 자기가 쓴 그대로 보여야 한다.
 * ⚠️ 빈 줄(문단 구분)은 언제나 보존한다. 문단은 작가의 명확한 의도다.
 */

/** 문장이 끝났다고 볼 만한 마무리 — 문장부호(뒤에 닫는 따옴표·괄호가 붙어도 인정) */
const SENTENCE_END = /[.!?。…]["'”’)\]]*\s*$/;

/** 이력 항목처럼 보이는 시작 — 연도, 목록기호, 대괄호 제목 */
const LIST_START = /^\s*(?:[-–—•·※*]|\d{4}[.\s)]|['’]\d{2}[.\s)]|\(?\d+\)|\[)/;

/**
 * 문단 안의 줄들이 '목록'인지 판정한다.
 *
 * 판정 순서가 중요하다. 처음엔 "평균 25자 미만이면 목록"을 맨 앞에 뒀는데,
 * 짧은 문장 두 개짜리 산문("첫 문장입니다. / 두 번째 문장입니다.")까지 목록으로 잡혀 안 합쳐졌다.
 * **문장부호로 끝나는지**가 길이보다 훨씬 강한 신호라, 그걸 먼저 본다.
 *
 * 애매하면 목록으로 판정한다 — 이력을 한 줄로 뭉개는 쪽이 더 나쁜 실수다.
 */
function looksLikeList(lines: string[]): boolean {
  if (lines.length < 2) return true;          // 한 줄짜리는 건드릴 것도 없다
  const n = lines.length;
  const half = Math.ceil(n / 2);

  // ① 연도·목록기호로 시작하는 줄이 절반 이상 → 이력
  if (lines.filter((l) => LIST_START.test(l)).length >= half) return true;

  // ② 문장부호 없이 끝나는 줄이 절반 이상 → 이력 (작가A: '선정' '석사수료' '전공' …)
  const unfinished = lines.filter((l) => !SENTENCE_END.test(l.trim())).length;
  if (unfinished >= half) return true;

  // ③ 여기까지 왔으면 대부분 문장으로 끝난다. 다만 아주 짧은 줄들은
  //    '회화.' '조각.' 처럼 마침표를 찍은 항목 나열일 수 있다
  const avg = lines.reduce((s, l) => s + l.trim().length, 0) / n;
  if (avg < 12) return true;

  return false;
}

/**
 * 두 줄을 이을 때 사이에 무엇을 넣을지.
 * 한국어에서 엔터는 보통 어절 사이에서 눌리므로 공백이 맞다.
 * 다만 앞 줄이 이미 공백으로 끝났거나, 여는/닫는 괄호처럼 붙어야 하는 경우는 그대로 둔다.
 */
function joiner(prev: string, next: string): string {
  if (!prev || !next) return '';
  if (/\s$/.test(prev)) return '';
  // 앞 줄이 하이픈으로 끝나면 단어가 잘린 것 — 붙인다
  if (/[-–—]$/.test(prev)) return '';
  return ' ';
}

/**
 * 보여줄 용도로 줄바꿈을 정리한다.
 *
 * @param text 작가가 저장한 원문
 * @returns 문단은 `\n\n`, 목록 문단 안의 줄바꿈은 `\n` 으로 유지된 문자열
 */
export function reflowProse(text: string | null | undefined): string {
  if (!text) return '';
  // 윈도우 줄바꿈 정규화 + 줄 끝 공백 제거(문단 판정이 흔들리지 않게)
  const norm = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');

  // 빈 줄 하나 이상 = 문단 구분
  const paragraphs = norm.split(/\n{2,}/);

  const out = paragraphs.map((para) => {
    const lines = para.split('\n').filter((l, i, a) => !(l.trim() === '' && (i === 0 || i === a.length - 1)));
    if (lines.length === 0) return '';
    if (looksLikeList(lines)) return lines.join('\n');

    // 산문 — 손으로 넣은 줄바꿈을 없애 한 문단으로 흐르게 한다
    let joined = lines[0]!.trim();
    for (let i = 1; i < lines.length; i++) {
      const next = lines[i]!.trim();
      if (!next) continue;
      joined += joiner(joined, next) + next;
    }
    return joined;
  }).filter((p) => p !== '');

  return out.join('\n\n');
}

/**
 * 정리 결과가 원문과 다른지 — 편집 화면에서 "이렇게 보입니다" 미리보기를 띄울지 판단할 때 쓴다.
 */
export function willReflow(text: string | null | undefined): boolean {
  if (!text) return false;
  return reflowProse(text) !== text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}
