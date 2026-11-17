const { chromium } = require('/home/jho4255/ArtLink/e2e/node_modules/@playwright/test');
(async () => {
  const b = await chromium.launch();
  const out = process.argv[2];
  const views = [['m', 390, 844, 3], ['pc', 1440, 900, 1]];
  const pages = [['list', '/exhibitions'], ['detail', '/exhibitions/52'], ['detail2', '/exhibitions/44'], ['gal', '/galleries']];
  const res = {};
  for (const [vn, w, h, dpr] of views) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: vn === 'm' ? 2 : 1, isMobile: vn === 'm', hasTouch: vn === 'm' });
    const p = await ctx.newPage();
    for (const [pn, url] of pages) {
      await p.goto('http://localhost:5173' + url, { waitUntil: 'networkidle' });
      await p.waitForTimeout(1200);
      await p.screenshot({ path: `${out}/${pn}-${vn}-fold.png` });
      const m = await p.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const top = (el) => el ? Math.round(el.getBoundingClientRect().top + scrollY) : null;
        const r = { docH: document.documentElement.scrollHeight };
        const cards = [...document.querySelectorAll('main a[href^="/exhibitions/"], main a[href^="/galleries/"], main a[href^="/@"]')].filter(a => a.querySelector('img,div'));
        r.firstCardTop = cards[0] ? top(cards[0]) : null;
        r.firstCardH = cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : null;
        r.cards = cards.length;
        r.h1 = top(q('h1')); r.h1Text = q('h1')?.textContent?.slice(0, 30);
        const h2s = [...document.querySelectorAll('h2')].map(e => [e.textContent.slice(0, 12), top(e)]);
        r.h2s = h2s;
        const bar = q('[data-apply-bar]'); r.applyBar = bar ? Math.round(bar.getBoundingClientRect().top) : null;
        const ps = [...document.querySelectorAll('p')].filter(e => ['공모 유형','모집 인원','공모 기간','전시 기간','지역'].includes(e.textContent.trim())).map(e => [e.textContent.trim(), top(e)]);
        r.info = ps;
        return r;
      });
      res[`${pn}-${vn}`] = m;
      await p.screenshot({ path: `${out}/${pn}-${vn}-full.png`, fullPage: true });
    }
    await ctx.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
