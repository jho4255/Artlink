import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 신뢰성: 찜을 여러 번 껐다 켰다 하며 화면 간(상세↔목록↔마이페이지) 일관성 검증.
 * - CLAUDE.md 핵심 제약: 찜은 cross-cache 즉시 반영(stale 깜빡임 금지).
 * - 단발성 금지 → 3라운드 반복 + 빠른 연타(멱등성) 검증.
 */
const API = 'http://localhost:4000/api';
let gid: number;
let gname: string;

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const list = await (await api.get(`${API}/galleries`)).json();
  const arr = list.galleries || list;
  gid = arr[0].id; gname = arr[0].name;
  await api.dispose();
});

test('찜 토글 3라운드 — 상세/목록/마이페이지 cross-cache 일관성', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const heartOn = () => page.getByRole('button', { name: '찜 해제' });   // 찜된 상태
  const heartOff = () => page.getByRole('button', { name: '찜하기' });   // 안 된 상태

  for (let round = 1; round <= 3; round++) {
    // 1) 상세에서 찜 ON
    await page.goto(`/galleries/${gid}`);
    await expect(heartOff()).toBeVisible({ timeout: 10000 });
    await heartOff().click();
    await expect(heartOn()).toBeVisible(); // 상세 즉시 반영

    // 2) 목록에 즉시 반영 (찜된 카드 정확히 1개)
    await page.goto('/galleries');
    await expect(page.getByRole('button', { name: '찜 해제' })).toHaveCount(1);

    // 3) 마이페이지 찜목록에 등장
    await page.goto('/mypage');
    await page.getByText('찜 목록', { exact: false }).first().click();
    await expect(page.getByText(gname, { exact: false }).first()).toBeVisible({ timeout: 8000 });

    // 4) 상세에서 찜 OFF (찜 상태 유지 확인 후 해제)
    await page.goto(`/galleries/${gid}`);
    await expect(heartOn()).toBeVisible();
    await heartOn().click();
    await expect(heartOff()).toBeVisible();

    // 5) 목록에서 즉시 사라짐 (찜된 카드 0개)
    await page.goto('/galleries');
    await expect(page.getByRole('button', { name: '찜 해제' })).toHaveCount(0);

    // 6) 마이페이지 찜목록에서 사라짐 (stale 없이 즉시 제거)
    //    "찜한 항목이 없습니다" 등장 = 섹션 로드됨 + 비어있음 둘 다 확인
    await page.goto('/mypage');
    await page.getByText('찜 목록', { exact: false }).first().click();
    await expect(page.getByText('찜한 항목이 없습니다', { exact: false })).toBeVisible({ timeout: 8000 });
  }
  await ctx.close();
});

test('찜 빠른 5연타 — UI와 서버 상태 일치(멱등성/경합)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto(`/galleries/${gid}`);
  await expect(page.getByRole('button', { name: '찜하기' })).toBeVisible({ timeout: 10000 });

  // 5번 빠르게 클릭 (홀수 → 최종 찜됨이 기대)
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: /찜/ }).click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1500); // 서버 반영 대기

  const uiFavorited = await page.getByRole('button', { name: '찜 해제' }).count() === 1;

  // 서버 진실값 확인
  const api = await pwRequest.newContext();
  const tok = tokenFor('artist');
  const favs = await (await api.get(`${API}/favorites`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  const serverCount = (favs || []).filter((f: any) => f.galleryId === gid || f.gallery?.id === gid).length;
  await api.dispose();

  // 핵심: 중복 행 없어야 함(0 또는 1) + UI와 서버 일치
  expect(serverCount, '찜 행이 중복 생성되면 안 됨').toBeLessThanOrEqual(1);
  expect(uiFavorited ? 1 : 0, 'UI 표시와 서버 상태 일치').toBe(serverCount);
  await ctx.close();
});
