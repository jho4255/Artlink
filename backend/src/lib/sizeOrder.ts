/**
 * 작품 크기 표기 순서 — **세로×가로**(높이 먼저) 로 맞춘다 (2026-09-16, 사용자 결정).
 *
 * 국내(현대미술의 이해 "세로×가로"·월간미술)·해외(Chicago "height, width, depth") 관례가 같다. 그런데 우리 폼은
 * 2026-09-16 까지 가로→세로 순으로 받아 "가로×세로 cm" 로 저장했다 — 심사자가 보면 그림 방향이 뒤집혀 읽히는 오류다.
 * 폼은 고쳤고(`frontend/src/lib/artwork.ts composeSize`), 이 모듈은 **이미 저장된 값**을 판정해 뒤집는다.
 *
 * ## 판정
 *  - 두 수가 같으면(정사각) 건드리지 않는다. 읽을 수 없는 문자열("가변크기")도 그대로.
 *  - **사진의 실제 비율**(PortfolioImage.width/height)이 있으면 그것으로 판정한다 — 문자열을 세로×가로로 읽었을 때와
 *    가로×세로로 읽었을 때 중 사진 비율에 가까운 쪽이 맞는 해석이다. 폼을 무시하고 관례대로 적어 둔 사람도 이렇게 보호된다.
 *  - 비율을 모르면 폼 관례(가로×세로)였다고 보고 뒤집는다 — 이 필드는 그 폼으로만 들어왔다.
 *
 * ⚠️ 비율 없는 행은 **두 번 돌리면 다시 뒤집힌다.** 스크립트(`scripts/migrate-size-order.ts`)가 AppSetting 으로 재실행을 막는다.
 * ⚠️ 숫자 둘의 자리만 바꾼다 — 공백·단위·괄호 같은 나머지 표기는 그대로 둔다("30호 (90.9×72.7cm)" 도 그대로 살아남는다).
 */
const SIZE_RE = /(\d+(?:\.\d+)?)(\s*[x×X*]\s*)(\d+(?:\.\d+)?)/;

export type SizeOrderReason = 'unparsed' | 'square' | 'image-kept' | 'image-swapped' | 'assumed';
export interface SizeOrderDecision { text: string; changed: boolean; reason: SizeOrderReason }

export function toHeightFirst(
  sizeText: string | null | undefined,
  image?: { width: number | null | undefined; height: number | null | undefined } | null,
): SizeOrderDecision {
  const s = String(sizeText ?? '');
  const m = SIZE_RE.exec(s);
  if (!m) return { text: s, changed: false, reason: 'unparsed' };
  const a = parseFloat(m[1]!), b = parseFloat(m[3]!);
  if (!(a > 0 && b > 0) || a === b) return { text: s, changed: false, reason: 'square' };
  const swapped = s.slice(0, m.index) + `${m[3]}${m[2]}${m[1]}` + s.slice(m.index + m[0].length);

  if (image?.width && image?.height) {
    const imgAspect = image.width / image.height;   // 사진 가로/세로
    const asHeightFirst = b / a;                    // "a×b" 를 세로×가로로 읽으면 가로/세로 = b/a
    const asWidthFirst = a / b;                     // 옛 폼(가로×세로)이었다면 a/b
    const dist = (x: number) => Math.abs(Math.log(x / imgAspect));
    return dist(asHeightFirst) <= dist(asWidthFirst)
      ? { text: s, changed: false, reason: 'image-kept' }
      : { text: swapped, changed: true, reason: 'image-swapped' };
  }
  return { text: swapped, changed: true, reason: 'assumed' };
}

/** 출품리스트 항목 — 가로/세로 칸이 따로 있으면 그것으로 다시 합성(가장 확실), 없으면 문자열만 판정 */
export function artworkListSize(entry: { size?: unknown; width?: unknown; height?: unknown }): SizeOrderDecision {
  const w = String(entry.width ?? '').trim(), h = String(entry.height ?? '').trim();
  const size = typeof entry.size === 'string' ? entry.size : '';
  if (w && h && /^\d+(\.\d+)?$/.test(w) && /^\d+(\.\d+)?$/.test(h)) {
    const text = h === w ? size : `${h}×${w} cm`;
    return { text, changed: text !== size, reason: h === w ? 'square' : 'image-kept' };
  }
  return toHeightFirst(size);
}
