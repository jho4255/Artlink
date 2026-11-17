/**
 * 커뮤니티 화면 눈으로 보기 — 목록(전체·카드 탭·목록 탭)·글 화면을 PC·휴대폰으로 찍는다(화면 크기 스크린샷, 스크롤 위치 여러 곳).
 *   node scratchpad/community-editor/look.js [chromium|webkit] [desktop|mobile] [as=<email>]
 * 결과: scratchpad/community-editor/out/look-<engine>-<form>-<name>-<n>.png
 * 글 번호는 API 로 제목을 찾아 정한다(데모 채우기 seed-community-demo.ts 가 만든 글).
 */
const { BASE, API, session, launch, devices, path } = require('./lib');
const engine = process.argv[2] || 'chromium';
const form = process.argv[3] || 'desktop';
const asArg = process.argv.find((a) => a.startsWith('as='));

async function findPost(title) {
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${API}/community?sort=recent&page=${page}`);
    const j = await r.json();
    const hit = (j.posts || []).find((p) => p.title === title);
    if (hit) return hit.id;
    if (!j.posts?.length) break;
  }
  return null;
}

(async () => {
  const browser = await launch(engine);
  let storageState;
  if (asArg) {
    const email = asArg.slice(3);
    const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const j = await r.json();
    storageState = session({ ...j.user }).storage;
  }
  const ctxOpts = form === 'mobile' ? { ...devices['iPhone 13'], storageState } : { viewport: { width: 1280, height: 900 }, storageState };
  if (engine === 'chromium' && form === 'mobile') delete ctxOpts.defaultBrowserType;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  const out = (name, n) => path.join(__dirname, 'out', `look-${engine}-${form}-${name}-${n}.png`);
  const vh = form === 'mobile' ? 844 : 900;

  async function shoot(url, name, stops = [0, 1, 2]) {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const s of stops) {
      const y = Math.min(s * (vh - 120), Math.max(0, total - vh));
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(500);
      await page.screenshot({ path: out(name, s) });
      if (y >= total - vh) break;
    }
    // 가로로 밀리는가
    const sx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sx > 0) errors.push(`${name}: 가로로 ${sx}px 밀림`);
    console.log(`· ${name} — 높이 ${total}`);
  }

  await shoot('/community', 'all', [0, 1, 2, 3]);
  await shoot('/community?tab=worklog', 'worklog', [0, 1]);
  await shoot('/community?tab=qna', 'qna', [0]);
  const ids = {
    water: await findPost('물 번짐을 붙잡는 세 번의 겹칠'),
    cloudy: await findPost('흐린 날 오후, 작은 전시장에서'),
    check: await findPost('전시 2주 전 체크리스트'),
    photo: await findPost('작품 사진, 휴대폰 하나로 제대로 찍는 법'),
    qna: await findPost('캔버스 뒷면에 작품 정보 적을 때 뭘로 쓰세요?'),
  };
  console.log('글 번호', ids);
  if (ids.water) await shoot(`/community/${ids.water}`, 'read-water', [0, 1, 2, 3, 4, 5]);
  if (ids.cloudy) await shoot(`/community/${ids.cloudy}`, 'read-cloudy', [0, 1, 2, 3]);
  if (ids.photo) await shoot(`/community/${ids.photo}`, 'read-photo', [0, 1, 2, 3, 4]);
  if (ids.check) await shoot(`/community/${ids.check}`, 'read-check', [0, 1]);
  if (ids.qna) await shoot(`/community/${ids.qna}`, 'read-qna', [0, 1]);
  console.log(errors.length ? `오류 ${errors.length}개:\n  ${errors.join('\n  ')}` : '오류 없음');
  await browser.close();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
