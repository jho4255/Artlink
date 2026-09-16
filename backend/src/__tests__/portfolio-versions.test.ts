/**
 * 포트폴리오 PDF 버전 — `routes/portfolio.ts` `/versions` (2026-09-16)
 *
 * 지켜야 하는 것:
 *  ① 버전은 **내 포트폴리오의 작품 id 만** 담는다 — 남의 작품 id·없는 id 는 조용히 버린다(그대로 두면 PDF 에 남의 그림이 들어간다)
 *  ② 남의 버전은 404 (403 은 존재를 알려준다 — 규칙 23)
 *  ③ 홈페이지 작품 순서(PortfolioImage.order)는 버전이 건드리지 않는다
 *  ④ 상한(12개) — 무한히 늘리면 화면의 버전 바가 무너진다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const artist = authToken(1, 'ARTIST');
const other = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');

async function seedWorks(userId: number, n: number) {
  const p = await testPrisma.portfolio.upsert({ where: { userId }, update: {}, create: { userId } });
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const im = await testPrisma.portfolioImage.create({ data: { portfolioId: p.id, url: `/uploads/${userId}-${i}.jpg`, order: i, title: `작품 ${i + 1}` } });
    ids.push(im.id);
  }
  return ids;
}

describe('포트폴리오 PDF 버전', () => {
  let mine: number[];
  let theirs: number[];
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    mine = await seedWorks(1, 5);
    theirs = await seedWorks(2, 2);
  });

  it('만들고 → 내 포트폴리오 조회에 실리고 → 고치고 → 지운다', async () => {
    const created = await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`)
      .send({ name: '공모용 3점', workIds: [mine[4], mine[0], mine[2]], design: { worksLayout: 'hero', page: 'a4-portrait' } });
    expect(created.status).toBe(201);
    expect(created.body.workIds).toEqual([mine[4], mine[0], mine[2]]);   // 보낸 순서 그대로
    expect(created.body.design).toEqual({ worksLayout: 'hero', page: 'a4-portrait' });

    const me = await request.get('/api/portfolio').set('Authorization', `Bearer ${artist}`);
    expect(me.body.versions).toHaveLength(1);
    expect(me.body.versions[0].name).toBe('공모용 3점');

    const patched = await request.patch(`/api/portfolio/versions/${created.body.id}`).set('Authorization', `Bearer ${artist}`)
      .send({ name: '공모용 2점', workIds: [mine[1], mine[3]] });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('공모용 2점');
    expect(patched.body.workIds).toEqual([mine[1], mine[3]]);
    expect(patched.body.design).toEqual({ worksLayout: 'hero', page: 'a4-portrait' });   // 안 보낸 필드는 유지

    expect((await request.delete(`/api/portfolio/versions/${created.body.id}`).set('Authorization', `Bearer ${artist}`)).status).toBe(200);
    expect((await request.get('/api/portfolio').set('Authorization', `Bearer ${artist}`)).body.versions).toEqual([]);
  });

  it('★ 남의 작품 id·없는 id·중복은 조용히 버린다 — PDF 에 남의 그림이 들어가면 안 된다', async () => {
    const r = await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`)
      .send({ name: '섞인 목록', workIds: [mine[0], theirs[0], 999999, mine[0], mine[1], 'x'] });
    expect(r.status).toBe(201);
    expect(r.body.workIds).toEqual([mine[0], mine[1]]);
  });

  it('★ 남의 버전은 고치지도 지우지도 못한다 — 404', async () => {
    const v = await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`).send({ name: '내 것' });
    expect((await request.patch(`/api/portfolio/versions/${v.body.id}`).set('Authorization', `Bearer ${other}`).send({ name: '훔침' })).status).toBe(404);
    expect((await request.delete(`/api/portfolio/versions/${v.body.id}`).set('Authorization', `Bearer ${other}`)).status).toBe(404);
    // 그대로 남아 있다
    const me = await request.get('/api/portfolio').set('Authorization', `Bearer ${artist}`);
    expect(me.body.versions[0].name).toBe('내 것');
  });

  it('버전을 만들어도 홈페이지 작품 순서는 그대로다', async () => {
    await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`).send({ name: '역순', workIds: [...mine].reverse() });
    const me = await request.get('/api/portfolio').set('Authorization', `Bearer ${artist}`);
    expect(me.body.images.map((i: { id: number }) => i.id)).toEqual(mine);
  });

  it('이름이 비면 400, 작가가 아니면 403, 상한을 넘으면 400', async () => {
    expect((await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`).send({ name: '  ' })).status).toBe(400);
    expect((await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${gallery}`).send({ name: 'x' })).status).toBe(403);
    expect((await request.post('/api/portfolio/versions').send({ name: 'x' })).status).toBe(401);
    for (let i = 0; i < 12; i++) {
      expect((await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`).send({ name: `v${i}` })).status).toBe(201);
    }
    expect((await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`).send({ name: 'v13' })).status).toBe(400);
  });

  it('작품을 지우면 버전에서도 빠져야 한다 — 지운 작품 id 가 남아 있어도 조회 쪽이 거른다', async () => {
    // 서버는 workIds 를 저장할 때만 검사한다. 지운 뒤에도 배열엔 id 가 남으므로 **화면이 실제 작품과 교집합**을 취한다.
    // 여기서는 서버가 죽지 않고 그대로 내려주는지만 본다(화면 쪽 규칙은 프론트 테스트가 잠근다).
    const v = await request.post('/api/portfolio/versions').set('Authorization', `Bearer ${artist}`).send({ name: 'v', workIds: [mine[0], mine[1]] });
    await request.delete(`/api/portfolio/images/${mine[0]}`).set('Authorization', `Bearer ${artist}`);
    const me = await request.get('/api/portfolio').set('Authorization', `Bearer ${artist}`);
    expect(me.body.versions[0].id).toBe(v.body.id);
    expect(me.body.images.map((i: { id: number }) => i.id)).not.toContain(mine[0]);
  });
});
