/**
 * 홈 ArtWorks · [작가] 탭 작품 격자 — 홈페이지를 채운 작가 먼저 (2026-10-06 사용자 결정)
 *
 * 완성도 4항목(작품 3점 · 모든 작품에 작품 정보 · 작가노트 · 약력) 중 3개 이상 채운 작가의 작품이 랜덤 정렬에서 앞에 온다.
 * 판정은 `lib/artistCompleteness.ts` — 작가가 보는 완성도(프론트 `lib/completeness.ts`)와 같은 규칙이어야 한다.
 * [좋아요순]은 그대로다(보는 사람이 고른 정렬).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, cleanDb, seedUsers, testPrisma } from './helpers';
import { filledCount, hasCareer, PRIORITY_MIN_FILLED } from '../lib/artistCompleteness';

const CAP = { title: '무제', medium: '캔버스에 유채', sizeText: '90 × 72 cm', year: '2025' };

/** 작가 하나 — n 점(shown 은 그중 '작가 탭에도' 수, 앞에서부터), 정보·노트·약력은 골라서 */
async function seedArtist(o: {
  email: string; n: number; shown?: number; captions?: boolean;
  statement?: string; biography?: string; career?: string;
}) {
  const u = await testPrisma.user.create({ data: { email: o.email, name: o.email.split('@')[0], role: 'ARTIST' } });
  const p = await testPrisma.portfolio.create({
    data: { userId: u.id, statement: o.statement ?? null, biography: o.biography ?? null, career: o.career ?? null },
  });
  const shown = o.shown ?? o.n;
  for (let i = 0; i < o.n; i++) {
    await testPrisma.portfolioImage.create({
      data: { portfolioId: p.id, url: `/uploads/${u.id}_${i}.jpg`, showInExplore: i < shown, ...(o.captions ? CAP : {}) },
    });
  }
  return u.id;
}

describe('완성도 판정(서버판) — 작가가 보는 완성도와 같은 규칙', () => {
  it('네 항목을 센다', () => {
    const cap = { ...CAP };
    expect(filledCount({ statement: '노트', biography: '약력', images: [cap, cap, cap] })).toBe(4);
    expect(filledCount({ statement: '노트', images: [cap, cap, cap] })).toBe(3);                 // 약력 없음
    expect(filledCount({ statement: '  ', biography: ' ', images: [cap, cap] })).toBe(1);       // 2점·공백뿐인 글 → 작품 정보만
    expect(filledCount({ biography: '약력', images: [cap, cap, {}] })).toBe(2);                  // 정보 없는 작품 하나 → 작품 정보 ✗
    expect(filledCount({ images: [] })).toBe(0);                                                // 작품 0점이면 '작품 정보'도 ✗
  });

  it('작품 정보는 작품명·재료·크기·연도 중 하나만 있어도 된다', () => {
    const imgs = [{ year: '2024' }, { medium: '종이에 먹' }, { title: '봄' }];
    expect(filledCount({ images: imgs })).toBe(2);
  });

  it('약력은 글 또는 항목별 경력 — 경력 JSON 이 깨져 있으면 없는 것으로', () => {
    expect(hasCareer(JSON.stringify({ solo: [{ year: '2024', content: '개인전' }] }))).toBe(true);
    expect(hasCareer(JSON.stringify({ education: [{ content: '학사' }] }))).toBe(true);
    expect(hasCareer(JSON.stringify({ solo: [], group: [] }))).toBe(false);
    expect(hasCareer('{깨진')).toBe(false);
    expect(hasCareer(null)).toBe(false);
    expect(filledCount({ statement: '노트', career: JSON.stringify({ award: [{ content: '대상' }] }), images: [CAP, CAP, CAP] })).toBe(4);
  });

  it('기준은 3칸', () => {
    expect(PRIORITY_MIN_FILLED).toBe(3);
  });
});

describe('랜덤 정렬 — 홈페이지를 채운 작가(3/4 이상) 먼저', () => {
  let full: number, three: number, careerOnly: number, two: number, bare: number;
  const priority = () => new Set([full, three, careerOnly]);

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    full = await seedArtist({ email: 'full@t.com', n: 3, captions: true, statement: '노트', biography: '약력' });          // 4/4
    three = await seedArtist({ email: 'three@t.com', n: 4, captions: true, statement: '노트' });                          // 3/4 (약력 없음)
    // 3/4 — 약력은 항목별 경력만, 작품 정보는 없음. 작품 중 1점은 '홈페이지에만'(작품 수엔 들어간다)
    careerOnly = await seedArtist({ email: 'career@t.com', n: 3, shown: 2, statement: '노트', career: JSON.stringify({ solo: [{ year: '2025', content: '개인전' }] }) });
    two = await seedArtist({ email: 'two@t.com', n: 5, biography: '약력' });                                              // 2/4 (작품 3점+·약력)
    bare = await seedArtist({ email: 'bare@t.com', n: 2 });                                                               // 0/4
  });

  it('[작가] 탭 격자(GET /explore) — 앞 묶음이 전부 채운 작가, 그 안·뒤에서도 같은 작가 연속 없음', async () => {
    const prio = priority();
    const prioShown = 3 + 4 + 2;
    for (const seed of [1, 7, 42, 99, 1234]) {
      const res = await request.get(`/api/explore?sort=random&seed=${seed}&limit=60`);
      expect(res.status).toBe(200);
      const arts: number[] = res.body.images.map((i: any) => i.artist.id);
      expect(arts.length).toBe(prioShown + 5 + 2);
      expect(arts.slice(0, prioShown).every((a) => prio.has(a))).toBe(true);
      expect(arts.slice(prioShown).every((a) => a === two || a === bare)).toBe(true);
      for (let i = 1; i < arts.length; i++) {
        // 뒤 묶음은 'two' 5점 + 'bare' 2점이라 연속이 불가피하다 — 앞 묶음과 이음매만 본다
        if (i < prioShown + 1) expect(arts[i]).not.toBe(arts[i - 1]);
      }
    }
  });

  it('앞 묶음 안의 순서는 시드마다 다르다(여전히 랜덤)', async () => {
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const ids = (await request.get(`/api/explore?sort=random&seed=${seed}&limit=9`)).body.images.map((i: any) => i.id);
      orders.add(ids.join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('무한 스크롤 페이지 경계에서도 같은 순서(중복·누락 없음)', async () => {
    const p1 = (await request.get('/api/explore?sort=random&seed=5&page=1&limit=5')).body.images.map((i: any) => i.id);
    const p2 = (await request.get('/api/explore?sort=random&seed=5&page=2&limit=5')).body.images.map((i: any) => i.id);
    const p3 = (await request.get('/api/explore?sort=random&seed=5&page=3&limit=5')).body.images.map((i: any) => i.id);
    const all = (await request.get('/api/explore?sort=random&seed=5&limit=60')).body.images.map((i: any) => i.id);
    expect([...p1, ...p2, ...p3]).toEqual(all.slice(0, 15));
    expect(new Set(all).size).toBe(all.length);
  });

  it('홈 ArtWorks(GET /explore/highlight?seed=) — 8칸 중 앞 칸이 채운 작가 작품', async () => {
    const prio = priority();
    for (const seed of [3, 11, 77]) {
      const res = await request.get(`/api/explore/highlight?seed=${seed}&limit=8`);
      expect(res.status).toBe(200);
      const arts: number[] = res.body.images.map((i: any) => i.artist.id);
      expect(arts.length).toBe(8);
      expect(arts.every((a) => prio.has(a))).toBe(true);   // 채운 작가 작품이 9점이라 8칸이 다 그쪽
    }
  });

  it('[좋아요순]은 그대로 — 좋아요 많은 작품이 채운 작가보다 먼저', async () => {
    const img = await testPrisma.portfolioImage.findFirst({ where: { portfolio: { userId: bare } } });
    for (const uid of [1, 2, 3, 4]) await testPrisma.portfolioImageLike.create({ data: { userId: uid, imageId: img!.id } });
    const res = await request.get('/api/explore?sort=popular&period=all&limit=60');
    expect(res.body.images[0].id).toBe(img!.id);
  });

  it('채운 작가가 아무도 없으면 예전과 같다(전부 한 묶음)', async () => {
    await cleanDb();
    await seedUsers();
    await seedArtist({ email: 'x@t.com', n: 3 });
    await seedArtist({ email: 'y@t.com', n: 3 });
    const arts: number[] = (await request.get('/api/explore?sort=random&seed=9&limit=60')).body.images.map((i: any) => i.artist.id);
    expect(arts.length).toBe(6);
    for (let i = 1; i < arts.length; i++) expect(arts[i]).not.toBe(arts[i - 1]);
  });
});
