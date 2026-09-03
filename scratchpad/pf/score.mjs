/**
 * 시각 품질 채점기 — **렌더한 페이지를 재서** 100점 만점으로 점수를 낸다.
 *
 *   node score.mjs                        # 검증 세트 전체(합성 작가 4명 × 설계 조합)
 *   node score.mjs --case rich:auto       # 한 조합만
 *   node score.mjs --real ../../../portfolio-samples/data.json   # 실데이터(로컬 전용, 커밋 금지)
 *   node score.mjs --shots                # 약한 페이지 PNG 저장
 *
 * ## 왜 필요한가
 * "괜찮아 보인다"로 두 번 잘못 판단했다(ArtLook 과 같은 이유, `scratchpad/vt/` 참고).
 * 코드를 읽어서는 못 보는 것들 — 지면에서 작품이 실제로 얼마나 차지하는가, 칸에 빈 자리가
 * 남는가, 같은 구성이 몇 장 연속인가, 작은 글자가 배경에서 읽히는가 — 을 **렌더 후 실측**한다.
 *
 * ## 점수 (§26)
 *   구성 20 · 위계 15 · 타이포 15 · 여백 10 · 이미지 15 · 일관성 10 · 편집 10 · 표지 5
 * ⚠️ 임계값은 **레퍼런스에서 나왔다** — 작품 지면점유 밴드는 실제 작가 포트폴리오 5종
 *    (`golden.py`: 쪽당 1점 42% / 2점 49% / 3점 50% / 4점 56%) 실측이다.
 *    통과시키려고 느슨하게 고치지 말 것. 그 순간 표가 장식이 된다.
 */
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { ARTISTS } from './data.mjs';

const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
// --real 로 준 데이터 폴더도 함께 서빙한다(작품 사진이 그 옆에 있다). 로컬 확인용.
const EXTRA = (() => { const i = process.argv.indexOf('--real'); return i < 0 ? null : dirname(resolve(process.cwd(), process.argv[i + 1])); })();
const srv = createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]);
  for (const root of [HERE, EXTRA].filter(Boolean)) {
    try {
      const body = readFileSync(join(root, rel));
      s.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
      return s.end(body);
    } catch { /* 다음 루트 */ }
  }
  s.writeHead(404); s.end();
}).listen(0);

const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1]; };
const shots = process.argv.includes('--shots');
const only = arg('--case');
const realPath = arg('--real');

// ── 검증 세트 (§40) — 작품 수·비율·설명 유무·판형·글꼴·자동/수동을 고루 밟는다 ──
const BASE = {
  bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait',
  worksLayout: 'hero', desc: 'none', worksCaption: 'below', coverLayout: 'bandTop',
  coverEyebrow: true, coverTagline: true, coverYear: true, coverNameAccent: false,
  coverEyebrowText: null, coverTaglineText: null, coverImageIds: [],
  coverImageScale: 1, coverTextScale: 1, proseAlign: 'left', auto: false, direction: null,
};
const DESIGNS = {
  auto: { auto: true },
  'auto-가로': { auto: true, page: 'a4-landscape', font: 'plex' },
  'auto-다크': { auto: true, bg: 'ink', ink: 'white', accent: 'orange', font: 'gothic', desc: 'short' },
  hero: { worksLayout: 'hero' },
  duo: { worksLayout: 'duo', desc: 'short' },
  grid: { worksLayout: 'grid' },
  index: { worksLayout: 'index' },
  feature: { worksLayout: 'feature', desc: 'short' },
  'grid-가로': { worksLayout: 'grid', page: 'a4-landscape' },
  'label-전문': { worksLayout: 'label', desc: 'full', font: 'noto', bg: 'ivory', ink: 'brown' },
};
// 골든(실제 작가 포트폴리오 5종) 쪽당 작품 수별 지면점유 — golden.py 실측
const GOLDEN_COVER = { 1: 0.422, 2: 0.487, 3: 0.499, 4: 0.561, 6: 0.561 };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1800, height: 1400 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`http://localhost:${srv.address().port}/harness.html`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__pfReady === true);
await p.evaluate(() => document.fonts.ready);

let SET;
if (realPath) {
  const d = JSON.parse(readFileSync(resolve(process.cwd(), realPath), 'utf8'));
  SET = { real: d };
  // 실데이터는 사진 주소가 상대경로라 그 폴더를 함께 서빙해야 한다 — 여기선 비율만 필요하므로 생략하고
  // sizeText 에서 뽑은 비율을 쓴다(엔진의 폴백 경로와 같다).
  await p.evaluate(async (x) => {
    window.__SET = x;
    const urls = [...new Set(x.real.images.map((i) => i.url).filter(Boolean))];
    const out = {};
    await Promise.all(urls.map((u) => new Promise((done) => {
      const im = new Image();
      im.onload = () => { if (im.naturalWidth) out[u] = im.naturalWidth / im.naturalHeight; done(); };
      im.onerror = () => done();
      im.src = u;
    })));
    x.real.aspects = out;
  }, SET);
} else {
  // 합성 작품 사진 — 비율만 실제 회화 분포를 따르는 색면(개인정보 없음)
  await p.evaluate((A) => {
    const mk = (a, i) => {
      const H = 900, W = Math.round(H * a);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = `hsl(${(i * 47) % 360} 34% 62%)`; x.fillRect(0, 0, W, H);
      x.fillStyle = `hsl(${(i * 47 + 60) % 360} 44% 44%)`;
      x.beginPath(); x.arc(W / 2, H / 2, Math.min(W, H) / 3, 0, 7); x.fill();
      return c.toDataURL('image/png');
    };
    for (const a of Object.values(A)) {
      a.aspects = {};
      a.images.forEach((im, i) => { im.url = mk(im.aspect, i); a.aspects[im.url] = im.aspect; });
    }
    window.__SET = A;
  }, ARTISTS);
  SET = ARTISTS;
}

if (shots) mkdirSync(`${HERE}/score`, { recursive: true });

/** 페이지 하나를 그려 원시 측정값을 뽑는다 (브라우저 안에서 실행) */
const MEASURE = async (artist, design) => {
  const theme = window.PF.themeById('archive');
  const pages = window.PF.buildPortfolioPages(window.__SET[artist], theme, { design });
  const dim = window.PF.PAGE_DIMS[design.page ?? 'a4-portrait'];
  const host = document.getElementById('host');
  const load = (r) => Promise.all([...r.querySelectorAll('img')]
    .map((im) => (im.complete && im.naturalWidth) ? 0 : new Promise((d) => { im.onload = im.onerror = d; })));
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g) || [0, 0, 0];
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]);
  };
  const contrast = (a, b2) => { const la = lum(a), lb = lum(b2); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const bgOf = (el, root) => {
    for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
    }
    return getComputedStyle(root).backgroundColor || 'rgb(255,255,255)';
  };

  const out = [];
  for (let i = 0; i < pages.length; i++) {
    host.innerHTML = pages[i].html;
    const root = host.firstElementChild;
    await load(root);
    const R = root.getBoundingClientRect();
    const area = R.width * R.height;

    // 넘침 — overflow:hidden 이라 조용히 잘린다
    let over = 0;
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      over = Math.max(over, r.bottom - R.bottom, r.right - R.right, R.top - r.top, R.left - r.left);
    }

    // 작품 — 지면점유 · 칸 채움 · 확대율 · 비율 보존
    let art = 0; const sizes = [], fills = [], upscale = [], skew = [];
    for (const im of root.querySelectorAll('img')) {
      if (!im.naturalWidth) continue;
      const r = im.getBoundingClientRect();
      const k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
      const aw = im.naturalWidth * k, ah = im.naturalHeight * k;
      art += aw * ah; sizes.push(aw * ah);
      upscale.push(aw / im.naturalWidth);
      skew.push(Math.abs((aw / ah) / (im.naturalWidth / im.naturalHeight) - 1));
      const par = im.parentElement;
      const pb = getComputedStyle(par).backgroundColor;
      const pr = par.getBoundingClientRect();
      if (pb && !/rgba\(0, 0, 0, 0\)|transparent/.test(pb) && pr.width > 4 && pr.height > 4) {
        fills.push((aw * ah) / (pr.width * pr.height));
      }
    }

    // 내용 상자 — 위/아래 빈 자리 (여백이 뜻이 있나, 사고인가)
    // ⚠️ **러닝 머리말·꼬리말은 내용이 아니다.** 그건 페이지 가구(page furniture)라 늘 맨 위/맨 아래에
    //    붙어 있다. 그걸 내용으로 세면 세로 중앙 정렬된 페이지가 전부 "위쪽 여백 0 / 아래쪽 여백 38%"
    //    로 나와 **멀쩡한 페이지가 실패로 찍힌다**(실제로 연락처 장이 전 조합에서 최악으로 잡혔다).
    //    `page()` 는 내용을 패딩 있는 relative div 에 담으므로 그 안쪽만 본다.
    const padEl = [...root.children].find((el) => {
      const c = getComputedStyle(el);
      return c.position === 'relative' && parseFloat(c.paddingTop) > 0;
    }) || root;
    const pcs = getComputedStyle(padEl), prc = padEl.getBoundingClientRect();
    const BOX = {
      top: prc.top + parseFloat(pcs.paddingTop || '0'), bottom: prc.bottom - parseFloat(pcs.paddingBottom || '0'),
      left: prc.left + parseFloat(pcs.paddingLeft || '0'), right: prc.right - parseFloat(pcs.paddingRight || '0'),
    };
    const BOXH = Math.max(1, BOX.bottom - BOX.top), BOXW = Math.max(1, BOX.right - BOX.left);
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity, minFont = 99, bad = 0, texts = 0;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      const rr = el.getBoundingClientRect();
      if (!rr.width || !rr.height) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      minFont = Math.min(minFont, fs);
      texts += 1;
      // 작은 글자(<18px)는 AA 4.5:1, 큰 글자는 3:1
      const need = fs >= 18 ? 3 : 4.5;
      if (contrast(cs.color, bgOf(el, root)) < need) bad += 1;
      if (padEl.contains(el)) {
        top = Math.min(top, rr.top); bottom = Math.max(bottom, rr.bottom);
        left = Math.min(left, rr.left); right = Math.max(right, rr.right);
      }
    }
    for (const im of padEl.querySelectorAll('img')) {
      const rr = im.getBoundingClientRect();
      if (!rr.width) continue;
      top = Math.min(top, rr.top); bottom = Math.max(bottom, rr.bottom);
      left = Math.min(left, rr.left); right = Math.max(right, rr.right);
    }
    const voidTop = Number.isFinite(top) ? Math.max(0, top - BOX.top) / BOXH : 0;
    const voidBottom = Number.isFinite(bottom) ? Math.max(0, BOX.bottom - bottom) / BOXH : 0;

    out.push({
      i, label: pages[i].label, kind: pages[i].kind ?? null, works: pages[i].works ?? 0,
      composition: pages[i].composition ?? null,
      over: Math.round(over), cover: art / area,
      sizes, fills, upscale, skew,
      voidTop, voidBottom,
      contentH: Number.isFinite(top) ? (bottom - top) / BOXH : 0,
      box: [Math.round(BOX.left - R.left), Math.round(BOX.top - R.top), Math.round(BOXW), Math.round(BOXH)],
      cellH: [...padEl.querySelectorAll('img')].map((im) => Math.round(im.parentElement.getBoundingClientRect().height)),
      minFont, badContrast: bad, texts,
    });
  }
  return { dim, pages: out };
};

// 브라우저 안에 설치 (Node 쪽 클로저를 안 쓰는 순수 함수라 문자열로 넘겨도 안전하다)
await p.evaluate((src) => { window.__measure = (0, eval)(`(${src})`); }, MEASURE.toString());

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 원시 측정값 → 점수 + 약점 목록 (§26·§27) */
function grade(m) {
  const P = m.pages;
  const W = P.filter((x) => x.works > 0);            // 작품이 실린 장(시리즈 여는 장 포함)
  const wk = [];                                     // 약점

  // ── 구성 20 : 지면점유(골든 대비) + 칸 채움 ──
  const covScore = mean(W.map((x) => {
    const g = GOLDEN_COVER[Math.min(6, x.works)] ?? 0.5;
    return clamp01(x.cover / g);                     // 골든에 닿으면 만점, 절반이면 0.5
  }));
  const fill = mean(W.flatMap((x) => x.fills));
  const composition = 14 * covScore + 6 * (W.some((x) => x.fills.length) ? clamp01((fill - 0.7) / 0.3) : 1);
  if (covScore < 0.8) wk.push({ w: (0.8 - covScore) * 14, t: `작품이 지면에서 작다 (골든 대비 ${(covScore * 100) | 0}%)`, why: '여백·캡션 예약이 크거나 배열이 판형과 안 맞는다' });
  if (fill && fill < 0.9) wk.push({ w: (0.9 - fill) * 20, t: `칸에 빈 자리가 남는다 (채움 ${(fill * 100) | 0}%)`, why: '칸 크기가 작품 비율을 따라가지 않는다' });

  // ── 위계 15 : 작품 크기가 다 같으면 위계가 없다 ──
  const all = W.flatMap((x) => x.sizes);
  const cv = all.length > 1 ? Math.sqrt(mean(all.map((v) => (v - mean(all)) ** 2))) / mean(all) : 0;
  // ⚠️ **작품이 적으면 위계를 잴 수 없다.** 1~6점짜리 포트폴리오는 한 장에 한 점이 정답이고
  //    그러면 크기가 비슷한 게 당연하다 — 그걸 감점하면 "작품을 더 그려라"는 채점이 된다.
  //    쪽당 1점 구성도 마찬가지다(위계는 크기가 아니라 지면 자체가 만든다).
  const perPage = W.length ? mean(W.map((x) => x.works)) : 1;
  const gradable = all.length > 6 && perPage > 1.2;
  const hierarchy = gradable ? 15 * clamp01(cv / 0.35) : 15;
  if (gradable && cv < 0.2) wk.push({ w: (0.2 - cv) * 40, t: `작품 크기가 거의 같다 (편차 ${cv.toFixed(2)})`, why: '모든 작품을 같은 칸에 넣고 있다 — 무엇이 중요한지 알 수 없다' });

  // ── 타이포 15 : 최소 글자 크기 + 대비 ──
  const minFont = Math.min(...P.map((x) => x.minFont));
  const badRatio = P.reduce((s, x) => s + x.badContrast, 0) / Math.max(1, P.reduce((s, x) => s + x.texts, 0));
  const typography = 8 * clamp01((minFont - 8) / 3) + 7 * (1 - clamp01(badRatio * 10));
  if (minFont < 10) wk.push({ w: (10 - minFont) * 4, t: `너무 작은 글자 ${minFont.toFixed(1)}px`, why: '인쇄하면 안 읽힌다' });
  if (badRatio > 0.02) wk.push({ w: badRatio * 120, t: `대비 미달 글자 ${(badRatio * 100).toFixed(1)}%`, why: '배경색과 글자색 조합이 WCAG 기준에 못 미친다' });

  // ── 여백 10 : 위/아래 빈 자리 비대칭 = '사고로 생긴 여백' ──
  // ⚠️ **작품 장에만 적용한다.** CV·약력은 위에서부터 읽어 내려가는 문서라 아래가 남는 게 맞고
  //    (위아래를 맞추려면 억지로 늘려야 한다), 연락처는 원래 차분한 장이다. 전 페이지에 걸면
  //    멀쩡한 문서형 페이지가 매번 '최악'으로 잡힌다 — 실제로 CV 가 늘 최악으로 나왔다.
  const spaceable = W.length ? W : P;
  const asym = mean(spaceable.map((x) => Math.abs(x.voidTop - x.voidBottom)));
  const spacing = 10 * (1 - clamp01(asym / 0.25));
  const worstAsym = [...spaceable].sort((a, b) => Math.abs(b.voidTop - b.voidBottom) - Math.abs(a.voidTop - a.voidBottom))[0];
  if (asym > 0.1) wk.push({ w: asym * 60, t: `위아래 여백이 어긋난다 (평균 ${(asym * 100) | 0}%, 최악 ${worstAsym?.label})`, why: '내용을 배치하고 남은 자리가 그대로 빈 자리가 됐다' });

  // ── 이미지 15 : 자르지 않았나 · 늘리지 않았나 · 원본보다 키우지 않았나 ──
  const maxSkew = Math.max(0, ...W.flatMap((x) => x.skew));
  const maxUp = Math.max(0, ...W.flatMap((x) => x.upscale));
  const image = 9 * (maxSkew < 0.01 ? 1 : 0) + 6 * (1 - clamp01((maxUp - 1) / 1.5));
  if (maxSkew >= 0.01) wk.push({ w: 30, t: `작품 비율이 바뀌었다 (최대 ${(maxSkew * 100).toFixed(1)}%)`, why: '회화에서 비율은 작품 그 자체다 — 규칙 18 위반' });
  if (maxUp > 1.6) wk.push({ w: (maxUp - 1.6) * 8, t: `원본보다 ${maxUp.toFixed(1)}배 확대`, why: '사진이 뭉개진다' });

  // ── 일관성 10 : 본문 상자가 장마다 같은가 · 같은 구성의 칸 높이가 같은가 ──
  // ⚠️ '내용이 시작하는 x'로 재면 안 된다 — 가운데 정렬한 글 컬럼은 원래 안쪽에서 시작한다.
  //    그건 디자인이지 불일치가 아니다(첫 판에서 멀쩡한 문서가 전부 4/10 으로 찍혔다).
  //    재야 할 것은 **본문 상자(패딩 박스) 자체**와 **같은 구성의 칸 높이**다.
  const body = P.filter((x) => x.kind !== 'cover' && x.box);
  const boxKeys = new Set(body.map((x) => x.box.join(',')));
  // ⚠️ **칸 높이 비교는 폐기했다.** 세 번 다르게 재 봤지만 결국 두 가지를 못 가른다 —
  //    ①장마다 캡션 예약이 다시 계산되는 사고 ②한 행에 가로로 넓은 작품이 들어 그 행만 낮아지는 의도
  //    (justified row: 파노라마가 든 행은 실제 도록에서도 낮다). 후자가 훨씬 흔해서 지표가
  //    멀쩡한 문서를 계속 실패로 찍었다. ①은 구조로 보장된다 — `solveGrid` 의 입력은
  //    (정원·테마·디자인·전체 기하)뿐이고 그 장의 작품이 안 들어간다. 회귀는
  //    `portfolioArtDirection.test.ts` 의 '캡션 예약은 전체 작품에서 뽑는다' 가 잡는다.
  const consistency = 10 * (boxKeys.size <= 1 ? 1 : clamp01(1 - (boxKeys.size - 1) / 3));
  if (boxKeys.size > 1) wk.push({ w: (boxKeys.size - 1) * 8, t: `본문 상자가 장마다 다르다 (${boxKeys.size}가지)`, why: '여백이 페이지 종류마다 따로 계산되고 있다' });

  // ── 편집 10 : 같은 구성 연속 · 거의 빈 장 ──
  let run = 1, maxRun = 1;
  for (let i = 1; i < W.length; i++) { run = W[i].works === W[i - 1].works ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  // ⚠️ '빈 장'은 **차분한 장**과 다르다. 연락처·짧은 CV 는 원래 여백이 넓은 게 맞고(그것도 리듬이다),
  //    잡으려는 건 한두 문장이 지면을 통째로 차지한 장이다 — 내용 높이가 본문 상자의 20% 미만.
  const sparse = P.filter((x) => x.kind !== 'cover' && x.works === 0 && x.contentH > 0 && x.contentH < 0.2).length;
  const editorial = 6 * (1 - clamp01((maxRun - 3) / 12)) + 4 * (1 - clamp01(sparse / Math.max(1, P.length * 0.15)));
  if (maxRun > 5) wk.push({ w: (maxRun - 5) * 1.5, t: `같은 구성이 ${maxRun}장 연속`, why: '작품 수를 상수로 나눈 결과 — 편집이 아니라 채우기다' });
  if (sparse > 0) wk.push({ w: sparse * 4, t: `거의 빈 장 ${sparse}장`, why: '글이 짧은데 한 장을 통째로 썼다' });

  // ── 표지 5 : 위아래 균형 ──
  const c0 = P[0];
  const coverAsym = Math.abs(c0.voidTop - c0.voidBottom);
  const cover = 5 * (1 - clamp01(coverAsym / 0.3));
  if (coverAsym > 0.15) wk.push({ w: coverAsym * 20, t: `표지 위아래가 기울었다 (${(coverAsym * 100) | 0}%)`, why: '사진 높이를 못박고 글을 그 아래 붙였다' });

  // 하드 실패 — 잘림
  const over = P.filter((x) => x.over > 1);
  let total = composition + hierarchy + typography + spacing + image + consistency + editorial + cover;
  if (over.length) { total -= Math.min(40, over.length * 8); wk.push({ w: 100, t: `내용이 잘렸다 ${over.length}장 (최대 ${Math.max(...over.map((x) => x.over))}px)`, why: '페이지가 overflow:hidden 이라 에러 없이 조용히 잘린다' }); }

  const strongest = [...W].sort((a, b) => b.cover - a.cover)[0];
  const weakest = [...W].sort((a, b) => a.cover - b.cover)[0];
  return {
    total: Math.max(0, Math.round(total * 10) / 10),
    parts: {
      구성: +composition.toFixed(1), 위계: +hierarchy.toFixed(1), 타이포: +typography.toFixed(1),
      여백: +spacing.toFixed(1), 이미지: +image.toFixed(1), 일관성: +consistency.toFixed(1),
      편집: +editorial.toFixed(1), 표지: +cover.toFixed(1),
    },
    stats: { pages: P.length, workPages: W.length, cover: +(mean(W.map((x) => x.cover)) * 100).toFixed(1), fill: +(fill * 100).toFixed(1), cv: +cv.toFixed(2), maxRun, sparse, over: over.length, minFont: +minFont.toFixed(1) },
    strongest: strongest && `${strongest.label} (${(strongest.cover * 100) | 0}%)`,
    weakest: weakest && `${weakest.label} (${(weakest.cover * 100) | 0}%)`,
    weaknesses: wk.sort((a, b) => b.w - a.w).slice(0, 5).map((x) => ({ 항목: x.t, 원인: x.why })),
  };
}

const rows = [];
for (const artist of Object.keys(SET)) {
  for (const [dname, over] of Object.entries(DESIGNS)) {
    const key = `${artist}:${dname}`;
    if (only && only !== key) continue;
    const design = { ...BASE, ...over };
    const m = await p.evaluate(({ a, d }) => window.__measure(a, d), { a: artist, d: design })
      .catch((e) => ({ err: String(e).slice(0, 200) }));
    if (m.err) { console.log(`✗ ${key}  ${m.err}`); continue; }
    const g = grade(m);
    rows.push({ key, ...g });
    console.log(
      `${key.padEnd(18)} ${String(g.total).padStart(5)}점  ` +
      Object.entries(g.parts).map(([k, v]) => `${k}${String(v).padStart(5)}`).join(' ') +
      `  | ${g.stats.pages}쪽 점유${String(g.stats.cover).padStart(5)}% 채움${String(g.stats.fill).padStart(5)}% 편차${g.stats.cv} 반복${g.stats.maxRun} 빈${g.stats.sparse} 잘림${g.stats.over}`,
    );
    if (g.weaknesses.length) for (const w of g.weaknesses.slice(0, 2)) console.log(`      · ${w.항목} — ${w.원인}`);
  }
}

writeFileSync(`${HERE}/score.json`, JSON.stringify(rows, null, 1));
const avg = rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0;
console.log(`\n평균 ${avg.toFixed(1)}점 / ${rows.length}조합`);
const worst = [...rows].sort((a, b) => a.total - b.total).slice(0, 3);
console.log('가장 낮은 조합:', worst.map((r) => `${r.key}(${r.total})`).join(' · '));
console.log('에러:', errs.length ? [...new Set(errs)].slice(0, 4) : '없음');
if (existsSync(`${HERE}/score.json`)) console.log(`→ ${HERE}/score.json`);
await b.close();
srv.close();
