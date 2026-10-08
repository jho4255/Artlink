/**
 * 지역 넷 추가(경북·경남·전북·전남) · 올린 공모의 지역 바꾸기 · 관리자 주최 공모의 추가 질문 (2026-10-08 사용자 요청)
 * 규칙: lib/regions.ts(목록 한 곳) · PATCH /exhibitions/:id/region(모집 인원과 같은 권한)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { REGIONS, regionLabel } from '../lib/regions';
import { request, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, testPrisma } from './helpers';

const OWNER = () => authToken(3, 'GALLERY');
const ADMIN = () => authToken(4, 'ADMIN');
const ARTIST = () => authToken(1, 'ARTIST');
const DAY = 86400000;
const future = (d: number) => new Date(Date.now() + d * DAY).toISOString();

async function otherGallery() {
  await testPrisma.user.create({ data: { id: 5, email: 'other@test.com', name: 'Other Gallery', role: 'GALLERY' } });
  await seedGallery(5);
  return authToken(5, 'GALLERY');
}

const patchRegion = (id: number, token: string, region: unknown) =>
  request.patch(`/api/exhibitions/${id}/region`).set('Authorization', `Bearer ${token}`).send({ region });

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('지역 목록 — 경북·경남·전북·전남', () => {
  it('목록 한 곳에 열두 곳이 있고 이름이 붙는다(공유 미리보기에 코드가 그대로 찍히지 않게)', () => {
    expect(REGIONS).toHaveLength(12);
    for (const r of ['GYEONGBUK', 'GYEONGNAM', 'JEONBUK', 'JEONNAM']) expect(REGIONS).toContain(r);
    expect(regionLabel('GYEONGNAM')).toBe('경남');
    expect(regionLabel('JEONBUK')).toBe('전북');
    // 예전 검색엔진 설명 표에 빠져 있던 셋
    expect(regionLabel('INCHEON')).toBe('인천');
    expect(regionLabel('ULSAN')).toBe('울산');
    expect(regionLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('★ 새 지역으로 공모를 올리고 목록 필터로 찾는다 · 모르는 지역은 400', async () => {
    const g = await seedGallery();
    const base = { title: '경남 공모', type: 'SOLO', deadline: future(10), recruitOnly: true, capacity: 2, description: '<p>x</p>', galleryId: g.id };
    const res = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base, region: 'GYEONGNAM' });
    expect(res.status).toBe(201);
    expect(res.body.region).toBe('GYEONGNAM');
    expect((await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base, region: 'JEJU' })).status).toBe(400);

    await testPrisma.exhibition.update({ where: { id: res.body.id }, data: { status: 'APPROVED' } });
    const list = await request.get('/api/exhibitions?region=GYEONGNAM');
    expect(list.body.map((e: any) => e.id)).toContain(res.body.id);
    const other = await request.get('/api/exhibitions?region=SEOUL');
    expect(other.body.map((e: any) => e.id)).not.toContain(res.body.id);
  });

  it('갤러리 지역도 새 네 곳으로 바꿀 수 있다', async () => {
    const g = await seedGallery();
    const res = await request.patch(`/api/galleries/${g.id}/detail`).set('Authorization', `Bearer ${OWNER()}`).send({ region: 'JEONBUK' });
    expect(res.status).toBe(200);
    expect((await testPrisma.gallery.findUnique({ where: { id: g.id } }))!.region).toBe('JEONBUK');
    expect((await request.patch(`/api/galleries/${g.id}/detail`).set('Authorization', `Bearer ${OWNER()}`).send({ region: 'JEJU' })).status).toBe(400);
  });
});

describe('올린 공모의 지역 바꾸기 — PATCH /exhibitions/:id/region', () => {
  it('★ 그 갤러리가 바로 바꾼다(승인 없이) · 모르는 지역 400 · 작가 403', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const up = await patchRegion(ex.id, OWNER(), 'GYEONGBUK');
    expect(up.status).toBe(200);
    expect(up.body.region).toBe('GYEONGBUK');
    const after = await testPrisma.exhibition.findUnique({ where: { id: ex.id } });
    expect(after!.region).toBe('GYEONGBUK');
    expect(after!.status).toBe('APPROVED');   // 다시 심사로 돌아가지 않는다
    expect((await patchRegion(ex.id, OWNER(), 'JEJU')).status).toBe(400);
    expect((await patchRegion(ex.id, OWNER(), undefined)).status).toBe(400);
    expect((await patchRegion(ex.id, ARTIST(), 'SEOUL')).status).toBe(403);
  });

  it('남의 공모는 못 바꾼다 · 심사 중인 공모도 주인은 바꾼다 · 전시가 끝나도 바꾼다(목록 필터에만 쓰인다)', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const other = await otherGallery();
    expect((await patchRegion(ex.id, other, 'BUSAN')).status).toBe(403);
    expect((await testPrisma.exhibition.findUnique({ where: { id: ex.id } }))!.region).toBe('SEOUL');
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { status: 'PENDING' } });
    expect((await patchRegion(ex.id, OWNER(), 'JEONNAM')).status).toBe(200);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { status: 'APPROVED', ended: true } });
    expect((await patchRegion(ex.id, OWNER(), 'DAEGU')).status).toBe(200);
  });

  it('아트링크 주최 공모는 관리자만 — 위임 갤러리는 403 · 갤러리 없는 공모도 관리자가 바꾼다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { hostType: 'ADMIN' } });
    await testPrisma.exhibitionManager.create({ data: { exhibitionId: ex.id, galleryId: g.id } });
    expect((await patchRegion(ex.id, OWNER(), 'GYEONGNAM')).status).toBe(403);
    expect((await patchRegion(ex.id, ADMIN(), 'GYEONGNAM')).status).toBe(200);

    const hostless = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`).send({
      title: '갤러리 없는 공모', type: 'GROUP', deadline: future(10), recruitOnly: true, capacity: 3, region: 'SEOUL', description: '<p>x</p>', galleryIds: [],
    });
    expect(hostless.status).toBe(201);
    expect((await patchRegion(hostless.body.id, ADMIN(), 'JEONBUK')).body.region).toBe('JEONBUK');
  });
});

describe('관리자 주최 공모의 추가 질문 — 고치고 지운 대로 주최 공모 목록에 남는다', () => {
  it('★ 질문을 고치고 하나를 지운 뒤, 전부 지운다 — 목록·상세가 같은 답', async () => {
    const created = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`).send({
      title: '질문 공모', type: 'GROUP', deadline: future(10), recruitOnly: true, capacity: 3, region: 'SEOUL', description: '<p>x</p>', galleryIds: [],
      customFields: [
        { id: 'q1', label: '질문A', type: 'textarea', required: false },
        { id: 'q2', label: '질문B', type: 'select', required: true, options: ['가', '나'], maxSelect: 1 },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const save = (customFields: unknown) =>
      request.patch(`/api/exhibitions/${id}/custom-fields`).set('Authorization', `Bearer ${ADMIN()}`).send({ customFields });
    const hosted = async () => (await request.get('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`)).body.find((e: any) => e.id === id);

    const r1 = await save([{ id: 'q1', label: '질문A-고침', type: 'textarea', required: true }]);
    expect(r1.status).toBe(200);
    expect(r1.body.customFields.map((f: any) => f.label)).toEqual(['질문A-고침']);
    expect((await hosted()).customFields.map((f: any) => f.label)).toEqual(['질문A-고침']);
    expect((await request.get(`/api/exhibitions/${id}`)).body.customFields.map((f: any) => f.label)).toEqual(['질문A-고침']);

    const r2 = await save([]);
    expect(r2.status).toBe(200);
    expect((await hosted()).customFields ?? []).toEqual([]);
  });
});
