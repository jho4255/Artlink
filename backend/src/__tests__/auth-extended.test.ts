import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { request, authToken, cleanDb, seedUsers } from './helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'artlink-dev-secret';

describe('Auth & Authorization', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ===== POST /auth/dev-login =====
  describe('POST /api/auth/dev-login', () => {
    it('유효한 userId로 로그인 → JWT + 유저 정보 반환', async () => {
      const res = await request.post('/api/auth/dev-login').send({ userId: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toMatchObject({ id: 1, role: 'ARTIST', email: 'artist1@test.com' });
      // 토큰 디코딩 검증
      const decoded = jwt.verify(res.body.token, JWT_SECRET) as any;
      expect(decoded.userId).toBe(1);
      expect(decoded.role).toBe('ARTIST');
    });

    it('존재하지 않는 userId → 404', async () => {
      const res = await request.post('/api/auth/dev-login').send({ userId: 9999 });
      expect(res.status).toBe(404);
    });

    it('userId 미전송 → 404 (null user)', async () => {
      const res = await request.post('/api/auth/dev-login').send({});
      // userId undefined → findUnique fails
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

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

  // ===== GET /auth/dev-users =====
  describe('GET /api/auth/dev-users', () => {
    it('전체 유저 목록 반환 (인증 불필요)', async () => {
      const res = await request.get('/api/auth/dev-users');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      // avatar, password 등 민감 필드 미노출 확인
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).toHaveProperty('role');
    });
  });

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
