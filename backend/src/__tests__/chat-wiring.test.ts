/**
 * 단톡이 **실제 화면 흐름에서** 만들어지는가 — 라우트를 통과시켜 확인한다.
 *
 * ## 왜 따로 두는가
 * `chat.test.ts` 는 `ensureExhibitionChat()` 을 직접 부른다. 그 함수가 옳게 동작해도
 * **라우트가 그걸 안 부르면** 제품에는 방이 안 생긴다 — 그리고 그 실패는 조용하다
 * (세 호출부가 전부 `try { … } catch {}` 로 감싸여 있다. 승인·수락은 성공해야 하니 맞는 선택이지만,
 *  호출 자체가 빠져도 아무 표시가 안 난다).
 *
 * 방이 생기는 길목은 셋뿐이다. 여기서 셋 다 지킨다.
 *   ① Admin 의 공모 승인            (routes/approval.ts)
 *   ② 갤러리의 지원 수락            (routes/exhibition.ts)
 *   ③ 작가의 초대 수락              (routes/exhibition.ts — 중복이지만 다른 진입이라 함께 본다)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const artist1 = authToken(1, 'ARTIST');
const owner = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

const groupChatOf = (exhibitionId: number) =>
  testPrisma.chat.findFirst({ where: { exhibitionId, kind: 'GROUP' }, select: { id: true } });

const participantsOf = async (chatId: number) =>
  (await testPrisma.chatParticipant.findMany({ where: { chatId }, select: { userId: true } }))
    .map(p => p.userId)
    .sort((a, b) => a - b);

describe('① 공모를 승인하면 단톡이 생긴다 (approval 라우트)', () => {
  let exId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    // 승인 전 상태로 되돌려 둔다 (seedExhibition 은 APPROVED 로 만든다)
    await testPrisma.exhibition.update({ where: { id: exId }, data: { status: 'PENDING' } });
  });

  it('★ 승인하면 방이 생기고 갤러리 오너가 참여자가 된다', async () => {
    expect(await groupChatOf(exId)).toBeNull();

    const r = await request.patch(`/api/approvals/exhibition/${exId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'APPROVED' });
    expect(r.status).toBe(200);

    const chat = await groupChatOf(exId);
    expect(chat, '승인했는데 단톡이 안 생겼다 — 라우트가 ensureExhibitionChat 을 안 부른다').not.toBeNull();
    expect(await participantsOf(chat!.id)).toEqual([3]);
  });

  it('거절하면 방을 만들지 않는다 (반려된 공모에 대화방이 남으면 안 된다)', async () => {
    const r = await request.patch(`/api/approvals/exhibition/${exId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'REJECTED', rejectReason: '서류 미비' });
    expect(r.status).toBe(200);
    expect(await groupChatOf(exId)).toBeNull();
  });

  it('두 번 승인해도 방은 하나 (재승인·중복 클릭)', async () => {
    for (let i = 0; i < 2; i++) {
      await request.patch(`/api/approvals/exhibition/${exId}`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ status: 'APPROVED' });
    }
    expect(await testPrisma.chat.count({ where: { exhibitionId: exId } })).toBe(1);
  });
});

describe('② 지원을 수락하면 그 작가가 단톡에 들어온다 (exhibition 라우트)', () => {
  let exId: number;
  let appId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    const app = await testPrisma.application.create({
      data: { userId: 1, exhibitionId: exId, status: 'PENDING' },
    });
    appId = app.id;
  });

  it('★ 수락하면 방이 생기고 작가와 오너가 함께 들어간다', async () => {
    const r = await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'ACCEPTED' });
    expect(r.status).toBe(200);

    const chat = await groupChatOf(exId);
    expect(chat, '수락했는데 단톡이 없다 — 작가가 대화에 못 들어간다').not.toBeNull();
    expect(await participantsOf(chat!.id)).toEqual([1, 3]);
  });

  it('검토중(REVIEWING)으로만 바꾸면 아직 안 넣는다', async () => {
    await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'REVIEWING' });
    expect(await groupChatOf(exId)).toBeNull();
  });

  it('거절하면 방을 만들지 않는다', async () => {
    await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'REJECTED', rejectReason: '이번엔 어렵습니다' });
    expect(await groupChatOf(exId)).toBeNull();
  });

  it('★ 수락된 작가는 그 방에서 바로 말할 수 있다 (권한 = 참여 여부)', async () => {
    await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'ACCEPTED' });
    const chat = (await groupChatOf(exId))!;

    const send = await request.post(`/api/chats/${chat.id}/messages`)
      .set('Authorization', `Bearer ${artist1}`)
      .send({ content: '안녕하세요, 참여하게 되어 기쁩니다.' });
    expect(send.status).toBe(201);
  });

  it('★ 수락되지 않은 작가는 그 방을 볼 수 없다 (404)', async () => {
    await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'ACCEPTED' });
    const chat = (await groupChatOf(exId))!;

    const artist2 = authToken(2, 'ARTIST');
    const r = await request.get(`/api/chats/${chat.id}`).set('Authorization', `Bearer ${artist2}`);
    expect(r.status).toBe(404);
  });
});

describe('③ 대화 목록에 그 방이 실제로 보인다', () => {
  it('★ 수락된 작가의 목록에 공모 단톡이 뜬다 (방만 만들고 안 보이면 소용없다)', async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    const app = await testPrisma.application.create({
      data: { userId: 1, exhibitionId: ex.id, status: 'PENDING' },
    });
    await request.patch(`/api/exhibitions/${ex.id}/applications/${app.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'ACCEPTED' });

    const list = await request.get('/api/chats').set('Authorization', `Bearer ${artist1}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].kind).toBe('GROUP');
    expect(list.body[0].exhibitionId).toBe(ex.id);
  });
});
