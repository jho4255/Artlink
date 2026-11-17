import fs from 'fs';
import path from 'path';
import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, authHeader, realUploadPath, solidPng } from '../lib/helpers';

/**
 * 커뮤니티 블로그형 글쓰기 (2026-11-13, 규칙 80) — 눌러서 무슨 일이 나는가.
 *  A 필진 탭: 필진이 아니면 고를 수 없다 → 관리자가 [탭 관리 → 필진]에서 넣으면 쓴다 → 사진 모음 · 실명만 · 이웃 알림 · 카드 목록
 *  B 자동 저장: 쓰면 저장되고 새로고침해도 그대로 · 새 글 화면에서 [쓰던 글 → 이어 쓰기]
 *  C 두 곳에서 같은 글: 나중 쪽에 "다른 곳에서 고친 내용" — 말없이 덮어쓰지 않는다
 *  D 고치기: 고친 내용이 글 화면에 바로 보이고, 고치는 동안의 작업본은 남지 않는다
 *  E 읽는 화면은 편집기(TipTap)를 받지 않는다 · 글쓰기 화면엔 하단 탭바가 없다
 *  F 동영상·투표(2026-11-13 2차): [동영상]은 파일, [투표]는 한 글에 하나 → 올리면 글 화면에서 투표하고 결과를 본다
 *  G 답글: 한 단계로 붙고 알림은 그 댓글로(?comment=) · 답글이 달린 댓글을 지우면 자리만 남는다 · 이름을 누르면 프로필 카드
 *  H 목록 페이지 번호: 20개를 넘으면 2쪽 · 주소 ?page=2 · 뒤로 가기
 * 기본 화면은 휴대폰 크기(playwright.config 375px) — 편집기의 아래 도구 막대 경로를 탄다.
 */
const API = 'http://localhost:4000/api';
const A = () => authHeader(tokenFor('admin'));
const editorBody = (page: Page) => page.locator('[data-post-editor] .ProseMirror');
const saveStatus = (page: Page) => page.locator('[data-post-editor] [role="status"]').first();

async function api() { return pwRequest.newContext(); }

async function dropDrafts(role: 'artist' | 'artist2') {
  const c = await api();
  const list = await (await c.get(`${API}/community/drafts`, { headers: authHeader(tokenFor(role)) })).json();
  for (const d of list as { id: number }[]) await c.delete(`${API}/community/drafts/${d.id}`, { headers: authHeader(tokenFor(role)) });
  await c.dispose();
}

test.describe('A 필진 탭', () => {
  test('★ 필진이 아니면 고를 수 없고 → 관리자가 넣으면 쓴다 → 사진 모음 · 실명만 · 이웃 알림 · 카드 목록', async ({ browser }) => {
    test.setTimeout(150_000);
    const ids = userIds();
    const c = await api();
    const name = `칼럼${Date.now() % 100000}`;
    const tab = await (await c.post(`${API}/community/categories`, { headers: A(), data: { name, writePolicy: 'writers', layout: 'card', allowAnonymous: false, description: '필진의 작업 이야기' } })).json();
    expect(tab.id).toBeTruthy();
    await c.delete(`${API}/community/writers/${ids.artist}`, { headers: A() });
    // artist2 가 artist 를 이웃 추가 — 필진 글이 올라가면 알림을 받는다
    await c.post(`${API}/follow/${ids.artist}`, { headers: authHeader(tokenFor('artist2')) });

    // 1) 필진이 아니면 탭 고르기에 없다
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto('/community/write');
    await editorBody(page).waitFor({ timeout: 20000 });
    await expect(page.locator('[data-post-editor] select').first().locator('option', { hasText: name })).toHaveCount(0);
    await dropDrafts('artist');

    // 2) 관리자가 [탭 관리 → 필진]에서 넣는다
    const adm = await openAs(browser, 'admin');
    await adm.page.goto('/community');
    await adm.page.getByRole('button', { name: '탭 관리' }).click();
    const dlg = adm.page.getByRole('dialog', { name: '탭 관리' });
    await dlg.getByRole('tab', { name: '필진' }).click();
    await dlg.getByRole('textbox', { name: '회원 찾기' }).fill('artist1@artlink.com');
    await dlg.getByRole('button', { name: '찾기' }).click();
    await dlg.getByRole('button', { name: '필진으로' }).click();
    await expect(dlg.getByText('artist1@artlink.com').last()).toBeVisible({ timeout: 8000 });
    await expect(dlg.getByRole('button', { name: /필진에서 빼기/ })).toBeVisible();
    await adm.ctx.close();

    // 3) 이제 고를 수 있다 — 익명 칸은 꺼진다(실명만)
    await page.goto(`/community/write?tab=${tab.slug}`);
    await editorBody(page).waitFor({ timeout: 20000 });
    const select = page.locator('[data-post-editor] select').first();
    await expect(select.locator('option', { hasText: name })).toHaveCount(1);
    await expect(select).toHaveValue(String(tab.id));
    await expect(page.getByRole('checkbox', { name: '익명으로 쓰기' })).toBeDisabled();

    // 4) 쓰고 · 사진 두 장 → [모아 놓기] → 등록
    const title = `필진 글 ${Date.now()}`;
    await page.locator('#post-title').fill(title);
    await editorBody(page).click();
    await page.keyboard.type('작업실 바닥에 그림을 늘어놓았다.');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '사진 넣기' }).first().click();
    // ⚠️ setFiles 는 경로와 버퍼를 섞어 받지 않는다 — 둘 다 버퍼로
    const real = realUploadPath('image');
    await (await chooser).setFiles([
      { name: path.basename(real), mimeType: /\.png$/i.test(real) ? 'image/png' : 'image/jpeg', buffer: fs.readFileSync(real) },
      { name: 'second.png', mimeType: 'image/png', buffer: solidPng(600, 450, [70, 110, 160]) },
    ]);
    const ask = page.getByRole('dialog', { name: /사진 2장/ });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: '사진 넣기' }).click();
    await expect(page.locator('[data-post-editor] .post-gallery-cell img')).toHaveCount(2, { timeout: 30000 });
    await expect(page.locator('[data-post-editor]')).not.toContainText('올리는 중', { timeout: 30000 });
    await page.getByRole('button', { name: '등록', exact: true }).click();
    await page.waitForURL(/\/community\/\d+$/, { timeout: 20000 });
    const postId = Number(page.url().split('/').pop());

    // 5) 글 화면 — 경로에 탭 · 사진 모음 두 칸 · 올렸어요 줄
    await expect(page.getByRole('navigation', { name: '경로' })).toContainText(name);
    await expect(page.locator('[data-post-body] .post-gallery-cell img')).toHaveCount(2);
    await expect(page.getByText('글을 올렸어요')).toBeVisible();

    // 6) 이웃(artist2)에게 알림 — 그 글로
    const notes = await (await c.get(`${API}/notifications`, { headers: authHeader(tokenFor('artist2')) })).json();
    expect(notes.some((n: { type: string; linkUrl: string }) => n.type === 'POST_NEW' && n.linkUrl === `/community/${postId}`)).toBe(true);

    // 7) 그 탭 목록은 카드 — 표지 사진과 제목
    await page.goto(`/community?tab=${tab.slug}`);
    const list = page.getByRole('region', { name: '글 목록' });
    await expect(list.getByText(title)).toBeVisible({ timeout: 15000 });
    await expect(list.locator('a', { hasText: title }).locator('img')).toHaveCount(1);
    await expect(page.getByText('필진의 작업 이야기')).toBeVisible();
    await ctx.close();

    await c.delete(`${API}/community/${postId}`, { headers: A() });
    await c.delete(`${API}/community/writers/${ids.artist}`, { headers: A() });
    await c.delete(`${API}/community/categories/${tab.id}`, { headers: A() });
    await c.dispose();
  });
});

test.describe('B 자동 저장', () => {
  test('★ 쓰면 저장되고 새로고침해도 그대로 · 새 글 화면에서 [쓰던 글 → 이어 쓰기]', async ({ browser }) => {
    test.setTimeout(90_000);
    await dropDrafts('artist2');
    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto('/community/write');
    await editorBody(page).waitFor({ timeout: 20000 });
    const title = `쓰던 글 ${Date.now()}`;
    await page.locator('#post-title').fill(title);
    await editorBody(page).click();
    await page.keyboard.type('아직 다 못 쓴 문단.');
    await expect(saveStatus(page)).toContainText('저장됨', { timeout: 20000 });
    await expect(page).toHaveURL(/\/community\/write\?draft=\d+/);

    await page.reload();
    await editorBody(page).waitFor({ timeout: 20000 });
    await expect(page.locator('#post-title')).toHaveValue(title);
    await expect(editorBody(page)).toContainText('아직 다 못 쓴 문단.');

    // 새 글 화면 — 아무것도 안 썼으면 '쓰던 글' 안내
    await page.goto('/community/write');
    await editorBody(page).waitFor({ timeout: 20000 });
    await expect(page.getByText(/쓰던 글이 \d+개 있어요/)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '이어 쓰기' }).click();
    await page.getByRole('button', { name: new RegExp(title) }).click();
    await expect(page.locator('#post-title')).toHaveValue(title, { timeout: 15000 });
    await expect(editorBody(page)).toContainText('아직 다 못 쓴 문단.');
    await ctx.close();
    await dropDrafts('artist2');
  });
});

test.describe('C 두 곳에서 같은 글', () => {
  test('★ 나중에 저장한 쪽에 "다른 곳에서 고친 내용" — 말없이 덮어쓰지 않는다', async ({ browser }) => {
    test.setTimeout(90_000);
    await dropDrafts('artist2');
    const c = await api();
    const draft = await (await c.post(`${API}/community/drafts`, {
      headers: authHeader(tokenFor('artist2')),
      data: { title: '두 곳에서 여는 글', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '처음' }] }] } },
    })).json();
    const one = await openAs(browser, 'artist2');
    const two = await openAs(browser, 'artist2');
    for (const p of [one.page, two.page]) {
      await p.goto(`/community/write?draft=${draft.id}`);
      await editorBody(p).waitFor({ timeout: 20000 });
    }
    await editorBody(one.page).click();
    await one.page.keyboard.press('End');
    await one.page.keyboard.type(' — 첫 번째 탭');
    await expect(saveStatus(one.page)).toContainText('저장됨', { timeout: 20000 });

    await editorBody(two.page).click();
    await two.page.keyboard.press('End');
    await two.page.keyboard.type(' — 두 번째 탭');
    await expect(two.page.getByText('다른 곳에서 고친 내용이 있어요').first()).toBeVisible({ timeout: 20000 });
    // 서버에는 첫 번째 탭의 내용이 그대로 있다
    const saved = await (await c.get(`${API}/community/drafts/${draft.id}`, { headers: authHeader(tokenFor('artist2')) })).json();
    expect(JSON.stringify(saved.doc)).toContain('첫 번째 탭');
    expect(JSON.stringify(saved.doc)).not.toContain('두 번째 탭');
    // [그 내용 불러오기] — 첫 번째 탭의 내용으로
    await two.page.getByRole('button', { name: '그 내용 불러오기' }).click();
    await expect(editorBody(two.page)).toContainText('첫 번째 탭', { timeout: 10000 });
    await one.ctx.close();
    await two.ctx.close();
    await c.dispose();
    await dropDrafts('artist2');
  });
});

test.describe('D 고치기', () => {
  test('★ 고친 내용이 글 화면에 바로 보이고, 고치는 동안의 작업본은 남지 않는다', async ({ browser }) => {
    test.setTimeout(90_000);
    const c = await api();
    const created = await (await c.post(`${API}/community`, {
      headers: authHeader(tokenFor('artist2')),
      data: { title: `고칠 글 ${Date.now()}`, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '처음 쓴 문장.' }] }] } },
    })).json();
    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto(`/community/${created.id}`);
    await page.getByRole('link', { name: '고치기' }).click();
    await page.waitForURL(new RegExp(`/community/${created.id}/edit`));
    await expect(editorBody(page)).toContainText('처음 쓴 문장.', { timeout: 20000 });
    await editorBody(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' 고친 문장.');
    await page.getByRole('button', { name: '수정 완료' }).click();
    await page.waitForURL(new RegExp(`/community/${created.id}$`), { timeout: 20000 });
    await expect(page.locator('[data-post-body]')).toContainText('처음 쓴 문장. 고친 문장.');
    const drafts = await (await c.get(`${API}/community/drafts`, { headers: authHeader(tokenFor('artist2')) })).json();
    expect(drafts.filter((d: { postId: number | null }) => d.postId === created.id)).toHaveLength(0);
    await ctx.close();
    await c.delete(`${API}/community/${created.id}`, { headers: authHeader(tokenFor('artist2')) });
    await c.dispose();
  });
});

test.describe('E 화면 구조', () => {
  test('★ 읽는 화면은 편집기(TipTap)를 받지 않는다 · 글쓰기 화면엔 하단 탭바가 없다', async ({ browser }) => {
    const c = await api();
    const created = await (await c.post(`${API}/community`, {
      headers: authHeader(tokenFor('artist')),
      data: { title: `가벼운 글 ${Date.now()}`, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '읽기만 하는 사람.' }] }] } },
    })).json();
    const { page, ctx } = await openAs(browser, 'artist2');
    const editorRequests: string[] = [];
    page.on('request', (r) => { if (/post-editor|tiptap|prosemirror/i.test(r.url())) editorRequests.push(r.url()); });
    await page.goto('/community');
    await page.goto(`/community/${created.id}`);
    await expect(page.locator('[data-post-body]')).toContainText('읽기만 하는 사람.', { timeout: 15000 });
    await expect(page.getByRole('navigation', { name: '하단 내비게이션' })).toBeVisible();
    expect(editorRequests, `읽는 화면이 편집기를 받았다: ${editorRequests.slice(0, 3).join(' ')}`).toEqual([]);

    await page.goto('/community/write');
    await editorBody(page).waitFor({ timeout: 20000 });
    await expect(page.getByRole('navigation', { name: '하단 내비게이션' })).toHaveCount(0);
    await ctx.close();
    await dropDrafts('artist2');
    await c.delete(`${API}/community/${created.id}`, { headers: A() });
    await c.dispose();
  });
});

// 동영상 파일 — 서버는 확장자·형식만 본다(영상을 열지 않는다). 재생은 못 하지만 올리기·등록 흐름을 본다
const fakeWebm = () => ({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2048, 7)]) });

test.describe('F 동영상·투표', () => {
  test('★ [동영상]은 파일 · [투표]는 한 글에 하나 → 올리면 다른 사람이 투표하고 결과를 본다', async ({ browser }) => {
    test.setTimeout(120_000);
    await dropDrafts('artist2');
    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto('/community/write');
    await editorBody(page).waitFor({ timeout: 20000 });
    const bar = page.getByRole('toolbar', { name: '서식' });
    // 유튜브 주소 넣기·'크게 인용' 은 없다 — 이름은 인용구·강조 문장
    await expect(bar.getByRole('button', { name: /유튜브|크게 인용/ })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '인용구' })).toHaveCount(1);

    const title = `투표 글 ${Date.now()}`;
    await page.locator('#post-title').fill(title);
    await editorBody(page).click();
    await page.keyboard.type('골라 주세요.');
    await bar.getByRole('button', { name: '투표 넣기' }).click();
    const dlg = page.getByRole('dialog', { name: '투표 넣기' });
    await dlg.getByRole('textbox').first().fill('다음 주제는?');
    await dlg.getByLabel('보기 1', { exact: true }).fill('바다');
    await dlg.getByLabel('보기 2', { exact: true }).fill('숲');
    await dlg.getByRole('button', { name: '넣기', exact: true }).click();
    await expect(page.locator('[data-post-editor] .post-poll')).toHaveCount(1);
    // 한 번 더 누르면 새로 넣지 않고 고치기
    await bar.getByRole('button', { name: '투표 넣기' }).click();
    await page.getByRole('dialog', { name: '투표 고치기' }).getByRole('button', { name: '고치기' }).click();
    await expect(page.locator('[data-post-editor] .post-poll')).toHaveCount(1);

    // 동영상 — 파일을 고르면 올라가 서버 주소가 된다
    await page.locator('[data-post-editor] .ProseMirror > p').last().click();
    const chooser = page.waitForEvent('filechooser');
    await bar.getByRole('button', { name: '동영상 넣기' }).click();
    await (await chooser).setFiles(fakeWebm());
    await expect.poll(async () => page.locator('[data-post-editor] .post-video video').first().getAttribute('src').catch(() => null), { timeout: 30000 })
      .toMatch(/^\/uploads\/|^https?:/);
    await page.getByRole('button', { name: '등록', exact: true }).click();
    await page.waitForURL(/\/community\/\d+$/, { timeout: 20000 });
    const postId = Number(page.url().split('/').pop());
    await page.locator('[data-post-article]').waitFor({ timeout: 20000 });
    await expect(page.locator('[data-post-body] .post-video video')).toHaveCount(1);
    // 글쓴이는 투표 안 해도 결과를 본다
    const mine = page.getByRole('group', { name: '투표: 다음 주제는?' });
    await expect(mine.getByLabel('투표 결과')).toBeVisible();
    await ctx.close();

    // 다른 사람 — 고르고 [투표하기] → 결과 막대·내 표
    const other = await openAs(browser, 'artist');
    await other.page.goto(`/community/${postId}`);
    const box = other.page.getByRole('group', { name: '투표: 다음 주제는?' });
    await expect(box.getByLabel('투표 결과')).toHaveCount(0);
    await box.getByRole('radio', { name: '숲' }).click();
    await box.getByRole('button', { name: '투표하기' }).click();
    await expect(box.getByLabel('투표 결과')).toBeVisible();
    await expect(box.getByLabel('내가 고른 보기')).toHaveCount(1);
    await expect(box).toContainText('1명 참여');
    await other.ctx.close();

    const c = await api();
    const detail = await (await c.get(`${API}/community/${postId}`, { headers: authHeader(tokenFor('artist')) })).json();
    expect(detail.poll.myVotes).toHaveLength(1);
    expect(detail.poll.options.find((o: { text: string; count: number }) => o.text === '숲').count).toBe(1);
    await c.delete(`${API}/community/${postId}`, { headers: authHeader(tokenFor('artist2')) });
    await c.dispose();
  });
});

test.describe('G 답글', () => {
  test('★ 답글은 한 단계로 · 알림은 그 댓글로(?comment=) · 지우면 자리만 · 이름을 누르면 프로필 카드', async ({ browser }) => {
    test.setTimeout(120_000);
    const c = await api();
    const post = await (await c.post(`${API}/community`, {
      headers: authHeader(tokenFor('artist2')),
      data: { title: `답글 글 ${Date.now()}`, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '댓글을 남겨 주세요.' }] }] } },
    })).json();
    const top = await (await c.post(`${API}/community/${post.id}/comments`, { headers: authHeader(tokenFor('artist')), data: { body: '맨 위 댓글이에요' } })).json();
    // 알림을 다시 누르는 흐름이라 시작할 때 읽음으로(규칙 — 읽은 알림은 뒤로 간다)
    await c.post(`${API}/notifications/read-all`, { headers: authHeader(tokenFor('artist')) });

    // 1) 글쓴이가 [답글]
    const author = await openAs(browser, 'artist2');
    await author.page.goto(`/community/${post.id}`);
    const thread = author.page.locator('#comments > ul > li').first();
    await thread.getByRole('button', { name: '답글' }).first().click();
    await author.page.getByLabel(/님에게 답글$/).fill('답글이에요');
    await author.page.getByRole('button', { name: '답글 등록' }).click();
    await expect(author.page.locator('#comments ul[aria-label="답글"]')).toContainText('답글이에요', { timeout: 10000 });
    // 댓글에 @멘션 입력은 없다
    await expect(author.page.getByPlaceholder('댓글을 입력하세요')).toBeVisible();
    await expect(author.page.getByText('@로 이웃')).toHaveCount(0);

    // 2) 이름을 누르면 프로필 카드 — 홈페이지 보기
    await author.page.locator('#comments').getByRole('button', { name: top.author.name, exact: true }).first().click();
    const card = author.page.getByRole('dialog', { name: `${top.author.name} 프로필` });
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: '홈페이지 보기' })).toBeVisible();
    await author.page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await author.ctx.close();

    // 3) 받은 사람(artist)에게 COMMENT_REPLY — 그 답글로
    const notes = await (await c.get(`${API}/notifications`, { headers: authHeader(tokenFor('artist')) })).json();
    const note = (notes as { type: string; linkUrl: string }[]).find((n) => n.type === 'COMMENT_REPLY' && n.linkUrl.startsWith(`/community/${post.id}?comment=`));
    expect(note, '답글 알림').toBeTruthy();
    const replyId = Number(note!.linkUrl.split('comment=')[1]);
    const reader = await openAs(browser, 'artist');
    await reader.page.goto(note!.linkUrl);
    const target = reader.page.locator(`[data-comment-id="${replyId}"]`);
    await expect(target).toBeInViewport({ timeout: 10000 });
    await expect(reader.page).not.toHaveURL(/comment=/);

    // 4) 답글이 달린 맨 위 댓글을 지우면 — 자리만 남고 답글은 그대로
    await reader.page.locator(`[data-comment-id="${top.id}"]`).getByRole('button', { name: '삭제' }).click();
    await expect(reader.page.getByText('삭제된 댓글입니다.')).toBeVisible({ timeout: 10000 });
    await expect(reader.page.locator('#comments ul[aria-label="답글"]')).toContainText('답글이에요');
    await reader.ctx.close();
    await c.delete(`${API}/community/${post.id}`, { headers: A() });
    await c.dispose();
  });
});

test.describe('H 목록 페이지 번호', () => {
  test('★ 20개를 넘으면 2쪽 · 주소 ?page=2 · 뒤로 가기는 1쪽', async ({ browser }) => {
    test.setTimeout(120_000);
    const c = await api();
    const name = `쪽${Date.now() % 100000}`;
    const tab = await (await c.post(`${API}/community/categories`, { headers: A(), data: { name, writePolicy: 'all' } })).json();
    const ids: number[] = [];
    for (let i = 1; i <= 21; i++) {
      const r = await (await c.post(`${API}/community`, {
        headers: authHeader(tokenFor('artist2')),
        data: { title: `${name} 글 ${String(i).padStart(2, '0')}`, categoryId: tab.id, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${i}번째` }] }] } },
      })).json();
      ids.push(r.id);
    }
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/community?tab=${tab.slug}`);
    const list = page.getByRole('region', { name: '글 목록' });
    await expect(list.getByText(`${name} 글 21`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: '글 목록 페이지' });
    await nav.getByRole('button', { name: '2페이지' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(list.getByText(`${name} 글 01`)).toBeVisible({ timeout: 10000 });
    await expect(list.getByText(`${name} 글 21`)).toHaveCount(0);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('2');
    await page.goBack();
    await expect(page).not.toHaveURL(/page=2/);
    await expect(list.getByText(`${name} 글 21`)).toBeVisible({ timeout: 10000 });
    // 탭을 바꾸면 1쪽부터
    await nav.getByRole('button', { name: '2페이지' }).click();
    await page.getByRole('tab', { name: '전체' }).click();
    await expect(page).not.toHaveURL(/page=/);
    await ctx.close();
    for (const id of ids) await c.delete(`${API}/community/${id}`, { headers: A() });
    await c.delete(`${API}/community/categories/${tab.id}`, { headers: A() });
    await c.dispose();
  });
});
