/**
 * GET /api/explore/artists — Navbar [작가] 탭(`/artists`)의 왼쪽 작가 목록 (2026-09-10)
 *
 * 여기서 지켜야 하는 것:
 *   1. **공개 작품이 있는 작가만.** 가입만 한 계정까지 실으면 목록이 회원 명부가 되고,
 *      눌러 들어가면 텅 빈 홈페이지가 나온다.
 *   2. **탈퇴 작가는 뺀다.** 탐색 피드(`GET /explore`)와 같은 기준이어야 한다 —
 *      두 화면이 다른 작가 집합을 보여주면 "왜 여기만 없지" 가 된다.
 *   3. **랜덤 순서**(2026-09-10 사용자 요청으로 가나다순에서 변경). 같은 시드면 같은 순서,
 *      시드가 다르면 다른 순서. 시드가 없으면 **하루 동안 고정**된다 — 매 요청 바뀌면
 *      같은 화면을 다시 열 때마다 순서가 달라져 방금 본 작가를 못 찾는다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, cleanDb, seedUsers, testPrisma } from './helpers';

/** 작가 하나에 공개/비공개 작품을 붙인다 */
async function seedArtist(
  opts: { id: number; name: string; nickname?: string | null; publicWorks: number; privateWorks?: number; withdrawn?: boolean },
) {
  await testPrisma.user.upsert({
    where: { id: opts.id },
    update: { name: opts.name, nickname: opts.nickname ?? null, deletedAt: opts.withdrawn ? new Date() : null },
    create: {
      id: opts.id, email: `artist${opts.id}@test.com`, name: opts.name,
      nickname: opts.nickname ?? null, role: 'ARTIST',
      deletedAt: opts.withdrawn ? new Date() : null,
    },
  });
  const pf = await testPrisma.portfolio.upsert({
    where: { userId: opts.id }, update: {}, create: { userId: opts.id, biography: 'b' },
  });
  for (let i = 0; i < opts.publicWorks; i++) {
    await testPrisma.portfolioImage.create({
      data: { portfolioId: pf.id, url: `/uploads/a${opts.id}-${i}.jpg`, order: i, showInExplore: true },
    });
  }
  for (let i = 0; i < (opts.privateWorks ?? 0); i++) {
    await testPrisma.portfolioImage.create({
      data: { portfolioId: pf.id, url: `/uploads/p${opts.id}-${i}.jpg`, order: 100 + i, showInExplore: false },
    });
  }
}

const names = (body: any[]) => body.map((a) => a.name);

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('GET /api/explore/artists', () => {
  it('로그인 없이 볼 수 있다', async () => {
    await seedArtist({ id: 1, name: '강민서', publicWorks: 2 });
    const res = await request.get('/api/explore/artists');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['강민서']);
  });

  it('★ 공개 작품이 없는 작가는 목록에 없다 — 눌러도 빈 홈페이지가 나온다', async () => {
    await seedArtist({ id: 1, name: '있는사람', publicWorks: 2 });
    await seedArtist({ id: 2, name: '없는사람', publicWorks: 0, privateWorks: 3 });

    const res = await request.get('/api/explore/artists');
    expect(names(res.body)).toEqual(['있는사람']);
  });

  it('★ 탈퇴 작가는 뺀다 (탐색 피드와 같은 기준)', async () => {
    await seedArtist({ id: 1, name: '남은작가', publicWorks: 1 });
    await seedArtist({ id: 2, name: '탈퇴작가', publicWorks: 5, withdrawn: true });

    const res = await request.get('/api/explore/artists');
    expect(names(res.body)).toEqual(['남은작가']);
  });

  /** 시드 랜덤 — 순서만 다르고 **구성원은 같아야** 한다(섞다가 빠지면 안 된다) */
  it('★ 같은 시드는 같은 순서, 다른 시드는 다른 순서', async () => {
    for (const [id, name] of [[1, '한서아'], [2, '강민서'], [5, '박지훈'], [6, '김하윤'], [7, '마은영'], [8, '정하경']] as const) {
      await seedArtist({ id, name, publicWorks: 1 });
    }

    const a1 = await request.get('/api/explore/artists?seed=12345');
    const a2 = await request.get('/api/explore/artists?seed=12345');
    expect(names(a1.body)).toEqual(names(a2.body));   // 같은 시드 → 같은 순서

    // 다른 시드로 여러 번 시도해 **한 번이라도** 순서가 달라지면 섞이는 것이다.
    // (6명이면 한 시드가 우연히 같은 순서를 낼 확률이 있어 한 번만 보고 판정하면 깜빡인다)
    const others = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => request.get(`/api/explore/artists?seed=${n * 7777}`)),
    );
    expect(others.some((r) => names(r.body).join() !== names(a1.body).join())).toBe(true);

    // ⚠️ 순서만 바뀌고 사람이 사라지면 안 된다
    for (const r of [a1, ...others]) {
      expect([...names(r.body)].sort()).toEqual(['강민서', '김하윤', '마은영', '박지훈', '정하경', '한서아']);
    }
  });

  it('★ 시드가 없으면 하루 동안 고정된다 (열 때마다 흔들리지 않게)', async () => {
    for (const [id, name] of [[1, '한서아'], [2, '강민서'], [5, '박지훈'], [6, '김하윤']] as const) {
      await seedArtist({ id, name, publicWorks: 1 });
    }
    const a = await request.get('/api/explore/artists');
    const b = await request.get('/api/explore/artists');
    expect(names(a.body)).toEqual(names(b.body));
  });

  it('★ 공개 작품 수만 센다 (비공개는 빼고)', async () => {
    await seedArtist({ id: 1, name: '강민서', publicWorks: 3, privateWorks: 4 });
    const res = await request.get('/api/explore/artists');
    expect(res.body[0].workCount).toBe(3);
  });

  it('닉네임이 있으면 닉네임으로 보여준다 (공개 노출 규칙)', async () => {
    await seedArtist({ id: 1, name: '본명', nickname: '작가닉', publicWorks: 1 });
    const res = await request.get('/api/explore/artists');
    expect(res.body[0].name).toBe('작가닉');
  });

  it('작가가 하나도 없으면 빈 배열 (500 이 아니다)', async () => {
    const res = await request.get('/api/explore/artists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('작가 홈페이지로 갈 수 있게 id 를 준다', async () => {
    await seedArtist({ id: 7, name: '강민서', publicWorks: 1 });
    const res = await request.get('/api/explore/artists');
    expect(res.body[0].id).toBe(7);
  });
});
