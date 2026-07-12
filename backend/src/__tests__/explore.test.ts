import { describe, it, expect, beforeEach } from 'vitest';
import { request, cleanDb, seedUsers, testPrisma } from './helpers';

// artist1(id1) 3장, artist2(id2) 3장을 둘러보기 공개로 시드. { a:[ids], b:[ids] } 반환
async function seedExploreData() {
  const p1 = await testPrisma.portfolio.create({ data: { userId: 1 } });
  const p2 = await testPrisma.portfolio.create({ data: { userId: 2 } });
  const out: { a: number[]; b: number[] } = { a: [], b: [] };
  for (let i = 0; i < 3; i++) {
    const im = await testPrisma.portfolioImage.create({ data: { portfolioId: p1.id, url: `/u/a${i}.jpg`, showInExplore: true } });
    out.a.push(im.id);
  }
  for (let i = 0; i < 3; i++) {
    const im = await testPrisma.portfolioImage.create({ data: { portfolioId: p2.id, url: `/u/b${i}.jpg`, showInExplore: true } });
    out.b.push(im.id);
  }
  return out;
}

describe('GET /api/explore', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('random(기본): 같은 작가 작품이 연속으로 나오지 않는다', async () => {
    await seedExploreData();
    const res = await request.get('/api/explore?sort=random&seed=42&limit=60');
    expect(res.status).toBe(200);
    const arts = res.body.images.map((i: any) => i.artist.id);
    expect(arts.length).toBe(6);
    for (let i = 1; i < arts.length; i++) expect(arts[i]).not.toBe(arts[i - 1]);
  });

  it('random: 같은 seed는 같은 순서(결정적)', async () => {
    await seedExploreData();
    const a = (await request.get('/api/explore?sort=random&seed=1&limit=60')).body.images.map((i: any) => i.id);
    const b = (await request.get('/api/explore?sort=random&seed=1&limit=60')).body.images.map((i: any) => i.id);
    expect(a).toEqual(b);
  });

  it('random: 페이지 경계에서도 일관된 순서(중복·누락 없음)', async () => {
    await seedExploreData();
    const seed = 7;
    const p1 = (await request.get(`/api/explore?sort=random&seed=${seed}&page=1&limit=4`)).body.images.map((i: any) => i.id);
    const p2 = (await request.get(`/api/explore?sort=random&seed=${seed}&page=2&limit=4`)).body.images.map((i: any) => i.id);
    const full = (await request.get(`/api/explore?sort=random&seed=${seed}&page=1&limit=60`)).body.images.map((i: any) => i.id);
    expect([...p1, ...p2]).toEqual(full);
    expect(new Set(full).size).toBe(6);
  });

  it('random: 작은 작가가 항상 뒤로 몰리지 않고 골고루 섞인다 (+ 연속 없음)', async () => {
    // 중간 작가 3명(5,5,4) + 작은 작가 2명(1,1) = 16장 — 예전 "최다 우선"이면 작은 작가가 뒤로 몰렸음
    const a5 = await testPrisma.user.create({ data: { email: 'a5@t.com', name: 'A5', role: 'ARTIST' } });
    const owners: [number, number][] = [[1, 5], [2, 5], [3, 4], [4, 1], [a5.id, 1]];
    for (const [uid, n] of owners) {
      const p = await testPrisma.portfolio.create({ data: { userId: uid } });
      for (let i = 0; i < n; i++) {
        await testPrisma.portfolioImage.create({ data: { portfolioId: p.id, url: `/${uid}_${i}.jpg`, showInExplore: true } });
      }
    }
    const small = new Set([4, a5.id]);
    let frontHalfHits = 0;
    const seeds = 16;
    for (let s = 1; s <= seeds; s++) {
      const arts = (await request.get(`/api/explore?sort=random&seed=${s * 7}&limit=60`)).body.images.map((i: any) => i.artist.id);
      for (let i = 1; i < arts.length; i++) expect(arts[i]).not.toBe(arts[i - 1]); // 연속 없음(feasible)
      const front = arts.slice(0, Math.floor(arts.length / 2));
      if (front.some((a: number) => small.has(a))) frontHalfHits++;
    }
    expect(frontHalfHits).toBeGreaterThan(seeds / 2); // 뒤로만 몰리면 0에 가까움
  });

  it('popular: 기간(하루/전체)별 받은 좋아요 수로 정렬, 배지는 전체 좋아요 수', async () => {
    const { a, b } = await seedExploreData();
    const recent = new Date();
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    const like = (userId: number, imageId: number, createdAt: Date) =>
      testPrisma.portfolioImageLike.create({ data: { userId, imageId, createdAt } });
    // 최근 하루: a0=3, b0=1 / 오래됨(40일 전): a1=4
    await like(1, a[0], recent); await like(2, a[0], recent); await like(3, a[0], recent);
    await like(1, b[0], recent);
    await like(1, a[1], old); await like(2, a[1], old); await like(3, a[1], old); await like(4, a[1], old);

    const day = (await request.get('/api/explore?sort=popular&period=day&limit=60')).body.images;
    expect(day[0].id).toBe(a[0]); // 최근 하루 최다

    const all = (await request.get('/api/explore?sort=popular&period=all&limit=60')).body.images;
    expect(all[0].id).toBe(a[1]); // 전체 기간 최다(4개)
    expect(all.find((x: any) => x.id === a[1]).likeCount).toBe(4); // 배지=전체 좋아요 수
  });
});
