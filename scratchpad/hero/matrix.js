/**
 * 히어로 배너 잘림 전수 측정 — 엔진(크롬·사파리) × 화면 × 슬라이드 구성 (사용법은 README.md)
 *
 * `/api/hero-slides` 응답과 이미지를 가로채 넣으므로 DB 를 건드리지 않는다.
 * 판정: 사진이 contain 으로 앉았을 때의 '그림 영역'이 슬라이드 칸·트랙 안에 **전부** 들어와 있는가.
 */
const fs = require('fs');
const path = require('path');
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, 'out');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');

// 네 변 색이 다른 테스트 이미지 — 어느 변이 잘렸는지 스크린샷에서 바로 보인다
const SIZES = { w3: [2000, 667], w169: [1920, 1080], w4: [2400, 600], m45: [1080, 1350], m916: [1080, 1920], m11: [1080, 1080] };
function svg(name) {
  const [w, h] = SIZES[name];
  const t = Math.max(12, Math.round(Math.min(w, h) / 40));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#f4f0e6"/>
<line x1="0" y1="0" x2="${w}" y2="${h}" stroke="#3c3c3c" stroke-width="4"/><line x1="0" y1="${h}" x2="${w}" y2="0" stroke="#3c3c3c" stroke-width="4"/>
<rect width="${w}" height="${t}" fill="#e61e1e"/><rect y="${h - t}" width="${w}" height="${t}" fill="#1e3ce6"/>
<rect width="${t}" height="${h}" fill="#14aa3c"/><rect x="${w - t}" width="${t}" height="${h}" fill="#d21ec8"/>
<text x="${w / 2}" y="${h / 2}" font-size="${t * 3}" text-anchor="middle" fill="#000">${name} ${w}x${h}</text></svg>`;
}

const slide = (id, img, mobile, title = '테스트 배너') => ({ id, title, description: '', imageUrl: `/heroimg/${img}.svg`, mobileImageUrl: mobile ? `/heroimg/${mobile}.svg` : null, linkUrl: null, order: id });
const SCENARIOS = {
  'A 3:1 한 장·제목 공백(2026-10 실서버)': [slide(1, 'w3', null, ' ')],
  'B 3:1 + 모바일 4:5': [slide(1, 'w3', 'm45')],
  'C 3:1 + 모바일 9:16': [slide(1, 'w3', 'm916')],
  'D 3:1 + 모바일 1:1': [slide(1, 'w3', 'm11')],
  'E 3:1 과 16:9 두 장': [slide(1, 'w3', null), slide(2, 'w169', null)],
  'F 모바일 4:5 있는 장 + 없는 장': [slide(1, 'w3', 'm45'), slide(2, 'w3', null)],
  'G 16:9 한 장': [slide(1, 'w169', null)],
  'H 4:1 한 장': [slide(1, 'w4', null)],
};
const SCREENS = {
  'iPhone SE 320': devices['iPhone SE'],
  'iPhone 13 390': devices['iPhone 13'],
  'iPhone 13 가로': devices['iPhone 13 landscape'],
  'Galaxy 360': { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'Pixel 7 412': devices['Pixel 7'],
  'iPad Mini 768': devices['iPad Mini'],
  'PC 1280x720': { viewport: { width: 1280, height: 720 } },
  'PC 1920x1080': { viewport: { width: 1920, height: 1080 } },
};

function measure(page) {
  return page.evaluate(async () => {
    const track = document.querySelector('[data-testid="home-hero"] [data-index]')?.parentElement;
    if (!track) return null;
    const out = [];
    const slides = [...track.querySelectorAll('[data-index]')];
    track.style.scrollSnapType = 'none';
    for (let i = 0; i < slides.length; i++) {
      track.scrollLeft = i * track.clientWidth;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const img = slides[i].querySelector('img');
      const t = track.getBoundingClientRect(), s = slides[i].getBoundingClientRect(), b = img.getBoundingClientRect();
      const nw = img.naturalWidth, nh = img.naturalHeight;
      // object-fit: contain 일 때 그림이 실제로 차지하는 영역
      let cw = b.width, ch = b.height;
      if (getComputedStyle(img).objectFit === 'contain' && nw && nh) { const k = Math.min(b.width / nw, b.height / nh); cw = nw * k; ch = nh * k; }
      const cx = b.x + (b.width - cw) / 2, cy = b.y + (b.height - ch) / 2;
      // 보이는 창 = 트랙 ∩ 슬라이드 칸
      const L = Math.max(t.left, s.left), R = Math.min(t.right, s.right);
      const ix = Math.max(0, Math.min(R, cx + cw) - Math.max(L, cx));
      const iy = Math.max(0, Math.min(t.bottom, cy + ch) - Math.max(t.top, cy));
      out.push({
        i, src: (img.currentSrc || '').split('/').pop(), track: `${Math.round(t.width)}x${Math.round(t.height)}`,
        imgBox: `${Math.round(b.width)}x${Math.round(b.height)}`, shown: `${Math.round(cw)}x${Math.round(ch)}`,
        visible: cw && ch ? +(ix * iy / (cw * ch)).toFixed(3) : 0,
        vscroll: track.scrollHeight > track.clientHeight + 1,
      });
    }
    track.scrollLeft = 0;
    const hero = document.querySelector('[data-testid="home-hero"]');
    return { slides: out, hOverflow: document.documentElement.scrollWidth > innerWidth + 1, caption: !!document.querySelector('[data-hero-caption]'), heroH: Math.round(hero.getBoundingClientRect().height) };
  });
}

(async () => {
  const rows = [];
  if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
  for (const [engName, eng, opts] of [['chromium', chromium, {}], ['webkit', webkit, { executablePath: WEBKIT_RUN }]]) {
    if (process.env.ENGINE && process.env.ENGINE !== engName) continue;
    if (engName === 'webkit' && !fs.existsSync(WEBKIT_RUN)) { console.log('WebKit 준비 안 됨 — bash scratchpad/hero/setup-webkit.sh'); process.exitCode = 1; continue; }
    const b = await eng.launch(opts);
    for (const [scrName, dev] of Object.entries(SCREENS)) {
      for (const [scName, slides] of Object.entries(SCENARIOS)) {
        const { defaultBrowserType: _ignored, ...d } = dev;
        const ctx = await b.newContext(d);
        const p = await ctx.newPage();
        await p.route('**/api/hero-slides', (r) => r.fulfill({ json: slides }));
        await p.route('**/heroimg/*.svg', (r) => r.fulfill({ body: svg(r.request().url().split('/').pop().replace('.svg', '')), contentType: 'image/svg+xml' }));
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        try {
          await p.waitForFunction(() => { const im = document.querySelector('[data-testid="home-hero"] picture img'); return !!im && im.complete && im.naturalWidth > 0; }, null, { timeout: 15000 });
        } catch { /* 아래에서 측정 실패로 드러난다 */ }
        await p.waitForTimeout(700);
        rows.push({ eng: engName, screen: scrName, sc: scName, m: await measure(p) });
        if (process.env.SHOTS) await p.screenshot({ path: path.join(OUT, `${engName}-${scrName}-${scName}`.replace(/[^\w가-힣.-]+/g, '_') + '.png') });
        await ctx.close();
      }
    }
    await b.close();
  }
  let bad = 0;
  for (const r of rows) {
    if (!r.m) { console.log('?? 측정 실패', r.eng, r.screen, r.sc); bad++; continue; }
    for (const s of r.m.slides) {
      if (s.visible < 0.999 || s.vscroll || r.m.hOverflow) {
        bad++;
        console.log(`✗ ${r.eng.padEnd(8)} ${r.screen.padEnd(15)} ${r.sc.padEnd(30)} #${s.i} ${s.src} 트랙 ${s.track} 사진칸 ${s.imgBox} 그림 ${s.shown} 보임 ${(s.visible * 100).toFixed(1)}%${s.vscroll ? ' 세로스크롤' : ''}${r.m.hOverflow ? ' 가로넘침' : ''}`);
      }
    }
    // 제목이 공백뿐인 한 장짜리는 사진 아래에 빈 캡션 띠가 없어야 한다
    if (r.sc.startsWith('A') && r.m.caption) { bad++; console.log(`✗ ${r.eng.padEnd(8)} ${r.screen.padEnd(15)} 빈 캡션 띠가 그려졌다`); }
  }
  console.log(`\n${rows.length}개 조합 · 잘림/넘침 ${bad}건`);
  if (bad) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
