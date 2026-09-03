/**
 * 작품 분석 — 포트폴리오 아트디렉션의 **입력 데이터**.
 *
 * ## 왜 필요한가
 * 예전 엔진은 작품의 **모양을 몰랐다**. `PortfolioImage` 에 폭·높이가 없어 비율을 알 수 없으니
 * 배치를 정할 근거가 "작품이 몇 점인가" 하나뿐이었다. 그래서 이런 일이 실제로 일어났다.
 *
 *   - `duo`(2점씩)가 **판형만 보고** 가로면 좌우, 세로면 위아래로 놨다. 세로 그림 두 점을
 *     A4 세로에 위아래로 쌓으면 각 칸이 지면 절반 높이라 그림이 작아지고 좌우가 텅 빈다.
 *     같은 두 점을 좌우로 놓으면 훨씬 크게 실린다 — 근거가 없어 못 하던 판단이다.
 *   - 어느 작품을 크게 걸지(hero) 고를 수 없었다. 전부 같은 칸이었다.
 *
 * ## 비율은 어디서 오나 (우선순위)
 *   1. **사진 실측**(naturalWidth/Height) — 브라우저에서 잰다. 캐시(url 키)에 남긴다.
 *   2. **`sizeText`(실치수)** — "72.7×90.9 cm".
 *   3. 없으면 **1.0**(정사각 가정). 예전 동작(비율 무시)과 가장 가까운 안전한 기본값이다.
 *
 * ⚠️ **배치에 쓰는 비율은 실치수가 아니라 사진이다.** 지면에 실제로 놓이는 건 사진이라,
 *    실치수를 먼저 믿으면 사진이 그 상자 안에서 다시 레터박스돼 **회색 여백이 생긴다**
 *    (테두리째 찍은 사진·여백 있는 스캔이 흔하다). 실치수는 크기 **위계**(어느 작품이 큰가)
 *    를 정할 때만 쓴다 — 그건 `areaCm2` 다.
 *
 * ⚠️ `buildPortfolioPages` 는 **순수 동기 함수**여야 한다(미리보기와 PDF가 같은 결과를 쓰는 근거).
 *    그래서 측정은 밖에서 하고 결과만 `PortfolioBookData.aspects` 로 넘긴다 — 측정이 아직
 *    안 끝났어도 문서는 그대로 나온다(비율 모르는 상태의 배치로). 나중에 다시 그려질 뿐이다.
 *
 * ⚠️ 색·밝기 분석은 **하지 않는다**. 캔버스로 픽셀을 읽으려면 CORS 를 통과해야 하는데
 *    미리보기 이미지는 crossorigin 없이 그려진다(CLAUDE.md 16번 — 붙이면 캐시가 오염돼
 *    사진이 통째로 안 뜬다). 근거 없는 숫자를 만드느니 안 쓰는 게 낫다.
 */
import type { PortfolioImage, SeriesInfo } from '@/types';
import { groupBySeries, hasCaption } from '@/lib/artwork';

// ── 비율 ──────────────────────────────────────────────────────────────

/** 실치수 문자열 → 가로/세로 비율. "72.7×90.9 cm" → 0.80. 못 읽으면 null */
export function parseAspect(sizeText?: string | null): number | null {
  const m = String(sizeText ?? '').match(/([\d.]+)\s*[x×X*]\s*([\d.]+)/);
  if (!m) return null;
  const w = parseFloat(m[1]!), h = parseFloat(m[2]!);
  if (!(w > 0) || !(h > 0)) return null;
  const a = w / h;
  // 말도 안 되는 값(오타)은 버린다 — 파노라마도 5:1 을 잘 안 넘는다
  return a >= 0.12 && a <= 8 ? a : null;
}

/** 실치수(cm²) — 크기 위계를 정할 때 쓴다. 못 읽으면 null */
export function parseAreaCm2(sizeText?: string | null): number | null {
  const m = String(sizeText ?? '').match(/([\d.]+)\s*[x×X*]\s*([\d.]+)/);
  if (!m) return null;
  const w = parseFloat(m[1]!), h = parseFloat(m[2]!);
  return w > 0 && h > 0 ? w * h : null;
}

export type Orientation = 'portrait' | 'landscape' | 'square';
/** 비율 → 방향. 정사각 판정 폭은 ±8% — 그 안쪽은 어느 칸에 넣어도 손해가 없다. */
export const orientationOf = (aspect: number): Orientation =>
  aspect < 0.92 ? 'portrait' : aspect > 1.08 ? 'landscape' : 'square';

/** url → 사진 실측 비율. 모듈 캐시(같은 사진을 두 번 재지 않는다) */
const measured = new Map<string, number>();
/** 이미 실패한 주소는 다시 시도하지 않는다(끝없는 재시도 방지) */
const failed = new Set<string>();

/** 캐시에 있는 실측값만 (동기) */
export const measuredAspect = (url: string): number | undefined => measured.get(url);

/**
 * 사진 비율을 잰다 — `naturalWidth/Height` 만 읽으므로 **CORS 와 무관**하다(픽셀을 안 읽는다).
 * 이미 잰 주소는 건너뛴다. 새로 잰 게 하나라도 있으면 true.
 */
export async function measureAspects(urls: string[]): Promise<boolean> {
  const todo = [...new Set(urls.filter((u) => u && !measured.has(u) && !failed.has(u)))];
  if (todo.length === 0) return false;
  await Promise.all(todo.map((url) => new Promise<void>((done) => {
    const im = new Image();
    im.onload = () => {
      if (im.naturalWidth > 0 && im.naturalHeight > 0) measured.set(url, im.naturalWidth / im.naturalHeight);
      else failed.add(url);
      done();
    };
    im.onerror = () => { failed.add(url); done(); };
    im.src = url;
  })));
  return todo.some((u) => measured.has(u));
}

/** 지금까지 잰 값들을 엔진에 넘길 형태로 (url → aspect) */
export function aspectMap(images: Pick<PortfolioImage, 'url'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of images) { const a = measured.get(i.url); if (a) out[i.url] = a; }
  return out;
}

// ── 작품 하나의 분석 ──────────────────────────────────────────────────

export interface ArtworkFacts {
  /** 가로/세로 — **지면에 놓이는 사진 기준**. 사진 실측 → 실치수 → 1.0 */
  aspect: number;
  orient: Orientation;
  /** 비율의 출처 — 'image'(사진 실측) > 'size'(실치수) > 'default'(모름) */
  aspectFrom: 'size' | 'image' | 'default';
  /** 실치수 면적(cm²). 모르면 null */
  areaCm2: number | null;
  /** 캡션(제목·재료·크기·연도) 중 하나라도 있는가 */
  captioned: boolean;
  /** 설명 글자 수 */
  descLen: number;
}

export function artworkFacts(a: PortfolioImage, aspects?: Record<string, number> | null): ArtworkFacts {
  const bySize = parseAspect(a.sizeText);
  const byImage = aspects?.[a.url] ?? measured.get(a.url) ?? null;
  const aspect = byImage ?? bySize ?? 1;
  return {
    aspect,
    orient: orientationOf(aspect),
    aspectFrom: byImage ? 'image' : bySize ? 'size' : 'default',
    areaCm2: parseAreaCm2(a.sizeText),
    captioned: hasCaption(a),
    descLen: String(a.description ?? '').trim().length,
  };
}

// ── 포트폴리오 전체의 성격 ────────────────────────────────────────────

export interface PortfolioCharacter {
  works: number;
  /** 방향 구성비 (합 1) */
  mix: Record<Orientation, number>;
  /** 가장 많은 방향 */
  dominant: Orientation;
  /** 비율 편차 — 작품 모양이 얼마나 제각각인가(0=전부 같은 비율) */
  aspectSpread: number;
  /** 비율을 실제로 아는 작품의 비율(0~1). 낮으면 배치 판단의 근거가 약하다 */
  aspectKnown: number;
  /** 캡션(제목·재료·크기·연도)이 있는 작품 비율 */
  captioned: number;
  /** 설명이 있는 작품 비율 */
  described: number;
  /** 설명 평균 길이(설명이 있는 작품 기준) */
  descAvg: number;
  seriesCount: number;
  hasStatement: boolean;
  hasBiography: boolean;
  hasCareer: boolean;
}

const share = (n: number, total: number) => (total > 0 ? n / total : 0);

export function analyzePortfolio(input: {
  images: PortfolioImage[];
  seriesInfo?: SeriesInfo[] | null;
  statement?: string | null;
  biography?: string | null;
  careerCount?: number;
  aspects?: Record<string, number> | null;
}): PortfolioCharacter {
  const { images, aspects } = input;
  const n = images.length;
  const facts = images.map((a) => artworkFacts(a, aspects));
  const count = (o: Orientation) => facts.filter((f) => f.orient === o).length;
  const mix: Record<Orientation, number> = {
    portrait: share(count('portrait'), n),
    landscape: share(count('landscape'), n),
    square: share(count('square'), n),
  };
  const dominant = (['portrait', 'landscape', 'square'] as const)
    .reduce((best, o) => (mix[o] > mix[best] ? o : best), 'square' as Orientation);
  // 편차는 log 비율의 표준편차 — 0.5:1 과 2:1 이 중심에서 같은 거리가 된다
  const logs = facts.map((f) => Math.log(f.aspect));
  const mean = logs.reduce((s, v) => s + v, 0) / Math.max(1, logs.length);
  const aspectSpread = Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, logs.length));
  const withDesc = facts.filter((f) => f.descLen > 0);

  return {
    works: n,
    mix,
    dominant,
    aspectSpread,
    aspectKnown: share(facts.filter((f) => f.aspectFrom !== 'default').length, n),
    captioned: share(facts.filter((f) => f.captioned).length, n),
    described: share(withDesc.length, n),
    descAvg: withDesc.length ? withDesc.reduce((s, f) => s + f.descLen, 0) / withDesc.length : 0,
    seriesCount: groupBySeries(images, input.seriesInfo).filter((g) => g.name).length,
    hasStatement: !!String(input.statement ?? '').trim(),
    hasBiography: !!String(input.biography ?? '').trim(),
    hasCareer: (input.careerCount ?? 0) > 0,
  };
}
