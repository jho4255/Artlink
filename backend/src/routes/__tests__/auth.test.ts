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

  // ── 내 정보(연락처/이메일/인스타) 수정 ──
  it('PUT /api/auth/me/profile — 전화번호·인스타 저장', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request
      .put('/api/auth/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '010-1234-5678', instagramUrl: 'https://instagram.com/artist1' });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('010-1234-5678');
    expect(res.body.instagramUrl).toBe('https://instagram.com/artist1');
    const me = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.phone).toBe('010-1234-5678');
    expect(me.body.user.instagramUrl).toBe('https://instagram.com/artist1');
  });

  it('PUT /api/auth/me/profile — 빈 전화번호는 null로 해제', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request
      .put('/api/auth/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '' });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
  });

  it('PUT /api/auth/me/profile — 이메일 변경', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request
      .put('/api/auth/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'artist1-new@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('artist1-new@test.com');
  });

  it('PUT /api/auth/me/profile — 다른 유저가 쓰는 이메일은 409', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request
      .put('/api/auth/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'gallery@test.com' });
    expect(res.status).toBe(409);
  });

  it('PUT /api/auth/me/profile — 잘못된 이메일 형식은 400', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request
      .put('/api/auth/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/auth/me/profile — 토큰 없으면 401', async () => {
    const res = await request.put('/api/auth/me/profile').send({ phone: '010-0000-0000' });
    expect(res.status).toBe(401);
  });
});
