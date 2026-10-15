/**
 * 작품 가격 (2026-10-15, 작가 요청 · 사용자 결정: 숫자(원) · 홈페이지와 PDF 를 따로 켠다 · 둘 다 기본 꺼짐)
 * 규칙: lib/artworkPrice.ts — 가격은 별도 표, 공개 응답에는 작가가 홈페이지 가격을 켰을 때 판매 가능한 작품에만.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, testPrisma } from './helpers';
import { PRICE_MAX, parsePrice, priceVisible } from '../lib/artworkPrice';

const ARTIST = 1;
const OTHER = 2;
const tok = (id = ARTIST) => authToken(id, 'ARTIST');

const mine = () => request.get('/api/portfolio').set('Authorization', `Bearer ${tok()}`);
const addImage = async (body: Record<string, unknown> = {}) =>
  (await request.post('/api/portfolio/images').set('Authorization', `Bearer ${tok()}`).send({ url: '/uploads/a.jpg', ...body })).body as { id: number };
const patchImage = (id: number, body: Record<string, unknown>, who = ARTIST) =>
  request.patch(`/api/portfolio/images/${id}`).set('Authorization', `Bearer ${tok(who)}`).send(body);
const savePortfolio = (body: Record<string, unknown>) =>
  request.put('/api/portfolio').set('Authorization', `Bearer ${tok()}`).send({ biography: '', career: null, ...body });
const publicPage = () => request.get(`/api/portfolio/${ARTIST}`);

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  await mine();
  await request.get('/api/portfolio').set('Authorization', `Bearer ${tok(OTHER)}`);
});

describe('규칙 — lib/artworkPrice.ts', () => {
  it('숫자(원)만 · 1원 이상 · 20억 이하 · 쉼표·원은 떼고 받는다 · null 은 지우기 · 안 보내면 그대로', () => {
    expect(parsePrice(1_200_000)).toBe(1_200_000);
    expect(parsePrice('1,500,000원')).toBe(1_500_000);
    expect(parsePrice(' 30 000 ')).toBe(30_000);
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(undefined)).toBeUndefined();
    expect(parsePrice(PRICE_MAX)).toBe(PRICE_MAX);
    for (const bad of [0, -1, 1.5, PRICE_MAX + 1, 'abc', '12만원', true, {}]) expect(() => parsePrice(bad)).toThrow();
  });
  it('판매완료·비매 작품의 가격은 남에게 보이지 않는다', () => {
    expect(priceVisible('AVAILABLE')).toBe(true);
    expect(priceVisible(null)).toBe(true);
    expect(priceVisible('SOLD')).toBe(false);
    expect(priceVisible('NFS')).toBe(false);
  });
});

describe('PATCH /api/portfolio/images/:id — 가격 저장', () => {
  it('★ 저장·고치기·지우기 — 본인 조회에는 늘 실린다', async () => {
    const img = await addImage();
    expect((await mine()).body.images[0].price).toBeNull();

    const r1 = await patchImage(img.id, { price: 1_200_000 });
    expect(r1.status).toBe(200);
    expect(r1.body.price).toBe(1_200_000);
    expect((await mine()).body.images[0].price).toBe(1_200_000);

    const r2 = await patchImage(img.id, { price: '2,000,000원', title: '달빛' });
    expect(r2.body).toMatchObject({ price: 2_000_000, title: '달빛' });

    // 다른 칸만 고치면 가격은 그대로
    const r3 = await patchImage(img.id, { medium: 'Oil on canvas' });
    expect(r3.body.price).toBe(2_000_000);

    const r4 = await patchImage(img.id, { price: null });
    expect(r4.body.price).toBeNull();
    expect(await testPrisma.artworkPrice.count()).toBe(0);
  });

  it('틀린 가격은 400 이고 아무것도 바꾸지 않는다 · 남의 작품은 404', async () => {
    const img = await addImage({ title: '원래 제목' });
    for (const price of [0, -5, 3.5, PRICE_MAX + 1, 'abc']) {
      const r = await patchImage(img.id, { price, title: '바뀌면 안 됨' });
      expect(r.status).toBe(400);
    }
    const row = await testPrisma.portfolioImage.findUnique({ where: { id: img.id } });
    expect(row!.title).toBe('원래 제목');
    expect((await patchImage(img.id, { price: 1000 }, OTHER)).status).toBe(404);
    expect(await testPrisma.artworkPrice.count()).toBe(0);
  });

  it('작품을 지우면 가격도 지워진다', async () => {
    const img = await addImage();
    await patchImage(img.id, { price: 500_000 });
    await request.delete(`/api/portfolio/images/${img.id}`).set('Authorization', `Bearer ${tok()}`);
    expect(await testPrisma.artworkPrice.count()).toBe(0);
  });
});

describe('공개 홈페이지 — GET /api/portfolio/:id', () => {
  it('★ 기본(꺼짐)이면 가격이 응답에 없다 — 켜면 판매 가능한 작품에만 실린다', async () => {
    const a = await addImage({ status: 'AVAILABLE' });
    const b = await addImage({ status: 'SOLD' });
    const c = await addImage({ status: 'NFS' });
    const d = await addImage();   // 판매 상태를 안 적었다
    for (const [id, price] of [[a.id, 1_000_000], [b.id, 2_000_000], [c.id, 3_000_000], [d.id, 4_000_000]] as const) await patchImage(id, { price });

    const off = await publicPage();
    expect(off.status).toBe(200);
    expect(JSON.stringify(off.body)).not.toContain('"price"');

    expect((await savePortfolio({ showPrice: true })).body.showPrice).toBe(true);
    const on = await publicPage();
    const byId = new Map((on.body.images as { id: number; price?: number }[]).map((i) => [i.id, i.price]));
    expect(byId.get(a.id)).toBe(1_000_000);
    expect(byId.get(d.id)).toBe(4_000_000);
    expect(byId.get(b.id)).toBeUndefined();   // 판매완료 — 얼마에 팔렸는지가 되므로 안 보인다
    expect(byId.get(c.id)).toBeUndefined();   // 비매
    expect(JSON.stringify(on.body)).not.toContain('2000000');
    expect(JSON.stringify(on.body)).not.toContain('3000000');
  });

  it('showPrice 를 안 보내는 저장은 켜 둔 설정을 끄지 않는다 · 형식이 틀리면 400', async () => {
    await savePortfolio({ showPrice: true });
    const r = await savePortfolio({ statement: '작가노트만 고쳤다' });
    expect(r.status).toBe(200);
    expect(r.body.showPrice).toBe(true);
    expect((await savePortfolio({ showPrice: 'yes' })).status).toBe(400);
    expect((await savePortfolio({ showPrice: false })).body.showPrice).toBe(false);
  });

  it('갤러리가 보는 지원자 목록에는 가격이 실리지 않는다(홈페이지 가격을 켜 둬도)', async () => {
    const img = await addImage({ status: 'AVAILABLE' });
    await patchImage(img.id, { price: 7_700_000 });
    await savePortfolio({ showPrice: true });
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: ARTIST, exhibitionId: ex.id } });
    const r = await request.get(`/api/exhibitions/${ex.id}/applications`).set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('7700000');
    expect(JSON.stringify(r.body)).not.toContain('"price"');
  });
});
