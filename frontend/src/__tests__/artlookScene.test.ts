import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ArtLook 장면 엔진 — `public/artlook/scene.js` 의 순수 계산 부분 회귀 테스트.
 *
 * 왜 이 파일이 필요한가: scene.js 는 번들 밖의 정적 스크립트라 타입도 빌드도 안 잡는다.
 * 그런데 여기가 틀리면 **에러 없이 조용히** 작품이 액자 밖으로 삐져나가거나(기하),
 * 방마다 크기가 제각각으로 걸린다(스케일). 눈으로만 보면 놓친다.
 *
 * WebGL 이 필요한 warp/composeScene 은 jsdom 에서 못 돈다 — 그 둘은 브라우저 하니스
 * (`scratchpad/scene-test.mjs`)가 실제 픽셀로 검사한다. 여기서는 수학과 폴백만 본다.
 */

type Pt = [number, number];
interface SceneApi {
  supported(): boolean;
  warp(...a: unknown[]): unknown;
  parseSizeCm(t: unknown): [number, number] | null;
  homographyUnitToQuad(q: Pt[]): number[] | null;
  inv3(m: number[]): number[] | null;
  quadSize(q: Pt[]): { w: number; h: number };
  placeInRegion(q: Pt[], o: Record<string, unknown>): {
    quad: Pt[]; trueScale: boolean; over: boolean; heightRatio: number;
  } | null;
}

let S: SceneApi;

beforeAll(() => {
  const src = readFileSync(resolve(__dirname, '../../public/artlook/scene.js'), 'utf-8');
  new Function('window', src)(globalThis);
  S = (globalThis as unknown as { ArtLookScene: SceneApi }).ArtLookScene;
});

const apply = (m: number[], u: number, v: number): Pt => {
  const w = m[6] * u + m[7] * v + m[8];
  return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
};

describe('호모그래피', () => {
  const quad: Pt[] = [[100, 60], [900, 120], [860, 700], [140, 640]];   // 원근이 있는 사각형

  it('단위정사각형의 네 꼭짓점이 quad 의 네 점에 정확히 간다', () => {
    const H = S.homographyUnitToQuad(quad)!;
    const corners: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach((c, i) => {
      const p = apply(H, c[0], c[1]);
      expect(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1])).toBeLessThan(1e-6);
    });
  });

  it('역행렬이 화면 좌표를 다시 단위정사각형으로 되돌린다', () => {
    const Hi = S.inv3(S.homographyUnitToQuad(quad)!)!;
    const expected: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    quad.forEach((p, i) => {
      const uv = apply(Hi, p[0], p[1]);
      expect(Math.abs(uv[0] - expected[i][0])).toBeLessThan(1e-6);
      expect(Math.abs(uv[1] - expected[i][1])).toBeLessThan(1e-6);
    });
  });

  it('세 점이 일직선인 quad 는 null — 던지지 않는다', () => {
    // 마킹 도구에서 실수로 한 줄에 찍을 수 있다. 예외가 나면 화면이 통째로 죽는다
    expect(S.homographyUnitToQuad([[0, 0], [10, 10], [20, 20], [30, 30]])).toBeNull();
  });

  it('quad 크기는 마주보는 변의 평균 — 기울어져도 대표값이 나온다', () => {
    const s = S.quadSize([[0, 0], [100, 0], [80, 50], [0, 50]]);
    expect(s.w).toBeCloseTo(90, 5);      // 위 100, 아래 80 → 90
    // 세로는 왼쪽 50, 오른쪽은 사선이라 √(20²+50²)=53.85 → 51.93 (길이지 세로 투영이 아니다)
    expect(s.h).toBeCloseTo((50 + Math.hypot(20, 50)) / 2, 5);
  });
});

describe('실제 크기 — 30호와 100호가 다르게 걸려야 한다 (2026-08-31 유일 모드)', () => {
  const region: Pt[] = [[100, 100], [900, 100], [900, 700], [100, 700]];  // 800×600px
  // ⚠️ `sizeMode` 는 없어졌다 — 실치수를 알면 **언제나** 벽 대비 실제 비율로 건다.
  const base = { regionAspect: 800 / 600, regionCm: [200, 150] as number[] };

  it('벽 높이 150cm 안의 50cm 작품은 정확히 1/3 을 차지한다', () => {
    const p = S.placeInRegion(region, { ...base, artCm: [50, 50], artAspect: 1 })!;
    expect(S.quadSize(p.quad).h).toBeCloseTo(200, 6);   // 600px 의 1/3
    expect(p.trueScale).toBe(true);
  });

  // ⚠️ 벽 높이의 55%(무릎, = 82.5cm) **아래에서만** 비가 정확하다. 그 위는 '벽 한 면을
  //    꽉 채우지 않게' 포화 곡선으로 눌린다(2026-08-31). 무릎 아래 치수로 검사할 것.
  it('50cm 작품은 25cm 작품의 정확히 두 배다 (무릎 아래 = 압축 없음)', () => {
    const a = S.placeInRegion(region, { ...base, artCm: [25, 25], artAspect: 1 })!;
    const b = S.placeInRegion(region, { ...base, artCm: [50, 50], artAspect: 1 })!;
    expect(S.quadSize(b.quad).h / S.quadSize(a.quad).h).toBeCloseTo(2, 6);
  });

  it('아주 큰 작품도 벽을 꽉 채우지 않는다 — 다만 순서는 지킨다', () => {
    const h = (cm: number) =>
      S.quadSize(S.placeInRegion(region, { ...base, artCm: [cm, cm], artAspect: 1 })!.quad).h;
    // 영역 높이 600px. 천장 0.82 에 닿지 않아야 벽 여백이 남는다
    expect(h(150)).toBeLessThan(600 * 0.60);
    expect(h(400)).toBeLessThan(600 * 0.60);
    // ⚠️ 딱딱한 상한이면 이 둘이 **같아진다** — 그래서 무릎으로 둔다
    expect(h(400)).toBeGreaterThan(h(150));
    expect(h(150)).toBeGreaterThan(h(100));
  });

  it('치수를 모르면 기본 채움 비율로 앉고 trueScale 이 false 다', () => {
    const p = S.placeInRegion(region, { regionAspect: 800 / 600, artAspect: 1, fill: 0.5 })!;
    expect(p.trueScale).toBe(false);
    expect(S.quadSize(p.quad).h).toBeCloseTo(300, 6);
  });

  it('영역보다 큰 작품은 잘라내지 않고 줄여 넣되 over 로 알린다', () => {
    // 숨기면 화면 밖으로 나가고, 알리지 않으면 사용자가 잘못된 크기를 믿는다
    const p = S.placeInRegion(region, { ...base, artCm: [400, 400], artAspect: 1 })!;
    expect(p.over).toBe(true);
    const s = S.quadSize(p.quad);
    expect(s.h).toBeLessThanOrEqual(600 + 1e-6);
    expect(s.w).toBeLessThanOrEqual(800 + 1e-6);
  });
});

describe('실치수를 알면 압축하지 않는다 — 예전 \'보기 좋게\' 는 없앴다', () => {
  // 예전엔 실치수를 지수 0.45 로 압축해 반영했다(소품이 사라지지 않게). 2026-08-31 에
  // 사용자 요청으로 제거 — 작아 보이는 문제는 크기를 부풀려서가 아니라 **카메라를 당겨서** 푼다.
  const region: Pt[] = [[0, 0], [800, 0], [800, 600], [0, 600]];
  const base = { regionAspect: 800 / 600, regionCm: [200, 150] as number[], artAspect: 1 };
  const h = (cm: number) => S.quadSize(S.placeInRegion(region, { ...base, artCm: [cm, cm] })!.quad).h;

  it('크기 비가 실제 비와 정확히 같다 (압축 없음)', () => {
    // ⚠️ 둘 다 **무릎(천장 0.60 × 0.67 = 벽 높이의 40% = 60cm) 아래**여야 한다 —
    //    그 위는 벽을 꽉 채우지 않으려고 눌리고, 더 크면 물리 한계로 잘린다(over).
    expect(h(50) / h(25)).toBeCloseTo(2, 4);
  });

  it('실치수를 알면 trueScale 이 true 다 (모드 선택이 없다)', () => {
    expect(S.placeInRegion(region, { ...base, artCm: [80, 80] })!.trueScale).toBe(true);
  });

  it('4호 소품은 정말로 작게 걸린다 — 그게 실제 크기다', () => {
    expect(h(33.4) / 600).toBeCloseTo(33.4 / 150, 4);
  });
});

describe('작품은 자르지도 늘리지도 않는다 (CLAUDE.md 18번)', () => {
  const region: Pt[] = [[0, 0], [800, 0], [800, 600], [0, 600]];

  it.each([
    ['세로 3:4', 3 / 4],
    ['가로 16:9', 16 / 9],
    ['정사각', 1],
    ['아주 긴 가로 4:1', 4],
    ['아주 긴 세로 1:4', 0.25],
  ])('%s 작품의 비율이 배치 후에도 그대로다', (_name, aspect) => {
    const p = S.placeInRegion(region, { regionAspect: 800 / 600, artAspect: aspect, fill: 0.9 })!;
    const s = S.quadSize(p.quad);
    expect(s.w / s.h).toBeCloseTo(aspect, 6);
    // 그리고 영역 밖으로 나가지 않는다
    expect(s.w).toBeLessThanOrEqual(800 + 1e-6);
    expect(s.h).toBeLessThanOrEqual(600 + 1e-6);
  });

  it('원근이 있는 벽에서도 크기 계산은 평면 좌표에서 한다', () => {
    // 위가 넓고 아래가 좁은 벽. 화면 픽셀에서 재면 어긋나므로 unit 공간에서 계산해야 한다
    const skew: Pt[] = [[0, 0], [800, 60], [700, 560], [100, 500]];
    const p = S.placeInRegion(skew, { regionAspect: 1.33, artAspect: 1, fill: 0.5 })!;
    expect(p.quad).toHaveLength(4);
    p.quad.forEach(([x, y]) => { expect(Number.isFinite(x)).toBe(true); expect(Number.isFinite(y)).toBe(true); });
    // 작품 quad 는 벽 quad 안에 들어 있어야 한다
    const xs = p.quad.map(q => q[0]), ys = p.quad.map(q => q[1]);
    expect(Math.min(...xs)).toBeGreaterThan(-1);
    expect(Math.max(...xs)).toBeLessThan(801);
    expect(Math.min(...ys)).toBeGreaterThan(-1);
    expect(Math.max(...ys)).toBeLessThan(561);
  });
});

describe('작품 크기 문자열 읽기', () => {
  it.each([
    ['116.8 × 91.0 cm', [116.8, 91]],
    ['80x60', [80, 60]],
    ['80×60cm', [80, 60]],
    ['90.9 X 72.7', [90.9, 72.7]],
    ['30호 (90.9×72.7cm)', [90.9, 72.7]],
    ['1168 × 910 mm', [116.8, 91]],   // mm 표기는 cm 로 내린다
  ])('%s → %s', (text, expected) => {
    expect(S.parseSizeCm(text)).toEqual(expected);
  });

  it.each([null, undefined, '', '가변크기', '캔버스에 유채', '0x0'])('읽을 수 없으면 null (%s)', (t) => {
    expect(S.parseSizeCm(t)).toBeNull();
  });
});

describe('WebGL 이 없는 환경', () => {
  it('supported() 가 false 이고 warp 이 던지지 않는다', () => {
    // 오래된 브라우저·headless 에서 장면 모드가 숨겨지고 기본 벽으로 남아야 한다
    expect(S.supported()).toBe(false);
    expect(() => S.warp(null, [[0, 0], [1, 0], [1, 1], [0, 1]], 10, 10, {})).not.toThrow();
    expect(S.warp(null, [[0, 0], [1, 0], [1, 1], [0, 1]], 10, 10, {})).toBeNull();
  });
});

describe('자동 프레이밍 배수(gain) — 액자가 화면의 주인공이 되게 키운다', () => {
  const region: Pt[] = [[0, 0], [680, 0], [680, 640], [0, 640]];
  const base = { regionAspect: 1.0625, artAspect: 0.8 };

  it('gain 은 높이 비율을 그대로 곱한다', () => {
    const a = S.placeInRegion(region, base)!;
    const b = S.placeInRegion(region, { ...base, gain: 1.3 })!;
    expect(b.heightRatio / a.heightRatio).toBeCloseTo(1.3, 5);
  });

  it('gain 을 아무리 키워도 영역 밖으로 나가지 않는다 — 벽을 뚫고 걸릴 순 없다', () => {
    const p = S.placeInRegion(region, { ...base, gain: 9 })!;
    expect(p.heightRatio).toBeLessThanOrEqual(1.0001);
    const ys = p.quad.map((q) => q[1]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(640.5);
  });

  it('gain 은 사용자 조절(scale)과 곱해진다 — 둘은 별개 축이다', () => {
    const a = S.placeInRegion(region, { ...base, gain: 1.2, scale: 1.1 })!;
    const b = S.placeInRegion(region, { ...base, gain: 1.32 })!;
    expect(a.heightRatio).toBeCloseTo(b.heightRatio, 5);
  });

  it('gain 이 없으면 예전과 똑같다 (기본 동작 보존)', () => {
    expect(S.placeInRegion(region, base)!.heightRatio)
      .toBeCloseTo(S.placeInRegion(region, { ...base, gain: 1 })!.heightRatio, 9);
  });
});

describe('scenes.json 데이터 규칙', () => {
  const scenes = JSON.parse(
    readFileSync(resolve(__dirname, '../../public/artlook/scenes/scenes.json'), 'utf-8'),
  ).scenes as Array<Record<string, unknown>>;

  it('광원의 세로 성분은 항상 위쪽이고 충분히 크다', () => {
    // ⚠️ 순수 수평광이면 위살·아래살이 같은 밝기가 되어 액자가 인쇄한 띠로 보인다.
    //    실측으로 갱신하되(lightdir.py) 세로는 반드시 위로 세운다 — 아래에서 오는 빛으로
    //    두면 그림자가 위로 지고 접지 그림자가 사라진다(실측 48→1.7).
    for (const s of scenes) {
      const ld = s.lightDir as [number, number] | undefined;
      if (!ld) continue;
      expect(ld[1], `${s.id} 의 lightDir 세로 성분`).toBeLessThanOrEqual(-0.03);
      expect(Math.hypot(ld[0], ld[1]), `${s.id} 의 lightDir 길이`).toBeGreaterThan(0.5);
    }
  });

  it('벽 진정(wallCalm)은 0~0.9 — 1 이면 배경이 통째로 흐려진다', () => {
    for (const s of scenes) {
      if (s.wallCalm == null) continue;
      expect(s.wallCalm as number, `${s.id}`).toBeGreaterThan(0);
      expect(s.wallCalm as number, `${s.id}`).toBeLessThanOrEqual(0.9);
    }
  });
});

describe('사진 액자 기하 — 네 살 폭이 같아야 한다', () => {
  const meta = JSON.parse(
    readFileSync(resolve(__dirname, '../../public/artlook/frames/photo/frames.json'), 'utf-8'),
  ) as Record<string, { inner: number[]; w: number; h: number }>;

  it('개구부가 정중앙에 있다 (비대칭이면 작품이 액자 안에서 치우쳐 보인다)', () => {
    // ⚠️ GPT 로 뽑은 원본은 정면이 아니라 개구부가 치우쳐 있었다(오크 위 119 / 아래 91 = 26.7%).
    //    `frontend/scripts/symmetrize-photo-frames.py` 로 바깥을 깎아 맞춘다. 추출기를
    //    다시 돌리면 이 테스트가 먼저 깨진다 — 그때 대칭화 스크립트를 한 번 더 돌릴 것.
    for (const [name, m] of Object.entries(meta)) {
      const [ix, iy, ix2, iy2] = m.inner;
      const rails = [ix, m.w - 1 - ix2, iy, m.h - 1 - iy2];
      const span = Math.max(...rails) - Math.min(...rails);
      expect(span, `${name} 의 네 살 폭 ${rails.join('/')}`).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  액자 스타일 · 매트 · 조명 — `public/artlook/index.html` 소스 가드
// ─────────────────────────────────────────────────────────────────────────────
// 여기 있는 것들은 전부 **에러 없이 조용히** 죽는 종류다. 실제로 옛 조명(라이팅맵)은
// 장면 분기에서 호출되지 않아, 무엇을 골라도 화면이 그대로인 채로 오래 남아 있었다.
// 주소·호출부가 문자열이라 타입도 못 잡으므로 소스를 훑어 고정한다.
describe('ArtLook 액자/매트/조명 (index.html 소스 가드)', () => {
  const html = readFileSync(resolve(__dirname, '../../public/artlook/index.html'), 'utf-8');

  it('액자 이름에 구현 방식(사진)을 적지 않는다', () => {
    // 고르는 사람에게 '사진 9-slice 인가 절차적인가'는 알 바가 아니다. 칩 라벨은 재질 이름만.
    const names = [...html.matchAll(/\{\s*name:'([^']+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(n, `액자 이름 "${n}"`).not.toMatch(/\(사진\)/);
  });

  it('매트는 없음/좁게/넓게 — 캔버스 랩만 예외 (2026-09-01, 44e 의 필수화를 되돌림)', () => {
    expect(html).toMatch(/const on\s*=\s*k\s*!==\s*'canvas'/);
    // ⚠️ 44e 의 **진짜 값**은 '필수'가 아니라 **한 곳에서만 정한다**였다. 예전엔 사진 액자
    //    분기가 `o.matWidth` 를 따로 읽어서, 규칙을 바꾸면 한쪽만 바뀌었다(사진 액자 5종에서만
    //    매트가 안 나왔다). '없음'을 되살려도 그 구조는 그대로 지킨다.
    const m = html.match(/const matFrac = [^;]+;/);
    expect(m, 'matFrac 계산부').toBeTruthy();
    expect(m![0]).toContain("'canvas'");
    expect(m![0]).toMatch(/Math\.max\(0,\s*o\.matWidth\|\|0\)/);
    expect(html).not.toMatch(/const matPx = Math\.round\(\(o\.matWidth\|\|0\)\*base\)/);
    const sel = html.slice(html.indexOf('id="matSel"'), html.indexOf('id="matHint"'));
    for (const t of ['없음', '좁게', '넓게']) expect(sel, t).toContain(t);
    expect(sel).toContain('data-mat="0"');
  });

  it('NO-MAT SAFETY — 매트가 없으면 자산의 밝은 립을 상쇄한다 (테두리를 더하지 않는다)', () => {
    // ⚠️ 매트가 있으면 자산의 밝은 안쪽 립이 **밝은 매트 옆**이라 안 보인다. 매트를 빼면
    //    어두운 작품에 직접 닿아 [액자 → 흰 테두리 → 작품] 이 된다(사용자가 든 실패 조건).
    //    실측 립 배수: 검정 2.74 · 월넛 2.72. 매트 없음에서 경계 임펄스 40.2 / 38.1 이었다.
    //    브리핑 NO-MAT SAFETY 대로 **테두리를 더하지 않고**, 물리적으로 없어야 할 밝기를 던다.
    expect(html).toMatch(/const LIP_TARGET=0\.85/);
    expect(html).toMatch(/if\(o\.noMat && A\.lip>1\.02/);
    // 립이 이미 어두운 자산(lip≤1)에는 **아무 일도 일어나지 않아야** 한다 —
    // 무조건 걸면 오크·화이트·골드(lip 0.74~0.94)의 사면을 근거 없이 어둡게 만든다.
    expect(html).toMatch(/ambient=Math\.max\(ambient, Math\.min\(0\.65, 1-LIP_TARGET\/A\.lip\)\)/);
    // 반사광 회복 스톱은 매트가 없으면 꺼야 한다 — 방금 덜어낸 립을 다시 밝힌다
    expect(html).toMatch(/rb\*\(o\.noMat\?1\.0:1\.12\)/);
    // 호출부가 실제로 알려 줘야 한다
    expect(html).toMatch(/noMat:matPx<=0/);
  });

  it('NO-MAT SAFETY — 플로터는 트레이 폐색과 접지 그림자를 겹치지 않는다', () => {
    // 매트가 있으면 트레이 폐색은 트레이↔매트 이음매, 접지 그림자는 작품 경계 — 떨어져 있다.
    // 매트를 빼면 `ax = border+gap` 이라 **같은 자리에 겹쳐** 검은 선이 된다
    // (실측: 샴페인 플로터 10.3 → 19.5 · 아이보리 박스 14.6 → 23.5).
    expect(html).toMatch(/function drawFloaterTray\(ctx,W,H,b,g,back,ld,innerOcc\)/);
    expect(html).toMatch(/if\(innerOcc===false\) return;/);
    expect(html).toMatch(/drawFloaterTray\(ctx,W,H,border,gap,matC\.back,ld, mat>0\)/);
  });

  it('매트 색은 매트가 있을 때만 뜬다 — 아무 일도 안 하는 컨트롤을 남기지 않는다', () => {
    expect(html).toMatch(/\(on && \(state\.matWidth\|\|0\) > 0\) \? 'flex' : 'none'/);
  });

  it('조명은 종류 선택 없이 강도 0~100 하나로만 조절한다', () => {
    expect(html).not.toContain('lightSel');           // 없음/스포트/소프트 토글은 없앴다
    expect(html).not.toContain('drawLightMap');       // 옛 라이팅맵 9-slice 도
    const r = html.match(/id="lightOp"[^>]*/);
    expect(r, '조명 강도 슬라이더').toBeTruthy();
    expect(r![0]).toMatch(/min="0"/);                 // 0 이 곧 '없음'
    expect(r![0]).toMatch(/max="100"/);
  });

  it('조명이 장면 경로에서 실제로 호출된다', () => {
    // ⚠️ 옛 조명이 죽어 있던 정확한 이유다. 장면이 유일한 배경이 된 뒤로도 호출부가
    //    폴백(기본 벽) 분기에만 있어서 화면에 아무 변화가 없었다.
    const scene = html.slice(html.indexOf("if(state.mode==='scene'){"));
    expect(scene.slice(0, 6000)).toContain('applyStudioLight(');
    // 합성 좌표(stageArt)로 넘겨야 한다 — 출력 좌표로 주면 SUPERSAMPLE 배만큼 빗나간다
    expect(html).toMatch(/applyStudioLight\(ctx,W,H,state\.light,stageArt/);
  });

  it('조명은 밝히는 항을 벽에만 두고, 균일 캐스트는 곱연산이어야 한다', () => {
    const fn = html.slice(html.indexOf('function applyStudioLight'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // ⚠️ soft-light 로 균일 캐스트를 주면 **검정이 들린다**(Cb=0.1 이 +11%). 어두운 방에서
    //    낙차를 상쇄해 조명이 무효가 되고, 작품 채도비도 0.83 까지 떨어졌다(실측).
    expect(body).not.toContain('soft-light');
    expect(body).toContain("globalCompositeOperation='multiply'");
  });
});

// ── 6차 라운드(2026-08-31) 물리 일관성 가드 ──────────────────────────────────
// 전부 **실측으로 찾아낸 결함**이라, 되돌아오면 조용히 예전 문제로 돌아간다.
// 지표는 `scratchpad/vt/physics.py`·`framelight.mjs` 에 있고 여기서는 소스만 지킨다.
describe('ArtLook 물리 일관성 (CLAUDE.md 44b)', () => {
  const html = readFileSync(resolve(__dirname, '../../public/artlook/index.html'), 'utf-8');
  const js = readFileSync(resolve(__dirname, '../../public/artlook/scene.js'), 'utf-8');

  it('hexToRgb 가 rgb(...) 문자열도 읽는다 — gradeHex/shade 반환값이 그 형식이다', () => {
    const fn = html.slice(html.indexOf('function hexToRgb'), html.indexOf('function clamp255'));
    expect(fn).toMatch(/rgba\?\\\(/);      // rgb()/rgba() 정규식이 있어야 한다
    // 못 읽으면 NaN|0 = 0 → 순검정. 플로터 트레이가 오크·골드·월넛에서만 새까맸다.
    expect(fn).toMatch(/isFinite/);
  });

  it('그림자는 블러보다 오프셋이 크다 — 안 그러면 사방 균일한 헤일로다', () => {
    const m = js.match(/const LAYERS = \[([\s\S]*?)\]\];/);
    expect(m).toBeTruthy();
    const rows = [...m![1].matchAll(/\[([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*'(\w+)'/g)]
      .map((r) => ({ blur: +r[1], alpha: +r[2], k: +r[3], name: r[4] }));
    // ⚠️ 넓은 반그림자(penumbra)는 뺐다 — 방향을 줘도 회색 헤일로로 읽혔다.
    //    남은 건 접지 + 아주 옅은 투영 둘뿐이고, 투영이 접지보다 **약해야** 한다.
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['cast', 'contact']);
    const cast = rows.find((r) => r.name === 'cast')!;
    const contact = rows.find((r) => r.name === 'contact')!;
    expect(cast.alpha).toBeLessThan(contact.alpha);
    for (const r of rows) {
      if (r.name === 'contact') continue;   // 접지는 '틈의 폐색'이라 사방에 조금씩 있는 게 맞다
      // 오프셋 = off * 0.030 * k (x축 기준). 블러보다 커야 한 방향으로만 진다.
      expect(0.030 * r.k).toBeGreaterThan(r.blur);
    }
  });

  it('그림자 오프셋은 정규화된 lightDir 을 쓴다 — [-1,-1] 장면만 41% 길어지면 안 된다', () => {
    expect(js).toMatch(/const ldn = \[ld\[0\] \/ ldMag, ld\[1\] \/ ldMag\]/);
    expect(js).not.toMatch(/shadowOffsetX = -ld\[0\]/);
  });

  it('작품 둘레에 stroke 를 두르지 않는다 (no black stroke / no white border)', () => {
    // 예전 위치 셋: rebateShadow 끝 · 캔버스랩 · 플로터. 전부 면(그라디언트)으로 바꿨다.
    expect(html).not.toMatch(/ctx\.strokeRect\(ax-ctx\.lineWidth\/2/);
    expect(html).not.toMatch(/ctx\.strokeRect\(ax\+\.5,ay\+\.5/);
    expect(html).not.toMatch(/ctx\.strokeRect\(d,d,aw,ah\)/);
  });

  it('개구부에 밝은 립을 그리지 않는다 (bright outline 금지)', () => {
    expect(html).not.toMatch(/1 \+ LIP \+ LIP\*0\.85\*lit/);
    expect(html).not.toMatch(/^const LIP=/m);
  });

  it('살 한 변은 폴리곤 하나로 칠한다 — 맞닿은 밴드는 경계 1px 이 뜬다', () => {
    const fn = html.slice(html.indexOf('function shadeFrameProfile'),
      html.indexOf('/** 리베이트'));
    expect(fn).toMatch(/const stops=\[/);
    expect(fn).toMatch(/globalCompositeOperation='multiply'[\s\S]*globalCompositeOperation='screen'/);
    // 예전처럼 밴드를 여러 개 이어 붙이면 안 된다
    expect(fn).not.toMatch(/shadeBand\(ctx, mitreBand/);
  });

  it('광원 방향을 손으로 적은 자리가 없다 (같은 방 · 같은 카메라)', () => {
    expect(html).not.toMatch(/const light=\[\.16,\.02,-\.14,\.08\]\[s\]/);   // 플로터 트레이
    expect(html).toMatch(/function drawFloaterTray\(ctx,W,H,b,g,back,ld,innerOcc\)/);
    expect(html).toMatch(/function drawFrameMiters\(ctx,W,H,b,c,ld\)/);
    // 절차적 액자도 사진 액자와 **같은** 리베이트 함수를 쓴다
    expect(html).toMatch(/rebateShadow\(ctx,ax,ay,aw,ah,base,ld\);/);
  });

  it('최대 크기도 무릎이다 — 작품이 벽 한 면을 꽉 채우면 안 된다', () => {
    // 예전 maxT=1.0 이라 영역보다 큰 작품이 **벽 끝에서 끝까지** 걸렸다
    // (흰 벽돌 영역 163×154cm, 100호 130×162 → 100%). 딱딱한 상한은 50호와 100호를
    // 같은 크기로 만들어 기각했다(아래쪽 바닥과 같은 실수).
    expect(js).toMatch(/const CEIL = o\.fillCeil/);
    expect(js).toMatch(/const KH = o\.fillKnee/);
    expect(js).toMatch(/KH \+ \(CEIL - KH\) \* \(v - KH\) \/ \(\(v - KH\) \+ \(CEIL - KH\)\)/);
    expect(js).not.toMatch(/const maxT = Math\.min\(1, aspect \/ A\);/);
  });

  it('최소 크기는 무릎(soft knee)이다 — clamp 로 두면 소품끼리 크기가 같아진다', () => {
    expect(js).toMatch(/const KNEE = u\.minArea/);
    expect(js).toMatch(/const FLOOR = u\.floorArea/);
    expect(js).toMatch(/FLOOR \+ \(KNEE - FLOOR\) \* \(reach \/ KNEE\)/);
    // 부풀렸으면 화면에 알린다
    expect(js).toMatch(/fitNote\.enlarged = enlarged/);
    expect(html).toMatch(/lastFitNote\.enlarged>1\.05/);
  });

  it('조각의 긴 변은 화면의 70% 를 넘지 않는다 (2026-08-31 요청)', () => {
    // ⚠️ **영역(벽) 상한만으로는 부족하다.** 자동 프레이밍이 목표 면적을 채우려고 카메라를
    //    다시 당기면 화면에서는 그대로 커진다 — 벽 영역을 70% 로 묶었는데도 화면 긴변이
    //    74.9% 였다(치수 미입력 작품). 사용자가 보는 건 화면이라 화면 기준으로 건다.
    expect(js).toMatch(/scene\.maxLong == null \? 0\.70 : scene\.maxLong/);
    // ⚠️ 화면 차지는 **바운딩 박스**로 재야 한다 — `quadSize` 는 마주보는 변의 평균이라
    //    원근이 있는 실내 장면에서 작게 나온다(0.49 를 걸었는데 54.6% 가 나왔다).
    expect(js).toMatch(/Math\.max\(\.\.\.xs0\) - Math\.min\(\.\.\.xs0\)/);
    // ⚠️ 넘칠 때 줄이는 건 gain 이 아니라 fillMax 다 — t 가 physMax 에 포화돼 있으면
    //    gain 을 줄여도 결과가 한 픽셀도 안 변한다(실측).
    expect(js).toMatch(/fillMax = s0\.place\.heightRatio \* \(cap \/ long0\)/);
    expect(js).toMatch(/const hardMax = o\.fillMax != null/);
  });

  it('실내 장면은 상한이 더 작다 — scenes.json 이 장면별로 선언한다', () => {
    const scenes = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/artlook/scenes/scenes.json'), 'utf-8'),
    ).scenes as Array<Record<string, unknown>>;
    // 방이 통째로 보이는 실내 사진(wall11~17)은 0.70 × 0.70
    const interior = scenes.filter((s) => /wall1[1-7]/.test(String(s.src)));
    expect(interior.length).toBeGreaterThanOrEqual(7);
    for (const s of interior) expect(s.maxLong, String(s.id)).toBeCloseTo(0.49, 5);
    // 평면 매크로 벽은 기본값(0.70)을 쓴다 — 선언하지 않는다
    for (const s of scenes.filter((x) => !/wall1[1-7]/.test(String(x.src)))) {
      expect(s.maxLong, String(s.id)).toBeUndefined();
    }
  });

  it('합성 음영은 방향광/테두리 두 노브로 나뉘어 있다 (2026-09-01)', () => {
    // ⚠️ 한 노브로 일괄 조절하면 '층'을 줄이려다 **장면 광원 추종까지** 깎인다
    //    (실측: 일괄 0.40 에서 위살↔아래살 차이가 골든 30~90 대비 19.8 로 떨어졌다).
    // 8차에서 폴백 사다리(LEVEL)가 두 노브를 감쌌지만, **노브 자체는 남아 있어야** 한다
    expect(html).toMatch(/const SYN_DIR=.*_synQ\('syndir'/);
    expect(html).toMatch(/const SYN_EDGE=.*_synQ\('syn'/);
    // 테두리·링 계열은 EDGE 로 눌러야 한다 — 사용자가 본 '흰 테두리/검은 선'이 여기서 나온다
    // 각 함수 본문 안에 SYN_EDGE 가 있어야 한다 (함수 단위로 잘라서 본다)
    for (const fn of ['matOpeningBevel', 'rebateShadow', 'frameShadowOnMat']) {
      const i = html.indexOf(`function ${fn}(`);
      expect(i, `${fn} 정의`).toBeGreaterThan(0);
      const body = html.slice(i, html.indexOf('\nfunction ', i + 10));
      expect(body, `${fn} 본문의 SYN_EDGE`).toContain('SYN_EDGE');
    }
    // 하니스가 같은 입력으로 전/후를 뽑을 수 있어야 한다(브리핑 "동시에 테스트")
    expect(html).toMatch(/URLSearchParams\(location\.search\)/);
  });

  it('합성 해상도(SUPERSAMPLE)는 2.0 이고 확대 한도에 SS 를 곱해 넘긴다', () => {
    expect(html).toMatch(/const SUPERSAMPLE=2\.0/);
    expect(html).toMatch(/maxSrcScale: 1\.15\*SS/);
  });

  it('디버그 훅이 조명 변조 레이어와 토글 목록을 돌려준다 (브리핑 9번)', () => {
    expect(html).toMatch(/light: png\(lightLayer\)/);
    expect(html).toMatch(/toggles: \['shadow'/);
    expect(js).toMatch(/u\.shadow != null \? u\.shadow/);
  });
});

// ============================================================================
//  8차 — 자산·장면을 **재서** 모자란 만큼만 (CLAUDE.md 44g)
// ============================================================================
describe('ArtLook 적응형 합성 (CLAUDE.md 44g)', () => {
  const html = readFileSync(resolve(__dirname, '../../public/artlook/index.html'), 'utf-8');
  const js = readFileSync(resolve(__dirname, '../../public/artlook/scene.js'), 'utf-8');

  it('액자 자산에 이미 구워진 조명을 **잰다** (SOURCE-ASSET LIGHTING PROTECTION)', () => {
    expect(html).toMatch(/function measureAssetLight\(/);
    // ⚠️ 반드시 **색 보정된 뒤** 재야 한다 — 우리가 실제로 그리는 픽셀이 그것이다
    const i = html.indexOf('PHOTO_LIGHT[k]=measureAssetLight(');
    expect(i, 'gradeImage 뒤에서 재는가').toBeGreaterThan(html.indexOf('PHOTO_FRAMES[k]=gradeImage('));
    // 알파를 걸러야 한다 — 개구부가 투명이라 섞이면 값이 통째로 어두워진다
    expect(html).toMatch(/d\[i\+3\]>200/);
  });

  it('균일 항은 상수가 아니라 **잔차**다 — 이미 충분하면 손대지 않는다', () => {
    const i = html.indexOf('const want=UNI_AMP*lit;');
    expect(i, 'want 계산').toBeGreaterThan(0);
    const body = html.slice(i, i + 600);
    expect(body).toMatch(/const have=/);
    // 자산이 이미 목표만큼 갖고 있으면 delta=0 (SOURCE-FIRST · VISUAL STOP CONDITION)
    expect(body).toMatch(/Math\.abs\(have\)>=Math\.abs\(want\)\)\s*delta=0/);
    // ⚠️ **want 에 SYN_DIR 을 곱하지 말 것** — `?syndir=0` 이 원본이 아니게 되어
    //    syncheck 의 차등 측정이 통째로 거짓이 된다. 노브는 개입량 전체에만 곱한다.
    expect(html).not.toMatch(/const want=UNI_AMP\*SYN_DIR/);
    expect(body).toMatch(/delta=\(want-have\)\*SYN_DIR/);
  });

  it('밝히기는 screen 이 아니라 lighter(가산)로 — 밝은 액자에서 헤드룸이 없다', () => {
    const i = html.indexOf('function applyRailGain(');
    expect(i, 'applyRailGain 정의').toBeGreaterThan(0);
    const body = html.slice(i, html.indexOf('\nfunction ', i + 10));
    expect(body).toMatch(/globalCompositeOperation='lighter'/);
    expect(body).toMatch(/drawImage\(plate,0,0\)/);
    expect(body).not.toMatch(/'screen'/);
  });

  it('단면 프로파일은 자산이 가진 만큼 꺼진다(P) — 폐색은 P 와 무관하다', () => {
    // 방향 성분은 자산에 있으므로 P 로 끈다
    expect(html).toMatch(/const AO=.*\*P;/);
    expect(html).toMatch(/const AR=.*\*P;/);
    // ⚠️ 폐색(사방 공통)은 자산에 **없다** — P 를 곱하면 빛 받는 변에서 사면이 사라진다
    expect(html).toMatch(/let ambient=REBATE_AMBIENT\*SYN_EDGE;/);
    expect(html).toMatch(/const RB=o\.rebateBase==null\?\(1-ambient\)/);
    expect(html).not.toMatch(/REBATE_AMBIENT\*SYN_EDGE\*P/);
  });

  it('깊은 폐색은 근사 검정으로 — 따뜻한 그늘색은 어두운 액자에서 바닥이 된다', () => {
    expect(html).toMatch(/const SHADE_WARM='28,22,16', SHADE_OCCL='6,6,8'/);
    expect(html).toMatch(/const tint = P<=0\.02 \? SHADE_OCCL : SHADE_WARM/);
  });

  it('장면 광원은 **신뢰도 모델**을 통과한다 — 날것의 lightDir 을 쓰지 않는다', () => {
    expect(js).toMatch(/function sceneLightModel\(/);
    // 낙차를 재서 신뢰도를 만든다
    expect(js).toMatch(/conf = Math\.max\(0, Math\.min\(1, \(grad - 4\) \/ 18\)\)/);
    // ⚠️ 가로만 줄이고 세로는 **항상 위** (실내 조명의 보편 가정)
    expect(js).toMatch(/Math\.min\(-0\.35, raw\[1\] \/ rn\)/);
    // ⚠️ 가로를 0 까지 죽이지 않는다 — 완벽한 좌우 대칭 자체가 CG 신호다
    expect(js).toMatch(/\(0\.40 \+ 0\.60 \* conf\)/);
    // composeScene 과 index.html 둘 다 모델을 거쳐야 한다(같은 방 · 같은 카메라)
    expect(js).toMatch(/lightDir: sceneLightModel\(scene\)\.dir/);
    expect(js).toMatch(/const lm = sceneLightModel\(scene\);\s*\n\s*const ld = lm\.dir;/);
    expect(html).toMatch(/ArtLookScene\.sceneLightModel\(SCENES\[state\.sceneIdx\]\)\.dir/);
  });

  it('그림자 세기는 신뢰도로 깎지 않는다 — 방향은 신뢰도, 세기는 물리', () => {
    // 2026-09-01 에 시도했다가 되돌렸다(contact_drop 이 전 케이스에서 내려갔다)
    expect(js).toMatch(/const LAYERS = \[\[0\.045, 0\.060, 2\.20, 'cast'\]/);
    expect(js).not.toMatch(/0\.060 \* castConf/);
  });

  it('폴백 사다리 — level 0~3 이 단계별로 합성을 덜어낸다', () => {
    expect(html).toMatch(/const LEVEL=/);
    expect(html).toMatch(/const SYN_DIR=LEVEL>=3 \?/);
    expect(html).toMatch(/const SYN_EDGE=LEVEL>=2 \?/);
    expect(html).toMatch(/LEVEL<1 \? \{shadow:0, cornerAO:0, wallCalm:0, wallAmt:0\}/);
  });

  it('매트 사면은 폭이 모자라면 알파로 사라진다 — 바닥값으로 선을 만들지 않는다', () => {
    // ⚠️ 옛 `Math.max(1.5, matPx*.085)` 는 안 보일 폭에서도 1.5px 짜리 **선**을 그렸다
    expect(html).not.toMatch(/matOpeningBevel\([^)]*Math\.max\(1\.5,/);
    expect(html).toMatch(/const MAT_BEVEL_FRAC=0\.085/);
    expect(html).toMatch(/\(bw-0\.55\)\/0\.85/);
  });

  it('액자↔매트 이음매 폐색은 사방 공통 항을 갖는다 (빛 받는 변에서도 남는다)', () => {
    expect(html).toMatch(/const AO_SEAM=0\.34, AO_SEAM_DIR=0\.34/);
    expect(html).toMatch(/const a=\(AO_SEAM \+ AO_SEAM_DIR\*\(1-lit\)\/2\)\*SYN_EDGE/);
  });

  it('계측 훅이 **뒷면**을 함께 알려준다 — 두께가 있으면 실루엣으로 그림자를 못 잰다', () => {
    expect(html).toMatch(/back:\(\(\)=>\{ const q=placed\.quad/);
  });
});
