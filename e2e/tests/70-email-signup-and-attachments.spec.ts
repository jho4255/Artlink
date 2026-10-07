import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId, createExhibition, exhibitionDates, typeRich, settle } from '../lib/helpers';

/**
 * 이메일 가입(아티스트·갤러리·일반) · 이메일 로그인 · 비밀번호 찾기 · 약관은 끝까지 읽어야 체크 · 공모 첨부파일 (2026-10-08 사용자 결정)
 *
 * 인증번호는 로컬 백엔드의 '보내지 않은 메일' 보관함(`GET /api/auth/dev-mails`, 개발자 로그인과 같은 이중 차단)에서 읽는다 —
 * 테스트 주소는 `@e2e.test` 라 로컬 백엔드가 SMTP 로 보내지 않는다(backend lib/mailer.ts isDevFakeAddress).
 * ⚠️ 그래서 이 스펙은 백엔드에 `ENABLE_DEV_LOGIN=true` 가 있어야 돈다(다른 스펙의 개발자 로그인과 같은 조건).
 */
const API = 'http://localhost:4000/api';
const PW = 'gallery2026';
const NEW_PW = 'newpass2026';

/** 그 주소로 간 가장 최근 메일의 6자리 — 백엔드가 막 넣었을 수 있어 잠깐 기다린다 */
async function lastMail(api: APIRequestContext, email: string): Promise<{ code: string; subject: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await api.get(`${API}/auth/dev-mails`, { params: { to: email } });
    expect(res.status(), '백엔드에 ENABLE_DEV_LOGIN=true 가 필요하다').toBe(200);
    const list = await res.json();
    const m = list[0]?.text?.match(/인증번호: (\d{6})/);
    if (m) return { code: m[1], subject: list[0].subject };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${email} 로 간 인증번호 메일이 없다`);
}

/** 로그인 화면 → [회원가입] → 역할 → [이메일로 가입하기] (2026-10-08 — 로그인은 역할을 묻지 않고, 역할은 가입에서 고른다) */
async function openEmailSignup(page: import('@playwright/test').Page, role: RegExp) {
  await page.goto('/login');
  await page.getByRole('link', { name: '회원가입' }).click();
  await expect(page.getByRole('heading', { name: '회원가입' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('radio', { name: role }).click();
  await page.getByRole('link', { name: '이메일로 가입하기' }).click();
  // ⚠️ 화면 조각을 받는 동안에는 앞 화면이 그대로 남아 있다(라우터가 전환을 기다린다) — 앞 화면의 칸에 쓰지 않게
  await expect(page.getByRole('heading', { name: '이메일로 가입' })).toBeVisible({ timeout: 15000 });
}

/** 가입 동의 — 두 약관을 끝까지 내려야 체크된다(2026-10-08) */
async function readAndAgreeAll(page: import('@playwright/test').Page) {
  for (const name of ['이용약관 전문', '개인정보 처리방침 전문']) {
    await page.getByRole('region', { name }).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  }
  await page.getByRole('checkbox', { name: '전체 동의' }).check();
}

/** API 로 갤러리 이메일 가입 — 첨부·승인 화면 테스트의 준비용 */
async function signupByApi(api: APIRequestContext, email: string): Promise<{ token: string; userId: number }> {
  expect((await api.post(`${API}/auth/email/code`, { data: { email, purpose: 'signup' } })).status()).toBe(200);
  const { code } = await lastMail(api, email);
  const v = await api.post(`${API}/auth/email/verify`, { data: { email, purpose: 'signup', code } });
  expect(v.status()).toBe(200);
  const res = await api.post(`${API}/auth/email-signup`, {
    data: { verificationToken: (await v.json()).verificationToken, role: 'GALLERY', password: PW, name: '이투이', phone: '010-2222-3333', agreeTerms: true, agreePrivacy: true },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { token: body.token, userId: body.user.id };
}

test.describe('이메일 가입 · 로그인 · 비밀번호 찾기', () => {
  test('★ 로그인 → [회원가입] → 갤러리 → 이메일 가입 — 역할이 이어지고, 번호를 맞혀야 가입되고, 가입하면 갤러리 등록으로 간다', async ({ page }) => {
    const api = await pwRequest.newContext();
    const email = `e2e-g-${Date.now()}@e2e.test`;

    await openEmailSignup(page, /갤러리/);
    await expect(page).toHaveURL(/\/signup\/email\?role=GALLERY$/);
    // 회원가입 화면에서 고른 역할이 골라져 있다(여기서 바꿀 수 있다)
    await expect(page.getByRole('radio', { name: /갤러리/ })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
    await page.getByRole('button', { name: '인증번호 받기' }).click();
    const codeInput = page.getByLabel('인증번호');
    await expect(codeInput).toBeVisible({ timeout: 15000 });
    // 1분 안에는 다시 받을 수 없다 — 버튼이 남은 초를 보여 준다
    await expect(page.getByRole('button', { name: /다시 받기 \d+초/ })).toBeDisabled();

    const { code } = await lastMail(api, email);
    const wrong = code === '000000' ? '111111' : '000000';
    await codeInput.fill(wrong);
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('4번 더');

    // 인증 전에 [가입하기]를 누르면 먼저 인증하라고 한다
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '이메일 인증을 먼저' })).toBeVisible();

    await codeInput.fill(code);
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByText('인증 완료')).toBeVisible();

    await page.getByLabel('비밀번호', { exact: true }).fill(PW);
    await page.getByLabel('비밀번호 확인').fill(PW);
    await page.getByLabel('이름 (담당자)').fill('이투이');
    await page.getByLabel('휴대폰 번호').fill('010-2222-3333');

    // 약관은 끝까지 읽어야 체크된다 — 읽기 전에 누르면 체크되지 않고 이유가 뜬다
    const termsBox = page.getByRole('checkbox', { name: '이용약관에 동의합니다' });
    await termsBox.click({ force: true });   // aria-disabled — 사람은 누를 수 있고, 누르면 이유를 보여 준다
    await expect(termsBox).not.toBeChecked();
    await expect(page.getByRole('alert').filter({ hasText: '끝까지 읽어야 체크할 수 있어요' })).toBeVisible();
    await readAndAgreeAll(page);
    await expect(termsBox).toBeChecked();

    const posted = page.waitForRequest((r) => r.url().endsWith('/api/auth/email-signup') && r.method() === 'POST');
    await page.getByRole('button', { name: '가입하기' }).click();
    const body = (await posted).postDataJSON();
    expect(body.role).toBe('GALLERY');
    expect(body.verificationToken, '인증 토큰 없이 가입을 보냈다').toBeTruthy();
    expect(body.email, '주소는 인증 토큰에서만 온다 — 화면이 따로 보내면 남의 주소로 바꿔 보낼 수 있다').toBeUndefined();

    await expect(page).toHaveURL(/\/galleries\/new$/, { timeout: 15000 });
    await expect(page.locator('body')).toContainText('이제 갤러리를 등록해 주세요');
    const me = await (await api.post(`${API}/auth/login`, { data: { email, password: PW } })).json();
    expect(me.user.role).toBe('GALLERY');
    await api.dispose();
  });

  test('★ 아티스트도 이메일로 가입한다 — 가입하면 홈페이지 만들기(작품 올리기)로 간다', async ({ page }) => {
    const api = await pwRequest.newContext();
    const email = `e2e-artist-${Date.now()}@e2e.test`;
    await openEmailSignup(page, /아티스트/);
    await expect(page.getByRole('radio', { name: /아티스트/ })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
    await page.getByRole('button', { name: '인증번호 받기' }).click();
    await expect(page.getByLabel('인증번호')).toBeVisible({ timeout: 15000 });
    await page.getByLabel('인증번호').fill((await lastMail(api, email)).code);
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByText('인증 완료')).toBeVisible();
    await page.getByLabel('비밀번호', { exact: true }).fill(PW);
    await page.getByLabel('비밀번호 확인').fill(PW);
    await page.getByLabel('이름', { exact: true }).fill('김작가');
    await page.getByLabel('휴대폰 번호').fill('010-3333-4444');
    await readAndAgreeAll(page);
    await page.getByRole('button', { name: '가입하기' }).click();
    // 작품 0점 작가는 홈페이지 편집(작품 올리기)이 첫 화면이다 — 로그인과 같은 규칙(resolvePostLoginPath)
    await expect(page).toHaveURL(/\/mypage\?tab=homepage-edit/, { timeout: 15000 });
    const me = await (await api.post(`${API}/auth/login`, { data: { email, password: PW } })).json();
    expect(me.user.role).toBe('ARTIST');
    await api.dispose();
  });

  test('★ 이메일 로그인(대소문자 무시) — 역할을 묻지 않는다. 틀리면 이유를 말하고, 맞으면 마이페이지로', async ({ page }) => {
    const api = await pwRequest.newContext();
    const email = `e2e-login-${Date.now()}@e2e.test`;
    await signupByApi(api, email);

    await page.goto('/login');
    await expect(page.getByRole('radiogroup')).toHaveCount(0);   // 로그인하면 가입했던 계정 그대로 — 고를 것이 없다
    await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email.toUpperCase());
    await page.getByLabel('비밀번호').fill('wrongpass1');
    // 위 상단바에도 [로그인]이 있다 — 이메일 로그인 폼 안의 것
    const form = page.getByRole('form', { name: '이메일 로그인' });
    await form.getByRole('button', { name: '이메일로 로그인' }).click();
    await expect(page.getByRole('alert')).toContainText('맞지 않아요');

    await page.getByLabel('비밀번호').fill(PW);
    await form.getByRole('button', { name: '이메일로 로그인' }).click();
    await expect(page).toHaveURL(/\/mypage/, { timeout: 15000 });

    // 이 브라우저는 이메일로 들어온 적이 있다 — 로그아웃 뒤 로그인 화면에 오면 주소가 채워져 있다
    await page.evaluate(() => localStorage.removeItem('artlink-auth'));
    await page.goto('/login');
    await expect(page.getByRole('textbox', { name: '이메일', exact: true })).toHaveValue(email, { timeout: 10000 });
    await api.dispose();
  });

  test('★ 비밀번호 찾기 — 인증번호로 새 비밀번호를 정하면 바로 로그인되고 옛 비밀번호는 안 된다', async ({ page }) => {
    const api = await pwRequest.newContext();
    const email = `e2e-reset-${Date.now()}@e2e.test`;
    await signupByApi(api, email);

    await page.goto('/login');
    await page.getByRole('link', { name: '비밀번호 찾기' }).click();
    await expect(page).toHaveURL(/\/password\/reset$/);
    await expect(page.getByRole('heading', { name: '비밀번호 찾기' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
    await page.getByRole('button', { name: '인증번호 받기' }).click();
    await expect(page.getByLabel('인증번호')).toBeVisible({ timeout: 15000 });
    const mail = await lastMail(api, email);
    expect(mail.subject).toContain('비밀번호 재설정');
    await page.getByLabel('인증번호').fill(mail.code);
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByText('인증 완료')).toBeVisible();
    await page.getByLabel('새 비밀번호', { exact: true }).fill(NEW_PW);
    await page.getByLabel('새 비밀번호 확인').fill(NEW_PW);
    await page.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await expect(page).toHaveURL(/\/mypage/, { timeout: 15000 });
    await expect(page.locator('body')).toContainText('비밀번호를 바꿨어요');

    expect((await api.post(`${API}/auth/login`, { data: { email, password: PW } })).status()).toBe(401);
    expect((await api.post(`${API}/auth/login`, { data: { email, password: NEW_PW } })).status()).toBe(200);
    await api.dispose();
  });

  test('★ 역할은 [회원가입]에서 고른다 — 로그인 화면엔 없다. 고르면 카카오·이메일 가입, 카카오로 가입하면 회원 정보 입력에 그 역할', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '카카오로 로그인' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await page.getByRole('link', { name: '회원가입' }).click();
    await expect(page.getByRole('radiogroup', { name: '어떤 회원이신가요?' })).toBeVisible({ timeout: 15000 });
    // 고르기 전에는 가입 버튼이 없다
    await expect(page.getByRole('button', { name: '카카오로 가입하기' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '이메일로 가입하기' })).toHaveCount(0);
    for (const role of [/아티스트/, /일반/, /갤러리/]) {
      await page.getByRole('radio', { name: role }).click();
      await expect(page.getByRole('button', { name: '카카오로 가입하기' })).toBeVisible();
      await expect(page.getByRole('link', { name: '이메일로 가입하기' })).toBeVisible();
    }

    // 카카오로 떠난다(카카오 화면·토큰 교환은 가짜) → 돌아온 '회원 정보 입력'에 갤러리가 골라져 있다
    await page.route('https://kauth.kakao.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>kakao</p>' }));
    await page.route('**/api/auth/kakao', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ needsRegistration: true, tempToken: 'fake', profile: { name: '카카오 사용자', email: null, avatar: null } }),
    }));
    await page.getByRole('button', { name: '카카오로 가입하기' }).click();
    await page.waitForURL(/kauth\.kakao\.com/);
    const state = new URL(page.url()).searchParams.get('state');
    await page.goto(`/auth/kakao/callback?code=fake&state=${encodeURIComponent(state!)}`);
    await expect(page.getByRole('heading', { name: '회원 정보 입력' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^갤러리/ })).toHaveClass(/border-gray-900/);
    await expect(page.getByRole('button', { name: /^아티스트/ })).not.toHaveClass(/border-gray-900/);
  });

  test('공모 지원으로 오면 회원가입에 아티스트가 골라져 있다 — 광고 → 공모 → 지원 흐름에 한 번 더 누르지 않게', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.setItem('post_login_redirect', '/exhibitions/1/apply'));
    await page.goto('/signup');
    await expect(page.getByRole('radio', { name: /아티스트/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '카카오로 가입하기' })).toBeVisible();
  });

  test('카카오로 가입한 주소는 이메일 가입·비밀번호 찾기에서 카카오로 안내한다', async ({ page }) => {
    await page.goto('/signup/email');
    await expect(page.getByRole('heading', { name: '이메일로 가입' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('textbox', { name: '이메일', exact: true }).fill('gallery@artlink.com');   // 시드 갤러리(비밀번호 없음)
    await page.getByRole('button', { name: '인증번호 받기' }).click();
    await expect(page.getByRole('alert')).toContainText('카카오로 로그인', { timeout: 15000 });
    await expect(page.getByLabel('인증번호')).toHaveCount(0);
  });
});

test.describe('공모 첨부파일', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const HWP = Buffer.from('HWP Document File — E2E');

  test('★ 운영 갤러리가 상세에서 붙이면 비회원이 그 이름으로 내려받는다', async ({ browser, page }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: `E2E 첨부 ${Date.now()}`, galleryId: await ownedGalleryId(api) });

    const owner = await openAs(browser, 'gallery');
    await owner.page.goto(`/exhibitions/${exId}`);
    const region = owner.page.getByRole('region', { name: '첨부파일' });
    await region.getByRole('button', { name: '첨부파일 추가' }).click();
    await owner.page.getByTestId('attachment-input').setInputFiles([
      { name: '2026 모집 요강.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: '지원서 양식.hwp', mimeType: 'application/octet-stream', buffer: HWP },
    ]);
    await expect(owner.page.getByRole('list', { name: '붙인 파일' }).getByRole('listitem')).toHaveCount(2, { timeout: 20000 });
    await region.getByRole('button', { name: '저장', exact: true }).click();
    await expect(owner.page.locator('body')).toContainText('첨부파일을 저장했어요', { timeout: 10000 });
    await owner.ctx.close();

    // 비회원 — 목록이 보이고, 링크가 그 파일을 그대로 내려준다
    await page.goto(`/exhibitions/${exId}`);
    const pub = page.getByRole('region', { name: '첨부파일' });
    const links = pub.getByRole('link');
    await expect(links).toHaveCount(2, { timeout: 15000 });
    await expect(pub).toContainText('2026 모집 요강.pdf');
    await expect(pub).toContainText('한글');
    await expect(pub.getByRole('button', { name: /첨부파일 (편집|추가)/ })).toHaveCount(0);
    const first = links.first();
    expect(await first.getAttribute('download')).toBe('2026 모집 요강.pdf');
    const href = (await first.getAttribute('href'))!;
    const file = await page.request.get(href);
    expect(file.status()).toBe(200);
    expect(Buffer.from(await file.body()).equals(PDF)).toBe(true);
    await api.dispose();
  });

  test('★ 등록 폼에서 붙인 파일이 등록 요청에 실리고, 확인창이 개수를 말한다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    const d = exhibitionDates();
    await page.goto('/exhibitions/new');
    await settle(page, 800);
    await page.getByRole('button', { name: /공모만 진행/ }).click();
    await page.locator('#ex-gallery').selectOption({ index: 1 });
    await page.locator('#ex-title').fill(`E2E 첨부 등록 ${Date.now()}`);
    await page.locator('#ex-start').fill(d.deadlineStart);
    await page.locator('#ex-deadline').fill(d.deadline);
    await typeRich(page, '공모 소개', '요강을 첨부합니다.');
    await page.getByTestId('attachment-input').setInputFiles([{ name: '공간 도면.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') }]);
    await expect(page.getByRole('list', { name: '붙인 파일' })).toContainText('공간 도면.png', { timeout: 20000 });
    await page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();

    const posted = page.waitForRequest((r) => r.url().endsWith('/api/exhibitions') && r.method() === 'POST');
    await page.getByRole('button', { name: '등록 요청', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '공모 등록을 요청할까요?' });
    await expect(dialog).toContainText('첨부파일 1개');
    await dialog.getByRole('button', { name: '등록 요청', exact: true }).click();
    const body = (await posted).postDataJSON();
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ name: '공간 도면.png' });
    expect(body.attachments[0].url).toMatch(/\.png$/);   // 사진 업로드처럼 JPEG 로 바꾸지 않는다
    await ctx.close();
  });

  test('관리자 승인 화면 — 갤러리 가입 이메일과 \'이메일 인증됨\', 공고 첨부를 승인 전에 본다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const email = `e2e-approve-${Date.now()}@e2e.test`;
    const { token } = await signupByApi(api, email);
    const g = await api.post(`${API}/galleries`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `E2E 이메일갤러리 ${Date.now()}`, address: '서울 종로구', phone: '02-111-2222', description: '소개', region: 'SEOUL', ownerName: '이투이', email },
    });
    expect(g.status()).toBe(201);
    const gid = (await g.json()).id as number;
    // 그 갤러리가 첨부를 붙인 공고 — 승인은 갤러리가 먼저(공고는 승인된 갤러리에서만 올린다)
    await api.patch(`${API}/approvals/gallery/${gid}`, { headers: { Authorization: `Bearer ${tokenFor('admin')}` }, data: { status: 'APPROVED' } });
    const ex = await api.post(`${API}/exhibitions`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...exhibitionDates(), title: `E2E 승인전 첨부 ${Date.now()}`, type: 'GROUP', capacity: 3, region: 'SEOUL', description: '소개', galleryId: gid,
        attachments: [] },
    });
    expect(ex.status()).toBe(201);
    const exId = (await ex.json()).id as number;
    const up = await api.post(`${API}/upload/attachment`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: '모집 요강.pdf', mimeType: 'application/pdf', buffer: PDF } },
    });
    expect(up.status()).toBe(200);
    const uploaded = await up.json();
    expect((await api.patch(`${API}/exhibitions/${exId}/attachments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { attachments: [{ url: uploaded.url, name: uploaded.originalName, size: uploaded.size }] },
    })).status()).toBe(200);
    // 두 번째 갤러리 등록(아직 대기) — 승인 화면의 가입 계정 줄을 본다
    const g2 = await api.post(`${API}/galleries`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `E2E 대기갤러리 ${Date.now()}`, address: '서울 중구', phone: '02-333-4444', description: '소개', region: 'SEOUL', ownerName: '이투이', email },
    });
    expect(g2.status()).toBe(201);

    const { page, ctx } = await openAs(browser, 'admin');
    await page.goto('/mypage?tab=approvals');
    const galleryCard = page.locator('div.rounded-xl', { hasText: (await g2.json()).name }).first();
    await expect(galleryCard).toContainText(`가입 계정: 이투이 · ${email}`, { timeout: 15000 });
    await expect(galleryCard).toContainText('이메일 인증됨');
    await expect(galleryCard).toContainText('(가입 계정과 같음)');
    const exCard = page.locator('div.rounded-xl', { hasText: 'E2E 승인전 첨부' }).first();
    await expect(exCard.getByRole('list', { name: '첨부파일' })).toContainText('모집 요강.pdf');
    await ctx.close();
    await api.dispose();
  });
});
