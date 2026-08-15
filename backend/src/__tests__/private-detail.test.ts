/**
 * 승인 전/반려 항목이 **주소로 id 를 쳐도** 안 보이는지.
 *
 * 목록에서는 `status: 'APPROVED'` 로 걸러지는데 상세 라우트는 탈퇴(WITHDRAWN)만 막고 있었다.
 * 순번 id 라 1번부터 훑으면 심사 중인 갤러리 신청서와 반려 사유까지 비로그인에게 열렸다.
 *
 * 규칙: APPROVED 만 공개. 그 외는 당사자(운영자)와 Admin. 탈퇴분은 Admin 만.
 * 없는 것처럼 404 로 돌려준다 — 403 이면 "그 번호에 뭔가 있다"까지 알려주는 셈이다.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, seedGallery, testPrisma } from './helpers';

const ARTIST = 1, OWNER = 3, ADMIN = 4, OTHER_OWNER = 5;
let ownerToken: string, adminToken: string, artistToken: string, otherToken: string;
let galleryId: number;

const future = (d: number) => new Date(Date.now() + d * 86400000);

beforeAll(() => {
  ownerToken = authToken(OWNER, 'GALLERY');
  adminToken = authToken(ADMIN, 'ADMIN');
  artistToken = authToken(ARTIST, 'ARTIST');
  otherToken = authToken(OTHER_OWNER, 'GALLERY');
});

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  await testPrisma.user.create({ data: { id: OTHER_OWNER, email: 'other@test.com', name: '다른 갤러리', role: 'GALLERY' } });
  galleryId = (await seedGallery(OWNER)).id;
});

const mkExhibition = (status: string) => testPrisma.exhibition.create({
  data: {
    title: '비공개 공모', type: 'SOLO', deadline: future(20), exhibitDate: future(60),
    capacity: 3, region: 'SEOUL', description: '아직 공개되면 안 되는 내용', status, galleryId,
  },
});
const mkGallery = (status: string) => testPrisma.gallery.create({
  data: {
    name: '비공개 갤러리', address: '서울', phone: '02', description: '심사 중인 소개',
    region: 'SEOUL', ownerName: 'x', status, ownerId: OWNER,
  },
});
const mkShow = (status: string) => testPrisma.show.create({
  data: {
    title: '비공개 전시', description: '심사 중', startDate: future(1), endDate: future(30),
    openingHours: '10-18', admissionFee: '무료', location: '서울', region: 'SEOUL',
    posterImage: 'x.jpg', status, galleryId,
  },
});

const get = (path: string, token?: string) => {
  const r = request.get(path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

// [엔티티, 경로 만들기, 레코드 만들기]
const TARGETS = [
  ['공모', (id: number) => `/api/exhibitions/${id}`, mkExhibition],
  ['갤러리', (id: number) => `/api/galleries/${id}`, mkGallery],
  ['전시', (id: number) => `/api/shows/${id}`, mkShow],
] as const;

describe('승인 전·반려 항목은 주소로도 열리지 않는다', () => {
  for (const [name, path, make] of TARGETS) {
    describe(name, () => {
      for (const status of ['PENDING', 'REJECTED']) {
        it(`${status} — 비로그인 404 (목록에 없는데 상세만 열리면 안 된다)`, async () => {
          const row = await make(status);
          const res = await get(path(row.id));
          expect(res.status).toBe(404);
          expect(JSON.stringify(res.body)).not.toContain('아직 공개되면 안 되는 내용');
        });

        it(`${status} — 무관한 갤러리·작가도 404`, async () => {
          const row = await make(status);
          expect((await get(path(row.id), otherToken)).status).toBe(404);
          expect((await get(path(row.id), artistToken)).status).toBe(404);
        });

        it(`${status} — 당사자는 볼 수 있다 (반려 사유를 확인해야 한다)`, async () => {
          const row = await make(status);
          expect((await get(path(row.id), ownerToken)).status).toBe(200);
        });

        it(`${status} — Admin 은 볼 수 있다 (승인 심사)`, async () => {
          const row = await make(status);
          expect((await get(path(row.id), adminToken)).status).toBe(200);
        });
      }

      it('WITHDRAWN — 종전대로 Admin 만 (당사자에게도 다시 열지 않는다)', async () => {
        const row = await make('WITHDRAWN');
        expect((await get(path(row.id))).status).toBe(404);
        expect((await get(path(row.id), ownerToken)).status).toBe(404);
        expect((await get(path(row.id), adminToken)).status).toBe(200);
      });

      it('APPROVED — 비로그인도 볼 수 있다 (회귀 방지)', async () => {
        const row = await make('APPROVED');
        expect((await get(path(row.id))).status).toBe(200);
      });
    });
  }
});

describe('아트링크 주최 공모 — 참여 갤러리도 승인 전 상세를 본다', () => {
  it('위임받은 갤러리는 PENDING 이어도 볼 수 있고, 무관한 갤러리는 404', async () => {
    const otherGallery = await testPrisma.gallery.create({
      data: { name: '참여 갤러리', address: '서울', phone: '02', description: 'd', region: 'SEOUL', ownerName: 'x', status: 'APPROVED', ownerId: OTHER_OWNER },
    });
    const ex = await testPrisma.exhibition.create({
      data: {
        title: '아트링크 주최', type: 'GROUP', deadline: future(20), exhibitDate: future(60),
        capacity: 3, region: 'SEOUL', description: 'd', status: 'PENDING', hostType: 'ADMIN', galleryId,
        managers: { create: [{ galleryId }, { galleryId: otherGallery.id }] },
      },
    });
    expect((await get(`/api/exhibitions/${ex.id}`, otherToken)).status).toBe(200);   // 위임받음
    expect((await get(`/api/exhibitions/${ex.id}`, artistToken)).status).toBe(404);  // 무관
    expect((await get(`/api/exhibitions/${ex.id}`)).status).toBe(404);               // 비로그인
  });
});
