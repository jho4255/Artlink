/**
 * 공모 소개 · 전시 소개 = 서식 있는 글 (2026-10-03, 사용자 요청 "갤러리 소개처럼 워드 기능")
 *
 * 화면은 TipTap 편집기가 만든 HTML 을 그대로 그린다(`RichText`, 한 번 더 거른다). 그래서 **서버가 저장 전에 허용 목록으로 거르지 않으면
 * 저장형 XSS** 다. 저장하는 길은 다섯 — 갤러리 공모 등록 · 아트링크 주최 등록 · 공모 소개 수정 · 전시 등록/수정 · 수정 요청 — 전부 `richField` 를 탄다.
 * 한도는 **보이는 글자** 수(태그 제외) 2만 자. 이 값을 글자로만 쓰는 검색엔진 설명은 태그를 벗긴다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { request, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, seedShow, testPrisma } from './helpers';
import { createSeoHandler, clearSeoCache, SEO_MARKER_START, SEO_MARKER_END } from '../lib/seoMeta';
import { richField } from '../lib/richText';

const OWNER = () => authToken(3, 'GALLERY');
const ADMIN = () => authToken(4, 'ADMIN');
const DAY = 86400000;
const future = (d: number) => new Date(Date.now() + d * DAY).toISOString();

const EVIL = '<p onclick="alert(1)">소개 <strong>굵게</strong> <a href="javascript:alert(1)">나쁜 링크</a> <a href="https://artlink.cc">좋은 링크</a></p><script>alert(1)</script><img src=x onerror=alert(1)><h2 style="color:red">제목</h2>';

function expectClean(html: string) {
  expect(html).not.toMatch(/<script|onclick|onerror|javascript:|<img|style=/i);
  expect(html).toContain('<strong>굵게</strong>');
  expect(html).toContain('<h2>제목</h2>');
  // 링크는 새 창 + rel 을 서버가 붙인다
  expect(html).toMatch(/<a href="https:\/\/artlink\.cc" target="_blank" rel="noopener noreferrer nofollow">좋은 링크<\/a>/);
}

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('richField — 저장 전 정리', () => {
  it('평범한 글은 그대로 · HTML 은 허용 목록만 · 빈 글은 required 면 400', () => {
    expect(richField('그냥 글\n둘째 줄', { label: '소개', maxText: 100 })).toBe('그냥 글\n둘째 줄');
    expect(richField('<p>  </p><p><br></p>', { label: '소개', maxText: 100 })).toBeNull();
    expect(() => richField('<p> </p>', { label: '공모 소개', maxText: 100, required: true, emptyMessage: '공모 소개를 입력해주세요.' })).toThrow('공모 소개를 입력해주세요.');
    expect(() => richField(123, { label: '소개', maxText: 100 })).toThrow('형식');
    expectClean(richField(EVIL, { label: '소개', maxText: 1000 })!);
  });
  it('한도는 보이는 글자로 센다 — 태그 몫은 세지 않는다', () => {
    const text = '가'.repeat(100);
    expect(richField(`<p><strong>${text}</strong></p>`, { label: '소개', maxText: 100 })).toContain(text);
    expect(() => richField(`<p>${text}가</p>`, { label: '소개', maxText: 100 })).toThrow('100자까지');
  });
});

describe('공모 소개 — 저장하는 모든 길에서 거른다', () => {
  const body = (galleryId: number, description: string) => ({
    title: '서식 공모', type: 'SOLO', deadlineStart: future(-1), deadline: future(10), recruitOnly: true, capacity: 2, region: 'SEOUL', description, galleryId,
  });

  it('★ 갤러리 공모 등록 — 위험한 태그·속성·스킴은 버리고 서식은 남긴다', async () => {
    const g = await seedGallery();
    const res = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, EVIL));
    expect(res.status).toBe(201);
    const saved = await testPrisma.exhibition.findUnique({ where: { id: res.body.id } });
    expectClean(saved!.description);
  });

  it('빈 문단만 보내면 400 · 평범한 글은 그대로 저장', async () => {
    const g = await seedGallery();
    const empty = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, '<p> </p><p><br></p>'));
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('공모 소개를 입력해주세요.');
    const plain = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, '첫 줄\n둘째 줄'));
    expect(plain.status).toBe(201);
    expect((await testPrisma.exhibition.findUnique({ where: { id: plain.body.id } }))!.description).toBe('첫 줄\n둘째 줄');
  });

  it('★ 아트링크 주최 등록도 거른다', async () => {
    const res = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`).send({
      title: '주최 서식', type: 'GROUP', deadlineStart: future(-1), deadline: future(10), recruitOnly: true, capacity: 3, region: 'SEOUL', description: EVIL, galleryIds: [],
    });
    expect(res.status).toBe(201);
    expectClean((await testPrisma.exhibition.findUnique({ where: { id: res.body.id } }))!.description);
  });

  it('★ 소개 수정(PATCH /:id/description) — 거르고, 보이는 글자 2만 자를 넘으면 400', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const ok = await request.patch(`/api/exhibitions/${ex.id}/description`).set('Authorization', `Bearer ${OWNER()}`).send({ description: EVIL });
    expect(ok.status).toBe(200);
    expectClean(ok.body.description);
    // 태그를 빼면 2만 자 — HTML 은 그보다 길어도 된다
    const atLimit = `<p><strong>${'가'.repeat(20000)}</strong></p>`;
    expect((await request.patch(`/api/exhibitions/${ex.id}/description`).set('Authorization', `Bearer ${OWNER()}`).send({ description: atLimit })).status).toBe(200);
    const over = await request.patch(`/api/exhibitions/${ex.id}/description`).set('Authorization', `Bearer ${OWNER()}`).send({ description: `<p>${'가'.repeat(20001)}</p>` });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('20,000자까지');
  });

  it('수정 요청(edit-request)으로 들어오는 소개도 거른다 — 관리자가 승인하면 그대로 저장되는 길', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const res = await request.post('/api/approvals/edit-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'EXHIBITION_EDIT', targetId: ex.id, changes: { description: EVIL } });
    expect(res.status).toBe(201);
    expectClean(JSON.parse(res.body.changes).description);
  });
});

describe('전시 소개 — 등록 · 수정', () => {
  it('★ 전시 등록·소개 수정 모두 거르고, 비면 400', async () => {
    const g = await seedGallery();
    const create = await request.post('/api/shows').set('Authorization', `Bearer ${OWNER()}`).send({
      title: '서식 전시', description: EVIL, startDate: future(1), endDate: future(20), openingHours: '10-18', admissionFee: '무료',
      location: '1관', region: 'SEOUL', posterImage: '/uploads/poster.jpg', galleryId: g.id,
    });
    expect(create.status).toBe(201);
    expectClean((await testPrisma.show.findUnique({ where: { id: create.body.id } }))!.description);

    const show = await seedShow(g.id);
    const patched = await request.patch(`/api/shows/${show.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ description: EVIL });
    expect(patched.status).toBe(200);
    expectClean(patched.body.description);
    const empty = await request.patch(`/api/shows/${show.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ description: '<p></p>' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('전시 소개를 입력해주세요.');
  });
});

describe('검색엔진·공유 미리보기 설명 — 태그를 벗긴다', () => {
  const TEMPLATE = `<!doctype html><html><head>${SEO_MARKER_START}<title>ArtLink</title>${SEO_MARKER_END}</head><body></body></html>`;
  const app = () => {
    const a = express();
    a.get('/exhibitions/:id', createSeoHandler('exhibition', () => TEMPLATE));
    a.get('/shows/:id', createSeoHandler('show', () => TEMPLATE));
    return supertest(a);
  };
  it('★ 공모·전시 소개가 HTML 이어도 meta 설명에는 글자만', async () => {
    clearSeoCache();
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { description: '<h2>모집 요강</h2><p>회화 <strong>신진</strong> 작가</p>' } });
    const show = await seedShow(g.id);
    await testPrisma.show.update({ where: { id: show.id }, data: { description: '<p>빛과 <em>그림자</em></p>' } });

    const exHtml = (await app().get(`/exhibitions/${ex.id}`)).text;
    const desc = exHtml.match(/<meta name="description" content="([^"]*)"/)![1];
    expect(desc).toContain('모집 요강 회화 신진 작가');
    expect(desc).not.toMatch(/&lt;|<|strong|h2/);

    const showHtml = (await app().get(`/shows/${show.id}`)).text;
    const sdesc = showHtml.match(/<meta name="description" content="([^"]*)"/)![1];
    expect(sdesc).toContain('빛과 그림자');
    expect(sdesc).not.toMatch(/&lt;|<|<em>/);
  });
});
