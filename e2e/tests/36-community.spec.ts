import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, realUploadPath } from '../lib/helpers';

/**
 * 커뮤니티 (블라인드식 게시판) — 1단계.
 *  · 읽기는 공개, 글쓰기/댓글은 로그인
 *  · 글마다 실명/익명 선택 — 익명이면 신원이 가려진다
 *  · 홈 인기글 위젯이 좋아요 많은 글을 보여준다
 * 2026-11-13 — 글쓰기가 블로그형 편집기가 됐다(제목 칸 #post-title · 본문 ProseMirror · 사진은 [사진 넣기]).
 *   편집기 자체는 79-community-editor.spec.ts 가 본다.
 */
const editorBody = (page: import('@playwright/test').Page) => page.locator('[data-post-editor] .ProseMirror');
const API = 'http://localhost:4000/api';

test('★ Navbar 에 [커뮤니티] 가 있고 목록으로 간다', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav').first();
  await expect(nav).toContainText('커뮤니티', { timeout: 10000 });
  await page.goto('/community');
  await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible({ timeout: 15000 });
});

test('★ 글쓰기는 전용 페이지로 이동한다 → 상세 → 좋아요 → 댓글 (실명)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/community');
  await page.getByRole('button', { name: '글쓰기' }).click();

  // 모달이 아니라 **전용 페이지**로 이동
  await page.waitForURL(/\/community\/write/, { timeout: 15000 });

  const title = `E2E 커뮤니티 ${Date.now()}`;
  await editorBody(page).waitFor({ timeout: 20000 });
  await page.locator('#post-title').fill(title);
  await editorBody(page).click();
  await page.keyboard.type('본문 내용입니다. 반갑습니다.');
  await page.getByRole('button', { name: '등록', exact: true }).click();

  // 상세로 이동
  await page.waitForURL(/\/community\/\d+$/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('[data-post-body]')).toContainText('본문 내용입니다');

  // 좋아요 토글 (0 → 1)
  const likeBtn = page.getByRole('button', { name: /^좋아요/ });
  await expect(likeBtn).toHaveText(/좋아요 0/);
  await likeBtn.click();
  await expect(likeBtn).toHaveText(/좋아요 1/, { timeout: 8000 });
  await expect(likeBtn).toHaveAttribute('aria-pressed', 'true');

  // 댓글
  await page.getByPlaceholder('댓글을 입력하세요').fill('첫 댓글이에요');
  await page.getByRole('button', { name: '댓글 등록' }).click();
  await expect(page.locator('body')).toContainText('첫 댓글이에요', { timeout: 8000 });
  await ctx.close();
});

test('★ 사진 첨부해서 글쓰기 → 상세에 사진이 보인다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/community/write');
  const title = `사진글 ${Date.now()}`;
  await editorBody(page).waitFor({ timeout: 20000 });
  await page.locator('#post-title').fill(title);
  await editorBody(page).click();
  await page.keyboard.type('작업 중인 사진입니다');

  // [사진 넣기] → 실제 이미지 업로드(한 장이면 묻지 않고 커서 자리에 들어간다)
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '사진 넣기' }).first().click();
  await (await chooser).setFiles(realUploadPath('image'));
  await expect(page.locator('[data-post-editor] .post-figure-frame img')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-post-editor]')).not.toContainText('올리는 중', { timeout: 30000 });
  await page.getByRole('button', { name: '등록', exact: true }).click();

  await page.waitForURL(/\/community\/\d+$/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // 글 안 사진 — 글 중간(사진을 넣은 자리)에 그려진다
  await expect(page.locator('[data-post-body] .post-figure-frame img')).toBeVisible({ timeout: 10000 });
  await ctx.close();
});

test('★ 조회수는 남이 볼 때 오른다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const created = await api.post(`${API}/community`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    data: { title: `조회수글 ${Date.now()}`, body: '조회수 확인용', anonymous: false },
  });
  const { id } = await created.json();
  await api.dispose();

  // artist2 가 상세를 연다 → 조회수 1
  const { page, ctx } = await openAs(browser, 'artist2');
  await page.goto(`/community/${id}`);
  await expect(page.locator('body')).toContainText('조회수 확인용', { timeout: 15000 });
  const api2 = await pwRequest.newContext();
  const detail = await (await api2.get(`${API}/community/${id}`)).json();
  expect(detail.viewCount).toBeGreaterThanOrEqual(1);
  await api2.dispose();
  await ctx.close();
});

test('★ 익명 글은 목록·상세에서 작성자가 [익명] 으로 가려진다', async ({ browser }) => {
  // 닉네임을 붙여도 익명이면 노출되면 안 된다
  const api = await pwRequest.newContext();
  await api.put(`${API}/auth/me/nickname`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` }, data: { nickname: `비밀닉${Date.now() % 10000}` },
  });
  const created = await api.post(`${API}/community`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    data: { title: `익명글 ${Date.now()}`, body: '누가 썼는지 몰라야 한다', anonymous: true },
  });
  const { id } = await created.json();
  // 서버 응답 자체에 닉네임이 없어야 한다
  const detail = await (await api.get(`${API}/community/${id}`)).json();
  expect(detail.author.name).toBe('익명');
  expect(detail.author.id).toBeNull();
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist2');
  await page.goto(`/community/${id}`);
  await expect(page.locator('body')).toContainText('익명', { timeout: 15000 });
  await ctx.close();
});

test('★ 홈 인기글 위젯이 좋아요 많은 글을 보여준다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const title = `인기글검증 ${Date.now()}`;
  const created = await api.post(`${API}/community`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    data: { title, body: '인기글이 될 글', anonymous: false },
  });
  const { id } = await created.json();
  // 세 명이 좋아요
  for (const role of ['artist2', 'gallery', 'admin'] as const) {
    await api.post(`${API}/community/${id}/like`, { headers: { Authorization: `Bearer ${tokenFor(role)}` } });
  }
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/');
  // 휴대폰 홈은 탭이다(2026-11-14) — [인기글] 탭을 눌러 그 칸을 연다
  await page.getByRole('tab', { name: '인기글' }).click();
  const panel = page.getByTestId('home-panel-popular');
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText(title, { timeout: 12000 });
  // 클릭하면 상세로
  await panel.getByText(title).first().click();
  await page.waitForURL(new RegExp(`/community/${id}`), { timeout: 10000 });
  await ctx.close();
});

test('★ 비로그인은 읽되 글쓰기는 로그인으로 유도', async ({ page }) => {
  await page.goto('/community');
  await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '글쓰기' }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
});
