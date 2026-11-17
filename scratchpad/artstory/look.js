/**
 * ArtStory 홈 공개(2026-11-14, 규칙 81) — 눌러서 무슨 일이 나는지 보고 찍는다.
 *   node scratchpad/artstory/look.js [chromium|webkit] [desktop|mobile]
 * 보는 것: 홈 카드 줄(가로 밀림 없음 · PC 화살표) · 보기 화면(저절로 넘김 · 누르기 · 비회원 좋아요 → 로그인 창 · 댓글 · 닫기) ·
 *          [ArtStory] 격자(비회원은 전체 탭만) · 가운데 메뉴/하단 탭의 ArtStory · 홈 아래 칸(PC: [인기글 | 마감임박 공모] · 휴대폰: 탭 순서·한 칸만) ·
 *          올리기(한 페이지: 글 바탕 → [사진] → 사진 위 글 [Aa] → 끌어 옮기기) → 홈 줄 맨 앞 · 내 소식 탭 · 관리자 [신고 관리].
 * ⚠️ 복제본·데모 DB 전용. 로그인은 가상 데모 계정(@community-demo.example.com)만. 올린 소식은 끝에서 지운다.
 */
const { BASE, API, session, launch, api, devices, path, fs } = require('../community-editor/lib');
const engine = process.argv[2] || 'chromium';
const form = process.argv[3] || 'desktop';
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const OUT = (name) => path.join(__dirname, 'out', `${engine}-${form}-${name}.png`);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function demoUser(key) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${key}@community-demo.example.com` }) });
  const j = await r.json();
  if (!j.user || !String(j.user.email || '').endsWith('@community-demo.example.com')) throw new Error(`데모 계정이 아님: ${key}`);
  return j.user;
}
const PHOTO = path.resolve(__dirname, '../../frontend/public/demo-art/blue-wall.jpg');

(async () => {
  const browser = await launch(engine);
  const ctxOf = async (user) => {
    const storageState = user ? session(user).storage : undefined;
    const o = form === 'mobile' ? { ...devices['iPhone 13'], storageState } : { viewport: { width: 1280, height: 860 }, storageState };
    if (engine === 'chromium' && form === 'mobile') delete o.defaultBrowserType;
    const ctx = await browser.newContext(o);
    // 비회원 소개 팝업은 자동화에서 안 뜬다(navigator.webdriver) — 그대로 둔다
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`); });
    return { ctx, page, errs };
  };
  const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(400); };
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // 휴대폰 홈은 탭이다(2026-11-14) — 소식 줄은 [ArtStory] 탭을 눌러야 보인다
  const openStoryTab = async (page) => { if (form === 'mobile') { await page.getByRole('tab', { name: 'ArtStory' }).click(); await page.waitForTimeout(200); } };

  // ── 비회원 ──
  {
    const { ctx, page, errs } = await ctxOf(null);
    await page.goto(`${BASE}/`); await settle(page);
    await openStoryTab(page);
    const rail = page.getByTestId('home-artstory');
    await rail.scrollIntoViewIfNeeded();
    const cards = rail.locator('[data-story-card]');
    const n = await cards.count();
    check('홈 — ArtStory 줄에 카드가 있다(한 사람당 하나)', n >= 5, `${n}장`);
    const order = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="home-hero"]')?.getBoundingClientRect().top ?? -1;
      const s = document.querySelector('[data-testid="home-artstory"]')?.getBoundingClientRect().top ?? -1;
      return { h, s };
    });
    check('홈 — 배너 아래에 줄', order.s > order.h, JSON.stringify(order));
    check('홈 — 가로로 밀리지 않는다', await noSideScroll(page));
    const texts = await rail.innerText();
    check('홈 줄에 설명 문구가 없다', !/누구나|모두가 봐요/.test(texts));
    await page.evaluate(() => window.scrollTo(0, 0));
    await rail.screenshot({ path: OUT('home-rail') });
    await page.screenshot({ path: OUT('home'), fullPage: false });

    if (form === 'desktop') {
      const next = page.getByRole('button', { name: '다음 소식 보기' });
      check('PC — 다음 화살표가 보인다', await next.isVisible());
      const before = await rail.locator('.story-rail').evaluate((el) => el.scrollLeft);
      await next.click(); await page.waitForTimeout(800);
      const after = await rail.locator('.story-rail').evaluate((el) => el.scrollLeft);
      check('PC — 화살표로 넘긴다', after > before + 300, `${before} → ${after}`);
      check('PC — 넘긴 뒤 앞 화살표', await page.getByRole('button', { name: '앞 소식 보기' }).isVisible());
      await rail.screenshot({ path: OUT('home-rail-paged') });
      await page.getByRole('button', { name: '앞 소식 보기' }).click(); await page.waitForTimeout(700);
    }

    // 보기 화면 — 첫 카드(사진 두 장짜리)
    await cards.first().click();
    const dlg = page.locator('[data-story-viewer]');
    await dlg.waitFor({ state: 'visible', timeout: 8000 });
    const name0 = await dlg.getAttribute('aria-label');
    check('보기 화면이 열린다', !!name0, name0);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT('viewer-1') });
    const segs = await dlg.locator('[data-story-progress]').count();
    check('진행 막대가 차오른다', segs === 1);
    // 저절로 넘어간다 — 사진 5초(+받는 시간)
    const segBefore = await page.evaluate(() => { const el = document.querySelector('[data-story-progress]'); return el ? [...el.parentElement.parentElement.children].indexOf(el.parentElement) : -1; });
    await page.waitForTimeout(6200);
    const label1 = await dlg.getAttribute('aria-label');
    const segAfter = await page.evaluate(() => { const el = document.querySelector('[data-story-progress]'); return el ? [...el.parentElement.parentElement.children].indexOf(el.parentElement) : -1; });
    check('저절로 넘어간다(다음 칸 또는 다음 사람)', segAfter !== segBefore || label1 !== name0, `칸 ${segBefore}→${segAfter} · ${name0} → ${label1}`);
    // 누르기 — 다음
    const labelBeforeTap = await dlg.getAttribute('aria-label');
    for (let k = 0; k < 3; k++) { await dlg.getByRole('button', { name: '다음', exact: true }).click({ position: { x: 40, y: 80 } }); await page.waitForTimeout(250); }
    const labelAfterTap = await dlg.getAttribute('aria-label');
    check('[다음]을 누르면 넘어간다', labelAfterTap !== labelBeforeTap, `${labelBeforeTap} → ${labelAfterTap}`);
    // 끝까지 넘기면 '다 봤어요'
    for (let k = 0; k < 25; k++) {
      if (await page.getByText('새 소식을 다 봤어요').isVisible().catch(() => false)) break;
      await dlg.getByRole('button', { name: '다음', exact: true }).click({ position: { x: 40, y: 80 }, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(200);
    }
    check('끝까지 보면 [새 소식을 다 봤어요]', await page.getByText('새 소식을 다 봤어요').isVisible().catch(() => false));
    await page.screenshot({ path: OUT('viewer-end') });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    // 글만 소식(김민서)
    await rail.getByRole('button', { name: '김민서님의 소식' }).click();
    await dlg.waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT('viewer-text') });
    // 비회원 좋아요 → 로그인 창
    await dlg.getByRole('button', { name: '좋아요' }).click();
    const loginSheet = page.getByRole('dialog', { name: '로그인 안내' });
    check('비회원 좋아요 → 로그인 안내 창', await loginSheet.isVisible().catch(() => false));
    await page.screenshot({ path: OUT('viewer-login') });
    await loginSheet.getByRole('button', { name: '계속 보기' }).click();
    // 댓글 — 한지우 소식으로 돌아가 본다
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Esc 로 닫힌다', !(await dlg.isVisible().catch(() => false)));
    await rail.getByRole('button', { name: '한지우님의 소식' }).click();
    await dlg.waitFor({ state: 'visible' });
    await dlg.getByRole('button', { name: '댓글' }).click();
    await page.waitForTimeout(800);
    const cm = page.getByText('창 쪽이 훨씬 낫네요.');
    check('댓글 창 — 댓글이 보인다(비회원)', await cm.isVisible().catch(() => false));
    check('댓글 창 — 비회원은 [로그인하고 댓글 쓰기]', await page.getByRole('button', { name: '로그인하고 댓글 쓰기' }).isVisible().catch(() => false));
    await page.screenshot({ path: OUT('viewer-comments') });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (form === 'desktop') {
      check('PC — 앞뒤 소식 미리보기(넓은 화면)', await dlg.locator('button[aria-label$="님의 소식으로"]').count() >= 1);
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);

    // [ArtStory] 격자
    await page.goto(`${BASE}/feed`); await settle(page);
    const tabs = await page.getByRole('tab').allInnerTexts();
    check('ArtStory — 비회원은 [전체] 탭만', tabs.length === 1 && tabs[0].includes('전체'), tabs.join(','));
    const g = await page.locator('[data-story-card]').count();
    check('ArtStory — 격자에 소식(전체)', g >= 10, `${g}장`);
    check('ArtStory — 가로로 밀리지 않는다', await noSideScroll(page));
    await page.screenshot({ path: OUT('feed-guest') });
    // ArtStory 는 가운데 메뉴(PC) / 하단 탭(휴대폰)
    const navLink = form === 'mobile'
      ? page.getByRole('navigation', { name: '하단 내비게이션' }).getByRole('link', { name: 'ArtStory' })
      : page.getByRole('navigation').first().getByRole('link', { name: 'ArtStory', exact: true });
    check(form === 'mobile' ? '하단 탭에 ArtStory' : '가운데 메뉴에 ArtStory', await navLink.isVisible().catch(() => false));
    if (form === 'mobile') {
      const tabW = await page.getByRole('navigation', { name: '하단 내비게이션' }).evaluate((nav) => [...nav.querySelectorAll('a')].map((a) => ({ w: a.getBoundingClientRect().width, sw: a.scrollWidth, cw: a.clientWidth })));
      check('하단 탭 일곱 칸 — 글자가 칸을 넘지 않는다', tabW.length === 7 && tabW.every((t) => t.sw <= t.cw + 1), tabW.map((t) => Math.round(t.w)).join(','));
    }
    // 휴대폰 홈은 탭(2026-11-14) — 순서·진행중인 전시 없음·한 칸만
    if (form === 'mobile') {
      const soonM = (d) => new Date(Date.now() + d * 86400000).toISOString();
      await page.route('**/api/exhibitions?scope=open', (r) => r.fulfill({ json: [
        { id: 9001, title: '점검용 모집 공고 하나', deadline: soonM(2), imageUrl: '', region: 'SEOUL', gallery: { name: '점검 갤러리', mainImage: '' } },
      ] }));
      await page.goto(`${BASE}/`); await settle(page);
      const tabs = await page.getByRole('tablist', { name: '홈' }).getByRole('tab').allInnerTexts();
      check('휴대폰 홈 탭 — ArtWorks · ArtStory · 인기글 · 마감임박 공모 순', tabs.slice(0, 4).join('|') === 'ArtWorks|ArtStory|인기글|마감임박 공모', tabs.join('|'));
      check('휴대폰 홈 탭 — 진행중인 전시 없음', !tabs.includes('진행중인 전시'));
      await page.getByRole('tab', { name: '마감임박 공모' }).click();
      await page.waitForTimeout(200);
      const shown = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="home-panel-"]')].filter((e) => !e.hidden).map((e) => e.dataset.testid));
      check('휴대폰 홈 탭 — 누르면 그 칸만', shown.join() === 'home-panel-closing', shown.join());
      check('휴대폰 홈 — 가로로 밀리지 않는다', await noSideScroll(page));
      await page.screenshot({ path: OUT('home-tabs-closing') });
      await page.unroute('**/api/exhibitions?scope=open');
    }
    // 홈 아래 칸(PC) — 인기글 옆이 마감임박 공모(같은 줄)
    if (form !== 'mobile') {
    // ① 지금 데이터 그대로 — 혼자 남은 칸은 두 칸 폭(반쪽이 비지 않는다)
    await page.goto(`${BASE}/`); await settle(page);
    const lone = await page.evaluate(() => [...(document.querySelector('[data-testid="home-widgets"]')?.children ?? [])].map((c) => Math.round(c.getBoundingClientRect().width)));
    const boxW = await page.evaluate(() => { const b = document.querySelector('[data-testid="home-widgets"]'); if (!b) return 0; const cs = getComputedStyle(b); return Math.round(b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); });
    if (lone.length % 2 === 1) check('홈 아래 칸 — 혼자 남은 마지막 칸은 두 칸 폭', Math.abs(lone[lone.length - 1] - boxW) <= 2, `${lone.join(',')} / ${boxW}`);
    // ② 모집 중 공모가 있을 때(실서버 13건) — 인기글 바로 옆
    const soon = (d) => new Date(Date.now() + d * 86400000).toISOString();
    await page.route('**/api/exhibitions?scope=open', (r) => r.fulfill({ json: [
      { id: 9001, title: '점검용 모집 공고 하나', deadline: soon(2), imageUrl: '', region: 'SEOUL', gallery: { name: '점검 갤러리', mainImage: '' } },
      { id: 9002, title: '점검용 모집 공고 둘', deadline: soon(6), imageUrl: '', region: 'BUSAN', gallery: { name: '점검 갤러리', mainImage: '' } },
    ] }));
    await page.goto(`${BASE}/`); await settle(page);
    const w = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="home-widgets"]');
      if (!box) return null;
      return [...box.children].map((c) => ({ h: c.querySelector('h2')?.textContent?.trim(), top: Math.round(c.getBoundingClientRect().top), left: Math.round(c.getBoundingClientRect().left), w: Math.round(c.getBoundingClientRect().width) }));
    });
    check('홈 아래 칸 — 인기글 다음이 마감임박 공모', !!w && w[0]?.h === '인기글' && w[1]?.h === '마감임박 공모', JSON.stringify(w));
    if (form !== 'mobile' && w && w.length >= 2) check('PC — 인기글과 마감임박 공모가 같은 줄', w[0].top === w[1].top && w[1].left > w[0].left, `${w[0].top}/${w[1].top}`);
    await page.locator('[data-testid="home-widgets"]').screenshot({ path: OUT('home-widgets') }).catch(() => {});
    await page.unroute('**/api/exhibitions?scope=open');
    }
    if (errs.length) console.log('  [비회원] 오류:', errs.slice(0, 5));
    check('비회원 화면 — 페이지 오류 없음', errs.length === 0, errs[0] || '');
    await ctx.close();
  }

  // ── 로그인(가상 작가 김민서) — 올리기 ──
  const kim = await demoUser('kim');
  const kimTok = session(kim).token;
  const made = [];
  {
    const { ctx, page, errs } = await ctxOf(kim);
    await page.goto(`${BASE}/`); await settle(page);
    await openStoryTab(page);
    const rail = page.getByTestId('home-artstory');
    await rail.getByRole('button', { name: '소식 올리기' }).first().click();
    await page.waitForURL(/\/story\/new/);
    await page.waitForTimeout(500);
    check('[+] → 곧바로 올리기 화면(고르는 창 없음)', (await page.getByRole('dialog').count()) === 0);
    await page.screenshot({ path: OUT('compose-empty') });
    const cap = `점검 글만 ${Date.now() % 100000}`;
    await page.getByLabel('글', { exact: true }).fill(`${cap}\n오늘은 붓을 씻기만 했다.`);
    await page.getByRole('radio', { name: '바탕색 짙은 초록' }).click();
    await page.screenshot({ path: OUT('compose-text') });
    check('올리기 화면 — 가로로 밀리지 않는다', await noSideScroll(page));
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/story/new'), { timeout: 10000 });
    await settle(page);
    const first = await page.getByTestId('home-artstory').locator('[data-story-card]').first().innerText();
    check('글만 소식을 올리면 홈 줄 맨 앞에', first.includes('김민서') && first.includes(cap), first.replace(/\n/g, ' / ').slice(0, 80));

    // 사진 소식 — 같은 화면의 [사진] → 사진 위 글 → 끌어 옮기기
    await page.getByTestId('home-artstory').getByRole('button', { name: '소식 올리기' }).first().click();
    await page.waitForURL(/\/story\/new/);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
      page.getByRole('button', { name: '사진', exact: true }).click(),
    ]);
    if (chooser) await chooser.setFiles([PHOTO]);
    else await page.locator('[data-story-file-input]').setInputFiles([PHOTO]);
    for (let k = 0; k < 40; k++) { if (await page.getByRole('button', { name: '올리기', exact: true }).isEnabled()) break; await page.waitForTimeout(250); }
    await page.getByRole('button', { name: '사진 위에 글 쓰기' }).click();
    const ed = page.getByRole('dialog', { name: '사진 위 글' });
    await ed.getByLabel('사진 위 글', { exact: true }).fill('오픈 스튜디오 토요일');
    await ed.getByRole('radio', { name: '검은 띠' }).click();
    await page.screenshot({ path: OUT('compose-overlay-editor') });
    await ed.getByRole('button', { name: '완료' }).click();
    const ov = page.locator('[data-story-compose] [data-story-overlay]');
    const b0 = await ov.boundingBox();
    check('사진 위 글이 사진 위에 얹힌다', !!b0);
    if (b0) {
      if (form === 'mobile') {
        // 손가락 — 터치 포인터로 끈다
        const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
        if (cdp) {
          const x = b0.x + b0.width / 2, y = b0.y + b0.height / 2;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + k * 10 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
          await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2 + 80, { steps: 8 }); await page.mouse.up();
        }
      } else {
        await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
        await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2 + 80, { steps: 8 }); await page.mouse.up();
      }
      await page.waitForTimeout(200);
      const b1 = await ov.boundingBox();
      check('사진 위 글을 끌어 옮긴다', !!b1 && b1.y > b0.y + 50, `${Math.round(b0.y)} → ${Math.round(b1?.y ?? 0)}`);
      check('끌어도 고치는 창이 안 열린다', !(await ed.isVisible().catch(() => false)));
    }
    const cap2 = `점검 사진 ${Date.now() % 100000}`;
    await page.locator('#story-caption').fill(cap2);
    await page.screenshot({ path: OUT('compose-photo') });
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/story/new'), { timeout: 10000 });
    await settle(page);
    const firstCard = page.getByTestId('home-artstory').locator('[data-story-card]').first();
    check('사진 소식을 올리면 홈 줄 맨 앞에', (await firstCard.getAttribute('aria-label') || '').includes('김민서'));
    check('카드에도 사진 위 글', (await firstCard.locator('[data-story-overlay]').innerText().catch(() => '')).includes('오픈 스튜디오'));
    await firstCard.screenshot({ path: OUT('card-overlay') }).catch(() => {});
    // 내 소식 보기 → 메뉴(내 것)
    await firstCard.click();
    const dlg = page.locator('[data-story-viewer]');
    await dlg.waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    check('내 소식 — 글이 보인다', await dlg.getByText(cap2).isVisible().catch(() => false));
    check('보기 화면에도 사진 위 글', (await dlg.locator('[data-story-overlay]').innerText().catch(() => '')).includes('오픈 스튜디오'));
    await page.screenshot({ path: OUT('viewer-overlay') });
    await dlg.getByRole('button', { name: '더 보기', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '소식 메뉴' });
    const items = await menu.getByRole('button').allInnerTexts();
    check('내 소식 메뉴 — 하이라이트·이웃 공개·삭제', ['하이라이트에 담기', '이웃 공개로 바꾸기', '삭제'].every((t) => items.some((x) => x.includes(t))), items.join(' | '));
    await page.screenshot({ path: OUT('viewer-mine-menu') });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // 남의 소식 메뉴
    await page.getByTestId('home-artstory').locator('[data-story-card]').nth(2).click();
    await dlg.waitFor({ state: 'visible' });
    await dlg.getByRole('button', { name: '더 보기', exact: true }).click();
    const items2 = await page.getByRole('dialog', { name: '소식 메뉴' }).getByRole('button').allInnerTexts();
    check('남의 소식 메뉴 — 그만 보기·신고', items2.some((x) => x.includes('그만 보기')) && items2.some((x) => x.includes('신고하기')), items2.join(' | '));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // ArtStory 탭
    await page.goto(`${BASE}/feed?tab=mine`); await settle(page);
    const tabs = await page.getByRole('tab').allInnerTexts();
    check('로그인 — 탭 셋', tabs.length === 3, tabs.join(','));
    const mine = await page.locator('[data-story-card]').count();
    check('내 소식 — 내가 올린 것', mine >= 3, `${mine}장`);
    await page.screenshot({ path: OUT('feed-mine') });
    await page.goto(`${BASE}/feed?tab=neighbors`); await settle(page);
    await page.screenshot({ path: OUT('feed-neighbors') });
    if (errs.length) console.log('  [로그인] 오류:', errs.slice(0, 5));
    check('로그인 화면 — 페이지 오류 없음', errs.length === 0, errs[0] || '');
    await ctx.close();

    // 지금 올린 것만 지운다
    const listed = await api('GET', `/stories/user/${kim.id}`, kimTok);
    for (const s of listed.body.stories || []) if (/^점검 (글만|사진) /.test(s.caption)) { made.push(s.id); await api('DELETE', `/stories/${s.id}`, kimTok); }
  }

  // ── 관리자(가상 운영 계정) — 신고 관리 ──
  {
    const ops = await demoUser('ops');
    const { ctx, page, errs } = await ctxOf(ops);
    await page.goto(`${BASE}/mypage?tab=report-manage`); await settle(page);
    const sec = page.locator('section[aria-labelledby="story-reports-title"]');
    check('신고 관리 — ArtStory 소식 신고 칸', await sec.isVisible().catch(() => false));
    const pend = await sec.getByRole('tab', { name: /확인할 것/ }).innerText().catch(() => '');
    check('신고 관리 — 확인할 것 1건 이상', /확인할 것 [1-9]/.test(pend), pend);
    await sec.screenshot({ path: OUT('admin-reports') }).catch(() => {});
    if (errs.length) console.log('  [관리자] 오류:', errs.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${engine} ${form}: ${results.length - bad.length}/${results.length} 통과 · 지운 점검 소식 ${made.length}`);
  process.exitCode = bad.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
