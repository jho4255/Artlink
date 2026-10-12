/**
 * 돌아온 작가 재현 (2026-10-12, 실서버 '초원' — 10/8 가입·로그인 유지 → 10/12 다시 열었는데 아무것도 안 했다)
 * ① 옛 빌드(OLD_DIST)를 띄워 로그인된 채로 연다 — 서비스워커가 옛 판을 받아 둔다
 * ② 서버를 새 빌드(NEW_DIST)로 바꾼다(같은 주소·같은 브라우저 저장소)
 * ③ 다시 연다 — 옛 판이 먼저 뜨고, 새 서비스워커가 들어와 새로고침하고, 팝업이 뜨는가
 * 로컬 데모 DB 전용(seed-nudge-demo 의 '일부채움' 계정). 사용: node scratchpad/homepage-edit/returning-artist.js <OLD_DIST> <NEW_DIST> [mobile]
 */
const path = require('path'); const fs = require('fs'); const { spawn, execSync } = require('child_process');
const { chromium, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const [OLD_DIST, NEW_DIST] = process.argv.slice(2, 4).map((p) => path.resolve(p)); const MODE = process.argv[4];
const servers = new Set(); process.on('exit', () => servers.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch {} }));
const FE = path.resolve(__dirname, '../../frontend'); const BACKEND = path.resolve(__dirname, '../../backend');
const PORT = 4173, BASE = `http://localhost:${PORT}`, API = 'http://localhost:4000/api';
const env = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m)[1];
if (/prod/i.test(env)) { console.error('데모 DB 전용'); process.exit(1); }

function preview(dist) {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`빌드가 없다: ${dist}`);
  const p = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: FE, stdio: 'pipe', detached: true }); servers.add(p);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('preview 시작 실패')), 30000);
    p.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(p); } });
  });
}
const stop = (p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch {} servers.delete(p); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  execSync('npx tsx scripts/seed-nudge-demo.ts', { cwd: BACKEND, stdio: 'pipe' });
  const acc = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nudge.partial@demo.artlink.local' }) })).json();
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ret-'));
  const opts = MODE === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 800 } };
  const ctx = await chromium.launchPersistentContext(dir, { ...opts, serviceWorkers: 'allow' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const nudge = page.getByRole('dialog', { name: '홈페이지에 아직 빈 곳이 있어요' });
  let loads = 0; page.on('load', () => { loads++; });

  // ① 10/8 — 옛 판, 로그인된 채로
  let srv = await preview(OLD_DIST);
  await page.goto(BASE + '/');
  await page.evaluate(([t, u]) => localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 })), [acc.token, acc.user]);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 });
  await sleep(2500);
  console.log('① 처음 판(로그인 유지)으로 연 뒤 — 팝업:', await nudge.count());
  // LONG_OPEN=1 — 탭을 열어 둔 채로 배포된다(옛 화면이 그대로 열려 있다) → 새 워커가 넘겨받으면 새로고침돼 새 판이어야 한다
  if (process.env.LONG_OPEN) {
    const ver = () => page.evaluate(() => [...document.scripts].map((x) => x.src).filter((x) => /assets\/index-/.test(x)).map((x) => x.split('/').pop()).join(','));
    console.log('   열어 둔 화면:', await ver());
    stop(srv); await sleep(1500); srv = await preview(NEW_DIST);
    loads = 0;
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));   // 브라우저가 주기적으로 하는 업데이트 확인
    for (let i = 0; i < 60 && loads === 0; i++) await sleep(500);
    await sleep(3000);
    console.log(`   배포 뒤 — 새로고침 ${loads}번(1 이 맞다) · 지금 화면: ${await ver()}`);
    await ctx.close(); stop(srv); fs.rmSync(dir, { recursive: true, force: true }); return;
  }
  // 처음 판에서 팝업이 떴다면 답하지 않고 닫은 셈 치고, 그날 기록은 지운다(③을 '다른 날'로 본다)
  await page.evaluate(() => { localStorage.removeItem('artlink-homepage-nudge-seen'); sessionStorage.clear(); });
  await page.goto('about:blank');
  stop(srv); await sleep(1500);

  // ② 배포 — 새 판으로 바꾼다
  srv = await preview(NEW_DIST);

  // ③ 10/12 — 다시 연다. 로드·팝업이 언제 생겼다 사라졌는지 탭 저장소에 적어 둔다(새로고침을 넘어 남는다)
  await page.addInitScript(() => {
    const T0 = Number(sessionStorage.getItem('trace-t0') || Date.now()); sessionStorage.setItem('trace-t0', String(T0));
    const log = (m) => { const a = JSON.parse(sessionStorage.getItem('trace') || '[]'); a.push(`${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`); sessionStorage.setItem('trace', JSON.stringify(a)); };
    const ver = () => [...document.scripts].map((s) => s.src).filter((s) => /assets\/index-/.test(s)).map((s) => s.split('/').pop()).join(',');
    // NEXT-DEPLOY-MARK — 다음 배포 빌드의 index.html 에만 넣어 둔 표시. 있으면 '서버에서 새로 받은 화면', 없으면 '미리 받아 둔 옛 화면'
    document.addEventListener('DOMContentLoaded', () => log(`페이지 로드 ${ver()} ${document.documentElement.innerHTML.includes('NEXT-DEPLOY-MARK') ? '(새 index — 서버)' : '(옛 index)'}`));
    let shown = false;
    new MutationObserver(() => {
      const on = !!document.querySelector('[data-testid="homepage-nudge"]');
      if (on !== shown) { shown = on; log(on ? '팝업 뜸' : '팝업 사라짐'); }
    }).observe(document, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => { if (shown) log('팝업이 떠 있는 채로 페이지가 바뀜'); });
  });
  loads = 0; const t0 = Date.now();
  await page.goto(BASE + (process.env.START_PATH || '/'));   // START_PATH=/exhibitions — 첫 주소가 아닌 곳으로 들어올 때
  const firstHasDaily = await page.evaluate(() => [...document.scripts].map((s) => s.src).join(' '));
  // ANSWER_EARLY=1 — 처음 뜬 팝업(아직 옛 판)에 곧바로 [나중에]. 새 판으로 바뀐 뒤 다시 뜨면 안 된다(두 번 뜨지 않는다)
  if (process.env.ANSWER_EARLY) {
    for (let i = 0; i < 40; i++) { if (await nudge.count()) { await nudge.getByRole('button', { name: '나중에' }).click().catch(() => {}); console.log('   (옛 판에서 바로 [나중에])'); break; } await sleep(250); }
    await sleep(12000);
    console.log('   새 판으로 바뀐 뒤 팝업:', await nudge.count(), '(0 이 맞다 — 두 번 뜨지 않는다)');
    console.log('   타임라인:\n     ' + JSON.parse(await page.evaluate(() => sessionStorage.getItem('trace') || '[]')).join('\n     '));
    await ctx.close(); stop(srv); fs.rmSync(dir, { recursive: true, force: true }); return;
  }
  let shownAt = null;
  for (let i = 0; i < 60; i++) { if (await nudge.count()) { shownAt = Date.now() - t0; break; } await sleep(500); }
  await sleep(10000);   // 떴다면 10초 뒤에도 남아 있는가(새로고침이 지우지 않았는가)
  console.log('   10초 뒤에도 팝업이 떠 있나:', (await nudge.count()) > 0);
  console.log(`③ 다시 열기 — 페이지 로드 ${loads}번(새 서비스워커가 바꿔 끼우면 2) · 팝업 ${shownAt != null ? `${(shownAt / 1000).toFixed(1)}초에 떴다` : '30초 동안 안 떴다'}`);
  console.log('   처음 받은 스크립트:', firstHasDaily.split(' ').filter((s) => /assets\/index-/.test(s)).map((s) => s.split('/').pop()).join(', '),
    '→ 지금:', (await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => /assets\/index-/.test(s)).map((s) => s.split('/').pop()).join(', '))));
  await sleep(1000);
  console.log('   타임라인:\n     ' + JSON.parse(await page.evaluate(() => sessionStorage.getItem('trace') || '[]')).join('\n     '));
  console.log('   그날 본 기록:', await page.evaluate(() => localStorage.getItem('artlink-homepage-nudge-seen')));
  if (shownAt != null) await page.screenshot({ path: path.join(__dirname, 'out-upload', `returning-${MODE || 'pc'}.png`) });

  // ④ 같은 날 다시 — 안 떠야 한다
  await page.getByRole('button', { name: '나중에' }).click().catch(() => {});
  await page.reload(); await sleep(3000);
  console.log('④ 같은 날 새로고침 — 팝업:', await nudge.count(), '(0 이 맞다)');
  await ctx.close(); stop(srv); fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(0));
