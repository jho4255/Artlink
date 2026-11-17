/**
 * 커뮤니티 2차(2026-11-13 로컬 확인 뒤 고친 것) — 눌러서 무슨 일이 나는지 보고 찍는다.
 *   node scratchpad/community-editor/look2.js [chromium|webkit] [desktop|mobile]
 * 보는 것: 넘겨 보기 한 장씩 · 동영상 · 투표(비회원/투표한 사람/마감) · 답글·지운 자리·'○○님에게' · 이름 → 프로필 카드 ·
 *          ?comment= 로 내려가기 · 답글 달기 · 목록 페이지 번호(2쪽 → 뒤로 가기).
 * ⚠️ 복제본·데모 DB 전용. 로그인은 가상 데모 계정(@community-demo.example.com)만.
 */
const { BASE, API, session, launch, api, devices, path } = require('./lib');
const engine = process.argv[2] || 'chromium';
const form = process.argv[3] || 'desktop';
const OUT = (name) => path.join(__dirname, 'out', `r2-${engine}-${form}-${name}.png`);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function findPost(title) {
  for (let page = 1; page <= 5; page++) {
    const j = await (await fetch(`${API}/community?sort=recent&page=${page}`)).json();
    const hit = (j.posts || []).find((p) => p.title === title);
    if (hit) return hit.id;
    if (!j.hasMore) break;
  }
  throw new Error(`글 없음: ${title}`);
}
async function demoUser(key) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${key}@community-demo.example.com` }) });
  const j = await r.json();
  if (!j.user || !String(j.user.email || '').endsWith('@community-demo.example.com')) throw new Error(`데모 계정이 아님: ${key}`);
  return j.user;
}

(async () => {
  const browser = await launch(engine);
  const ctxOf = async (user) => {
    const storageState = user ? session(user).storage : undefined;
    const o = form === 'mobile' ? { ...devices['iPhone 13'], storageState } : { viewport: { width: 1280, height: 900 }, storageState };
    if (engine === 'chromium' && form === 'mobile') delete o.defaultBrowserType;
    const ctx = await browser.newContext(o);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`); });
    return { ctx, page, errs };
  };
  const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500); };

  const ids = {
    walls: await findPost('벽 색이 그림을 바꾼다 — 세 전시를 보고'),
    cloudy: await findPost('흐린 날 오후, 작은 전시장에서'),
    poll: await findPost('다음 단체전 주제, 같이 골라 주세요'),
    closed: await findPost('작품 사진, 다들 뭘로 찍으세요?'),
    block: await findPost('그림 안 그려지는 날 다들 뭐 하세요?'),
    water: await findPost('물 번짐을 붙잡는 세 번의 겹칠'),
  };

  // ── 비회원 ──
  {
    const { ctx, page, errs } = await ctxOf(null);
    // 넘겨 보기 — 한 장씩
    await page.goto(`${BASE}/community/${ids.walls}`); await settle(page);
    const slide = page.locator('.post-slide-track, [data-slide-track]').first();
    const info = await page.evaluate(() => {
      const track = document.querySelector('.post-slides, .post-slide-track') || document.querySelector('[aria-roledescription="carousel"]');
      const slides = [...document.querySelectorAll('.post-slide')];
      const vis = slides.map((s) => { const r = s.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width) }; });
      const box = (track || slides[0]?.parentElement)?.getBoundingClientRect();
      const count = document.querySelector('.post-slide-count')?.textContent?.trim() ?? null;
      return { n: slides.length, vis, box: box ? { l: Math.round(box.left), w: Math.round(box.width) } : null, count };
    });
    const inView = info.box ? info.vis.filter((v) => v.l < info.box.l + info.box.w - 2 && v.l + v.w > info.box.l + 2).length : -1;
    check('넘겨 보기 — 한 화면에 사진 한 장', info.n >= 2 && inView === 1, `사진 ${info.n} · 보이는 칸 ${inView} · 표시 '${info.count}'`);
    await page.locator('.post-slide-wrap').first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: OUT('slide-1') });
    const next = page.getByRole('button', { name: /다음 사진/ }).first();
    if (await next.count() && await next.isVisible()) { await next.click(); await page.waitForTimeout(700); }
    else { await page.locator('.post-slide').first().evaluate((el) => el.parentElement.scrollBy({ left: el.clientWidth, behavior: 'instant' })); await page.waitForTimeout(500); }
    const count2 = await page.locator('.post-slide-count').first().textContent().catch(() => null);
    check('넘겨 보기 — 다음으로 넘기면 번호가 바뀐다', /^2\s*\/\s*\d/.test((count2 || '').trim()), `'${count2}'`);
    await page.screenshot({ path: OUT('slide-2') });
    void slide;

    // 동영상 — ⚠️ 이 PC 의 sudo 없는 WebKit 은 미디어 백엔드(GStreamer)가 없어 <video> 가 든 페이지가 멈춘다(canPlayType 이 빈 값).
    //   우리 코드가 아니라 점검 환경의 한계라 WebKit 에서는 건너뛴다 — 실기기(아이폰)·에뮬레이터로 본다.
    if (engine === 'webkit') check('동영상 — WebKit(미디어 없음)이라 건너뜀', true);
    else {
    await page.goto(`${BASE}/community/${ids.cloudy}`); await settle(page);
    const v = page.locator('.post-video video').first();
    await v.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(() => { const el = document.querySelector('.post-video video'); return el && el.readyState >= 1; }, null, { timeout: 15000 }).catch(() => {});
    const vi = await v.evaluate((el) => ({ rs: el.readyState, dur: Math.round(el.duration * 10) / 10, w: el.videoWidth, h: el.videoHeight, controls: el.controls, src: el.currentSrc.slice(-24), box: Math.round(el.getBoundingClientRect().width) }));
    check('동영상 — 글 안에서 재생 준비(길이 7초·960×540)', vi.rs >= 1 && Math.abs(vi.dur - 7) < 0.6 && vi.w === 960, JSON.stringify(vi));
    await page.screenshot({ path: OUT('video') });
    }

    // 투표 — 비회원은 결과 없이 보기만 + [로그인하고 투표하기]
    await page.goto(`${BASE}/community/${ids.poll}`); await settle(page);
    const pollBox = page.getByRole('group', { name: /^투표:/ }).first();
    await pollBox.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const guestBtn = await pollBox.getByRole('button', { name: '로그인하고 투표하기' }).count();
    const guestBars = await pollBox.getByLabel('투표 결과').count();
    check('투표(비회원) — 결과는 숨기고 [로그인하고 투표하기]', guestBtn === 1 && guestBars === 0, `버튼 ${guestBtn} · 결과 ${guestBars}`);
    await page.screenshot({ path: OUT('poll-guest') });

    // 마감된 투표 — 누구나 결과
    await page.goto(`${BASE}/community/${ids.closed}`); await settle(page);
    const closedBox = page.getByRole('group', { name: /^투표:/ }).first();
    await closedBox.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const closedTxt = await closedBox.textContent();
    check('마감된 투표 — 비회원도 결과·"마감된 투표"', /마감된 투표/.test(closedTxt) && (await closedBox.getByLabel('투표 결과').count()) === 1, closedTxt.replace(/\s+/g, ' ').slice(0, 120));
    await page.screenshot({ path: OUT('poll-closed') });

    // 답글 — 지운 자리 · 답글은 한 단계
    await page.goto(`${BASE}/community/${ids.block}`); await settle(page);
    await page.locator('#comments').scrollIntoViewIfNeeded();
    const del = await page.getByText('삭제된 댓글입니다.').count();
    const nested = await page.locator('#comments ul[aria-label="답글"] [data-comment-id]').count();
    check('지운 댓글 — 답글이 있으면 "삭제된 댓글입니다" 자리와 답글이 남는다', del === 1 && nested >= 1, `자리 ${del} · 답글 ${nested}`);
    await page.screenshot({ path: OUT('comments-deleted'), fullPage: false });

    // 답글의 답글 — '○○님에게'
    await page.goto(`${BASE}/community/${ids.water}`); await settle(page);
    await page.locator('#comments').scrollIntoViewIfNeeded();
    const toName = await page.locator('#comments').getByText('한지우님에게').count();
    check("답글의 답글 — '한지우님에게'", toName >= 1, `${toName}`);
    await page.screenshot({ path: OUT('comments-thread') });

    // 이름 → 프로필 카드
    const nameBtn = page.locator('#comments').getByRole('button', { name: '도하린', exact: true }).first();
    await nameBtn.click();
    const card = page.getByRole('dialog', { name: '도하린 프로필' });
    await card.waitFor({ timeout: 5000 }).catch(() => {});
    const cardOk = await card.count() && await card.isVisible();
    const homeLink = cardOk ? await card.getByRole('link', { name: '홈페이지 보기' }).count() : 0;
    const followBtn = cardOk ? await card.getByRole('button', { name: /이웃 추가|이웃/ }).count() : 0;
    check('이름을 누르면 프로필 카드(홈페이지 보기 · 이웃 추가)', !!cardOk && homeLink === 1 && followBtn >= 1, `카드 ${cardOk} · 홈페이지 ${homeLink} · 이웃 ${followBtn}`);
    if (cardOk && form === 'desktop') {
      const [b1, b2] = await Promise.all([nameBtn.boundingBox(), card.boundingBox()]);
      check('프로필 카드 — 누른 이름 바로 아래', !!b1 && !!b2 && b2.y >= b1.y + b1.height && b2.y - (b1.y + b1.height) < 30, `이름 y${Math.round(b1?.y)} · 카드 y${Math.round(b2?.y)}`);
    }
    await page.screenshot({ path: OUT('profile-card') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('프로필 카드 — Esc 로 닫힌다', (await card.count()) === 0);
    if (homeLink) {
      await nameBtn.click();
      await page.getByRole('dialog', { name: '도하린 프로필' }).getByRole('link', { name: '홈페이지 보기' }).click();
      await page.waitForURL(/\/@|\/portfolio\//, { timeout: 8000 }).catch(() => {});
      await settle(page);   // 홈페이지가 다 뜬 뒤에 떠난다(받는 중에 떠나면 WebKit 이 끊긴 요청을 오류로 남긴다)
      check('[홈페이지 보기] → 그 작가 홈페이지', /\/@|\/portfolio\//.test(page.url()), page.url().replace(BASE, ''));
    }

    // 목록 — 페이지 번호
    await page.goto(`${BASE}/community`); await settle(page);
    const nav = page.getByRole('navigation', { name: '글 목록 페이지' });
    await nav.scrollIntoViewIfNeeded();
    const hasNav = await nav.count();
    const moreBtn = await page.getByRole('button', { name: '더 보기' }).count();
    check('목록 — [더 보기] 대신 페이지 번호', hasNav === 1 && moreBtn === 0, `번호 줄 ${hasNav} · 더 보기 ${moreBtn}`);
    await page.screenshot({ path: OUT('list-pagination') });
    const firstTitle1 = await page.locator('[aria-label="글 목록"] a[href^="/community/"]').first().textContent();
    await nav.getByRole('button', { name: '2페이지' }).click();
    await page.waitForURL(/page=2/, { timeout: 5000 }).catch(() => {});
    await settle(page);
    // 부드러운 스크롤(html scroll-behavior: smooth)이 끝날 때까지 — 스크롤 위치가 0.3초 동안 그대로면 끝
    for (let i = 0, last = -1, still = 0; i < 40 && still < 3; i++) { const y = await page.evaluate(() => scrollY); still = y === last ? still + 1 : 0; last = y; await page.waitForTimeout(100); }
    const firstTitle2 = await page.locator('[aria-label="글 목록"] a[href^="/community/"]').first().textContent();
    const cur = await nav.locator('[aria-current="page"]').textContent();
    const top = await page.locator('[aria-label="글 목록"]').evaluate((el) => Math.round(el.getBoundingClientRect().top));
    check('2쪽 — 주소 ?page=2 · 다른 글 · 목록 맨 위로', /page=2/.test(page.url()) && firstTitle1 !== firstTitle2 && cur?.trim() === '2' && top > 40 && top < 200, `첫 글 '${firstTitle2?.slice(0, 20)}' · 목록 위치 ${top}`);
    await page.screenshot({ path: OUT('list-page2') });
    await page.goBack(); await settle(page);
    check('뒤로 가기 — 1쪽으로', !/page=2/.test(page.url()));
    check('비회원 화면 — 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // ── 김민서(투표함) — 결과 막대 · 답글 달기 · ?comment= ──
  {
    const kim = await demoUser('kim');
    const { ctx, page, errs } = await ctxOf(kim);
    await page.goto(`${BASE}/community/${ids.poll}`); await settle(page);
    const box = page.getByRole('group', { name: /^투표:/ }).first();
    await box.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const bars = await box.getByLabel('투표 결과').count();
    const mine = await box.getByLabel('내가 고른 보기').count();
    check('투표한 사람 — 결과 막대와 내가 고른 보기', bars === 1 && mine === 1, `결과 ${bars} · 내 표 ${mine}`);
    await page.screenshot({ path: OUT('poll-voted') });
    // 다시 고르기 → 다른 보기 → 바꾸기
    await box.getByRole('button', { name: '다시 고르기' }).click();
    await box.getByRole('radio', { name: '작은 방' }).click();
    await box.getByRole('button', { name: '이걸로 바꾸기' }).click();
    await page.waitForTimeout(800);
    const after = await box.textContent();
    const r = await api('GET', `/community/${ids.poll}`, session(kim).token);
    check('다시 고르기 — 표가 바뀐다(서버)', JSON.stringify(r.body.poll.myVotes) === JSON.stringify(['opt3x']), `${JSON.stringify(r.body.poll.myVotes)} · ${after.replace(/\s+/g, ' ').slice(0, 80)}`);
    // 원래 표로 되돌린다(데모 데이터를 흔들지 않게)
    await api('POST', `/community/${ids.poll}/poll`, session(kim).token, { optionIds: ['opt2x'] });

    // 답글 달기 — WebKit 은 동영상이 든 글을 못 여니(위 참고) 다른 글로
    const replyPost = engine === 'webkit' ? ids.water : ids.cloudy;
    await page.goto(`${BASE}/community/${replyPost}`); await settle(page);
    await page.locator('#comments').scrollIntoViewIfNeeded();
    const firstRow = page.locator('#comments > ul > li').first();
    await firstRow.getByRole('button', { name: '답글' }).first().click();
    const box2 = page.getByLabel(/님에게 답글$/);
    await box2.fill('저도 이번 주말에 가 보려고요. (점검 답글)');
    await page.screenshot({ path: OUT('reply-box') });
    await page.getByRole('button', { name: '답글 등록' }).click();
    await page.waitForTimeout(1500);
    const added = await page.locator('#comments ul[aria-label="답글"]').getByText('(점검 답글)').count();
    check('답글 달기 — 그 댓글 아래 답글로 붙는다', added === 1, `${added}`);
    await page.screenshot({ path: OUT('reply-added') });
    // 방금 단 답글 지우기(데모 데이터 원래대로)
    const d = await api('GET', `/community/${replyPost}`, session(kim).token);
    const mineReply = d.body.comments.flatMap((c) => c.replies).find((x) => x.body?.includes('(점검 답글)'));

    // ?comment= — 알림으로 온 것처럼
    if (mineReply) {
      await page.goto(`${BASE}/community/${replyPost}?comment=${mineReply.id}`); await settle(page);
      await page.waitForTimeout(800);
      const pos = await page.locator(`[data-comment-id="${mineReply.id}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().top));
      check('?comment= — 그 댓글로 내려가고 주소에서 뗀다', pos > 40 && pos < 400 && !/comment=/.test(page.url()), `댓글 위치 ${pos} · ${page.url().replace(BASE, '')}`);
      await page.screenshot({ path: OUT('deep-comment') });
      await api('DELETE', `/community/${replyPost}/comments/${mineReply.id}`, session(kim).token);
    }
    check('김민서 화면 — 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과${bad.length ? `\n실패: ${bad.map((b) => b.name).join(' · ')}` : ''}`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
