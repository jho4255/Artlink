import { describe, it, expect } from 'vitest';
import { request } from '../../__tests__/helpers';

describe('Error Handler Middleware', () => {
  // 존재하지 않는 API 경로
  it('존재하지 않는 경로 — 404 또는 에러 반환', async () => {
    const res = await request.get('/api/nonexistent-route');
    // Express 5는 존재하지 않는 경로에 대해 404를 반환
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // 잘못된 인증 토큰
  it('잘못된 JWT 토큰 — 401 반환', async () => {
    const res = await request.get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  // 유효하지 않은 JSON body
  it('잘못된 JSON body — 400 반환', async () => {
    const res = await request.post('/api/auth/dev-login')
      .set('Content-Type', 'application/json')
      .send('invalid json{');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
