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

// ══ 탭(말머리) · 공지 · 고정 — 전부 Admin 전용 (2026-09-04) ═══════════════
// ⚠️ 화면에서 감추는 것은 권한이 아니다. 여기서 잠그는 건 **서버가 role 로 막는가** 하나다.
describe('탭 — Admin 만 만들고 고친다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const mkTab = (tok: string, name = '자유') =>
    request.post('/api/community/categories').set('Authorization', `Bearer ${tok}`).send({ name });

  it('작가·갤러리는 탭을 만들 수 없다 (403)', async () => {
    expect((await mkTab(a1)).status).toBe(403);
    expect((await mkTab(gallery)).status).toBe(403);
  });

  it('비로그인은 401', async () => {
    expect((await request.post('/api/community/categories').send({ name: '자유' })).status).toBe(401);
  });

  it('Admin 은 만들 수 있고, 목록은 누구나 읽는다', async () => {
    const r = await mkTab(admin, '작가 모집');
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('작가 모집');
    expect(r.body.slug).toBeTruthy();          // 한글 이름이어도 안정적인 키가 생긴다
    const list = await request.get('/api/community/categories');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('같은 이름은 409', async () => {
    await mkTab(admin, '자유');
    expect((await mkTab(admin, '자유')).status).toBe(409);
  });

  it('꺼진 탭은 일반 사용자에게 안 보이고 Admin 에게는 보인다 (다시 켜야 하므로)', async () => {
    const { body: tab } = await mkTab(admin, '숨김탭');
    await request.patch(`/api/community/categories/${tab.id}`).set('Authorization', `Bearer ${admin}`).send({ active: false });
    expect((await request.get('/api/community/categories')).body).toHaveLength(0);
    const asAdmin = await request.get('/api/community/categories').set('Authorization', `Bearer ${admin}`);
    expect(asAdmin.body).toHaveLength(1);
    expect(asAdmin.body[0].active).toBe(false);
  });

  it('⚠️ 탭을 지워도 **글은 안 지운다** — 미분류로 내려온다', async () => {
    const { body: tab } = await mkTab(admin, '자유');
    const { body: post } = await createPost(a1, { categoryId: tab.id });
    const del = await request.delete(`/api/community/categories/${tab.id}`).set('Authorization', `Bearer ${admin}`);
    expect(del.status).toBe(200);
    expect(del.body.movedToUncategorized).toBe(1);
    const row = await testPrisma.post.findUnique({ where: { id: post.id } });
    expect(row).not.toBeNull();               // 글은 살아 있다
    expect(row!.categoryId).toBeNull();       // 미분류로 내려왔다
  });

  it('탭으로 목록을 거른다 (?category=slug), 지워진 탭 slug 는 빈 목록', async () => {
    const { body: tab } = await mkTab(admin, '자유');
    await createPost(a1, { categoryId: tab.id, title: '탭글' });
    await createPost(a1, { title: '미분류글' });
    const inTab = await request.get(`/api/community?category=${tab.slug}`);
    expect(inTab.body.posts.map((p: any) => p.title)).toEqual(['탭글']);
    const none = await request.get('/api/community?category=none');
    expect(none.body.posts.map((p: any) => p.title)).toEqual(['미분류글']);
    // ⚠️ 없는 탭이면 전체가 쏟아지면 안 된다(옛 링크로 들어와도)
    expect((await request.get('/api/community?category=zzz-없는탭')).body.posts).toHaveLength(0);
  });
});

describe('공지 · 고정 — Admin 만', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('⚠️ 작가가 notice/pinned 를 보내도 **무시된다** (클라이언트를 믿지 않는다)', async () => {
    const { body } = await createPost(a1, { notice: true, pinned: true });
    const row = await testPrisma.post.findUnique({ where: { id: body.id } });
    expect(row!.notice).toBe(false);
    expect(row!.pinnedAt).toBeNull();
  });

  it('Admin 이 쓰면 공지·고정이 붙는다', async () => {
    const { body } = await createPost(admin, { notice: true, pinned: true });
    const row = await testPrisma.post.findUnique({ where: { id: body.id } });
    expect(row!.notice).toBe(true);
    expect(row!.pinnedAt).not.toBeNull();
  });

  it('공지는 익명일 수 없다 — 누가 공지했는지 모르면 공지가 아니다', async () => {
    const { body } = await createPost(admin, { notice: true, anonymous: true });
    const row = await testPrisma.post.findUnique({ where: { id: body.id } });
    expect(row!.anonymous).toBe(false);
  });

  it('고정 토글은 Admin 만 (작가는 403)', async () => {
    const { body } = await createPost(a1);
    expect((await request.patch(`/api/community/${body.id}/pin`).set('Authorization', `Bearer ${a1}`).send({ pinned: true })).status).toBe(403);
    const ok = await request.patch(`/api/community/${body.id}/pin`).set('Authorization', `Bearer ${admin}`).send({ pinned: true });
    expect(ok.status).toBe(200);
    expect(ok.body.pinned).toBe(true);
  });

  it('공지 토글도 Admin 만', async () => {
    const { body } = await createPost(a1);
    expect((await request.patch(`/api/community/${body.id}/notice`).set('Authorization', `Bearer ${a2}`).send({ notice: true })).status).toBe(403);
    const ok = await request.patch(`/api/community/${body.id}/notice`).set('Authorization', `Bearer ${admin}`).send({ notice: true });
    expect(ok.body.notice).toBe(true);
  });

  it('⚠️ 고정 글이 목록 맨 위로 온다 — Postgres 는 DESC 에서 NULL 을 먼저 놓으므로 nulls:last 가 필수', async () => {
    await createPost(a1, { title: '오래된 글' });
    await createPost(a1, { title: '최신 글' });
    const { body: old } = await request.get('/api/community');
    expect(old.posts[0].title).toBe('최신 글');           // 기본은 최신순

    const target = old.posts[1].id;                       // '오래된 글' 을 고정
    await request.patch(`/api/community/${target}/pin`).set('Authorization', `Bearer ${admin}`).send({ pinned: true });
    const { body: after } = await request.get('/api/community');
    expect(after.posts[0].title).toBe('오래된 글');
    expect(after.posts[0].pinned).toBe(true);
  });

  it('⚠️ 내 글/내 댓글 필터에서는 고정을 적용하지 않는다 (내 활동 목록에 남의 고정이 끼면 안 된다)', async () => {
    const { body: mineOld } = await createPost(a1, { title: '내 오래된 글' });
    await createPost(a1, { title: '내 최신 글' });
    await request.patch(`/api/community/${mineOld.id}/pin`).set('Authorization', `Bearer ${admin}`).send({ pinned: true });
    const r = await request.get('/api/community?mine=posts').set('Authorization', `Bearer ${a1}`);
    expect(r.body.posts[0].title).toBe('내 최신 글');
  });

  it('탭 옮기기도 Admin 만', async () => {
    const { body: tab } = await request.post('/api/community/categories').set('Authorization', `Bearer ${admin}`).send({ name: '자유' });
    const { body: post } = await createPost(a1);
    expect((await request.patch(`/api/community/${post.id}/category`).set('Authorization', `Bearer ${a1}`).send({ categoryId: tab.id })).status).toBe(403);
    const ok = await request.patch(`/api/community/${post.id}/category`).set('Authorization', `Bearer ${admin}`).send({ categoryId: tab.id });
    expect(ok.body.category.name).toBe('자유');
  });
});

// ══ 탭별 쓰기 제한 — 공지 탭처럼 Admin 만 쓰게 (2026-09-04) ═══════════════
describe('쓰기 제한 탭', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const mkLockedTab = async (name = '공지') => {
    const r = await request.post('/api/community/categories')
      .set('Authorization', `Bearer ${admin}`).send({ name, writeAdminOnly: true });
    return r.body;
  };

  it('Admin 은 쓰기 제한 탭을 만들 수 있다', async () => {
    const tab = await mkLockedTab();
    expect(tab.writeAdminOnly).toBe(true);
  });

  it('⚠️ 작가·갤러리는 그 탭에 글을 못 쓴다 (403) — 조용히 미분류로 옮기지 않는다', async () => {
    const tab = await mkLockedTab();
    const r = await createPost(a1, { categoryId: tab.id });
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('관리자만');
    expect(await testPrisma.post.count()).toBe(0);   // 글이 만들어지지도 않았다
  });

  it('Admin 은 쓸 수 있다', async () => {
    const tab = await mkLockedTab();
    const r = await createPost(admin, { categoryId: tab.id, notice: true });
    expect(r.status).toBe(201);
    const row = await testPrisma.post.findUnique({ where: { id: r.body.id } });
    expect(row!.categoryId).toBe(tab.id);
  });

  it('제한을 풀면 누구나 쓸 수 있다 (되돌릴 수 있어야 한다)', async () => {
    const tab = await mkLockedTab();
    await request.patch(`/api/community/categories/${tab.id}`)
      .set('Authorization', `Bearer ${admin}`).send({ writeAdminOnly: false });
    expect((await createPost(a1, { categoryId: tab.id })).status).toBe(201);
  });

  it('제한 탭도 **읽기는 공개** — 목록·탭 목록에 그대로 나온다', async () => {
    const tab = await mkLockedTab();
    await createPost(admin, { categoryId: tab.id, title: '공지사항' });
    const cats = await request.get('/api/community/categories');
    expect(cats.body.find((c: any) => c.id === tab.id)?.writeAdminOnly).toBe(true);
    const list = await request.get(`/api/community?category=${tab.slug}`);
    expect(list.body.posts.map((p: any) => p.title)).toEqual(['공지사항']);
  });

  it('제한 탭이 아니면 예전처럼 누구나 쓴다 (기본값 false — 동작이 안 바뀐다)', async () => {
    const { body: free } = await request.post('/api/community/categories')
      .set('Authorization', `Bearer ${admin}`).send({ name: '자유' });
    expect(free.writeAdminOnly).toBe(false);
    expect((await createPost(a1, { categoryId: free.id })).status).toBe(201);
  });
});

/**
 * 좋아요 연타(더블탭) — 2026-09-04.
 *
 * 예전엔 `findUnique` 로 있나 본 뒤 `create` 했는데 그 확인이 트랜잭션 밖이라,
 * 동시에 두 번 누르면 둘 다 "없음"을 보고 들어가 unique 위반으로 떨어졌다
 * (실측 동시 10회에 200 1건 + **400 9건**). 화면은 낙관적 갱신이 조용히 롤백돼
 * "눌렀는데 안 눌림"이 됐다.
 */
describe('★ 좋아요 연타에도 에러가 없고 카운트가 안 어긋난다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const like = (id: number, tok: string) =>
    request.post(`/api/community/${id}/like`).set('Authorization', `Bearer ${tok}`);

  async function makePost() {
    const r = await request.post('/api/community').set('Authorization', `Bearer ${a1}`)
      .send({ title: '연타 대상', body: '본문', anonymous: false });
    return r.body.id as number;
  }

  it('같은 사람이 동시에 10번 눌러도 4xx·5xx 가 없다', async () => {
    const id = await makePost();
    const res = await Promise.all(Array.from({ length: 10 }, () => like(id, a2)));
    const bad = res.filter(r => r.status !== 200).map(r => r.status);
    expect(bad, `연타가 에러로 떨어졌다: ${bad.join(',')}`).toHaveLength(0);
  });

  it('연타 뒤에도 likeCount 가 실제 행 수와 같다 (드리프트 없음)', async () => {
    const id = await makePost();
    await Promise.all(Array.from({ length: 10 }, () => like(id, a2)));

    const post = await testPrisma.post.findUnique({ where: { id }, select: { likeCount: true } });
    const rows = await testPrisma.postLike.count({ where: { postId: id } });
    expect(post!.likeCount).toBe(rows);
    expect(post!.likeCount).toBeLessThanOrEqual(1);
    expect(post!.likeCount).toBeGreaterThanOrEqual(0);
  });

  it('여러 사람이 동시에 눌러도 정확히 사람 수만큼 오른다', async () => {
    const id = await makePost();
    const people = [a2, gallery, admin];
    const res = await Promise.all(people.map(t => like(id, t)));
    expect(res.every(r => r.status === 200)).toBe(true);

    const post = await testPrisma.post.findUnique({ where: { id }, select: { likeCount: true } });
    expect(post!.likeCount).toBe(3);
    expect(await testPrisma.postLike.count({ where: { postId: id } })).toBe(3);
  });

  it('토글은 그대로 동작한다 — 켜고 끄면 0 으로 돌아온다', async () => {
    const id = await makePost();
    const on = await like(id, a2);
    expect(on.body).toMatchObject({ liked: true, likeCount: 1 });
    const off = await like(id, a2);
    expect(off.body).toMatchObject({ liked: false, likeCount: 0 });
    expect(await testPrisma.postLike.count({ where: { postId: id } })).toBe(0);
  });
});

/**
 * 글 수정 — 커밋된 코드가 **컴파일조차 안 됐다**(`content` 라는 없는 필드에 쓰고,
 * 없는 함수 `serializePost` 를 불렀다). 화면에도 모달이 없어 [✏️]가 아무 일도 안 했다.
 * 앞뒤가 다 끊겨 있어 아무도 못 알아챘으므로 여기서 못 박는다.
 */
describe('글 수정 (PATCH /:id)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 본문이 실제로 바뀐다 (옛 코드는 `content` 를 읽어 본문이 영영 안 바뀌었다)', async () => {
    const p = await createPost(a1, { title: '원래 제목', body: '원래 본문' });
    const r = await request.patch(`/api/community/${p.body.id}`)
      .set('Authorization', `Bearer ${a1}`).send({ title: '새 제목', body: '새 본문' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: '새 제목', body: '새 본문' });
    expect((await request.get(`/api/community/${p.body.id}`)).body.body).toBe('새 본문');
  });

  it('★ 사진은 지워지지 않는다 — 수정 폼이 사진을 안 보내기 때문', async () => {
    // `createSchema` 가 `images` 를 `[]` 로 채워 주므로 그대로 쓰면 고칠 때마다 사진이 사라진다
    const p = await createPost(a1, { images: ['/uploads/a.png', '/uploads/b.png'] });
    await request.patch(`/api/community/${p.body.id}`)
      .set('Authorization', `Bearer ${a1}`).send({ title: '제목', body: '고친 본문' });
    expect((await request.get(`/api/community/${p.body.id}`)).body.images).toEqual(['/uploads/a.png', '/uploads/b.png']);
  });

  it('남의 글은 못 고친다 (Admin 도 — 삭제와 달리 수정은 작성자만)', async () => {
    const p = await createPost(a1);
    expect((await request.patch(`/api/community/${p.body.id}`).set('Authorization', `Bearer ${a2}`).send({ title: 'x', body: 'y' })).status).toBe(403);
    expect((await request.patch(`/api/community/${p.body.id}`).set('Authorization', `Bearer ${admin}`).send({ title: 'x', body: 'y' })).status).toBe(403);
  });

  it('익명 여부를 바꿀 수 있다', async () => {
    const p = await createPost(a1, { anonymous: false });
    const r = await request.patch(`/api/community/${p.body.id}`)
      .set('Authorization', `Bearer ${a1}`).send({ title: '제목', body: '본문', anonymous: true });
    expect(r.body.author.id).toBeNull();      // 신원이 가려진다
  });
});

describe('★ 익명은 운영도 벗길 수 없다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 남의 익명 글은 공지로 지정할 수 없다 (400)', async () => {
    // 예전엔 공지로 올리면서 `anonymous:false` 를 강제해, 관리자가 남의 익명 글을 공지로
    // 만드는 순간 작성자 신원이 **영구히** 드러났다(공지를 풀어도 안 돌아왔다).
    const p = await createPost(a1, { anonymous: true });
    const r = await request.patch(`/api/community/${p.body.id}/notice`)
      .set('Authorization', `Bearer ${admin}`).send({ notice: true });
    expect(r.status).toBe(400);
    expect((await request.get(`/api/community/${p.body.id}`)).body.author.id).toBeNull();  // 여전히 익명
  });

  it('★ 자기 익명 글은 자기가 풀 수 있다 (Admin 이 자기 글을 공지로)', async () => {
    const p = await createPost(admin, { anonymous: true });
    expect((await request.patch(`/api/community/${p.body.id}/notice`).set('Authorization', `Bearer ${admin}`).send({ notice: true })).status).toBe(200);
    expect((await request.get(`/api/community/${p.body.id}`)).body.author.id).toBe(4);   // 익명이 풀렸다
  });

  it('실명 글은 공지로 지정된다', async () => {
    const p = await createPost(a1, { anonymous: false });
    expect((await request.patch(`/api/community/${p.body.id}/notice`).set('Authorization', `Bearer ${admin}`).send({ notice: true })).status).toBe(200);
  });
});

describe('숨긴 탭 — 조용히 미분류로 내리지 않는다', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 일반 사용자가 숨긴 탭에 쓰면 403 (미분류로 옮기면 어디 올렸는지 어긋난다)', async () => {
    const c = await request.post('/api/community/categories').set('Authorization', `Bearer ${admin}`).send({ name: '숨김탭' });
    await request.patch(`/api/community/categories/${c.body.id}`).set('Authorization', `Bearer ${admin}`).send({ active: false });
    const r = await createPost(a1, { categoryId: c.body.id });
    expect(r.status).toBe(403);
  });

  it('Admin 은 숨긴 탭에도 쓸 수 있다 (공개 전에 미리 채워 두는 용도)', async () => {
    const c = await request.post('/api/community/categories').set('Authorization', `Bearer ${admin}`).send({ name: '숨김탭' });
    await request.patch(`/api/community/categories/${c.body.id}`).set('Authorization', `Bearer ${admin}`).send({ active: false });
    const r = await createPost(admin, { categoryId: c.body.id });
    expect(r.status).toBe(201);
    // 작성 응답엔 탭이 없다 — 상세로 확인한다
    expect((await request.get(`/api/community/${r.body.id}`)).body.category?.id).toBe(c.body.id);
  });
});
