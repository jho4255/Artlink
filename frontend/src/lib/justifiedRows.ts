/**
 * 정렬 격자(justified rows) — 작가 홈페이지 작품 격자 (2026-09-16).
 *
 * ## 왜 정사각 칸이 아닌가
 * 예전 격자는 칸이 정사각이고 그 안에 contain 이라, 가로·세로 작품마다 칸의 30~40% 가 흰 여백이었다.
 * 미술관 벽처럼 **한 행의 작품이 같은 높이로 나란히** 서고 폭은 비율만큼 가져가면 여백이 사라지고
 * 행마다 좌우 끝이 정확히 맞는다(PDF 엔진의 정렬 격자와 같은 원리 — CLAUDE.md 45).
 *
 * ## 규칙
 * - 목표 높이 `targetHeight` 로 작품을 왼쪽부터 채우다 컨테이너 폭을 넘기면 행을 닫고, 그 행의 높이를
 *   **폭에 정확히 맞게** 줄인다(줄이기만 한다 — 키우면 마지막 한 점이 혼자 커진다).
 * - 마지막 행은 늘리지 않는다. 남는 자리는 비운다(사진을 억지로 키워 흐리게 만들지 않는다).
 * - 파노라마 한 점이 행을 혼자 차지하면 폭에 맞춰 높이가 낮아지는 게 맞다(그 작품의 모양이다).
 * - 비율을 모르는 작품(`aspect` 없음)은 정사각으로 본다. 화면이 로드 후 재서 다시 부르면 된다.
 *
 * 순수 함수 — jsdom 에서 테스트한다(`__tests__/justifiedRows.test.ts`).
 */
export interface JustifyInput<T> { item: T; aspect?: number | null }
export interface JustifiedCell<T> { item: T; width: number; height: number; aspect: number }
export interface JustifyOptions {
  containerWidth: number;
  /** 행 높이 목표(px). 실제 높이는 폭에 맞춰 이보다 작아질 수 있다 */
  targetHeight: number;
  gap: number;
  /** 한 행 최대 점수(모바일에서 3점이 한 줄에 서면 너무 작다) */
  maxPerRow?: number;
  /** 마지막 행이 이 비율보다 덜 찼으면 목표 높이 그대로 둔다(늘리지 않는다). 기본 1 = 절대 안 늘림 */
}

const clampAspect = (a?: number | null): number => (a && Number.isFinite(a) && a > 0 ? Math.min(6, Math.max(0.2, a)) : 1);

export function justifyRows<T>(inputs: JustifyInput<T>[], opts: JustifyOptions): JustifiedCell<T>[][] {
  const { containerWidth, targetHeight, gap } = opts;
  const maxPerRow = Math.max(1, opts.maxPerRow ?? Infinity);
  const rows: JustifiedCell<T>[][] = [];
  if (containerWidth <= 0 || inputs.length === 0) return rows;

  let row: { item: T; aspect: number }[] = [];
  let sumAspect = 0;

  const flush = (last: boolean) => {
    if (row.length === 0) return;
    const n = row.length;
    const widthForImages = containerWidth - gap * (n - 1);
    // 이 행이 목표 높이에서 차지하는 폭 → 넘치면 폭에 맞춰 줄이고, 마지막 행은 목표 높이를 넘기지 않는다
    const fitHeight = widthForImages / sumAspect;
    const height = last ? Math.min(targetHeight, fitHeight) : Math.min(fitHeight, targetHeight * 1.0001);
    rows.push(row.map(({ item, aspect }) => ({ item, aspect, width: aspect * height, height })));
    row = [];
    sumAspect = 0;
  };

  for (const input of inputs) {
    const aspect = clampAspect(input.aspect);
    const nextSum = sumAspect + aspect;
    const nextN = row.length + 1;
    const widthAtTarget = nextSum * targetHeight + gap * (nextN - 1);
    // 이 작품을 넣으면 폭을 넘기는가 — 넘기면 (첫 작품이 아닌 한) 지금 행을 닫고 새 행에서 시작한다.
    // 단, 넘기는 정도가 작으면(줄여도 목표의 80% 이상) 같은 행에 넣고 줄인다 — 그래야 행 끝이 맞는다.
    if (row.length > 0 && (nextN > maxPerRow || widthAtTarget > containerWidth)) {
      const fitIfIncluded = (containerWidth - gap * (nextN - 1)) / nextSum;
      if (nextN <= maxPerRow && fitIfIncluded >= targetHeight * 0.8) {
        row.push({ item: input.item, aspect });
        sumAspect = nextSum;
        flush(false);
        continue;
      }
      flush(false);
    }
    row.push({ item: input.item, aspect });
    sumAspect += aspect;
    // 목표 높이에서 이미 폭을 꽉 채웠으면 바로 닫는다(파노라마 한 점 등)
    if (sumAspect * targetHeight + gap * (row.length - 1) >= containerWidth || row.length >= maxPerRow) flush(false);
  }
  flush(true);
  return rows;
}

/** 실측된 픽셀 크기가 있으면 그걸로, 없으면 이미 잰 값(선택)으로, 그것도 없으면 undefined */
export function aspectOf(img: { width?: number | null; height?: number | null }, measured?: number): number | undefined {
  if (img.width && img.height) return img.width / img.height;
  return measured;
}
