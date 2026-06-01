import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { request, testPrisma, cleanDb, seedUsers } from './helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'artlink-dev-secret';

/** 카카오 가입완료에 전화번호 수집 (DB 저장 + 필수/형식 검증) */
describe('POST /auth/complete-registration — 전화번호 수집', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  const tempToken = (providerId: string) =>
    jwt.sign({ provider: 'KAKAO', providerId, name: '카카오유저', email: null, avatar: null }, JWT_SECRET, { expiresIn: '10m' });

  it('전화번호 포함 가입 → 201 + phone DB 저장', async () => {
    const res = await request.post('/api/auth/complete-registration')
      .send({ tempToken: tempToken('kakao_p1'), role: 'ARTIST', name: '폰유저', email: 'phone1@test.com', phone: '010-1234-5678' });
    expect(res.status).toBe(201);
    const u = await testPrisma.user.findUnique({ where: { email: 'phone1@test.com' } });
    expect(u?.phone).toBe('010-1234-5678');
  });

  it('하이픈 없는 번호도 허용 → 201', async () => {
    const res = await request.post('/api/auth/complete-registration')
      .send({ tempToken: tempToken('kakao_p2'), role: 'GALLERY', name: '폰유저2', email: 'phone2@test.com', phone: '01012345678' });
    expect(res.status).toBe(201);
  });

  it('전화번호 누락 → 400', async () => {
    const res = await request.post('/api/auth/complete-registration')
      .send({ tempToken: tempToken('kakao_p3'), role: 'ARTIST', name: '폰유저3', email: 'phone3@test.com' });
    expect(res.status).toBe(400);
  });

  it('잘못된 형식 → 400', async () => {
    const res = await request.post('/api/auth/complete-registration')
      .send({ tempToken: tempToken('kakao_p4'), role: 'ARTIST', name: '폰유저4', email: 'phone4@test.com', phone: '12345' });
    expect(res.status).toBe(400);
  });
});
