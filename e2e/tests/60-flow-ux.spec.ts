import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import {
  openAs, tokenFor, userIds, ownedGalleryId, createExhibition, applyToExhibition, ensurePublicArtworks,
  openApplicantManager, applicantRow, openGallerySubmissions, openArtistExhibition, openSection, sectionToggle,
} from '../lib/helpers';

/**
 * 공모 흐름 UX 개편 (2026-09-29) — **눌러서 무엇이 바뀌는가**를 본다(보이는지만 보면 50번 스펙처럼 속는다).
 *
 *  A. 지원자 관리 — 고를 수 있는 건 '검토 대기' 뿐(수락 탭에 체크박스·일괄 버튼 없음), 일괄 수락은 고른 만큼만
 *  B. 단계 전환 — 확인창을 거치고, [취소]면 서버가 그대로
 *  C. 작가 출품 자료 — [갤러리에 제출] 한 번이면 갤러리 화면에 '제출 완료', 대표작은 저장 전에 고른다
 *  D. 지원서 페이지 — 홈페이지로 미리 채워 '없음' 체크 없이 바로 낸다
 *  E. 정산 — 갤러리 몫 0% 로 요청하면 확인창, 작가가 모두 확인하면 '모두 확인했어요' + [정산 완료]
 *  F. 등록 폼 임시저장 — 폼 위 안내, 고르기 전엔 덮어쓰지 않음, [새로 쓰기]는 한 번 더 묻고 지움
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });

async function acceptVia(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const r = await applyToExhibition(api, exId, tokenFor(role));
  expect(r.status(), `${role} 지원 실패: ${await r.text()}`).toBe(201);
  const appId = (await r.json()).id;
  const p = await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } });
  expect(p.status()).toBe(200);
}

async function statusesOf(api: APIRequestContext, exId: number) {
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json();
  return new Map<number, string>((apps.applications ?? apps).map((a: any) => [a.userId, a.status]));
}

const newTitle = (what: string) => `E2E흐름 ${what} ${Date.now()}`;

test.describe('A. 지원자 관리 — 고를 수 있는 건 검토 대기뿐', () => {
  test('★ 수락 탭엔 체크박스·일괄 버튼이 없고, 일괄 수락은 검토 대기만 처리한다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('지원자');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 5 });
    await acceptVia(api, exId, 'artist');                                       // 이미 수락
    expect((await applyToExhibition(api, exId, tokenFor('artist2'))).status()).toBe(201); // 검토 대기

    const { page, ctx } = await openAs(browser, 'gallery');
    const card = await openApplicantManager(page, title);

    // 전체 탭 — 체크박스는 검토 대기 한 줄에만
    await expect(card.locator('li input[type="checkbox"]')).toHaveCount(1);
    await expect(applicantRow(card, 'Artist 2')).toBeVisible();
    await expect(card.getByText('검토 대기 1명 모두 선택')).toBeVisible();

    // 수락 탭 — 고를 게 없다(이미 수락한 작가를 다시 바꿀 수 있는 것처럼 보이면 안 된다)
    await card.getByRole('tab', { name: /^수락/ }).click();
    await expect(card.locator('li')).toHaveCount(1);
    await expect(card.locator('li input[type="checkbox"]')).toHaveCount(0);
    await expect(card.getByText(/전체 선택|모두 선택/)).toHaveCount(0);
    await expect(card.getByRole('button', { name: '선택 수락' })).toHaveCount(0);

    // 전체 탭에서 모두 선택 → 일괄 수락 → 확인창의 숫자 = 실제로 처리될 수
    await card.getByRole('tab', { name: /^전체/ }).click();
    await card.getByText('검토 대기 1명 모두 선택').click();
    await card.getByRole('button', { name: '선택 수락' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('1명을 수락할까요?');
    await dialog.getByRole('button', { name: '수락하기', exact: true }).click();
    await expect(page.locator('body')).toContainText('1명을 수락했습니다', { timeout: 10000 });

    const st = await statusesOf(api, exId);
    expect(st.get(userIds().artist)).toBe('ACCEPTED');
    expect(st.get(userIds().artist2)).toBe('ACCEPTED');
    // 이제 검토 대기가 없으니 체크박스도 없다
    await expect(card.locator('li input[type="checkbox"]')).toHaveCount(0);
    await api.dispose();
    await ctx.close();
  });
});

test.describe('B. 단계 전환은 확인창을 거친다', () => {
  test('★ [모집 마감하기] → 확인창 → 취소하면 그대로, 확인하면 마감', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('단계'), galleryId: await ownedGalleryId(api) });
    const closed = async () => (await (await api.get(`${API}/operations/${exId}/access`, { headers: auth('gallery') })).json()).recruitmentClosed;

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/exhibitions/${exId}/operation/new`);
    await page.getByRole('button', { name: /모집 마감하기/ }).click();
    const dialog = page.getByRole('dialog', { name: '모집을 마감할까요?' });
    await expect(dialog).toContainText('더 이상 지원을 받지 않아요');
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await closed(), '취소했는데 마감됐다').toBe(false);

    await page.getByRole('button', { name: /모집 마감하기/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: '모집 마감', exact: true }).click();
    await expect.poll(closed, { timeout: 10000 }).toBe(true);
    // 다음 단계 버튼으로 바뀐다
    await expect(page.getByRole('button', { name: /전시 확정하기/ })).toBeVisible({ timeout: 10000 });
    await api.dispose();
    await ctx.close();
  });
});

test.describe('C. 작가 출품 자료 — 제출은 한 번', () => {
  test('★ 대표작을 저장 전에 고르고 [갤러리에 제출] 한 번 → 갤러리 화면에 제출 완료', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('출품'), galleryId: await ownedGalleryId(api) });
    await acceptVia(api, exId, 'artist');
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist');
    const card = await openArtistExhibition(page, exId);
    await expect(card.getByRole('button', { name: '갤러리에 제출' })).toBeVisible({ timeout: 10000 });

    // 작품 두 점 — 캡션 칸을 모두 채운다
    for (const [i, t] of ['첫 작품', '둘째 작품'].entries()) {
      await card.getByRole('button', { name: '작품 추가' }).click();
      const w = card.locator(`[id$="-art-${i}"]`);
      const field = (label: string) => w.locator('label').filter({ hasText: label }).locator('input').first();
      await field('작품명').fill(t);
      await field('세로').fill('60');
      await field('가로').fill('40');
      await field('재료').fill('캔버스에 아크릴');
      await field('제작년도').fill('2026');
      await field('가격').fill('500000');
    }
    // 대표작은 둘째 — 저장 전인데도 고를 수 있다
    const rep2 = card.locator('[id$="-art-1"]').getByRole('button', { name: '대표작', exact: true });
    await rep2.click();
    await expect(rep2).toHaveAttribute('aria-pressed', 'true');

    // 약력·작가노트
    await card.getByRole('tab', { name: /^약력/ }).click();
    await card.getByPlaceholder('예: 홍길동').fill('아티스트 일');
    await card.getByRole('tab', { name: /^작가노트/ }).click();
    await card.getByPlaceholder('작품 세계 전반에 대한 이야기를 자유롭게 작성하세요.').fill('E2E 작가노트 — 빛과 벽.');

    // 버튼 한 번. 비어 있는 게 없으니 되묻지도 않는다
    await card.getByRole('button', { name: '갤러리에 제출' }).click();
    await expect(page.locator('body')).toContainText('갤러리에 제출했어요', { timeout: 10000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(sectionToggle(card, '출품 자료')).toContainText('제출 완료', { timeout: 10000 });
    await ctx.close();

    // 서버 — 두 점 다 공개(draft 아님) · 대표작 1
    const api2 = await pwRequest.newContext();
    const me = await (await api2.get(`${API}/operations/${exId}/me`, { headers: auth('artist') })).json();
    expect(me.artworkList.map((a: any) => a.title)).toEqual(['첫 작품', '둘째 작품']);
    expect(me.artworkList.every((a: any) => !a.draft)).toBe(true);
    expect(me.representativeIndex).toBe(1);
    await api2.dispose();

    // 갤러리 — 제출 완료 칩 + 대표작 표시가 둘째에
    const g = await openAs(browser, 'gallery');
    await openGallerySubmissions(g.page, exId);
    const row = g.page.getByRole('button', { name: /출품작 2점/ }).first();
    await expect(row).toContainText('제출 완료');
    await row.click();
    // 작가 줄(li)이 작품 줄(li)을 품고 있다 — 가장 안쪽(마지막) 것이 작품 줄
    await expect(g.page.locator('li:has(span[title="둘째 작품"])').last()).toContainText('대표작');
    await expect(g.page.locator('li:has(span[title="첫 작품"])').last()).not.toContainText('대표작');
    await g.ctx.close();
  });
});

test.describe('D. 지원서 페이지', () => {
  test('★ 홈페이지로 미리 채워지고 약관만 동의하면 바로 낸다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    await ensurePublicArtworks(api, tokenFor('artist'), 2);
    const title = newTitle('지원서');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/exhibitions/${exId}`);
    await page.getByRole('button', { name: '지원하기' }).first().click();
    await page.waitForURL(new RegExp(`/exhibitions/${exId}/apply$`));
    await expect(page.getByText(/홈페이지\(포트폴리오\)에 적은/)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#apply-images img').first()).toBeVisible();

    // 약력이 비어 있을 수도 있다(홈페이지에 약력이 없으면) — 그땐 채운다
    const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
    if (!(await bio.inputValue()).trim()) await bio.fill('E2E 약력');
    await page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '지원하기' }).click();
    await page.waitForURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 10000 });
    await expect(page.getByText('지원 완료', { exact: true })).toBeVisible({ timeout: 10000 });
    await ctx.close();
  });
});

test.describe('E. 정산', () => {
  test('★ 0% 로 요청하면 확인창 → 비율을 고쳐 요청 → 작가 확인 → "모두 확인했어요" + [정산 완료]', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('정산'), galleryId: await ownedGalleryId(api) });
    await acceptVia(api, exId, 'artist');
    await api.put(`${API}/operations/${exId}/me`, {
      headers: auth('artist'),
      data: { artworkList: [{ title: '팔린 작품', size: '60x40', medium: 'oil', year: '2026', price: '1000000', image: '' }], cv: null, note: null, representativeIndex: 0 },
    });
    await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true, confirmed: true, ended: true } });
    const requested = async () => !!(await (await api.get(`${API}/operations/${exId}/settlement`, { headers: auth('gallery') })).json()).settlementRequested;

    const g = await openAs(browser, 'gallery');
    await g.page.goto(`/exhibitions/${exId}/operation/new`);
    await openSection(g.page, '정산');
    await g.page.getByLabel('팔린 작품 판매됨').check();
    await g.page.getByLabel('판매가').fill('1000000');

    // 갤러리 몫 0% 그대로 요청 → 되묻는다. [비율 고치기]면 요청되지 않는다
    await g.page.getByRole('button', { name: '작가에게 확인 요청' }).click();
    const ask = g.page.getByRole('dialog');
    await expect(ask).toContainText('0%');
    await ask.getByRole('button', { name: '비율 고치기' }).click();
    expect(await requested(), '비율 고치기를 눌렀는데 요청됐다').toBe(false);

    await g.page.getByLabel('갤러리 비율(%)').fill('30');
    await g.page.getByRole('button', { name: '작가에게 확인 요청' }).click();
    await expect.poll(requested, { timeout: 10000 }).toBe(true);
    await expect(g.page.getByText(/작가들이 금액을 확인하고 있어요/)).toBeVisible({ timeout: 10000 });

    // 작가 — [내 전시] 카드 안에서 확인
    const a = await openAs(browser, 'artist');
    const card = await openArtistExhibition(a.page, exId);
    await card.getByRole('button', { name: '정산 확인(수락)' }).click();
    await expect(a.page.locator('body')).toContainText('정산을 확인(수락)했습니다', { timeout: 10000 });
    await a.ctx.close();

    // 갤러리 — '확인하고 있어요' 가 아니라 '모두 확인했어요', 주 버튼은 [정산 완료]
    await g.page.reload();
    await openSection(g.page, '정산');
    await expect(g.page.getByText(/모두 금액을 확인했어요/).first()).toBeVisible({ timeout: 10000 });
    await expect(g.page.getByText(/작가들이 금액을 확인하고 있어요/)).toHaveCount(0);
    await expect(g.page.getByText('지금 · 정산 확인 완료').or(g.page.getByText('정산 확인 완료')).first()).toBeVisible();
    await expect(g.page.getByRole('button', { name: '정산 완료', exact: true })).toBeVisible();
    await api.dispose();
    await g.ctx.close();
  });
});

test.describe('F. 등록 폼 임시저장', () => {
  const KEY = 'draft_exhibition_form';
  const plant = async (page: Page, title: string, hoursAgo: number) => {
    await page.goto('/');
    await page.evaluate(([k, t, h]) => {
      const data = { galleryId: 0, title: t, type: 'GROUP', deadlineStart: '', deadline: '', exhibitStartDate: '', exhibitDate: '', submissionDeadline: '', recruitOnly: false, capacity: 3, region: 'SEOUL', description: '쓰다 만 소개', imageUrl: '', customFields: [] };
      localStorage.setItem(k as string, JSON.stringify({ data, savedAt: Date.now() - (h as number) * 3600e3 }));
    }, [KEY, title, hoursAgo]);
  };
  const stored = (page: Page) => page.evaluate((k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r).data.title : null; }, KEY);

  test('★ 하루 지난 초안도 남아 있고, 고르기 전엔 덮어쓰지 않으며, [이어서 쓰기]로 돌아온다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await plant(page, '겨울 소품전(쓰다 만 것)', 30);   // 예전엔 24시간 뒤 사라졌다
    await page.goto('/exhibitions/new');
    await expect(page.getByText('작성하던 공고가 있어요')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/겨울 소품전\(쓰다 만 것\)/)).toBeVisible();

    // 고르지 않고 입력 → 자동저장(3초)이 옛 초안을 덮지 않는다
    await page.locator('#ex-title').fill('다른 공고');
    await page.waitForTimeout(3800);
    expect(await stored(page)).toBe('겨울 소품전(쓰다 만 것)');
    // [임시저장]도 먼저 고르라고 한다
    await page.getByRole('button', { name: /임시저장/ }).click();
    await expect(page.locator('body')).toContainText('먼저 [이어서 쓰기] 또는 [새로 쓰기]');
    expect(await stored(page)).toBe('겨울 소품전(쓰다 만 것)');

    await page.getByRole('button', { name: '이어서 쓰기' }).click();
    await expect(page.locator('#ex-title')).toHaveValue('겨울 소품전(쓰다 만 것)');
    // 소개는 서식 있는 글 편집기(2026-10-03) — 처음 값만 읽던 편집기라 복원한 소개가 안 보일 뻔했다. 바깥 값 변경을 따라가야 한다
    await expect(page.getByRole('textbox', { name: '공모 소개' })).toContainText('쓰다 만 소개', { timeout: 15000 });
    await expect(page.getByText('작성하던 공고가 있어요')).toHaveCount(0);
    // 이제부터는 저장된다
    await page.locator('#ex-title').fill('겨울 소품전');
    await page.getByRole('button', { name: /임시저장/ }).click();
    await expect(page.locator('body')).toContainText('임시저장했어요');
    expect(await stored(page)).toBe('겨울 소품전');
    await expect(page.getByText(/저장됨/).first()).toBeVisible();
    await ctx.close();
  });

  test('★ [새로 쓰기]는 한 번 더 묻고, 확인하면 옛 초안을 지운다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await plant(page, '버릴 초안', 2);
    await page.goto('/exhibitions/new');
    await page.getByRole('button', { name: '새로 쓰기', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '작성하던 내용을 지우고 새로 쓸까요?' });
    await dialog.getByRole('button', { name: '취소' }).click();
    expect(await stored(page), '취소했는데 지워졌다').toBe('버릴 초안');

    await page.getByRole('button', { name: '새로 쓰기', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '지우고 새로 쓰기' }).click();
    await expect(page.getByText('작성하던 공고가 있어요')).toHaveCount(0);
    expect(await stored(page)).toBeNull();
    await expect(page.locator('#ex-title')).toHaveValue('');
    await ctx.close();
  });
});
