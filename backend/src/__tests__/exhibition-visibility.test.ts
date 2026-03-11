/**
 * 공모 가시성 테스트 — deadlineStart 필터 + 승인 후 노출 검증
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

let galleryId: number;
const galleryToken = authToken(3, 'GALLERY');
const adminToken = authToken(4, 'ADMIN');

beforeAll(async () => {
  await cleanDb();
  await seedUsers();
  const g = await seedGallery();
  galleryId = g.id;
});

afterAll(async () => {
  await cleanDb();
  await testPrisma.$disconnect();
});

// 각 테스트 전 Exhibition 테이블만 정리
beforeEach(async () => {
  await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Exhibition" CASCADE');
});

function futureDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
function pastDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
// 오늘 자정 (UTC) — deadlineStart로 사용
function todayMidnight(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

describe('Exhibition visibility (GET /exhibitions)', () => {
  it('deadlineStart=null인 승인 공모는 목록에 노출된다', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'No Start Date',
        type: 'SOLO',
        deadline: futureDate(30),
        exhibitDate: futureDate(60),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('No Start Date');
  });

  it('deadlineStart=어제인 승인 공모는 노출된다', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'Started Yesterday',
        type: 'SOLO',
        deadline: futureDate(30),
        deadlineStart: pastDate(1),
        exhibitDate: futureDate(60),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('deadlineStart=오늘(자정)인 승인 공모는 노출된다', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'Starts Today',
        type: 'SOLO',
        deadline: futureDate(30),
        deadlineStart: todayMidnight(),
        exhibitDate: futureDate(60),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Starts Today');
  });

  it('deadlineStart=내일인 승인 공모는 노출되지 않는다', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'Starts Tomorrow',
        type: 'SOLO',
        deadline: futureDate(30),
        deadlineStart: futureDate(1),
        exhibitDate: futureDate(60),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('deadline이 지난 공모는 노출되지 않는다', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'Expired',
        type: 'SOLO',
        deadline: pastDate(1),
        exhibitDate: futureDate(30),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'APPROVED',
        galleryId,
      },
    });

    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('PENDING 상태 공모는 노출되지 않는다', async () => {
    await testPrisma.exhibition.create({
      data: {
        title: 'Pending Exhibition',
        type: 'SOLO',
        deadline: futureDate(30),
        exhibitDate: futureDate(60),
        capacity: 5,
        region: 'SEOUL',
        description: 'test',
        status: 'PENDING',
        galleryId,
      },
    });

    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('공모 등록 → Admin 승인 → 목록 노출 전체 플로우', async () => {
    // 1. Gallery가 공모 등록 (PENDING)
    const createRes = await request
      .post('/api/exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({
        title: 'Approval Flow Test',
        type: 'GROUP',
        deadline: futureDate(30),
        deadlineStart: todayMidnight(),
        exhibitDate: futureDate(60),
        capacity: 10,
        region: 'SEOUL',
        description: 'approval test',
        galleryId,
      });
    expect(createRes.status).toBe(201);
    const exId = createRes.body.id;

    // 2. 목록에 없어야 함 (PENDING)
    let listRes = await request.get('/api/exhibitions');
    expect(listRes.body.find((e: any) => e.id === exId)).toBeUndefined();

    // 3. Admin 승인
    const approveRes = await request
      .patch(`/api/approvals/exhibition/${exId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });
    expect(approveRes.status).toBe(200);

    // 4. 이제 목록에 노출
    listRes = await request.get('/api/exhibitions');
    const found = listRes.body.find((e: any) => e.id === exId);
    expect(found).toBeDefined();
    expect(found.title).toBe('Approval Flow Test');
  });
});
