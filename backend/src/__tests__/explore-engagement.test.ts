/**
 * 둘러보기 참여 기능 테스트
 *
 *  - GET  /api/explore/highlight          홈 하이라이트(주간→전체→랜덤 폴백)
 *  - GET  /api/explore/my-likes           좋아요한 작품 보드
 *  - POST /api/explore/:id/like           → 작가에게 ARTWORK_LIKE 알림(24시간 집계)
 *  - POST /api/explore/:id/scrap          갤러리 비공개 스크랩 (작가에게 노출 금지)
 *  - POST /api/exhibitions/:id/invite     갤러리 → 작가 공모 초대 (상한·중복·마감 방어)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';

const artist1Tok = authToken(1, 'ARTIST');
const artist2Tok = authToken(2, 'ARTIST');
const galleryTok = authToken(3, 'GALLERY');

/** artist1(userId=1)의 포트폴리오에 공개 이미지 n장 생성 */
async function seedImages(userId = 1, count = 3, showInExplore = true) {
  const portfolio = await testPrisma.portfolio.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  const created = [];
  for (let i = 0; i < count; i++) {
    created.push(
      await testPrisma.portfolioImage.create({
        data: { portfolioId: portfolio.id, url: `/uploads/${userId}-${i}.jpg`, order: i, showInExplore },
      })
    );
  }
  return created;
}

describe('GET /api/explore/highlight — 홈 하이라이트', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('작품이 없으면 빈 배열', async () => {
    const r = await request.get('/api/explore/highlight');
    expect(r.status).toBe(200);
    expect(r.body.images).toEqual([]);
  });

  it('좋아요가 전혀 없으면 basis=random (날짜 시드 → 하루 동안 동일 순서)', async () => {
    await seedImages(1, 5);
    const r1 = await request.get('/api/explore/highlight?limit=4');
    expect(r1.body.basis).toBe('random');
    expect(r1.body.images).toHaveLength(4);
    const r2 = await request.get('/api/explore/highlight?limit=4');
    expect(r2.body.images.map((i: any) => i.id)).toEqual(r1.body.images.map((i: any) => i.id));
  });

  it('좋아요가 있으면 basis=all, 가장 많이 받은 작품이 1위', async () => {
    const imgs = await seedImages(1, 3);
    await testPrisma.portfolioImageLike.create({ data: { userId: 2, imageId: imgs[2].id } });
    const r = await request.get('/api/explore/highlight');
    expect(r.body.basis).toBe('all');
    expect(r.body.images[0].id).toBe(imgs[2].id);
    expect(r.body.images[0].likeCount).toBe(1);
  });

  it('★ 화면에 찍히는 하트 수 기준으로 항상 내림차순이다 (오래된 좋아요도 포함)', async () => {
    // 회귀 방지: 예전에는 '최근 7일' 기준으로 정렬하면서 배지는 전체 수를 보여줘
    // "1,1,1,3" 처럼 순서가 뒤집혀 보였다.
    const imgs = await seedImages(1, 4);
    const old = new Date(Date.now() - 30 * 86400000);
    // imgs[0]: 오래된 좋아요 3개(이번 주엔 0) / imgs[1]: 이번 주 좋아요 1개
    for (const uid of [2, 3, 4]) {
      await testPrisma.portfolioImageLike.create({ data: { userId: uid, imageId: imgs[0].id, createdAt: old } });
    }
    await testPrisma.portfolioImageLike.create({ data: { userId: 2, imageId: imgs[1].id } });

    const r = await request.get('/api/explore/highlight');
    const counts = r.body.images.map((i: any) => i.likeCount);
    expect(counts, `표시 하트가 내림차순이 아님: ${counts}`).toEqual([...counts].sort((a: number, b: number) => b - a));
    expect(r.body.images[0].id, '전체 3개가 1위').toBe(imgs[0].id);
    expect(r.body.images[1].id, '전체 1개가 2위').toBe(imgs[1].id);
  });

  it('좋아요 수가 같으면 최근에 받은 작품이 앞선다(신선도 tie-break)', async () => {
    const imgs = await seedImages(1, 3);
    const old = new Date(Date.now() - 30 * 86400000);
    await testPrisma.portfolioImageLike.create({ data: { userId: 2, imageId: imgs[0].id, createdAt: old } });
    await testPrisma.portfolioImageLike.create({ data: { userId: 2, imageId: imgs[1].id } }); // 이번 주
    const r = await request.get('/api/explore/highlight');
    expect(r.body.images[0].id).toBe(imgs[1].id);
    expect(r.body.images[1].id).toBe(imgs[0].id);
  });

  it('비공개 작품과 탈퇴 작가 작품은 제외한다', async () => {
    await seedImages(1, 2, false); // 비공개
    await seedImages(2, 2, true);
    await testPrisma.user.update({ where: { id: 2 }, data: { deletedAt: new Date() } });
    const r = await request.get('/api/explore/highlight');
    expect(r.body.images).toEqual([]);
  });

  it('★ 로그인 사용자의 좋아요 상태(isLiked)가 반영된다', async () => {
    const imgs = await seedImages(1, 3);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);

    // 비로그인 → 전부 false
    const anon = await request.get('/api/explore/highlight');
    expect(anon.body.images.every((i: any) => i.isLiked === false)).toBe(true);

    // 누른 사람 시점 → 그 작품만 true (없으면 확대 모달에서 하트가 꺼진 채 열려
    // 다시 누르면 '취소'가 되어 개수가 어긋난다)
    const mine = await request.get('/api/explore/highlight').set('Authorization', `Bearer ${artist2Tok}`);
    const liked = mine.body.images.find((i: any) => i.id === imgs[0].id);
    expect(liked.isLiked).toBe(true);
    expect(mine.body.images.filter((i: any) => i.isLiked).length).toBe(1);

    // 누르지 않은 사람 시점 → false
    const other = await request.get('/api/explore/highlight').set('Authorization', `Bearer ${artist1Tok}`);
    expect(other.body.images.find((i: any) => i.id === imgs[0].id).isLiked).toBe(false);
  });

  it('갤러리 시점 highlight에는 본인 스크랩 상태가 포함된다', async () => {
    const imgs = await seedImages(1, 2);
    await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${galleryTok}`);
    const r = await request.get('/api/explore/highlight').set('Authorization', `Bearer ${galleryTok}`);
    expect(r.body.images.find((i: any) => i.id === imgs[0].id).isScrapped).toBe(true);
    expect(r.body.images.find((i: any) => i.id === imgs[1].id).isScrapped).toBe(false);
    // 작가 시점에는 스크랩 흔적이 없어야 한다
    const a = await request.get('/api/explore/highlight').set('Authorization', `Bearer ${artist1Tok}`);
    expect(a.body.images[0]).not.toHaveProperty('isScrapped');
  });

  it('limit은 최대 24로 제한된다', async () => {
    await seedImages(1, 30);
    const r = await request.get('/api/explore/highlight?limit=999');
    expect(r.body.images.length).toBe(24);
  });

  // ── 홈 ArtWorks [새로고침] (?seed=N) ─────────────────────────────────
  // 둘러보기(/explore)의 새로고침과 같은 규칙: 시드 랜덤 + 같은 작가 연속 방지.

  it('★ seed를 주면 좋아요순이 아니라 랜덤 재정렬된다 (basis=random)', async () => {
    const imgs = await seedImages(1, 12);
    // imgs[0] 이 좋아요 1위 — seed 없이는 항상 1등, seed 를 주면 그 보장이 사라진다
    for (const uid of [2, 3, 4]) {
      await testPrisma.portfolioImageLike.create({ data: { userId: uid, imageId: imgs[0].id } });
    }

    const plain = await request.get('/api/explore/highlight?limit=8');
    expect(plain.body.basis).toBe('all');
    expect(plain.body.images[0].id).toBe(imgs[0].id);

    const shuffled = await request.get('/api/explore/highlight?limit=8&seed=12345');
    expect(shuffled.status).toBe(200);
    expect(shuffled.body.basis).toBe('random');
    expect(shuffled.body.images).toHaveLength(8);

    // 시드가 다르면 순서도 달라진다(전부 같으면 seed가 무시된 것)
    const other = await request.get('/api/explore/highlight?limit=8&seed=987654');
    const a = shuffled.body.images.map((i: any) => i.id).join(',');
    const b = other.body.images.map((i: any) => i.id).join(',');
    expect(a, '서로 다른 seed인데 순서가 같다 = seed 무시됨').not.toBe(b);
  });

  it('같은 seed면 항상 같은 순서 (연타해도 화면이 흔들리지 않는다)', async () => {
    await seedImages(1, 10);
    const r1 = await request.get('/api/explore/highlight?limit=6&seed=42');
    const r2 = await request.get('/api/explore/highlight?limit=6&seed=42');
    expect(r2.body.images.map((i: any) => i.id)).toEqual(r1.body.images.map((i: any) => i.id));
  });

  it('seed 재정렬에서도 같은 작가가 연달아 나오지 않는다', async () => {
    // 작가 3명 × 4장 — 연속 방지가 없으면 같은 작가가 뭉쳐 나온다
    await seedImages(1, 4);
    await seedImages(2, 4);
    await seedImages(3, 4);
    const r = await request.get('/api/explore/highlight?limit=12&seed=777');
    const artistIds = r.body.images.map((i: any) => i.artist.id);
    const adjacent = artistIds.filter((id: number, k: number) => k > 0 && id === artistIds[k - 1]);
    expect(adjacent, `같은 작가 연속: ${artistIds}`).toEqual([]);
  });

  it('seed 재정렬에서도 비공개·탈퇴 작가 작품은 여전히 제외된다', async () => {
    await seedImages(1, 3, false); // 비공개
    await seedImages(2, 3, true);
    await testPrisma.user.update({ where: { id: 2 }, data: { deletedAt: new Date() } });
    const r = await request.get('/api/explore/highlight?limit=8&seed=555');
    expect(r.body.images).toEqual([]);
  });

  it('seed 재정렬에서도 좋아요 배지(likeCount)와 로그인 상태(isLiked)는 그대로다', async () => {
    const imgs = await seedImages(1, 5);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    const r = await request.get('/api/explore/highlight?limit=5&seed=31337').set('Authorization', `Bearer ${artist2Tok}`);
    const liked = r.body.images.find((i: any) => i.id === imgs[0].id);
    expect(liked.likeCount).toBe(1);
    expect(liked.isLiked).toBe(true);
  });

  it('잘못된 seed(0·문자·음수)는 seed 없음으로 취급 — 좋아요순 유지', async () => {
    const imgs = await seedImages(1, 4);
    for (const uid of [2, 3]) {
      await testPrisma.portfolioImageLike.create({ data: { userId: uid, imageId: imgs[3].id } });
    }
    for (const bad of ['0', 'abc', '', '-0']) {
      const r = await request.get(`/api/explore/highlight?limit=4&seed=${bad}`);
      expect(r.status, `seed=${bad}`).toBe(200);
      expect(r.body.basis, `seed=${bad} 는 무시되어야 한다`).toBe('all');
      expect(r.body.images[0].id, `seed=${bad}`).toBe(imgs[3].id);
    }
    // 음수는 절대값으로 받아 재정렬한다(Explore 피드와 동일)
    const neg = await request.get('/api/explore/highlight?limit=4&seed=-42');
    expect(neg.body.basis).toBe('random');
  });
});

describe('GET /api/explore/my-likes — 좋아요한 작품 보드', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('로그인 필요', async () => {
    const r = await request.get('/api/explore/my-likes');
    expect(r.status).toBe(401);
  });

  it('내가 좋아요한 작품만 최신순으로 반환한다', async () => {
    const imgs = await seedImages(1, 3);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    await request.post(`/api/explore/${imgs[2].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    const r = await request.get('/api/explore/my-likes').set('Authorization', `Bearer ${artist2Tok}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.images.map((i: any) => i.id)).toEqual([imgs[2].id, imgs[0].id]);
    expect(r.body.images[0].isLiked).toBe(true);
    expect(r.body.images[0].artist.id).toBe(1);
  });

  it('작가가 공개를 내리면 보드에서도 빠진다(작가 선택 존중)', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    await testPrisma.portfolioImage.update({ where: { id: imgs[0].id }, data: { showInExplore: false } });
    const r = await request.get('/api/explore/my-likes').set('Authorization', `Bearer ${artist2Tok}`);
    expect(r.body.total).toBe(0);
  });
});

describe('좋아요 알림 (작가↔작가 상호성)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('좋아요하면 작가에게 알림이 가고 링크는 누른 사람 프로필', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    const notis = await testPrisma.notification.findMany({ where: { userId: 1 } });
    expect(notis).toHaveLength(1);
    expect(notis[0].type).toBe('ARTWORK_LIKE');
    expect(notis[0].message).toContain('Artist 2');
    expect(notis[0].linkUrl).toBe('/portfolio/2');
    expect(notis[0].refKey).toBe(`artwork-like:${imgs[0].id}`);
  });

  it('닉네임이 있으면 닉네임으로 표기한다', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { nickname: '붓끝' } });
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    const noti = await testPrisma.notification.findFirst({ where: { userId: 1 } });
    expect(noti!.message).toContain('붓끝');
    expect(noti!.message).not.toContain('Artist 2');
  });

  it('내 작품에 내가 누르면 알림이 생기지 않는다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(await testPrisma.notification.count({ where: { userId: 1 } })).toBe(0);
  });

  it('24시간 내 같은 작품의 두 번째 좋아요는 새 알림 대신 "외 1명"으로 갱신된다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${galleryTok}`);
    const notis = await testPrisma.notification.findMany({ where: { userId: 1 } });
    expect(notis).toHaveLength(1); // 새로 쌓이지 않음
    expect(notis[0].message).toContain('외 1명');
  });

  it('여러 명(5명)이 눌러도 알림은 1개로 유지되고 "외 4명"까지 집계된다', async () => {
    const imgs = await seedImages(1, 1);
    // 시드 유저 외에 추가 작가 4명 생성 → 총 5명이 좋아요
    const extras = [];
    for (let i = 0; i < 4; i++) {
      extras.push(await testPrisma.user.create({
        data: { email: `fan${i}@test.com`, name: `팬${i}`, role: 'ARTIST' },
      }));
    }
    const likers = [{ id: 2 }, ...extras];
    for (const u of likers) {
      await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${authToken(u.id, 'ARTIST')}`);
    }

    const notis = await testPrisma.notification.findMany({ where: { userId: 1 } });
    expect(notis).toHaveLength(1);
    expect(notis[0].message).toContain('외 4명');
    // 링크는 '가장 마지막에 누른 사람' 프로필
    expect(notis[0].linkUrl).toBe(`/portfolio/${extras[3].id}`);
    expect(await testPrisma.portfolioImageLike.count({ where: { imageId: imgs[0].id } })).toBe(5);
  });

  it('서로 다른 작품이면 알림이 각각 쌓인다(집계는 작품 단위)', async () => {
    const imgs = await seedImages(1, 2);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    await request.post(`/api/explore/${imgs[1].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    const notis = await testPrisma.notification.findMany({ where: { userId: 1 } });
    expect(notis).toHaveLength(2);
    expect(new Set(notis.map(n => n.refKey)).size).toBe(2);
  });

  it('이미 읽은 알림에는 합치지 않고 새 알림을 만든다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    await testPrisma.notification.updateMany({ where: { userId: 1 }, data: { read: true } });
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${galleryTok}`);
    const notis = await testPrisma.notification.findMany({ where: { userId: 1 }, orderBy: { id: 'asc' } });
    expect(notis).toHaveLength(2);
    expect(notis[1].read).toBe(false);
  });

  it('24시간이 지난 미읽음 알림에는 합치지 않는다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    // 기존 알림과 좋아요를 25시간 전으로 밀어 놓는다
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await testPrisma.notification.updateMany({ where: { userId: 1 }, data: { createdAt: old } });
    await testPrisma.portfolioImageLike.updateMany({ where: { imageId: imgs[0].id }, data: { createdAt: old } });

    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${galleryTok}`);
    const notis = await testPrisma.notification.findMany({ where: { userId: 1 }, orderBy: { id: 'asc' } });
    expect(notis).toHaveLength(2);
    // 24시간 창 밖의 좋아요는 카운트에서 빠지므로 "외 N명"이 붙지 않는다
    expect(notis[1].message).not.toContain('외');
  });

  it('좋아요 취소는 알림을 만들지 않는다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`);
    await request.post(`/api/explore/${imgs[0].id}/like`).set('Authorization', `Bearer ${artist2Tok}`); // 취소
    expect(await testPrisma.notification.count({ where: { userId: 1 } })).toBe(1);
  });
});

describe('갤러리 스크랩 (비공개 보드)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('작가는 스크랩할 수 없다(403)', async () => {
    const imgs = await seedImages(1, 1);
    const r = await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${artist2Tok}`);
    expect(r.status).toBe(403);
  });

  it('갤러리는 스크랩을 토글하고 목록으로 회수한다', async () => {
    const imgs = await seedImages(1, 1);
    const on = await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${galleryTok}`);
    expect(on.body.scrapped).toBe(true);

    const list = await request.get('/api/explore/scraps').set('Authorization', `Bearer ${galleryTok}`);
    expect(list.body.scraps).toHaveLength(1);
    expect(list.body.scraps[0].image.artist.id).toBe(1);

    const off = await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${galleryTok}`);
    expect(off.body.scrapped).toBe(false);
    const after = await request.get('/api/explore/scraps').set('Authorization', `Bearer ${galleryTok}`);
    expect(after.body.scraps).toHaveLength(0);
  });

  it('메모를 저장하고 수정할 수 있다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${galleryTok}`);
    const list = await request.get('/api/explore/scraps').set('Authorization', `Bearer ${galleryTok}`);
    const scrapId = list.body.scraps[0].id;
    const r = await request.patch(`/api/explore/scraps/${scrapId}`)
      .set('Authorization', `Bearer ${galleryTok}`).send({ memo: '가을 기획전 후보' });
    expect(r.body.memo).toBe('가을 기획전 후보');
  });

  it('★ 스크랩 사실은 작가에게 절대 노출되지 않는다', async () => {
    const imgs = await seedImages(1, 1);
    await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${galleryTok}`);

    // 작가 시점 피드 — 스크랩 관련 필드가 아예 없어야 한다
    const feed = await request.get('/api/explore').set('Authorization', `Bearer ${artist1Tok}`);
    expect(feed.body.images[0]).not.toHaveProperty('isScrapped');
    expect(JSON.stringify(feed.body)).not.toContain('scrap');

    // 작가는 남의 스크랩 목록에도 접근할 수 없다
    const r = await request.get('/api/explore/scraps').set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.status).toBe(403);
  });

  it('갤러리 시점 피드에는 본인 스크랩 상태가 표시된다', async () => {
    const imgs = await seedImages(1, 2);
    await request.post(`/api/explore/${imgs[0].id}/scrap`).set('Authorization', `Bearer ${galleryTok}`);
    const feed = await request.get('/api/explore').set('Authorization', `Bearer ${galleryTok}`);
    const target = feed.body.images.find((i: any) => i.id === imgs[0].id);
    const other = feed.body.images.find((i: any) => i.id === imgs[1].id);
    expect(target.isScrapped).toBe(true);
    expect(other.isScrapped).toBe(false);
  });
});

/**
 * 1:1 공모 초대는 2026-11-19 에 없앴다(사용자 결정 — 실서버에서 한 번도 쓰이지 않았다). 초대 **코드**는 그대로다(invite-code.test.ts).
 * 옛 화면·북마크·알림이 옛 주소를 부르면 조용히 무언가 일어나지 않고 404 로 끝나야 한다.
 */
describe('1:1 공모 초대는 없다 (2026-11-19)', () => {
  let exhibitionId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    exhibitionId = ex.id;
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { status: 'APPROVED' } });
  });

  it('★ 보내기·초대 목록·받은 초대·수락·거절 주소가 모두 404', async () => {
    const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
    expect((await request.post(`/api/exhibitions/${exhibitionId}/invite`).set(auth(galleryTok)).send({ artistId: 1 })).status).toBe(404);
    expect((await request.get(`/api/exhibitions/${exhibitionId}/invites`).set(auth(galleryTok))).status).toBe(404);
    expect((await request.get('/api/exhibitions/invites/received').set(auth(artist1Tok))).status).toBe(404);
    expect((await request.post('/api/exhibitions/invites/1/accept').set(auth(artist1Tok)).send({})).status).toBe(404);
    expect((await request.patch('/api/exhibitions/invites/1').set(auth(artist1Tok)).send({})).status).toBe(404);
    expect(await testPrisma.exhibitionInvite.count()).toBe(0);
  });

  it('공모 상세에 invited 가 더는 실리지 않는다 · 옛 표에 초대가 남아 있어도 지원은 일반 검증을 탄다', async () => {
    // 옛 데이터(표는 남겨 두었다) — 있어도 아무 길도 열리지 않아야 한다
    await testPrisma.exhibitionInvite.create({ data: { exhibitionId, artistId: 1, senderId: 3, message: '옛 초대' } });
    const detail = await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty('invited');
    // 예전 '간편 지원'(viaInvite) — 지금은 약력·작품이 없으면 그냥 400 이다
    const r = await request.post(`/api/exhibitions/${exhibitionId}/apply`).set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(r.status).toBe(400);
    expect(await testPrisma.application.count()).toBe(0);
  });
});
