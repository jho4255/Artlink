/**
 * 아트링크 주최 공모의 제목·소개 고치기 (2026-10-26 사용자 요청 — "admin 주최공모는 admin 이 공모 제목이나 내용 수정 가능하게")
 * 규칙: PATCH /exhibitions/:id/title — 관리자만 · 아트링크 주최 공모만(갤러리 공모는 수정 요청 → 승인) · 단톡방 이름도 따라 바뀐다
 *       PATCH /exhibitions/:id/description — 원래부터 관리자가 고칠 수 있다(assertCanManageExhibition)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, testPrisma } from './helpers';

const OWNER = () => authToken(3, 'GALLERY');
const ADMIN = () => authToken(4, 'ADMIN');
const ARTIST = () => authToken(1, 'ARTIST');
const DAY = 86400000;
const future = (d: number) => new Date(Date.now() + d * DAY).toISOString();

const patchTitle = (id: number, token: string | null, title: unknown) => {
  const r = request.patch(`/api/exhibitions/${id}/title`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send({ title });
};

async function hostedExhibition(galleryIds: number[] = []) {
  const res = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`).send({
    title: '아트링크 공모', type: 'GROUP', deadline: future(10), recruitOnly: true, capacity: 3, region: 'SEOUL', description: '<p>처음 소개</p>', galleryIds,
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('아트링크 주최 공모 — 관리자가 제목을 바로 고친다', () => {
  it('★ 관리자가 고치면 바로 바뀌고(앞뒤 공백은 뗀다) 공고 상세·주최 공모 목록·단톡방 이름이 같은 제목', async () => {
    const id = await hostedExhibition();
    await testPrisma.chat.create({ data: { kind: 'GROUP', title: '아트링크 공모', exhibitionId: id } });

    const res = await patchTitle(id, ADMIN(), '  새 제목 — 2027 봄 공모  ');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('새 제목 — 2027 봄 공모');

    expect((await request.get(`/api/exhibitions/${id}`)).body.title).toBe('새 제목 — 2027 봄 공모');
    const hosted = await request.get('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`);
    expect(hosted.body.find((e: any) => e.id === id).title).toBe('새 제목 — 2027 봄 공모');
    expect((await testPrisma.chat.findUnique({ where: { exhibitionId: id } }))!.title).toBe('새 제목 — 2027 봄 공모');
  });

  it('단톡방이 아직 없어도 된다', async () => {
    const id = await hostedExhibition();
    expect((await patchTitle(id, ADMIN(), '방 없는 공모')).status).toBe(200);
    expect(await testPrisma.chat.count({ where: { exhibitionId: id } })).toBe(0);
  });

  it('관리자 말고는 못 고친다 — 위임 갤러리 403 · 작가 403 · 로그인 없이 401', async () => {
    const g = await seedGallery();
    const id = await hostedExhibition([g.id]);
    expect((await patchTitle(id, OWNER(), '위임 갤러리가 바꿈')).status).toBe(403);
    expect((await patchTitle(id, ARTIST(), '작가가 바꿈')).status).toBe(403);
    expect((await patchTitle(id, null, '아무나 바꿈')).status).toBe(401);
    expect((await testPrisma.exhibition.findUnique({ where: { id } }))!.title).toBe('아트링크 공모');
  });

  it('갤러리가 올린 공모는 관리자도 이 길로는 못 고친다(수정 요청 → 승인) — 403, 제목 그대로', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const res = await patchTitle(ex.id, ADMIN(), '관리자가 바꿈');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/수정 요청/);
    expect((await testPrisma.exhibition.findUnique({ where: { id: ex.id } }))!.title).toBe(ex.title);
  });

  it('빈 제목·공백만·100자 초과·문자가 아닌 값은 400 · 없는 공모는 404', async () => {
    const id = await hostedExhibition();
    for (const bad of ['', '   ', 'ㄱ'.repeat(101), 123, null]) {
      expect((await patchTitle(id, ADMIN(), bad)).status, String(bad)).toBe(400);
    }
    expect((await patchTitle(id, ADMIN(), 'ㄱ'.repeat(100))).status).toBe(200);
    expect((await patchTitle(999999, ADMIN(), '없는 공모')).status).toBe(404);
  });

  it('소개(서식 있는 글)도 관리자가 고친다 — 위험한 HTML 은 걸러 저장', async () => {
    const id = await hostedExhibition();
    const res = await request.patch(`/api/exhibitions/${id}/description`).set('Authorization', `Bearer ${ADMIN()}`)
      .send({ description: '<h2>바뀐 소개</h2><p>내용<script>alert(1)</script></p>' });
    expect(res.status).toBe(200);
    const saved = (await testPrisma.exhibition.findUnique({ where: { id } }))!.description;
    expect(saved).toContain('<h2>바뀐 소개</h2>');
    expect(saved).not.toContain('<script');
  });
});

describe('갤러리 수정 요청으로 제목이 바뀌어도 단톡방 이름이 따라간다', () => {
  it('승인하면 공모 제목과 방 이름이 같이 바뀐다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.chat.create({ data: { kind: 'GROUP', title: ex.title, exhibitionId: ex.id } });
    const asked = await request.post('/api/approvals/edit-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'EXHIBITION_EDIT', targetId: ex.id, changes: { title: '승인으로 바뀐 제목' } });
    expect(asked.status).toBe(201);
    const ok = await request.patch(`/api/approvals/edit-request/${asked.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' });
    expect(ok.status).toBe(200);
    expect((await testPrisma.exhibition.findUnique({ where: { id: ex.id } }))!.title).toBe('승인으로 바뀐 제목');
    expect((await testPrisma.chat.findUnique({ where: { exhibitionId: ex.id } }))!.title).toBe('승인으로 바뀐 제목');
  });
});
