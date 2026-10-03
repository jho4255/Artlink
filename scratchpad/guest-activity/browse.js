// 비회원 둘러보기 — 실제 브라우저로 비회원처럼 둘러보고(로그인 없음) 기록이 쌓이는지 본다 (2026-10-03)
//   cd e2e && BASE=http://localhost:5183 API=http://localhost:4001/api node ../scratchpad/guest-activity/browse.js [--login]
//   ENGINE=webkit : 사파리 엔진으로
//   --login : 마지막에 [개발자 로그인]으로 로그인하는 방문 하나(데모 DB 전용 — 실서버 복제본에서 쓰지 말 것)
// 방문마다 새 브라우저 문맥(= 처음 온 기기). 나갈 때는 about:blank 로 — 창이 가려지고 pagehide 가 와서 마지막 기록이 간다.
const path = require('path');
const fs = require('fs');
const { chromium, webkit } = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
// ENGINE=webkit — 아이폰(인스타 인앱)과 같은 사파리 엔진으로. sudo 없이 띄우는 래퍼가 필요하다(메모 webkit-without-sudo)
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4001/api';
const WITH_LOGIN = process.argv.includes('--login');
const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.22.109';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IG_UA };
const PC = { viewport: { width: 1280, height: 800 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => (await fetch(`${API}/${u}`)).json();
const first = (x) => (Array.isArray(x) ? x : Object.values(x).find(Array.isArray)) ?? [];

(async () => {
  const exs = first(await get('exhibitions?scope=open'));
  const artists = first(await get('explore/artists'));
  const galleries = first(await get('galleries'));
  const posts = first(await get('community?sort=latest'));
  const ex = exs[0]; const artist = artists[0]; const gal = galleries[0]; const post = posts[0];
  console.log('대상:', ex?.title, '|', artist?.name, '|', gal?.name, '|', post?.title);
  const browser = ENGINE === 'webkit'
    ? await webkit.launch(fs.existsSync(WEBKIT_RUN) ? { executablePath: WEBKIT_RUN } : {})
    : await chromium.launch();
  console.log('엔진:', ENGINE);
  const visit = async (name, screen, fn) => {
    const ctx = await browser.newContext({ ...screen, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await ctx.newPage();
    const sent = [];
    page.on('request', (r) => { if (r.url().includes('/api/guest-activity')) sent.push(r.postData()); });
    const t0 = Date.now();
    try { await fn(page); } catch (e) { console.log(`  ! ${name}: ${String(e).slice(0, 160)}`); }
    await page.goto('about:blank').catch(() => {});
    await sleep(600);
    await ctx.close();
    console.log(`✓ ${name} — ${Math.round((Date.now() - t0) / 1000)}초, 보낸 기록 ${sent.length}번`);
  };

  // 1) 인스타 광고 → 공모 상세 8초 → 나감 (바로 나감)
  if (ex) await visit('공모 상세만 보고 나감', MOBILE, async (p) => { await p.goto(`/exhibitions/${ex.id}`); await sleep(8000); });
  // 2) 공모 상세 → [로그인하고 지원하기] → 로그인 화면 6초 → 나감 (로그인 앞에서 그만둠)
  if (ex) await visit('지원하려다 로그인 화면에서 나감', MOBILE, async (p) => {
    await p.goto(`/exhibitions/${ex.id}`); await sleep(9000);
    await p.getByRole('button', { name: /로그인하고 지원하기/ }).first().click();
    await p.waitForURL(/\/login/); await sleep(6000);
  });
  // 3) 홈 → [작가] → 작가 홈페이지 → 작품 셋 넘겨 보기 → 약력 탭 → 나감
  if (artist) await visit('작가 둘러보기', PC, async (p) => {
    await p.goto('/'); await sleep(5000);
    await p.goto('/artists'); await sleep(4000);
    await p.goto(artist.handle ? `/@${artist.handle}` : `/portfolio/${artist.id}`); await sleep(6000);
    await p.locator('button.cursor-zoom-in').first().click(); await sleep(3000);
    for (let i = 0; i < 2; i++) { await p.getByRole('button', { name: '다음 이미지' }).click(); await sleep(2200); }
    await p.getByRole('button', { name: '닫기' }).click(); await sleep(800);
    const cv = p.getByRole('tab', { name: '약력' });
    if (await cv.count()) { await cv.first().click(); await sleep(5000); }
  });
  // 4) 갤러리 목록 → 갤러리 → 리뷰 탭 → 나감
  if (gal) await visit('갤러리 둘러보기', MOBILE, async (p) => {
    await p.goto('/galleries'); await sleep(3500);
    await p.goto(`/galleries/${gal.id}`); await sleep(7000);
    const rv = p.getByRole('tab', { name: /리뷰/ });
    if (await rv.count()) { await rv.first().click(); await sleep(4000); }
  });
  // 5) 커뮤니티 글 하나를 오래 읽음 → 모집공고 → 나감
  if (post) await visit('커뮤니티 읽고 모집공고 보고 나감', PC, async (p) => {
    await p.goto(`/community/${post.id}`); await sleep(14000);
    await p.goto('/exhibitions'); await sleep(5000);
  });
  // 6) (데모 전용) 모집공고 → 로그인 → [개발자 로그인]으로 로그인 → 이 방문은 '로그인'으로 닫힌다
  if (WITH_LOGIN) await visit('둘러보다 로그인', PC, async (p) => {
    await p.goto('/exhibitions'); await sleep(4000);
    await p.goto('/login'); await sleep(3000);
    await p.getByRole('button', { name: /다른 계정으로 로그인/ }).click();
    await p.getByPlaceholder('이름 또는 이메일로 검색').fill('Artist 1');
    await p.getByRole('button', { name: /Artist 1/ }).first().click();
    await p.waitForURL((u) => u.pathname !== '/login', { timeout: 15000 }); await sleep(3000);
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
