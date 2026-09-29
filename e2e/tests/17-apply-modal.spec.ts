import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, openMyPageTab, exhibitionDates } from '../lib/helpers';

/**
 * 지원서(고정 양식): 작가약력(필수) + 경력 + 작품사진(1장 이상 필수) + 포트폴리오 파일 + 약관.
 *
 * 2026-09-29 부터 **모달이 아니라 전용 페이지**(`/exhibitions/:id/apply`)다.
 *  - 열면 홈페이지(포트폴리오) 내용으로 미리 채운다(비었으면 그렇다고 말한다)
 *  - 경력·파일 '없음' 체크는 없앴다 — 비워 두면 그대로 '없음'으로 간다
 *  - [지원하기]는 늘 눌린다. 빠진 게 있으면 **무엇이 남았는지** 말하고 그 칸으로 데려간다
 */
const API = 'http://localhost:4000/api';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('지원서 페이지: 남은 것 안내 → 정상 제출 → 지원 내역 반영', async ({ browser }) => {
  // 공모 생성 + 승인 (customFields 없음 — 제거된 기능)
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '고정양식공모 ' + Date.now(), type: 'SOLO', deadlineStart: today, deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: '고정 양식 지원 테스트', galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist2'); // artist2: 포트폴리오가 비어 있을 수 있다(둘 다 견딘다)
  await page.goto(`/exhibitions/${ex.id}`);

  // 지원하기 → 지원서 **페이지**
  await page.getByRole('button', { name: '지원하기' }).first().click();
  await page.waitForURL(new RegExp(`/exhibitions/${ex.id}/apply$`), { timeout: 10000 });
  await expect(page.getByRole('heading', { level: 1, name: ex.title })).toBeVisible({ timeout: 10000 });
  // 홈페이지로 채웠는지 한 줄로 알려 준다 (채웠든 비었든)
  await expect(page.getByText(/홈페이지\(포트폴리오\)에 적은|홈페이지에 아직 적은 내용이 없어요/)).toBeVisible({ timeout: 10000 });

  // 1) 약력을 비우고 누르면 → 무엇이 남았는지 말하고 제출하지 않는다
  const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
  await bio.fill('');
  await page.getByRole('button', { name: '지원하기' }).click();
  await expect(page.locator('body')).toContainText('아직 채울 것', { timeout: 8000 });
  await expect(page.getByText('약력을 적어 주세요.')).toBeVisible();
  await expect(page).toHaveURL(/\/apply$/);

  // 2) 약력 입력
  await bio.fill('E2E 지원 약력');

  // 3) 작품사진 — 홈페이지로 채워졌으면 그대로, 비었으면 1장 올린다
  const images = page.locator('#apply-images img');
  if (await images.count() === 0) {
    await page.locator('#apply-images input[type="file"]').first().setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('#apply-images img[src*="/uploads/"]').first()).toBeVisible({ timeout: 12000 });
  }

  // 4) '없음' 체크는 없다 — 비워 둔 경력·파일은 그대로 '없음'으로 간다(예전엔 네 번을 눌러야 제출됐다)
  await expect(page.getByText('없음', { exact: true })).toHaveCount(0);

  // 5) 약관 동의 → 하단 줄이 '다 채웠어요' 로 바뀐다 → 제출
  await page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
  await expect(page.getByText(/다 채웠어요/)).toBeVisible();
  await page.getByRole('button', { name: '지원하기' }).click();

  // 공모 상세로 돌아와 [지원하기] 대신 상태가 보인다 — 지원서를 다 쓰고 나서야 "이미 지원한 공모" 400 을 받지 않게
  await page.waitForURL(new RegExp(`/exhibitions/${ex.id}$`), { timeout: 10000 });
  await expect(page.locator('body')).toContainText('지원했어요', { timeout: 10000 });
  await expect(page.getByText('지원 완료', { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('button', { name: '지원하기' })).toHaveCount(0);

  // 지원서 주소로 다시 와도 두 번 쓰게 두지 않는다 — 상세로 돌려보낸다
  await page.goto(`/exhibitions/${ex.id}/apply`);
  await page.waitForURL(new RegExp(`/exhibitions/${ex.id}$`), { timeout: 10000 });

  // 지원 내역 반영 — [내 전시] '심사 중'
  await openMyPageTab(page, '내 전시');
  await page.getByRole('tab', { name: /^심사 중/ }).click();
  await expect(page.getByText('고정양식공모', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await ctx.close();
});
