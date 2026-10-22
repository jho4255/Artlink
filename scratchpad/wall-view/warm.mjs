// 미리 치를 것별 효과 — 벽 사진 해독 · 광원 측정 · 텍스처 · 톤을 차례로 미리 해 두고 첫 그림을 잰다(view.js warmUp 의 근거). 5173 이 떠 있어야 한다.
// ⚠️ 지금은 view.js 가 준비 신호 전에 warmUp 을 이미 하므로 'none' 도 미리 치른 뒤다 — 처음부터 다시 재려면 view.js 의 warmUp 호출을 잠깐 빼고 돌릴 것.
//   (2026-10-22 warmUp 넣기 전, 흰 회벽·캔버스 랩, 초안 배율 0.6 이던 때: none 첫 장 605ms · 해독+광원+텍스처+톤 318ms · 둘째 장 약 190ms — 헤드리스.
//    0.6 초안은 뭉개져서 2026-10-23 에 없앴다 — 지금은 초안 1 · 완성 2)
// 첫 그림의 '처음 한 번' 비용을 미리 치르면 얼마나 줄어드나 — 단계별로 미리 해 두고 첫 그림을 잰다
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = 'http://localhost:5173';
const SRC = process.env.SRC;   // 작품 t800 주소 — 실제 작품 주소를 이 파일에 적지 말 것(실행할 때 넘긴다)
if (!SRC) { console.error('SRC=<작품 t800 주소> 를 넘겨 주세요'); process.exit(2); }
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const plan of ['none', 'decode', 'decode+light', 'decode+light+tex', 'decode+light+tex+tone']) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(APP + '/artlook/index.html?view=1');
  await page.waitForFunction(() => window.__wallView && window.__wallView.state().ready, null, { timeout: 30000 });
  const r = await page.evaluate(async ({ SRC, plan }) => {
    const blob = await (await fetch(SRC, { cache: 'reload' })).blob();
    const sc = SCENES[0];
    const steps = {};
    const T = async (name, fn) => { const t = performance.now(); await fn(); steps[name] = Math.round(performance.now() - t); };
    if (plan.includes('decode')) await T('decode', () => sc.img.decode());
    if (plan.includes('light')) await T('light', () => ArtLookScene.sceneLightModel(sc));
    if (plan.includes('tex')) await T('tex', () => {
      const c = document.createElement('canvas'); c.width = c.height = 2;
      const W = 64, H = 64;
      ArtLookScene.warp(c, [[0, 0], [W, 0], [W, H], [0, H]], W, H, { wallAmt: 0.3, sceneImg: sc.img, sceneKey: sc.src, fit: { dx: 0, dy: 0, sw: W, sh: H } });
    });
    if (plan.includes('tone')) await T('tone', () => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(sc.img, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); });
    const times = [];
    for (let k = 0; k < 2; k++) { const t = performance.now(); await window.__wallView.render(blob, 1); times.push(Math.round(performance.now() - t)); }
    return { steps, times };
  }, { SRC, plan });
  console.log(plan.padEnd(24), JSON.stringify(r.steps), '→ 첫 그림', r.times[0], 'ms · 둘째', r.times[1], 'ms');
  await page.context().close();
}
await browser.close();
