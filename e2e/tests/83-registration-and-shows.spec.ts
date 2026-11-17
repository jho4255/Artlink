import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId, kstDay, pickSchedule, solidPng, typeRich, submitRegistration, statePath } from '../lib/helpers';

/**
 * 등록 화면 · 전시 찾기 · 전시 상세 개편(2026-11-15, CLAUDE.md 규칙 84 — 등록 화면 · 전시 화면) — **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 갤러리 등록 — 남은 필수 → 그 칸으로 · 주소를 치면 지역이 따라온다(경기 고양 → 경기 북부) · 미리보기는 홈페이지 하나 · 확인 창에서 약관 없이 못 보낸다 · 보낸 주소는 한 줄
 *  B. 공모 등록 — 휴대폰 미리보기 시트가 입력을 따라간다(제목·유형) · 일정 칸 이름은 '접수'
 *  C. 전시 등록 — 포스터 · 지난날 시작(이미 하고 있는 전시) · 관람 시간 · 작가 → 확인 창 → 등록 요청 → 승인 → 전시 찾기 [진행·예정] '전시 중' 묶음
 *  D. 전시 상세 — 기간 띠 · 관람 정보 · 장소 [지도] · 다른 전시 · 찜(로그인)
 *  E. 이미 등록된 갤러리 — 주소를 못 읽으면 주인에게만 '주소 검색으로 다시 넣기' → 정보 수정 칸이 열린다
 * ⚠️ 주소 검색(카카오 우편번호)은 바깥 스크립트라 여기서 부르지 않는다 — 직접 입력 길만 본다(검색 길은 하니스로 봤다).
 */
const API = 'http://localhost:4000/api';
const STAMP = Date.now();
const auth = (role: 'gallery' | 'admin' | 'artist') => ({ Authorization: `Bearer ${tokenFor(role)}` });

async function desktop(browser: import('@playwright/test').Browser, role: 'gallery' | 'admin' | 'artist') {
  const ctx = await browser.newContext({ storageState: statePath(role), viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });
  return { ctx, page: await ctx.newPage() };
}
const bar = (page: Page) => page.locator('[data-submit-bar]');

test('A ★ 갤러리 등록 — 남은 칸으로 · 주소로 지역 · 미리보기 · 약관은 확인 창 · 주소 한 줄 (PC)', async ({ browser }) => {
  const { ctx, page } = await desktop(browser, 'gallery');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/galleries/new');
  await expect(page.getByRole('heading', { name: '갤러리 등록' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).not.toContainText('위 약관에 동의합니다');

  // 남은 필수 → 그 칸으로
  await expect(bar(page)).toContainText('남은 필수 5');
  await bar(page).getByRole('button', { name: /남은 필수/ }).click();
  await expect(page.getByPlaceholder('갤러리명')).toBeFocused();

  const name = `E2E 등록 갤러리 ${STAMP}`;
  await page.getByPlaceholder('갤러리명').fill(name);
  await page.getByPlaceholder('갤러리 한줄 소개').fill('E2E 소개');
  // 주소를 직접 치고 나가면(blur) 지역이 따라온다 — 경기 고양시 = 경기 북부
  await page.getByPlaceholder('주소', { exact: true }).fill('경기 고양시 덕양구 화중로 104');
  await page.getByPlaceholder('상세 주소 (층·호수, 선택)').click();
  await expect(page.getByLabel('지역', { exact: true })).toHaveValue('GYEONGGI_NORTH');
  await page.getByPlaceholder('상세 주소 (층·호수, 선택)').fill('2층');
  await page.getByPlaceholder('전화번호').fill('031-000-0000');
  await page.getByPlaceholder('대표자명').fill('홍길동');
  await expect(bar(page)).toContainText('필수 항목을 다 채웠어요');

  // 미리보기(넓은 화면 — 오른쪽 칸) — 갤러리 홈페이지 하나(찾기 카드는 미리 보여 주지 않는다), 방문 정보에 주소 한 줄
  const aside = page.getByRole('complementary', { name: '미리보기' });
  await expect(aside).toContainText('갤러리 홈페이지');
  await expect(aside).not.toContainText('갤러리 찾기');
  await expect(aside).toContainText(name);
  await expect(aside).toContainText('경기 고양시 덕양구 화중로 104 2층');

  // 약관 동의 없이 [등록 요청] → 막힌다(창은 그대로)
  const posted = page.waitForRequest((r) => r.url().endsWith('/api/galleries') && r.method() === 'POST');
  await bar(page).getByRole('button', { name: '등록 요청', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '등록을 요청할까요?' });
  await expect(sheet).toContainText('공개 안 함');
  await sheet.getByRole('button', { name: '등록 요청', exact: true }).click();
  await expect(sheet.getByText('약관에 동의해야 등록을 요청할 수 있어요.')).toBeVisible();
  await sheet.getByRole('button', { name: /약관 보기/ }).click();
  await expect(sheet).toContainText('갤러리 등록 약관');
  await sheet.getByRole('checkbox').check();
  await sheet.getByRole('button', { name: '등록 요청', exact: true }).click();
  const body = (await posted).postDataJSON();
  expect(body.address).toBe('경기 고양시 덕양구 화중로 104 2층');
  expect(body.region).toBe('GYEONGGI_NORTH');
  expect(body).not.toHaveProperty('addressDetail');
  await expect(page.locator('body')).toContainText('갤러리 등록 요청이 제출되었습니다', { timeout: 8000 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B 공모 등록 — 휴대폰 미리보기 시트가 입력을 따라간다 · 일정 칸 이름은 접수', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, 'gallery');
  await page.goto('/exhibitions/new');
  await expect(page.locator('#ex-start')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('접수 시작일', { exact: false }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('공모는 이렇게 진행돼요');
  await page.getByPlaceholder('공모 제목').fill(`E2E 미리보기 ${STAMP}`);
  await page.getByRole('button', { name: '단체전' }).click();
  await bar(page).getByRole('button', { name: '미리보기' }).click();
  const sheet = page.getByRole('dialog', { name: '미리보기' });
  // 공고 상세 하나 — 모집공고 목록 카드(탭)는 없다
  await expect(sheet.getByRole('tab')).toHaveCount(0);
  await expect(sheet).toContainText('공고 상세');
  await expect(sheet).toContainText(`E2E 미리보기 ${STAMP}`);
  await expect(sheet).toContainText('단체전');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // 임시저장은 하단 줄 첫 줄의 글자 단추(휴대폰)
  await bar(page).getByRole('button', { name: '임시저장' }).click();
  await expect(page.locator('body')).toContainText(/임시저장했어요|먼저 \[이어서 쓰기\]/);
  await page.evaluate(() => localStorage.removeItem('draft_exhibition_form'));
  await ctx.close();
});

test('C ★ 전시 등록 — 지난날 시작도 된다 · 확인 창 · 승인 → 전시 찾기 \'전시 중\' (휴대폰)', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, 'gallery');
  const title = `E2E 전시 등록 ${STAMP}`;
  await page.goto('/shows/new');
  await expect(page.getByPlaceholder('전시 제목')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => localStorage.removeItem('draft_show_form'));
  // 포스터
  await page.locator('[data-field="posterImage"] input[type="file"]').setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: solidPng(420, 594, [40, 90, 70]) });
  await expect(page.locator('[data-field="posterImage"] img').first()).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder('전시 제목').fill(title);
  // 갤러리가 여럿이면 고른다 — 하나면 고르는 칸 없이 그 갤러리
  const sel = page.locator('#show-gallery');
  if (await sel.count()) await sel.selectOption({ index: 1 });
  await expect(page.locator('#show-location')).not.toHaveValue('');   // 고른 갤러리 주소로 채워진다
  // 기간 — 사흘 전 시작(이미 하고 있는 전시) ~ 20일 뒤
  await pickSchedule(page, '#show-start', [kstDay(-3), kstDay(20)]);
  await page.getByLabel('관람 시작 시간').fill('11:00');
  await page.getByLabel('관람 종료 시간').fill('19:00');
  await page.getByPlaceholder('무료, 5,000원').fill('무료');
  await page.getByLabel('참여 작가 1').fill('김작가');
  await typeRich(page, '전시 소개', 'E2E 전시 소개');
  await expect(bar(page)).toContainText('필수 항목을 다 채웠어요');

  const posted = page.waitForRequest((r) => r.url().endsWith('/api/shows') && r.method() === 'POST');
  const sheet = await submitRegistration(page);
  const body = (await posted).postDataJSON();
  expect(body.openingHours).toBe('11:00-19:00');
  expect(body.startDate).toBe(kstDay(-3));
  expect(body.artists).toEqual([{ name: '김작가' }]);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('body')).toContainText('전시 등록 요청이 완료되었습니다', { timeout: 8000 });
  await ctx.close();

  // 승인 → 전시 찾기 [진행·예정] 의 '전시 중' 묶음에(비회원)
  const api = await pwRequest.newContext();
  const mine = (await (await api.get(`${API}/shows/my-shows`, { headers: auth('gallery') })).json()).find((s: any) => s.title === title);
  expect(mine, '등록한 전시가 내 전시에 없다').toBeTruthy();
  await api.patch(`${API}/approvals/show/${mine.id}`, { headers: auth('admin'), data: { status: 'APPROVED' } });
  await api.dispose();
  const anon = await browser.newPage();
  await anon.goto('/shows');
  const group = anon.locator('section', { has: anon.getByRole('heading', { name: '전시 중', exact: true }) });
  await expect(group).toContainText(title, { timeout: 10000 });
  await expect(group.locator('li', { hasText: title })).toContainText(/D-\d+ 종료|전시 중/);
  await anon.close();
});

test('D 전시 상세 — 기간 띠 · 관람 정보 · 장소 지도 · 다른 전시 · 찜 (PC)', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const mk = async (title: string, start: number, end: number) => {
    const s = await (await api.post(`${API}/shows`, {
      headers: auth('gallery'),
      data: {
        title, description: '<p>소개</p>', startDate: kstDay(start), endDate: kstDay(end), openingHours: '10:00-18:00', admissionFee: '5,000원',
        location: '서울 종로구 삼일대로 445', region: 'SEOUL', artists: [{ name: '이작가' }], posterImage: '/uploads/poster.png', galleryId,
      },
    })).json();
    await api.patch(`${API}/approvals/show/${s.id}`, { headers: auth('admin'), data: { status: 'APPROVED' } });
    return s.id as number;
  };
  const a = await mk(`E2E 상세 A ${STAMP}`, -2, 5);
  await mk(`E2E 상세 B ${STAMP}`, 3, 30);
  await api.dispose();

  const { ctx, page } = await desktop(browser, 'artist');
  await page.goto(`/shows/${a}`);
  await expect(page.getByRole('heading', { level: 1, name: `E2E 상세 A ${STAMP}` })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).toContainText(/D-5 종료/);   // 끝나기 7일 안 — 빨강
  const period = page.locator('section', { has: page.getByRole('heading', { name: '기간', exact: true }) });
  await expect(period).toContainText('전시 시작');
  await expect(period).toContainText('전시 종료 · 5일 남음');
  await expect(page.locator('body')).toContainText('10:00 – 18:00');
  await expect(page.getByTestId('show-location').getByRole('link', { name: '지도' })).toHaveAttribute('href', /map\.kakao\.com/);
  const more = page.locator('section', { has: page.getByRole('heading', { name: '다른 전시' }) });
  await expect(more).toContainText(`E2E 상세 B ${STAMP}`);
  // 찜 — 글자 단추(PC)
  const heart = page.getByRole('button', { name: '찜하기' });
  await heart.click();
  await expect(page.getByRole('button', { name: '찜 해제' })).toBeVisible();
  await page.getByRole('button', { name: '찜 해제' }).click();
  await expect(page.getByRole('button', { name: '찜하기' })).toBeVisible();
  await ctx.close();
});

test('E 이미 등록된 갤러리 — 주소를 못 읽으면 주인에게만 \'주소 검색으로 다시 넣기\'', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const before = await (await api.get(`${API}/galleries/${galleryId}`)).json();
  // 주소 검색이 생기기 전처럼 자유 글 주소로 만든다(시·도·구 없음)
  await api.patch(`${API}/galleries/${galleryId}/detail`, { headers: auth('gallery'), data: { address: 'E2E 아트브릿지' } });
  try {
    const { ctx, page } = await openAs(browser, 'gallery');
    await page.goto(`/galleries/${galleryId}`);
    const fix = page.getByTestId('gallery-address-fix');
    await expect(fix).toHaveText('주소 검색으로 다시 넣기', { timeout: 15000 });
    await fix.click();
    const form = page.getByTestId('gallery-contact-form');
    await expect(form.getByPlaceholder('주소', { exact: true })).toHaveValue('E2E 아트브릿지');
    await expect(form.getByRole('button', { name: '주소 검색' })).toBeVisible();
    await ctx.close();
    // 방문자에게는 없다
    const anon = await browser.newPage();
    await anon.goto(`/galleries/${galleryId}`);
    await expect(anon.getByTestId('gallery-visit-info')).toContainText('E2E 아트브릿지', { timeout: 15000 });
    await expect(anon.getByTestId('gallery-address-fix')).toHaveCount(0);
    await anon.close();
  } finally {
    await api.patch(`${API}/galleries/${galleryId}/detail`, { headers: auth('gallery'), data: { address: before.address, region: before.region } });
    await api.dispose();
  }
});
