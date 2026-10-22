// [벽에 걸어 보기] 첫 그림 시간 — 부모·iframe 시각을 맞춰 단계별로(iframe 생성·준비·사진 받기·합성·화면). 실서버 복제본(5173)이 떠 있어야 한다.
//   node scratchpad/wall-view/timing.mjs   (RUNS=3 · HOVER=400 이면 버튼에 0.4초 올렸다 누른다 · ARTIST=/@핸들 — 기본은 데모 작가)
// [벽에 걸어 보기] 첫 그림까지 시간이 어디서 쓰이나 — 부모·iframe 시각을 절대 시각(timeOrigin+now)으로 맞춰 단계별로 잰다
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = process.env.APP || 'http://localhost:5183';
const ARTIST = process.env.ARTIST || '/@seojin.yoon';
const RUNS = Number(process.env.RUNS || 3);
const BEACON_TRAP = `(() => { const o = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (u, d) => (/\\/api\\/(guest-activity|visits)/.test(String(u)) ? true : (o ? o(u, d) : true)); })();`;
const INSTR = `(() => {
  const abs = () => performance.timeOrigin + performance.now();
  if (/[?&]view=1/.test(location.search)) {
    // iframe — compose 를 감싸 시간을 잰다(함수 선언은 전역 객체 속성이라 바꿔 끼우면 맨 이름 호출도 이걸 탄다)
    window.__ifr = { compose: [] };
    document.addEventListener('DOMContentLoaded', () => {
      window.__ifr.dcl = abs();
      const orig = window.compose;
      if (typeof orig === 'function') window.compose = function () { const a = abs(); const r = orig.apply(this, arguments); window.__ifr.compose.push([a, abs()]); return r; };
    });
    window.addEventListener('load', () => { window.__ifr.load = abs(); });
    return;
  }
  window.__t = { msgs: [] };
  window.addEventListener('message', (e) => { const d = e.data; if (d && typeof d.type === 'string' && d.type.startsWith('artlook:')) window.__t.msgs.push([d.type, abs()]); }, true);
  new MutationObserver(() => {
    if (!window.__t.iframe && document.querySelector('iframe[data-wall-view]')) window.__t.iframe = abs();
    const el = document.querySelector('[data-view="wall"]');
    const q = el && el.getAttribute('data-quality');
    if (q && !window.__t['dom_' + q]) window.__t['dom_' + q] = abs();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-quality', 'src'] });
  document.addEventListener('load', (e) => {
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-view') === 'wall') { const q = el.getAttribute('data-quality'); if (q && !window.__t['load_' + q]) window.__t['load_' + q] = abs(); }
  }, true);
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && b.textContent.trim() === '벽에 걸어 보기' && !window.__t.click) window.__t.click = abs(); }, true);
})();`;

const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (let run = 0; run < RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  await ctx.addInitScript(BEACON_TRAP);
  await ctx.addInitScript(INSTR);
  await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  await page.goto(APP + ARTIST, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
  const first = page.locator('figure button.cursor-zoom-in').nth(run % 5);
  await first.scrollIntoViewIfNeeded();
  await first.click();
  const viewer = page.getByTestId('artwork-viewer');
  await page.locator('[data-view="photo"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const btn = viewer.getByRole('button', { name: '벽에 걸어 보기' });
  if (process.env.HOVER) { await btn.hover(); await page.waitForTimeout(Number(process.env.HOVER)); }
  await btn.click();
  await page.locator('[data-view="wall"][data-quality="draft"]').waitFor({ timeout: 30000 });
  await page.locator('[data-view="wall"][data-quality="full"]').waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource').filter((r) => /t800|artlink\/\d|image-proxy/.test(r.name) && r.initiatorType === 'fetch')
      .map((r) => ({ name: r.name.replace(/^.*\//, '').slice(0, 50), start: performance.timeOrigin + r.startTime, end: performance.timeOrigin + r.responseEnd, kb: Math.round(r.transferSize / 1024) }));
    return { ...window.__t, res };
  });
  const fr = page.frames().find((f) => /view=1/.test(f.url()));
  const it = fr ? await fr.evaluate(() => ({ ...window.__ifr, origin: performance.timeOrigin,
    res: performance.getEntriesByType('resource').map((r) => ({ name: r.name.replace(/^.*\//, '').slice(0, 40), start: performance.timeOrigin + r.startTime, end: performance.timeOrigin + r.responseEnd, kb: Math.round(r.transferSize / 1024) })),
    nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { start: performance.timeOrigin + n.startTime, respEnd: performance.timeOrigin + n.responseEnd } : null; })() })) : null;
  const c = t.click;
  const rel = (x) => (x == null ? '—' : `${Math.round(x - c)}ms`);
  const msg = (type, k = 0) => (t.msgs.filter((m) => m[0] === type)[k] || [])[1];
  console.log(`\n■ run ${run + 1}`);
  console.log(`  iframe 생성 ${rel(t.iframe)} · iframe 문서 응답 ${rel(it?.nav?.respEnd)} · DOMContentLoaded ${rel(it?.dcl)} · load ${rel(it?.load)}`);
  for (const r of it?.res || []) console.log(`    iframe 자원 ${r.name.padEnd(40)} ${rel(r.start)} → ${rel(r.end)} (${r.kb}KB)`);
  console.log(`  view-ready ${rel(msg('artlook:view-ready'))}`);
  for (const r of t.res) console.log(`    작품 받기 ${r.name.padEnd(50)} ${rel(r.start)} → ${rel(r.end)} (${r.kb}KB)`);
  (it?.compose || []).forEach(([a, b], k) => console.log(`    compose #${k + 1} ${rel(a)} → ${rel(b)} (${Math.round(b - a)}ms)`));
  console.log(`  rendered #1 ${rel(msg('artlook:rendered'))} · draft DOM ${rel(t.dom_draft)} · draft load ${rel(t.load_draft)}`);
  console.log(`  rendered #2 ${rel(msg('artlook:rendered', 1))} · full DOM ${rel(t.dom_full)} · full load ${rel(t.load_full)}`);
  await ctx.close();
}
await browser.close();
