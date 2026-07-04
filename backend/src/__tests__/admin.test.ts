import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

// 시드: 1=artist1(ARTIST), 2=artist2(ARTIST), 3=gallery(GALLERY), 4=admin(ADMIN)
const ADMIN = () => authToken(4, 'ADMIN');
const ARTIST = () => authToken(1, 'ARTIST');

describe('Admin 사용자 관리', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  describe('GET /api/admin/users (검색)', () => {
    it('ADMIN: 전체 사용자 조회', async () => {
      const res = await request.get('/api/admin/users').set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
      expect(res.body[0]).toHaveProperty('createdAt');
      expect(res.body[0]).toHaveProperty('lastSeenAt');
      expect(res.body.find((u: any) => u.id === 4).lastSeenAt).not.toBeNull();
    });
    it('ADMIN: 역할별 사용자 조회', async () => {
      const galleryRes = await request.get('/api/admin/users?role=GALLERY').set('Authorization', `Bearer ${ADMIN()}`);
      expect(galleryRes.status).toBe(200);
      expect(galleryRes.body.length).toBeGreaterThanOrEqual(1);
      expect(galleryRes.body.every((u: any) => u.role === 'GALLERY')).toBe(true);

      const adminRes = await request.get('/api/admin/users?role=ADMIN').set('Authorization', `Bearer ${ADMIN()}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.every((u: any) => u.role === 'ADMIN')).toBe(true);
    });
    it('ADMIN: 유효하지 않은 역할 필터 → 400', async () => {
      const res = await request.get('/api/admin/users?role=SUPERUSER').set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.status).toBe(400);
    });
    it('ADMIN: 이메일로 검색', async () => {
      const res = await request.get('/api/admin/users?q=artist1').set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.status).toBe(200);
      expect(res.body.some((u: any) => u.email === 'artist1@test.com')).toBe(true);
      expect(res.body.some((u: any) => u.email === 'gallery@test.com')).toBe(false);
    });
    it('ADMIN: 이름으로 검색', async () => {
      const res = await request.get('/api/admin/users?q=Gallery').set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.body.some((u: any) => u.email === 'gallery@test.com')).toBe(true);
    });
    it('ADMIN: 갤러리 유저의 소유 갤러리 목록 포함', async () => {
      await testPrisma.gallery.createMany({
        data: [
          { name: 'First Gallery', address: '서울', phone: '02-1111', description: 'desc', region: 'SEOUL', ownerName: 'Owner', status: 'APPROVED', ownerId: 3 },
          { name: 'Second Gallery', address: '부산', phone: '051-1111', description: 'desc', region: 'BUSAN', ownerName: 'Owner', status: 'PENDING', ownerId: 3 },
        ],
      });

      const res = await request.get('/api/admin/users?q=Gallery').set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.status).toBe(200);
      const galleryUser = res.body.find((u: any) => u.email === 'gallery@test.com');
      expect(galleryUser.galleries).toHaveLength(2);
      expect(galleryUser.galleries.map((g: any) => g.name)).toEqual(expect.arrayContaining(['First Gallery', 'Second Gallery']));
    });
    it('ARTIST: 접근 → 403', async () => {
      const res = await request.get('/api/admin/users').set('Authorization', `Bearer ${ARTIST()}`);
      expect(res.status).toBe(403);
    });
    it('비로그인 → 401', async () => {
      const res = await request.get('/api/admin/users');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/admin/users/:id/role (역할 변경)', () => {
    it('ADMIN: 아티스트를 ADMIN으로 승격', async () => {
      const res = await request.patch('/api/admin/users/1/role')
        .set('Authorization', `Bearer ${ADMIN()}`).send({ role: 'ADMIN' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      const u = await testPrisma.user.findUnique({ where: { id: 1 } });
      expect(u?.role).toBe('ADMIN');
    });
    it('본인 역할 변경 시도 → 400', async () => {
      const res = await request.patch('/api/admin/users/4/role')
        .set('Authorization', `Bearer ${ADMIN()}`).send({ role: 'ARTIST' });
      expect(res.status).toBe(400);
    });
    it('다른 관리자 강등/변경 시도 → 403 (관리자 보호)', async () => {
      // user 1을 ADMIN으로 승격
      await request.patch('/api/admin/users/1/role').set('Authorization', `Bearer ${ADMIN()}`).send({ role: 'ADMIN' });
      // 다른 관리자(id 4)가 admin이 된 user 1을 강등 시도 → 차단
      const res = await request.patch('/api/admin/users/1/role')
        .set('Authorization', `Bearer ${ADMIN()}`).send({ role: 'ARTIST' });
      expect(res.status).toBe(403);
      const u = await testPrisma.user.findUnique({ where: { id: 1 } });
      expect(u?.role).toBe('ADMIN'); // 여전히 ADMIN
    });
    it('유효하지 않은 역할 → 400', async () => {
      const res = await request.patch('/api/admin/users/1/role')
        .set('Authorization', `Bearer ${ADMIN()}`).send({ role: 'SUPERUSER' });
      expect(res.status).toBe(400);
    });
    it('없는 사용자 → 404', async () => {
      const res = await request.patch('/api/admin/users/9999/role')
        .set('Authorization', `Bearer ${ADMIN()}`).send({ role: 'ADMIN' });
      expect(res.status).toBe(404);
    });
    it('ARTIST가 역할 변경 시도 → 403', async () => {
      const res = await request.patch('/api/admin/users/2/role')
        .set('Authorization', `Bearer ${ARTIST()}`).send({ role: 'ADMIN' });
      expect(res.status).toBe(403);
    });
  });
});
