import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 작가 로그인 뒤 '홈페이지 완성' 팝업 + 홈 배너 (2026-10-01)
 *
 *  A. 홈페이지를 덜 채운 작가가 **로그인하면** 팝업이 뜨고 비어 있는 항목만 보인다.
 *     [나중에] 면 그 로그인 동안 다시 안 뜨고, 다시 로그인하면 또 뜬다. 항목을 누르면 채우는 자리로 간다.
 *  B. [7일 동안 보지 않기] 를 누르면 다시 로그인해도 안 뜬다.
 *  C. 띄우면 안 되는 사람 — 다 채운 작가 · 작품 0점 작가(편집 화면으로 간다) · 갤러리.
 *  D. 하던 일을 끊지 않는다 — 초대 코드 화면에서는 기다렸다가, 다른 화면으로 나오면 뜬다.
 *  E. 홈 배너 — 사진이 통째로 보이고(자르지 않는다), 제목이 공백뿐인 한 장짜리 배너 아래에 빈 띠가 없다.
 *
 * ⚠️ 다른 스펙은 세션을 주입(`openAs`)해서 들어오므로 팝업이 예약되지 않는다 — 팝업은 **로그인 화면을 거칠 때만** 뜬다.
 *    그래서 여기서는 로그인 화면의 [개발자 로그인] 계정 검색으로 실제로 로그인한다.
 * ⚠️ E 는 크롬만 본다. 2026-10-01 의 잘림은 사파리(WebKit)에서만 났다 — 그건 `scratchpad/hero/matrix.js` 가 잰다.
 */
const API = 'http://localhost:4000/api';
const STAMP = Date.now();

interface Seeded { name: string; email: string; token: string }

async function signupArtist(api: APIRequestContext, key: string, slug: string): Promise<Seeded> {
  const name = `팝업${key}${String(STAMP).slice(-6)}`;
  const email = `nudge-${slug}-${STAMP}@e2e.test`; // 이메일엔 한글을 못 쓴다
  const r = await api.post(`${API}/auth/signup`, {
    data: { name, email, password: 'NudgeTest1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 ${key} 준비 실패 ${r.status()}: ${await r.text()}`);
  return { name, email, token: (await r.json()).token };
}

/** 작품 n 점(앞의 captioned 점만 정보가 있다), 공개 여부, 글 */
async function fillPortfolio(api: APIRequestContext, a: Seeded, o: { works: number; captioned: number; publish: boolean; statement: string; biography: string }) {
  const h = { Authorization: `Bearer ${a.token}` };
  await api.get(`${API}/portfolio`, { headers: h }); // 없으면 만든다
  for (let i = 0; i < o.works; i++) {
    const meta = i < o.captioned ? { title: `작품 ${i + 1}`, medium: 'Oil on canvas', sizeText: '72.7 × 60.6 cm', year: '2025' } : {};
    const r = await api.post(`${API}/portfolio/images`, { headers: h, data: { url: `/uploads/art${(i % 3) + 1}.png`, ...meta } });
    if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}: ${await r.text()}`);
    if (o.publish) await api.patch(`${API}/portfolio/images/${(await r.json()).id}/explore`, { headers: h });
  }
  const put = await api.put(`${API}/portfolio`, { headers: h, data: { statement: o.statement, biography: o.biography } });
  if (!put.ok()) throw new Error(`포트폴리오 저장 실패 ${put.status()}: ${await put.text()}`);
}

/** 로그인 화면의 [개발자 로그인] 계정 검색으로 **실제로** 로그인한다 */
async function loginViaUi(page: Page, who: Seeded | { name: string }, role: 'ARTIST' | 'GALLERY' = 'ARTIST') {
  await page.goto('/login');
  await page.getByRole('button', { name: /다른 계정으로 로그인/ }).click();
  if (role !== 'ARTIST') await page.getByRole('button', { name: '갤러리', exact: true }).click();
  await page.getByPlaceholder('이름 또는 이메일로 검색').fill(who.name);
  await page.getByRole('button', { name: new RegExp(who.name) }).first().click();
  await page.waitForURL((u) => u.pathname !== '/login', { timeout: 15_000 });
}

/** 토큰만 지워 로그아웃한 것과 같게 한다(화면의 로그아웃 버튼은 모바일에서 햄버거 안에 있다) */
async function signOut(page: Page) {
  await page.evaluate(() => localStorage.removeItem('artlink-auth'));
}

const nudge = (page: Page) => page.getByRole('dialog', { name: '홈페이지에 아직 빈 곳이 있어요' });

let partial: Seeded, snoozer: Seeded, complete: Seeded, empty: Seeded;

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  partial = await signupArtist(api, '일부', 'partial');
  await fillPortfolio(api, partial, { works: 4, captioned: 2, publish: false, statement: '', biography: '홍익대학교 회화과 졸업' });
  snoozer = await signupArtist(api, '미룸', 'snooze');
  await fillPortfolio(api, snoozer, { works: 3, captioned: 3, publish: true, statement: '', biography: '' });
  complete = await signupArtist(api, '완성', 'complete');
  await fillPortfolio(api, complete, { works: 3, captioned: 3, publish: true, statement: '작가노트', biography: '약력' });
  empty = await signupArtist(api, '빈손', 'empty'); // 작품 0점
  await api.dispose();
});

test.describe('A. 덜 채운 작가가 로그인하면 팝업이 뜬다', () => {
  test('★ 비어 있는 항목만 보이고, [나중에] 뒤엔 다시 로그인할 때까지 안 뜬다', async ({ page }) => {
    await loginViaUi(page, partial);
    const dlg = nudge(page);
    await expect(dlg).toBeVisible();

    // 비어 있는 것만 — 작품은 4점(3점 이상)이고 약력도 썼으니 그 둘은 없다
    await expect(dlg).toContainText('홈페이지 완성도 2/5');
    await expect(dlg.getByRole('button', { name: /작품 정보 채우기/ })).toContainText('2/4');
    await expect(dlg.getByRole('button', { name: /작가노트 쓰기/ })).toBeVisible();
    await expect(dlg.getByRole('button', { name: /\[작가\] 탭에 공개하기/ })).toContainText('0/4');
    await expect(dlg.getByRole('button', { name: /작품 3점 이상 올리기/ })).toHaveCount(0);
    await expect(dlg.getByRole('button', { name: /약력 쓰기/ })).toHaveCount(0);

    // 팝업이 화면을 가로로 밀지 않는다
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await dlg.getByRole('button', { name: '나중에' }).click();
    await expect(dlg).toHaveCount(0);

    // 다른 화면으로 가도, 새로고침해도 다시 안 뜬다
    await page.goto('/exhibitions');
    await page.waitForTimeout(1500);
    await expect(dlg).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(dlg).toHaveCount(0);

    // 다시 로그인하면 또 뜬다
    await signOut(page);
    await loginViaUi(page, partial);
    await expect(dlg).toBeVisible();
  });

  test('★ 항목을 누르면 그걸 채우는 자리로 가고 팝업은 닫힌다', async ({ page }) => {
    await loginViaUi(page, partial);
    const dlg = nudge(page);
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /작품 정보 채우기/ }).click();
    await expect(page).toHaveURL(/\/mypage\?tab=homepage-edit#artworks$/);
    await expect(dlg).toHaveCount(0);
    // 그 화면엔 같은 판정의 체크리스트가 있다 — 두 화면이 다른 답을 내지 않는다
    await expect(page.getByRole('region', { name: '홈페이지 완성도' })).toContainText('2/5 완료');
  });

  test('[지금 채우기] 는 첫 번째 빈 항목으로 간다 · ESC 로도 닫힌다', async ({ page }) => {
    await loginViaUi(page, partial);
    const dlg = nudge(page);
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);

    await signOut(page);
    await loginViaUi(page, partial);
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: '지금 채우기' }).click();
    await expect(page).toHaveURL(/\/mypage\?tab=homepage-edit/);
    await expect(dlg).toHaveCount(0);
  });
});

test.describe('B. 7일 동안 보지 않기', () => {
  test('★ 누르면 다시 로그인해도 안 뜬다 — 다른 작가에게는 그대로 뜬다', async ({ page }) => {
    await loginViaUi(page, snoozer);
    const dlg = nudge(page);
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: '7일 동안 보지 않기' }).click();
    await expect(dlg).toHaveCount(0);

    await signOut(page);
    await loginViaUi(page, snoozer);
    await page.waitForTimeout(2500);
    await expect(dlg).toHaveCount(0);

    // 같은 브라우저의 다른 작가는 영향받지 않는다(계정별)
    await signOut(page);
    await loginViaUi(page, partial);
    await expect(dlg).toBeVisible();
  });
});

test.describe('C. 띄우면 안 되는 사람', () => {
  test('★ 다 채운 작가 · 작품 0점 작가 · 갤러리에게는 뜨지 않는다', async ({ page }) => {
    const dlg = nudge(page);
    // 팝업이 잠깐이라도 떴는지 본다(떴다 닫히는 번쩍임)
    const seen: string[] = [];
    await page.exposeFunction('__nudgeSeen', (where: string) => { seen.push(where); });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="homepage-nudge"]')) (window as any).__nudgeSeen(location.pathname + location.search);
      }).observe(document, { childList: true, subtree: true });
    });

    await loginViaUi(page, complete);
    await page.waitForTimeout(2500);
    await expect(dlg).toHaveCount(0);

    // 작품 0점 — 팝업 대신 곧바로 홈페이지 편집 화면(시작하기 안내)
    await signOut(page);
    await loginViaUi(page, empty);
    await expect(page).toHaveURL(/\/mypage\?tab=homepage-edit/);
    await expect(page.getByRole('region', { name: '시작하기' })).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(dlg).toHaveCount(0);
    // 편집 화면에서 예약이 끝났으므로 다른 화면으로 가도 안 뜬다
    await page.goto('/');
    await page.waitForTimeout(1500);
    await expect(dlg).toHaveCount(0);

    await signOut(page);
    await loginViaUi(page, { name: 'Gallery Owner' }, 'GALLERY');
    await page.waitForTimeout(2500);
    await expect(dlg).toHaveCount(0);

    expect(seen, `팝업이 잠깐 떴다: ${seen.join(', ')}`).toEqual([]);
  });
});

test.describe('D. 하던 일을 끊지 않는다', () => {
  test('★ 초대 코드 화면에서는 기다렸다가, 다른 화면으로 나오면 뜬다', async ({ page }) => {
    await page.goto('/login');
    // 초대 링크로 들어왔다가 로그인하는 경우 — 로그인 뒤 그 화면으로 돌아간다
    await page.evaluate(() => sessionStorage.setItem('post_login_redirect', '/join/ZZZZ2345'));
    await loginViaUi(page, partial);
    await expect(page).toHaveURL(/\/join\/ZZZZ2345/);
    const dlg = nudge(page);
    await page.waitForTimeout(2500);
    await expect(dlg).toHaveCount(0);

    await page.goto('/exhibitions');
    await expect(dlg).toBeVisible();
  });
});

test.describe('E. 홈 배너 — 사진을 자르지 않는다', () => {
  const svg = (w: number, h: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f4f0e6"/><rect width="${w}" height="20" fill="#e61e1e"/><rect y="${h - 20}" width="${w}" height="20" fill="#1e3ce6"/></svg>`;

  async function openHome(page: Page, slides: unknown[]) {
    await page.route('**/api/hero-slides', (r) => r.fulfill({ json: slides }));
    await page.route('**/heroimg/*.svg', (r) => {
      const [w, h] = r.request().url().split('/').pop()!.replace('.svg', '').split('x').map(Number);
      return r.fulfill({ body: svg(w!, h!), contentType: 'image/svg+xml' });
    });
    await page.goto('/');
    await page.waitForFunction(() => {
      const im = document.querySelector<HTMLImageElement>('[data-testid="home-hero"] picture img');
      return !!im && im.complete && im.naturalWidth > 0;
    });
    await page.waitForTimeout(600);
  }

  /** 그림(contain 으로 앉은 영역)이 트랙 안에 얼마나 보이는가 */
  const visibleShare = (page: Page) => page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="home-hero"] picture img')!;
    const track = img.closest('[data-index]')!.parentElement!;
    const b = img.getBoundingClientRect(), t = track.getBoundingClientRect();
    const k = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight);
    const cw = img.naturalWidth * k, ch = img.naturalHeight * k;
    const cx = b.x + (b.width - cw) / 2, cy = b.y + (b.height - ch) / 2;
    const ix = Math.max(0, Math.min(t.right, cx + cw) - Math.max(t.left, cx));
    const iy = Math.max(0, Math.min(t.bottom, cy + ch) - Math.max(t.top, cy));
    return { share: (ix * iy) / (cw * ch), vscroll: track.scrollHeight > track.clientHeight + 1, fit: getComputedStyle(img).objectFit, pos: getComputedStyle(img).position };
  });

  test('★ 3:1 배너 한 장·제목 공백 — 통째로 보이고 아래에 빈 띠가 없다', async ({ page }) => {
    await openHome(page, [{ id: 1, title: ' ', description: '', imageUrl: '/heroimg/2000x667.svg', mobileImageUrl: null, linkUrl: null, order: 0 }]);
    const v = await visibleShare(page);
    expect(v.fit).toBe('contain');
    expect(v.pos).toBe('absolute');
    expect(v.share).toBeGreaterThan(0.999);
    expect(v.vscroll).toBe(false);
    await expect(page.locator('[data-hero-caption]')).toHaveCount(0);
    // 배너 구역의 높이 = 사진 높이 (+ 아래 테두리 1px) — 빈 캡션 줄이 끼지 않았다
    const { hero, track } = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="home-hero"]')!.getBoundingClientRect().height;
      const t = document.querySelector('[data-hero-frame]')!.getBoundingClientRect().height;
      return { hero: h, track: t };
    });
    expect(hero - track).toBeLessThanOrEqual(2);
  });

  test('세로형 모바일 이미지(4:5·9:16)도 통째로 보인다 · 제목이 있으면 캡션 줄은 그대로 있다', async ({ page }) => {
    await openHome(page, [{ id: 1, title: '가을 공모', description: '', imageUrl: '/heroimg/2000x667.svg', mobileImageUrl: '/heroimg/1080x1350.svg', linkUrl: null, order: 0 }]);
    let v = await visibleShare(page);
    expect(v.share).toBeGreaterThan(0.999);
    expect(v.vscroll).toBe(false);

    await openHome(page, [{ id: 1, title: '가을 공모', description: '', imageUrl: '/heroimg/2000x667.svg', mobileImageUrl: '/heroimg/1080x1920.svg', linkUrl: null, order: 0 }]);
    v = await visibleShare(page);
    expect(v.share).toBeGreaterThan(0.999);

    // 모바일 이미지가 없고 제목이 있으면 — 얇은 배너 아래 캡션 줄에 제목이 나온다(종전 동작)
    await openHome(page, [{ id: 1, title: '가을 공모', description: '', imageUrl: '/heroimg/2000x667.svg', mobileImageUrl: null, linkUrl: null, order: 0 }]);
    await expect(page.locator('[data-hero-caption]')).toContainText('가을 공모');
  });
});
