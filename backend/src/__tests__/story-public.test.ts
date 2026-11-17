/**
 * ArtStory 홈 공개 (2026-11-14, CLAUDE.md 규칙 81) — `routes/story.ts`
 *
 * 지켜야 하는 것:
 *  ① 전체공개 소식은 **로그인 없이도** 보인다(홈 줄·전체 보기). 이웃공개·내린 소식·탈퇴한 사람 것은 안 보인다
 *  ② 홈 줄은 **한 사람당 가장 새 소식 하나**, 최신순
 *  ③ 기본 공개범위는 전체공개(그 전엔 이웃공개). 글만 소식은 바탕색을 저장한다
 *  ④ 하루 10개 — 동시에 보내도 넘지 않는다
 *  ⑤ 신고: 내 소식 불가 · 한 번만 · 신고한 사람 화면에서 곧바로 빠짐 · 서로 다른 3명이면 저절로 내림(알림은 한 번)
 *  ⑥ 내린 소식은 주인·관리자 말고 404(상세·댓글·좋아요·명단 모두) · 관리자가 되살리면 그 뒤 신고만 센다
 *  ⑦ 그만 보기 — 내 화면에서만 빠진다
 *  ⑧ 좋아요 알림 — 소식마다 한 줄로 합치고, 동시에 눌러도 한 줄
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';
import { getSeoFields, clearSeoCache } from '../lib/seoMeta';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const post = (tok: string, body: Record<string, unknown> = {}) =>
  request.post('/api/stories').set(auth(tok)).send({ caption: '작업 중', ...body });

/** 바로 DB 에 — 하루 10개 상한을 건너 여러 개를 만들 때 */
async function rawStory(authorId: number, data: Partial<{ caption: string; images: string[]; visibility: string; createdAt: Date; hiddenAt: Date | null }> = {}) {
  return testPrisma.story.create({ data: { authorId, caption: data.caption ?? '소식', images: data.images ?? [], visibility: data.visibility ?? 'PUBLIC', createdAt: data.createdAt, hiddenAt: data.hiddenAt ?? null } });
}

/** 신고·좋아요에 쓸 사람을 더 만든다(id 101부터) */
async function extraUsers(n: number): Promise<string[]> {
  const toks: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await testPrisma.user.create({ data: { email: `viewer${i}@test.com`, name: `보는이${i}`, role: 'VISITOR' } });
    toks.push(authToken(u.id, 'VISITOR'));
  }
  return toks;
}

describe('ArtStory 공개 목록', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 기본 공개범위는 전체공개 — 로그인 없이 [전체 보기]에 보인다', async () => {
    const r = await post(a1, { caption: '기본값' });
    expect(r.status).toBe(201);
    expect(r.body.visibility).toBe('PUBLIC');
    const list = await request.get('/api/stories/public');
    expect(list.status).toBe(200);
    expect(list.body.stories.map((s: any) => s.caption)).toEqual(['기본값']);
  });

  it('★ 이웃공개·내린 소식·탈퇴한 사람의 소식은 공개 목록에 없다', async () => {
    await post(a1, { caption: '전체' });
    await post(a1, { caption: '이웃만', visibility: 'NEIGHBORS' });
    await rawStory(2, { caption: '내림', hiddenAt: new Date() });
    await testPrisma.user.update({ where: { id: 3 }, data: { deletedAt: new Date() } });
    await rawStory(3, { caption: '탈퇴' });
    for (const headers of [{}, auth(a2), auth(admin)]) {
      const caps = (await request.get('/api/stories/public').set(headers)).body.stories.map((s: any) => s.caption);
      expect(caps).toEqual(['전체']);
    }
  });

  it('★ 홈 줄은 한 사람당 가장 새 소식 하나, 최신순', async () => {
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    await rawStory(1, { caption: 'a1 옛것', createdAt: t(50) });
    await rawStory(2, { caption: 'a2 새것', createdAt: t(10) });
    await rawStory(1, { caption: 'a1 새것', createdAt: t(5) });
    await rawStory(3, { caption: '갤러리', createdAt: t(30) });
    await rawStory(2, { caption: 'a2 옛것', createdAt: t(40) });
    const rail = await request.get('/api/stories/public?rail=1');
    expect(rail.body.stories.map((s: any) => s.caption)).toEqual(['a1 새것', 'a2 새것', '갤러리']);
    // 전체 보기는 다 나온다(최신순)
    const all = await request.get('/api/stories/public');
    expect(all.body.stories.map((s: any) => s.caption)).toEqual(['a1 새것', 'a2 새것', '갤러리', 'a2 옛것', 'a1 옛것']);
  });

  it('★ 이어 받기(cursor) — 빠짐도 겹침도 없다 (시각과 id 순서가 어긋나도)', async () => {
    // id 는 늘어나는데 시각은 거꾸로 섞어 만든다
    for (let i = 0; i < 30; i++) {
      await rawStory(1 + (i % 3), { caption: `s${i}`, createdAt: new Date(Date.now() - ((i * 7) % 30) * 60_000) });
    }
    const got: string[] = [];
    let cursor: number | null = null;
    for (let k = 0; k < 10; k++) {
      const r: any = await request.get('/api/stories/public').query({ limit: 8, ...(cursor ? { cursor } : {}) });
      got.push(...r.body.stories.map((s: any) => s.caption));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(got.length).toBe(30);
    expect(new Set(got).size).toBe(30);
  });

  it('★ 30일 지난 소식은 공개 목록(홈 줄·전체 보기)에 없다 — 링크로는 그대로 열린다', async () => {
    const old = await rawStory(1, { caption: '옛 소식', createdAt: new Date(Date.now() - 31 * 864e5) });
    await rawStory(2, { caption: '새 소식' });
    for (const q of ['?rail=1', '', '?seed=7']) {
      const caps = (await request.get(`/api/stories/public${q}`)).body.stories.map((s: any) => s.caption);
      expect(caps, q).toEqual(['새 소식']);
    }
    expect((await request.get(`/api/stories/${old.id}`)).status).toBe(200);
    // 내 소식·이웃 탭은 기간과 무관
    expect((await request.get('/api/stories/user/1').set(auth(a2))).body.stories.map((s: any) => s.caption)).toContain('옛 소식');
  });

  it('★ [전체 보기] 무작위(?seed=) — 안 본 소식은 섞이고, 본 소식은 뒤로(최신순) · 같은 시드면 같은 순서', async () => {
    const made: number[] = [];
    for (let i = 0; i < 12; i++) made.push((await rawStory(1 + (i % 3), { caption: `s${i}`, createdAt: new Date(Date.now() - (i + 1) * 60_000) })).id);
    const seen = [made[2]!, made[5]!, made[8]!];   // 본 소식 셋 — 최신순이면 s2, s5, s8
    const ids = async (seed: number) => (await request.get('/api/stories/public').query({ seed, seen: seen.join(','), limit: 48 })).body.stories.map((s: any) => s.id);
    const a = await ids(11);
    expect(a.slice(-3), '본 소식은 맨 뒤, 최신순').toEqual(seen);
    expect(new Set(a.slice(0, 9))).toEqual(new Set(made.filter((id) => !seen.includes(id))));
    expect(await ids(11), '같은 시드면 같은 순서').toEqual(a);
    const b = await ids(12);
    expect(b.slice(0, 9), '시드가 다르면 다른 순서').not.toEqual(a.slice(0, 9));
    const newest = made.filter((id) => !seen.includes(id));   // 최신순 그대로가 아니다(섞였다)
    expect([a.slice(0, 9), b.slice(0, 9)].some((x) => JSON.stringify(x) !== JSON.stringify(newest))).toBe(true);
  });

  it('★ 무작위 순서도 이어 받기(offset)에 빠짐·겹침이 없다', async () => {
    for (let i = 0; i < 30; i++) await rawStory(1 + (i % 3), { caption: `s${i}`, createdAt: new Date(Date.now() - ((i * 7) % 30 + 1) * 60_000) });
    const got: number[] = [];
    let offset: number | null = 0;
    for (let k = 0; k < 10 && offset !== null; k++) {
      const r: any = await request.get('/api/stories/public').query({ seed: 5, limit: 8, offset });
      got.push(...r.body.stories.map((s: any) => s.id));
      offset = r.body.nextCursor;
    }
    expect(got.length).toBe(30);
    expect(new Set(got).size).toBe(30);
  });

  it('★ 하루 안 된 내 소식은 맨 앞(올리고 돌아와 바로 보이게) — 하루 지난 내 소식은 본 것으로 쳐 뒤로', async () => {
    await rawStory(1, { caption: '내 옛것', createdAt: new Date(Date.now() - 3 * 864e5) });
    for (let i = 0; i < 6; i++) await rawStory(2 + (i % 2), { caption: `남${i}`, createdAt: new Date(Date.now() - (i + 2) * 3600_000) });
    await rawStory(1, { caption: '내 새것', createdAt: new Date(Date.now() - 3600_000) });
    for (const seed of [3, 4, 5]) {
      const caps = (await request.get('/api/stories/public').set(auth(a1)).query({ seed })).body.stories.map((s: any) => s.caption);
      expect(caps[0], `seed ${seed}`).toBe('내 새것');
      expect(caps[caps.length - 1], `seed ${seed}`).toBe('내 옛것');
    }
  });

  it('★ 소식 하나가 빠져도(내림·그만 보기) 나머지 순서는 그대로 — 보기 화면을 닫을 때 격자가 통째로 뒤섞이지 않게', async () => {
    const made: number[] = [];
    for (let i = 0; i < 10; i++) made.push((await rawStory(1 + (i % 3), { caption: `s${i}`, createdAt: new Date(Date.now() - (i + 1) * 60_000) })).id);
    const before: number[] = (await request.get('/api/stories/public').query({ seed: 9, limit: 48 })).body.stories.map((s: any) => s.id);
    const gone = before[3]!;
    await testPrisma.story.update({ where: { id: gone }, data: { hiddenAt: new Date() } });
    const after: number[] = (await request.get('/api/stories/public').query({ seed: 9, limit: 48 })).body.stories.map((s: any) => s.id);
    expect(after).toEqual(before.filter((id) => id !== gone));
  });

  it('작성자 정보 — 작가는 홈페이지 주소, 일반 회원은 없음', async () => {
    const [v] = await extraUsers(1);
    await post(a1, { caption: '작가' });
    await post(v!, { caption: '일반' });
    const list = (await request.get('/api/stories/public')).body.stories;
    expect(list.find((s: any) => s.caption === '작가').author.homepage).toBe('/portfolio/1');
    expect(list.find((s: any) => s.caption === '일반').author.homepage).toBeNull();
    // 내린 표시는 남에게 싣지 않는다
    expect(list[0]).not.toHaveProperty('hidden');
  });
});

describe('ArtStory 올리기', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('글만 소식은 바탕색을 저장, 사진 소식은 저장하지 않는다 · 모르는 색은 400', async () => {
    const t = await post(a1, { caption: '글만', bg: 'forest' });
    expect(t.body.bg).toBe('forest');
    const p = await post(a1, { caption: '사진', images: ['/uploads/a.jpg'], bg: 'forest' });
    expect(p.body.bg).toBeNull();
    expect((await post(a1, { caption: 'x', bg: '#ff0000' })).status).toBe(400);
  });

  it('★ 하루 10개 — 동시에 12개를 보내도 10개만', async () => {
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => post(a1, { caption: `동시 ${i}` })));
    expect(rs.filter((r) => r.status === 201).length).toBe(10);
    expect(rs.filter((r) => r.status === 429).length).toBe(2);
    expect(rs.find((r) => r.status === 429)!.body.error).toContain('하루에 10개');
    expect(await testPrisma.story.count({ where: { authorId: 1 } })).toBe(10);
  });

  it('공개 범위 바꾸기 — 주인만, 이웃 공개로 바꾸면 공개 목록에서 빠진다', async () => {
    const { body: s } = await post(a1, { caption: '바꿀 것' });
    expect((await request.patch(`/api/stories/${s.id}/visibility`).set(auth(a2)).send({ visibility: 'NEIGHBORS' })).status).toBe(403);
    expect((await request.patch(`/api/stories/${s.id}/visibility`).set(auth(a1)).send({ visibility: 'SECRET' })).status).toBe(400);
    const r = await request.patch(`/api/stories/${s.id}/visibility`).set(auth(a1)).send({ visibility: 'NEIGHBORS' });
    expect(r.body.visibility).toBe('NEIGHBORS');
    expect((await request.get('/api/stories/public')).body.stories).toEqual([]);
  });
});

describe('ArtStory 사진 위 글', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 사진마다 하나 · 자리는 사진 안쪽으로 · 없는 사진·글만 소식에는 붙지 않는다', async () => {
    const r = await post(a1, {
      caption: '사진 위 글', images: ['/uploads/a.jpg', '/uploads/b.jpg'],
      overlays: [
        { i: 0, text: '금요일 6시 오픈', x: 0.5, y: 0.99, size: 'l', style: 'dark' },
        { i: 0, text: '두 번째(무시)', x: 0.2, y: 0.2 },
        { i: 5, text: '없는 사진', x: 0.5, y: 0.5 },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.overlays).toEqual([{ i: 0, text: '금요일 6시 오픈', x: 0.5, y: 0.95, size: 'l', style: 'dark' }]);
    const listed = (await request.get('/api/stories/public')).body.stories[0];
    expect(listed.overlays).toHaveLength(1);
    const t = await post(a1, { caption: '글만', overlays: [{ i: 0, text: 'x', x: 0.5, y: 0.5 }] });
    expect(t.body.overlays).toEqual([]);
  });

  it('바깥 주소 사진이 빠지면 사진 번호를 옮겨 적는다 · 모르는 꾸밈·너무 긴 글은 400', async () => {
    const r = await post(a1, {
      caption: '번호', images: ['https://evil.example/x.jpg', '/uploads/a.jpg'],
      overlays: [{ i: 1, text: '두 번째 사진 글', x: 0.4, y: 0.6 }],
    });
    expect(r.body.images).toEqual(['/uploads/a.jpg']);
    expect(r.body.overlays).toEqual([{ i: 0, text: '두 번째 사진 글', x: 0.4, y: 0.6, size: 'm', style: 'plain' }]);
    expect((await post(a1, { images: ['/uploads/a.jpg'], overlays: [{ i: 0, text: 'x', x: 0.5, y: 0.5, style: 'neon' }] })).status).toBe(400);
    expect((await post(a1, { images: ['/uploads/a.jpg'], overlays: [{ i: 0, text: '가'.repeat(81), x: 0.5, y: 0.5 }] })).status).toBe(400);
  });
});

describe('ArtStory 이웃 · 내 소식', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ [이웃] 탭 — 내가 이웃 추가한 사람만(나는 빼고), 이웃공개 포함, 내린 것 제외', async () => {
    await request.post('/api/follow/2').set(auth(a1));
    await post(a1, { caption: '내 것' });
    await post(a2, { caption: '이웃 전체' });
    await post(a2, { caption: '이웃 이웃만', visibility: 'NEIGHBORS' });
    await rawStory(2, { caption: '이웃 내림', hiddenAt: new Date() });
    await post(gallery, { caption: '모르는 사람' });
    const r = await request.get('/api/stories/feed?scope=neighbors').set(auth(a1));
    expect(r.body.stories.map((s: any) => s.caption).sort()).toEqual(['이웃 이웃만', '이웃 전체']);
    expect(r.body.followingCount).toBe(1);
  });

  it('[내 소식] — 주인은 내린 소식도 표시와 함께 본다, 남은 못 본다', async () => {
    await post(a1, { caption: '보이는 것' });
    await rawStory(1, { caption: '내린 것', hiddenAt: new Date() });
    const mine = await request.get('/api/stories/user/1').set(auth(a1));
    const hidden = mine.body.stories.find((s: any) => s.caption === '내린 것');
    expect(hidden.hidden).toBe(true);
    const other = await request.get('/api/stories/user/1').set(auth(a2));
    expect(other.body.stories.map((s: any) => s.caption)).toEqual(['보이는 것']);
  });
});

describe('ArtStory 신고 · 내리기', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('내 소식은 신고 못 한다 · 모르는 사유는 400 · 두 번째 신고는 조용히 성공', async () => {
    const { body: s } = await post(a1, { caption: '신고 대상' });
    expect((await request.post(`/api/stories/${s.id}/report`).set(auth(a1)).send({ reason: 'SPAM' })).status).toBe(400);
    expect((await request.post(`/api/stories/${s.id}/report`).set(auth(a2)).send({ reason: 'BAD' })).status).toBe(400);
    expect((await request.post(`/api/stories/${s.id}/report`)).status).toBe(401);
    const r1 = await request.post(`/api/stories/${s.id}/report`).set(auth(a2)).send({ reason: 'SPAM' });
    expect(r1.body).toMatchObject({ ok: true, already: false });
    const r2 = await request.post(`/api/stories/${s.id}/report`).set(auth(a2)).send({ reason: 'ABUSE' });
    expect(r2.body).toMatchObject({ ok: true, already: true });
    expect(await testPrisma.storyReport.count()).toBe(1);
  });

  it('★ 신고한 사람 화면에서는 곧바로 빠진다(남에게는 그대로)', async () => {
    const { body: s } = await post(a1, { caption: '한 명만 신고' });
    await request.post(`/api/stories/${s.id}/report`).set(auth(a2)).send({ reason: 'SPAM' });
    expect((await request.get('/api/stories/public').set(auth(a2))).body.stories).toEqual([]);
    expect((await request.get('/api/stories/public')).body.stories.length).toBe(1);
  });

  it('★★ 서로 다른 3명이면 저절로 내린다 — 동시에 4명이 신고해도 알림은 한 번', async () => {
    const { body: s } = await post(a1, { caption: '여럿이 신고' });
    const toks = await extraUsers(4);
    await Promise.all(toks.map((t) => request.post(`/api/stories/${s.id}/report`).set(auth(t)).send({ reason: 'INAPPROPRIATE' })));
    const row = await testPrisma.story.findUnique({ where: { id: s.id } });
    expect(row!.hiddenAt).not.toBeNull();
    expect(row!.hiddenReason).toBe('REPORTS');
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_HIDDEN' } })).toBe(1);
    expect(await testPrisma.notification.count({ where: { userId: 4, type: 'STORY_REPORTED' } })).toBe(1);
    // 비회원·남에게는 사라진다
    expect((await request.get('/api/stories/public')).body.stories).toEqual([]);
    expect((await request.get(`/api/stories/${s.id}`)).status).toBe(404);
  });

  it('★ 내린 소식은 주인·관리자 말고 404 — 상세·댓글·좋아요·명단·신고 모두', async () => {
    const st = await rawStory(1, { caption: '내림', hiddenAt: new Date() });
    for (const headers of [{}, auth(a2)]) {
      expect((await request.get(`/api/stories/${st.id}`).set(headers)).status).toBe(404);
      expect((await request.get(`/api/stories/${st.id}/comments`).set(headers)).status).toBe(404);
      expect((await request.get(`/api/stories/${st.id}/likers`).set(headers)).status).toBe(404);
    }
    expect((await request.post(`/api/stories/${st.id}/like`).set(auth(a2))).status).toBe(404);
    expect((await request.post(`/api/stories/${st.id}/comments`).set(auth(a2)).send({ body: '몰래' })).status).toBe(404);
    expect((await request.post(`/api/stories/${st.id}/report`).set(auth(a2)).send({ reason: 'SPAM' })).status).toBe(404);
    const own = await request.get(`/api/stories/${st.id}`).set(auth(a1));
    expect(own.status).toBe(200);
    expect(own.body.hidden).toBe(true);
    expect((await request.get(`/api/stories/${st.id}`).set(auth(admin))).body.hidden).toBe(true);
  });

  it('★ 관리자가 되살리면 다시 보이고, 그 뒤 신고만 센다(옛 신고로 곧바로 다시 내려가지 않는다)', async () => {
    const { body: s } = await post(a1, { caption: '되살릴 것' });
    const toks = await extraUsers(5);
    for (const t of toks.slice(0, 3)) await request.post(`/api/stories/${s.id}/report`).set(auth(t)).send({ reason: 'SPAM' });
    expect((await testPrisma.story.findUnique({ where: { id: s.id } }))!.hiddenAt).not.toBeNull();

    expect((await request.patch(`/api/stories/${s.id}/hidden`).set(auth(a2)).send({ hidden: false })).status).toBe(403);
    const r = await request.patch(`/api/stories/${s.id}/hidden`).set(auth(admin)).send({ hidden: false });
    expect(r.body).toMatchObject({ hidden: false });
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_RESTORED' } })).toBe(1);
    expect((await request.get('/api/stories/public')).body.stories.length).toBe(1);

    // 되살린 뒤 두 명 더 — 아직 3명이 안 됐다
    for (const t of toks.slice(3, 5)) await request.post(`/api/stories/${s.id}/report`).set(auth(t)).send({ reason: 'SPAM' });
    expect((await testPrisma.story.findUnique({ where: { id: s.id } }))!.hiddenAt).toBeNull();
  });

  it('관리자 내리기 — 주인에게 알리고 [신고 관리]에서 확인한 것으로 친다', async () => {
    const { body: s } = await post(a1, { caption: '운영이 내림' });
    await request.post(`/api/stories/${s.id}/report`).set(auth(a2)).send({ reason: 'COPYRIGHT' });
    let list = await request.get('/api/stories/reports').set(auth(admin));
    expect(list.body[0]).toMatchObject({ id: s.id, pending: true, reportCount: 1, hidden: false });
    expect(list.body[0].reasons).toEqual({ COPYRIGHT: 1 });

    const r = await request.patch(`/api/stories/${s.id}/hidden`).set(auth(admin)).send({ hidden: true });
    expect(r.body).toMatchObject({ hidden: true, hiddenReason: 'ADMIN' });
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_HIDDEN' } })).toBe(1);
    list = await request.get('/api/stories/reports').set(auth(admin));
    expect(list.body[0]).toMatchObject({ id: s.id, pending: false, hidden: true });
    // 같은 걸 또 눌러도 알림이 두 번 가지 않는다
    await request.patch(`/api/stories/${s.id}/hidden`).set(auth(admin)).send({ hidden: true });
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_HIDDEN' } })).toBe(1);
    expect((await request.get('/api/stories/reports').set(auth(a1))).status).toBe(403);
  });
});

describe('ArtStory 그만 보기', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 그만 보기 — 내 화면에서만 빠지고, 되돌리면 다시 보인다', async () => {
    await post(a1, { caption: 'a1 소식' });
    await post(gallery, { caption: '갤러리 소식' });
    expect((await request.post('/api/stories/mutes/2').set(auth(a2))).status).toBe(400);   // 나 자신
    expect((await request.post('/api/stories/mutes/9999').set(auth(a2))).status).toBe(404);
    expect((await request.post('/api/stories/mutes/1').set(auth(a2))).body).toEqual({ muted: true });
    await request.post('/api/stories/mutes/1').set(auth(a2));   // 두 번 눌러도 한 줄
    expect(await testPrisma.storyMute.count()).toBe(1);

    const rail = await request.get('/api/stories/public?rail=1').set(auth(a2));
    expect(rail.body.stories.map((s: any) => s.caption)).toEqual(['갤러리 소식']);
    expect((await request.get('/api/stories/public?rail=1')).body.stories.length).toBe(2);   // 남에게는 그대로
    expect((await request.get('/api/stories/mutes').set(auth(a2))).body.map((u: any) => u.id)).toEqual([1]);

    await request.delete('/api/stories/mutes/1').set(auth(a2));
    expect((await request.get('/api/stories/public?rail=1').set(auth(a2))).body.stories.length).toBe(2);
  });
});

describe('ArtStory 좋아요 알림', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 소식마다 한 줄로 합친다 — "○○님 외 N명", 내 소식에 내가 누르거나 끄는 건 알리지 않는다', async () => {
    const { body: s } = await post(a1, { caption: '좋아요 받을 소식입니다' });
    await request.post(`/api/stories/${s.id}/like`).set(auth(a1));   // 내 것
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_LIKE' } })).toBe(0);
    await request.post(`/api/stories/${s.id}/like`).set(auth(a2));
    await request.post(`/api/stories/${s.id}/like`).set(auth(gallery));
    const rows = await testPrisma.notification.findMany({ where: { userId: 1, type: 'STORY_LIKE' } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.message).toMatch(/^Gallery Owner님 외 1명이 내 소식을 좋아해요: 좋아요 받을 소식입니다/);
    expect(rows[0]!.linkUrl).toBe(`/feed?story=${s.id}`);
    await request.post(`/api/stories/${s.id}/like`).set(auth(a2));   // 끄기
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_LIKE' } })).toBe(1);
  });

  it('★ 동시에 여럿이 눌러도 알림은 한 줄', async () => {
    const { body: s } = await post(a1, { caption: '동시 좋아요' });
    const toks = await extraUsers(6);
    await Promise.all(toks.map((t) => request.post(`/api/stories/${s.id}/like`).set(auth(t))));
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'STORY_LIKE' } })).toBe(1);
    expect((await testPrisma.story.findUnique({ where: { id: s.id } }))!.likeCount).toBe(6);
  });
});

describe('ArtStory 공유 미리보기', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); clearSeoCache(); });

  it('전체공개 소식만 — 이름·글·첫 사진, 이웃공개·내린 소식은 싣지 않는다', async () => {
    const { body: s } = await post(a1, { caption: '공유할 소식', images: ['/uploads/a.jpg', '/uploads/b.jpg'] });
    const f = await getSeoFields('story', s.id);
    expect(f).toMatchObject({ title: 'Artist 1님의 소식 | ArtStory - ArtLink', description: '공유할 소식', image: '/uploads/a.jpg', path: `/feed?story=${s.id}` });
    const { body: n } = await post(a1, { caption: '이웃만', visibility: 'NEIGHBORS' });
    expect(await getSeoFields('story', n.id)).toBeNull();
    const h = await rawStory(1, { caption: '내림', hiddenAt: new Date() });
    expect(await getSeoFields('story', h.id)).toBeNull();
  });
});
