import path from 'path';
import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, authHeader, crowdUsers } from '../lib/helpers';

/**
 * ArtStory 홈 공개 (2026-11-14, 규칙 81) — 눌러서 무슨 일이 나는가.
 *  A 글만 소식: [+] → 곧바로 올리기 화면(고르는 창 없음) → 올리면 내 홈 줄 맨 앞 → **비회원 홈**에도 뜨고, 누르면 화면 가득 열려 저절로 넘어간다
 *  B 한 페이지에서: 글 바탕에서 [사진] → 사진 위 글([Aa], 꾸밈) → 끌어 옮기기 → 올리면 카드·보기 화면의 같은 자리에 · 사진은 자르지 않음
 *  C 비회원 좋아요 → 로그인 안내 → 로그인 뒤 그 소식으로 돌아와 좋아요 → 올린 사람에게 좋아요 알림 한 줄
 *  D 댓글 → 올린 사람 알림 링크(`?story=&comment=`)로 들어오면 댓글 창을 연 채로 그 댓글
 *  E 신고 셋 → 비회원 홈에서 사라짐 → 관리자 [신고 관리]에서 [문제없음] → 다시 보인다
 *  F 그만 보기 → 내 홈 줄에서 빠지고 [내 소식] 탭에서 되돌린다 · 이웃 공개 소식은 홈에 안 나온다
 * 기본 화면은 휴대폰(Pixel 7). 보기 화면의 진행은 CSS 애니메이션이라 실제로 시간을 기다려 본다.
 */
const API = 'http://localhost:4000/api';
const PHOTO = path.resolve(process.cwd(), '../frontend/public/demo-art/blue-wall.jpg');
const rail = (page: Page) => page.getByTestId('home-artstory');
const viewer = (page: Page) => page.locator('[data-story-viewer]');
/** 휴대폰 홈은 탭이다(2026-11-14, 81 스펙) — [ArtStory] 탭을 눌러 소식 줄을 연다 */
async function openRail(page: Page) {
  await page.getByRole('tab', { name: 'ArtStory' }).click();
  await expect(rail(page)).toBeVisible();
  return rail(page);
}

async function api() { return pwRequest.newContext(); }
async function post(role: 'artist' | 'artist2' | 'gallery', data: Record<string, unknown>) {
  const c = await api();
  const r = await c.post(`${API}/stories`, { headers: authHeader(tokenFor(role)), data });
  expect(r.status(), await r.text()).toBe(201);
  const body = await r.json();
  await c.dispose();
  return body as { id: number };
}

test.describe('ArtStory 홈 공개', () => {
  test('A ★ 글만 소식을 올리면 홈 줄 맨 앞 → 비회원 홈에도 뜨고 → 누르면 저절로 넘어간다', async ({ browser }) => {
    test.setTimeout(90_000);
    await post('artist2', { caption: `먼저 올린 소식 ${Date.now()}` });   // 넘어갈 다음 소식
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto('/');
    await (await openRail(page)).getByRole('button', { name: '소식 올리기' }).first().click();
    await page.waitForURL(/\/story\/new/);
    await expect(page.getByRole('dialog')).toHaveCount(0);   // 사진/글을 먼저 고르는 창은 없다
    const cap = `오픈 스튜디오 ${Date.now() % 100000}`;
    await page.getByLabel('글', { exact: true }).fill(cap);
    await page.getByRole('radio', { name: '바탕색 짙은 초록' }).click();
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await page.waitForURL((u) => u.pathname === '/');
    // 올리고 돌아오면 보던 [ArtStory] 탭 그대로(기록 state) — 다시 누르지 않아도 줄이 보인다
    await expect(page.getByRole('tab', { name: 'ArtStory' })).toHaveAttribute('aria-selected', 'true');
    const first = rail(page).locator('[data-story-card]').first();
    await expect(first).toContainText(cap);
    await ctx.close();

    // 비회원 — 이웃이 아니어도 홈 [ArtStory] 탭에 보인다
    const g = await browser.newContext();
    const gp = await g.newPage();
    await gp.goto('/');
    const card = (await openRail(gp)).locator('[data-story-card]').filter({ hasText: cap });
    await expect(card).toBeVisible();
    await card.click();
    await expect(viewer(gp)).toBeVisible();
    const name0 = await viewer(gp).getAttribute('aria-label');
    // 글만 소식은 6.5초 — 다음 사람으로 저절로
    await expect.poll(() => viewer(gp).getAttribute('aria-label'), { timeout: 12_000 }).not.toBe(name0);
    await gp.keyboard.press('Escape');
    await expect(viewer(gp)).toBeHidden();
    await g.close();
  });

  test('B ★ 한 페이지에서 — [사진] → 사진 위 글을 쓰고 끌어 옮겨 올리면 카드·보기 화면의 같은 자리에', async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto('/feed');
    await page.getByRole('button', { name: '소식 올리기' }).first().click();
    await page.waitForURL(/\/story\/new/);
    // 들어오면 글 바탕 — 같은 화면의 [사진] 으로 사진 소식이 된다
    await expect(page.getByLabel('글', { exact: true })).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '사진', exact: true }).click(),
    ]);
    await chooser.setFiles([PHOTO]);
    const up = page.getByRole('button', { name: '올리기', exact: true });
    await expect(up).toBeEnabled({ timeout: 20_000 });

    // 사진 위 글 — [Aa] → 글·꾸밈 → 완료
    await page.getByRole('button', { name: '사진 위에 글 쓰기' }).click();
    const ed = page.getByRole('dialog', { name: '사진 위 글' });
    await ed.getByLabel('사진 위 글', { exact: true }).fill('오픈 스튜디오');
    await ed.getByRole('radio', { name: '검은 띠' }).click();
    await ed.getByRole('radio', { name: '크게' }).click();
    await ed.getByRole('button', { name: '완료' }).click();
    await expect(ed).toBeHidden();
    const ov = page.locator('[data-story-compose] [data-story-overlay]');
    await expect(ov).toHaveText('오픈 스튜디오');

    // 끌어서 아래로 — 짧게 누르면 고치는 창, 끌면 옮긴다
    const b0 = (await ov.boundingBox())!;
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2 + 70, { steps: 8 });
    await page.mouse.up();
    await expect(ed).toBeHidden();
    const b1 = (await ov.boundingBox())!;
    expect(b1.y).toBeGreaterThan(b0.y + 50);

    const cap = `벽에 걸어 본 날 ${Date.now() % 100000}`;
    await page.locator('#story-caption').fill(cap);
    await up.click();
    await page.waitForURL(/\/feed/);
    const c = await api();
    const pub = await (await c.get(`${API}/stories/public`)).json();
    const mine = pub.stories.find((s: { caption: string }) => s.caption === cap);
    await c.dispose();
    expect(mine?.images).toHaveLength(1);
    expect(mine?.images[0]).toMatch(/^\/uploads\//);
    expect(mine?.overlays).toHaveLength(1);
    expect(mine.overlays[0]).toMatchObject({ i: 0, text: '오픈 스튜디오', style: 'dark', size: 'l' });
    expect(mine.overlays[0].y).toBeGreaterThan(0.55);

    // 카드에도, 보기 화면에도 같은 글이 얹혀 있다(사진 원본은 그대로)
    const card = page.locator(`[data-story-card="${mine.id}"]`);
    await expect(card.locator('[data-story-overlay]')).toHaveText('오픈 스튜디오');
    await card.click();
    const img = viewer(page).locator('[data-story-stage] img').first();
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
    const vo = viewer(page).locator('[data-story-overlay]');
    await expect(vo).toHaveText('오픈 스튜디오');
    // 같은 자리 — 사진 높이 대비 위치가 올릴 때와 같다(±3%)
    const ratio = await vo.evaluate((el) => {
      const layer = el.parentElement!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return (r.top + r.height / 2 - layer.top) / layer.height;
    });
    expect(Math.abs(ratio - mine.overlays[0].y)).toBeLessThan(0.03);
    await ctx.close();
  });

  test('C ★ 비회원 좋아요 → 로그인 안내 → 로그인 뒤 그 소식으로 → 좋아요 알림은 한 줄', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = await post('artist2', { caption: `좋아요 받을 소식 ${Date.now()}` });
    const g = await browser.newContext();
    const gp = await g.newPage();
    await gp.goto(`/feed?story=${s.id}`);
    await expect(viewer(gp)).toBeVisible();
    await viewer(gp).getByRole('button', { name: '좋아요' }).click();
    const sheet = gp.getByRole('dialog', { name: '로그인 안내' });
    await expect(sheet).toContainText('좋아요는 로그인하고 누를 수 있어요');
    await sheet.getByRole('button', { name: '로그인' }).click();
    await gp.waitForURL(/\/login/);
    expect(await gp.evaluate(() => sessionStorage.getItem('post_login_redirect'))).toBe(`/feed?story=${s.id}`);
    await g.close();

    // 로그인한 사람이 그 주소로 — 보기 화면이 그 소식부터
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/feed?story=${s.id}`);
    await expect(viewer(page)).toBeVisible();
    await viewer(page).getByRole('button', { name: '좋아요' }).click();
    await expect(viewer(page).getByRole('button', { name: '좋아요 취소' })).toBeVisible();
    await ctx.close();
    const { page: p3, ctx: c3 } = await openAs(browser, 'gallery');
    await p3.goto(`/feed?story=${s.id}`);
    await viewer(p3).getByRole('button', { name: '좋아요' }).click();
    await expect(viewer(p3).getByRole('button', { name: '좋아요 취소' })).toBeVisible();
    await c3.close();
    const c = await api();
    const notes = await (await c.get(`${API}/notifications`, { headers: authHeader(tokenFor('artist2')) })).json();
    const list = (notes.notifications ?? notes) as { type: string; message: string; linkUrl: string }[];
    const likes = list.filter((n) => n.type === 'STORY_LIKE' && n.linkUrl === `/feed?story=${s.id}`);
    expect(likes).toHaveLength(1);
    expect(likes[0]!.message).toMatch(/외 1명이 내 소식을 좋아해요/);
    await c.dispose();
  });

  test('D 댓글 → 알림 링크(?story=&comment=)로 들어오면 댓글 창을 연 채로 그 댓글', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = await post('artist2', { caption: `댓글 받을 소식 ${Date.now()}` });
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/feed?story=${s.id}`);
    await viewer(page).getByRole('button', { name: '댓글' }).click();
    const body = `작업실 구경 가도 될까요 ${Date.now() % 1000}`;
    await page.getByLabel('댓글 쓰기').fill(body);
    await page.getByLabel('댓글 쓰기').press('Enter');
    await expect(page.getByText(body)).toBeVisible();
    await ctx.close();

    const c = await api();
    const notes = await (await c.get(`${API}/notifications`, { headers: authHeader(tokenFor('artist2')) })).json();
    const list = (notes.notifications ?? notes) as { type: string; linkUrl: string }[];
    const n = list.find((x) => x.type === 'STORY_COMMENT' && x.linkUrl.startsWith(`/feed?story=${s.id}&comment=`));
    expect(n, '댓글 알림').toBeTruthy();
    await c.dispose();

    const { page: p2, ctx: c2 } = await openAs(browser, 'artist2');
    await p2.goto(n!.linkUrl);
    await expect(viewer(p2)).toBeVisible();
    await expect(p2.getByRole('dialog', { name: '댓글' })).toBeVisible();
    await expect(p2.getByText(body)).toBeVisible();
    // 닫으면 주소에서 링크가 떨어진다(새로고침에 다시 열리지 않게)
    await p2.keyboard.press('Escape');
    await p2.keyboard.press('Escape');
    await expect(viewer(p2)).toBeHidden();
    await expect(p2).not.toHaveURL(/story=/);
    await c2.close();
  });

  test('E ★ 서로 다른 셋이 신고하면 저절로 내려가고 → 관리자가 [문제없음] 하면 다시 보인다', async ({ browser }) => {
    test.setTimeout(90_000);
    const cap = `신고될 소식 ${Date.now()}`;
    const s = await post('gallery', { caption: cap });
    const c = await api();
    const crowd = await crowdUsers(c, 3);
    for (const u of crowd) await c.post(`${API}/stories/${s.id}/report`, { headers: authHeader(u.token), data: { reason: 'SPAM' } });
    const pub = await (await c.get(`${API}/stories/public`)).json();
    expect(pub.stories.some((x: { id: number }) => x.id === s.id)).toBe(false);
    const notes = await (await c.get(`${API}/notifications`, { headers: authHeader(tokenFor('admin')) })).json();
    expect(((notes.notifications ?? notes) as { type: string }[]).some((x) => x.type === 'STORY_REPORTED')).toBe(true);

    const { page, ctx } = await openAs(browser, 'admin');
    await page.goto('/mypage?tab=report-manage');
    const sec = page.locator('section[aria-labelledby="story-reports-title"]');
    const row = sec.locator('li').filter({ hasText: cap });
    await expect(row).toBeVisible();
    await expect(row).toContainText('신고로 내려감');
    await row.getByRole('button', { name: '문제없음 · 다시 보이기' }).click();
    await expect(page.getByText('다시 보이게 했어요.')).toBeVisible();
    await ctx.close();
    const back = await (await c.get(`${API}/stories/public`)).json();
    expect(back.stories.some((x: { id: number }) => x.id === s.id)).toBe(true);
    await c.dispose();
  });

  test('F 그만 보기 → 내 홈 줄에서 빠지고 [내 소식]에서 되돌린다 · 이웃 공개 소식은 홈에 안 나온다', async ({ browser }) => {
    test.setTimeout(90_000);
    const ids = userIds();
    const s = await post('artist2', { caption: `그만 볼 사람 ${Date.now()}` });
    const secret = `이웃에게만 ${Date.now()}`;
    await post('artist2', { caption: secret, visibility: 'NEIGHBORS' });
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/feed?story=${s.id}`);
    await viewer(page).getByRole('button', { name: '더 보기', exact: true }).click();
    await page.getByRole('dialog', { name: '소식 메뉴' }).getByRole('button', { name: /소식 그만 보기/ }).click();
    await expect(page.getByText(/소식을 그만 봐요/)).toBeVisible();
    await page.goto('/');
    await expect((await openRail(page)).locator('[data-story-card]').first()).toBeVisible();
    const authors = await rail(page).locator('[data-story-card]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const a2 = await (await (await api()).get(`${API}/stories/public?rail=1`)).json();
    const a2Name = a2.stories.find((x: { author: { id: number } }) => x.author.id === ids.artist2)?.author.name;
    expect(a2Name).toBeTruthy();
    expect(authors.some((l) => l?.startsWith(a2Name))).toBe(false);
    // 이웃 공개 소식은 비회원 공개 목록에 없다
    expect(a2.stories.some((x: { caption: string }) => x.caption === secret)).toBe(false);

    await page.goto('/feed?tab=mine');
    const mutes = page.locator('section[aria-labelledby="story-mutes"]');
    await expect(mutes).toContainText(a2Name);
    await mutes.getByRole('button', { name: '다시 보기' }).first().click();
    await expect(mutes).toBeHidden();
    await page.goto('/');
    await expect((await openRail(page)).locator('[data-story-card]').filter({ hasText: a2Name }).first()).toBeVisible();
    await ctx.close();
  });
});
