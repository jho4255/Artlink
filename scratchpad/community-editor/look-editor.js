/**
 * 글쓰기·탭 관리 눈으로 보기 — 필진(한지우)·일반 회원(김민서)·운영(ArtLink 운영팀) 계정으로 열어 찍는다.
 *   node scratchpad/community-editor/look-editor.js [chromium|webkit] [desktop|mobile]
 * 데모 채우기(backend/scripts/seed-community-demo.ts)가 만든 계정을 개발자 로그인으로 쓴다(로컬 전용).
 */
const { BASE, API, session, launch, devices, path } = require('./lib');
const engine = process.argv[2] || 'chromium';
const form = process.argv[3] || 'desktop';
const out = (name) => path.join(__dirname, 'out', `edit-${engine}-${form}-${name}.png`);

async function login(email) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(`dev-login ${email} → ${r.status}`);
  return (await r.json()).user;
}
async function findPost(title) {
  const r = await fetch(`${API}/community?sort=recent&take=30`);
  return ((await r.json()).posts || []).find((p) => p.title === title)?.id ?? null;
}

(async () => {
  const browser = await launch(engine);
  const errors = [];
  async function open(email) {
    const user = await login(email);
    const ctxOpts = form === 'mobile' ? { ...devices['iPhone 13'], storageState: session(user).storage } : { viewport: { width: 1280, height: 900 }, storageState: session(user).storage };
    if (engine === 'chromium' && form === 'mobile') delete ctxOpts.defaultBrowserType;
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${email} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${email} console: ${m.text().slice(0, 160)}`); });
    return { ctx, page };
  }

  // 1) 필진 — 새 글: 쓰던 글 안내 · 고를 수 있는 탭
  {
    const { ctx, page } = await open('han@community-demo.example.com');
    await page.goto(`${BASE}/community/write`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out('writer-new') });
    const opts = await page.locator('select').first().locator('option').allTextContents();
    console.log('· 필진 탭 고르기:', opts.join(' / '));
    const banner = await page.locator('[data-post-editor]').innerText();
    console.log('· 쓰던 글 안내:', /쓰던 글이 \d+개/.test(banner) ? '있음' : '없음');
    // 고치기 — 사진·모음·인용·팁 상자가 있는 글
    const id = await findPost('물 번짐을 붙잡는 세 번의 겹칠');
    await page.goto(`${BASE}/community/${id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: out('writer-edit-0') });
    await page.locator('[data-editor-scroll]').evaluate((el) => el.scrollTo(0, el.scrollHeight * 0.45));
    await page.waitForTimeout(800);
    await page.screenshot({ path: out('writer-edit-1') });
    await page.locator('[data-editor-scroll]').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(800);
    await page.screenshot({ path: out('writer-edit-2') });
    // 고치지 않고 나간다(작업본만 생겼다 — 지운다)
    await ctx.close();
  }
  // 2) 일반 회원 — 필진 탭은 고를 수 없다
  {
    const { ctx, page } = await open('kim@community-demo.example.com');
    await page.goto(`${BASE}/community/write`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
    const opts = await page.locator('select').first().locator('option').allTextContents();
    console.log('· 일반 회원 탭 고르기:', opts.join(' / '));
    await page.goto(`${BASE}/community?tab=worklog`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out('member-worklog') });
    await ctx.close();
  }
  // 3) 운영 — 탭 관리 · 필진
  {
    const { ctx, page } = await open('ops@community-demo.example.com');
    await page.goto(`${BASE}/community`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '탭 관리' }).click();
    const dlg = page.getByRole('dialog', { name: '탭 관리' });
    await dlg.waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('admin-tabs') });
    await dlg.getByRole('button', { name: '작업일지 설정' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('admin-tab-settings') });
    await dlg.getByRole('tab', { name: '필진' }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: out('admin-writers') });
    await dlg.getByRole('textbox', { name: '회원 찾기' }).fill('김민서');
    await dlg.getByRole('button', { name: '찾기' }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: out('admin-writers-search') });
    await ctx.close();
  }
  console.log(errors.length ? `오류 ${errors.length}개:\n  ${errors.join('\n  ')}` : '오류 없음');
  await browser.close();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
