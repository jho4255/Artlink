import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { request, authToken, cleanDb, seedUsers } from './helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'artlink-dev-secret';

describe('Auth & Authorization', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  // (dev-login 제거됨 — 카카오 OAuth로 전환)

  // ===== GET /auth/me =====
  describe('GET /api/auth/me', () => {
    it('유효한 토큰 → 유저 정보 반환', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: 1, role: 'ARTIST' });
    });

    it('토큰 없이 요청 → 401', async () => {
      const res = await request.get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('만료된 토큰 → 401', async () => {
      const expiredToken = jwt.sign({ userId: 1, role: 'ARTIST' }, JWT_SECRET, { expiresIn: '-1s' });
      const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    it('잘못된 시크릿으로 서명된 토큰 → 401', async () => {
      const badToken = jwt.sign({ userId: 1, role: 'ARTIST' }, 'wrong-secret', { expiresIn: '1h' });
      const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${badToken}`);
      expect(res.status).toBe(401);
    });

    it('유효하지 않은 형식의 토큰 → 401', async () => {
      const res = await request.get('/api/auth/me').set('Authorization', 'Bearer not.a.valid.jwt');
      expect(res.status).toBe(401);
    });

    it('Bearer 접두사 없는 토큰 → 401', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/auth/me').set('Authorization', token);
      expect(res.status).toBe(401);
    });

    it('삭제된 유저의 토큰 → 401', async () => {
      // 토큰은 유효하지만 DB에 없는 userId
      const token = jwt.sign({ userId: 999, role: 'ARTIST' }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  // (dev-users 제거됨)

  // ===== PUT /auth/me/avatar =====
  describe('PUT /api/auth/me/avatar', () => {
    it('프로필 사진 변경 성공', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.put('/api/auth/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatar: 'https://example.com/new-avatar.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.avatar).toBe('https://example.com/new-avatar.jpg');
    });

    it('미인증 시 → 401', async () => {
      const res = await request.put('/api/auth/me/avatar')
        .send({ avatar: 'https://example.com/new-avatar.jpg' });
      expect(res.status).toBe(401);
    });
  });

  // ===== 닉네임 (설정/중복확인) =====
  describe('닉네임', () => {
    it('PUT /me/nickname → 닉네임 설정 성공', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.put('/api/auth/me/nickname')
        .set('Authorization', `Bearer ${token}`)
        .send({ nickname: '아티스트닉' });
      expect(res.status).toBe(200);
      expect(res.body.nickname).toBe('아티스트닉');
    });

    it('GET /me는 nickname 포함', async () => {
      const token = authToken(1, 'ARTIST');
      await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${token}`).send({ nickname: '닉네임확인' });
      const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.body.user.nickname).toBe('닉네임확인');
    });

    it('다른 유저가 동일 닉네임 설정 → 409', async () => {
      const t1 = authToken(1, 'ARTIST');
      const t2 = authToken(2, 'GALLERY');
      await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${t1}`).send({ nickname: '중복닉네임' });
      const res = await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${t2}`).send({ nickname: '중복닉네임' });
      expect(res.status).toBe(409);
    });

    it('본인이 동일 닉네임 재저장 → 200 (멱등)', async () => {
      const token = authToken(1, 'ARTIST');
      await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${token}`).send({ nickname: '내닉네임' });
      const res = await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${token}`).send({ nickname: '내닉네임' });
      expect(res.status).toBe(200);
      expect(res.body.nickname).toBe('내닉네임');
    });

    it('2자 미만 → 400 (validation)', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${token}`).send({ nickname: 'a' });
      expect(res.status).toBe(400);
    });

    it('GET /nickname-check → 미사용 닉네임 available:true', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/auth/nickname-check').query({ nickname: '안쓰는닉' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
    });

    it('GET /nickname-check → 타인이 쓰는 닉네임 available:false', async () => {
      const t1 = authToken(1, 'ARTIST');
      const t2 = authToken(2, 'GALLERY');
      await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${t1}`).send({ nickname: '점유된닉' });
      const res = await request.get('/api/auth/nickname-check').query({ nickname: '점유된닉' }).set('Authorization', `Bearer ${t2}`);
      expect(res.body.available).toBe(false);
    });

    it('GET /nickname-check → 본인이 쓰는 닉네임 available:true', async () => {
      const token = authToken(1, 'ARTIST');
      await request.put('/api/auth/me/nickname').set('Authorization', `Bearer ${token}`).send({ nickname: '내것닉' });
      const res = await request.get('/api/auth/nickname-check').query({ nickname: '내것닉' }).set('Authorization', `Bearer ${token}`);
      expect(res.body.available).toBe(true);
    });
  });

  // ===== authorize 미들웨어 (역할 기반 접근 제어) =====
  describe('Role-based access control', () => {
    // Gallery 등록은 GALLERY 역할만 가능
    it('ARTIST가 갤러리 등록 시도 → 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.post('/api/galleries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test', address: '서울', phone: '010', description: 'desc', region: 'SEOUL', ownerName: 'Owner' });
      expect(res.status).toBe(403);
    });

    // Admin 전용 API — 승인 목록
    it('ARTIST가 승인 큐 조회 시도 → 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('GALLERY가 승인 큐 조회 시도 → 403', async () => {
      const token = authToken(3, 'GALLERY');
      const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('ADMIN이 승인 큐 조회 → 200', async () => {
      const token = authToken(4, 'ADMIN');
      const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  // ===== optionalAuth 미들웨어 =====
  describe('optionalAuth (갤러리 목록 등)', () => {
    it('토큰 없이 요청 → 200 (isFavorited 없음)', async () => {
      const res = await request.get('/api/galleries');
      expect(res.status).toBe(200);
    });

    it('유효한 토큰으로 요청 → 200 (isFavorited 포함)', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/galleries').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('잘못된 토큰으로 요청 → 200 (토큰 무시, 통과)', async () => {
      const res = await request.get('/api/galleries').set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(200);
    });
  });
});
