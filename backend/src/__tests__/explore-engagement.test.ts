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

/** 공모 지원 최소 본문 (약력 + 작품사진 1장 + 약관동의 필수) */
const APPLY_BODY = {
  biography: '테스트 약력',
  artworkImages: ['https://cdn.example.com/apply-1.jpg'],
  termsAgreed: true,
  termsVersion: ARTIST_APPLY_TERMS_VERSION,
};

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
        data: { portfolioId: portfolio.id, url: `https://cdn.example.com/${userId}-${i}.jpg`, order: i, showInExplore },
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

  it('최근 7일 내 좋아요가 있으면 basis=week, 그 작품이 1위', async () => {
    const imgs = await seedImages(1, 3);
    await testPrisma.portfolioImageLike.create({ data: { userId: 2, imageId: imgs[2].id } });
    const r = await request.get('/api/explore/highlight');
    expect(r.body.basis).toBe('week');
    expect(r.body.images[0].id).toBe(imgs[2].id);
    expect(r.body.images[0].likeCount).toBe(1);
  });

  it('좋아요가 7일보다 오래됐으면 basis=all', async () => {
    const imgs = await seedImages(1, 3);
    await testPrisma.portfolioImageLike.create({
      data: { userId: 2, imageId: imgs[1].id, createdAt: new Date(Date.now() - 30 * 86400000) },
    });
    const r = await request.get('/api/explore/highlight');
    expect(r.body.basis).toBe('all');
    expect(r.body.images[0].id).toBe(imgs[1].id);
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

describe('공모 초대 (갤러리 → 작가)', () => {
  let exhibitionId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    exhibitionId = ex.id;
  });

  const invite = (tok: string, body: object) =>
    request.post(`/api/exhibitions/${exhibitionId}/invite`).set('Authorization', `Bearer ${tok}`).send(body);

  it('초대하면 작가에게 알림이 간다', async () => {
    const r = await invite(galleryTok, { artistId: 1, message: '작품 잘 봤습니다' });
    expect(r.status).toBe(201);
    const noti = await testPrisma.notification.findFirst({ where: { userId: 1, type: 'EXHIBITION_INVITE' } });
    expect(noti).toBeTruthy();
    expect(noti!.linkUrl).toBe(`/exhibitions/${exhibitionId}`);
  });

  it('작가는 초대할 수 없다(403)', async () => {
    const r = await invite(artist1Tok, { artistId: 2 });
    expect(r.status).toBe(403);
  });

  it('남의 공모에는 초대할 수 없다(403)', async () => {
    const other = await testPrisma.user.create({
      data: { email: 'g2@test.com', name: 'Gallery 2', role: 'GALLERY' },
    });
    const r = await invite(authToken(other.id, 'GALLERY'), { artistId: 1 });
    expect(r.status).toBe(403);
  });

  it('같은 작가를 두 번 초대할 수 없다(409)', async () => {
    await invite(galleryTok, { artistId: 1 });
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(409);
  });

  it('이미 지원한 작가는 초대할 수 없다(400)', async () => {
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send(APPLY_BODY);
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(400);
  });

  it('마감된 공모는 초대할 수 없다(400)', async () => {
    await testPrisma.exhibition.update({
      where: { id: exhibitionId },
      data: { deadline: new Date(Date.now() - 3 * 86400000) },
    });
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(400);
  });

  it('모집마감 처리된 공모는 초대할 수 없다(400)', async () => {
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { recruitmentClosed: true } });
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(400);
  });

  it('탈퇴한 작가는 초대할 수 없다(404)', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { deletedAt: new Date() } });
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(404);
  });

  it('갤러리 계정은 초대 대상이 될 수 없다(404)', async () => {
    const r = await invite(galleryTok, { artistId: 3 });
    expect(r.status).toBe(404);
  });

  it('작가는 받은 초대를 조회하고 숨길 수 있다', async () => {
    await invite(galleryTok, { artistId: 1, message: '함께해요' });
    const list = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(list.status).toBe(200);
    expect(list.body.invites).toHaveLength(1);
    expect(list.body.invites[0].message).toBe('함께해요');
    expect(list.body.invites[0].applied).toBe(false);
    expect(list.body.invites[0].exhibition.gallery.name).toBe('Test Gallery');

    const hide = await request.patch(`/api/exhibitions/invites/${list.body.invites[0].id}`)
      .set('Authorization', `Bearer ${artist1Tok}`).send({});
    expect(hide.status).toBe(200);
    const after = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(after.body.invites).toHaveLength(0);
  });

  it('남의 초대는 숨길 수 없다(404)', async () => {
    await invite(galleryTok, { artistId: 1 });
    const list = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    const r = await request.patch(`/api/exhibitions/invites/${list.body.invites[0].id}`)
      .set('Authorization', `Bearer ${artist2Tok}`).send({});
    expect(r.status).toBe(404);
  });

  it('초대받은 작가가 지원하면 초대 상태가 APPLIED로 바뀐다', async () => {
    await invite(galleryTok, { artistId: 1 });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send(APPLY_BODY);
    const list = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(list.body.invites[0].status).toBe('APPLIED');
    expect(list.body.invites[0].applied).toBe(true);
  });

  it('간편 지원 — 초대받은 작가는 지원서 없이 포트폴리오로 지원된다', async () => {
    // 작가 포트폴리오에 약력 + 작품 2장
    const portfolio = await testPrisma.portfolio.upsert({
      where: { userId: 1 }, create: { userId: 1, biography: '회화 작업을 합니다' }, update: { biography: '회화 작업을 합니다' },
    });
    await testPrisma.portfolioImage.createMany({
      data: [
        { portfolioId: portfolio.id, url: 'https://cdn.example.com/p1.jpg', order: 0, showInExplore: true },
        { portfolioId: portfolio.id, url: 'https://cdn.example.com/p2.jpg', order: 1, showInExplore: true },
      ],
    });
    await invite(galleryTok, { artistId: 1 });

    // 약력/작품 없이 약관 동의만으로 지원
    const r = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(r.status).toBe(201);

    const app = await testPrisma.application.findFirst({ where: { exhibitionId, userId: 1 } });
    // 자동 수락이 아니라 평소대로 '접수' — 수락 여부는 갤러리가 결정한다
    expect(app!.status).toBe('SUBMITTED');
    expect(app!.biography).toBe('회화 작업을 합니다');
    expect(JSON.parse(app!.artworkImages!)).toHaveLength(2);
  });

  it('간편 지원해도 약관 동의는 필수다', async () => {
    const portfolio = await testPrisma.portfolio.upsert({ where: { userId: 1 }, create: { userId: 1 }, update: {} });
    await testPrisma.portfolioImage.create({
      data: { portfolioId: portfolio.id, url: 'https://cdn.example.com/p1.jpg', order: 0 },
    });
    await invite(galleryTok, { artistId: 1 });
    const r = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true });
    expect(r.status).toBe(400);
  });

  it('포트폴리오에 작품이 없으면 간편 지원이 막힌다', async () => {
    await testPrisma.portfolio.upsert({ where: { userId: 1 }, create: { userId: 1 }, update: {} });
    await invite(galleryTok, { artistId: 1 });
    const r = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('포트폴리오');
  });

  it('초대받지 않았는데 viaInvite로 지원하면 일반 검증이 적용된다', async () => {
    const r = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist2Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('약력');
  });

  it('초대받은 작가가 지원하면 갤러리에 "초대한 작가가 지원" 알림이 간다', async () => {
    const portfolio = await testPrisma.portfolio.upsert({ where: { userId: 1 }, create: { userId: 1 }, update: {} });
    await testPrisma.portfolioImage.create({
      data: { portfolioId: portfolio.id, url: 'https://cdn.example.com/p1.jpg', order: 0 },
    });
    await invite(galleryTok, { artistId: 1 });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });

    const noti = await testPrisma.notification.findFirst({
      where: { userId: 3, type: 'NEW_APPLICANT' }, orderBy: { id: 'desc' },
    });
    expect(noti!.message).toContain('초대한 작가');
    // 작가에게 수락 알림은 가지 않는다(자동 수락 아님)
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'APPLICATION_STATUS' } })).toBe(0);
  });

  it('공모 상세에 내 초대 여부(invited)가 내려온다 — 상세 페이지 간편 지원 버튼용', async () => {
    await invite(galleryTok, { artistId: 1 });
    const mine = await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(mine.body.invited).toBe(true);
    // 초대받지 않은 작가 / 비로그인은 false
    const other = await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist2Tok}`);
    expect(other.body.invited).toBe(false);
    const anon = await request.get(`/api/exhibitions/${exhibitionId}`);
    expect(anon.body.invited).toBe(false);
  });

  it('작가가 초대를 숨기면(DECLINED) 상세의 invited도 false가 된다', async () => {
    await invite(galleryTok, { artistId: 1 });
    const list = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    await request.patch(`/api/exhibitions/invites/${list.body.invites[0].id}`).set('Authorization', `Bearer ${artist1Tok}`).send({});
    const r = await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.body.invited).toBe(false);
  });

  it('지원자 목록에 초대 여부(invited)가 표시된다', async () => {
    const portfolio = await testPrisma.portfolio.upsert({ where: { userId: 1 }, create: { userId: 1 }, update: {} });
    await testPrisma.portfolioImage.create({
      data: { portfolioId: portfolio.id, url: 'https://cdn.example.com/p1.jpg', order: 0 },
    });
    await invite(galleryTok, { artistId: 1 });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist2Tok}`).send(APPLY_BODY);

    const list = await request.get(`/api/exhibitions/${exhibitionId}/applications`).set('Authorization', `Bearer ${galleryTok}`);
    expect(list.body.find((a: any) => a.userId === 1).invited).toBe(true);
    expect(list.body.find((a: any) => a.userId === 2).invited).toBe(false);
  });

  it('하루 초대 상한(10명)을 넘기면 400', async () => {
    // 같은 갤러리가 오늘 이미 10건을 보낸 상태로 만든다 (다른 공모여도 계정 기준으로 합산)
    const others = [];
    for (let i = 0; i < 10; i++) {
      others.push(await testPrisma.user.create({
        data: { email: `bulk${i}@test.com`, name: `대상${i}`, role: 'ARTIST' },
      }));
    }
    const ex2 = await seedExhibition((await testPrisma.exhibition.findUnique({ where: { id: exhibitionId } }))!.galleryId);
    await testPrisma.exhibition.update({ where: { id: ex2.id }, data: { capacity: 50 } });
    for (const u of others) {
      const r = await request.post(`/api/exhibitions/${ex2.id}/invite`)
        .set('Authorization', `Bearer ${galleryTok}`).send({ artistId: u.id });
      expect(r.status).toBe(201);
    }
    // 11번째는 차단
    const over = await invite(galleryTok, { artistId: 1 });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('하루에 최대 10명');
  });

  it('어제 보낸 초대는 오늘 상한에 포함되지 않는다', async () => {
    const others = [];
    for (let i = 0; i < 10; i++) {
      others.push(await testPrisma.user.create({
        data: { email: `old${i}@test.com`, name: `지난${i}`, role: 'ARTIST' },
      }));
    }
    await testPrisma.exhibitionInvite.createMany({
      data: others.map(u => ({
        exhibitionId, artistId: u.id, senderId: 3,
        createdAt: new Date(Date.now() - 2 * 86400000),
      })),
    });
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(201);
  });

  it('정원이 찬 공모에는 초대할 수 없다(400)', async () => {
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist2Tok}`).send(APPLY_BODY);
    const r = await invite(galleryTok, { artistId: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('모집 인원');
  });

  it('정원이 차면 받은 초대 목록에서 자동으로 사라진다', async () => {
    await invite(galleryTok, { artistId: 1 });
    const before = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(before.body.invites).toHaveLength(1);

    // 다른 작가들이 지원해 정원을 채운다
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist2Tok}`).send(APPLY_BODY);

    const after = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(after.body.invites).toHaveLength(0);
    // DB에서 지운 게 아니라 목록에서만 감춘 것 (거절로 슬롯이 복구되면 다시 보여야 하므로)
    expect(await testPrisma.exhibitionInvite.count({ where: { artistId: 1, status: 'SENT' } })).toBe(1);
  });

  it('정원이 찼다가 거절로 슬롯이 복구되면 초대가 다시 보인다', async () => {
    await invite(galleryTok, { artistId: 1 });
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist2Tok}`).send(APPLY_BODY);
    expect((await request.get('/api/exhibitions/invites/received')
      .set('Authorization', `Bearer ${artist1Tok}`)).body.invites).toHaveLength(0);

    // 갤러리가 거절 → 정원 슬롯 복구
    const apps = await request.get(`/api/exhibitions/${exhibitionId}/applications`).set('Authorization', `Bearer ${galleryTok}`);
    await request.patch(`/api/exhibitions/${exhibitionId}/applications/${apps.body[0].id}`)
      .set('Authorization', `Bearer ${galleryTok}`).send({ status: 'REJECTED' });

    const after = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(after.body.invites).toHaveLength(1);
  });

  it('이미 지원한 초대는 정원이 차도 목록에 남는다(상태 확인 필요)', async () => {
    const portfolio = await testPrisma.portfolio.upsert({ where: { userId: 1 }, create: { userId: 1 }, update: {} });
    await testPrisma.portfolioImage.create({
      data: { portfolioId: portfolio.id, url: 'https://cdn.example.com/p1.jpg', order: 0 },
    });
    await invite(galleryTok, { artistId: 1 });
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({ viaInvite: true, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });

    const r = await request.get('/api/exhibitions/invites/received').set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.body.invites).toHaveLength(1);
    expect(r.body.invites[0].applied).toBe(true);
    expect(r.body.invites[0].full).toBe(true);
  });

  it('정원이 차면 공모 상세의 invited도 false가 된다(간편 지원 버튼 숨김)', async () => {
    await invite(galleryTok, { artistId: 1 });
    expect((await request.get(`/api/exhibitions/${exhibitionId}`)
      .set('Authorization', `Bearer ${artist1Tok}`)).body.invited).toBe(true);

    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${artist2Tok}`).send(APPLY_BODY);

    expect((await request.get(`/api/exhibitions/${exhibitionId}`)
      .set('Authorization', `Bearer ${artist1Tok}`)).body.invited).toBe(false);
  });

  it('갤러리는 이미 초대한 작가 목록을 조회할 수 있다', async () => {
    await invite(galleryTok, { artistId: 1 });
    const r = await request.get(`/api/exhibitions/${exhibitionId}/invites`).set('Authorization', `Bearer ${galleryTok}`);
    expect(r.body.artistIds).toEqual([1]);
  });
});
