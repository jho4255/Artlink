/**
 * 이웃(단방향 팔로우) + 스토리([소식] 피드) — `routes/follow.ts`, `routes/story.ts`
 *
 * 지켜야 하는 것:
 *  ① 팔로우는 단방향 + 멱등, 자기 자신 불가, 상대에게 알림 1건
 *  ② [소식] 피드 = 내가 팔로우한 사람 + 나 (그 외 남의 스토리는 안 보임)
 *  ③ 스토리 공개범위는 글마다 — 비팔로워는 PUBLIC 만, 팔로워/본인은 NEIGHBORS 까지
 *  ④ 스토리 삭제는 작성자 또는 Admin
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

const makeStory = (tok: string, body: any = {}) =>
  request.post('/api/stories').set('Authorization', `Bearer ${tok}`).send({ caption: '작업 중', ...body });

describe('서로 이웃 목록 (GET /api/follow/mutuals) — 이웃에게 바로 말 걸기용', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('로그인해야 조회할 수 있다', async () => {
    expect((await request.get('/api/follow/mutuals')).status).toBe(401);
  });

  it('★ 서로 팔로우한 사람만 나온다 (단방향은 제외)', async () => {
    // 1↔2 서로 이웃, 1→3 은 단방향
    await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    await request.post('/api/follow/1').set('Authorization', `Bearer ${a2}`);
    await request.post('/api/follow/3').set('Authorization', `Bearer ${a1}`);
    const r = await request.get('/api/follow/mutuals').set('Authorization', `Bearer ${a1}`);
    expect(r.status).toBe(200);
    expect(r.body.map((u: any) => u.id)).toEqual([2]);   // 3 은 단방향이라 제외
    expect(r.body[0]).toMatchObject({ id: 2, role: 'ARTIST' });
  });

  it('서로 이웃이 없으면 빈 배열 (단방향뿐)', async () => {
    await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    const r = await request.get('/api/follow/mutuals').set('Authorization', `Bearer ${a1}`);
    expect(r.body).toEqual([]);
  });
});

describe('이웃 (팔로우)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('로그인해야 팔로우할 수 있다', async () => {
    expect((await request.post('/api/follow/2')).status).toBe(401);
  });

  it('자기 자신은 팔로우할 수 없다', async () => {
    expect((await request.post('/api/follow/1').set('Authorization', `Bearer ${a1}`)).status).toBe(400);
  });

  it('없는 사용자는 404', async () => {
    expect((await request.post('/api/follow/99999').set('Authorization', `Bearer ${a1}`)).status).toBe(404);
  });

  it('★ 팔로우는 단방향 + 멱등 + 상대에게 알림 1건', async () => {
    const r1 = await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ following: true, followerCount: 1 });
    // 멱등 — 두 번 눌러도 1건, 알림도 안 늘어남
    await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    expect(await testPrisma.follow.count({ where: { followerId: 1, followingId: 2 } })).toBe(1);
    const notis = await testPrisma.notification.findMany({ where: { userId: 2, type: 'NEIGHBOR_FOLLOW' } });
    expect(notis.length).toBe(1);
    expect(notis[0].linkUrl).toBe('/portfolio/1');
    // 단방향 — 상대(2)는 나(1)를 팔로우하지 않는다
    const s = await request.get('/api/follow/1').set('Authorization', `Bearer ${a2}`);
    expect(s.body.following).toBe(false);       // 2는 1을 팔로우하지 않는다
    expect(s.body.followerCount).toBe(0);       // 1을 팔로우하는 사람은 없다(단방향)
  });

  it('★ 팔로우 취소', async () => {
    await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    const r = await request.delete('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    expect(r.body).toMatchObject({ following: false, followerCount: 0 });
    expect(await testPrisma.follow.count({ where: { followerId: 1 } })).toBe(0);
  });

  it('상태 조회 — following/팔로워수/팔로잉수/isMe', async () => {
    await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    const s = await request.get('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    expect(s.body).toMatchObject({ following: true, followerCount: 1, isMe: false });
    const self = await request.get('/api/follow/1').set('Authorization', `Bearer ${a1}`);
    expect(self.body.isMe).toBe(true);
  });
});

describe('스토리 + [소식] 피드', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('로그인해야 쓴다 / 피드도 로그인 필요', async () => {
    expect((await request.post('/api/stories').send({ caption: 'x' })).status).toBe(401);
    expect((await request.get('/api/stories/feed')).status).toBe(401);
  });

  it('사진도 글도 없으면 400', async () => {
    expect((await makeStory(a1, { caption: '  ', images: [] })).status).toBe(400);
  });

  it('★ [소식] 피드는 내가 팔로우한 사람 + 나 만 보인다', async () => {
    await makeStory(a1, { caption: '내 스토리' });
    await makeStory(a2, { caption: 'a2 스토리', visibility: 'PUBLIC' });
    await makeStory(gallery, { caption: '갤러리 스토리', visibility: 'PUBLIC' });

    // 아직 아무도 팔로우 안 함 → 내 것만
    let feed = await request.get('/api/stories/feed').set('Authorization', `Bearer ${a1}`);
    expect(feed.body.stories.map((s: any) => s.caption)).toEqual(['내 스토리']);

    // a2 를 팔로우 → a2 것도 보임 (갤러리는 여전히 안 보임)
    await request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`);
    feed = await request.get('/api/stories/feed').set('Authorization', `Bearer ${a1}`);
    const caps = feed.body.stories.map((s: any) => s.caption);
    expect(caps).toContain('내 스토리');
    expect(caps).toContain('a2 스토리');
    expect(caps).not.toContain('갤러리 스토리');
  });

  it('★ 공개범위는 글마다 — 비팔로워는 PUBLIC 만, 팔로워는 NEIGHBORS 까지', async () => {
    await makeStory(a1, { caption: '전체공개', visibility: 'PUBLIC' });
    await makeStory(a1, { caption: '이웃공개', visibility: 'NEIGHBORS' });

    // 비팔로워(gallery)가 a1 홈페이지 스토리 조회 → PUBLIC 만
    let r = await request.get('/api/stories/user/1').set('Authorization', `Bearer ${gallery}`);
    expect(r.body.stories.map((s: any) => s.caption)).toEqual(['전체공개']);
    expect(r.body.canSeeNeighbors).toBe(false);

    // 비로그인도 PUBLIC 만
    r = await request.get('/api/stories/user/1');
    expect(r.body.stories.map((s: any) => s.caption)).toEqual(['전체공개']);

    // gallery 가 a1 팔로우 → 이웃공개까지
    await request.post('/api/follow/1').set('Authorization', `Bearer ${gallery}`);
    r = await request.get('/api/stories/user/1').set('Authorization', `Bearer ${gallery}`);
    expect(r.body.stories.map((s: any) => s.caption).sort()).toEqual(['이웃공개', '전체공개']);
    expect(r.body.canSeeNeighbors).toBe(true);

    // 본인은 항상 다 보인다
    r = await request.get('/api/stories/user/1').set('Authorization', `Bearer ${a1}`);
    expect(r.body.stories.length).toBe(2);
    expect(r.body.canSeeNeighbors).toBe(true);
  });

  it('★ 삭제는 작성자 또는 Admin 만', async () => {
    const { body } = await makeStory(a1, { caption: '지울 것' });
    expect((await request.delete(`/api/stories/${body.id}`).set('Authorization', `Bearer ${a2}`)).status).toBe(403);
    expect((await request.delete(`/api/stories/${body.id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
    expect(await testPrisma.story.count()).toBe(0);
  });

  it('외부 URL 사진은 거른다 (우리 저장소만)', async () => {
    const { body } = await makeStory(a1, { caption: '사진', images: ['https://evil.example.com/x.png', '/uploads/ok.png'] });
    const feed = await request.get('/api/stories/feed').set('Authorization', `Bearer ${a1}`);
    const mine = feed.body.stories.find((s: any) => s.id === body.id);
    expect(mine.images).toEqual(['/uploads/ok.png']);
  });

  it('★ 좋아요 토글 + 피드에 liked/likeCount 반영', async () => {
    const { body } = await makeStory(a1, { caption: '좋아요 대상' });
    const r1 = await request.post(`/api/stories/${body.id}/like`).set('Authorization', `Bearer ${a2}`);
    expect(r1.body).toMatchObject({ liked: true, likeCount: 1 });
    // 두 번 = 취소
    const r2 = await request.post(`/api/stories/${body.id}/like`).set('Authorization', `Bearer ${a2}`);
    expect(r2.body).toMatchObject({ liked: false, likeCount: 0 });
    // 다시 좋아요 후 a1 이 피드로 보면 liked=false(자기가 안 눌렀으니), a2 가 보면 liked=true
    await request.post(`/api/stories/${body.id}/like`).set('Authorization', `Bearer ${a2}`);
    await request.post('/api/follow/1').set('Authorization', `Bearer ${a2}`);
    const feedA2 = await request.get('/api/stories/feed').set('Authorization', `Bearer ${a2}`);
    const seen = feedA2.body.stories.find((s: any) => s.id === body.id);
    expect(seen).toMatchObject({ liked: true, likeCount: 1 });
  });

  it('★ 좋아요 누른 사람 목록이 보인다 (누가 눌렀는지)', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { nickname: '눌른이' } });
    const { body } = await makeStory(a1, { caption: '좋아요 명단' });
    await request.post(`/api/stories/${body.id}/like`).set('Authorization', `Bearer ${a2}`);
    await request.post(`/api/stories/${body.id}/like`).set('Authorization', `Bearer ${gallery}`);
    const likers = await request.get(`/api/stories/${body.id}/likers`);
    expect(likers.status).toBe(200);
    expect(likers.body.map((u: any) => u.name)).toContain('눌른이');
    expect(likers.body.length).toBe(2);
  });

  it('★ 댓글 작성/목록/삭제 + 주인 알림', async () => {
    const { body } = await makeStory(a1, { caption: '댓글 대상' });
    const c = await request.post(`/api/stories/${body.id}/comments`).set('Authorization', `Bearer ${a2}`).send({ body: '멋져요' });
    expect(c.status).toBe(201);
    // 주인(1)에게 알림
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_COMMENT' } })).toBe(1);
    // 카운트 반영
    const feed = await request.get('/api/stories/feed').set('Authorization', `Bearer ${a1}`);
    expect(feed.body.stories.find((s: any) => s.id === body.id).commentCount).toBe(1);
    // 목록
    const list = await request.get(`/api/stories/${body.id}/comments`);
    expect(list.body.map((x: any) => x.body)).toEqual(['멋져요']);
    // 남(gallery)은 못 지우고, 스토리 주인(a1)은 지운다
    expect((await request.delete(`/api/stories/${body.id}/comments/${c.body.id}`).set('Authorization', `Bearer ${gallery}`)).status).toBe(403);
    expect((await request.delete(`/api/stories/${body.id}/comments/${c.body.id}`).set('Authorization', `Bearer ${a1}`)).status).toBe(200);
    expect(await testPrisma.storyComment.count()).toBe(0);
  });
});

/**
 * 연타(더블탭) 경합 — 2026-09-04.
 * 스토리 좋아요는 실패하면 화면에 **에러 토스트까지** 떴다("잠시 후 다시 시도해주세요").
 * 이웃 추가는 알림이 두 번 갈 수 있었다 — `refKey` 가 유니크가 아니라 DB 가 안 막아 준다.
 */
describe('★ 연타에도 에러가 없고 카운트·알림이 안 어긋난다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  async function makeStory() {
    const r = await request.post('/api/stories').set('Authorization', `Bearer ${a1}`)
      .send({ caption: '연타 대상', visibility: 'PUBLIC' });
    return r.body.id as number;
  }

  it('스토리 좋아요를 동시에 10번 눌러도 4xx·5xx 가 없다', async () => {
    const id = await makeStory();
    const res = await Promise.all(Array.from({ length: 10 }, () =>
      request.post(`/api/stories/${id}/like`).set('Authorization', `Bearer ${a2}`)));
    const bad = res.filter(r => r.status !== 200).map(r => r.status);
    expect(bad, `연타가 에러로 떨어졌다: ${bad.join(',')}`).toHaveLength(0);
  });

  it('연타 뒤에도 스토리 likeCount 가 실제 행 수와 같다', async () => {
    const id = await makeStory();
    await Promise.all(Array.from({ length: 10 }, () =>
      request.post(`/api/stories/${id}/like`).set('Authorization', `Bearer ${a2}`)));
    const story = await testPrisma.story.findUnique({ where: { id }, select: { likeCount: true } });
    expect(story!.likeCount).toBe(await testPrisma.storyLike.count({ where: { storyId: id } }));
    expect(story!.likeCount).toBeLessThanOrEqual(1);
  });

  it('★ 이웃 추가를 동시에 20번 눌러도 이웃 1건 · 알림 1건', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () =>
      request.post('/api/follow/2').set('Authorization', `Bearer ${a1}`)));
    const bad = res.filter(r => r.status !== 200).map(r => r.status);
    expect(bad, `이웃 추가가 에러로 떨어졌다: ${bad.join(',')}`).toHaveLength(0);

    expect(await testPrisma.follow.count({ where: { followerId: 1, followingId: 2 } })).toBe(1);
    const notes = await testPrisma.notification.count({
      where: { userId: 2, type: 'NEIGHBOR_FOLLOW' },
    });
    expect(notes, `이웃 알림이 ${notes}건 갔다 — 멱등이 깨졌다`).toBe(1);
  });
});
