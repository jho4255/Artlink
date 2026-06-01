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
