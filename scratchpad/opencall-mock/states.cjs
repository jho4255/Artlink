/**
 * 모집공고 상세 개편(2026-11-15) — 로그인한 상태들(작가 · 지원한 작가 · 갤러리 주인)을 휴대폰·PC 로 본다.
 * ⚠️ 로컬 복제본 전용 · 가상 계정만(676 윤서진 · 677 아트링크 갤러리 주인, @artlink.test). 만든 공모·지원은 끝에서 지운다.
 *   OUT=<폴더> ENGINE=webkit node scratchpad/opencall-mock/states.cjs
 */
const { execFileSync } = require('child_process');
const { BASE, launch, devices, path, session } = require('../community-editor/lib');
const OUT = process.env.OUT || '/tmp';
const DB = process.env.DB || 'artlink_prod';
const sql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'artlink', '-d', DB, '-At', '-c', q], { env: { ...process.env, PGPASSWORD: 'artlink_dev_password' } }).toString().trim();
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

const ARTIST = { id: 676, role: 'ARTIST', name: '윤서진', nickname: '윤서진', email: 'intro-sample@artlink.test' };
const OWNER = { id: 677, role: 'GALLERY', name: '아트링크 갤러리', email: 'intro-gallery@artlink.test' };

(async () => {
  const emails = sql(`select string_agg(email, ',') from "User" where id in (${ARTIST.id}, ${OWNER.id})`);
  if (!emails.split(',').every((e) => e.endsWith('@artlink.test'))) throw new Error('가상 계정이 아닙니다: ' + emails);
  if (sql(`select "ownerId" from "Gallery" where id=14`) !== String(OWNER.id)) throw new Error('갤러리 14 주인이 가상 계정이 아니다');

  const exId = sql(`insert into "Exhibition" (title, type, "deadlineStart", deadline, "submissionDeadline", "exhibitStartDate", "exhibitDate", capacity, region, description, status, "galleryId", "hostType", "imageUrl", "updatedAt")
    values ('[가상] 겨울 소품전 《선물》 출품 작가 모집', 'GROUP', now() - interval '5 days', now() + interval '5 days', now() + interval '12 days', now() + interval '20 days', now() + interval '34 days', 8, 'SEOUL',
    '<p>한 해를 마무리하며 소품전에 함께할 작가를 모집합니다.</p><h3>지원 자격</h3><ul><li>10호 이내 작품 3점</li></ul>', 'APPROVED', 14, 'GALLERY', '/uploads/intro-sample/show-poster.jpg', now()) returning id`).split('\n')[0];
  console.log('temp exhibition', exId);
  const engine = process.env.ENGINE || 'chromium';
  const browser = await launch(engine);
  const views = [['m', devices['iPhone 13']], ['pc', { viewport: { width: 1440, height: 900 } }]];
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${engine}-${name}.png`) });
  try {
    for (const [vn, dev] of views) {
      // 작가 — 지원 줄 · 찜 · 공유 · 갤러리에 문의
      {
        const ctx = await browser.newContext({ ...dev, storageState: session(ARTIST).storage });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/exhibitions/${exId}`);
        await page.getByRole('heading', { level: 1, name: /겨울 소품전/ }).waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
        await shot(page, `artist-${vn}`);
        ok(await page.getByRole('button', { name: '지원하기' }).count() === 1, `${vn} 작가: [지원하기] 하나`);
        ok(await page.locator('[data-apply-bar]').getByRole('button', { name: '지원하기' }).isVisible(), `${vn} 작가: 따라오는 줄에 [지원하기]`);
        ok(await page.getByRole('button', { name: '찜하기' }).count() === 1, `${vn} 작가: 찜 하나`);
        ok(await page.getByRole('button', { name: /공유/ }).count() === 1, `${vn} 작가: 공유 하나`);
        ok(await page.getByRole('button', { name: /갤러리에 문의/ }).count() === 1, `${vn} 작가: 갤러리에 문의 하나`);
        const steps = await page.locator('section[aria-labelledby="ex-schedule"] li').allInnerTexts();
        ok(steps.length === 4 && /접수 마감 · 5일 남음/.test(steps[1]), `${vn} 일정 띠 4칸·접수 마감 5일 남음: ${JSON.stringify(steps)}`);
        // 찜 눌러 보기 → 해제
        await page.getByRole('button', { name: '찜하기' }).click();
        await page.getByRole('button', { name: '찜 해제' }).waitFor({ timeout: 5000 });
        await page.getByRole('button', { name: '찜 해제' }).click();
        await page.getByRole('button', { name: '찜하기' }).waitFor({ timeout: 5000 });
        ok(true, `${vn} 찜 켜고 끄기`);
        await ctx.close();
      }
      // 지원한 작가 — 상태 상자, 지원 줄 없음
      {
        sql(`insert into "Application" ("userId", "exhibitionId", status, "updatedAt") values (${ARTIST.id}, ${exId}, 'SUBMITTED', now())`);
        const ctx = await browser.newContext({ ...dev, storageState: session(ARTIST).storage });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/exhibitions/${exId}`);
        await page.getByText('지원 완료', { exact: true }).waitFor({ timeout: 15000 });
        await shot(page, `applied-${vn}`);
        ok(await page.locator('[data-apply-bar]').count() === 0, `${vn} 지원한 작가: 따라오는 줄 없음`);
        await ctx.close();
        sql(`delete from "Application" where "userId"=${ARTIST.id} and "exhibitionId"=${exId}`);
      }
      // 갤러리 주인 — 지원자 보기 · 운영 · 포스터 관리 · 마감일 수정 단추 없음(이미 있음) · 삭제
      {
        const ctx = await browser.newContext({ ...dev, storageState: session(OWNER).storage });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/exhibitions/${exId}`);
        await page.getByRole('heading', { level: 1, name: /겨울 소품전/ }).waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
        await shot(page, `owner-${vn}`);
        await page.screenshot({ path: path.join(OUT, `${engine}-owner-${vn}-full.png`), fullPage: true });
        ok(await page.locator('main').getByRole('button', { name: '지원자 보기' }).count() === 1, `${vn} 주인: 지원자 보기`);
        ok(await page.getByRole('button', { name: '포스터 관리' }).count() === 1, `${vn} 주인: 포스터 관리`);
        ok(await page.getByRole('button', { name: '공모 삭제' }).count() === 1, `${vn} 주인: 공모 삭제`);
        ok(await page.getByRole('button', { name: '지역 변경' }).count() === 1, `${vn} 주인: 지역 변경`);
        ok(await page.locator('[data-apply-bar]').count() === 0, `${vn} 주인: 지원 줄 없음`);
        // 지역 변경 열고 닫기 — 칸이 한 줄을 다 쓴다
        await page.getByRole('button', { name: '지역 변경' }).click();
        await page.getByRole('combobox', { name: '지역 고르기' }).waitFor();
        await shot(page, `owner-region-${vn}`);
        await page.getByRole('button', { name: '취소' }).click();
        await ctx.close();
      }
    }
    // 갤러리 목록 — 가상 갤러리에 모집 중·전시 중 두 줄
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/galleries`);
      const card = page.locator('article').filter({ hasText: '아트링크 갤러리' }).first();
      await card.waitFor({ timeout: 15000 });
      const text = await card.innerText();
      ok(/모집 중/.test(text) && /겨울 소품전/.test(text) && /전시 중/.test(text), `갤러리 카드 두 줄: ${text.replace(/\n/g, ' | ')}`);
      const first = await page.locator('main article h2').first().innerText();
      ok(true, `맨 앞 갤러리: ${first}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    sql(`delete from "Application" where "exhibitionId"=${exId}`);
    sql(`delete from "Favorite" where "exhibitionId"=${exId}`);
    sql(`delete from "ExhibitionImage" where "exhibitionId"=${exId}`);
    sql(`delete from "Exhibition" where id=${exId}`);
    console.log('cleaned', exId);
  }
})();
