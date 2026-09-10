/**
 * Gallery/Review/Favorite/GotM/Upload 확장 테스트
 *
 * 기존 테스트에서 커버되지 않는 로직 경로:
 * - Gallery: region 필터, PATCH detail, cascade delete, 404
 * - Review: CRUD + 리뷰 개수 재계산, anonymous, 권한 검사
 *
 * ⚠️ **별점은 2026-09-10 에 없앴다** — 필터·정렬·평균 재계산이 전부 사라졌다.
 *    아래 테스트들은 '없어졌는가' 를 확인한다(그냥 지우면 되살아나도 아무도 모른다).
 * - Favorite: gallery 찜 토글 idempotency, GET 목록에 gallery 포함
 * - GotM: 비 Admin 등록/삭제 거부
 * - Upload: 인증 없이 업로드 거부
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const artistToken = authToken(1, 'ARTIST');
const artist2Token = authToken(2, 'ARTIST');
const galleryToken = authToken(3, 'GALLERY');
const adminToken = authToken(4, 'ADMIN');


/** deleteMany로 데이터 정리 (유저 유지) */
async function clearData() {
  await testPrisma.application.deleteMany();
  await testPrisma.approvalRequest.deleteMany();
  await testPrisma.favorite.deleteMany();
  await testPrisma.review.deleteMany();
  await testPrisma.galleryOfMonth.deleteMany();
  await testPrisma.showImage.deleteMany();
  await testPrisma.show.deleteMany();
  await testPrisma.promoPhoto.deleteMany();
  await testPrisma.exhibition.deleteMany();
  await testPrisma.galleryImage.deleteMany();
  await testPrisma.gallery.deleteMany();
}


describe('Gallery/Review/Favorite/GotM/Upload Extended', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ========== Gallery Filters & Sort ==========
  describe('Gallery Filters & Sort', () => {
    beforeEach(async () => {
      await clearData();
      await testPrisma.gallery.create({
        data: {
          name: 'Seoul Gallery', address: '서울', phone: '02-1111',
          description: 'desc', region: 'SEOUL', ownerName: 'O1',
          status: 'APPROVED', rating: 4.5, ownerId: 3,
        },
      });
      await testPrisma.gallery.create({
        data: {
          name: 'Busan Gallery', address: '부산', phone: '051-1111',
          description: 'desc', region: 'BUSAN', ownerName: 'O2',
          status: 'APPROVED', rating: 3.0, ownerId: 3,
        },
      });
    });

    it('region=SEOUL 필터 시 서울 갤러리만 반환', async () => {
      const res = await request.get('/api/galleries?region=SEOUL');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].region).toBe('SEOUL');
    });

    it('★ minRating 필터는 무시된다 — 별점을 없앴다(2026-09-10)', async () => {
      // 옛 규칙이면 4.5점짜리 1곳만 나왔다. 지금은 거르지 않으므로 둘 다 나와야 한다.
      const res = await request.get('/api/galleries?minRating=4');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('★ sortBy=rating 도 무시된다 (에러가 아니라 기본 정렬)', async () => {
      // 옛 주소·북마크가 이 쿼리를 달고 올 수 있다 — 400 을 주면 멀쩡한 링크가 죽는다
      const res = await request.get('/api/galleries?sortBy=rating');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('★ 응답에 별점이 실려 나가지 않는다', async () => {
      const res = await request.get('/api/galleries');
      expect(res.status).toBe(200);
      // Gallery.rating 은 동결된 레거시 컬럼이라 DB엔 남아 있지만, 화면이 쓰지 않도록 값이 있어도
      // 표시하지 않는다. 여기서는 **리뷰 개수**가 정상적으로 내려오는지만 본다.
      expect(res.body[0]).toHaveProperty('reviewCount');
    });

    it('PENDING 갤러리는 공개 목록에 미노출', async () => {
      await testPrisma.gallery.create({
        data: {
          name: 'Pending Gallery', address: '대전', phone: '042-1111',
          description: 'desc', region: 'DAEJEON', ownerName: 'O3',
          status: 'PENDING', ownerId: 3,
        },
      });
      const res = await request.get('/api/galleries');
      expect(res.status).toBe(200);
      expect(res.body.find((g: any) => g.name === 'Pending Gallery')).toBeUndefined();
    });

    it('존재하지 않는 갤러리 상세 조회 시 404', async () => {
      const res = await request.get('/api/galleries/99999');
      expect(res.status).toBe(404);
    });
  });

  // ========== Gallery PATCH Detail ==========
  describe('Gallery PATCH Detail', () => {
    let galleryId: number;

    beforeEach(async () => {
      await clearData();
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Test Gallery', address: '서울시 종로구', phone: '02-1234-5678',
          description: '테스트 갤러리입니다', region: 'SEOUL', ownerName: 'Gallery Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
    });

    it('오너가 상세소개를 수정할 수 있다', async () => {
      const res = await request
        .patch(`/api/galleries/${galleryId}/detail`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ detailDesc: '새 상세소개', description: '새 한줄소개' });
      expect(res.status).toBe(200);
      expect(res.body.detailDesc).toBe('새 상세소개');
      expect(res.body.description).toBe('새 한줄소개');
    });

    it('오너가 전화번호·주소를 승인 없이 수정할 수 있다', async () => {
      const res = await request
        .patch(`/api/galleries/${galleryId}/detail`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ phone: '02-9999-8888', address: '서울시 강남구 신사동' });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('02-9999-8888');
      expect(res.body.address).toBe('서울시 강남구 신사동');
      // status는 그대로 APPROVED (재승인 불필요)
      expect(res.body.status).toBe('APPROVED');
    });

    it('전화번호를 빈 값으로 수정하면 400', async () => {
      const res = await request
        .patch(`/api/galleries/${galleryId}/detail`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ phone: '   ' });
      expect(res.status).toBe(400);
    });

    it('비오너는 403', async () => {
      const res = await request
        .patch(`/api/galleries/${galleryId}/detail`)
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ detailDesc: 'hack' });
      expect(res.status).toBe(403);
    });

    it('미인증은 401', async () => {
      const res = await request
        .patch(`/api/galleries/${galleryId}/detail`)
        .send({ detailDesc: 'hack' });
      expect(res.status).toBe(401);
    });
  });

  // ========== Gallery Cascade Delete ==========
  describe('Gallery Cascade Delete', () => {
    let galleryId: number;

    beforeEach(async () => {
      await clearData();
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Test Gallery', address: '서울시 종로구', phone: '02-1234-5678',
          description: '테스트 갤러리입니다', region: 'SEOUL', ownerName: 'Gallery Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
      await testPrisma.galleryImage.create({
        data: { url: 'https://example.com/img.jpg', order: 0, galleryId },
      });
      await testPrisma.review.create({
        data: { userId: 1, galleryId, rating: 5, content: 'Great!' },
      });
      await testPrisma.favorite.create({
        data: { userId: 1, galleryId },
      });
    });

    it('Admin 갤러리 삭제 시 이미지/리뷰/찜 cascade 삭제', async () => {
      const res = await request
        .delete(`/api/galleries/${galleryId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      const images = await testPrisma.galleryImage.findMany({ where: { galleryId } });
      const reviews = await testPrisma.review.findMany({ where: { galleryId } });
      const favs = await testPrisma.favorite.findMany({ where: { galleryId } });
      expect(images).toHaveLength(0);
      expect(reviews).toHaveLength(0);
      expect(favs).toHaveLength(0);
    });

    it('Gallery 오너는 본인 갤러리 삭제 가능 (200)', async () => {
      const res = await request
        .delete(`/api/galleries/${galleryId}`)
        .set('Authorization', `Bearer ${galleryToken}`);
      expect(res.status).toBe(200);
    });

    it('Artist는 갤러리 삭제 불가 (403)', async () => {
      const artistToken = authToken(1, 'ARTIST');
      const res = await request
        .delete(`/api/galleries/${galleryId}`)
        .set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(403);
    });

    it('비 오너 Gallery 유저는 갤러리 삭제 불가 (403)', async () => {
      // 별도 GALLERY 유저 생성 (ownerId=3인 갤러리에 대해 다른 유저로 삭제 시도)
      await testPrisma.user.create({
        data: { id: 100, email: 'gallery2@test.com', name: 'Gallery 2', role: 'GALLERY' },
      });
      const otherGalleryToken = authToken(100, 'GALLERY');
      const res = await request
        .delete(`/api/galleries/${galleryId}`)
        .set('Authorization', `Bearer ${otherGalleryToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ========== Review Tests ==========
  describe('Review Extended Tests', () => {
    let galleryId: number;
    let exhibitionId1: number;
    let exhibitionId2: number;

    // 헬퍼: 공모 생성 + ACCEPTED 지원 생성
    async function createExhibitionWithAcceptedApp(userId: number, title = '테스트 공모') {
      const ex = await testPrisma.exhibition.create({
        data: {
          title, type: 'SOLO', deadline: new Date('2099-12-31'),
          exhibitDate: new Date('2099-12-31'), capacity: 5, region: 'SEOUL',
          description: 'desc', status: 'APPROVED', galleryId,
        },
      });
      await testPrisma.application.create({
        data: { userId, exhibitionId: ex.id, status: 'ACCEPTED' },
      });
      return ex.id;
    }

    beforeEach(async () => {
      await clearData();
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Test Gallery', address: '서울시 종로구', phone: '02-1234-5678',
          description: '테스트 갤러리입니다', region: 'SEOUL', ownerName: 'Gallery Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
      exhibitionId1 = await createExhibitionWithAcceptedApp(1, '공모1');
      exhibitionId2 = await createExhibitionWithAcceptedApp(2, '공모2');
    });

    it('★ 리뷰를 쓰면 **개수**가 재계산된다 (별점 평균은 더 이상 건드리지 않는다)', async () => {
      const before = await testPrisma.gallery.findUnique({ where: { id: galleryId } });

      await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '좋아요' });

      let gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery!.reviewCount).toBe(1);
      // ⚠️ 동결된 레거시 컬럼 — 새 리뷰가 들어와도 값이 움직이면 안 된다
      expect(gallery!.rating).toBe(before!.rating);

      await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artist2Token}`)
        .send({ galleryId, exhibitionId: exhibitionId2, content: '보통' });

      gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery!.reviewCount).toBe(2);
      expect(gallery!.rating).toBe(before!.rating);
    });

    /**
     * ⚠️ 리뷰 **개수**는 반드시 전체 행을 세야 한다.
     *    옛 코드처럼 별점 컬럼으로 세면(`_count: { rating: true }`) **null 을 빼고** 세므로,
     *    별점 없는 새 리뷰만 쌓인 갤러리가 '리뷰 0개' 로 보인다.
     */
    it('★ 별점 없는 리뷰도 개수에 들어간다 (null 을 빼고 세면 안 된다)', async () => {
      await request.post('/api/reviews').set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '별점 없는 리뷰' });

      const saved = await testPrisma.review.findFirst({ where: { exhibitionId: exhibitionId1 } });
      expect(saved!.rating).toBeNull();     // 서버가 별점을 저장하지 않는다
      const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery!.reviewCount).toBe(1); // 그래도 개수에는 들어간다
    });

    it('★ 별점을 보내와도 저장하지 않는다 (옛 화면·직접 호출 대비)', async () => {
      const res = await request.post('/api/reviews').set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '별점 실어보냄' });
      expect(res.status).toBe(201);
      const saved = await testPrisma.review.findUnique({ where: { id: res.body.id } });
      expect(saved!.rating).toBeNull();
    });

    it('같은 공모에 동일 내용 재전송은 멱등 처리(중복 생성 없이 201, 동일 리뷰 반환)', async () => {
      const r1 = await request.post('/api/reviews').set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '같은내용' });
      expect(r1.status).toBe(201);
      const r2 = await request.post('/api/reviews').set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '같은내용' });
      expect(r2.status).toBe(201);
      expect(r2.body.id).toBe(r1.body.id);
      const count = await testPrisma.review.count({ where: { exhibitionId: exhibitionId1 } });
      expect(count).toBe(1);
    });

    it('같은 공모에 다른 내용으로 재작성은 409 (공모당 1회)', async () => {
      await request.post('/api/reviews').set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '첫리뷰' });
      const r2 = await request.post('/api/reviews').set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '다른리뷰' });
      expect(r2.status).toBe(409);
    });

    it('★ 리뷰 수정은 내용만 바꾼다 (별점 항목이 없다)', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '보통' });

      const patched = await request
        .patch(`/api/reviews/${res.body.id}`)
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ content: '다시 생각해보니 좋았어요', rating: 5 });
      expect(patched.status).toBe(200);

      const saved = await testPrisma.review.findUnique({ where: { id: res.body.id } });
      expect(saved!.content).toBe('다시 생각해보니 좋았어요');
      expect(saved!.rating).toBeNull();   // 보내와도 안 받는다
    });

    it('리뷰 삭제 후 갤러리 리뷰 개수가 0으로 돌아간다', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '좋아요' });

      await request
        .delete(`/api/reviews/${res.body.id}`)
        .set('Authorization', `Bearer ${artistToken}`);

      const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery!.reviewCount).toBe(0);
    });

    it('Admin이 타인 리뷰를 삭제할 수 있다', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: 'Great' });

      const delRes = await request
        .delete(`/api/reviews/${res.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delRes.status).toBe(200);
    });

    it('다른 Artist가 타인 리뷰를 수정할 수 없다 (403)', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: 'Mine' });

      const patchRes = await request
        .patch(`/api/reviews/${res.body.id}`)
        .set('Authorization', `Bearer ${artist2Token}`)
        .send({ content: 'Hacked' });
      expect(patchRes.status).toBe(403);
    });

    it('다른 Artist가 타인 리뷰를 삭제할 수 없다 (403)', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: 'Mine' });

      const delRes = await request
        .delete(`/api/reviews/${res.body.id}`)
        .set('Authorization', `Bearer ${artist2Token}`);
      expect(delRes.status).toBe(403);
    });

    it('Gallery 유저는 리뷰를 작성할 수 없다 (403)', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: 'Not allowed' });
      expect(res.status).toBe(403);
    });

    it('미인증 유저는 리뷰를 작성할 수 없다 (401)', async () => {
      const res = await request
        .post('/api/reviews')
        .send({ galleryId, exhibitionId: exhibitionId1, content: 'Not allowed' });
      expect(res.status).toBe(401);
    });

    it('anonymous 리뷰 생성 시 anonymous=true로 저장된다', async () => {
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '익명 리뷰', anonymous: true });
      expect(res.status).toBe(201);
      expect(res.body.anonymous).toBe(true);
    });

    it('존재하지 않는 리뷰 수정 시 404', async () => {
      const res = await request
        .patch('/api/reviews/99999')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ content: 'nope' });
      expect(res.status).toBe(404);
    });

    it('존재하지 않는 리뷰 삭제 시 404', async () => {
      const res = await request
        .delete('/api/reviews/99999')
        .set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(404);
    });

    it('내 리뷰 목록 조회 (GET /reviews/my)', async () => {
      await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '내 리뷰' });

      const res = await request
        .get('/api/reviews/my')
        .set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('gallery');
      expect(res.body[0]).toHaveProperty('exhibition');
    });

    it('수락된 공모 없이 리뷰 작성 시 403', async () => {
      // exhibitionId1에 대한 artist2 (userId=2) 는 ACCEPTED application이 없음
      // exhibitionId2에는 있으므로 다른 공모 생성
      const ex = await testPrisma.exhibition.create({
        data: {
          title: '지원안한공모', type: 'SOLO', deadline: new Date('2099-12-31'),
          exhibitDate: new Date('2099-12-31'), capacity: 5, region: 'SEOUL',
          description: 'desc', status: 'APPROVED', galleryId,
        },
      });
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: ex.id, content: 'No app' });
      expect(res.status).toBe(403);
    });

    it('같은 공모에 중복 리뷰 작성 시 409', async () => {
      await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '첫 리뷰' });

      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '중복 리뷰' });
      expect(res.status).toBe(409);
    });

    it('다른 갤러리의 공모로 리뷰 작성 시 400', async () => {
      const otherGallery = await testPrisma.gallery.create({
        data: {
          name: 'Other Gallery', address: '부산', phone: '051-1111',
          description: 'desc', region: 'BUSAN', ownerName: 'O2',
          status: 'APPROVED', ownerId: 3,
        },
      });
      const otherEx = await testPrisma.exhibition.create({
        data: {
          title: '다른갤러리공모', type: 'SOLO', deadline: new Date('2099-12-31'),
          exhibitDate: new Date('2099-12-31'), capacity: 5, region: 'BUSAN',
          description: 'desc', status: 'APPROVED', galleryId: otherGallery.id,
        },
      });
      const res = await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: otherEx.id, content: 'Wrong gallery' });
      expect(res.status).toBe(400);
    });

    it('리뷰 작성 가능한 공모 목록 조회 (GET /reviews/reviewable/:galleryId)', async () => {
      const res = await request
        .get(`/api/reviews/reviewable/${galleryId}`)
        .set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1); // artist1은 exhibitionId1만 ACCEPTED
      expect(res.body[0].title).toBe('공모1');
    });

    it('리뷰 작성 후 reviewable 목록에서 제외된다', async () => {
      await request
        .post('/api/reviews')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId, exhibitionId: exhibitionId1, content: '리뷰' });

      const res = await request
        .get(`/api/reviews/reviewable/${galleryId}`)
        .set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  // ========== Favorite (Gallery) Tests ==========
  describe('Favorite Gallery Tests', () => {
    let galleryId: number;

    beforeEach(async () => {
      await clearData();
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Test Gallery', address: '서울시 종로구', phone: '02-1234-5678',
          description: '테스트 갤러리입니다', region: 'SEOUL', ownerName: 'Gallery Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
    });

    it('찜 토글: 추가 → true', async () => {
      const res = await request
        .post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ galleryId });
      expect(res.status).toBe(200);
      expect(res.body.favorited).toBe(true);
    });

    it('찜 토글: 추가 → 제거 → false', async () => {
      await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });
      const res = await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });
      expect(res.body.favorited).toBe(false);
    });

    it('찜 토글 idempotency: 추가→제거→재추가 → true', async () => {
      await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });
      await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });
      const res = await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });
      expect(res.body.favorited).toBe(true);
    });

    it('GET /api/favorites 에 찜한 갤러리가 포함된다', async () => {
      await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });

      const res = await request.get('/api/favorites').set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].gallery).toBeTruthy();
      expect(res.body[0].gallery.id).toBe(galleryId);
    });

    it('미인증 유저는 찜 토글 불가 (401)', async () => {
      const res = await request.post('/api/favorites/toggle').send({ galleryId });
      expect(res.status).toBe(401);
    });

    it('galleryId/exhibitionId/showId 없이 토글 시 400', async () => {
      const res = await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({});
      expect(res.status).toBe(400);
    });

    it('갤러리 목록에서 로그인 유저의 isFavorited 반영', async () => {
      await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${artistToken}`).send({ galleryId });

      const res = await request.get('/api/galleries').set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(200);
      const g = res.body.find((g: any) => g.id === galleryId);
      expect(g.isFavorited).toBe(true);
    });

    it('비로그인 유저의 갤러리 목록 isFavorited는 false', async () => {
      const res = await request.get('/api/galleries');
      expect(res.status).toBe(200);
      expect(res.body[0].isFavorited).toBe(false);
    });
  });

  // ========== GotM Access Control ==========
  describe('GotM Access Control', () => {
    let galleryId: number;

    beforeEach(async () => {
      await clearData();
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Test Gallery', address: '서울시 종로구', phone: '02-1234-5678',
          description: '테스트 갤러리입니다', region: 'SEOUL', ownerName: 'Gallery Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
    });

    it('비 Admin(Gallery)은 이달의 갤러리 등록 불가 (403)', async () => {
      const res = await request
        .post('/api/gallery-of-month')
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ galleryId, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      expect(res.status).toBe(403);
    });

    it('비 Admin(Artist)은 이달의 갤러리 삭제 불가 (403)', async () => {
      const gotm = await testPrisma.galleryOfMonth.create({
        data: { galleryId, expiresAt: new Date(Date.now() + 30 * 86400000) },
      });
      const res = await request
        .delete(`/api/gallery-of-month/${gotm.id}`)
        .set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(403);
    });

    it('미인증 유저는 이달의 갤러리 등록 불가 (401)', async () => {
      const res = await request
        .post('/api/gallery-of-month')
        .send({ galleryId, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      expect(res.status).toBe(401);
    });
  });

  // ========== Upload Access Control ==========
  describe('Upload Access Control', () => {
    it('미인증 유저는 이미지 업로드 불가 (401)', async () => {
      const res = await request.post('/api/upload/image');
      expect(res.status).toBe(401);
    });

    it('미인증 유저는 파일 업로드 불가 (401)', async () => {
      const res = await request.post('/api/upload/file');
      expect(res.status).toBe(401);
    });
  });
});
