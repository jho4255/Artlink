// ArtLook [액자] 탭 — 묶음 이름·설명이 어떻게 보이는지 PC·휴대폰으로 찍는다 (2026-10-26)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const OUT = '/home/jho4255/ArtLink/scratchpad/frameit/out/';
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h, tag] of [[1280, 1100, 'pc'], [390, 844, 'm']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => (window.__artlookRenders || 0) > 0, null, { timeout: 60000 });
  await p.locator('#tab-frames').click(); await p.waitForTimeout(800);
  if (tag === 'pc') { await p.locator('.panel').screenshot({ path: OUT + 'panel_pc.png' }); await p.locator('#panes').evaluate((e) => e.scrollTo(0, 99999)); await p.waitForTimeout(300); await p.locator('.panel').screenshot({ path: OUT + 'panel_pc2.png' }); }
  else { await p.locator('.chip.frame[data-id="floater-oak"]').click(); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + 'panel_m.png' }); }
  console.log(tag, await p.evaluate(() => [...document.querySelectorAll('#frames > *')].map((e) => e.classList.contains('group') ? '\n[' + e.textContent + '] ' : (e.dataset.id || e.id)).join(' ')));
  console.log(tag, 'line:', await p.locator('#framesLine').textContent(), 'visible:', await p.locator('#framesLine').isVisible());
  await p.close();
}
await b.close();
