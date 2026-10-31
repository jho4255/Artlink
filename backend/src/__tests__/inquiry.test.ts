import { describe, it, expect, beforeEach } from 'vitest';
import { request, cleanDb, seedUsers, authToken, testPrisma } from './helpers';

describe('Inquiry Routes', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  // POST /api/inquiries
  it('Artist가 문의 작성', async () => {
    const res = await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ subject: '테스트 문의', content: '문의 내용입니다.' });
    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('테스트 문의');
    expect(res.body.status).toBe('OPEN');
  });

  it('Gallery가 문의 작성', async () => {
    const res = await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`)
      .send({ subject: '갤러리 문의', content: '갤러리 관련 질문' });
    expect(res.status).toBe(201);
  });

  it('Admin은 문의 작성 불가 (403)', async () => {
    const res = await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ subject: '문의', content: '내용' });
    expect(res.status).toBe(403);
  });

  it('비인증 문의 작성 불가 (401)', async () => {
    const res = await request.post('/api/inquiries')
      .send({ subject: '문의', content: '내용' });
    expect(res.status).toBe(401);
  });

  it('제목 미입력 시 400', async () => {
    const res = await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ subject: '', content: '내용' });
    expect(res.status).toBe(400);
  });

  // GET /api/inquiries
  it('Artist는 본인 문의만 조회', async () => {
    await testPrisma.inquiry.createMany({
      data: [
        { subject: 'A1문의', content: '내용1', userId: 1 },
        { subject: 'A2문의', content: '내용2', userId: 2 },
      ],
    });
    const res = await request.get('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].subject).toBe('A1문의');
  });

  it('Admin은 전체 문의 조회', async () => {
    await testPrisma.inquiry.createMany({
      data: [
        { subject: 'A1문의', content: '내용1', userId: 1 },
        { subject: 'A2문의', content: '내용2', userId: 2 },
      ],
    });
    const res = await request.get('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('Admin 상태 필터 적용', async () => {
    await testPrisma.inquiry.createMany({
      data: [
        { subject: '열린문의', content: '내용', userId: 1, status: 'OPEN' },
        { subject: '답변완료', content: '내용', userId: 2, status: 'ANSWERED' },
      ],
    });
    const res = await request.get('/api/inquiries?status=OPEN')
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].subject).toBe('열린문의');
  });

  // GET /api/inquiries/:id
  it('본인 문의 상세 조회', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '문의', content: '내용', userId: 1 },
    });
    const res = await request.get(`/api/inquiries/${inq.id}`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('문의');
  });

  it('타인 문의 조회 불가 — 404 (403 은 존재를 알려준다, 규칙 23 · 2026-09-19)', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '문의', content: '내용', userId: 2 },
    });
    const res = await request.get(`/api/inquiries/${inq.id}`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(res.status).toBe(404);
  });

  it('Admin은 모든 문의 상세 조회 가능', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '문의', content: '내용', userId: 1 },
    });
    const res = await request.get(`/api/inquiries/${inq.id}`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`);
    expect(res.status).toBe(200);
  });

  // PATCH /api/inquiries/:id/reply
  it('Admin 답변 작성 → status ANSWERED', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '문의', content: '내용', userId: 1 },
    });
    const res = await request.patch(`/api/inquiries/${inq.id}/reply`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ reply: '답변입니다.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ANSWERED');
    expect(res.body.reply).toBe('답변입니다.');
    expect(res.body.repliedAt).toBeTruthy();
  });

  it('Admin 답변 시 알림 생성', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '알림테스트', content: '내용', userId: 1 },
    });
    await request.patch(`/api/inquiries/${inq.id}/reply`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ reply: '답변' });
    const notifs = await testPrisma.notification.findMany({
      where: { userId: 1, type: 'INQUIRY_REPLY' },
    });
    expect(notifs.length).toBe(1);
    expect(notifs[0].message).toContain('알림테스트');
    expect(notifs[0].linkUrl).toBe(`/support?inquiry=${inq.id}`);   // 그 문의를 펼쳐 둔 채로 — FAQ 맨 위가 아니라
  });

  it('★ 답변을 고치면 작성자에게 \'수정\'으로 알린다 · 같은 글자로 다시 저장하면 알리지 않는다', async () => {
    const inq = await testPrisma.inquiry.create({ data: { subject: '수정테스트', content: '내용', userId: 1 } });
    const reply = (text: string) => request.patch(`/api/inquiries/${inq.id}/reply`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ reply: text });
    const messages = async () => (await testPrisma.notification.findMany({
      where: { userId: 1, type: 'INQUIRY_REPLY' }, orderBy: { id: 'asc' },
    })).map(n => n.message);

    await reply('처음 답변');
    await reply('처음 답변');
    expect(await messages()).toEqual(['문의 "수정테스트"에 답변이 등록되었습니다.']);
    await reply('고친 답변');
    expect(await messages()).toEqual([
      '문의 "수정테스트"에 답변이 등록되었습니다.',
      '문의 "수정테스트"의 답변이 수정되었습니다.',
    ]);
  });

  // 새 문의 알림 — 관리자가 모르면 문의가 그대로 묵는다
  it('★ 새 문의가 들어오면 관리자 전원에게 알림이 간다 · 그 문의로 가는 링크', async () => {
    await testPrisma.user.create({ data: { id: 50, email: 'admin2@test.com', name: 'Admin 2', role: 'ADMIN' } });
    const res = await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ subject: '작품이 안 올라가요', content: '내용' });
    expect(res.status).toBe(201);

    const notifs = await testPrisma.notification.findMany({ where: { type: 'INQUIRY_NEW' }, orderBy: { userId: 'asc' } });
    expect(notifs.map(n => n.userId)).toEqual([4, 50]);
    expect(notifs[0].message).toContain('작품이 안 올라가요');
    expect(notifs[0].linkUrl).toBe(`/support?inquiry=${res.body.id}`);
    expect(notifs[0].read).toBe(false);
  });

  it('★ 갤러리·일반 회원의 문의도 관리자에게 알린다', async () => {
    await testPrisma.user.create({ data: { id: 51, email: 'visitor@test.com', name: 'Visitor', role: 'VISITOR' } });
    await request.post('/api/inquiries').set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`).send({ subject: '갤러리 문의', content: '내용' });
    await request.post('/api/inquiries').set('Authorization', `Bearer ${authToken(51, 'VISITOR')}`).send({ subject: '일반 문의', content: '내용' });
    const notifs = await testPrisma.notification.findMany({ where: { userId: 4, type: 'INQUIRY_NEW' } });
    expect(notifs.length).toBe(2);
  });

  it('★ 관리자 말고는 새 문의 알림을 받지 않는다 · 탈퇴한 관리자도 받지 않는다', async () => {
    await testPrisma.user.create({ data: { id: 52, email: 'gone@test.com', name: '탈퇴 관리자', role: 'ADMIN', deletedAt: new Date() } });
    await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ subject: '문의', content: '내용' });
    const notifs = await testPrisma.notification.findMany({ where: { type: 'INQUIRY_NEW' } });
    expect(notifs.map(n => n.userId)).toEqual([4]);
  });

  it('문의를 잘못 보내면(400) 알림도 없다', async () => {
    await request.post('/api/inquiries')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ subject: '', content: '내용' });
    expect(await testPrisma.notification.count({ where: { type: 'INQUIRY_NEW' } })).toBe(0);
  });

  it('비Admin 답변 불가 (403)', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '문의', content: '내용', userId: 1 },
    });
    const res = await request.patch(`/api/inquiries/${inq.id}/reply`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ reply: '답변' });
    expect(res.status).toBe(403);
  });

  it('빈 답변 불가 (400)', async () => {
    const inq = await testPrisma.inquiry.create({
      data: { subject: '문의', content: '내용', userId: 1 },
    });
    const res = await request.patch(`/api/inquiries/${inq.id}/reply`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ reply: '' });
    expect(res.status).toBe(400);
  });
});

describe('FAQ Routes', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('GET /api/inquiries/faq — 빈 목록', async () => {
    const res = await request.get('/api/inquiries/faq');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /api/inquiries/faq — Admin FAQ 작성', async () => {
    const res = await request.post('/api/inquiries/faq')
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ question: '배송은 얼마나 걸리나요?', answer: '3~5일 소요됩니다.' });
    expect(res.status).toBe(201);
    expect(res.body.question).toBe('배송은 얼마나 걸리나요?');
  });

  it('POST /api/inquiries/faq — 비Admin 403', async () => {
    const res = await request.post('/api/inquiries/faq')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .send({ question: '질문', answer: '답변' });
    expect(res.status).toBe(403);
  });

  it('GET /api/inquiries/faq — FAQ 목록 조회 (인증 불필요)', async () => {
    await testPrisma.faq.createMany({
      data: [
        { question: 'Q1', answer: 'A1', order: 2 },
        { question: 'Q2', answer: 'A2', order: 1 },
      ],
    });
    const res = await request.get('/api/inquiries/faq');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].question).toBe('Q2'); // order 오름차순
  });

  it('PATCH /api/inquiries/faq/:id — Admin FAQ 수정', async () => {
    const faq = await testPrisma.faq.create({ data: { question: 'Q', answer: 'A' } });
    const res = await request.patch(`/api/inquiries/faq/${faq.id}`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`)
      .send({ question: '수정Q', answer: '수정A' });
    expect(res.status).toBe(200);
    expect(res.body.question).toBe('수정Q');
  });

  it('DELETE /api/inquiries/faq/:id — Admin FAQ 삭제', async () => {
    const faq = await testPrisma.faq.create({ data: { question: 'Q', answer: 'A' } });
    const res = await request.delete(`/api/inquiries/faq/${faq.id}`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`);
    expect(res.status).toBe(200);
    const count = await testPrisma.faq.count();
    expect(count).toBe(0);
  });
});
