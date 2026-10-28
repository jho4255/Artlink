/**
 * 공모 일정 달력 + 홈페이지 프로필 사진 — 실제 브라우저로 눌러 보고 찍는다 (2026-10-28)
 * 로컬 데모(5183 → 4000)에서만. 계정: gallery@artlink.com · intro-sample@artlink.test(윤서진)
 *   node scratchpad/schedule-picker/shot.js            (크롬)
 *   ENGINE=webkit node scratchpad/schedule-picker/shot.js
 * 결과 그림: scratchpad/schedule-picker/out/
 */
const fs = require('fs');
const path = require('path');
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4000/api';
const OUT = path.join(__dirname, 'out');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
if (/artlink\.cc|onrender|4001|5173/.test(BASE + API)) { console.error('⛔ 데모 서버에서만'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const kst = (n = 0) => { const k = new Date(Date.now() + 9 * 3600e3 + n * 864e5); return k.toISOString().slice(0, 10); };
async function devLogin(email) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(`dev-login ${email} ${r.status}`);
  return r.json();
}
const storage = (acc) => ({ cookies: [], origins: [{ origin: BASE, localStorage: [
  { name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) },
  { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(acc.user.id)]: 8.64e15 }) },
  { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(acc.user.id)]: true }) },
] }] });

async function pickDay(page, ymd) {
  for (let i = 0; i < 24; i++) {
    const day = page.locator(`[data-schedule-day="${ymd}"]`);
    if (await day.count() && await day.first().isVisible()) { await day.first().click(); return; }
    await page.getByRole('button', { name: '다음 달' }).click();
  }
  throw new Error('날짜를 못 찾음 ' + ymd);
}

(async () => {
  const fail = [];
  const ok = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✓' : '✗'} ${m}`); };
  const engName = process.env.ENGINE || 'chromium';
  const eng = engName === 'webkit' ? webkit : chromium;
  const b = await eng.launch(engName === 'webkit' ? { executablePath: WEBKIT_RUN } : {});
  const gallery = await devLogin('gallery@artlink.com');
  const artist = await devLogin('intro-sample@artlink.test');
  const screens = { pc: { viewport: { width: 1280, height: 900 } }, phone: (({ defaultBrowserType, ...d }) => d)(devices['iPhone 13']) };

  for (const [scr, dev] of Object.entries(screens)) {
    // ── 공모 등록 달력 ──
    const ctx = await b.newContext({ ...dev, storageState: storage(gallery) });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/exhibitions/new`);
    await p.locator('#ex-start').waitFor({ timeout: 20000 });
    await p.locator('#ex-start').scrollIntoViewIfNeeded();
    await p.locator('#ex-start').click();
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, `${engName}-${scr}-1-open.png`) });
    const yesterday = p.locator(`[data-schedule-day="${kst(-1)}"]`);
    if (await yesterday.count()) ok(await yesterday.isDisabled(), `${scr} 어제는 흐리게(누를 수 없음)`);
    ok(await p.locator(`[data-schedule-day="${kst(0)}"]`).isEnabled(), `${scr} 오늘은 고를 수 있다`);
    const months = await p.locator('[role="grid"]').count();
    ok(scr === 'pc' ? months === 2 : months === 1, `${scr} 달 ${months}개`);

    await pickDay(p, kst(1));
    ok(await p.locator('[aria-label="공모 마감일 달력"]').isVisible(), `${scr} 시작을 고르면 마감으로 넘어간다`);
    ok(await p.locator(`[data-schedule-day="${kst(0)}"]`).isDisabled(), `${scr} 마감 고르기: 시작 전날은 흐리게`);
    // 끝 날 미리보기(마우스) — PC 만
    if (scr === 'pc') { await p.locator(`[data-schedule-day="${kst(14)}"]`).hover(); await p.waitForTimeout(150); await p.screenshot({ path: path.join(OUT, `${engName}-${scr}-2-hover.png`) }); }
    await pickDay(p, kst(14));
    ok(await p.locator('[aria-label="출품 자료 제출 마감일 달력"]').isVisible(), `${scr} 마감 → 자료 제출`);
    ok(await p.locator(`[data-schedule-day="${kst(14)}"]`).first().isDisabled(), `${scr} 자료 제출: 마감 당일은 흐리게`);
    await pickDay(p, kst(21));
    await pickDay(p, kst(28));
    await p.screenshot({ path: path.join(OUT, `${engName}-${scr}-3-end.png`) });
    await pickDay(p, kst(42));
    ok(await p.locator('[role="grid"]').count() === 0, `${scr} 마지막을 고르면 닫힌다`);
    const texts = await p.locator('[data-schedule-field]').allInnerTexts();
    ok(texts.every((t) => /\d{4}\. \d+\. \d+/.test(t)), `${scr} 다섯 칸 채워짐 ${texts.join(' | ')}`);
    await p.locator('#ex-start').scrollIntoViewIfNeeded();
    const summary = await p.locator('p', { hasText: /^한눈에 ·/ }).first().innerText().catch(() => '');
    ok(/지원 .* · 자료 제출 .* · 전시/.test(summary), `${scr} 한눈에 줄: ${summary}`);
    await p.screenshot({ path: path.join(OUT, `${engName}-${scr}-4-filled.png`), fullPage: false });
    // 시작을 전시 뒤로 → 뒤가 비워지고 마감으로 넘어간다
    await p.locator('#ex-start').click();
    await pickDay(p, kst(50));
    const after = await p.locator('[data-schedule-field]').allInnerTexts();
    ok(after.slice(1).every((t) => t.includes('날짜 선택')), `${scr} 시작을 뒤로 옮기면 뒤 칸이 비워진다`);
    await p.keyboard.press('Escape');
    ok(await p.locator('[role="grid"]').count() === 0, `${scr} Esc 로 닫힌다`);
    // 포스터 — 가로로 긴 사진을 올려도 잘리지 않는다(목록 카드처럼 contain + 흐린 배경)
    const wide = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/demo-art/horizon.jpg'));
    await p.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'poster.jpg', mimeType: 'image/jpeg', buffer: wide });
    const prev = p.getByTestId('hero-image-preview').first();
    await prev.waitFor({ timeout: 20000 });
    await prev.evaluate((img) => img.decode?.());
    const fit = await prev.evaluate((img) => getComputedStyle(img).objectFit);
    ok(fit === 'contain', `${scr} 포스터 미리보기 object-fit=${fit}`);
    await prev.scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, `${engName}-${scr}-0-poster.png`) });
    const ox = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(ox <= 0, `${scr} 가로 넘침 ${ox}`);
    ok(errors.length === 0, `${scr} 페이지 오류 ${errors.join(';')}`);
    await ctx.close();
  }

  // ── 주최 공모(관리자) 달력 ──
  {
    const admin = await devLogin('admin@artlink.com');
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: storage(admin) });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/mypage?tab=hosted-exhibitions`);
    await p.getByRole('button', { name: '주최 공모 등록' }).click();
    await p.locator('#hosted-start').scrollIntoViewIfNeeded();
    await p.locator('#hosted-start').click();
    await p.waitForTimeout(300);
    await pickDay(p, kst(2));
    await pickDay(p, kst(9));
    await p.screenshot({ path: path.join(OUT, `${engName}-pc-hosted.png`) });
    ok(await p.locator('[aria-label="출품 자료 제출 마감일 달력"]').isVisible(), 'hosted 마감 → 자료 제출');
    await ctx.close();
  }

  // ── 홈페이지 프로필 사진 ──
  const photo = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/demo-art/dawn-window.jpg'));
  for (const [scr, dev] of Object.entries(screens)) {
    const ctx = await b.newContext({ ...dev, storageState: storage(artist) });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/mypage?tab=homepage-edit&section=intro`);
    await p.getByTestId('show-avatar').waitFor({ timeout: 20000 });
    if (scr === 'pc') {
      await p.getByTestId('homepage-avatar-input').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: photo });
      await p.getByText('프로필 사진을 바꿨어요.').waitFor({ timeout: 20000 });
      ok(await p.getByTestId('show-avatar').isChecked(), 'pc 사진을 올리면 보이기가 켜진다');
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(OUT, `${engName}-pc-5-editor.png`) });
      // 이미 켜져 있었으면(두 번째 실행) 고친 게 없어 [저장] 대신 [내 홈페이지 보기] 가 놓인다
      const saveBtn = p.locator('[data-save-bar]').getByRole('button', { name: '저장', exact: true });
      if (await saveBtn.count()) { await saveBtn.click(); await p.waitForURL(/@seojin\.yoon|portfolio/, { timeout: 15000 }); }
    }
    // 주인 화면 — [수정] 은 머리말 오른쪽 위, 이름·사진과 겹치지 않는다
    await p.goto(`${BASE}/@seojin.yoon`);
    const edit = p.getByTestId('homepage-owner-action');
    await edit.waitFor({ timeout: 20000 });
    await p.waitForTimeout(600);
    const eb = (await edit.boundingBox());
    const hb = (await p.getByRole('heading', { level: 1 }).boundingBox());
    const ab = (await p.getByTestId('homepage-avatar').boundingBox().catch(() => null));
    const vw = p.viewportSize().width;
    const overlap = (x, y) => x && y && !(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y);
    ok(eb && eb.x + eb.width > vw * 0.7, `${scr} [수정] 오른쪽 (x ${Math.round(eb?.x)}~${Math.round(eb?.x + eb?.width)} / ${vw})`);
    ok(eb && eb.y <= (ab ? ab.y : hb.y) + 8, `${scr} [수정] 맨 위 (y ${Math.round(eb?.y)} · 머리말 ${Math.round((ab ?? hb).y)})`);
    ok(!overlap(eb, hb) && !overlap(eb, ab), `${scr} [수정] 이 이름·사진과 안 겹친다`);
    await p.screenshot({ path: path.join(OUT, `${engName}-${scr}-7-owner.png`) });
    const g = await b.newContext({ ...dev });
    const gp = await g.newPage();
    await gp.goto(`${BASE}/@seojin.yoon`);
    await gp.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
    await gp.waitForTimeout(800);
    ok(await gp.getByTestId('homepage-avatar').isVisible(), `${scr} 방문자 홈페이지에 프로필 사진`);
    const box = await gp.getByTestId('homepage-avatar').boundingBox();
    const h1 = await gp.getByRole('heading', { level: 1 }).boundingBox();
    ok(box && h1 && box.y + box.height <= h1.y, `${scr} 사진이 이름 위 (사진 ${Math.round(box?.width)}px)`);
    await gp.screenshot({ path: path.join(OUT, `${engName}-${scr}-6-homepage.png`) });
    await g.close();
    await ctx.close();
  }
  await b.close();
  console.log(fail.length ? `\n실패 ${fail.length}\n${fail.join('\n')}` : '\n전부 통과');
  process.exitCode = fail.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
