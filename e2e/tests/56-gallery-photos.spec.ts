import { test, expect, request as pwRequest, type Locator, type Page } from '@playwright/test';
import { deflateSync } from 'zlib';
import { openAs, ownedGalleryId, createExhibition } from '../lib/helpers';

/**
 * 갤러리 페이지 '지난 전시·아트페어' 사진 (2026-09-27 사용자 신고)
 *  ① "여러 장을 한 번에 추가하게 해 달라" — 기록 폼은 업로더가 여러 장을 받는데도 **마지막 한 장만 남았다**
 *     (한 장마다 부르는 onAdd 가 렌더 시점의 배열에 붙였다). 홍보 사진은 아예 한 장씩만 올릴 수 있었다.
 *  ② "사진 크기·비율이 도대체 무슨 크기냐" — `h-24 object-cover` 라 96px 높이의 띠로 잘렸다.
 *     작가 홈페이지 작품 격자처럼 **같은 크기의 정사각 칸 + 비율 그대로(contain)** 로 바꿨다.
 *
 * 보이는지가 아니라 **실제로 몇 장이 올라갔는지 · 칸의 크기와 줄이 맞는지**를 잰다.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

/** 단색 PNG — 비율이 다른 사진을 만들려고 직접 굽는다(의존성 없이) */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 가로·세로·정사각이 섞인 다섯 장 — 칸이 사진 비율을 따라가면 줄이 어긋나는 게 바로 보인다
const SHOTS = [
  { name: 'wide.png', w: 600, h: 200, rgb: [200, 60, 60] as [number, number, number] },
  { name: 'tall.png', w: 200, h: 600, rgb: [60, 160, 60] as [number, number, number] },
  { name: 'square.png', w: 400, h: 400, rgb: [60, 60, 200] as [number, number, number] },
  { name: 'wide2.png', w: 800, h: 450, rgb: [200, 160, 40] as [number, number, number] },
  { name: 'tall2.png', w: 300, h: 500, rgb: [120, 60, 160] as [number, number, number] },
];
const files = (n = SHOTS.length) => SHOTS.slice(0, n).map((s) => ({ name: s.name, mimeType: 'image/png', buffer: png(s.w, s.h, s.rgb) }));

/** 격자 칸들의 상자 — 칸은 figure 의 첫 자식(정사각 틀) */
async function cellBoxes(grid: Locator) {
  return grid.locator('figure > div').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const img = el.querySelector('img') as HTMLImageElement | null;
    return {
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      fit: img ? getComputedStyle(img).objectFit : '',
      natural: img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
    };
  }));
}

/** 같은 크기의 정사각 칸 · 열마다 같은 x · 줄마다 같은 y */
async function expectAlignedSquares(page: Page, grid: Locator, count: number, columns: number) {
  await expect(grid.locator('figure')).toHaveCount(count);
  // 사진이 다 내려와야 비율을 잰다
  await expect.poll(async () => (await cellBoxes(grid)).every((b) => b.natural > 0), { timeout: 15000 }).toBe(true);
  const boxes = await cellBoxes(grid);
  const w0 = boxes[0].w;
  for (const b of boxes) {
    expect(Math.abs(b.w - w0), '칸 폭이 전부 같다').toBeLessThanOrEqual(1);
    expect(Math.abs(b.h - b.w), '칸은 정사각').toBeLessThanOrEqual(1);
    expect(b.fit, '사진은 자르지 않는다(contain)').toBe('contain');
  }
  for (let i = 0; i < boxes.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    expect(Math.abs(boxes[i].x - boxes[col].x), `${i}번 칸이 ${col}열에 선다`).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[i].y - boxes[row * columns].y), `${i}번 칸이 ${row}행 윗선에 맞는다`).toBeLessThanOrEqual(1);
  }
  return boxes;
}

test.describe('갤러리 지난 전시·아트페어 사진', () => {
  test('★ 기록 사진을 여러 장 한 번에 고르면 전부 올라가고, 같은 크기의 정사각 칸에 비율 그대로 놓인다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    await api.dispose();

    const title = `E2E 사진 기록 ${Date.now()}`;
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/galleries/${gid}?tab=history`);   // [지난 전시] 탭(2026-09-27)
    await page.getByRole('button', { name: /기록 추가/ }).click({ timeout: 15000 });
    await page.getByPlaceholder('전시·행사 이름 *').fill(title);

    // 다섯 장을 한 번에 — 예전엔 여기서 마지막 한 장만 남았다
    const form = page.locator('div', { has: page.getByPlaceholder('전시·행사 이름 *') }).last();
    await form.locator('input[type="file"][multiple]').setInputFiles(files());
    await expect(page.getByText('5장 업로드 완료')).toBeVisible({ timeout: 30000 });
    await expect(form.locator('img')).toHaveCount(5);
    await page.getByRole('button', { name: '저장', exact: true }).click();

    const row = page.locator('div.border-b', { hasText: title });
    await expect(row).toBeVisible({ timeout: 10000 });
    const grid = row.getByTestId('square-photo-grid');
    const boxes = await expectAlignedSquares(page, grid, 5, 3);
    // 비율은 원본 그대로(서버가 PNG 를 JPEG 로 바꿔도 픽셀 크기는 같다)
    SHOTS.forEach((s, i) => expect(Math.abs(boxes[i].natural - s.w / s.h) / (s.w / s.h), `${s.name} 비율`).toBeLessThan(0.03));
    // 칸이 96px 띠가 아니라 작가 홈페이지 격자만큼 크다
    expect(boxes[0].w).toBeGreaterThan(200);

    // 좁은 화면 2열
    await page.setViewportSize({ width: 390, height: 844 });
    await expectAlignedSquares(page, grid, 5, 2);

    // 누르면 크게 본다
    await page.setViewportSize(DESKTOP);
    await grid.locator('figure button').first().click();
    await expect(page.getByRole('button', { name: '다음 이미지' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: '닫기' }).click();
    await ctx.close();

    // 방문자에게도 같은 격자
    const anon = await browser.newPage();
    await anon.setViewportSize(DESKTOP);
    await anon.goto(`/galleries/${gid}?tab=history`);
    const anonGrid = anon.locator('div.border-b', { hasText: title }).getByTestId('square-photo-grid');
    await expectAlignedSquares(anon, anonGrid, 5, 3);
    await expect(anonGrid.getByRole('button', { name: '사진 삭제' })).toHaveCount(0);
    await anon.close();
  });

  test('★ 지난 공모 홍보 사진도 여러 장 + 사진마다 설명 → 한 번에 등록, 삭제는 확인을 거친다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    const title = `E2E 홍보사진 공모 ${Date.now()}`;
    const exId = await createExhibition(api, { title, galleryId: gid });
    await api.dispose();

    // 지난 공모로 만든다 — 화면은 마감일이 지난 공모만 '지난 전시'에 놓는다. 등록 API 는 과거 날짜를 받지 않으므로 DB 로.
    // ⚠️ 접속정보를 스펙에 적지 말 것(38 스펙과 같은 규칙) — DATABASE_URL 로 받는다
    const dbUrl = process.env.DATABASE_URL;
    expect(dbUrl, 'DATABASE_URL 을 명시해 돌릴 것').toBeTruthy();
    const { execFileSync } = await import('child_process');
    execFileSync('psql', [dbUrl!, '-v', 'ON_ERROR_STOP=1', '-v', `id=${exId}`], {
      input: `update "Exhibition" set "deadlineStart" = now() - interval '60 days', deadline = now() - interval '40 days',
                "submissionDeadline" = now() - interval '35 days', "exhibitStartDate" = now() - interval '30 days',
                "exhibitDate" = now() - interval '20 days' where id = :id;`,
      encoding: 'utf-8',
    });

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/galleries/${gid}?tab=history`);
    const row = page.locator('div.border-b', { hasText: title });
    await row.getByRole('button', { name: /홍보 사진 추가/ }).click({ timeout: 15000 });

    await row.locator('input[type="file"][multiple]').setInputFiles(files(3));
    const captions = row.getByPlaceholder('사진 설명 (선택)');
    await expect(captions).toHaveCount(3, { timeout: 30000 });
    await captions.nth(0).fill('전시 전경');
    await captions.nth(2).fill('오프닝');
    await row.getByRole('button', { name: '3장 등록' }).click();
    await expect(page.getByText('사진 3장을 등록했습니다.')).toBeVisible({ timeout: 15000 });

    const grid = row.getByTestId('square-photo-grid');
    await expectAlignedSquares(page, grid, 3, 3);
    await expect(grid.locator('figcaption')).toHaveText(['전시 전경', '오프닝']);

    // 삭제 — 확인 다이얼로그를 거친다(서버가 파일까지 지운다)
    await grid.getByRole('button', { name: '사진 삭제' }).first().click();
    await expect(page.getByText('이 사진을 삭제하시겠습니까?')).toBeVisible();
    await page.getByRole('button', { name: '삭제', exact: true }).last().click();
    await expect(grid.locator('figure')).toHaveCount(2, { timeout: 10000 });
    await ctx.close();
  });
});
