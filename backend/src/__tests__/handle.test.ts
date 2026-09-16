/**
 * 작가 홈페이지 주소(@handle) — 규칙 · 자동 제안 · 공개 라우트 · 공유 메타 (2026-09-16)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';
import { normalizeHandle, validateHandle, suggestHandle, instagramId, ensureHandle } from '../lib/handle';
import { createSeoHandler, clearSeoCache, parseSeoId, SEO_MARKER_START, SEO_MARKER_END } from '../lib/seoMeta';

describe('handle 규칙 (lib/handle.ts)', () => {
  it('정리: 공백·@·대문자', () => {
    expect(normalizeHandle('  @Kiiryang ')).toBe('kiiryang');
  });
  it('유효/무효', () => {
    expect(validateHandle('kiiryang')).toBeNull();
    expect(validateHandle('ma.eunyeong_art')).toBeNull();
    expect(validateHandle('ab')).toMatch(/3~30/);
    expect(validateHandle('a'.repeat(31))).toMatch(/3~30/);
    expect(validateHandle('한글아이디')).toMatch(/영문/);
    expect(validateHandle('.dot')).toMatch(/마침표/);
    expect(validateHandle('dot.')).toMatch(/마침표/);
    expect(validateHandle('a..b')).toMatch(/마침표/);
    expect(validateHandle('admin')).toMatch(/쓸 수 없는/);
    expect(validateHandle('mypage')).toMatch(/쓸 수 없는/);
  });
  it('인스타 주소에서 아이디를 뽑는다 (프론트 instagramHandle 과 같은 규칙)', () => {
    expect(instagramId('https://www.instagram.com/eunyeongma_artist/')).toBe('eunyeongma_artist');
    expect(instagramId('instagram.com/kiiryang?igsh=abc')).toBe('kiiryang');
    expect(instagramId('@kiiryang')).toBe('kiiryang');
    expect(instagramId('')).toBeNull();
  });
  it('제안: 인스타 아이디가 규칙에 맞을 때만', () => {
    expect(suggestHandle('https://instagram.com/Eunyeongma_Artist')).toBe('eunyeongma_artist');
    expect(suggestHandle('https://instagram.com/ab')).toBeNull();     // 너무 짧다
    expect(suggestHandle('https://instagram.com/admin')).toBeNull();  // 예약어
    expect(suggestHandle(null)).toBeNull();
  });
});

describe('handle 라우트', () => {
  beforeAll(async () => { await cleanDb(); await seedUsers(); });
  afterAll(async () => { await cleanDb(); });
  beforeEach(async () => {
    await testPrisma.user.updateMany({ data: { handle: null, instagramUrl: null } });
    clearSeoCache();
  });

  it('공개 페이지가 열리면 인스타 아이디로 핸들을 한 번 만들어 둔다(lazy)', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { instagramUrl: 'https://instagram.com/Artist_One' } });
    const res = await request.get('/api/portfolio/1');
    expect(res.status).toBe(200);
    expect(res.body.user.handle).toBe('artist_one');
    const row = await testPrisma.user.findUnique({ where: { id: 1 } });
    expect(row?.handle).toBe('artist_one');
  });

  it('누가 먼저 쓰는 아이디면 만들지 않는다 — 남의 주소를 빼앗지 않는다', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { handle: 'shared_id' } });
    await testPrisma.user.update({ where: { id: 1 }, data: { instagramUrl: 'https://instagram.com/shared_id' } });
    const res = await request.get('/api/portfolio/1');
    expect(res.status).toBe(200);
    expect(res.body.user.handle).toBeNull();
    expect((await testPrisma.user.findUnique({ where: { id: 2 } }))?.handle).toBe('shared_id');
  });

  it('GET /api/portfolio/@handle 로도 같은 포트폴리오가 열린다 (대소문자 무관)', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'artist_one' } });
    const byId = await request.get('/api/portfolio/1');
    const byHandle = await request.get('/api/portfolio/@Artist_One');
    expect(byHandle.status).toBe(200);
    expect(byHandle.body.user.id).toBe(byId.body.user.id);
    expect(byHandle.body.user.handle).toBe('artist_one');
  });

  it('없는·규칙에 안 맞는 핸들은 404 (존재 여부를 알려주지 않는다)', async () => {
    expect((await request.get('/api/portfolio/@nobody_here')).status).toBe(404);
    expect((await request.get('/api/portfolio/@..')).status).toBe(404);
    expect((await request.get('/api/portfolio/@admin')).status).toBe(404);
  });

  it('갤러리 계정의 핸들로는 포트폴리오가 안 열린다', async () => {
    await testPrisma.user.update({ where: { id: 3 }, data: { handle: 'gallery_owner' } });
    expect((await request.get('/api/portfolio/@gallery_owner')).status).toBe(404);
  });

  it('PUT /api/auth/me/handle — 바꾸기 · 중복 409 · 규칙 400', async () => {
    const t1 = authToken(1, 'ARTIST'), t2 = authToken(2, 'ARTIST');
    const ok = await request.put('/api/auth/me/handle').set('Authorization', `Bearer ${t1}`).send({ handle: '@My.Studio' });
    expect(ok.status).toBe(200);
    expect(ok.body.handle).toBe('my.studio');
    const dup = await request.put('/api/auth/me/handle').set('Authorization', `Bearer ${t2}`).send({ handle: 'my.studio' });
    expect(dup.status).toBe(409);
    const bad = await request.put('/api/auth/me/handle').set('Authorization', `Bearer ${t2}`).send({ handle: 'no' });
    expect(bad.status).toBe(400);
    const reserved = await request.put('/api/auth/me/handle').set('Authorization', `Bearer ${t2}`).send({ handle: 'admin' });
    expect(reserved.status).toBe(400);
    // 자기 것은 다시 저장해도 409 가 아니다
    const same = await request.put('/api/auth/me/handle').set('Authorization', `Bearer ${t1}`).send({ handle: 'my.studio' });
    expect(same.status).toBe(200);
  });

  it('GET /api/auth/handle-check', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { handle: 'taken_one' } });
    const t1 = authToken(1, 'ARTIST');
    const taken = await request.get('/api/auth/handle-check?handle=Taken_One').set('Authorization', `Bearer ${t1}`);
    expect(taken.body.available).toBe(false);
    const free = await request.get('/api/auth/handle-check?handle=free_one').set('Authorization', `Bearer ${t1}`);
    expect(free.body).toMatchObject({ available: true, handle: 'free_one' });
    const bad = await request.get('/api/auth/handle-check?handle=x').set('Authorization', `Bearer ${t1}`);
    expect(bad.body.available).toBe(false);
    expect(bad.body.reason).toMatch(/3~30/);
  });

  it('GET /api/auth/me 에 handle 이 실린다', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'artist_one' } });
    const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.body.user.handle).toBe('artist_one');
  });

  it('ensureHandle 은 이미 있으면 그대로', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'kept', instagramUrl: 'https://instagram.com/other_id' } });
    expect(await ensureHandle({ id: 1, handle: 'kept', instagramUrl: 'https://instagram.com/other_id' })).toBe('kept');
  });
});

describe('공유 메타 — /@handle 과 ?work=', () => {
  const TEMPLATE = `<!doctype html><html><head>${SEO_MARKER_START}<title>ArtLink</title>${SEO_MARKER_END}</head><body></body></html>`;
  const FALLBACK = 'FALLBACK';
  function makeApp() {
    const app = express();
    const load = () => TEMPLATE;
    app.get('/portfolio/:id', createSeoHandler('portfolio', load));
    app.get('/@:handle', createSeoHandler('portfolio', load));
    app.get('/galleries/:id', createSeoHandler('gallery', load));
    app.get('/{*path}', (_req, res) => { res.send(FALLBACK); });
    return supertest(app);
  }
  let workId = 0;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'artist_one', nickname: '작가원' } });
    const pf = await testPrisma.portfolio.create({ data: { userId: 1, biography: '약력입니다' } });
    const w = await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/w1.jpg', order: 0, title: '새벽의 창', medium: '캔버스에 유채', sizeText: '72.7×90.9 cm', year: '2025' } });
    await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/w2.jpg', order: 1 } });
    workId = w.id;
  });
  afterAll(async () => { await cleanDb(); });
  beforeEach(() => clearSeoCache());

  it('parseSeoId 는 @핸들을 받고, 규칙에 안 맞으면 null', () => {
    expect(parseSeoId('@Artist_One')).toBe('@artist_one');
    expect(parseSeoId('@..')).toBeNull();
    expect(parseSeoId('7')).toBe(7);
  });

  it('/@handle 이 작가 메타를 주입하고 정식 주소는 /@handle', async () => {
    const res = await makeApp().get('/@artist_one');
    expect(res.text).toContain('작가원 작가 포트폴리오');
    expect(res.text).toContain('og:url" content="http');
    expect(res.text).toMatch(/og:url" content="[^"]+\/@artist_one"/);
    expect(res.text).toContain('/uploads/w1.jpg');
  });

  it('숫자 주소도 핸들이 있으면 정식 주소를 /@handle 로 적는다', async () => {
    const res = await makeApp().get('/portfolio/1');
    expect(res.text).toMatch(/og:url" content="[^"]+\/@artist_one"/);
  });

  it('?work= 가 있으면 그 작품이 미리보기 — 제목·캡션·그림', async () => {
    const res = await makeApp().get(`/portfolio/1?work=${workId}`);
    expect(res.text).toContain('새벽의 창 — 작가원');
    expect(res.text).toContain('캔버스에 유채 · 72.7×90.9 cm · 2025');
    expect(res.text).toContain('/uploads/w1.jpg');
    expect(res.text).toMatch(new RegExp(`og:url" content="[^"]+/@artist_one\\?work=${workId}"`));
  });

  it('없는 work 는 페이지 기본 메타로 (에러 없이)', async () => {
    const res = await makeApp().get('/portfolio/1?work=999999');
    expect(res.text).toContain('작가원 작가 포트폴리오');
  });

  it('갤러리 라우트에 @핸들이 오면 주입하지 않고 넘어간다', async () => {
    const res = await makeApp().get('/galleries/@artist_one');
    expect(res.text).toBe(FALLBACK);
  });

  it('없는 핸들은 폴백', async () => {
    const res = await makeApp().get('/@nobody_here');
    expect(res.text).toBe(FALLBACK);
  });
});
