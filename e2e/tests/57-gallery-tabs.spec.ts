import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId, createExhibition, applyToExhibition } from '../lib/helpers';

/**
 * 갤러리 홈페이지 탭 + 함께한 작가 숨기기/되돌리기 (2026-09-27 사용자 신고)
 *  ① "갤러리 홈피도 작가 홈피처럼 탭으로" — 소개·모집 중·함께한 작가·지난 전시·리뷰 가 세로로 이어져 있었다.
 *  ② "함께한 작가 숨기기 후 다시 보이게 하는 곳이 없다" — 숨긴 칸이 통째로 opacity-40 이라 [다시 보이기]가 11px 회색의
 *     40% 로 사실상 안 보였다. 지금은 관리자에게만 [숨긴 작가] 상자로 따로 모이고, 버튼은 또렷하다.
 *
 * 보이는지가 아니라 **눌러서 주소·내용·서버 응답이 어떻게 바뀌는지**를 본다.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1280, height: 900 };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let gid = 0;
let artistName = '';
let artistId = 0;

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  gid = await ownedGalleryId(api);
  // 이 갤러리 공모에 수락된 작가를 하나 만든다 → '함께한 작가'에 모인다
  const exId = await createExhibition(api, { title: `E2E 탭 공모 ${Date.now()}`, galleryId: gid, capacity: 3 });
  const applied = await applyToExhibition(api, exId, tokenFor('artist2'));
  expect(applied.status()).toBe(201);
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth(tokenFor('gallery')) })).json();
  const acc = await api.patch(`${API}/exhibitions/${exId}/applications/${apps[0].id}`, { headers: auth(tokenFor('gallery')), data: { status: 'ACCEPTED' } });
  expect(acc.status()).toBe(200);

  const g = await (await api.get(`${API}/galleries/${gid}`)).json();
  const me = (g.artists as { id: number; name: string; nickname: string | null }[]).find((a) => a.id === apps[0].userId) ?? g.artists[0];
  artistId = me.id;
  artistName = me.nickname || me.name;
  // 앞 스펙이 숨겨 둔 채 끝났을 수 있다 — 보이는 상태에서 시작
  await api.patch(`${API}/galleries/${gid}/artists/${artistId}`, { headers: auth(tokenFor('gallery')), data: { hidden: false } });
  await api.dispose();
});

test('★ 탭을 누르면 내용과 주소가 바뀌고, 새로고침해도 그 탭이다 · 모르는 탭은 첫 탭', async ({ browser }) => {
  const page = await browser.newPage({ viewport: DESKTOP });
  await page.goto(`/galleries/${gid}`);
  const tablist = page.getByRole('tablist', { name: '갤러리 메뉴' });
  await expect(tablist).toBeVisible({ timeout: 15000 });
  // ⚠️ 한 번에 읽지 말고 기다리는 단언으로 — 갤러리에 핸들이 있으면 `/galleries/3` → `/@핸들` 로 갈아끼우며 다시 그려져,
  //    그 순간 목록을 읽으면 빈 배열이다(앞 스펙 53 이 핸들을 만든 뒤에만 드러났다)
  await expect(tablist.getByRole('tab', { name: /^함께한 작가/ })).toBeVisible({ timeout: 15000 });
  await expect(tablist.getByRole('tab', { name: /^리뷰/ }), '리뷰는 늘 있다(쓰러 오는 곳)').toBeVisible();
  // 방문자에겐 비어 있는 채우기 탭이 없다 — 첫 탭이 무엇이든 선택된 채로 열린다
  await expect(tablist.getByRole('tab', { selected: true })).toHaveCount(1);

  await tablist.getByRole('tab', { name: /함께한 작가/ }).click();
  await expect(page).toHaveURL(/[?&]tab=artists/);
  await expect(page.getByTestId('gallery-artists')).toContainText(artistName);
  // 한 탭에는 그 탭 것만 — 리뷰 작성 칸 같은 다른 탭 내용이 섞이지 않는다
  await expect(page.getByRole('tabpanel')).not.toContainText('리뷰 작성');

  await page.reload();
  await expect(tablist.getByRole('tab', { name: /함께한 작가/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await expect(page.getByTestId('gallery-artists')).toContainText(artistName);

  await tablist.getByRole('tab', { name: /리뷰/ }).click();
  await expect(page).toHaveURL(/[?&]tab=reviews/);

  // 옛 링크·오타 — 빈 화면이 아니라 첫 탭
  await page.goto(`/galleries/${gid}?tab=nope`);
  await expect(tablist.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await page.close();
});

test('★ 주인이 숨긴 작가는 [숨긴 작가]에 모이고, [다시 보이기]로 되돌린다 — 방문자에겐 안 보인다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'gallery');
  await page.setViewportSize(DESKTOP);
  await page.goto(`/galleries/${gid}?tab=artists`);
  const visible = page.getByTestId('gallery-artists');
  await expect(visible).toContainText(artistName, { timeout: 15000 });

  // 주인에겐 비어 있어도 채울 탭(소개·지난 전시)이 보인다
  const tablist = page.getByRole('tablist', { name: '갤러리 메뉴' });
  await expect(tablist.getByRole('tab', { name: /^소개/ })).toBeVisible();
  await expect(tablist.getByRole('tab', { name: /^지난 전시/ })).toBeVisible();

  // 숨기기
  await visible.locator(':scope > div', { hasText: artistName }).getByRole('button', { name: '숨기기' }).click();
  const hiddenBox = page.getByTestId('hidden-artists');
  await expect(hiddenBox).toContainText(artistName, { timeout: 10000 });
  const restore = hiddenBox.locator(':scope div.group', { hasText: artistName }).getByRole('button', { name: '다시 보이기' });
  await expect(restore).toBeVisible();
  // 버튼이 흐리지 않다 — 예전엔 칸 전체가 opacity-40 이라 사실상 안 보였다
  const opacity = await restore.evaluate((el) => {
    let o = 1; for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1');
    return o;
  });
  expect(opacity, '[다시 보이기]가 흐리게 그려졌다').toBeGreaterThan(0.9);

  // 서버: 방문자 응답에서 빠졌다
  const api = await pwRequest.newContext();
  const pub = await (await api.get(`${API}/galleries/${gid}`)).json();
  expect(pub.artists.some((a: { id: number }) => a.id === artistId), '방문자 응답에 숨긴 작가가 남아 있다').toBe(false);

  // 방문자 화면: 숨긴 작가도, 숨긴 상자도 없다
  const anon = await browser.newPage({ viewport: DESKTOP });
  await anon.goto(`/galleries/${gid}?tab=artists`);
  await expect(anon.getByRole('tablist', { name: '갤러리 메뉴' })).toBeVisible({ timeout: 15000 });
  await expect(anon.getByTestId('hidden-artists')).toHaveCount(0);
  await expect(anon.getByRole('tabpanel')).not.toContainText(artistName);

  // 다시 보이기
  await restore.click();
  await expect(visible).toContainText(artistName, { timeout: 10000 });
  await expect(page.getByTestId('hidden-artists')).toHaveCount(0);
  const back = await (await api.get(`${API}/galleries/${gid}`)).json();
  expect(back.artists.some((a: { id: number }) => a.id === artistId)).toBe(true);

  await anon.reload();
  await expect(anon.getByTestId('gallery-artists')).toContainText(artistName, { timeout: 15000 });
  await api.dispose();
  await anon.close();
  await ctx.close();
});
