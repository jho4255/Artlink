import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, seedShow } from '../../__tests__/helpers';

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

// ── 회원 탈퇴 (소프트 삭제 + 익명화) ──
describe('Account Withdrawal (DELETE /api/auth/me)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
  });

  it('GET /me/withdraw-info — 갤러리 없는 작가는 confirmMethod=text, galleries 빈 배열', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.get('/api/auth/me/withdraw-info').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.confirmMethod).toBe('text');
    expect(res.body.galleries).toEqual([]);
  });

  it('DELETE /me — 확인 문구 불일치 시 400', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ confirmText: '아니오' });
    expect(res.status).toBe(400);
  });

  it('DELETE /me — 작가 탈퇴 성공 + 익명화 + 토큰 차단', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ confirmText: '탈퇴' });
    expect(res.status).toBe(200);

    const u = await testPrisma.user.findUnique({ where: { id: 1 } });
    expect(u?.deletedAt).not.toBeNull();
    expect(u?.name).toBe('탈퇴한 회원');
    expect(u?.email).toBe('deleted_1@artlink.invalid');
    expect(u?.phone).toBeNull();

    // 같은 토큰으로 보호 라우트 접근 차단
    const me = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it('DELETE /me — LOCAL 계정은 비밀번호 확인(오답 401, 정답 200)', async () => {
    const signup = await request.post('/api/auth/signup').send({ name: '비번유저', email: 'pw@test.com', password: 'secret123', role: 'ARTIST' });
    const token = signup.body.token;

    const info = await request.get('/api/auth/me/withdraw-info').set('Authorization', `Bearer ${token}`);
    expect(info.body.confirmMethod).toBe('password');

    const wrong = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ password: 'nope' });
    expect(wrong.status).toBe(401);

    const ok = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ password: 'secret123' });
    expect(ok.status).toBe(200);

    // 기존 이메일/비번으로 재로그인 불가
    const login = await request.post('/api/auth/login').send({ email: 'pw@test.com', password: 'secret123' });
    expect(login.status).toBe(401);
  });

  it('DELETE /me — 관리자는 탈퇴 불가 403', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ confirmText: '탈퇴' });
    expect(res.status).toBe(403);
  });

  it('갤러리 보유 회원: acknowledge 없으면 400, 있으면 갤러리/공모/전시 WITHDRAWN + 공개 숨김', async () => {
    const gallery = await seedGallery(3);
    const exhibition = await seedExhibition(gallery.id);
    const show = await seedShow(gallery.id);
    const token = authToken(3, 'GALLERY');

    const info = await request.get('/api/auth/me/withdraw-info').set('Authorization', `Bearer ${token}`);
    expect(info.body.galleries.length).toBe(1);
    expect(info.body.ongoingExhibitions).toBe(1);

    // 책임 동의 없이 → 400 (변경 없음)
    const no = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ confirmText: '탈퇴' });
    expect(no.status).toBe(400);
    expect((await testPrisma.gallery.findUnique({ where: { id: gallery.id } }))?.status).toBe('APPROVED');

    // 동의 포함 → 성공
    const ok = await request.delete('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ confirmText: '탈퇴', acknowledge: true });
    expect(ok.status).toBe(200);

    expect((await testPrisma.gallery.findUnique({ where: { id: gallery.id } }))?.status).toBe('WITHDRAWN');
    expect((await testPrisma.exhibition.findUnique({ where: { id: exhibition.id } }))?.status).toBe('WITHDRAWN');
    expect((await testPrisma.show.findUnique({ where: { id: show.id } }))?.status).toBe('WITHDRAWN');

    // 공개 목록 제외 + 상세 404
    const list = await request.get('/api/galleries');
    expect(list.body.find((g: any) => g.id === gallery.id)).toBeUndefined();
    const detail = await request.get(`/api/galleries/${gallery.id}`);
    expect(detail.status).toBe(404);
  });
});
