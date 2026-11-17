/**
 * 홈페이지 개편(규칙 82) 화면 찍기 — 비회원으로 작가·갤러리 홈페이지를 PC·휴대폰으로 열어 본다.
 * ⚠️ 로컬 전용(실서버 복제본 또는 데모 DB). 가상 계정(@community-demo.example.com)만 연다 — 실제 가입자 홈페이지를 찍지 않는다.
 *   node scratchpad/homepage-product/shot.js [artistPath] [galleryPath]
 * 결과: 세션 스크래치(OUT) 아래 PNG + 콘솔에 기하 숫자.
 */
const { BASE, launch, devices, path } = require('../community-editor/lib');

const OUT = process.env.OUT || '/tmp/claude-1000/-home-jho4255-ArtLink/aabb9dca-5a67-40f0-bba1-6510126c6f16/scratchpad/hp-impl';
const ARTIST = process.argv[2] || '/@hanjiwoo.studio';
const GALLERY = process.argv[3] || '/galleries/23';
const ENGINES = (process.env.ENGINES || 'chromium').split(',');

(async () => {
  for (const engine of ENGINES) {
    const browser = await launch(engine);
    for (const form of ['desktop', 'mobile']) {
      const o = form === 'mobile' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 800 } };
      if (engine === 'chromium' && form === 'mobile') delete o.defaultBrowserType;
      const ctx = await browser.newContext(o);
      // 비회원 소개 팝업·자동화 표시 — 홈페이지 주소엔 원래 안 뜬다
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      for (const [name, url] of [['artist', ARTIST], ['gallery', GALLERY]]) {
        await page.goto(`${BASE}${url}`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(700);
        const geo = await page.evaluate(() => {
          const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
          return {
            navbar: !!document.querySelector('nav a[href="/artists"]'),
            header: r('[data-testid="site-header"]'),
            coverArt: r('[data-testid="homepage-cover-art"] img'),
            h1: r('h1'),
            actions: r('[data-testid="homepage-actions"]'),
            tabsVisible: [...document.querySelectorAll('[role="tablist"]')].filter((t) => t.getClientRects().length).map((t) => t.getAttribute('aria-label') + ':' + [...t.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()).join('/')),
            scrollW: document.documentElement.scrollWidth, vw: window.innerWidth,
          };
        });
        console.log(engine, form, name, JSON.stringify(geo));
        await page.screenshot({ path: path.join(OUT, `${name}-${engine}-${form}.png`) });
        await page.screenshot({ path: path.join(OUT, `${name}-${engine}-${form}-full.png`), fullPage: true });
      }
      if (errors.length) console.log('PAGE ERRORS', errors);
      await ctx.close();
    }
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
