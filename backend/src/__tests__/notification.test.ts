import { describe, it, expect, beforeEach } from 'vitest';
import { request, cleanDb, seedUsers, authToken, testPrisma, seedGallery, seedExhibition } from './helpers';

describe('Notification Routes', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('GET /api/notifications — 비인증 401', async () => {
    const res = await request.get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('GET /api/notifications — 빈 목록 반환', async () => {
    const res = await request.get('/api/notifications')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /api/notifications/unread-count — 카운트 반환', async () => {
    // 알림 2개 생성 (1개 읽음, 1개 미읽음)
    await testPrisma.notification.createMany({
      data: [
        { userId: 1, type: 'APPLICATION_STATUS', message: '테스트1', read: false },
        { userId: 1, type: 'APPLICATION_STATUS', message: '테스트2', read: true },
      ],
    });
    const res = await request.get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('PATCH /api/notifications/:id/read — 읽음 처리', async () => {
    const notif = await testPrisma.notification.create({
      data: { userId: 1, type: 'APPLICATION_STATUS', message: '테스트', read: false },
    });
    const res = await request.patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await testPrisma.notification.findUnique({ where: { id: notif.id } });
    expect(updated?.read).toBe(true);
  });

  it('PATCH /api/notifications/:id/read — 다른 유저 알림 404', async () => {
    const notif = await testPrisma.notification.create({
      data: { userId: 2, type: 'APPLICATION_STATUS', message: '테스트', read: false },
    });
    const res = await request.patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/notifications/read-all — 전체 읽음', async () => {
    await testPrisma.notification.createMany({
      data: [
        { userId: 1, type: 'APPLICATION_STATUS', message: '테스트1', read: false },
        { userId: 1, type: 'APPLICATION_STATUS', message: '테스트2', read: false },
      ],
    });
    const res = await request.patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(200);

    const count = await testPrisma.notification.count({ where: { userId: 1, read: false } });
    expect(count).toBe(0);
  });

  it('지원 상태 변경 시 Artist에게 알림 생성', async () => {
    const gallery = await seedGallery();
    const exhibition = await seedExhibition(gallery.id);

    // Artist1이 지원
    await request.post(`/api/exhibitions/${exhibition.id}/apply`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);

    // Gallery 오너가 상태 변경
    const app = await testPrisma.application.findFirst({ where: { userId: 1 } });
    await request.patch(`/api/exhibitions/${exhibition.id}/applications/${app!.id}`)
      .set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`)
      .send({ status: 'ACCEPTED' });

    // Artist에게 알림 확인
    const notifs = await testPrisma.notification.findMany({ where: { userId: 1, type: 'APPLICATION_STATUS' } });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs.some(n => n.message.includes('수락'))).toBe(true);
  });

  it('새 지원자 시 Gallery 오너에게 알림 생성', async () => {
    const gallery = await seedGallery();
    const exhibition = await seedExhibition(gallery.id);

    await request.post(`/api/exhibitions/${exhibition.id}/apply`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);

    const notifs = await testPrisma.notification.findMany({ where: { userId: 3, type: 'NEW_APPLICANT' } });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });

  it('갤러리 승인 시 오너에게 알림 생성', async () => {
    // PENDING 갤러리 생성
    const gallery = await testPrisma.gallery.create({
      data: {
        name: 'Pending Gallery', address: '서울', phone: '010-0000-0000',
        description: '대기', region: 'SEOUL', ownerName: 'Owner', status: 'PENDING', ownerId: 3,
      },
    });

    await request.patch(`/api/approvals/gallery/${gallery.id}`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ status: 'APPROVED' });

    const notifs = await testPrisma.notification.findMany({ where: { userId: 3, type: 'APPROVAL_RESULT' } });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs.some(n => n.message.includes('승인'))).toBe(true);
  });
});
