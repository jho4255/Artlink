/**
 * 모집 인원 '0명'·'00명' (2026-10-14 사용자 요청 · 결정: 0명 = 9명까지, 00명 = 99명까지 수락)
 * 규칙: lib/capacity.ts — 공고에는 그 글자만, 수락 한도는 capacity(9·99) 하나가 정한다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCapacity, capacityText, seatsFullMessage, CAPACITY_MASKS } from '../lib/capacity';
import { request, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, testPrisma } from './helpers';

const OWNER = () => authToken(3, 'GALLERY');
const ADMIN = () => authToken(4, 'ADMIN');
const DAY = 86400000;
const future = (d: number) => new Date(Date.now() + d * DAY).toISOString();

const patchCapacity = (id: number, body: Record<string, unknown>, token = OWNER()) =>
  request.patch(`/api/exhibitions/${id}/capacity`).set('Authorization', `Bearer ${token}`).send(body);

/** 수락된 작가 n명을 바로 심는다(지원서·약관 흐름은 다른 테스트가 본다) */
async function acceptedArtists(exhibitionId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const u = await testPrisma.user.create({ data: { email: `mask${exhibitionId}-${i}@test.local`, name: `작가${i}`, role: 'ARTIST', provider: 'LOCAL' } });
    await testPrisma.application.create({ data: { userId: u.id, exhibitionId, status: 'ACCEPTED' } });
  }
}

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('규칙 — lib/capacity.ts', () => {
  it('0명 = 9 · 00명 = 99 — 보낸 숫자는 무시한다 · 숫자는 1~1000', () => {
    expect(CAPACITY_MASKS.ONE).toEqual({ label: '0명', max: 9 });
    expect(CAPACITY_MASKS.TWO).toEqual({ label: '00명', max: 99 });
    expect(resolveCapacity(undefined, 'ONE')).toEqual({ capacity: 9, capacityMask: 'ONE' });
    expect(resolveCapacity(3, 'TWO')).toEqual({ capacity: 99, capacityMask: 'TWO' });
    expect(resolveCapacity(5, null)).toEqual({ capacity: 5, capacityMask: null });
    expect(() => resolveCapacity(0, null)).toThrow();
    expect(() => resolveCapacity(1001, undefined)).toThrow();
    expect(() => resolveCapacity(undefined, undefined)).toThrow();
    expect(() => resolveCapacity(5, 'THREE')).toThrow();
  });

  it('공고 글자 · 자리가 찼을 때 문구', () => {
    expect(capacityText(5, null)).toBe('5명');
    expect(capacityText(9, 'ONE')).toBe('0명');
    expect(capacityText(99, 'TWO')).toBe('00명');
    expect(seatsFullMessage(5, null)).toBe('선정 인원(5명)이 모두 찼습니다.');
    expect(seatsFullMessage(9, 'ONE')).toBe('선정 인원(0명 — 최대 9명)이 모두 찼습니다.');
  });
});

describe('등록 — 0명·00명으로 올린다', () => {
  it('★ 갤러리 공모: 0명이면 숫자 없이도 등록되고 9로 저장 · 숫자도 표시도 없으면 400 · 모르는 표시 400', async () => {
    const g = await seedGallery();
    const base = { title: '0명 공모', type: 'SOLO', deadline: future(10), recruitOnly: true, region: 'SEOUL', description: '<p>x</p>', galleryId: g.id };
    const post = (body: Record<string, unknown>) => request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base, ...body });

    const one = await post({ capacityMask: 'ONE' });
    expect(one.status).toBe(201);
    expect(one.body).toMatchObject({ capacity: 9, capacityMask: 'ONE' });

    const two = await post({ capacity: 3, capacityMask: 'TWO' });   // 표시가 이긴다 — 공고와 한도가 어긋나지 않게
    expect(two.body).toMatchObject({ capacity: 99, capacityMask: 'TWO' });

    const exact = await post({ capacity: 4 });
    expect(exact.body).toMatchObject({ capacity: 4, capacityMask: null });

    expect((await post({})).status).toBe(400);
    expect((await post({ capacityMask: 'THREE' })).status).toBe(400);
    expect((await post({ capacity: 0 })).status).toBe(400);
  });

  it('아트링크 주최 공모도 00명으로 · 공개 상세가 표시를 내려준다', async () => {
    const res = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`).send({
      title: '00명 주최', type: 'GROUP', deadline: future(10), recruitOnly: true, region: 'JEJU', description: '<p>x</p>', capacityMask: 'TWO',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ capacity: 99, capacityMask: 'TWO' });
    const detail = await request.get(`/api/exhibitions/${res.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.capacityMask).toBe('TWO');
  });
});

describe('[모집 인원 변경] — PATCH /exhibitions/:id/capacity', () => {
  it('★ 숫자 → 0명 → 숫자 · 수락한 수보다 작은 한도는 400', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);

    const toOne = await patchCapacity(ex.id, { capacityMask: 'ONE' });
    expect(toOne.status).toBe(200);
    expect(toOne.body).toMatchObject({ capacity: 9, capacityMask: 'ONE' });

    const toNum = await patchCapacity(ex.id, { capacity: 12, capacityMask: null });
    expect(toNum.body).toMatchObject({ capacity: 12, capacityMask: null });

    await acceptedArtists(ex.id, 10);
    const tooSmall = await patchCapacity(ex.id, { capacityMask: 'ONE' });
    expect(tooSmall.status).toBe(400);
    expect(tooSmall.body.error).toContain('0명');
    expect((await testPrisma.exhibition.findUnique({ where: { id: ex.id } }))).toMatchObject({ capacity: 12, capacityMask: null });
    expect((await patchCapacity(ex.id, { capacityMask: 'TWO' })).body).toMatchObject({ capacity: 99, capacityMask: 'TWO' });
    expect((await patchCapacity(ex.id, {})).status).toBe(400);
  });

  it('★ 0명 공모는 9명까지 수락 — 10번째는 400 (문구에 0명 — 최대 9명)', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { capacity: 9, capacityMask: 'ONE' } });
    await acceptedArtists(ex.id, 9);
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id } });
    const r = await request.patch(`/api/exhibitions/${ex.id}/applications/${app.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('선정 인원(0명 — 최대 9명)');
  });
});

describe('수정 요청 — 두 칸을 함께 맞춘다', () => {
  it('0명으로 요청하면 한도도 9로 · 숫자만 요청하면 표시는 지운다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const ask = (changes: Record<string, unknown>) => request.post('/api/approvals/edit-request')
      .set('Authorization', `Bearer ${OWNER()}`).send({ type: 'EXHIBITION_EDIT', targetId: ex.id, changes });
    const r1 = await ask({ capacityMask: 'ONE' });
    expect(r1.status).toBe(201);
    const row1 = await testPrisma.approvalRequest.findFirst({ where: { targetId: ex.id }, orderBy: { id: 'desc' } });
    expect(JSON.parse(row1!.changes!)).toMatchObject({ capacity: 9, capacityMask: 'ONE' });
    expect((await ask({ capacity: 0 })).status).toBe(400);
  });
});
