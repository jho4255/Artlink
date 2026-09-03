/**
 * 디자인 방향(Design Direction) — **템플릿 위에 얹는 아트디렉션 층**.
 *
 * ## 왜 만들었나
 * 예전 제작 화면은 표지 20종 · 작품 7종 · 글꼴 6 · 배경 8 · 글자 7 · 강조 7 · 판형 3 …
 * **한 화면에 15개 넘는 저수준 선택지**를 늘어놓았다. 작가는 디자이너가 아니므로
 * "어느 조합이 좋은가"를 스스로 풀어야 했고, 대부분은 기본값 그대로 뽑았다.
 *
 * 방향은 그 조합을 **의도를 가진 한 덩어리**로 묶은 것이다. 하나를 고르면
 * 색·글꼴·판형·표지·작품 배치가 서로 어울리는 값으로 함께 정해진다.
 * 세부 조절은 그대로 남아 있다(§고급) — 없애는 게 아니라 **먼저 좋은 답을 준다**.
 *
 * ⚠️ 색 조합은 전부 **WCAG 대비 실측으로 걸렀다**(글자·강조 모두 배경 대비 ≥4.5:1).
 *    예: 아이보리+골드는 4.22 라 탈락했고 플럼(7.3)으로 바꿨다. 어두운 배경에서
 *    통과하는 유채색 강조는 **오렌지 하나뿐**이다(레드 2.9 · 골드 2.3 …).
 *    새 방향을 추가하면 반드시 `portfolioColors.contrast()` 로 재 볼 것.
 *
 * ⚠️ 추천은 **실제 포트폴리오 속성**(작품 수·방향·캡션·설명·시리즈)에서 나온다.
 *    근거 없는 추천은 추천이 아니라 무작위다. `why` 는 그 근거를 한 줄로 말한다.
 */
import type { PdfDesign } from '@/lib/portfolioFormats';
import type { PortfolioCharacter } from '@/lib/artworkAnalysis';

export type DirectionKey = 'gallery' | 'minimal' | 'editorial' | 'artwork' | 'dark' | 'collection';

export interface DesignDirection {
  key: DirectionKey;
  /** 화면에 뜨는 이름 */
  name: string;
  /** 성격 한 줄 — 무엇을 위한 방향인가 */
  note: string;
  /** 이 방향이 정하는 값들(나머지는 기본값 유지) */
  design: Partial<PdfDesign>;
}

export const DESIGN_DIRECTIONS: DesignDirection[] = [
  {
    key: 'gallery',
    name: '갤러리 도록',
    note: '작품 한 점씩 크게, 캡션은 정중하게. 전시 도록의 문법',
    design: {
      bg: 'ivory', ink: 'charcoal', accent: 'plum', font: 'noto',
      page: 'a4-portrait', coverLayout: 'matted', worksLayout: 'hero',
      desc: 'short', worksCaption: 'below', proseAlign: 'left',
    },
  },
  {
    key: 'minimal',
    name: '미니멀',
    note: '흰 여백과 얇은 선. 작품 외에는 최소한만',
    design: {
      bg: 'white', ink: 'black', accent: 'mono', font: 'gowun',
      page: 'a4-portrait', coverLayout: 'ruleFrame', worksLayout: 'hero',
      desc: 'none', worksCaption: 'below', proseAlign: 'left',
    },
  },
  {
    key: 'editorial',
    name: '에디토리얼',
    note: '큰 이름과 비대칭 구성. 글과 작품이 함께 읽힌다',
    design: {
      bg: 'white', ink: 'charcoal', accent: 'red', font: 'myeongjo',
      page: 'a4-portrait', coverLayout: 'side', worksLayout: 'feature',
      desc: 'short', worksCaption: 'left', proseAlign: 'left',
    },
  },
  {
    key: 'artwork',
    name: '작품 우선',
    note: '지면을 작품이 최대한 차지한다. 글은 뒤로',
    design: {
      bg: 'white', ink: 'black', accent: 'mono', font: 'gothic',
      page: 'a4-landscape', coverLayout: 'fullTint', worksLayout: 'full',
      desc: 'none', worksCaption: 'minimal', proseAlign: 'left',
    },
  },
  {
    key: 'dark',
    name: '다크 룩북',
    note: '어두운 지면 위에서 색이 살아난다. 화면으로 보여줄 때',
    design: {
      bg: 'ink', ink: 'white', accent: 'orange', font: 'plex',
      page: 'a4-landscape', coverLayout: 'split', worksLayout: 'hero',
      desc: 'short', worksCaption: 'below', proseAlign: 'left',
    },
  },
  {
    key: 'collection',
    name: '모아보기',
    note: '여러 점을 정연하게. 작품이 많을 때 한눈에',
    design: {
      bg: 'white', ink: 'charcoal', accent: 'mono', font: 'plex',
      page: 'a4-portrait', coverLayout: 'grid2x2', worksLayout: 'grid',
      desc: 'none', worksCaption: 'below', proseAlign: 'left',
    },
  },
];

export const directionByKey = (k?: string | null): DesignDirection | undefined =>
  DESIGN_DIRECTIONS.find((d) => d.key === k);

export interface Recommendation {
  direction: DesignDirection;
  /** 왜 이 방향인가 — 실제 포트폴리오 속성에서 나온 한 줄 */
  why: string;
  /** 정렬용 점수(재현 가능) */
  score: number;
}

/**
 * 포트폴리오 성격 → 추천 방향 3개.
 *
 * 점수는 **결정적**이다 — 같은 포트폴리오면 항상 같은 순서가 나온다(§31).
 * 무작위 다양성을 넣지 않는다.
 */
export function recommendDirections(c: PortfolioCharacter): Recommendation[] {
  const many = c.works >= 16;
  const few = c.works <= 8;
  const landscapeHeavy = c.mix.landscape >= 0.55;
  const portraitHeavy = c.mix.portrait >= 0.5;
  const textRich = c.described >= 0.4 && c.descAvg >= 40;
  const varied = c.aspectSpread >= 0.28;

  const rows: { key: DirectionKey; score: number; why: string }[] = [
    {
      key: 'gallery',
      // 캡션이 채워져 있을수록 도록이 도록다워진다(적을 게 있어야 캡션 자리가 산다)
      score: 50 + (c.captioned >= 0.5 ? 22 : 0) + (portraitHeavy ? 10 : 0) + (few ? 8 : 0) - (many ? 10 : 0),
      why: c.captioned >= 0.5
        ? `작품 정보를 ${Math.round(c.captioned * 100)}% 채우셨어요. 캡션이 살아나는 구성입니다`
        : '한 점씩 크게 보여주는 가장 무난한 구성입니다',
    },
    {
      key: 'minimal',
      score: 48 + (c.captioned < 0.4 ? 18 : 0) + (few ? 12 : 0) + (!c.hasStatement ? 6 : 0),
      why: c.captioned < 0.4
        ? '작품 정보가 아직 적어요. 글을 줄이고 작품만 남기는 구성입니다'
        : '군더더기 없이 작품과 여백만으로 정리합니다',
    },
    {
      key: 'editorial',
      score: 44 + (textRich ? 24 : 0) + (varied ? 12 : 0) + (c.hasStatement ? 8 : 0),
      why: textRich
        ? '작품 설명을 잘 써두셨어요. 글과 작품을 나란히 읽히게 합니다'
        : varied ? '작품 비율이 제각각이라 크기를 달리한 구성이 어울립니다'
          : '한 점을 크게, 나머지를 작게 — 리듬이 생기는 구성입니다',
    },
    {
      key: 'artwork',
      score: 42 + (landscapeHeavy ? 22 : 0) + (c.captioned < 0.3 ? 12 : 0) + (many ? 6 : 0),
      why: landscapeHeavy
        ? `가로 작품이 ${Math.round(c.mix.landscape * 100)}% 예요. 가로 지면에 꽉 채웁니다`
        : '설명 없이 작품만으로 승부하는 구성입니다',
    },
    {
      key: 'dark',
      score: 36 + (landscapeHeavy ? 10 : 0) + (c.works >= 10 ? 6 : 0),
      why: '화면으로 보여줄 때 색이 가장 진하게 보입니다',
    },
    {
      key: 'collection',
      score: 38 + (many ? 26 : 0) + (c.captioned < 0.4 ? 8 : 0) + (c.seriesCount >= 2 ? 6 : 0) - (few ? 14 : 0),
      why: many
        ? `작품이 ${c.works}점이에요. 한 장에 여러 점씩 모아 쪽수를 줄입니다`
        : '여러 점을 한눈에 훑게 하는 구성입니다',
    },
  ];

  return rows
    // 동점이면 DESIGN_DIRECTIONS 순서 — 같은 입력이면 같은 결과여야 한다
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .map(({ key, score, why }) => ({ direction: directionByKey(key)!, why, score }));
}
