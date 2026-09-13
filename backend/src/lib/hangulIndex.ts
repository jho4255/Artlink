/**
 * 이름을 **ㄱ·ㄴ·ㄷ… 색인 칸**으로 나눈다 (2026-09-13)
 *
 * [작가] 탭(`/artists`)의 왼쪽 목록이 전화번호부처럼 초성별로 접히고 펼쳐지려면, 이름마다
 * "어느 칸에 들어가는가"가 필요하다. 그 판정을 여기 한 곳에서만 한다.
 *
 * ## 왜 서버에서 정하나
 * 순서(가나다순)와 칸(초성)이 **어긋나면 안 되기 때문**이다. 화면이 따로 초성을 계산하면
 * 정렬은 서버가, 묶기는 화면이 하게 되어 규칙이 둘이 된다 — 한쪽만 고치는 순간 'ㄱ' 칸 안에
 * 'ㄴ' 이름이 섞이거나, 같은 칸이 목록에 두 번 나타난다. 서버가 **칸 순서 → 이름순**으로
 * 정렬해서 `initial` 과 함께 내려주면 화면은 **이어진 같은 값끼리 묶기만** 하면 된다.
 *
 * ⚠️ **DB 정렬(`orderBy`)에 맡기지 말 것** — Postgres 기본 콜레이션은 한글 자모 순서를
 *    보장하지 않아 서버 로케일에 따라 목록이 달라진다(랜덤 정렬 시절에도 같은 이유로 여기서 정했다).
 */

/** 유니코드 완성형 한글 첫 글자 `가` */
const HANGUL_BASE = 0xac00;
/** 완성형 한글 마지막 글자 `힣` */
const HANGUL_LAST = 0xd7a3;
/** 초성 하나가 거느리는 글자 수 = 중성 21 × 종성 28 */
const SYLLABLES_PER_CHOSEONG = 588;

/** 완성형 한글의 초성 19개 (유니코드가 정한 순서 그대로 — 바꾸면 계산이 깨진다) */
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/**
 * 쌍자음은 제 홑자음 칸에 넣는다 — 색인은 **14칸**이다.
 * 국어사전·전화번호부 어디에도 'ㄲ' 칸은 없다. 따로 두면 '까치'를 찾으려고 'ㄱ' 을 펼쳤다가
 * 없어서 되돌아 나와야 한다.
 */
const FOLD_DOUBLE: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

/** 한글이 아닌 이름이 갈 곳 둘 — 라틴 문자는 `A–Z`, 나머지(숫자·기호·한자·가나…)는 `#` */
export const LATIN_BUCKET = 'A–Z';
export const OTHER_BUCKET = '#';

/**
 * 색인 칸의 **순서**. 화면의 위에서 아래 순서가 곧 이것이다.
 * 한글 14칸이 먼저, 그다음 라틴, 마지막이 나머지 — 한국어 서비스의 관례다.
 */
export const INITIAL_ORDER: readonly string[] = [
  'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  LATIN_BUCKET,
  OTHER_BUCKET,
];

const ORDER_INDEX = new Map(INITIAL_ORDER.map((k, i) => [k, i]));

/**
 * 이름이 들어갈 색인 칸을 돌려준다.
 *
 * ⚠️ 첫 글자를 `name[0]` 으로 떼지 말 것 — 이모지처럼 **서로게이트 쌍**인 글자는 반쪽만 잘려
 *    깨진 코드포인트가 나온다. 전개 연산자가 코드포인트 단위로 끊는다.
 */
export function initialOf(name: string): string {
  const first = [...(name ?? '').trim()][0];
  if (!first) return OTHER_BUCKET;

  const code = first.codePointAt(0)!;

  // ① 완성형 한글 (가~힣) — 초성을 계산해서 쓴다
  if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
    const cho = CHOSEONG[Math.floor((code - HANGUL_BASE) / SYLLABLES_PER_CHOSEONG)]!;
    return FOLD_DOUBLE[cho] ?? cho;
  }

  // ② 자음 한 글자로 시작하는 이름 ('ㄱ작가' 같은). 호환 자모(ㄱ~ㅎ)와 첫가끝 자모(ᄀ~ᄒ) 둘 다 받는다 —
  //    입력기·붙여넣기에 따라 어느 쪽이든 들어올 수 있고, 눈으로는 구분이 안 된다.
  if (code >= 0x3131 && code <= 0x314e) {
    const jamo = String.fromCodePoint(code);
    const folded = FOLD_DOUBLE[jamo] ?? jamo;
    // 모음(ㅏ~ㅣ)은 위 범위 밖이고, 'ㅄ' 같은 겹받침 자모는 색인 칸이 아니라 여기서 걸러진다
    return ORDER_INDEX.has(folded) ? folded : OTHER_BUCKET;
  }
  if (code >= 0x1100 && code <= 0x1112) {
    const cho = CHOSEONG[code - 0x1100]!;
    return FOLD_DOUBLE[cho] ?? cho;
  }

  // ③ 라틴 문자 — 대소문자를 한 칸에 넣는다(대문자 칸/소문자 칸이 따로 있으면 찾을 수가 없다)
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return LATIN_BUCKET;

  // ④ 숫자·기호·한자·가나 …
  return OTHER_BUCKET;
}

/**
 * **칸 순서 → 이름순**으로 정렬한다(원본 배열은 건드리지 않는다).
 *
 * ⚠️ 이름이 같을 때 `id` 로 한 번 더 가른다 — 안 그러면 DB 가 돌려준 순서가 그대로 남아
 *    같은 요청에도 목록이 미묘하게 달라진다(동명이인이 실제로 있다).
 */
export function sortByInitialThenName<T extends { id: number; name: string }>(
  items: readonly T[],
): (T & { initial: string })[] {
  return items
    .map((it) => ({ ...it, initial: initialOf(it.name) }))
    .sort(
      (a, b) =>
        ORDER_INDEX.get(a.initial)! - ORDER_INDEX.get(b.initial)! ||
        a.name.localeCompare(b.name, 'ko') ||
        a.id - b.id,
    );
}
