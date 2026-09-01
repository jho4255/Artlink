/**
 * 커뮤니티 게시판 — `routes/community.ts`
 *
 * 지켜야 하는 것:
 *  ① 글마다 실명/익명 선택 — **익명이면 신원이 통째로 가려진다**(역추적 방지)
 *  ② 좋아요·댓글 수가 비정규화 카운트로 정확히 유지된다(랭킹의 근거)
 *  ③ 삭제는 작성자 또는 Admin 만
 *  ④ 읽기는 공개, 쓰기는 로그인
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

const createPost = (tok: string, body: any = {}) =>
  request.post('/api/community').set('Authorization', `Bearer ${tok}`)
    .send({ title: '제목', body: '본문입니다', ...body });

describe('작성·읽기', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('로그인해야 쓸 수 있다', async () => {
    expect((await request.post('/api/community').send({ title: 'x', body: 'y' })).status).toBe(401);
  });

  it('제목·본문이 비면 400', async () => {
    expect((await createPost(a1, { title: '  ' })).status).toBe(400);
    expect((await createPost(a1, { body: '' })).status).toBe(400);
  });

  it('목록·상세는 비로그인도 볼 수 있다', async () => {
    const { body: { id } } = await createPost(a1);
    expect((await request.get('/api/community')).status).toBe(200);
    expect((await request.get(`/api/community/${id}`)).status).toBe(200);
  });

  it('★ 내 글 / 내 댓글단 글 필터', async () => {
    const { body: mineP } = await createPost(a1, { title: '내가 쓴 글' });
    const { body: othersP } = await createPost(a2, { title: '남이 쓴 글' });
    await request.post(`/api/community/${othersP.id}/comments`).set('Authorization', `Bearer ${a1}`).send({ body: '댓글' });

    const myPosts = await request.get('/api/community?mine=posts').set('Authorization', `Bearer ${a1}`);
    expect(myPosts.body.posts.map((p: any) => p.id)).toEqual([mineP.id]);

    const commented = await request.get('/api/community?mine=comments').set('Authorization', `Bearer ${a1}`);
    expect(commented.body.posts.map((p: any) => p.id)).toEqual([othersP.id]);

    // 비로그인은 빈 목록
    expect((await request.get('/api/community?mine=posts')).body.posts.length).toBe(0);
  });

  it('★ 실명 글은 닉네임·역할이 보인다', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { nickname: '작가닉' } });
    const { body: { id } } = await createPost(a1, { anonymous: false });
    const r = await request.get(`/api/community/${id}`);
    expect(r.body.author.name).toBe('작가닉');
    expect(r.body.author.role).toBe('ARTIST');
    expect(r.body.author.anonymous).toBe(false);
    expect(r.body.author.id).toBe(1);
  });

  it('★ 익명 글은 신원이 통째로 가려진다 (id·닉네임·아바타·역할 없음)', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { nickname: '작가닉' } });
    const { body: { id } } = await createPost(a1, { anonymous: true });
    const r = await request.get(`/api/community/${id}`);   // 남이 보면
    expect(r.body.author.id).toBeNull();
    expect(r.body.author.name).toBe('익명');
    expect(r.body.author.role).toBeNull();
    expect(r.body.author.anonymous).toBe(true);
    expect(JSON.stringify(r.body.author)).not.toContain('작가닉');
  });

  it('★ 익명 글도 본인에게는 (나) 로 표시돼 삭제 맥락을 준다', async () => {
    const { body: { id } } = await createPost(a1, { anonymous: true });
    const r = await request.get(`/api/community/${id}`).set('Authorization', `Bearer ${a1}`);
    expect(r.body.author.name).toBe('익명(나)');
    expect(r.body.author.mine).toBe(true);
  });
});

describe('사진 첨부·조회수', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 우리 저장소 사진만 첨부되고, 외부 URL 은 걸러진다', async () => {
    const { body: { id } } = await createPost(a1, {
      images: ['/uploads/a.jpg', 'https://evil.com/track.gif', 'javascript:alert(1)', '/uploads/b.jpg'],
    });
    const r = await request.get(`/api/community/${id}`);
    expect(r.body.images).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
  });

  it('목록에 썸네일(첫 사진)·사진 수가 내려온다', async () => {
    const { body: { id } } = await createPost(a1, { images: ['/uploads/x.jpg', '/uploads/y.jpg'] });
    const list = await request.get('/api/community');
    const row = list.body.posts.find((p: any) => p.id === id);
    expect(row.thumbnail).toBe('/uploads/x.jpg');
    expect(row.imageCount).toBe(2);
  });

  it('★ 조회수는 남이 볼 때만 오른다 (작성자 본인 조회는 안 센다)', async () => {
    const { body: { id } } = await createPost(a1);
    // 작성자 본인 조회 → 그대로 0
    expect((await request.get(`/api/community/${id}`).set('Authorization', `Bearer ${a1}`)).body.viewCount).toBe(0);
    // 남이 두 번 조회 → 2
    await request.get(`/api/community/${id}`).set('Authorization', `Bearer ${a2}`);
    const r = await request.get(`/api/community/${id}`);   // 비로그인도 카운트
    expect(r.body.viewCount).toBe(2);
  });
});

describe('좋아요·인기글', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 좋아요는 토글이고 카운트가 정확히 오르내린다', async () => {
    const { body: { id } } = await createPost(a1);
    const like = () => request.post(`/api/community/${id}/like`).set('Authorization', `Bearer ${a2}`);
    let r = await like(); expect(r.body).toEqual({ liked: true, likeCount: 1 });
    r = await like(); expect(r.body).toEqual({ liked: false, likeCount: 0 });
  });

  it('같은 사람이 두 번 눌러도 2가 되지 않는다', async () => {
    const { body: { id } } = await createPost(a1);
    await request.post(`/api/community/${id}/like`).set('Authorization', `Bearer ${a2}`);
    const r = await request.get(`/api/community/${id}`);
    expect(r.body.likeCount).toBe(1);
  });

  it('상세에 내 좋아요 상태(liked)가 내려온다', async () => {
    const { body: { id } } = await createPost(a1);
    await request.post(`/api/community/${id}/like`).set('Authorization', `Bearer ${a2}`);
    const mine = await request.get(`/api/community/${id}`).set('Authorization', `Bearer ${a2}`);
    expect(mine.body.liked).toBe(true);
    const other = await request.get(`/api/community/${id}`).set('Authorization', `Bearer ${a1}`);
    expect(other.body.liked).toBe(false);
  });

  it('★ 인기글은 좋아요 많은 순', async () => {
    const p1 = (await createPost(a1, { title: '인기없음' })).body.id;
    const p2 = (await createPost(a1, { title: '인기많음' })).body.id;
    for (const tok of [a2, gallery, admin]) await request.post(`/api/community/${p2}/like`).set('Authorization', `Bearer ${tok}`);
    await request.post(`/api/community/${p1}/like`).set('Authorization', `Bearer ${a2}`);
    const r = await request.get('/api/community/popular?limit=5');
    expect(r.body[0].title).toBe('인기많음');
    expect(r.body[0].likeCount).toBe(3);
    expect(r.body[0].author).toBeDefined();
  });
});

describe('댓글', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 댓글을 달면 commentCount 가 오르고, 삭제하면 내린다', async () => {
    const { body: { id } } = await createPost(a1);
    const c = await request.post(`/api/community/${id}/comments`).set('Authorization', `Bearer ${a2}`).send({ body: '좋은 글이네요' });
    expect(c.status).toBe(201);
    expect((await request.get(`/api/community/${id}`)).body.commentCount).toBe(1);

    await request.delete(`/api/community/${id}/comments/${c.body.id}`).set('Authorization', `Bearer ${a2}`);
    expect((await request.get(`/api/community/${id}`)).body.commentCount).toBe(0);
  });

  it('익명 댓글도 신원이 가려진다', async () => {
    const { body: { id } } = await createPost(a1);
    await request.post(`/api/community/${id}/comments`).set('Authorization', `Bearer ${a2}`).send({ body: '익명 댓글', anonymous: true });
    const r = await request.get(`/api/community/${id}`);
    expect(r.body.comments[0].author.id).toBeNull();
    expect(r.body.comments[0].author.name).toBe('익명');
  });

  it('남의 댓글은 못 지운다 (Admin 은 가능)', async () => {
    const { body: { id } } = await createPost(a1);
    const c = await request.post(`/api/community/${id}/comments`).set('Authorization', `Bearer ${a2}`).send({ body: 'x' });
    expect((await request.delete(`/api/community/${id}/comments/${c.body.id}`).set('Authorization', `Bearer ${gallery}`)).status).toBe(403);
    expect((await request.delete(`/api/community/${id}/comments/${c.body.id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
  });
});

describe('삭제 권한', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('작성자는 지울 수 있다', async () => {
    const { body: { id } } = await createPost(a1);
    expect((await request.delete(`/api/community/${id}`).set('Authorization', `Bearer ${a1}`)).status).toBe(200);
  });
  it('남은 못 지운다', async () => {
    const { body: { id } } = await createPost(a1);
    expect((await request.delete(`/api/community/${id}`).set('Authorization', `Bearer ${a2}`)).status).toBe(403);
  });
  it('Admin 은 지울 수 있다 (모더레이션)', async () => {
    const { body: { id } } = await createPost(a1);
    expect((await request.delete(`/api/community/${id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
  });
  it('글을 지우면 댓글·좋아요도 함께 사라진다 (cascade)', async () => {
    const { body: { id } } = await createPost(a1);
    await request.post(`/api/community/${id}/comments`).set('Authorization', `Bearer ${a2}`).send({ body: 'x' });
    await request.post(`/api/community/${id}/like`).set('Authorization', `Bearer ${a2}`);
    await request.delete(`/api/community/${id}`).set('Authorization', `Bearer ${a1}`);
    expect(await testPrisma.postComment.count()).toBe(0);
    expect(await testPrisma.postLike.count()).toBe(0);
  });
});
