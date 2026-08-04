import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, userIds, applyToExhibition, ownedGalleryId, openApplicantManager } from '../lib/helpers';

/**
 * 다운로드 실패 회수 + 그동안 커버리지가 없던 PDF 경로 (2026-08-04)
 *
 * 배경: "전체 다운로드에서 하나라도 빠지면 어떡하냐, 될 때까지 해야 하는 것 아니냐"는 지적.
 * 무작정 기다리게 할 수는 없으니 3겹으로 답했고, 이 스펙이 그 3겹을 전부 검증한다.
 *   ① 자동 회수 : 배치가 끝난 뒤 실패분만 다시 (동시성 경쟁이 사라져 실제로 성공한다)
 *   ② 수동 재시도: 사라지지 않는 배너 + [다시 받기] — 이미 받은 건 재사용
 *   ③ 자기기록  : ZIP 안에 `_받지못한작품.txt`
 *
 * 함께: 정산서·지원서 PDF는 E2E 커버리지가 0이었다(이미지 선수집을 넣으면서 함께 붙인다).
 *
 * ※ 이미지는 실서비스 탐색 피드에서 **읽기만** 해 진짜 R2 주소를 얻는다(스펙 27과 동일 방식).
 *   R2 CORS가 열려 있어 localhost에서도 직접 로드된다. 쓰기는 전부 로컬 서버 대상.
 */
const API = 'http://localhost:4000/api';
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const gAuth = () => auth(tokenFor('gallery'));

async function realArtworkUrls(api: APIRequestContext, n: number): Promise<string[]> {
  const r = await api.get('https://artlink.cc/api/explore?limit=40');
  const d = await r.json();
  const urls: string[] = [...new Set<string>((d.images || []).map((i: any) => i.url))].filter((u) => u.startsWith('http'));
  expect(urls.length, '실제 R2 이미지 확보').toBeGreaterThanOrEqual(n);
  return urls.slice(0, n);
}

/** 승인 공모 생성 (지원 전) */
async function seedExhibition(api: APIRequestContext, title: string) {
  const galleryId = await ownedGalleryId(api);
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const fullTitle = `${title} ${Date.now()}`;
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: gAuth(),
    data: {
      title: fullTitle, type: 'SOLO', deadlineStart: today, deadline: future,
      exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울',
      description: '다운로드 회수 E2E', galleryId,
    },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: auth(tokenFor('admin')), data: { status: 'APPROVED' } });
  return { exId: ex.id as number, title: fullTitle };
}

/** 승인 공모 + 작가 수락까지 */
async function seedAccepted(api: APIRequestContext, title: string) {
  const { exId, title: fullTitle } = await seedExhibition(api, title);
  await applyToExhibition(api, exId, tokenFor('artist'));
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: gAuth() })).json();
  const mine = (apps.applications || apps).find((a: any) => a.userId === userIds().artist);
  await api.patch(`${API}/exhibitions/${exId}/applications/${mine.id}`, { headers: gAuth(), data: { status: 'ACCEPTED' } });
  return { exId, title: fullTitle };
}

/** 출품작 제출 (urls 순서대로) */
async function submitArtworks(api: APIRequestContext, exId: number, urls: string[]) {
  await api.put(`${API}/operations/${exId}/me`, {
    headers: auth(tokenFor('artist')),
    data: {
      artworkList: urls.map((image, i) => ({
        image, title: `작품${i + 1}`, size: '50x50', medium: 'Oil on canvas', year: '2025', price: '1,000,000',
      })),
      cv: { nameKo: '테스트작가', nameEn: 'Test', birth: '1990', tel: '010-0000-0000', email: 'a@b.c', education: [], solo: [], group: [], artFair: [], award: [] },
      note: { statement: 'E2E 작가노트', sections: [] },
    },
  });
}

/** ZIP 안의 파일 목록 */
async function zipEntries(zipPath: string): Promise<string[]> {
  const { execFileSync } = await import('child_process');
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// ① 자동 회수
// ─────────────────────────────────────────────────────────────

test('★ 처음 실패한 이미지를 자동 회수해 결국 전부 받는다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const { exId } = await seedAccepted(api, '자동회수');
  const urls = await realArtworkUrls(api, 4);
  await submitArtworks(api, exId, urls);

  const { page, ctx } = await openAs(browser, 'gallery');

  // 특정 이미지 1장을 **첫 두 번만** 실패시킨다(직접 시도 + 프록시 폴백).
  // → 1차 배치에서는 실패, 배치 종료 후 자동 회수에서 성공해야 한다.
  // fetchImage 한 장의 시도 순서: R2 직접 → 프록시 → (retryable이면) 프록시 1회 재시도.
  // 즉 3번을 막아야 비로소 '배치 실패'가 되고 그때부터 배치 종료 후 자동 회수가 개입한다.
  const doomed = urls[0];
  const ATTEMPTS_PER_IMAGE = 3;
  let blocked = 0;
  await page.route(
    (u) => u.href === doomed || u.href.includes(encodeURIComponent(doomed)),
    async (route) => {
      if (blocked < ATTEMPTS_PER_IMAGE) { blocked += 1; await route.fulfill({ status: 500, body: 'boom' }); return; }
      await route.continue();
    },
  );

  await page.goto(`/exhibitions/${exId}/operation`);
  const btn = page.getByRole('button', { name: /작품 원본/ }).first();
  await expect(btn).toBeVisible({ timeout: 20000 });

  const dlPromise = page.waitForEvent('download', { timeout: 150_000 });
  await btn.click();

  // 자동 회수 단계가 실제로 돌았는지 — 버튼 라벨이 '재시도 n/m'으로 바뀐다
  await expect(page.locator('body'), '자동 회수 단계 노출').toContainText(/재시도 \d+\/\d+/, { timeout: 60_000 });

  const dl = await dlPromise;
  expect(blocked, '실제로 실패를 주입했는지').toBe(ATTEMPTS_PER_IMAGE);
  // 회수에 성공했으므로 실패 0 — 전부 담겨야 한다
  await expect(page.locator('body')).toContainText(`원본 ${urls.length}개 ZIP 다운로드 시작`, { timeout: 30_000 });
  await expect(page.locator('body'), '회수됐으면 실패 안내가 없어야 한다').not.toContainText('받지 못했습니다');

  const names = await zipEntries((await dl.path())!);
  expect(names).toHaveLength(urls.length);
  expect(names.some((n) => n.includes('받지못한작품')), '전부 받았으면 누락 메모가 없어야 한다').toBe(false);

  await api.dispose();
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────
// ② 수동 재시도 + ③ ZIP 자기기록
// ─────────────────────────────────────────────────────────────

test('★ 끝내 못 받으면 배너로 남고, [다시 받기]로 완전한 ZIP을 받는다', async ({ browser }) => {
  test.setTimeout(240_000);
  const api = await pwRequest.newContext();
  const { exId } = await seedAccepted(api, '수동재시도');
  const urls = await realArtworkUrls(api, 3);
  await submitArtworks(api, exId, urls);

  const { page, ctx } = await openAs(browser, 'gallery');

  // 1장을 계속 실패시킨다 → 자동 회수도 실패 → 배너가 떠야 한다.
  // 그 뒤 차단을 풀고 [다시 받기]를 누르면 완전한 ZIP이 나와야 한다.
  const doomed = urls[0];
  let blocking = true;
  await page.route(
    (u) => u.href === doomed || u.href.includes(encodeURIComponent(doomed)),
    async (route) => {
      if (blocking) { await route.fulfill({ status: 500, body: 'boom' }); return; }
      await route.continue();
    },
  );

  await page.goto(`/exhibitions/${exId}/operation`);
  const btn = page.getByRole('button', { name: /작품 원본/ }).first();
  await expect(btn).toBeVisible({ timeout: 20000 });

  const firstDl = page.waitForEvent('download', { timeout: 200_000 });
  await btn.click();
  const dl1 = await firstDl;

  // 배너: 사라지는 토스트가 아니라 계속 남아 있어야 한다
  const banner = page.getByText(/작품 원본 1건을 받지 못했습니다/);
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '다시 받기' })).toBeVisible();
  await expect(page.locator('body'), '어떤 작품인지 알려준다').toContainText('작품1');

  // 토스트가 사라질 시간이 지나도 배너는 남아 있어야 한다 (이게 핵심)
  await page.waitForTimeout(9_000);
  await expect(banner, '토스트와 달리 배너는 사라지지 않는다').toBeVisible();

  // ③ ZIP이 스스로 누락을 증언한다
  const names1 = await zipEntries((await dl1.path())!);
  expect(names1).toContain('_받지못한작품.txt');
  expect(names1.filter((n) => !n.startsWith('_'))).toHaveLength(urls.length - 1);

  // ② 다시 받기 — 이번엔 통과시킨다
  blocking = false;
  const secondDl = page.waitForEvent('download', { timeout: 150_000 });
  await page.getByRole('button', { name: '다시 받기' }).click();
  const dl2 = await secondDl;

  const names2 = await zipEntries((await dl2.path())!);
  expect(names2, '이번엔 전부 담겨야 한다').toHaveLength(urls.length);
  expect(names2.some((n) => n.includes('받지못한작품')), '누락 메모가 없어야 한다').toBe(false);

  await api.dispose();
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────
// 그동안 커버리지가 없던 PDF 경로 (정산서 / 지원서)
// ─────────────────────────────────────────────────────────────

test('정산서 PDF — 이미지를 선수집해 백엔드 중계 없이 내려온다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const urls = await realArtworkUrls(api, 2);
  const { exId } = await seedAccepted(api, '정산PDF');
  await submitArtworks(api, exId, urls);
  await api.patch(`${API}/operations/${exId}/lifecycle`, {
    headers: gAuth(), data: { recruitmentClosed: true, confirmed: true, ended: true },
  });
  await api.put(`${API}/operations/${exId}/settlement`, {
    headers: gAuth(),
    data: {
      sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품1', soldPrice: 1000000 }],
      ratios: [{ artistUserId: userIds().artist, galleryRatio: 30 }],
    },
  });

  const { page, ctx } = await openAs(browser, 'gallery');
  // 선수집이 실제로 도는지 — 백엔드 프록시 호출 수를 센다(예전엔 이미지마다 중계를 탔다)
  const proxied: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/upload/image-proxy')) proxied.push(r.url()); });

  await page.goto(`/exhibitions/${exId}/operation`);
  const btn = page.getByRole('button', { name: '전체 정산 PDF' }).first();
  await expect(btn).toBeVisible({ timeout: 30_000 });

  const dlPromise = page.waitForEvent('download', { timeout: 120_000 });
  await btn.click();
  const dl = await dlPromise;

  expect(dl.suggestedFilename()).toMatch(/전체정산서\.pdf$/);
  expect(await dl.path(), 'PDF 파일 저장됨').toBeTruthy();
  expect(proxied, `R2에서 직접 받으므로 백엔드 중계를 타지 않는다. 실제: ${JSON.stringify(proxied)}`).toHaveLength(0);
  await expect(page.locator('body'), '이미지 누락 없음').not.toContainText('빠졌습니다');

  await api.dispose();
  await ctx.close();
});

test('지원서 전체 ZIP — 작품 사진을 선수집하고 실제 파일이 내려온다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const urls = await realArtworkUrls(api, 3);
  const { exId, title } = await seedExhibition(api, '지원서PDF');
  // 지원서의 작품 사진을 **진짜 R2 주소**로 넣는다(기본 헬퍼는 example.com 더미라 항상 실패한다)
  await applyToExhibition(api, exId, tokenFor('artist'), { artworkImages: urls });

  const { page, ctx } = await openAs(browser, 'gallery');
  let proxyHits = 0;
  page.on('request', (r) => { if (r.url().includes('/api/upload/image-proxy')) proxyHits += 1; });

  await openApplicantManager(page, title);
  const zipBtn = page.getByRole('button', { name: '전체 지원서 ZIP' }).first();
  await expect(zipBtn).toBeVisible({ timeout: 30_000 });

  const dlPromise = page.waitForEvent('download', { timeout: 150_000 });
  await zipBtn.click();
  const dl = await dlPromise;

  expect(dl.suggestedFilename()).toMatch(/지원서\.zip$/);
  const names = await zipEntries((await dl.path())!);
  expect(names.some((n) => n.endsWith('_지원서.pdf')), '지원서 PDF가 들어있다').toBe(true);
  expect(names.some((n) => n.includes('받지못한작품')), '사진 누락 없음').toBe(false);
  expect(proxyHits, '선수집이 R2 직접 경로를 쓴다').toBe(0);

  await api.dispose();
  await ctx.close();
});

test('★ 지원서 사진을 못 받으면 배너로 알리고 다시 받게 한다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const { exId, title } = await seedExhibition(api, '지원서누락');
  // 존재하지 않는 주소 — 직접·프록시·자동회수 모두 실패한다
  await applyToExhibition(api, exId, tokenFor('artist'), {
    artworkImages: ['https://img.artlink.cc/artlink/__E2E없는사진__.jpg'],
  });

  const { page, ctx } = await openAs(browser, 'gallery');
  await openApplicantManager(page, title);
  const zipBtn = page.getByRole('button', { name: '전체 지원서 ZIP' }).first();
  await expect(zipBtn).toBeVisible({ timeout: 30_000 });

  const dlPromise = page.waitForEvent('download', { timeout: 150_000 });
  await zipBtn.click();
  const dl = await dlPromise;

  const banner = page.getByText(/지원서에 들어갈 작품 사진 1건을 받지 못했습니다/);
  await expect(banner, '조용히 빈 칸으로 내보내지 않는다').toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '다시 받기' })).toBeVisible();

  const names = await zipEntries((await dl.path())!);
  expect(names, 'ZIP도 스스로 누락을 증언한다').toContain('_받지못한작품.txt');

  await api.dispose();
  await ctx.close();
});
