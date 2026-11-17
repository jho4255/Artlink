/**
 * 갤러리 찾기 개편 (2026-11-15) — `GET /galleries` 카드의 '모집 중'·'전시 중' 한 줄과 기본 순서.
 *  · 모집 중 = 모집공고 [모집 중] 과 **같은 규칙**(lib/openCalls.ts) — 수동 마감·지난 마감·시작 전·심사 중은 아니다
 *  · 아트링크 주최 공모를 운영하는 갤러리도 모집 중이다(위임은 아트링크 주최일 때만 — 규칙 22)
 *  · 전시 중 = 갤러리 홈페이지 '지금 전시'와 같은 규칙(진행 중 > 60일 안 시작)
 *  · 기본 순서 = 모집 중인 갤러리 먼저, 그 안은 누적 조회수 순 · [리뷰순]은 그대로 · 내 갤러리 목록은 순서를 바꾸지 않는다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, testPrisma } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY);

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

async function gallery(name: string, data: Record<string, unknown> = {}) {
  return testPrisma.gallery.create({
    data: {
      name, address: '서울시 종로구 삼일대로 1', phone: '02-0000-0000', description: `${name} 소개`,
      region: 'SEOUL', ownerName: '대표', status: 'APPROVED', ownerId: 3, ...data,
    },
  });
}

async function call(galleryId: number | null, data: Record<string, unknown> = {}) {
  return testPrisma.exhibition.create({
    data: {
      title: `공모 ${Math.random().toString(36).slice(2, 7)}`, type: 'GROUP', deadline: at(10), exhibitDate: at(40),
      capacity: 5, region: 'SEOUL', description: '소개', status: 'APPROVED', galleryId, ...data,
    },
  });
}

async function show(galleryId: number, start: number, end: number, data: Record<string, unknown> = {}) {
  return testPrisma.show.create({
    data: {
      title: `전시 ${start}~${end}`, description: '전시', startDate: at(start), endDate: at(end), openingHours: '10-18',
      admissionFee: '무료', location: '서울', region: 'SEOUL', posterImage: '/uploads/p.jpg', artists: null,
      status: 'APPROVED', galleryId, ...data,
    },
  });
}

const list = async (query = '') => (await request.get(`/api/galleries${query}`)).body as Array<Record<string, any>>;
const byName = (rows: Array<Record<string, any>>, name: string) => rows.find((g) => g.name === name)!;

describe('카드의 모집 중 한 줄 — 모집공고 [모집 중] 과 같은 규칙', () => {
  it('마감이 가장 가까운 공모와 모집 중 공모 수를 싣는다', async () => {
    const g = await gallery('온결');
    const far = await call(g.id, { title: '먼 공모', deadline: at(20) });
    const near = await call(g.id, { title: '가까운 공모', deadline: at(3) });
    const row = byName(await list(), '온결');
    expect(row.openCall).toMatchObject({ id: near.id, title: '가까운 공모', count: 2 });
    expect(new Date(row.openCall.deadline).getTime()).toBe(near.deadline.getTime());
    expect(far.id).not.toBe(near.id);

    // 모집공고 [모집 중] 목록에도 둘 다 있다(같은 규칙)
    const open = (await request.get('/api/exhibitions')).body as Array<{ id: number }>;
    expect(open.map((e) => e.id).sort()).toEqual([far.id, near.id].sort());
  });

  it('수동 마감 · 지난 마감 · 시작 전 · 심사 중 공모는 모집 중이 아니다', async () => {
    const g = await gallery('서림');
    await call(g.id, { recruitmentClosed: true });
    await call(g.id, { deadline: at(-1) });
    await call(g.id, { deadlineStart: at(3), deadline: at(10) });
    await call(g.id, { status: 'PENDING' });
    expect(byName(await list(), '서림').openCall).toBeNull();
    expect((await request.get('/api/exhibitions')).body).toHaveLength(0);
  });

  it('마감일 당일은 종일 모집 중이다(KST)', async () => {
    const g = await gallery('해담');
    await call(g.id, { deadline: new Date() });
    expect(byName(await list(), '해담').openCall).not.toBeNull();
  });

  it('아트링크 주최 공모를 운영하는 갤러리도 모집 중 — 갤러리 주최 공모에 섞인 위임 행은 인정하지 않는다', async () => {
    const a = await gallery('운영 갤러리');
    const b = await gallery('엉뚱한 위임');
    const owner = await gallery('주관 갤러리');
    const hosted = await call(null, { hostType: 'ADMIN', title: '아트링크 기획' });
    await testPrisma.exhibitionManager.create({ data: { exhibitionId: hosted.id, galleryId: a.id } });
    const own = await call(owner.id, { title: '갤러리 주최' });
    await testPrisma.exhibitionManager.create({ data: { exhibitionId: own.id, galleryId: b.id } });

    const rows = await list();
    expect(byName(rows, '운영 갤러리').openCall).toMatchObject({ id: hosted.id, count: 1 });
    expect(byName(rows, '엉뚱한 위임').openCall).toBeNull();
    expect(byName(rows, '주관 갤러리').openCall).toMatchObject({ id: own.id, count: 1 });
  });
});

describe('카드의 전시 중 한 줄 — 갤러리 홈페이지 지금 전시와 같은 규칙', () => {
  it('진행 중(끝나는 날이 가까운 것 먼저) > 60일 안 시작 · 끝난 것·먼 것·심사 중은 없다', async () => {
    const g1 = await gallery('진행');
    await show(g1.id, -10, 30, { title: '늦게 끝남' });
    await show(g1.id, -3, 5, { title: '곧 끝남' });
    await show(g1.id, 2, 20, { title: '곧 시작' });
    const g2 = await gallery('예정');
    await show(g2.id, 20, 40, { title: '나중 시작' });
    await show(g2.id, 10, 40, { title: '먼저 시작' });
    const g3 = await gallery('없음');
    await show(g3.id, -30, -1);
    await show(g3.id, 90, 120);
    await show(g3.id, -1, 10, { status: 'PENDING' });

    const rows = await list();
    expect(byName(rows, '진행').nowShow).toMatchObject({ state: 'ongoing', title: '곧 끝남' });
    expect(byName(rows, '예정').nowShow).toMatchObject({ state: 'upcoming', title: '먼저 시작' });
    expect(byName(rows, '없음').nowShow).toBeNull();

    // 갤러리 홈페이지와 같은 답
    for (const g of [g1, g2, g3]) {
      const page = (await request.get(`/api/galleries/${g.id}`)).body;
      expect(page.nowShow?.title ?? null).toBe(byName(rows, g.name).nowShow?.title ?? null);
    }
  });
});

describe('기본 순서 — 모집 중인 갤러리 먼저, 그 안은 누적 조회수 순', () => {
  it('모집 중(조회수 순) → 나머지(조회수 순) · [리뷰순]은 리뷰 개수 순', async () => {
    const quiet = await gallery('조용한 큰 곳', { viewCount: 100, reviewCount: 1 });
    const smallCall = await gallery('모집 작은 곳', { viewCount: 5, reviewCount: 9 });
    const bigCall = await gallery('모집 큰 곳', { viewCount: 50 });
    const tiny = await gallery('작은 곳', { viewCount: 10, reviewCount: 3 });
    await call(smallCall.id);
    await call(bigCall.id);
    void quiet; void tiny;

    expect((await list()).map((g) => g.name)).toEqual(['모집 큰 곳', '모집 작은 곳', '조용한 큰 곳', '작은 곳']);
    expect((await list('?sortBy=reviewCount')).map((g) => g.name)).toEqual(['모집 작은 곳', '작은 곳', '조용한 큰 곳', '모집 큰 곳']);
  });

  it('지역·검색어로 걸러도 같은 순서 규칙 · 내 갤러리 목록은 등록 순 그대로', async () => {
    const first = await gallery('먼저 등록', { viewCount: 1 });
    const second = await gallery('나중 등록', { viewCount: 99 });
    await gallery('부산 갤러리', { region: 'BUSAN', viewCount: 500 });
    await call(first.id);

    expect((await list('?region=SEOUL')).map((g) => g.name)).toEqual(['먼저 등록', '나중 등록']);
    expect((await list('?q=등록')).map((g) => g.name)).toEqual(['먼저 등록', '나중 등록']);

    const mine = await request.get('/api/galleries?owned=true').set({ Authorization: `Bearer ${authToken(3, 'GALLERY')}` });
    expect(mine.body.map((g: { name: string }) => g.name)).toEqual(['부산 갤러리', '나중 등록', '먼저 등록']);
    void second;
  });
});

describe('모집공고 목록 — 검색어가 모집 중 조건을 덮어쓰지 않는다', () => {
  it('모집 중 + 검색어: 시작 전 공모는 여전히 빠진다 · 마감 + 검색어도 그대로', async () => {
    const g = await gallery('검색');
    const open = await call(g.id, { title: '수채화 공모' });
    await call(g.id, { title: '수채화 예정', deadlineStart: at(3), deadline: at(10) });
    const closed = await call(g.id, { title: '수채화 지난 공모', deadline: at(-2) });
    await call(g.id, { title: '유화 공모' });

    const openHits = (await request.get(`/api/exhibitions?q=${encodeURIComponent('수채화')}`)).body as Array<{ id: number }>;
    expect(openHits.map((e) => e.id)).toEqual([open.id]);
    const closedHits = (await request.get(`/api/exhibitions?scope=closed&q=${encodeURIComponent('수채화')}`)).body as Array<{ id: number }>;
    expect(closedHits.map((e) => e.id)).toEqual([closed.id]);
  });
});
