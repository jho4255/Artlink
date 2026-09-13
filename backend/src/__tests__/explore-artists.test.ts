/**
 * GET /api/explore/artists — Navbar [작가] 탭(`/artists`)의 왼쪽 작가 목록 (2026-09-10)
 *
 * 여기서 지켜야 하는 것:
 *   1. **공개 작품이 있는 작가만.** 가입만 한 계정까지 실으면 목록이 회원 명부가 되고,
 *      눌러 들어가면 텅 빈 홈페이지가 나온다.
 *   2. **탈퇴 작가는 뺀다.** 탐색 피드(`GET /explore`)와 같은 기준이어야 한다 —
 *      두 화면이 다른 작가 집합을 보여주면 "왜 여기만 없지" 가 된다.
 *   3. **가나다순 + 초성 칸**(2026-09-13 사용자 요청으로 랜덤에서 되돌림). 목록은 칸 순서 →
 *      이름순이고 이름마다 `initial` 이 실린다. 화면(`ArtistsPage`)은 **이어진 같은 `initial`
 *      끼리 묶기만** 하므로, 정렬과 칸이 어긋나면 'ㄱ' 칸을 폈는데 'ㄴ' 이름이 나온다.
 *
 * 초성 판정 자체(쌍자음 접기·영문·기호…)는 `lib/__tests__/hangulIndex.test.ts` 가 본다.
 * 여기서는 **라우트가 그 규칙을 실제로 태우는지**만 본다.
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

  it('★ 가나다순으로 내려준다 (2026-09-13 랜덤에서 되돌림)', async () => {
    for (const [id, name] of [[1, '한서아'], [2, '강민서'], [5, '박지훈'], [6, '김하윤'], [7, '마은영'], [8, '정하경']] as const) {
      await seedArtist({ id, name, publicWorks: 1 });
    }
    const res = await request.get('/api/explore/artists');
    expect(names(res.body)).toEqual(['강민서', '김하윤', '마은영', '박지훈', '정하경', '한서아']);
  });

  it('★ 열 때마다 같은 순서다 (방금 본 작가를 다시 찾을 수 있어야 한다)', async () => {
    for (const [id, name] of [[1, '한서아'], [2, '강민서'], [5, '박지훈'], [6, '김하윤']] as const) {
      await seedArtist({ id, name, publicWorks: 1 });
    }
    const a = await request.get('/api/explore/artists');
    const b = await request.get('/api/explore/artists');
    expect(names(a.body)).toEqual(names(b.body));
  });

  /**
   * ⚠️ 순서와 칸이 **어긋나면** 'ㄱ' 칸을 폈는데 'ㄴ' 이름이 나오거나, 같은 칸이 목록에 두 번 뜬다.
   *    화면은 이어진 같은 `initial` 끼리 묶기만 하므로, 그 전제를 여기서 못박는다.
   */
  it('★ initial 이 함께 오고, 같은 칸끼리 **이어져** 있다', async () => {
    for (const [id, name] of [[1, '한서아'], [2, '강민서'], [5, '김하윤'], [6, 'Zoe'], [7, '나윤호'], [8, '12번방']] as const) {
      await seedArtist({ id, name, publicWorks: 1 });
    }
    const res = await request.get('/api/explore/artists');

    expect(res.body.map((a: any) => `${a.initial}:${a.name}`)).toEqual([
      'ㄱ:강민서', 'ㄱ:김하윤', 'ㄴ:나윤호', 'ㅎ:한서아', 'A–Z:Zoe', '#:12번방',
    ]);

    // 같은 칸이 두 번 나타나지 않는다 = 이어져 있다
    const initials: string[] = res.body.map((a: any) => a.initial);
    const runs = initials.filter((v, i) => initials[i - 1] !== v);
    expect(new Set(initials).size).toBe(runs.length);
  });

  it('★ 닉네임으로 보여주면 **닉네임 기준**으로 정렬·색인한다 (본명 기준이면 칸이 어긋난다)', async () => {
    await seedArtist({ id: 1, name: '하본명', nickname: '가닉네임', publicWorks: 1 });
    await seedArtist({ id: 2, name: '가본명', nickname: '하닉네임', publicWorks: 1 });

    const res = await request.get('/api/explore/artists');
    expect(res.body.map((a: any) => [a.name, a.initial])).toEqual([['가닉네임', 'ㄱ'], ['하닉네임', 'ㅎ']]);
  });

  it('옛 `?seed=` 는 무시한다 — 400 으로 막으면 그때 만들어진 링크가 죽는다', async () => {
    await seedArtist({ id: 1, name: '강민서', publicWorks: 1 });
    await seedArtist({ id: 2, name: '한서아', publicWorks: 1 });

    const withSeed = await request.get('/api/explore/artists?seed=999');
    expect(withSeed.status).toBe(200);
    expect(names(withSeed.body)).toEqual(['강민서', '한서아']);
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
