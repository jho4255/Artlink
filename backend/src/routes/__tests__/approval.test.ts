import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../../__tests__/helpers';

describe('Approval Routes', () => {
  let pendingGalleryId: number;
  let pendingExhibitionId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    // PENDING 갤러리 생성
    const gallery = await testPrisma.gallery.create({
      data: {
        name: 'Pending Gallery', address: '주소', phone: '000',
        description: 'desc', region: 'SEOUL', ownerName: 'owner',
        status: 'PENDING', ownerId: 3,
      },
    });
    pendingGalleryId = gallery.id;
    // PENDING 공모 (승인된 갤러리 필요)
    const approvedGallery = await testPrisma.gallery.create({
      data: {
        name: 'Approved Gallery', address: '주소', phone: '000',
        description: 'desc', region: 'SEOUL', ownerName: 'owner',
        status: 'APPROVED', ownerId: 3,
      },
    });
    const exhibition = await testPrisma.exhibition.create({
      data: {
        title: 'Pending Exhibition', type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        exhibitDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        capacity: 5, region: 'SEOUL', description: 'desc',
        status: 'PENDING', galleryId: approvedGallery.id,
      },
    });
    pendingExhibitionId = exhibition.id;
  });
  afterAll(async () => {
    await cleanDb();
    await testPrisma.$disconnect();
  });

  // 승인 대기 목록 (Admin만) — 응답: { pendingGalleries, pendingExhibitions, pendingRequests }
  it('GET /api/approvals — Admin만 접근 가능', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pendingGalleries');
    expect(res.body).toHaveProperty('pendingExhibitions');
    expect(res.body).toHaveProperty('pendingRequests');
  });

  // Artist는 접근 불가
  it('GET /api/approvals — Artist 403', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // 갤러리 승인
  it('PATCH /api/approvals/gallery/:id — 갤러리 승인', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.patch(`/api/approvals/gallery/${pendingGalleryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  // 거절 시 사유 필수
  it('PATCH /api/approvals/exhibition/:id — 거절 시 rejectReason 필수', async () => {
    const token = authToken(4, 'ADMIN');
    // rejectReason 없이 거절 시도
    const res1 = await request.patch(`/api/approvals/exhibition/${pendingExhibitionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'REJECTED' });
    expect(res1.status).toBe(400);

    // rejectReason 포함
    const res2 = await request.patch(`/api/approvals/exhibition/${pendingExhibitionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'REJECTED', rejectReason: '기준 미달' });
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('REJECTED');
    expect(res2.body.rejectReason).toBe('기준 미달');
  });

  // 수정 요청 생성 (Gallery 유저) — changes는 객체로 전달 (handler에서 stringify)
  it('POST /api/approvals/edit-request — 수정 요청 생성', async () => {
    const token = authToken(3, 'GALLERY');
    const res = await request.post('/api/approvals/edit-request')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'GALLERY_EDIT', targetId: pendingGalleryId, changes: { name: 'Updated Name' } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  // 수정 요청 승인
  it('PATCH /api/approvals/edit-request/:id — 수정 요청 승인 시 변경 적용', async () => {
    const editReq = await testPrisma.approvalRequest.findFirst({ where: { status: 'PENDING' } });
    const token = authToken(4, 'ADMIN');
    const res = await request.patch(`/api/approvals/edit-request/${editReq!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'APPROVED' });
    expect(res.status).toBe(200);
    // 변경사항이 갤러리에 적용되었는지 확인
    const gallery = await testPrisma.gallery.findUnique({ where: { id: pendingGalleryId } });
    expect(gallery!.name).toBe('Updated Name');
  });
});
