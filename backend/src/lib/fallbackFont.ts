/**
 * PDF 문서의 대체 글꼴 — 한자·이모지를 **쓰인 글자만** 담은 작은 글꼴로 (2026-11-24, 규칙 92).
 *
 * 갤러리 결과물 PDF(작품 리스트·출품 자료·정산서·지원서)는 브라우저에서 pdfmake 로 만들고 Pretendard 를 심는다.
 * Pretendard 에는 한자·이모지가 없는데 실서버 출품 자료의 32%·지원서의 22% 에 한자가 있다(개인展·猫).
 * 한자까지 든 글꼴은 수 MB 라 통째로 내려줄 수 없어, 구글 글꼴의 `text=`(그 글자만 담은 글꼴)를 쓴다.
 *
 * ⚠️ 브라우저가 구글에 직접 물으면 WOFF2 가 오는데, pdfmake 의 글꼴 엔진(fontkit)은 WOFF2 를 심으면 **글자 모양이 빈 채로**
 *    나온다(2026-11-24 실측 — 글자는 복사되는데 화면엔 빈칸). TTF 를 받으려면 요청의 User-Agent 를 바꿔야 하고
 *    브라우저는 그걸 못 바꾼다. 그래서 서버가 대신 받아 TTF 를 그대로 내려준다.
 * ⚠️ 보내는 것은 **글자 모음뿐**(정렬·중복 제거한 한자/이모지 몇 개) — 문장·이름·작품명은 보내지 않는다.
 */

/** 대체 글꼴 묶음 → 구글 글꼴 이름 */
export const FALLBACK_SETS = { cjk: 'Noto Sans KR', emoji: 'Noto Emoji' } as const;
export type FallbackSet = keyof typeof FALLBACK_SETS;
export const FALLBACK_WEIGHTS = [400, 700] as const;
/** 한 번에 받는 글자 수 — 공모 하나의 한자를 다 합쳐도 대개 수십 자다 */
export const FALLBACK_MAX_CHARS = 600;
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 8000;

/**
 * 받은 글자 → 대체 글꼴로 물을 글자 모음. ASCII·공백·제어 문자는 뺀다(본문 글꼴에 있다).
 * 비었거나 너무 길면 null(400).
 */
export function cleanFallbackText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const set = new Set<string>();
  for (const ch of Array.from(raw)) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || /\s/u.test(ch) || (cp >= 0xD800 && cp <= 0xDFFF)) continue;
    set.add(ch);
  }
  if (set.size === 0 || set.size > FALLBACK_MAX_CHARS) return null;
  return Array.from(set).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join('');
}

/** 글꼴 파일인가 — TrueType(00 01 00 00 · 'true') 또는 OpenType('OTTO') */
export function looksLikeFont(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const tag = buf.readUInt32BE(0);
  return tag === 0x00010000 || tag === 0x74727565 || tag === 0x4f54544f;
}

// 같은 글자 모음은 서버 메모리에 잠깐 둔다 — 같은 공모의 문서를 여러 번 받을 때 구글에 다시 묻지 않게
const cache = new Map<string, Buffer>();
const CACHE_MAX = 200;

export async function fetchFallbackFont(set: FallbackSet, weight: number, text: string): Promise<Buffer> {
  const key = `${set}:${weight}:${text}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }

  const family = encodeURIComponent(FALLBACK_SETS[set]);
  const cssRes = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`, {
    // ⚠️ 이 값이어야 TTF 가 온다(최신 브라우저 값이면 WOFF2) — 위 머리말
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!cssRes.ok) throw new Error(`font css ${cssRes.status}`);
  const css = await cssRes.text();
  const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/.exec(css)?.[1];
  if (!url) throw new Error('font url missing');
  const fontRes = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!fontRes.ok) throw new Error(`font ${fontRes.status}`);
  const buf = Buffer.from(await fontRes.arrayBuffer());
  if (buf.length > MAX_BYTES || !looksLikeFont(buf)) throw new Error('not a font');

  cache.set(key, buf);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return buf;
}

/** 테스트용 — 서버 메모리 글꼴을 비운다 */
export function clearFallbackFontCache(): void {
  cache.clear();
}
