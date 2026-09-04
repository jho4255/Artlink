/**
 * @멘션 권한 + 하이라이트 — 둘 다 **조용히 틀리는** 종류라 테스트로 못 박는다.
 *
 * 멘션 규칙은 둘뿐이다.
 *   ① **ArtLink**(운영) — 누구나 부를 수 있다
 *   ② 그 밖에는 **서로 이웃**만. 한쪽만 팔로우한 사이는 못 부른다.
 * ⚠️ 자동완성(`GET /api/mentions`)과 저장 검증이 **같은 판정**이어야 한다 —
 *    목록에 띄워 놓고 저장에서 막으면 함정이고, 반대면 규칙이 조용히 무너진다.
 *
 * 하이라이트 커버는 **사진이 나올 때까지 훑어야** 한다. 스토리는 글만 있어도 되므로
 * 맨 앞이 글뿐이면 뒤에 사진이 멀쩡히 있는데도 이니셜로 떨어졌다(실제 신고).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');

const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const follow = (tok: string, id: number) => request.post(`/api/follow/${id}`).set(auth(tok));
/** 1 ↔ 2 를 서로 이웃으로 */
const makeMutual = async () => { await follow(a1, 2); await follow(a2, 1); };

const makeStory = (tok: string, body: any = {}) =>
  request.post('/api/stories').set(auth(tok)).send({ caption: '작업 중', ...body });

describe('멘션 자동완성 (GET /api/mentions)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('로그인해야 쓸 수 있다', async () => {
    expect((await request.get('/api/mentions')).status).toBe(401);
  });

  it('★ 이웃이 하나도 없어도 ArtLink 는 뜬다 — 누구나 부를 수 있는 창구다', async () => {
    const r = await request.get('/api/mentions').set(auth(a1));
    expect(r.status).toBe(200);
    expect(r.body.map((t: any) => t.label)).toEqual(['ArtLink']);
    expect(r.body[0]).toMatchObject({ id: null, role: 'ADMIN' });   // 사람이 아니라 브랜드
  });

  it('★ 단방향 팔로우는 안 뜬다 — 서로 이웃이어야 한다', async () => {
    await follow(a1, 2);                                            // 1 → 2 만
    const r = await request.get('/api/mentions').set(auth(a1));
    expect(r.body.map((t: any) => t.label)).toEqual(['ArtLink']);
  });

  it('서로 이웃이면 뜬다', async () => {
    await makeMutual();
    const r = await request.get('/api/mentions').set(auth(a1));
    expect(r.body.map((t: any) => t.label).sort()).toEqual(['ArtLink', 'Artist 2']);
  });

  it('역할을 가리지 않는다 — 작가↔갤러리도 서로 이웃이면 부를 수 있다', async () => {
    await follow(a1, 3); await follow(gallery, 1);
    const r = await request.get('/api/mentions').set(auth(a1));
    expect(r.body.map((t: any) => t.label)).toContain('Gallery Owner');
  });

  it('검색어로 거른다 (대소문자 무관)', async () => {
    await makeMutual();
    const r = await request.get('/api/mentions?q=artl').set(auth(a1));
    expect(r.body.map((t: any) => t.label)).toEqual(['ArtLink']);
  });

  it('★ 이름에 공백이 있어도 검색된다 (시드 계정이 전부 그렇다)', async () => {
    await makeMutual();
    const r = await request.get('/api/mentions?q=Artist 2').set(auth(a1));
    expect(r.body.map((t: any) => t.label)).toEqual(['Artist 2']);
  });
});

describe('멘션 알림 — 부를 수 있는 사람에게만 간다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const notifsOf = (userId: number) =>
    testPrisma.notification.findMany({ where: { userId, type: 'MENTION' } });

  it('★ 서로 이웃이 아니면 알림이 가지 않는다 (아무나 태그 금지)', async () => {
    await follow(a1, 2);                                            // 단방향
    await makeStory(a1, { caption: '@Artist 2 안녕' });
    expect(await notifsOf(2)).toHaveLength(0);
  });

  it('서로 이웃이면 알림이 간다', async () => {
    await makeMutual();
    await makeStory(a1, { caption: '@Artist 2 안녕' });
    expect(await notifsOf(2)).toHaveLength(1);
  });

  it('★ ArtLink 는 이웃이 아니어도 운영자에게 알림이 간다', async () => {
    await makeStory(a1, { caption: '@ArtLink 문의드립니다' });
    expect(await notifsOf(4)).toHaveLength(1);                      // id 4 = Admin
  });

  it('★ 글을 고치지 않는다 — 못 부르는 이름도 쓴 그대로 남는다', async () => {
    // 예전엔 못 찾은 멘션의 `@` 를 떼어 저장했다(사용자가 쓴 것과 다른 글이 올라갔다)
    const r = await makeStory(a1, { caption: '@없는사람 에게 @ArtLink' });
    expect(r.body.caption).toBe('@없는사람 에게 @ArtLink');
  });

  it('같은 사람을 여러 번 불러도 알림은 한 건', async () => {
    await makeMutual();
    await makeStory(a1, { caption: '@Artist 2 @Artist 2 @Artist 2' });
    expect(await notifsOf(2)).toHaveLength(1);
  });

  it('자기 자신을 불러도 알림이 오지 않는다', async () => {
    await makeStory(a1, { caption: '@Artist 1 혼잣말' });
    expect(await notifsOf(1)).toHaveLength(0);
  });

  it('★ 긴 이름이 이긴다 — @Art 가 @ArtLink 를 가로채지 않는다', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { nickname: 'Art' } });
    await makeMutual();
    await makeStory(a1, { caption: '@ArtLink 님' });
    expect(await notifsOf(4)).toHaveLength(1);                      // 운영에게
    expect(await notifsOf(2)).toHaveLength(0);                      // 'Art' 에게는 아님
  });

  it('댓글에서도 같은 규칙이 적용된다', async () => {
    await makeMutual();
    const s = await makeStory(a2);
    await request.post(`/api/stories/${s.body.id}/comments`).set(auth(a1)).send({ body: '@ArtLink 확인 부탁드려요' });
    expect(await notifsOf(4)).toHaveLength(1);
  });

  it('★ 댓글 알림과 멘션 알림이 겹치지 않는다 (글 주인을 부른 경우)', async () => {
    await makeMutual();
    const s = await makeStory(a2);
    await request.post(`/api/stories/${s.body.id}/comments`).set(auth(a1)).send({ body: '@Artist 2 좋아요' });
    // 한 번의 댓글로 두 통을 받으면 잔소리다 — 댓글 알림 하나만 간다
    expect(await notifsOf(2)).toHaveLength(0);
    expect(await testPrisma.notification.count({ where: { userId: 2, type: 'STORY_COMMENT' } })).toBe(1);
  });
});

describe('하이라이트 커버 사진', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const newHighlight = (tok: string, name: string, isPublic = true) =>
    request.post('/api/stories/highlights').set(auth(tok)).send({ name, isPublic });
  const addStory = (tok: string, hid: number, sid: number) =>
    request.post(`/api/stories/highlights/${hid}/stories/${sid}`).set(auth(tok));
  const listOf = (userId: number, tok?: string) => {
    const r = request.get(`/api/stories/highlights/${userId}`);
    return tok ? r.set(auth(tok)) : r;
  };

  it('담은 게 없으면 커버도 없다 (화면은 이니셜로 그린다)', async () => {
    const h = await newHighlight(a1, '작업실');
    const r = await listOf(1);
    expect(r.body[0]).toMatchObject({ id: h.body.id, coverImage: null, storyCount: 0 });
  });

  it('★ 맨 앞이 글뿐이면 다음 사진을 찾는다 (사용자 신고: "사진이 안 나온다")', async () => {
    const textOnly = await makeStory(a1, { caption: '글만 있는 소식', images: [] });
    const withPhoto = await makeStory(a1, { caption: '사진', images: ['/uploads/a.png'] });
    const h = await newHighlight(a1, '작업실');
    await addStory(a1, h.body.id, textOnly.body.id);      // 먼저 담긴 게 글뿐
    await addStory(a1, h.body.id, withPhoto.body.id);

    const r = await listOf(1);
    expect(r.body[0].coverImage).toBe('/uploads/a.png');
    expect(r.body[0].storyCount).toBe(2);
  });

  it('전부 글뿐이면 커버는 null', async () => {
    const s = await makeStory(a1, { images: [] });
    const h = await newHighlight(a1, '메모');
    await addStory(a1, h.body.id, s.body.id);
    expect((await listOf(1)).body[0].coverImage).toBeNull();
  });

  it('지정한 커버(coverStoryId)가 담은 순서보다 우선한다', async () => {
    const first = await makeStory(a1, { images: ['/uploads/first.png'] });
    const pick = await makeStory(a1, { images: ['/uploads/pick.png'] });
    const h = await newHighlight(a1, '작업실');
    await addStory(a1, h.body.id, first.body.id);
    await addStory(a1, h.body.id, pick.body.id);
    await request.patch(`/api/stories/highlights/${h.body.id}`).set(auth(a1)).send({ coverStoryId: pick.body.id });

    expect((await listOf(1)).body[0].coverImage).toBe('/uploads/pick.png');
  });

  it('★ 지운 스토리는 세지도, 커버로 쓰지도 않는다 (storyIds 에 id 만 남는다)', async () => {
    const gone = await makeStory(a1, { images: ['/uploads/gone.png'] });
    const alive = await makeStory(a1, { images: ['/uploads/alive.png'] });
    const h = await newHighlight(a1, '작업실');
    await addStory(a1, h.body.id, gone.body.id);
    await addStory(a1, h.body.id, alive.body.id);
    await request.delete(`/api/stories/${gone.body.id}`).set(auth(a1));

    const r = await listOf(1);
    expect(r.body[0].coverImage).toBe('/uploads/alive.png');
    expect(r.body[0].storyCount).toBe(1);
  });
});

describe('하이라이트 권한', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const newHighlight = (tok: string, name: string, isPublic = true) =>
    request.post('/api/stories/highlights').set(auth(tok)).send({ name, isPublic });

  it('비공개는 본인에게만 보인다', async () => {
    await newHighlight(a1, '비공개', false);
    await newHighlight(a1, '공개', true);
    expect((await request.get('/api/stories/highlights/1')).body.map((h: any) => h.name)).toEqual(['공개']);
    expect((await request.get('/api/stories/highlights/1').set(auth(a1))).body).toHaveLength(2);
  });

  it('★ 남의 하이라이트에 내 스토리를 담을 수 없다', async () => {
    const h = await newHighlight(a1, '작업실');
    const s = await makeStory(a2);
    expect((await request.post(`/api/stories/highlights/${h.body.id}/stories/${s.body.id}`).set(auth(a2))).status).toBe(403);
  });

  it('★ 내 하이라이트에 남의 스토리를 담을 수 없다', async () => {
    const h = await newHighlight(a1, '작업실');
    const s = await makeStory(a2);
    expect((await request.post(`/api/stories/highlights/${h.body.id}/stories/${s.body.id}`).set(auth(a1))).status).toBe(403);
  });

  it('같은 이름은 409', async () => {
    await newHighlight(a1, '작업실');
    expect((await newHighlight(a1, '작업실')).status).toBe(409);
  });
});

describe('운영(Admin)은 모두와 서로 이웃으로 친다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });
  const admin = authToken(4, 'ADMIN');

  it('★ 이웃을 맺지 않아도 전 회원을 부를 수 있다 (공지·중재)', async () => {
    const r = await request.get('/api/mentions').set(auth(admin));
    expect(r.status).toBe(200);
    const labels = r.body.map((t: any) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['Artist 1', 'Artist 2', 'Gallery Owner']));
  });

  it('운영끼리는 ArtLink 로 통한다 — 목록에 운영자 개인 이름은 없다', async () => {
    const labels = (await request.get('/api/mentions').set(auth(admin))).body.map((t: any) => t.label);
    expect(labels).not.toContain('Admin');
    expect(labels).toContain('ArtLink');
  });

  it('멘션하면 실제로 알림이 간다', async () => {
    await makeStory(admin, { caption: '@Artist 2 확인 부탁드립니다' });
    expect(await testPrisma.notification.count({ where: { userId: 2, type: 'MENTION' } })).toBe(1);
  });

  it('★ 표기는 하지 않는다 — Follow 행을 만들지 않고 이웃 목록도 그대로다', async () => {
    await request.get('/api/mentions').set(auth(admin));
    expect(await testPrisma.follow.count()).toBe(0);
    expect((await request.get('/api/follow/mutuals').set(auth(admin))).body).toEqual([]);
  });

  it('일반 사용자에게는 이 예외가 없다', async () => {
    const labels = (await request.get('/api/mentions').set(auth(a1))).body.map((t: any) => t.label);
    expect(labels).toEqual(['ArtLink']);
  });
});

describe('알림이 가리키는 소식 (GET /api/stories/:id)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });
  const admin = authToken(4, 'ADMIN');

  it('★ 멘션 알림은 그 소식으로 간다 (예전엔 그냥 /feed 였다)', async () => {
    await follow(a1, 2); await follow(a2, 1);
    const s = await makeStory(a1, { caption: '@Artist 2 봐주세요' });
    const n = await testPrisma.notification.findFirst({ where: { userId: 2, type: 'MENTION' } });
    expect(n?.linkUrl).toBe(`/feed?story=${s.body.id}`);
  });

  it('댓글 멘션은 댓글까지 펼친 채로 간다', async () => {
    await follow(a1, 2); await follow(a2, 1);
    const s = await makeStory(a2);
    const c = await request.post(`/api/stories/${s.body.id}/comments`).set(auth(a1)).send({ body: '@ArtLink 확인' });
    const n = await testPrisma.notification.findFirst({ where: { userId: 4, type: 'MENTION' } });
    expect(n?.linkUrl).toBe(`/feed?story=${s.body.id}&comment=${c.body.id}`);
  });

  it('★ 피드에 없어도 열린다 — 팔로우하지 않은 사람의 전체공개 글', async () => {
    const s = await makeStory(a1, { visibility: 'PUBLIC' });
    expect((await request.get(`/api/stories/${s.body.id}`).set(auth(a2))).status).toBe(200);
  });

  it('★ 이웃공개 글은 팔로워가 아니면 404 (403 은 존재를 알려준다)', async () => {
    const s = await makeStory(a1, { visibility: 'NEIGHBORS' });
    expect((await request.get(`/api/stories/${s.body.id}`).set(auth(a2))).status).toBe(404);
    await follow(a2, 1);
    expect((await request.get(`/api/stories/${s.body.id}`).set(auth(a2))).status).toBe(200);
  });

  it('작성자와 운영은 언제나 볼 수 있다', async () => {
    const s = await makeStory(a1, { visibility: 'NEIGHBORS' });
    expect((await request.get(`/api/stories/${s.body.id}`).set(auth(a1))).body.mine).toBe(true);
    expect((await request.get(`/api/stories/${s.body.id}`).set(auth(admin))).status).toBe(200);
  });

  it('★ /feed 가 `/:id` 에 잡히지 않는다 (라우트 순서)', async () => {
    // `/:id` 를 위로 올리면 `parseInt('feed')=NaN` 으로 404 가 나고 원인이 안 보인다
    expect((await request.get('/api/stories/feed').set(auth(a1))).status).toBe(200);
  });
});
