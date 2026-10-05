/**
 * 히어로 배너 글자 색(검정/흰색) 하니스 — 2026-10-05 (사용법은 README.md 「글자 색」)
 *
 * `/api/hero-slides` 와 이미지를 가로채 넣으므로 DB 를 건드리지 않는다. 비회원 기록 요청도 막는다.
 * 슬라이드마다 사진 위 요소(자세히 보기·제목·넘김 표시·화살표)와 얇은 배너의 아래 줄을 찾아
 *   ① 그 요소의 글자 색  ② 글자를 잠깐 숨기고 찍은 **그 자리의 실제 배경 픽셀**
 * 을 out/tone/*.json·png 로 남긴다. 판정(명암비)은 tone_check.py 가 한다 — 화면이 고른 색을 화면 밖에서 다시 잰다.
 */
const fs = require('fs');
const path = require('path');
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, 'out', process.env.TAG || 'tone');
const IMG = path.join(__dirname, 'img');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');

const slide = (id, img, extra = {}) => ({
  id, title: '테스트 배너', description: '', imageUrl: `/heroimg/${img}`, mobileImageUrl: null, linkUrl: '/exhibitions', order: id, textTone: null, ...extra,
});
const SCENARIOS = {
  'A 실서버 배너(밝은 종이색, 제목 공백)': [slide(12, '1789702744423-real.jpg', { title: ' ', linkUrl: '/exhibitions/17' })],
  'B 어두운 배너': [slide(1, '1789702744424-dark.jpg', { description: 'OPEN CALL' })],
  'C 밝은 배너 + 오른쪽 위만 어두움': [slide(1, '1789702744425-darkcorner.jpg')],
  'D 어두운 배너 + 오른쪽 위만 밝음': [slide(1, '1789702744426-lightcorner.jpg')],
  'E 16:9 하늘 + 두 장': [slide(1, '1789702744427-sky.jpg'), slide(2, '1789702744424-dark.jpg')],
  'F 관리자가 흰색으로 고정(밝은 배너)': [slide(1, '1789702744423-real.jpg', { title: ' ', textTone: 'white' })],
  'G 썸네일 없는 옛 업로드(밝은 배너)': [slide(1, 'old-light.jpg')],
  'H 모바일 4:5 이미지': [slide(1, '1789702744423-real.jpg', { title: ' ', mobileImageUrl: '/heroimg/1789702744428-mobile.jpg' })],
};
const SCREENS = {
  'PC 1920x1080': { viewport: { width: 1920, height: 1080 } },
  'PC 1440x900': { viewport: { width: 1440, height: 900 } },
  'PC 1366x768': { viewport: { width: 1366, height: 768 } },
  'PC 1280x800': { viewport: { width: 1280, height: 800 } },
  'PC 1024x768': { viewport: { width: 1024, height: 768 } },
  'iPad Mini 768': devices['iPad Mini'],
  'iPhone 13 390': devices['iPhone 13'],
};

const BEACON_TRAP = () => {
  const orig = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  navigator.sendBeacon = (url, data) => (String(url).includes('/api/guest-activity') || String(url).includes('/api/visits') ? true : orig ? orig(url, data) : false);
};

/** 화면에서 글자 색을 읽어 올 요소들 — 슬라이드 i 의 것과 공용(화살표·넘김 표시), 얇은 배너의 아래 줄 */
function collect(page, i) {
  return page.evaluate((i) => {
    const hero = document.querySelector('[data-testid="home-hero"]');
    const slideEl = hero.querySelector(`[data-index="${i}"]`);
    const pick = [];
    // Tailwind v4 는 oklch() 로 색을 낸다 — 1px 캔버스로 rgba 로 바꿔 넘긴다
    const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    const toRgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return `rgba(${d[0]},${d[1]},${d[2]},${(d[3] / 255).toFixed(3)})`; };
    const add = (name, el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const cs = getComputedStyle(el);
      // 넘김 표시·화살표는 글자가 아니라 배경/선 색을 본다
      const color = toRgb(name.startsWith('dot') ? getComputedStyle(el).backgroundColor : cs.color);
      pick.push({ name, x: r.x, y: r.y, w: r.width, h: r.height, color, shadow: cs.textShadow });
    };
    add('button', [...slideEl.querySelectorAll('button')].find((b) => b.textContent.includes('자세히')));
    add('title', slideEl.querySelector('h2'));
    // 지금 장의 표시(가장 긴 선) — 옅은(40%) 표시가 아니라
    const dot = [...hero.querySelectorAll('button[aria-label$="번째 슬라이드로 이동"] span')].filter((s) => !s.closest('[data-hero-caption]') && s.offsetWidth > 0).sort((a, b) => b.offsetWidth - a.offsetWidth)[0];
    add('dot', dot);
    const prev = hero.querySelector('button[aria-label="이전 슬라이드"] span');
    const next = hero.querySelector('button[aria-label="다음 슬라이드"] span');
    add('arrowL', prev); add('arrowR', next);
    const cap = document.querySelector('[data-hero-caption]');
    if (cap) {
      add('cap-title', cap.querySelector('h2'));
      add('cap-button', [...cap.querySelectorAll('button')].find((b) => b.textContent.includes('자세히')));
    }
    // 사진이 실제로 앉은 자리(contain)
    const img = slideEl.querySelector('img');
    const b = img.getBoundingClientRect();
    let cw = b.width, ch = b.height;
    if (img.naturalWidth) { const k = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight); cw = img.naturalWidth * k; ch = img.naturalHeight * k; }
    const imgRect = { x: b.x + (b.width - cw) / 2, y: b.y + (b.height - ch) / 2, w: cw, h: ch };
    return { pick, imgRect, src: (img.currentSrc || '').split('/').pop() };
  }, i);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const [engName, eng, opts] of [['chromium', chromium, {}], ['webkit', webkit, { executablePath: WEBKIT_RUN }]]) {
    if (process.env.ENGINE && process.env.ENGINE !== engName) continue;
    if (engName === 'webkit' && !fs.existsSync(WEBKIT_RUN)) { console.log('WebKit 준비 안 됨 — bash scratchpad/hero/setup-webkit.sh'); continue; }
    const b = await eng.launch(opts);
    for (const [scrName, dev] of Object.entries(SCREENS)) {
      if (process.env.SCREEN && !scrName.includes(process.env.SCREEN)) continue;
      for (const [scName, slides] of Object.entries(SCENARIOS)) {
        if (process.env.ONLY && !scName.startsWith(process.env.ONLY)) continue;
        const { defaultBrowserType: _ignored, ...d } = dev;
        const ctx = await b.newContext(d);
        await ctx.addInitScript(BEACON_TRAP);
        const p = await ctx.newPage();
        await p.route('**/api/visits', (r) => r.fulfill({ status: 204 }));
        await p.route('**/api/guest-activity', (r) => r.fulfill({ status: 204 }));
        await p.route('**/api/hero-slides', (r) => r.fulfill({ json: slides }));
        await p.route('**/heroimg/**', (r) => {
          const rel = new URL(r.request().url()).pathname.replace(/^\/heroimg\//, '');
          const file = path.join(IMG, rel);
          if (!fs.existsSync(file)) return r.fulfill({ status: 404, body: 'nf' });
          return r.fulfill({ body: fs.readFileSync(file), contentType: 'image/jpeg' });
        });
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        try {
          await p.waitForFunction(() => { const im = document.querySelector('[data-testid="home-hero"] picture img'); return !!im && im.complete && im.naturalWidth > 0; }, null, { timeout: 15000 });
        } catch { /* 측정 실패로 드러난다 */ }
        await p.waitForTimeout(1200);   // 글자 색 판정(썸네일 받기 → 재기)이 끝날 시간
        const key = `${engName}-${scrName}-${scName}`.replace(/[^\w가-힣.-]+/g, '_');
        for (let i = 0; i < slides.length; i++) {
          if (i > 0) {
            await p.evaluate((i) => { const t = document.querySelector('[data-testid="home-hero"] [data-index]').parentElement; t.style.scrollSnapType = 'none'; t.scrollLeft = i * t.clientWidth; }, i);
            await p.waitForTimeout(500);
          }
          const m = await collect(p, i);
          await p.screenshot({ path: path.join(OUT, `${key}-s${i}.png`) });
          // 글자를 숨기고 같은 자리를 찍는다 — 그 자리의 '실제 배경'
          await p.addStyleTag({ content: '[data-testid="home-hero"] *, [data-hero-caption] * { color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; } [data-testid="home-hero"] button span { opacity: 0 !important; } [data-testid="home-hero"] *, [data-hero-caption] * { transition: none !important; }' });
          await p.waitForTimeout(300);   // 사파리는 전환(transition)이 끝나기 전에 찍혀 넘김 표시가 남았다
          await p.screenshot({ path: path.join(OUT, `${key}-s${i}-bg.png`) });
          rows.push({ eng: engName, screen: scrName, sc: scName, slide: i, shot: `${key}-s${i}`, dpr: d.deviceScaleFactor || 1, ...m });
          await p.evaluate(() => document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('color: transparent !important')) s.remove(); }));
        }
        await ctx.close();
      }
    }
    await b.close();
  }
  fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(rows, null, 1));
  console.log(`${rows.length}개 슬라이드 측정 → ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
