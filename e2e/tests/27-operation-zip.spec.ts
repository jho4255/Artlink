import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, userIds, applyToExhibition, ownedGalleryId, exhibitionDates } from '../lib/helpers';

/**
 * 운영페이지 일괄 다운로드 (2026-08 성능 사고 대응) E2E
 *
 * 실서비스에서 "전체 작품원본(ZIP)/전체 PDF(ZIP)가 안 끝난다"는 신고 → 원인은
 * ①전 이미지가 백엔드 프록시 경유 ②완전 순차 ③PDF가 같은 이미지를 다시 받음 ④진행률·재시도 없음.
 * 여기서는 UI 동작(진행률 문구·완료·실패 안내)과 실제 다운로드가 나가는지를 검증한다.
 *
 * 이미지는 **실제 R2 원본 URL**을 쓴다(R2 CORS가 열려 localhost에서도 직접 로드 가능).
 */
const API = 'http://localhost:4000/api';
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

/** 실서비스 탐색 피드에서 실제 R2 이미지 URL을 가져온다 */
async function realArtworkUrls(api: APIRequestContext, n: number): Promise<string[]> {
  const r = await api.get('https://artlink.cc/api/explore?limit=40');
  const d = await r.json();
  const urls: string[] = [...new Set<string>((d.images || []).map((i: any) => i.url))]
    .filter((u) => u.startsWith('http'));
  return urls.slice(0, n);
}

/** 승인 공모 + 작가 수락 + 출품작 제출까지 만들어 운영페이지 진입 가능 상태로 */
async function seedOperation(api: APIRequestContext, artworkCount: number) {
  const gTok = tokenFor('gallery');
  const aTok = tokenFor('artist');
  const adTok = tokenFor('admin');

  const galleryId = await ownedGalleryId(api);
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: auth(gTok),
    data: {
      title: `ZIP검증 ${Date.now()}`, type: 'SOLO', deadlineStart: today, deadline: future,
      exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울',
      description: '일괄 다운로드 E2E', galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: auth(adTok), data: { status: 'APPROVED' } });

  await applyToExhibition(api, ex.id, aTok);
  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: auth(gTok) })).json();
  const mine = apps.find((a: any) => a.userId === userIds().artist);
  await api.patch(`${API}/exhibitions/${ex.id}/applications/${mine.id}`, {
    headers: auth(gTok), data: { status: 'ACCEPTED' },
  });

  const urls = await realArtworkUrls(api, artworkCount);
  expect(urls.length, '실제 R2 이미지 확보').toBeGreaterThan(0);
  await api.put(`${API}/operations/${ex.id}/me`, {
    headers: auth(aTok),
    data: {
      artworkList: urls.map((image, i) => ({
        image, title: `작품${i + 1}`, size: '50x50', medium: 'Oil on canvas',
        year: '2025', price: '1,000,000',
      })),
      cv: { nameKo: '테스트작가', nameEn: 'Test', birth: '1990', tel: '010-0000-0000', email: 'a@b.c', education: [], solo: [], group: [], artFair: [], award: [] },
      note: { statement: 'E2E 작가노트', sections: [] },
    },
  });
  return { exId: ex.id, urls };
}

test('작품 원본(ZIP) — 진행률 표시 후 실제 파일이 내려온다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const { exId, urls } = await seedOperation(api, 8);

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/exhibitions/${exId}/operation`);
  await expect(page.getByRole('button', { name: /작품 원본/ }).first()).toBeVisible({ timeout: 20000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: /작품 원본/ }).first().click();

  // 진행률 문구("N/M장 모으는 중") 또는 곧바로 완료 — 멈춘 것처럼 보이지 않아야 한다
  await expect(page.locator('body')).toContainText(/모으는 중|ZIP 다운로드 시작/, { timeout: 30_000 });

  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/작품원본\.zip$/);
  const path = await dl.path();
  expect(path, 'ZIP 파일 저장됨').toBeTruthy();

  await expect(page.locator('body')).toContainText(`원본 ${urls.length}개 ZIP 다운로드 시작`, { timeout: 30_000 });

  await api.dispose();
  await ctx.close();
});

test('전체 제출물 PDF(ZIP) — 이미지 선수집 진행률 후 완료', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const { exId } = await seedOperation(api, 4);

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/exhibitions/${exId}/operation`);
  const btn = page.getByRole('button', { name: /전체 PDF|전체 제출물/ }).first();
  await expect(btn).toBeVisible({ timeout: 20000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await btn.click();
  await expect(page.locator('body')).toContainText(/불러오는 중|만드는 중|ZIP 다운로드/, { timeout: 60_000 });

  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/전체제출물\.zip$/);
  expect(await dl.path(), 'ZIP 파일 저장됨').toBeTruthy();

  await api.dispose();
  await ctx.close();
});

test('이미지를 못 받으면 조용히 빠지지 않고 실패 목록을 알려준다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const { exId } = await seedOperation(api, 2);

  // 존재하지 않는 이미지를 하나 섞는다 (직접·프록시·재시도 모두 실패하는 주소)
  const aTok = tokenFor('artist');
  const cur = await (await api.get(`${API}/operations/${exId}/me`, { headers: auth(aTok) })).json();
  await api.put(`${API}/operations/${exId}/me`, {
    headers: auth(aTok),
    data: {
      ...cur,
      artworkList: [
        ...cur.artworkList,
        { image: 'https://pub-e87cde18dad54847b656f80cf0ae7b28.r2.dev/artlink/__없는파일__.jpg', title: '실패작품', size: '', medium: '', year: '', price: '' },
      ],
    },
  });

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/exhibitions/${exId}/operation`);
  await page.getByRole('button', { name: /작품 원본/ }).first().click();

  await expect(page.locator('body')).toContainText('실패 1개', { timeout: 90_000 });
  await expect(page.locator('body'), '실패한 작품명을 알려준다').toContainText('실패작품', { timeout: 15_000 });

  await api.dispose();
  await ctx.close();
});

test('★ 진행률은 버튼에 표시되어 작업 내내 끊기지 않는다 (사라졌다 생기던 문제)', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const { exId } = await seedOperation(api, 10);

  const { page, ctx } = await openAs(browser, 'gallery');
  // 갱신 간격을 벌려(동시 5개 × 4초) 진행률이 오래 유지되어야 하는 상황을 만든다
  // 이미지 도메인은 전환 중이다(pub-*.r2.dev → img.artlink.cc). 둘 다 잡는다.
  await page.route(/https:\/\/(pub-[^/]+\.r2\.dev|img\.artlink\.cc)\//, async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });

  await page.goto(`/exhibitions/${exId}/operation`);
  const btn = page.getByRole('button', { name: /작품 원본/ }).first();
  await expect(btn).toBeVisible({ timeout: 20000 });
  await btn.click();

  // 진행 중에는 버튼 라벨이 "이미지 N/M장"으로 바뀐다(토스트와 달리 사라질 수 없다)
  const working = page.locator('button', { hasText: /이미지 \d+\/\d+장|모으는 중/ });
  await expect(working.first()).toBeVisible({ timeout: 20_000 });

  // 연속 관찰: 작업이 끝날 때까지 한 번도 공백이 없어야 한다
  let gaps = 0, samples = 0, sawCount = false;
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        working: /이미지 \d+\/\d+장/.test(t) || t.includes('모으는 중'),
        counted: /이미지 \d+\/\d+장/.test(t),
        done: t.includes('ZIP 다운로드 시작'),
      };
    });
    if (st.done) break;
    samples += 1;
    if (st.counted) sawCount = true;
    if (!st.working) gaps += 1;
    await page.waitForTimeout(120);
  }

  expect(samples, '관찰이 유효할 만큼 오래 진행되어야 한다').toBeGreaterThan(30);
  expect(sawCount, '실제 진행 숫자(N/M장)가 노출되어야 한다').toBe(true);
  expect(gaps, `진행 표시가 ${gaps}/${samples}회 사라졌다`).toBe(0);

  await expect(page.locator('body')).toContainText('ZIP 다운로드 시작', { timeout: 60_000 });
  // 끝나면 원래 라벨로 복귀
  await expect(page.getByRole('button', { name: '작품 원본(ZIP)' }).first()).toBeVisible({ timeout: 15_000 });

  await api.dispose();
  await ctx.close();
});

test('★ 전체 PDF(ZIP) — 이미지를 못 받으면 누락 사실과 작품명을 알려준다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const { exId } = await seedOperation(api, 2);

  // 존재하지 않는 이미지를 하나 섞는다 → PDF에는 빈 칸으로 나가므로 반드시 알려야 한다
  const aTok = tokenFor('artist');
  const cur = await (await api.get(`${API}/operations/${exId}/me`, { headers: auth(aTok) })).json();
  await api.put(`${API}/operations/${exId}/me`, {
    headers: auth(aTok),
    data: {
      ...cur,
      artworkList: [
        ...cur.artworkList,
        { image: 'https://pub-e87cde18dad54847b656f80cf0ae7b28.r2.dev/artlink/__PDF없는파일__.jpg', title: 'PDF누락작품', size: '', medium: '', year: '', price: '' },
      ],
    },
  });

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/exhibitions/${exId}/operation`);
  const btn = page.getByRole('button', { name: /전체 PDF|전체 제출물/ }).first();
  await expect(btn).toBeVisible({ timeout: 20000 });
  await btn.click();

  await expect(page.locator('body'), '누락 개수 안내').toContainText('이미지 1개 누락', { timeout: 120_000 });
  await expect(page.locator('body'), '누락된 작품명 안내').toContainText('PDF누락작품', { timeout: 15_000 });

  await api.dispose();
  await ctx.close();
});
