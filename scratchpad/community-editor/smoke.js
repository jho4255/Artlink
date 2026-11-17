/**
 * 글쓰기 연기 시험 — 쓰기 → 사진 → 자동 저장 → 새로고침 뒤 그대로 → 등록 → 글 화면. 콘솔 오류를 모은다.
 *   node scratchpad/community-editor/smoke.js [chromium|webkit] [desktop|mobile]
 */
const { BASE, session, launch, devices, path } = require('./lib');
const engine = process.argv[2] || 'chromium';
const form = process.argv[3] || 'desktop';
const IMG = path.resolve(__dirname, '../../frontend/public/demo-art');

(async () => {
  const browser = await launch(engine);
  const s = session({ id: 1, name: 'Artist 1', email: 'artist1@artlink.com', role: 'ARTIST' });
  const ctxOpts = form === 'mobile'
    ? { ...devices['iPhone 13'], storageState: s.storage, ...(engine === 'chromium' ? { defaultBrowserType: undefined } : {}) }
    : { viewport: { width: 1280, height: 900 }, storageState: s.storage };
  if (engine === 'chromium' && form === 'mobile') delete ctxOpts.defaultBrowserType;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const step = (t) => console.log(`· ${t}`);

  await page.goto(`${BASE}/community/write`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
  step('편집기 열림');
  await page.fill('#post-title', '연기 시험 — 전시 준비 일지');
  await page.click('.ProseMirror');
  await page.keyboard.type('첫 문단입니다. 작업실 바닥에 그림을 늘어놓았다.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('둘째 문단.');
  step('제목·본문 입력');
  // 사진 두 장 — 여러 장이면 물음 창
  const chooser = page.waitForEvent('filechooser');
  if (form === 'mobile') await page.getByRole('button', { name: '사진 넣기' }).first().click();
  else await page.getByRole('button', { name: '사진 넣기' }).first().click();
  const fc = await chooser;
  await fc.setFiles([path.join(IMG, 'quiet-afternoon.jpg'), path.join(IMG, 'blue-wall.jpg')]);
  await page.getByRole('dialog', { name: /사진 2장/ }).waitFor();
  await page.getByRole('button', { name: '사진 넣기' }).last().click();
  step('모아 놓기로 넣기');
  await page.waitForFunction(() => !document.body.innerText.includes('올리는 중'), null, { timeout: 30000 });
  step('사진 올라감');
  await page.waitForFunction(() => /저장됨/.test(document.querySelector('[data-post-editor] header [role=status]')?.textContent || ''), null, { timeout: 30000 });
  step(`자동 저장됨 · 주소 ${page.url().replace(BASE, '')}`);
  await page.screenshot({ path: path.join(__dirname, 'out', `smoke-${engine}-${form}-1.png`) });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
  const title = await page.inputValue('#post-title');
  const text = await page.locator('.ProseMirror').innerText();
  step(`새로고침 뒤 — 제목 "${title}" · 본문 ${text.includes('둘째 문단') ? '그대로' : '사라짐!'} · 사진칸 ${await page.locator('.post-gallery-cell').count()}`);
  await page.getByRole('button', { name: '등록' }).click();
  await page.waitForURL(/\/community\/\d+$/, { timeout: 20000 });
  step(`등록 → ${page.url().replace(BASE, '')}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'out', `smoke-${engine}-${form}-2.png`), fullPage: true });
  console.log(errors.length ? `오류 ${errors.length}개:\n  ${errors.join('\n  ')}` : '오류 없음');
  await browser.close();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
