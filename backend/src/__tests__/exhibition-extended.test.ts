/**
 * Exhibition Extended Tests
 *
 * 커버리지 보완: 필터(region/type/rating), PATCH description,
 * DELETE, 상세 조회, 지원(중복/만료/권한), 찜 토글, 내 목록 등
 *
 * 각 테스트에서 필요한 데이터를 직접 생성하여 다른 테스트 파일과의 격리 보장
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  request, authToken, cleanDb, seedUsers, seedGallery, testPrisma,
} from './helpers';

const artistToken = authToken(1, 'ARTIST');
const artist2Token = authToken(2, 'ARTIST');
const galleryToken = authToken(3, 'GALLERY');
const adminToken = authToken(4, 'ADMIN');

let galleryId: number;

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

// 테스트용 공모 생성 (inline 헬퍼)
async function createExhibition(overrides: Record<string, any> = {}) {
  return testPrisma.exhibition.create({
    data: {
      title: overrides.title || 'Test Exhibition',
      type: overrides.type || 'SOLO',
      deadline: overrides.deadline || new Date(Date.now() + 30 * 86400000),
      exhibitDate: overrides.exhibitDate || new Date(Date.now() + 60 * 86400000),
      capacity: overrides.capacity || 5,
      region: overrides.region || 'SEOUL',
      description: overrides.description || '테스트 공모입니다',
      status: overrides.status || 'APPROVED',
      galleryId: overrides.galleryId || galleryId,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  // 기존 데이터 위에 upsert로 유저 보장 (cleanDb 데드락 회피)
  const users = [
    { id: 1, email: 'artist1@test.com', name: 'Artist 1', role: 'ARTIST' },
    { id: 2, email: 'artist2@test.com', name: 'Artist 2', role: 'ARTIST' },
    { id: 3, email: 'gallery@test.com', name: 'Gallery Owner', role: 'GALLERY' },
    { id: 4, email: 'admin@test.com', name: 'Admin', role: 'ADMIN' },
  ];
  for (const u of users) {
    await testPrisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: u,
    });
  }
  // 갤러리도 upsert 또는 find-or-create
  let gallery = await testPrisma.gallery.findFirst({ where: { ownerId: 3, status: 'APPROVED' } });
  if (!gallery) {
    gallery = await seedGallery();
  }
  galleryId = gallery.id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// ─── GET /exhibitions 필터 ───

describe('Exhibition filters (GET /exhibitions)', () => {
  it('region 필터', async () => {
    const ex1 = await createExhibition({ title: 'Seoul Ex', region: 'SEOUL' });
    const ex2 = await createExhibition({ title: 'Busan Ex', region: 'BUSAN' });

    const res = await request.get('/api/exhibitions?region=BUSAN');
    expect(res.status).toBe(200);
    const found = res.body.find((e: any) => e.id === ex2.id);
    expect(found).toBeDefined();
    expect(found.title).toBe('Busan Ex');
    // Seoul 공모는 결과에 없어야 함
    expect(res.body.find((e: any) => e.id === ex1.id)).toBeUndefined();

    // cleanup
    await testPrisma.exhibition.deleteMany({ where: { id: { in: [ex1.id, ex2.id] } } });
  });

  it('type 필터', async () => {
    const solo = await createExhibition({ title: 'Solo Ex', type: 'SOLO' });
    const group = await createExhibition({ title: 'Group Ex', type: 'GROUP' });

    const res = await request.get('/api/exhibitions?type=GROUP');
    expect(res.status).toBe(200);
    expect(res.body.find((e: any) => e.id === group.id)).toBeDefined();
    expect(res.body.find((e: any) => e.id === solo.id)).toBeUndefined();

    await testPrisma.exhibition.deleteMany({ where: { id: { in: [solo.id, group.id] } } });
  });

  it('minGalleryRating 필터 — 평점 미달 시 빈 배열', async () => {
    const ex = await createExhibition({ title: 'Rating Filter Test' });

    // gallery rating 기본 0 → 4점 이상 필터 시 해당 공모 미포함
    const res = await request.get('/api/exhibitions?minGalleryRating=4');
    expect(res.status).toBe(200);
    expect(res.body.find((e: any) => e.id === ex.id)).toBeUndefined();

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('로그인 시 isFavorited 포함', async () => {
    const ex = await createExhibition({ title: 'Fav Filter Test' });
    await testPrisma.favorite.create({ data: { userId: 1, exhibitionId: ex.id } });

    const res = await request
      .get('/api/exhibitions')
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((e: any) => e.id === ex.id);
    expect(found).toBeDefined();
    expect(found.isFavorited).toBe(true);

    await testPrisma.favorite.deleteMany({ where: { exhibitionId: ex.id } });
    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });
});

// ─── GET /exhibitions/:id 상세 ───

describe('Exhibition detail (GET /exhibitions/:id)', () => {
  it('존재하지 않는 공모 → 404', async () => {
    const res = await request.get('/api/exhibitions/99999');
    expect(res.status).toBe(404);
  });

  it('상세 조회 시 gallery 정보 포함', async () => {
    const ex = await createExhibition({ title: 'Detail Test' });
    const res = await request.get(`/api/exhibitions/${ex.id}`);
    expect(res.status).toBe(200);
    expect(res.body.gallery).toBeDefined();
    expect(res.body.gallery.name).toBe('Test Gallery');
    expect(res.body.isFavorited).toBe(false);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('로그인 시 isFavorited 반영', async () => {
    const ex = await createExhibition({ title: 'Detail Fav Test' });
    await testPrisma.favorite.create({ data: { userId: 1, exhibitionId: ex.id } });

    const res = await request
      .get(`/api/exhibitions/${ex.id}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.body.isFavorited).toBe(true);

    await testPrisma.favorite.deleteMany({ where: { exhibitionId: ex.id } });
    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });
});

// ─── PATCH /exhibitions/:id/description ───

describe('Exhibition description PATCH', () => {
  it('오너가 소개 수정 성공', async () => {
    const ex = await createExhibition({ title: 'Patch Desc Test' });
    const res = await request
      .patch(`/api/exhibitions/${ex.id}/description`)
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ description: '수정된 소개' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('수정된 소개');

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('비오너 수정 시 403', async () => {
    const ex = await createExhibition({ title: 'Patch 403 Test' });
    const res = await request
      .patch(`/api/exhibitions/${ex.id}/description`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ description: '해킹' });
    expect(res.status).toBe(403);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('존재하지 않는 공모 → 404', async () => {
    const res = await request
      .patch('/api/exhibitions/99999/description')
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ description: 'test' });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /exhibitions/:id ───

describe('Exhibition DELETE', () => {
  it('오너가 삭제 성공', async () => {
    const ex = await createExhibition({ title: 'Delete Owner Test' });
    const res = await request
      .delete(`/api/exhibitions/${ex.id}`)
      .set('Authorization', `Bearer ${galleryToken}`);
    expect(res.status).toBe(200);
    const check = await testPrisma.exhibition.findUnique({ where: { id: ex.id } });
    expect(check).toBeNull();
  });

  it('Admin이 삭제 성공', async () => {
    const ex = await createExhibition({ title: 'Delete Admin Test' });
    const res = await request
      .delete(`/api/exhibitions/${ex.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('비오너/비Admin 삭제 시 403', async () => {
    const ex = await createExhibition({ title: 'Delete 403 Test' });
    const res = await request
      .delete(`/api/exhibitions/${ex.id}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(403);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('삭제 시 Application cascade 삭제', async () => {
    const ex = await createExhibition({ title: 'Delete Cascade Test' });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id } });

    await request
      .delete(`/api/exhibitions/${ex.id}`)
      .set('Authorization', `Bearer ${galleryToken}`);

    const apps = await testPrisma.application.findMany({ where: { exhibitionId: ex.id } });
    expect(apps).toHaveLength(0);
  });
});

// ─── POST /exhibitions/:id/apply — edge cases ───

describe('Exhibition apply edge cases', () => {
  it('중복 지원 → 400', async () => {
    const ex = await createExhibition({ title: 'Dup Apply Test' });
    const res1 = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({});
    expect(res1.status).toBe(201);

    const res2 = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({});
    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain('이미');

    await testPrisma.application.deleteMany({ where: { exhibitionId: ex.id } });
    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('만료된 공모에도 지원 가능 (서버에 만료 체크 없음)', async () => {
    const ex = await createExhibition({
      title: 'Expired Apply Test',
      deadline: new Date(Date.now() - 86400000),
    });
    const res = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({});
    expect(res.status).toBe(201);

    await testPrisma.application.deleteMany({ where: { exhibitionId: ex.id } });
    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('GALLERY 역할로 지원 → 403', async () => {
    const ex = await createExhibition({ title: 'Gallery Apply Test' });
    const res = await request
      .post(`/api/exhibitions/${ex.id}/apply`)
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({});
    expect(res.status).toBe(403);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('비로그인 지원 → 401', async () => {
    const res = await request
      .post('/api/exhibitions/1/apply')
      .send({});
    expect(res.status).toBe(401);
  });

  it('존재하지 않는 공모 지원 → 404', async () => {
    const res = await request
      .post('/api/exhibitions/99999/apply')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

// ─── GET /exhibitions/my-applications ───

describe('My applications (GET /exhibitions/my-applications)', () => {
  it('Artist 지원 내역 조회', async () => {
    const ex = await createExhibition({ title: 'My App Test' });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id } });

    const res = await request
      .get('/api/exhibitions/my-applications')
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((a: any) => a.exhibitionId === ex.id);
    expect(found).toBeDefined();
    expect(found.exhibition.title).toBe('My App Test');

    await testPrisma.application.deleteMany({ where: { exhibitionId: ex.id } });
    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('비Artist → 403', async () => {
    const res = await request
      .get('/api/exhibitions/my-applications')
      .set('Authorization', `Bearer ${galleryToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /exhibitions/my-exhibitions ───

describe('My exhibitions (GET /exhibitions/my-exhibitions)', () => {
  it('Gallery 유저의 공모 목록 조회', async () => {
    const ex = await createExhibition({ title: 'My Ex Test' });

    const res = await request
      .get('/api/exhibitions/my-exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((e: any) => e.id === ex.id);
    expect(found).toBeDefined();

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('비Gallery → 403', async () => {
    const res = await request
      .get('/api/exhibitions/my-exhibitions')
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── Favorite toggle for exhibitions ───

describe('Favorite toggle — exhibition', () => {
  it('찜 토글: 추가 → 제거', async () => {
    const ex = await createExhibition({ title: 'Fav Toggle Test' });

    const res1 = await request
      .post('/api/favorites/toggle')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ exhibitionId: ex.id });
    expect(res1.status).toBe(200);
    expect(res1.body.favorited).toBe(true);

    const res2 = await request
      .post('/api/favorites/toggle')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ exhibitionId: ex.id });
    expect(res2.status).toBe(200);
    expect(res2.body.favorited).toBe(false);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('GET /favorites — exhibition 포함', async () => {
    const ex = await createExhibition({ title: 'Fav List Test' });
    await testPrisma.favorite.create({ data: { userId: 1, exhibitionId: ex.id } });

    const res = await request
      .get('/api/favorites')
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((f: any) => f.exhibitionId === ex.id);
    expect(found).toBeDefined();
    expect(found.exhibition.title).toBe('Fav List Test');

    await testPrisma.favorite.deleteMany({ where: { exhibitionId: ex.id } });
    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('비로그인 찜 토글 → 401', async () => {
    const res = await request
      .post('/api/favorites/toggle')
      .send({ exhibitionId: 1 });
    expect(res.status).toBe(401);
  });
});

// ─── POST /exhibitions — validation ───

describe('Exhibition create validation', () => {
  it('다른 역할(ARTIST)이 공모 등록 시 403', async () => {
    const res = await request
      .post('/api/exhibitions')
      .set('Authorization', `Bearer ${artist2Token}`)
      .send({
        title: 'Hack', type: 'SOLO',
        deadline: futureDate(30), exhibitDate: futureDate(60),
        capacity: 5, region: 'SEOUL', description: 't', galleryId,
      });
    expect(res.status).toBe(403);
  });

  it('필수 필드 누락 시 400', async () => {
    const res = await request
      .post('/api/exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ title: 'No Fields' });
    expect(res.status).toBe(400);
  });
});

// ─── Promo photos ───

describe('Promo photos', () => {
  it('홍보 사진 등록/삭제', async () => {
    const ex = await createExhibition({ title: 'Promo Test' });

    const res1 = await request
      .post(`/api/exhibitions/${ex.id}/promo-photos`)
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ url: 'https://example.com/promo.jpg', caption: '사진1' });
    expect(res1.status).toBe(201);
    expect(res1.body.url).toBe('https://example.com/promo.jpg');

    const res2 = await request
      .delete(`/api/exhibitions/${ex.id}/promo-photos/${res1.body.id}`)
      .set('Authorization', `Bearer ${galleryToken}`);
    expect(res2.status).toBe(200);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });

  it('비Gallery 역할 홍보 사진 등록 → 403', async () => {
    const ex = await createExhibition({ title: 'Promo 403 Test' });
    const res = await request
      .post(`/api/exhibitions/${ex.id}/promo-photos`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ url: 'https://example.com/hack.jpg' });
    expect(res.status).toBe(403);

    await testPrisma.exhibition.delete({ where: { id: ex.id } });
  });
});
