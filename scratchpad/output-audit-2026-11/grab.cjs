// 갤러리가 내려받는 결과물을 화면의 버튼으로 전부 받아 out/ 에 둔다 — 데모 DB 전용(5183 → 4001).
// 사용: node scratchpad/output-audit-2026-11/grab.cjs <공모 번호> [only]
const path = require('path');
const fs = require('fs');
const pw = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const BASE = 'http://localhost:5183', API = 'http://localhost:4001/api';
const EX = Number(process.argv[2]);
const ONLY = process.argv[3] || '';
const OUT = path.join(__dirname, process.env.OUTDIR || 'out');
fs.mkdirSync(OUT, { recursive: true });
if (!EX) { console.error('공모 번호를 주세요'); process.exit(1); }

const login = async (email) => (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })).json();
const run = (k) => !ONLY || k.includes(ONLY);

(async () => {
  const browser = await pw.chromium.launch();
  const who = await login('gallery@artlink.com');
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlink-auth', value: JSON.stringify({ state: { token: who.token, user: who.user, isAuthenticated: true }, version: 0 }) },
      { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(who.user.id)]: true }) },
    ] }] },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const grab = async (label, act, timeout = 600000) => {
    const t0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), act()]);
    const name = dl.suggestedFilename();
    const to = path.join(OUT, name);
    await dl.saveAs(to);
    const kb = Math.round(fs.statSync(to).size / 1024);
    console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}초 · ${kb.toLocaleString()}KB · ${name}`);
    await page.waitForTimeout(800);
  };
  const open = async (view) => {
    await page.goto(`/mypage?tab=my-exhibitions&ex=${EX}&view=${view}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  };

  if (run('sub')) {
    await open('submissions');
    await page.screenshot({ path: path.join(OUT, '_screen-submissions.png') });
    for (const label of (process.env.LABELS ? process.env.LABELS.split(',') : ['작품 리스트(PDF)', '작품 리스트(엑셀)', '출품 자료 PDF(ZIP)', '작품 원본(ZIP)', '작품 캡션(HWP)', '도록 PDF'])) {
      if (ONLY && ONLY !== 'sub' && !label.includes(ONLY.replace('sub:', ''))) continue;
      await grab(label, () => page.getByRole('button', { name: label }).first().click());
    }
  }
  if (run('settle')) {
    await open('settlement');
    await page.screenshot({ path: path.join(OUT, '_screen-settlement.png') });
    for (const label of ['전체 정산서 PDF', '현금 정산서', '카드 정산서']) {
      await page.getByRole('button', { name: '정산서 받기' }).click();
      await grab(label, () => page.getByRole('menuitem', { name: new RegExp(label) }).first().click());
    }
    // 판매가 있는 첫 작가의 정산서
    const first = page.locator('[data-settle-artist]').first();
    await first.getByRole('button', { name: '정산서', exact: true }).click();
    await grab('작가 정산서', () => page.getByRole('menuitem', { name: /정산서 PDF/ }).first().click());
  }
  if (run('app')) {
    await open('applicants');
    await page.screenshot({ path: path.join(OUT, '_screen-applicants.png') });
    await page.getByRole('button', { name: /지원서 전체 받기/ }).first().click().catch(async () => {
      await page.getByRole('button', { name: '관리' }).click();
      await page.getByRole('menuitem', { name: /지원서 전체 받기/ }).click();
    });
    const dl = await page.waitForEvent('download', { timeout: 600000 });
    const to = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(to);
    console.log(`지원서 전체: ${Math.round(fs.statSync(to).size / 1024).toLocaleString()}KB · ${dl.suggestedFilename()}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
