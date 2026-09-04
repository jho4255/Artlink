import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, realUploadUrl } from '../lib/helpers';

const API = 'http://localhost:4000/api';

/**
 * ArtLook — **반복·연속 사용**에서 생기는 문제 검증.
 *
 * ArtLook 은 서버 연산이 0이다(전부 브라우저 Canvas/WebGL). 그래서 트래픽 위험이
 * 다른 기능과 완전히 다르다 — 위험은 서버가 아니라 **한 사람의 브라우저 안**에 있다.
 *   1. **WebGL 컨텍스트** — 브라우저는 살아 있는 컨텍스트를 ~16개로 제한한다.
 *      장면을 바꿀 때마다 새로 만들면 조용히 오래된 것부터 죽는다.
 *   2. **장면 사진 메모리** — 2600px 벽 사진 16장을 다 돌면 수백 MB가 된다.
 *      캐시를 안 비우면 탭이 죽거나 저사양 폰에서 강제 종료된다.
 *   3. **합성 시간** — SUPERSAMPLE 2.0 이라 실제 합성 캔버스는 출력의 4배 픽셀이다.
 *   4. **탭 재진입** — 마이페이지 안 iframe 이라 탭을 오갈 때마다 새로 뜬다.
 *
 * ⚠️ 실패하면 화면이 **에러 없이 조용히** 빈 캔버스가 된다 — 그래서 픽셀을 직접 잰다.
 */
const ARTLOOK = '/artlook/index.html';

/** 캔버스가 실제로 무언가를 그렸는가 (조용한 빈 화면 검출) */
async function canvasStats(page: Page) {
  return page.evaluate(() => {
    const cv = document.getElementById('preview') as HTMLCanvasElement | null;
    if (!cv || !cv.width || !cv.height) return null;
    const off = document.createElement('canvas');
    off.width = 80; off.height = 80;
    const cx = off.getContext('2d')!;
    cx.drawImage(cv, 0, 0, 80, 80);
    const d = cx.getImageData(0, 0, 80, 80).data;
    let sum = 0, sum2 = 0, n = 0, opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += l; sum2 += l * l; n++;
      if (d[i + 3] > 8) opaque++;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(sum2 / n - mean * mean), opaqueRatio: opaque / n, w: cv.width, h: cv.height };
  });
}

/** 렌더가 끝나 미리보기가 보일 때까지 */
async function waitRender(page: Page) {
  await expect(page.locator('#preview')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    const cv = document.getElementById('preview') as HTMLCanvasElement | null;
    return !!cv && cv.width > 0 && (window as any).__artlook != null;
  }, undefined, { timeout: 30000 });
}

async function bootArtLook(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  // WebGL 컨텍스트 손실을 감시한다 (조용히 폴백되는 것을 잡는다)
  await page.addInitScript(() => {
    (window as any).__ctxLost = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    (window as any).__ctxCount = 0;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: any[]) {
      if (String(type).startsWith('webgl')) {
        (window as any).__ctxCount++;
        this.addEventListener('webglcontextlost', () => { (window as any).__ctxLost++; });
      }
      return (orig as any).call(this, type, ...rest);
    };
  });

  await page.goto(ARTLOOK);
  // 작품이 없으면 데모 작품이 뜬다 — 실제 가입자 작품을 쓰지 않는다
  await expect(page.locator('#works img').first()).toBeVisible({ timeout: 30000 });
  await page.locator('#works img').first().click();
  await waitRender(page);
  return errors;
}

test('★ 장면 전 종류를 두 바퀴 돌아도 WebGL 컨텍스트가 하나로 유지되고 렌더가 안 죽는다', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await bootArtLook(page);

  // ⚠️ 장면은 [벽]/[공간] **두 탭**으로 나뉜다(규칙 44j). 한 탭만 돌면 절반을 안 본다.
  const groups = page.locator('#sceneGroup button');
  const gN = Math.max(await groups.count(), 1);
  const chips = page.locator('#scenes .chip');
  let n = 0;
  for (let g = 0; g < gN; g++) {
    if (await groups.count()) { await groups.nth(g).click(); await page.waitForTimeout(200); }
    n += await chips.count();
  }
  console.log(`  [ArtLook] 배경 탭 ${gN}개 · 장면 합계 ${n}개`);
  if (n === 0) {
    // WebGL2 가 없는 환경이면 장면 모드 자체를 감춘다(설계). 그때는 기본 벽으로 폴백한다.
    const supported = await page.evaluate(() => !!(window as any).ArtLookScene?.supported?.());
    console.log(`  [ArtLook] 장면 목록이 비었다 — WebGL2 supported=${supported}`);
    expect(await page.locator('#walls .chip').count(), '장면도 벽도 없다 — 배경을 고를 수 없다').toBeGreaterThan(0);
    test.skip(true, 'WebGL2 미지원 환경 — 장면 모드가 감춰짐(설계된 폴백)');
  }

  const times: number[] = [];
  const blanks: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (let g = 0; g < gN; g++) {
      if (await groups.count()) { await groups.nth(g).click(); await page.waitForTimeout(200); }
      const inTab = await chips.count();
      for (let i = 0; i < inTab; i++) {
        const t0 = Date.now();
        await chips.nth(i).click();
        await page.waitForFunction(
          (prev) => (window as any).__artlook && (window as any).__artlook !== prev,
          null, { timeout: 30000 },
        ).catch(() => {});
        await page.waitForTimeout(120);
        times.push(Date.now() - t0);

        const s = await canvasStats(page);
        if (!s || s.opaqueRatio < 0.5 || s.std < 1) {
          blanks.push(`round${round} tab${g} scene${i}: ${JSON.stringify(s)}`);
        }
      }
    }
  }

  const lost = await page.evaluate(() => (window as any).__ctxLost);
  const made = await page.evaluate(() => (window as any).__ctxCount);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const max = Math.max(...times);
  console.log(`  [ArtLook] 전환 ${times.length}회 평균 ${avg}ms 최대 ${max}ms | WebGL 컨텍스트 생성=${made} 손실=${lost}`);

  expect(blanks, `빈 캔버스가 나온 장면: ${blanks.join(' | ')}`).toHaveLength(0);
  expect(lost, `WebGL 컨텍스트가 ${lost}번 손실됐다 — 장면마다 새로 만들고 있는지 확인할 것`).toBe(0);
  expect(made, `WebGL 컨텍스트를 ${made}개 만들었다 — 싱글턴이어야 한다(브라우저 상한 ~16)`).toBeLessThanOrEqual(2);
  expect(max, `장면 전환 최대 ${max}ms — 사용자가 멈춘 줄 안다`).toBeLessThan(15000);
  expect(errors.filter((e) => !/favicon|404/i.test(e)), `ArtLook JS 에러: ${errors.join(' | ')}`).toHaveLength(0);
});

test('★ 액자·매트·조명을 반복해서 바꿔도 렌더가 살아 있다 (복합 조작)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await bootArtLook(page);

  const frames = page.locator('#frames .chip');
  const fN = Math.min(await frames.count(), 18);
  expect(fN, '액자 목록이 비었다').toBeGreaterThan(0);

  const blanks: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < fN; i++) {
      await frames.nth(i).click();
      await page.waitForTimeout(220);

      // 매트 없음/좁게/넓게 를 돌린다 — 매트 분기가 액자마다 다르게 타는 자리
      const matBtns = page.locator('#matSel button');
      if (await matBtns.count()) {
        await matBtns.nth((i + round) % (await matBtns.count())).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      const s = await canvasStats(page);
      if (!s || s.opaqueRatio < 0.5 || s.std < 1) blanks.push(`round${round} frame${i}: ${JSON.stringify(s)}`);
    }
  }

  // 조명 슬라이더를 끝까지 밀어도 작품이 하얗게 날아가지 않아야 한다
  const before = await canvasStats(page);
  await page.locator('#lightOp').fill('100');
  await page.waitForTimeout(900);
  const after = await canvasStats(page);
  console.log(`  [조명 0→100] 평균밝기 ${before?.mean.toFixed(1)} → ${after?.mean.toFixed(1)}`);

  expect(blanks, `빈 캔버스: ${blanks.join(' | ')}`).toHaveLength(0);
  expect(after!.std, '조명 100에서 화면이 평평해졌다 — 날아갔을 가능성').toBeGreaterThan(1);
  // 규칙 43: 강도를 올리면 '주변이 어두워진다'가 주역이다 — 화면 평균이 밝아지면 안 된다
  expect(after!.mean, `조명을 올렸더니 화면이 더 밝아졌다 (${before!.mean.toFixed(1)}→${after!.mean.toFixed(1)})`)
    .toBeLessThan(before!.mean + 6);
  expect(errors.filter((e) => !/favicon|404/i.test(e)), `JS 에러: ${errors.join(' | ')}`).toHaveLength(0);
});

test('★ 작품을 바꿔가며 30번 렌더해도 메모리가 폭주하지 않는다', async ({ page }) => {
  test.setTimeout(240_000);
  await bootArtLook(page);

  const works = page.locator('#works img');
  const wN = await works.count();
  const chips = page.locator('#scenes .chip');
  const sN = await chips.count();
  expect(wN).toBeGreaterThan(0);

  const mem = () => page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);
  const m0 = await mem();

  for (let i = 0; i < 30; i++) {
    await works.nth(i % wN).click();
    if (sN > 0) await chips.nth(i % sN).click();
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(1500);
  const m1 = await mem();

  const s = await canvasStats(page);
  console.log(`  [메모리] ${(m0 / 1e6).toFixed(1)}MB → ${(m1 / 1e6).toFixed(1)}MB (30회 렌더)`);
  expect(s, '30회 렌더 뒤 캔버스가 비었다').not.toBeNull();
  expect(s!.opaqueRatio).toBeGreaterThan(0.5);

  if (m0 > 0) {
    // 장면 사진을 캐시하므로 늘어나는 건 정상. 다만 무한히 늘면 폰에서 죽는다.
    expect(m1 / m0, `힙이 ${(m1 / m0).toFixed(1)}배로 늘었다 — 캐시 상한 확인 필요`).toBeLessThan(12);
  }
  const lost = await page.evaluate(() => (window as any).__ctxLost);
  expect(lost, `WebGL 컨텍스트 손실 ${lost}회`).toBe(0);
});

test('★ 마이페이지 [ArtLook] 탭을 10번 드나들어도 매번 정상 렌더된다 (iframe 재마운트)', async ({ browser }) => {
  test.setTimeout(300_000);
  // ⚠️ 작품이 0개면 iframe 자체를 안 그린다(안내 문구만) — 먼저 작품을 넣는다
  const api = await pwRequest.newContext();
  const tok = tokenFor('artist');
  for (let i = 0; i < 4; i++) {
    await api.post(`${API}/portfolio/images`, {
      headers: { Authorization: `Bearer ${tok}` },
      data: { url: realUploadUrl(), sizeText: '116.8 × 91.0 cm' },
    });
  }
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/mypage?tab=artlook');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#works img, #worksEmpty').first()).toBeVisible({ timeout: 40000 });

  for (let i = 0; i < 10; i++) {
    // 다른 탭으로 나갔다가 돌아온다 — iframe 이 언마운트/재마운트된다
    await page.goto('/mypage?tab=profile');
    await page.waitForTimeout(200);
    await page.goto('/mypage?tab=artlook');
    const f = page.frameLocator('iframe');
    await expect(f.locator('#works img, #worksEmpty').first())
      .toBeVisible({ timeout: 30000 });
  }

  // 마지막 진입에서 실제로 그려지는지까지 확인 (재진입 후 조용히 빈 화면이 되는 사고 방지)
  const f = page.frameLocator('iframe');
  const hasWorks = await f.locator('#works img').count();
  if (hasWorks > 0) {
    // ⚠️ 실제로 **로드된** 썸네일을 고른다 — 파일이 없는(404) 작품을 누르면 아무 일도 안 일어난다.
    //    그건 ArtLook 의 결함이 아니라 그 작품의 이미지가 없는 것이다.
    // ⚠️ 작품 목록은 **페이지네이션**된다(`#worksPager`) — 한 페이지만 보면 로드된 게 다음 장에
    //    있을 때 "하나도 없다"로 오진한다. 페이지를 넘겨 가며 찾는다.
    let picked = false, scanned = 0, broken = 0;
    const pages = Math.max(await f.locator('#worksPage').count(), 1) ? 12 : 1;
    for (let p = 0; p < pages && !picked; p++) {
      const cnt = await f.locator('#works img').count();
      for (let i = 0; i < cnt; i++) {
        const img = f.locator('#works img').nth(i);
        scanned++;
        const ok = await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0).catch(() => false);
        if (ok) { await img.click(); picked = true; break; }
        broken++;
      }
      if (picked) break;
      const next = f.locator('#worksNext');
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    expect(picked, `로드된 작품 썸네일이 없다 (훑음 ${scanned} · 이미지 없음 ${broken})`).toBe(true);
    await expect(f.locator('#preview')).toBeVisible({ timeout: 30000 });
  }
  console.log(`  [iframe 재마운트 10회] 작품 ${hasWorks}개, JS 에러 ${errors.length}건`);
  expect(errors.filter((e) => !/favicon|ResizeObserver/i.test(e)), `재마운트 중 에러: ${errors.join(' | ')}`).toHaveLength(0);
  await ctx.close();
});

test('★ 저장(PNG)을 연속 5번 눌러도 매번 파일이 나온다', async ({ page }) => {
  test.setTimeout(240_000);
  await bootArtLook(page);
  await expect(page.locator('#dl')).toBeEnabled({ timeout: 30000 });

  const sizes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('#dl').click(),
    ]);
    const p = await dl.path();
    const fs = await import('fs');
    const size = p ? fs.statSync(p).size : 0;
    sizes.push(size);
    expect(size, `${i + 1}번째 저장이 빈 파일이다`).toBeGreaterThan(10_000);
    await page.waitForTimeout(300);
  }
  console.log(`  [연속 저장] 파일 크기 ${sizes.map((s) => Math.round(s / 1024) + 'KB').join(', ')}`);
});
