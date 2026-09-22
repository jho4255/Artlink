/**
 * 같은 폭의 열 격자 — 작가 홈페이지 작품 격자 (2026-09-22, 사용자 결정 "오와열을 맞춰라").
 *
 * ## 왜 정렬 격자(justifiedRows)에서 되돌렸나
 * 정렬 격자는 한 행의 높이를 맞추고 폭은 비율대로 주는 방식이라 **세로 이음매가 행마다 다른 자리**에 오고,
 * 마지막 행은 키우지 않아 **오른쪽 끝이 들쭉날쭉**했다. 실측(김다은, 1280px): 이음매 369/441 · 348/372 · 370/394,
 * 오른쪽 끝 1007 · 1232 · 1062. 시리즈마다 격자를 따로 짜니 시리즈가 3~4점이면 거의 모든 행이 '마지막 행'이었다.
 * 실서버 작품은 대부분 정사각 근처라 비율대로 폭을 줘서 얻는 여백 절약도 거의 없었다 — 장점은 안 나오고 단점만 보였다.
 *
 * ## 규칙
 * - 열 폭은 컨테이너에서 **한 번** 정한다(`(폭 - 간격) / 열 수`). 모든 행이 같은 열 폭을 쓰므로 이음매·오른쪽 끝이 전 시리즈에서 한 자리에 온다.
 * - **칸은 정사각**(높이 = 열 폭, 같은 날 2차 사용자 결정 — 첫 번째 안 "행 최대 높이"는 행마다 높이가 달라 윗선이 어긋났다).
 *   그림은 칸 안에 비율대로(contain) **가운데** 들어간다 — 자르지도 늘리지도 않는다(CLAUDE.md 18). 가로 그림은 위아래가, 세로 그림은
 *   좌우가 빈다. 칸에 배경·테두리가 없어 빈 자리는 '빈 상자'가 아니라 액자 매트처럼 읽힌다. 윗선·아랫선·캡션 줄이 전부 맞는다.
 * - `maxRowRatio` 를 넘기면 칸 높이를 열 폭 × 그 값까지 늘려 **행에서 가장 높은 그림**에 맞춘다(첫 번째 안). 기본은 1 = 정사각.
 * - 비율을 모르는 작품은 정사각으로 본다(화면이 로드 후 재서 다시 부른다).
 *
 * 순수 함수 — jsdom 에서 테스트한다(`__tests__/columnGrid.test.ts`). PDF 엔진의 정렬 격자(`justifiedRows.ts`)는 별개다 — 거긴 그대로.
 */
export interface ColumnInput<T> { item: T; aspect?: number | null }
export interface ColumnCell<T> {
  item: T;
  aspect: number;
  /** 칸 안에 그려지는 그림 크기(px) — 칸 폭·행 높이를 넘지 않는다 */
  width: number;
  height: number;
}
export interface ColumnRow<T> { cells: ColumnCell<T>[]; height: number }
export interface ColumnGridOptions {
  containerWidth: number;
  columns: number;
  gap: number;
  /** 칸 높이 상한 = 열 폭 × 이 값. 기본 1 = 정사각 칸(행 높이가 그림에 따라 변하지 않는다) */
  maxRowRatio?: number;
}

const clampAspect = (a?: number | null): number => (a && Number.isFinite(a) && a > 0 ? Math.min(6, Math.max(0.2, a)) : 1);

/** 열 폭 — 화면이 figure 폭으로 그대로 쓴다 */
export function columnWidth({ containerWidth, columns, gap }: Pick<ColumnGridOptions, 'containerWidth' | 'columns' | 'gap'>): number {
  const cols = Math.max(1, Math.floor(columns));
  return Math.max(0, (containerWidth - gap * (cols - 1)) / cols);
}

export function columnGrid<T>(inputs: ColumnInput<T>[], opts: ColumnGridOptions): ColumnRow<T>[] {
  const cols = Math.max(1, Math.floor(opts.columns));
  const colW = columnWidth({ ...opts, columns: cols });
  if (colW <= 0 || inputs.length === 0) return [];
  const maxH = colW * Math.max(1, opts.maxRowRatio ?? 1);
  const rows: ColumnRow<T>[] = [];
  for (let i = 0; i < inputs.length; i += cols) {
    const chunk = inputs.slice(i, i + cols).map(({ item, aspect }) => ({ item, aspect: clampAspect(aspect) }));
    // 폭을 다 쓸 때의 높이. 칸은 정사각(열 폭)이 기본이고, 상한을 열어 두었을 때만 행에서 가장 높은 그림까지 커진다
    const natural = chunk.map((c) => colW / c.aspect);
    const height = Math.min(maxH, Math.max(colW, ...natural));
    rows.push({
      height,
      cells: chunk.map((c, k) => {
        const h = Math.min(natural[k], height);       // 칸보다 높은 세로 그림은 높이에서 걸려 폭이 줄어든다
        return { item: c.item, aspect: c.aspect, width: h * c.aspect, height: h };
      }),
    });
  }
  return rows;
}

/** 실측된 픽셀 크기가 있으면 그걸로, 없으면 이미 잰 값(선택), 그것도 없으면 undefined(=정사각으로 본다) */
export function aspectOf(img: { width?: number | null; height?: number | null }, measured?: number): number | undefined {
  if (img.width && img.height) return img.width / img.height;
  return measured;
}
