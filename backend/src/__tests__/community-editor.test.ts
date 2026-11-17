/**
 * 커뮤니티 블로그형 글쓰기 (2026-11-13) — 문서 글 · 작업본(자동 저장) · 탭별 쓰기 권한/익명 · 필진 · 이웃 알림 · 글 사진 정리
 *
 * 지켜야 하는 것:
 *  ① 문서는 서버 허용 목록을 거쳐 저장되고, 문서 글도 body(글)·images(사진)가 채워진다(목록·멘션·옛 화면이 그대로 돈다)
 *  ② 작업본은 본인만 — 공개 응답에 절대 섞이지 않는다. 자동 저장은 rev 가 맞을 때만(아니면 409)
 *  ③ 탭 규칙: 필진 탭은 필진·관리자만, 익명을 막은 탭에 익명이면 400(말없이 실명으로 바꾸지 않는다)
 *  ④ 필진 탭의 실명 글만 처음 올릴 때 이웃에게 알린다
 *  ⑤ 사진 파일은 글쓰기로 올린 것만, 아무 글·작업본도 안 쓸 때만 지운다(남의 파일을 지우지 않는다)
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';
import { prunePostAssets, ORPHAN_ASSET_MS, cleanupPostImages } from '../lib/postAssets';
import { isDraftSaveRequest } from '../lib/communityAccess';
import { getSeoFields, clearSeoCache } from '../lib/seoMeta';
import { deleteUploadedFile } from '../lib/storage';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

const IMG = '/uploads/1762000000000-111.jpg';
const IMG2 = '/uploads/1762000000001-222.jpg';
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const fig = (src: string, extra: Record<string, unknown> = {}) => ({ type: 'figure', attrs: { src, ...extra } });

const createDocPost = (tok: string, body: Record<string, unknown> = {}) =>
  request.post('/api/community').set(auth(tok)).send({ title: '전시 준비 일지', doc: doc(p('첫 문단'), fig(IMG), p('둘째 문단')), ...body });

async function makeTab(body: Record<string, unknown>) {
  const r = await request.post('/api/community/categories').set(auth(admin)).send(body);
  expect(r.status).toBe(201);
  return r.body as { id: number; slug: string };
}

describe('문서 글', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 문서로 쓴 글 — body 는 문서의 글, images 는 문서 속 사진(순서대로), 상세에 doc 이 온다', async () => {
    const r = await createDocPost(a1);
    expect(r.status).toBe(201);
    const row = await testPrisma.post.findUnique({ where: { id: r.body.id } });
    expect(row!.body).toBe('첫 문단\n\n둘째 문단');
    expect(row!.images).toEqual([IMG]);
    const d = await request.get(`/api/community/${r.body.id}`);
    expect(d.body.doc.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'figure', 'paragraph']);
    expect(d.body.readingMinutes).toBeGreaterThanOrEqual(1);
    // 목록 — 발췌·표지·읽는 시간
    const list = await request.get('/api/community');
    expect(list.body.posts[0]).toMatchObject({ excerpt: '첫 문단 둘째 문단', cover: IMG, imageCount: 1 });
    // ⚠️ 목록 한 줄에 문서 JSON 을 싣지 않는다(글마다 문서 전체를 읽게 된다)
    expect(list.body.posts[0]).not.toHaveProperty('doc');
  });

  it('★ 목록 요약은 리드 — 맨 바깥 문단만 이어 붙인다(소제목·목록·팁 상자가 문장 사이에 끼지 않는다)', async () => {
    const h2 = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
    const ul = (...items: string[]) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });
    const r = await createDocPost(a1, { doc: doc(p('새 글쓰기가 생겼어요.'), h2('무엇이 달라졌나요'), ul('사진을 원하는 자리에', '자동 저장'), p('필진 탭도 있어요.')) });
    const row = await testPrisma.post.findUnique({ where: { id: r.body.id } });
    expect(row!.excerpt).toBe('새 글쓰기가 생겼어요. 필진 탭도 있어요.');
    expect(row!.body).toContain('무엇이 달라졌나요');   // body(글 전체)는 그대로 — 멘션·검색이 쓴다
    const list = await request.get('/api/community');
    expect(list.body.posts[0].excerpt).toBe('새 글쓰기가 생겼어요. 필진 탭도 있어요.');
    // 문단이 하나도 없으면(목록만) 글 전체로
    const onlyList = await createDocPost(a1, { doc: doc(ul('하나', '둘')) });
    expect((await testPrisma.post.findUnique({ where: { id: onlyList.body.id } }))!.excerpt).toBe('하나 둘');
    // 고치면 다시 만든다
    await request.patch(`/api/community/${r.body.id}`).set(auth(a1)).send({ title: '고침', doc: doc(h2('소제목'), p('바뀐 첫 문단')) });
    expect((await testPrisma.post.findUnique({ where: { id: r.body.id } }))!.excerpt).toBe('바뀐 첫 문단');
    // 옛 글은 요약 칸이 비어 있고 목록은 body 앞부분을 쓴다
    const legacy = await request.post('/api/community').set(auth(a1)).send({ title: '옛 글', body: '옛 본문' });
    expect((await testPrisma.post.findUnique({ where: { id: legacy.body.id } }))!.excerpt).toBeNull();
    expect((await request.get('/api/community')).body.posts.find((x: { id: number }) => x.id === legacy.body.id).excerpt).toBe('옛 본문');
  });

  it('표지는 따로 고르지 않는다 — 첫 사진(보내온 coverUrl 은 무시, 동영상은 표지가 아니다)', async () => {
    const r = await createDocPost(a1, { doc: doc({ type: 'video', attrs: { src: '/uploads/1762000000002-333.mp4' } }, fig(IMG), fig(IMG2)), coverUrl: IMG2 });
    expect(r.status).toBe(201);
    const row = (await request.get('/api/community')).body.posts.find((x: { id: number }) => x.id === r.body.id);
    expect(row).toMatchObject({ cover: IMG, thumbnail: IMG, imageCount: 2, videoCount: 1 });
    const d = await request.get(`/api/community/${r.body.id}`);
    expect(d.body).not.toHaveProperty('coverUrl');
  });

  it('★ 등록은 엄격하다 — 바깥 사진·모르는 노드·빈 글은 400(말없이 빠진 채 올라가지 않는다)', async () => {
    expect((await createDocPost(a1, { doc: doc(fig('https://evil.example/a.jpg')) })).body.error).toMatch('다른 사이트의 사진');
    expect((await createDocPost(a1, { doc: doc(p('a'), { type: 'iframe' }) })).status).toBe(400);
    expect((await createDocPost(a1, { doc: doc({ type: 'paragraph' }) })).body.error).toBe('내용을 입력해주세요.');
    expect((await createDocPost(a1, { title: ' ' })).status).toBe(400);
  });

  it('옛 형식({title, body, images})도 그대로 받는다 — 배포 중 옛 화면', async () => {
    const r = await request.post('/api/community').set(auth(a1)).send({ title: '옛 글', body: '본문', images: [IMG] });
    expect(r.status).toBe(201);
    const d = await request.get(`/api/community/${r.body.id}`);
    expect(d.body).toMatchObject({ body: '본문', images: [IMG], doc: null });
  });

  it('★ 문서로 고치면 사진까지 바뀐다 · 문서 글을 옛 형식(글만)으로 고치면 409 — 고쳐도 화면에 안 보인다', async () => {
    const { body: { id } } = await createDocPost(a1, { doc: doc(p('a'), fig(IMG), fig(IMG2)) });
    const r = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(fig(IMG2), p('b')) });
    expect(r.status).toBe(200);
    expect(r.body.images).toEqual([IMG2]);
    expect(r.body.body).toBe('b');
    // 읽는 화면은 문서를 그린다 — body 만 바뀌면 고친 글이 아무 데도 안 보인다(배포 직후 옛 화면만 이 길로 온다)
    const legacy = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침2', body: '글만' });
    expect(legacy.status).toBe(409);
    const row = await testPrisma.post.findUnique({ where: { id } });
    expect(row).toMatchObject({ title: '고침', body: 'b', images: [IMG2] });
  });

  it('옛 글은 옛 형식으로 고친다 — 사진은 그대로', async () => {
    const r = await request.post('/api/community').set(auth(a1)).send({ title: '옛 글', body: '본문', images: [IMG] });
    const u = await request.patch(`/api/community/${r.body.id}`).set(auth(a1)).send({ title: '옛 글 고침', body: '고친 본문' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ body: '고친 본문', images: [IMG], doc: null });
  });

  it('남의 글은 문서로도 못 고친다(403)', async () => {
    const { body: { id } } = await createDocPost(a1);
    expect((await request.patch(`/api/community/${id}`).set(auth(a2)).send({ title: 'x', doc: doc(p('y')) })).status).toBe(403);
  });
});

describe('작업본(자동 저장)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const newDraft = (tok: string, body: Record<string, unknown> = {}) =>
    request.post('/api/community/drafts').set(auth(tok)).send(body);
  const save = (tok: string, id: number, baseRev: number, body: Record<string, unknown> = {}) =>
    request.put(`/api/community/drafts/${id}`).set(auth(tok)).send({ baseRev, title: '제목', doc: doc(p('내용')), ...body });

  it('★ 만들고 → 저장하면 rev 가 오르고 → 옛 rev 로 저장하면 409(다른 곳에서 고쳤다)', async () => {
    const c = await newDraft(a1, { title: '처음', doc: doc(p('a')) });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ title: '처음', rev: 0, postId: null });
    const s1 = await save(a1, c.body.id, 0);
    expect(s1.status).toBe(200);
    expect(s1.body.rev).toBe(1);
    const stale = await save(a1, c.body.id, 0, { title: '옛 탭' });
    expect(stale.status).toBe(409);
    expect(stale.body.rev).toBe(1);
    // 덮어쓰기 = 지금 rev 로 다시 보낸다
    expect((await save(a1, c.body.id, 1, { title: '덮어씀' })).body.rev).toBe(2);
    expect((await request.get(`/api/community/drafts/${c.body.id}`).set(auth(a1))).body.title).toBe('덮어씀');
  });

  it('★ 같은 rev 로 동시에 10번 저장해도 정확히 1번만 들어간다', async () => {
    const c = await newDraft(a1);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => save(a1, c.body.id, 0, { title: `t${i}` })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it('★ 남의 작업본은 404 — 읽기·저장·지우기 모두', async () => {
    const c = await newDraft(a1);
    expect((await request.get(`/api/community/drafts/${c.body.id}`).set(auth(a2))).status).toBe(404);
    expect((await save(a2, c.body.id, 0)).status).toBe(404);
    await request.delete(`/api/community/drafts/${c.body.id}`).set(auth(a2));
    expect((await request.get(`/api/community/drafts/${c.body.id}`).set(auth(a1))).status).toBe(200);
  });

  it('★ 작업본은 공개 응답에 절대 섞이지 않는다', async () => {
    const MARK = '비밀작업본표식XYZ';
    const c = await newDraft(a1, { title: MARK, doc: doc(p(MARK)) });
    await save(a1, c.body.id, 0, { title: MARK, doc: doc(p(MARK)) });
    const { body: { id } } = await createDocPost(a1);
    const ed = await newDraft(a1, { postId: id });
    await save(a1, ed.body.id, ed.body.rev, { title: MARK, doc: doc(p(MARK)) });
    for (const url of ['/api/community', `/api/community/${id}`, '/api/community/popular', '/api/community?mine=posts']) {
      const r = await request.get(url).set(auth(a1));
      expect(JSON.stringify(r.body), url).not.toContain(MARK);
    }
  });

  it('작업본은 느슨하다 — 바깥 사진·모르는 노드는 버리고 저장은 된다', async () => {
    const c = await newDraft(a1);
    const r = await save(a1, c.body.id, 0, { doc: doc(p('a'), fig('https://evil.example/x.jpg'), { type: 'iframe' }) });
    expect(r.status).toBe(200);
    const g = await request.get(`/api/community/drafts/${c.body.id}`).set(auth(a1));
    expect(g.body.doc.content).toHaveLength(1);
  });

  it('없는 탭 id 는 null 로(FK 오류 없이)', async () => {
    const c = await newDraft(a1, { categoryId: 999999 });
    expect(c.status).toBe(201);
    expect(c.body.categoryId).toBeNull();
  });

  it('★ 새 글 작업본은 30개까지 — 동시에 만들어도 넘지 않는다', async () => {
    await testPrisma.postDraft.createMany({ data: Array.from({ length: 25 }, () => ({ authorId: 1, doc: { type: 'doc', content: [] } })) });
    const rs = await Promise.all(Array.from({ length: 10 }, () => newDraft(a1)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await testPrisma.postDraft.count({ where: { authorId: 1 } })).toBe(30);
  });

  it('★ 등록하면서 draftId 를 주면 그 작업본이 지워진다(내 새 글 작업본만)', async () => {
    const c = await newDraft(a1);
    const other = await newDraft(a2);
    await createDocPost(a1, { draftId: c.body.id });
    await createDocPost(a1, { draftId: other.body.id });   // 남의 작업본 id — 지워지면 안 된다
    expect(await testPrisma.postDraft.findUnique({ where: { id: c.body.id } })).toBeNull();
    expect(await testPrisma.postDraft.findUnique({ where: { id: other.body.id } })).not.toBeNull();
  });

  it('★ 글 고치기 작업본 — 한 글에 하나(두 번 열어도 같은 것), 옛 글은 문서로 바꿔 시작, 남의 글은 404', async () => {
    const legacy = await request.post('/api/community').set(auth(a1)).send({ title: '옛 글', body: '첫 줄\n둘째 줄\n\n둘째 문단', images: [IMG] });
    const d1 = await newDraft(a1, { postId: legacy.body.id });
    const d2 = await newDraft(a1, { postId: legacy.body.id });
    expect(d1.status).toBe(201);
    expect(d2.status).toBe(200);
    expect(d2.body.id).toBe(d1.body.id);
    expect(d1.body.doc.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'paragraph', 'figure']);
    expect((await newDraft(a2, { postId: legacy.body.id })).status).toBe(404);
    // 고쳐 올리면 그 글의 작업본은 지워진다
    await request.patch(`/api/community/${legacy.body.id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('새 글')) });
    expect(await testPrisma.postDraft.count({ where: { postId: legacy.body.id } })).toBe(0);
  });

  it('★ 글 고치기 작업본을 두 탭에서 동시에 열어도 하나만 생긴다', async () => {
    const { body: { id } } = await createDocPost(a1);
    const rs = await Promise.all(Array.from({ length: 5 }, () => newDraft(a1, { postId: id })));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
  });

  it('목록 — 내 것만, 최근 순', async () => {
    const x = await newDraft(a1, { title: '하나' });
    await newDraft(a2, { title: '남의 것' });
    await save(a1, x.body.id, 0, { title: '하나(고침)' });
    const r = await request.get('/api/community/drafts').set(auth(a1));
    expect(r.body.map((d: { title: string }) => d.title)).toEqual(['하나(고침)']);
  });

  it('자동 저장 요청 판정 — index.ts 가 전역 한도에서 뺀다', () => {
    expect(isDraftSaveRequest('PUT', '/community/drafts/12')).toBe(true);
    expect(isDraftSaveRequest('POST', '/community/drafts')).toBe(false);
    expect(isDraftSaveRequest('PUT', '/community/12')).toBe(false);
  });
});

describe('탭 규칙 — 쓰기 권한 · 익명', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 필진 탭 — 필진 아니면 403, 필진·관리자는 쓴다. 탭 목록의 canWrite 가 같은 답을 낸다', async () => {
    const tab = await makeTab({ name: '전시 준비', writePolicy: 'writers', layout: 'card', allowAnonymous: false, description: '필진이 쓰는 전시 준비 이야기' });
    expect((await createDocPost(a1, { categoryId: tab.id })).body.error).toMatch('필진만');
    const canWrite = async (tok: string) => (await request.get('/api/community/categories').set(auth(tok))).body.find((t: { id: number }) => t.id === tab.id).canWrite;
    expect(await canWrite(a1)).toBe(false);
    expect((await request.put('/api/community/writers/1').set(auth(admin))).status).toBe(200);
    expect(await canWrite(a1)).toBe(true);
    expect((await createDocPost(a1, { categoryId: tab.id })).status).toBe(201);
    expect((await createDocPost(admin, { categoryId: tab.id })).status).toBe(201);
    // 비로그인은 canWrite false
    expect((await request.get('/api/community/categories')).body.find((t: { id: number }) => t.id === tab.id)).toMatchObject({ canWrite: false, layout: 'card', writePolicy: 'writers', allowAnonymous: false });
  });

  it('★ 익명을 막은 탭에 익명이면 400 — 말없이 실명으로 바꾸지 않는다', async () => {
    const tab = await makeTab({ name: '실명 탭', allowAnonymous: false });
    const r = await createDocPost(a1, { categoryId: tab.id, anonymous: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch('익명으로 쓸 수 없어요');
    expect(await testPrisma.post.count()).toBe(0);
  });

  it('옛 칸 writeAdminOnly 는 writePolicy 와 늘 같다(배포 중 옛 화면)', async () => {
    const tab = await makeTab({ name: '공지', writeAdminOnly: true });
    let t = (await request.get('/api/community/categories')).body[0];
    expect(t).toMatchObject({ writePolicy: 'admin', writeAdminOnly: true });
    await request.patch(`/api/community/categories/${tab.id}`).set(auth(admin)).send({ writePolicy: 'writers' });
    t = (await request.get('/api/community/categories')).body[0];
    expect(t).toMatchObject({ writePolicy: 'writers', writeAdminOnly: false });
    expect((await testPrisma.postCategory.findUnique({ where: { id: tab.id } }))!.writeAdminOnly).toBe(false);
  });

  it('★ 고치면서 탭을 옮기면 새 탭의 권한을 본다 · 안 옮기면 필진에서 빠져도 내 글은 고친다', async () => {
    const writers = await makeTab({ name: '칼럼', writePolicy: 'writers' });
    const free = await makeTab({ name: '자유' });
    await request.put('/api/community/writers/1').set(auth(admin));
    const { body: { id } } = await createDocPost(a1, { categoryId: writers.id });
    await request.delete('/api/community/writers/1').set(auth(admin));
    expect((await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('x')) })).status).toBe(200);
    const { body: { id: id2 } } = await createDocPost(a1, { categoryId: free.id });
    const mv = await request.patch(`/api/community/${id2}`).set(auth(a1)).send({ title: '옮김', doc: doc(p('x')), categoryId: writers.id });
    expect(mv.status).toBe(403);
  });

  it('관리자가 나중에 탭의 익명을 막아도 옛 익명 글은 익명 그대로 고칠 수 있다', async () => {
    const tab = await makeTab({ name: '질문' });
    const { body: { id } } = await createDocPost(a1, { categoryId: tab.id, anonymous: true });
    await request.patch(`/api/community/categories/${tab.id}`).set(auth(admin)).send({ allowAnonymous: false });
    const r = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('y')) });
    expect(r.status).toBe(200);
    expect(r.body.author.anonymous).toBe(true);
  });

  it('탭 정보(모양·소개)는 관리자만 고친다', async () => {
    const tab = await makeTab({ name: '후기' });
    expect((await request.patch(`/api/community/categories/${tab.id}`).set(auth(a1)).send({ layout: 'card' })).status).toBe(403);
    const r = await request.patch(`/api/community/categories/${tab.id}`).set(auth(admin)).send({ layout: 'card', description: '전시를 다녀와서' });
    expect(r.body).toMatchObject({ layout: 'card', description: '전시를 다녀와서' });
  });
});

describe('필진 · 이웃 알림', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 필진 관리 — 관리자만, 두 번 넣어도 한 줄·알림 한 번, 빼면 끝', async () => {
    expect((await request.put('/api/community/writers/1').set(auth(a2))).status).toBe(403);
    await request.put('/api/community/writers/1').set(auth(admin));
    await request.put('/api/community/writers/1').set(auth(admin));
    expect(await testPrisma.communityWriter.count()).toBe(1);
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'COMMUNITY_WRITER' } })).toBe(1);
    const list = await request.get('/api/community/writers').set(auth(admin));
    expect(list.body[0]).toMatchObject({ userId: 1, role: 'ARTIST', postCount: 0 });
    expect((await request.put('/api/community/writers/99999').set(auth(admin))).status).toBe(404);
    await request.delete('/api/community/writers/1').set(auth(admin));
    expect(await testPrisma.communityWriter.count()).toBe(0);
  });

  it('★ 필진 탭의 실명 글 — 나를 이웃 추가한 사람에게 처음 한 번 알림. 익명·자유 탭·고쳐 올림은 알림 없음', async () => {
    const writers = await makeTab({ name: '칼럼', writePolicy: 'writers' });
    const free = await makeTab({ name: '자유' });
    await request.put('/api/community/writers/1').set(auth(admin));
    // 2·3 이 1 을 이웃 추가
    await testPrisma.follow.createMany({ data: [{ followerId: 2, followingId: 1 }, { followerId: 3, followingId: 1 }] });
    const r = await createDocPost(a1, { categoryId: writers.id, title: '첫 칼럼' });
    const notes = await testPrisma.notification.findMany({ where: { type: 'POST_NEW' } });
    expect(notes.map((n) => n.userId).sort()).toEqual([2, 3]);
    expect(notes[0]).toMatchObject({ linkUrl: `/community/${r.body.id}` });
    expect(notes[0]!.message).toContain('첫 칼럼');
    await createDocPost(a1, { categoryId: free.id });
    await request.patch(`/api/community/${r.body.id}`).set(auth(a1)).send({ title: '첫 칼럼(고침)', doc: doc(p('z')) });
    expect(await testPrisma.notification.count({ where: { type: 'POST_NEW' } })).toBe(2);
  });

  it('필진 글 모아 보기(policy=writers) — 필진 탭의 실명 글만', async () => {
    const writers = await makeTab({ name: '칼럼', writePolicy: 'writers' });
    await request.put('/api/community/writers/1').set(auth(admin));
    await createDocPost(a1, { categoryId: writers.id, title: '필진 글' });
    await createDocPost(a2, { title: '자유 글' });
    const r = await request.get('/api/community?policy=writers');
    expect(r.body.posts.map((x: { title: string }) => x.title)).toEqual(['필진 글']);
    expect(r.body.posts[0].category).toMatchObject({ layout: 'list', writePolicy: 'writers' });
  });

  it('상세 — 실명 글엔 작성자 홈페이지·한 줄 소개, 익명 글엔 없다 · 이 탭의 다른 글', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'artist.one' } });
    await testPrisma.portfolio.create({ data: { userId: 1, biography: '', tagline: '빛을 그립니다' } });
    const tab = await makeTab({ name: '작업일지' });
    const first = await createDocPost(a1, { categoryId: tab.id, title: '하나' });
    const second = await createDocPost(a1, { categoryId: tab.id, title: '둘' });
    const d = await request.get(`/api/community/${second.body.id}`);
    expect(d.body.author).toMatchObject({ homepage: '/@artist.one', intro: '빛을 그립니다', anonymous: false });
    expect(d.body.related.map((x: { id: number }) => x.id)).toEqual([first.body.id]);
    const anon = await createDocPost(a1, { categoryId: tab.id, anonymous: true });
    const ad = await request.get(`/api/community/${anon.body.id}`);
    expect(ad.body.author).toMatchObject({ homepage: null, intro: null, id: null, name: '익명' });
  });

  it('인기글 days — 그 기간에 쓴 글만', async () => {
    const { body: { id } } = await createDocPost(a1, { title: '옛날 글' });
    await testPrisma.post.update({ where: { id }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000), likeCount: 99 } });
    await createDocPost(a1, { title: '이번 주 글' });
    expect((await request.get('/api/community/popular?days=7')).body.map((x: { title: string }) => x.title)).toEqual(['이번 주 글']);
    expect((await request.get('/api/community/popular')).body[0].title).toBe('옛날 글');
  });

  it('공유 미리보기 — 제목·글쓴이·탭·발췌·표지, 익명이면 이름 없이', async () => {
    clearSeoCache();
    const tab = await makeTab({ name: '후기' });
    const r = await createDocPost(a1, { categoryId: tab.id, title: '첫 아트페어' });
    const f = await getSeoFields('post', r.body.id);
    expect(f).toMatchObject({ title: '첫 아트페어 | ArtLink 커뮤니티', image: IMG, path: `/community/${r.body.id}` });
    expect(f!.description).toMatch(/후기 · 첫 문단 둘째 문단$/);
    // 소제목이 있는 글은 리드로(소제목이 설명에 끼지 않는다)
    const h = await createDocPost(a1, { title: '소제목 글', doc: doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '소제목' }] }, p('리드 문단')) });
    clearSeoCache();
    expect((await getSeoFields('post', h.body.id))!.description).toMatch(/리드 문단$/);
    expect((await getSeoFields('post', h.body.id))!.description).not.toContain('소제목');
    const anon = await createDocPost(a2, { anonymous: true, title: '익명 질문' });
    clearSeoCache();
    expect((await getSeoFields('post', anon.body.id))!.description.startsWith('첫 문단')).toBe(true);
  });
});

describe('글 사진 올리기 · 파일 정리', () => {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const made: string[] = [];
  beforeAll(async () => { await cleanDb(); await seedUsers(); });
  afterAll(async () => { for (const u of made) await deleteUploadedFile(u); });
  beforeEach(async () => {
    await testPrisma.post.deleteMany();
    await testPrisma.postDraft.deleteMany();
    await testPrisma.postAsset.deleteMany();
  });

  const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg().toBuffer();
  async function upload(tok: string, w = 1600, h = 1200) {
    const r = await request.post('/api/upload/post-image').set(auth(tok)).attach('image', await jpeg(w, h), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(200);
    made.push(r.body.url);
    return r.body as { url: string; width: number; height: number };
  }
  const exists = (url: string, dir = '') => fs.existsSync(path.join(uploadsDir, dir, path.basename(url)));

  it('★ 치수를 돌려주고 t240·t800·t1280 을 응답 전에 만든다 · 사진 기록이 남는다', async () => {
    const u = await upload(a1, 1600, 1200);
    expect(u).toMatchObject({ width: 1600, height: 1200 });
    for (const dir of ['', 't240', 't800', 't1280']) expect(exists(u.url, dir), dir).toBe(true);
    expect(await testPrisma.postAsset.findUnique({ where: { url: u.url } })).toMatchObject({ userId: 1, width: 1600, height: 1200 });
  });

  it('★ 글에 넣으면 치수·큰 썸네일 여부는 서버 기록이 이긴다', async () => {
    const u = await upload(a1, 1200, 800);
    const r = await createDocPost(a1, { doc: doc(fig(u.url, { width: 5, height: 5, large: false })) });
    const d = await request.get(`/api/community/${r.body.id}`);
    expect(d.body.doc.content[0].attrs).toMatchObject({ width: 1200, height: 800, large: true });
  });

  it('★ 글을 지우면 내가 올린 사진 파일만 지운다 — 다른 글이 쓰는 사진·남의 파일은 그대로', async () => {
    const mine = await upload(a1);
    const shared = await upload(a1);
    const others = await upload(a2);   // a2 가 올린 사진을 a1 이 API 로 넣은 경우
    const { body: { id } } = await createDocPost(a1, { doc: doc(fig(mine.url), fig(shared.url), fig(others.url)) });
    await createDocPost(a1, { doc: doc(fig(shared.url)) });
    await request.delete(`/api/community/${id}`).set(auth(a1));
    expect(exists(mine.url)).toBe(false);
    expect(exists(mine.url, 't1280')).toBe(false);
    expect(exists(shared.url)).toBe(true);
    expect(exists(others.url)).toBe(true);
  });

  it('고쳐서 뺀 사진도 지운다 — 작업본이 쓰고 있으면 남긴다', async () => {
    const a = await upload(a1);
    const b = await upload(a1);
    const { body: { id } } = await createDocPost(a1, { doc: doc(fig(a.url), fig(b.url)) });
    const dr = await request.post('/api/community/drafts').set(auth(a1)).send({ doc: doc(fig(b.url)) });
    expect(dr.status).toBe(201);
    await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: 't', doc: doc(p('사진 없음')) });
    expect(exists(a.url)).toBe(false);
    expect(exists(b.url)).toBe(true);
  });

  it('★ 버려진 사진 정리 — 3일 넘게 아무 글·작업본에도 없는 것만', async () => {
    const old = await upload(a1);
    const used = await upload(a1);
    const fresh = await upload(a1);
    await createDocPost(a1, { doc: doc(fig(used.url)) });
    await testPrisma.postAsset.updateMany({ where: { url: { in: [old.url, used.url] } }, data: { createdAt: new Date(Date.now() - ORPHAN_ASSET_MS - 60_000) } });
    expect(await prunePostAssets(Date.now(), true)).toBe(1);
    expect(exists(old.url)).toBe(false);
    expect(exists(used.url)).toBe(true);
    expect(exists(fresh.url)).toBe(true);
  });

  it('정리는 실패해도 던지지 않는다', async () => {
    expect(await cleanupPostImages(['/uploads/../etc/passwd', ''], 1)).toBe(0);
  });
});

describe('동영상 (2026-11-13)', () => {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const made: string[] = [];
  beforeEach(async () => { await cleanDb(); await seedUsers(); });
  afterAll(async () => { for (const u of made) await deleteUploadedFile(u); });
  const vid = (src: string, extra: Record<string, unknown> = {}) => ({ type: 'video', attrs: { src, ...extra } });
  async function uploadVideo(tok: string) {
    const r = await request.post('/api/upload/post-video').set(auth(tok)).attach('video', Buffer.from('fake mp4 bytes'), { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(r.status).toBe(200);
    made.push(r.body.url);
    return r.body as { url: string };
  }

  it('★ 글 동영상을 올리면 기록(PostAsset)이 남고, 글에 넣으면 videos 에 담긴다', async () => {
    const v = await uploadVideo(a1);
    expect(await testPrisma.postAsset.findUnique({ where: { url: v.url } })).toMatchObject({ userId: 1 });
    const r = await createDocPost(a1, { doc: doc(p('영상'), vid(v.url, { width: 1280, height: 720, caption: '작업 과정' })) });
    expect(r.status).toBe(201);
    const row = await testPrisma.post.findUnique({ where: { id: r.body.id } });
    expect(row).toMatchObject({ videos: [v.url], images: [] });
    const d = await request.get(`/api/community/${r.body.id}`);
    expect(d.body.doc.content[1]).toEqual({ type: 'video', attrs: { src: v.url, width: 1280, height: 720, caption: '작업 과정' } });
  });

  it('★ 동영상 칸에는 우리 저장소의 동영상만 — 바깥 주소·사진 주소·올리는 중이면 등록 400', async () => {
    expect((await createDocPost(a1, { doc: doc(vid('https://evil.example/a.mp4')) })).body.error).toMatch('다른 곳의 동영상');
    expect((await createDocPost(a1, { doc: doc(vid(IMG)) })).status).toBe(400);
    expect((await createDocPost(a1, { doc: doc(vid('')) })).body.error).toMatch('올라가는 중');
  });

  it('★ 글을 지우면 내가 올린 동영상 파일도 지운다 · 다른 글이 쓰면 남긴다', async () => {
    const a = await uploadVideo(a1);
    const b = await uploadVideo(a1);
    const one = await createDocPost(a1, { doc: doc(vid(a.url), vid(b.url)) });
    await createDocPost(a1, { doc: doc(vid(b.url)) });
    await request.delete(`/api/community/${one.body.id}`).set(auth(a1));
    expect(fs.existsSync(path.join(uploadsDir, path.basename(a.url)))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir, path.basename(b.url)))).toBe(true);
  });

  it('★ 버려진 파일 정리가 쓰고 있는 동영상을 지우지 않는다(사진과 똑같이 videos 도 본다)', async () => {
    const used = await uploadVideo(a1);
    const unused = await uploadVideo(a1);
    await createDocPost(a1, { doc: doc(vid(used.url)) });
    await testPrisma.postAsset.updateMany({ data: { createdAt: new Date(Date.now() - ORPHAN_ASSET_MS - 60_000) } });
    await prunePostAssets(Date.now(), true);
    expect(fs.existsSync(path.join(uploadsDir, path.basename(used.url)))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir, path.basename(unused.url)))).toBe(false);
  });
});

describe('투표 (2026-11-13)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });
  const poll = (extra: Record<string, unknown> = {}) => ({
    type: 'poll',
    attrs: { question: '다음 전시 주제는?', options: [{ id: 'aaaa1', text: '풍경' }, { id: 'bbbb2', text: '인물' }, { id: 'cccc3', text: '추상' }], multiple: false, endsAt: null, ...extra },
  });
  const vote = (tok: string, id: number, optionIds: string[]) => request.post(`/api/community/${id}/poll`).set(auth(tok)).send({ optionIds });

  it('★ 투표가 든 글 — 정의는 Post.poll, 결과는 투표한 사람·글쓴이에게만(먼저 보면 쏠린다), 참여 인원은 누구에게나', async () => {
    const r = await createDocPost(a1, { doc: doc(p('골라 주세요'), poll()) });
    expect(r.status).toBe(201);
    const row = await testPrisma.post.findUnique({ where: { id: r.body.id } });
    expect(row!.poll).toMatchObject({ question: '다음 전시 주제는?', multiple: false });
    // 아직 안 한 사람 — 표 수 없음
    const before = await request.get(`/api/community/${r.body.id}`).set(auth(a2));
    expect(before.body.poll).toMatchObject({ voters: 0, showResults: false, myVotes: [] });
    expect(before.body.poll.options.every((o: { count: number | null }) => o.count === null)).toBe(true);
    // 투표하면 결과가 보인다
    const v = await vote(a2, r.body.id, ['bbbb2']);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ voters: 1, showResults: true, myVotes: ['bbbb2'] });
    expect(v.body.options.find((o: { id: string }) => o.id === 'bbbb2').count).toBe(1);
    // 글쓴이는 안 해도 본다 · 비로그인은 못 본다
    expect((await request.get(`/api/community/${r.body.id}`).set(auth(a1))).body.poll.showResults).toBe(true);
    const guest = await request.get(`/api/community/${r.body.id}`);
    expect(guest.body.poll).toMatchObject({ voters: 1, showResults: false });
  });

  it('★ 단일 선택은 하나만 · 바꾸면 바뀐다(두 표가 되지 않는다) · 동시에 눌러도 한 표 · 취소', async () => {
    const { body: { id } } = await createDocPost(a1, { doc: doc(poll()) });
    expect((await vote(a2, id, ['aaaa1', 'bbbb2'])).body.error).toBe('하나만 고를 수 있어요.');
    expect((await vote(a2, id, ['zzzz9'])).status).toBe(400);
    await vote(a2, id, ['aaaa1']);
    await vote(a2, id, ['cccc3']);
    expect(await testPrisma.postPollVote.findMany({ where: { postId: id, userId: 2 }, select: { optionId: true } })).toEqual([{ optionId: 'cccc3' }]);
    await Promise.all(['aaaa1', 'bbbb2', 'cccc3', 'aaaa1', 'bbbb2'].map((o) => vote(gallery, id, [o])));
    expect(await testPrisma.postPollVote.count({ where: { postId: id, userId: 3 } })).toBe(1);
    const c = await request.delete(`/api/community/${id}/poll`).set(auth(a2));
    expect(c.body).toMatchObject({ myVotes: [] });
  });

  it('복수 선택 · 마감된 투표는 못 바꾼다', async () => {
    const multi = await createDocPost(a1, { doc: doc(poll({ multiple: true })) });
    const v = await vote(a2, multi.body.id, ['aaaa1', 'cccc3']);
    expect(v.body.myVotes.sort()).toEqual(['aaaa1', 'cccc3']);
    const closed = await createDocPost(a1, { doc: doc(poll({ endsAt: new Date(Date.now() + 60_000).toISOString() })) });
    await testPrisma.post.update({ where: { id: closed.body.id }, data: { poll: { question: 'q', options: [{ id: 'aaaa1', text: 'a' }, { id: 'bbbb2', text: 'b' }], multiple: false, endsAt: new Date(Date.now() - 1000).toISOString() } } });
    expect((await vote(a2, closed.body.id, ['aaaa1'])).body.error).toBe('마감된 투표예요.');
    // 마감되면 누구나 결과를 본다
    expect((await request.get(`/api/community/${closed.body.id}`)).body.poll).toMatchObject({ closed: true, showResults: true });
  });

  it('★ 표가 생긴 뒤엔 질문·보기를 못 바꾼다(마감만) · 투표를 빼면 표도 지운다', async () => {
    const { body: { id } } = await createDocPost(a1, { doc: doc(p('본문'), poll()) });
    await vote(a2, id, ['aaaa1']);
    const changed = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('본문'), poll({ question: '바꾼 질문' })) });
    expect(changed.status).toBe(400);
    expect(changed.body.error).toMatch('마감 시각만');
    const ends = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ok = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('본문'), poll({ endsAt: ends })) });
    expect(ok.status).toBe(200);
    expect(await testPrisma.postPollVote.count({ where: { postId: id } })).toBe(1);
    const removed = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('본문')) });
    expect(removed.status).toBe(200);
    expect(await testPrisma.postPollVote.count({ where: { postId: id } })).toBe(0);
    expect((await testPrisma.post.findUnique({ where: { id } }))!.poll).toBeNull();
  });

  it('★ 고치는 작업본이 표가 있는지 알려 준다(pollLocked) · 빼고 새 투표를 넣으면(보기 id 가 하나도 안 겹친다) 받고 옛 표를 지운다', async () => {
    const { body: { id } } = await createDocPost(a1, { doc: doc(p('본문'), poll()) });
    const before = await request.post('/api/community/drafts').set(auth(a1)).send({ postId: id });
    expect(before.body.pollLocked).toBe(false);
    await request.delete(`/api/community/drafts/${before.body.id}`).set(auth(a1));
    await vote(a2, id, ['aaaa1']);
    const locked = await request.post('/api/community/drafts').set(auth(a1)).send({ postId: id });
    expect(locked.body.pollLocked).toBe(true);
    expect((await request.get(`/api/community/drafts/${locked.body.id}`).set(auth(a1))).body.pollLocked).toBe(true);
    // 보기 하나라도 같은 id 면 '고친 것' — 막는다
    const edited = poll({ options: [{ id: 'aaaa1', text: '풍경' }, { id: 'nnnn1', text: '정물' }] });
    expect((await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('본문'), edited) })).status).toBe(400);
    // 전부 새 id — 새 투표로 받는다
    const fresh = poll({ question: '새 질문', options: [{ id: 'nnnn1', text: '하나' }, { id: 'nnnn2', text: '둘' }] });
    const ok = await request.patch(`/api/community/${id}`).set(auth(a1)).send({ title: '고침', doc: doc(p('본문'), fresh) });
    expect(ok.status).toBe(200);
    expect(await testPrisma.postPollVote.count({ where: { postId: id } })).toBe(0);
    expect((await testPrisma.post.findUnique({ where: { id } }))!.poll).toMatchObject({ question: '새 질문' });
  });

  it('등록 규칙 — 질문과 보기 둘 이상 · 한 글에 하나 · 마감은 1년 안', async () => {
    expect((await createDocPost(a1, { doc: doc(poll({ question: '' })) })).body.error).toBe('투표 질문을 써 주세요.');
    expect((await createDocPost(a1, { doc: doc(poll({ options: [{ id: 'aaaa1', text: '하나' }, { id: 'bbbb2', text: ' ' }] })) })).body.error).toMatch('2개 이상');
    expect((await createDocPost(a1, { doc: doc(poll(), poll()) })).body.error).toBe('투표는 한 글에 하나만 넣을 수 있어요.');
    expect((await createDocPost(a1, { doc: doc(poll({ endsAt: new Date(Date.now() + 400 * 86_400_000).toISOString() })) })).status).toBe(400);
    // 투표만 있는 글도 올릴 수 있다(질문이 글이다)
    const only = await createDocPost(a1, { doc: doc(poll()) });
    expect(only.status).toBe(201);
    expect((await testPrisma.post.findUnique({ where: { id: only.body.id } }))!.body).toBe('다음 전시 주제는?');
  });
});

describe('대댓글 · 프로필 (2026-11-13)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });
  const comment = (tok: string, id: number, body: string, extra: Record<string, unknown> = {}) =>
    request.post(`/api/community/${id}/comments`).set(auth(tok)).send({ body, ...extra });
  const notes = (userId: number, type: string) => testPrisma.notification.findMany({ where: { userId, type } });

  it('★ 답글은 맨 위 댓글 아래에 한 단계로 · 답글의 답글은 누구에게 단 답인지 적는다', async () => {
    const { body: { id } } = await createDocPost(a1);
    const top = await comment(a2, id, '첫 댓글');
    const reply = await comment(gallery, id, '답글', { replyTo: top.body.id });
    expect(reply.body).toMatchObject({ parentId: top.body.id, replyToId: top.body.id });
    const deep = await comment(a1, id, '답글의 답글', { replyTo: reply.body.id });
    expect(deep.body.parentId).toBe(top.body.id);   // 한 단계 — 맨 위 댓글에 붙는다
    const d = await request.get(`/api/community/${id}`);
    expect(d.body.comments).toHaveLength(1);
    expect(d.body.comments[0].replies.map((r: { body: string }) => r.body)).toEqual(['답글', '답글의 답글']);
    expect(d.body.comments[0].replies[0].replyTo).toBeNull();   // 맨 위 댓글에 단 답은 따로 안 적는다
    expect(d.body.comments[0].replies[1].replyTo).toEqual({ name: 'Gallery Owner' });
    expect(d.body.commentCount).toBe(3);
  });

  it('★ 답글 알림 — 답을 받은 사람에게 COMMENT_REPLY, 글쓴이에게 POST_COMMENT(같은 사람이면 한 통)', async () => {
    const { body: { id } } = await createDocPost(a1);
    const top = await comment(a2, id, '질문 있어요');       // 글쓴이(1)에게 POST_COMMENT
    await comment(gallery, id, '저도요', { replyTo: top.body.id });   // a2 에게 답글 알림 + 글쓴이에게 댓글 알림
    await comment(a1, id, '답해 드릴게요', { replyTo: top.body.id }); // 글쓴이 본인 → a2 에게 답글 알림만
    expect(await notes(2, 'COMMENT_REPLY')).toHaveLength(2);
    expect((await notes(2, 'COMMENT_REPLY'))[0].linkUrl).toMatch(new RegExp(`^/community/${id}\\?comment=\\d+$`));
    expect(await notes(1, 'POST_COMMENT')).toHaveLength(2);
    // 글쓴이의 댓글에 답하면 — 글쓴이에게는 한 통(답글)
    const mine = await comment(a1, id, '글쓴이 댓글');
    await comment(a2, id, '답', { replyTo: mine.body.id });
    expect(await notes(1, 'COMMENT_REPLY')).toHaveLength(1);
    expect(await notes(1, 'POST_COMMENT')).toHaveLength(2);
  });

  it('★ 댓글 @멘션은 없다 — 댓글에 @이름을 써도 MENTION 알림이 가지 않는다', async () => {
    await testPrisma.follow.createMany({ data: [{ followerId: 1, followingId: 2 }, { followerId: 2, followingId: 1 }] });
    const { body: { id } } = await createDocPost(a2);
    await comment(a1, id, '@Artist 2 이거 보세요');
    expect(await notes(2, 'MENTION')).toHaveLength(0);
  });

  it('★ 답글이 달린 댓글을 지우면 자리만 남는다 · 마지막 답글이 지워지면 자리도 치운다 · 카운트는 정확', async () => {
    const { body: { id } } = await createDocPost(a1);
    const top = await comment(a2, id, '지울 댓글');
    const r1 = await comment(gallery, id, '답글', { replyTo: top.body.id });
    expect((await request.delete(`/api/community/${id}/comments/${top.body.id}`).set(auth(a2))).status).toBe(200);
    let d = await request.get(`/api/community/${id}`);
    expect(d.body.comments[0]).toMatchObject({ deleted: true, body: '', author: null });
    expect(d.body.comments[0].replies).toHaveLength(1);
    expect(d.body.commentCount).toBe(1);
    // 지운 댓글엔 답글을 못 단다 · 두 번 지워도 카운트는 한 번만
    expect((await comment(a1, id, 'x', { replyTo: top.body.id })).status).toBe(400);
    expect((await request.delete(`/api/community/${id}/comments/${top.body.id}`).set(auth(a2))).status).toBe(404);
    await request.delete(`/api/community/${id}/comments/${r1.body.id}`).set(auth(gallery));
    d = await request.get(`/api/community/${id}`);
    expect(d.body.comments).toHaveLength(0);
    expect(d.body.commentCount).toBe(0);
    expect(await testPrisma.postComment.count({ where: { postId: id } })).toBe(0);
  });

  it('남의 글 댓글에는 답글로 붙지 않는다(404)', async () => {
    const one = await createDocPost(a1);
    const two = await createDocPost(a1);
    const c = await comment(a2, one.body.id, '여기');
    expect((await comment(a2, two.body.id, '저기', { replyTo: c.body.id })).status).toBe(404);
  });

  it('★ 프로필 카드 — 실명인 글쓴이·댓글 쓴 사람의 홈페이지·소개만(익명은 싣지 않는다)', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { handle: 'artist.two' } });
    await testPrisma.portfolio.create({ data: { userId: 2, biography: '', tagline: '두 번째 작가' } });
    const { body: { id } } = await createDocPost(a1);
    await comment(a2, id, '실명 댓글');
    await comment(gallery, id, '익명 댓글', { anonymous: true });
    const d = await request.get(`/api/community/${id}`);
    expect(d.body.profiles['2']).toEqual({ homepage: '/@artist.two', intro: '두 번째 작가' });
    expect(d.body.profiles['3']).toBeUndefined();   // 익명 댓글의 작성자는 싣지 않는다
    expect(d.body.comments[1].author).toMatchObject({ id: null, name: '익명' });
  });
});

