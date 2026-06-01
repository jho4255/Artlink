import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../../__tests__/helpers';

describe('Auth Routes', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
  });

  // /me 인증 확인 — 응답: { user: { id, name, email, role } }
  it('GET /api/auth/me — 유효 토큰으로 유저 정보 반환', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('artist1@test.com');
  });

  // 인증 없이 접근
  it('GET /api/auth/me — 토큰 없으면 401', async () => {
    const res = await request.get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
