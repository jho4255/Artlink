/**
 * Custom Fields 테스트
 *
 * - 커스텀 필드가 포함된 공모 생성/조회
 * - 커스텀 필드 수정 (PATCH)
 * - 지원 시 커스텀 답변 검증
 * - 파일 업로드 엔드포인트
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, seedGallery, testPrisma } from './helpers';

const galleryToken = authToken(3, 'GALLERY');
const artistToken = authToken(1, 'ARTIST');

describe('Custom Fields API', () => {
  let galleryId: number;
  let exhibitionId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });

  beforeEach(async () => {
    // 매 테스트마다 Exhibition/Application 초기화 (deleteMany로 deadlock 방지)
    await testPrisma.application.deleteMany();
    await testPrisma.exhibition.deleteMany();
    await testPrisma.gallery.deleteMany();
    const gallery = await seedGallery();
    galleryId = gallery.id;
  });

  // 커스텀 필드 포함 공모 생성
  it('POST /exhibitions — customFields 포함 생성', async () => {
    const customFields = [
      { id: 'cf1', label: '작품 소개', type: 'textarea', required: true },
      { id: 'cf2', label: '경험', type: 'select', required: false, options: ['초급', '중급'] },
    ];
    const res = await request
      .post('/api/exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({
        title: 'CF Test Exhibition',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
        exhibitDate: new Date(Date.now() + 60 * 86400000).toISOString(),
        capacity: 5,
        region: 'SEOUL',
        description: 'Custom fields test',
        galleryId,
        customFields,
      });
    expect(res.status).toBe(201);
    exhibitionId = res.body.id;

    // DB에 JSON 문자열로 저장 확인
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exhibitionId } });
    expect(ex?.customFields).toBeTruthy();
    const parsed = JSON.parse(ex!.customFields!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe('작품 소개');
  });

  // 커스텀 필드 없이 생성
  it('POST /exhibitions — customFields 없이 생성', async () => {
    const res = await request
      .post('/api/exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({
        title: 'No CF Exhibition',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
        exhibitDate: new Date(Date.now() + 60 * 86400000).toISOString(),
        capacity: 3,
        region: 'SEOUL',
        description: 'No custom fields',
        galleryId,
      });
    expect(res.status).toBe(201);
    const ex = await testPrisma.exhibition.findUnique({ where: { id: res.body.id } });
    expect(ex?.customFields).toBeNull();
  });

  // GET 상세 — customFields 파싱 확인
  it('GET /exhibitions/:id — customFields parsed', async () => {
    // 먼저 승인된 공모 직접 생성
    const ex = await testPrisma.exhibition.create({
      data: {
        title: 'Parsed CF Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
        customFields: JSON.stringify([{ id: 'cf1', label: 'Q1', type: 'text', required: true }]),
      },
    });

    const res = await request.get(`/api/exhibitions/${ex.id}`);
    expect(res.status).toBe(200);
    expect(res.body.customFields).toEqual([{ id: 'cf1', label: 'Q1', type: 'text', required: true }]);
  });

  // my-exhibitions — customFields 파싱 확인
  it('GET /exhibitions/my-exhibitions — customFields parsed', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'My CF Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        galleryId,
        customFields: JSON.stringify([{ id: 'cf1', label: 'Q1', type: 'text', required: false }]),
      },
    });

    const res = await request
      .get('/api/exhibitions/my-exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0].customFields).toEqual([{ id: 'cf1', label: 'Q1', type: 'text', required: false }]);
  });

  // PATCH custom-fields
  it('PATCH /exhibitions/:id/custom-fields — 오너만 수정 가능', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: 'Patch CF Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const newFields = [{ id: 'new1', label: 'New Q', type: 'text', required: true }];
    const res = await request
      .patch(`/api/exhibitions/${ex.id}/custom-fields`)
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ customFields: newFields });
    expect(res.status).toBe(200);
    expect(res.body.customFields).toEqual(newFields);

    // 다른 유저(Artist)는 403
    const res2 = await request
      .patch(`/api/exhibitions/${ex.id}/custom-fields`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ customFields: newFields });
    expect(res2.status).toBe(403);
  });

  // 지원 + customAnswers
  it('POST /exhibitions/:id/apply — customAnswers 저장', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: 'Apply CF Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
        customFields: JSON.stringify([{ id: 'cf1', label: 'Q1', type: 'text', required: true }]),
      },
    });

    const res = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ customAnswers: [{ fieldId: 'cf1', value: 'My answer' }] });
    expect(res.status).toBe(201);

    // DB에 customAnswers 저장 확인
    const app = await testPrisma.application.findFirst({ where: { exhibitionId: ex.id } });
    expect(app?.customAnswers).toBeTruthy();
    const answers = JSON.parse(app!.customAnswers!);
    expect(answers[0].value).toBe('My answer');
  });

  // 필수 필드 누락 시 에러
  it('POST /exhibitions/:id/apply — required 필드 누락 시 400', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: 'Required CF Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
        customFields: JSON.stringify([{ id: 'cf1', label: 'Q1', type: 'text', required: true }]),
      },
    });

    // customAnswers 없이 지원
    const res = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('필수');
  });

  // 커스텀 필드 없는 공모에 답변 없이 지원 → 성공
  it('POST /exhibitions/:id/apply — customFields 없으면 답변 없이 성공', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: 'No CF Apply Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const res = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({});
    expect(res.status).toBe(201);
  });

  // PATCH — null로 커스텀 필드 제거
  it('PATCH /exhibitions/:id/custom-fields — null로 제거', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: 'Remove CF Test',
        type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
        customFields: JSON.stringify([{ id: 'cf1', label: 'Q1', type: 'text', required: false }]),
      },
    });

    const res = await request
      .patch(`/api/exhibitions/${ex.id}/custom-fields`)
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ customFields: null });
    expect(res.status).toBe(200);
    expect(res.body.customFields).toBeNull();
  });
});
