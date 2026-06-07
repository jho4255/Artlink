/**
 * 메시지 전송 제한(스팸 차단) + 1:1 대화 목록 테스트.
 * - 갤러리는 본인 공모 지원자에게만 (작가가 먼저 보낸 경우 회신 허용)
 * - 작가는 승인된 갤러리에게 가능
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const gTok = authToken(3, 'GALLERY');
const a1Tok = authToken(1, 'ARTIST');
const a2Tok = authToken(2, 'ARTIST');

const send = (tok: string, receiverId: number, content = '안녕하세요') =>
  request.post('/api/messages').set('Authorization', `Bearer ${tok}`).send({ receiverId, subject: '대화', content });

describe('메시지 전송 제한', () => {
  let exId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    exId = ex.id;
  });

  it('작가 → 승인 갤러리 전송 가능 (201)', async () => {
    const r = await send(a1Tok, 3);
    expect(r.status).toBe(201);
  });

  it('갤러리 → 비지원 작가 차단 (403)', async () => {
    const r = await send(gTok, 2); // artist2: 지원/대화 없음
    expect(r.status).toBe(403);
  });

  it('갤러리 → 본인 공모 지원 작가 전송 가능 (201)', async () => {
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'SUBMITTED' } });
    const r = await send(gTok, 1);
    expect(r.status).toBe(201);
  });

  it('작가가 먼저 보낸 경우 갤러리 회신 허용 (201)', async () => {
    await send(a2Tok, 3); // artist2 → gallery (먼저)
    const r = await send(gTok, 2); // gallery → artist2 회신
    expect(r.status).toBe(201);
  });

  it('1:1 대화 목록(/chats): 상대별 1건 + 미읽음', async () => {
    await send(a1Tok, 3, '첫 메시지');
    await send(a1Tok, 3, '둘째 메시지');
    const r = await request.get('/api/messages/chats').set('Authorization', `Bearer ${gTok}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].partner.id).toBe(1);
    expect(r.body[0].unreadCount).toBe(2);
    expect(r.body[0].lastMessage.content).toBe('둘째 메시지');
  });
});
