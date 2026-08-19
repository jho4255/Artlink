/**
 * 아트링크(Admin) 주최 공모 + 운영 갤러리 위임.
 *
 * 여기서 지켜야 하는 것 두 가지:
 *   1. admin 이 지정한 갤러리는 **자기 공모처럼** 운영할 수 있어야 한다(지원자·초대·소개·운영 페이지).
 *   2. 위임은 **아트링크 주최 공모에서만** 동작해야 한다. 갤러리가 등록한 공모에 위임 행이 섞여 들어가도
 *      권한이 새면 안 된다 — 남의 공모 지원자(개인정보)가 통째로 열리는 사고가 된다.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, testPrisma } from './helpers';

const ADMIN = 4;
const GALLERY_A_OWNER = 3;   // 주관 갤러리 오너
const GALLERY_B_OWNER = 5;   // 위임받은 운영 갤러리 오너
const OUTSIDER_OWNER = 6;    // 아무 관계 없는 갤러리 오너
const ARTIST = 1;

let adminToken: string, aToken: string, bToken: string, outsiderToken: string, artistToken: string;
let galleryA: number, galleryB: number, galleryC: number;

const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

const basePayload = () => ({
  title: '아트링크 기획공모',
  type: 'GROUP',
  deadlineStart: future(-1),
  deadline: future(20),
  exhibitStartDate: future(40),
  exhibitDate: future(60),
  submissionDeadline: future(30),   // 공모 마감(20)과 전시 시작(40) 사이
  capacity: 5,
  region: 'SEOUL',
  description: '아트링크가 주최하는 기획 공모입니다.',
});

async function createHosted(galleryIds: number[]) {
  return request
    .post('/api/exhibitions/hosted')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ...basePayload(), galleryIds });
}

beforeAll(() => {
  adminToken = authToken(ADMIN, 'ADMIN');
  aToken = authToken(GALLERY_A_OWNER, 'GALLERY');
  bToken = authToken(GALLERY_B_OWNER, 'GALLERY');
  outsiderToken = authToken(OUTSIDER_OWNER, 'GALLERY');
  artistToken = authToken(ARTIST, 'ARTIST');
});

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  for (const [id, email] of [[GALLERY_B_OWNER, 'gallery-b@test.com'], [OUTSIDER_OWNER, 'gallery-c@test.com']] as const) {
    await testPrisma.user.create({ data: { id, email, name: `Gallery ${id}`, role: 'GALLERY' } });
  }
  const mk = async (ownerId: number, name: string, status = 'APPROVED') =>
    (await testPrisma.gallery.create({
      data: { name, address: '서울', phone: '02-0000-0000', description: 'd', region: 'SEOUL', ownerName: name, status, ownerId },
    })).id;
  galleryA = await mk(GALLERY_A_OWNER, '가나갤러리');
  galleryB = await mk(GALLERY_B_OWNER, '나다갤러리');
  galleryC = await mk(OUTSIDER_OWNER, '다라갤러리');
});

// ───────────────────────────────────────────────────────── 등록
describe('POST /api/exhibitions/hosted — 아트링크 주최 공모 등록', () => {
  it('Admin이 등록하면 승인 없이 바로 게시되고 첫 번째 갤러리가 주관이 된다', async () => {
    const res = await createHosted([galleryA, galleryB]);
    expect(res.status).toBe(201);
    expect(res.body.hostType).toBe('ADMIN');
    expect(res.body.status).toBe('APPROVED'); // 주최자가 관리자 → 승인 큐를 타지 않는다
    expect(res.body.galleryId).toBe(galleryA);

    const managers = await testPrisma.exhibitionManager.findMany({ where: { exhibitionId: res.body.id } });
    expect(managers.map(m => m.galleryId).sort()).toEqual([galleryA, galleryB].sort());
  });

  it('승인 큐에 요청을 만들지 않는다', async () => {
    const res = await createHosted([galleryA]);
    const approvals = await testPrisma.approvalRequest.count({ where: { targetId: res.body.id } });
    expect(approvals).toBe(0);
  });

  it('지정된 갤러리 오너 전원에게 알림이 간다', async () => {
    await createHosted([galleryA, galleryB]);
    const notis = await testPrisma.notification.findMany({ where: { type: 'EXHIBITION_MANAGER_ASSIGNED' } });
    expect(notis.map(n => n.userId).sort()).toEqual([GALLERY_A_OWNER, GALLERY_B_OWNER].sort());
  });

  it('Gallery 계정은 등록할 수 없다', async () => {
    const res = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${aToken}`)
      .send({ ...basePayload(), galleryIds: [galleryA] });
    expect(res.status).toBe(403);
  });

  it('운영 갤러리를 하나도 고르지 않으면 400', async () => {
    const res = await createHosted([]);
    expect(res.status).toBe(400);
  });

  it('승인되지 않은 갤러리는 운영 갤러리로 지정할 수 없다', async () => {
    const pending = await testPrisma.gallery.create({
      data: { name: '대기갤러리', address: '서울', phone: '02', description: 'd', region: 'SEOUL', ownerName: 'x', status: 'PENDING', ownerId: OUTSIDER_OWNER },
    });
    const res = await createHosted([galleryA, pending.id]);
    expect(res.status).toBe(400);
    expect(await testPrisma.exhibition.count()).toBe(0); // 일부만 저장되지 않는다
  });
});

// ───────────────────────────────────────────────────────── 운영 권한
describe('운영 갤러리 위임', () => {
  let exId: number;
  let appId: number;

  beforeEach(async () => {
    const res = await createHosted([galleryA, galleryB]);
    exId = res.body.id;
    const app = await testPrisma.application.create({
      data: { userId: ARTIST, exhibitionId: exId, biography: '약력', artworkImages: JSON.stringify(['x.jpg']) },
    });
    appId = app.id;
  });

  it('위임받은 갤러리의 내 공모 목록에 나온다', async () => {
    const res = await request.get('/api/exhibitions/my-exhibitions').set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((e: any) => e.id)).toContain(exId);
    expect(res.body[0].hostType).toBe('ADMIN');
  });

  it('위임받지 않은 갤러리의 목록에는 나오지 않는다', async () => {
    const res = await request.get('/api/exhibitions/my-exhibitions').set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.body.map((e: any) => e.id)).not.toContain(exId);
  });

  it('운영 대시보드(my-operation-overview)에도 나온다', async () => {
    const res = await request.get('/api/exhibitions/my-operation-overview').set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((e: any) => e.id)).toContain(exId);
  });

  it('위임받은 갤러리가 지원자 목록을 볼 수 있다', async () => {
    const res = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('위임받지 않은 갤러리는 지원자 목록 403 — 개인정보가 새면 안 된다', async () => {
    const res = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('위임받은 갤러리가 지원 상태를 바꿀 수 있다', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${bToken}`).send({ status: 'ACCEPTED' });
    expect(res.status).toBe(200);
    expect((await testPrisma.application.findUnique({ where: { id: appId } }))!.status).toBe('ACCEPTED');
  });

  it('위임받지 않은 갤러리는 지원 상태를 바꿀 수 없다', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${outsiderToken}`).send({ status: 'ACCEPTED' });
    expect(res.status).toBe(403);
    expect((await testPrisma.application.findUnique({ where: { id: appId } }))!.status).toBe('SUBMITTED');
  });

  it('위임받은 갤러리가 운영 페이지에 오너 권한으로 들어간다', async () => {
    const res = await request.get(`/api/operations/${exId}/access`).set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
  });

  it('위임받지 않은 갤러리는 운영 페이지 403', async () => {
    const res = await request.get(`/api/operations/${exId}/access`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('위임받은 갤러리가 공모 소개를 수정할 수 있다', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/description`)
      .set('Authorization', `Bearer ${bToken}`).send({ description: '수정된 소개' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('수정된 소개');
  });

  it('위임받은 갤러리가 작가를 초대할 수 있다', async () => {
    const res = await request.post(`/api/exhibitions/${exId}/invite`)
      .set('Authorization', `Bearer ${bToken}`).send({ artistId: 2 });
    expect(res.status).toBe(201);
  });

  it('상세 조회에 운영 갤러리 목록과 canOperate 가 내려온다', async () => {
    const res = await request.get(`/api/exhibitions/${exId}`).set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.hostType).toBe('ADMIN');
    expect(res.body.managerGalleries.map((g: any) => g.name)).toEqual(['가나갤러리', '나다갤러리']);
    expect(res.body.canOperate).toBe(true);

    const outsider = await request.get(`/api/exhibitions/${exId}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(outsider.body.canOperate).toBe(false);

    const anon = await request.get(`/api/exhibitions/${exId}`);
    expect(anon.body.canOperate).toBe(false);
  });

  it('새 지원자 알림이 운영 갤러리 오너 전원에게 간다', async () => {
    await testPrisma.notification.deleteMany();
    await testPrisma.portfolio.create({ data: { userId: 2, biography: 'b' } });
    const res = await request.post(`/api/exhibitions/${exId}/apply`)
      .set('Authorization', `Bearer ${authToken(2, 'ARTIST')}`)
      .send({
        biography: '약력입니다',
        artworkImages: ['https://example.com/a.jpg'],
        termsAgreed: true,
        termsVersion: 'artist_apply_2026-07-03',
      });
    expect(res.status).toBe(201);
    const notis = await testPrisma.notification.findMany({ where: { type: 'NEW_APPLICANT' } });
    expect(notis.map(n => n.userId).sort()).toEqual([GALLERY_A_OWNER, GALLERY_B_OWNER].sort());
  });
});

// ───────────────────────────────────────────────────────── Admin 운영 권한
// Admin 은 승인·삭제·운영 페이지를 이미 전부 볼 수 있는데 지원자 수락/거절만 막혀 있었다
// (`authorize('GALLERY')` 가 ADMIN 을 걸러냈다). 주최까지 하게 됐으니 같은 기준으로 연다.
describe('Admin 도 지원자 관리·운영을 할 수 있다', () => {
  let hostedId: number;
  let galleryOwnedId: number;
  let hostedAppId: number;
  let ownedAppId: number;

  beforeEach(async () => {
    hostedId = (await createHosted([galleryA, galleryB])).body.id;
    galleryOwnedId = (await testPrisma.exhibition.create({
      data: {
        title: '갤러리 자체 공모', type: 'SOLO',
        deadline: new Date(Date.now() + 20 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: galleryA,
      },
    })).id;
    for (const [exhibitionId, target] of [[hostedId, 'hosted'], [galleryOwnedId, 'owned']] as const) {
      const app = await testPrisma.application.create({
        data: { userId: ARTIST, exhibitionId, biography: '약력', artworkImages: JSON.stringify(['x.jpg']) },
      });
      if (target === 'hosted') hostedAppId = app.id; else ownedAppId = app.id;
    }
  });

  it('지원자 목록을 볼 수 있다 (주최 공모 / 갤러리 공모 모두)', async () => {
    for (const id of [hostedId, galleryOwnedId]) {
      const res = await request.get(`/api/exhibitions/${id}/applications`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    }
  });

  it('★ 지원을 수락할 수 있다 (원래 막혀 있던 것)', async () => {
    const res = await request.patch(`/api/exhibitions/${hostedId}/applications/${hostedAppId}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACCEPTED' });
    expect(res.status).toBe(200);
    expect((await testPrisma.application.findUnique({ where: { id: hostedAppId } }))!.status).toBe('ACCEPTED');
  });

  it('갤러리가 등록한 공모의 지원도 거절할 수 있다', async () => {
    const res = await request.patch(`/api/exhibitions/${galleryOwnedId}/applications/${ownedAppId}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'REJECTED' });
    expect(res.status).toBe(200);
  });

  it('작가 초대 · 초대 목록 조회', async () => {
    expect((await request.post(`/api/exhibitions/${hostedId}/invite`)
      .set('Authorization', `Bearer ${adminToken}`).send({ artistId: 2 })).status).toBe(201);
    const res = await request.get(`/api/exhibitions/${hostedId}/invites`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.artistIds).toContain(2);
  });

  it('소개 · 추가 질문 수정', async () => {
    expect((await request.patch(`/api/exhibitions/${hostedId}/description`)
      .set('Authorization', `Bearer ${adminToken}`).send({ description: 'admin이 고친 소개' })).status).toBe(200);
    const res = await request.patch(`/api/exhibitions/${hostedId}/custom-fields`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customFields: [{ id: 'q1', label: '한 줄 각오', type: 'text', required: false }] });
    expect(res.status).toBe(200);
    expect(res.body.customFields).toHaveLength(1);
  });

  it('작가는 여전히 지원자 목록에 접근할 수 없다 (권한을 넓히되 새지 않게)', async () => {
    const res = await request.get(`/api/exhibitions/${hostedId}/applications`).set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────── "admin 주최일 때만" 규칙
describe('위임은 아트링크 주최 공모에서만 동작한다', () => {
  it('갤러리 주최 공모에 운영 갤러리 행이 있어도 권한을 주지 않는다', async () => {
    // 갤러리 A가 직접 등록한 공모 (hostType='GALLERY')
    const ex = await testPrisma.exhibition.create({
      data: {
        title: '갤러리 자체 공모', type: 'SOLO',
        deadline: new Date(Date.now() + 20 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: galleryA,
      },
    });
    // 어떤 경로로든 위임 행이 들어갔다고 가정
    await testPrisma.exhibitionManager.create({ data: { exhibitionId: ex.id, galleryId: galleryB } });

    expect((await request.get(`/api/exhibitions/${ex.id}/applications`).set('Authorization', `Bearer ${bToken}`)).status).toBe(403);
    expect((await request.get(`/api/operations/${ex.id}/access`).set('Authorization', `Bearer ${bToken}`)).status).toBe(403);
    const list = await request.get('/api/exhibitions/my-exhibitions').set('Authorization', `Bearer ${bToken}`);
    expect(list.body.map((e: any) => e.id)).not.toContain(ex.id);
  });

  it('갤러리 주최 공모에는 운영 갤러리를 지정할 수 없다', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: '갤러리 자체 공모', type: 'SOLO',
        deadline: new Date(Date.now() + 20 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: galleryA,
      },
    });
    const res = await request.patch(`/api/exhibitions/${ex.id}/managers`)
      .set('Authorization', `Bearer ${adminToken}`).send({ galleryIds: [galleryB] });
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────── 삭제
describe('삭제 권한', () => {
  it('운영 갤러리는 아트링크 주최 공모를 삭제할 수 없다 (주관 갤러리도 마찬가지)', async () => {
    const { body } = await createHosted([galleryA, galleryB]);
    for (const token of [aToken, bToken]) {
      const res = await request.delete(`/api/exhibitions/${body.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
    expect(await testPrisma.exhibition.count({ where: { id: body.id } })).toBe(1);
  });

  it('Admin은 삭제할 수 있고 운영 갤러리 행도 함께 사라진다', async () => {
    const { body } = await createHosted([galleryA, galleryB]);
    const res = await request.delete(`/api/exhibitions/${body.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(await testPrisma.exhibitionManager.count({ where: { exhibitionId: body.id } })).toBe(0);
  });

  it('갤러리가 직접 등록한 공모는 종전대로 본인이 삭제할 수 있다 (회귀 방지)', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: '자체 공모', type: 'SOLO',
        deadline: new Date(Date.now() + 20 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: galleryA,
      },
    });
    const res = await request.delete(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${aToken}`);
    expect(res.status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────── 운영 갤러리 변경
describe('PATCH /api/exhibitions/:id/managers', () => {
  let exId: number;
  beforeEach(async () => {
    const res = await createHosted([galleryA, galleryB]);
    exId = res.body.id;
  });

  it('목록을 통째로 교체하고 첫 번째가 새 주관 갤러리가 된다', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/managers`)
      .set('Authorization', `Bearer ${adminToken}`).send({ galleryIds: [galleryC, galleryA] });
    expect(res.status).toBe(200);
    expect(res.body.managerGalleries.map((g: any) => g.id)).toEqual([galleryC, galleryA]);
    expect((await testPrisma.exhibition.findUnique({ where: { id: exId } }))!.galleryId).toBe(galleryC);
  });

  it('제외된 갤러리는 곧바로 접근이 끊긴다', async () => {
    await request.patch(`/api/exhibitions/${exId}/managers`)
      .set('Authorization', `Bearer ${adminToken}`).send({ galleryIds: [galleryA] });
    const res = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(403);
  });

  it('새로 추가된 갤러리에만 알림을 보낸다 (기존 갤러리 중복 발송 없음)', async () => {
    await testPrisma.notification.deleteMany();
    await request.patch(`/api/exhibitions/${exId}/managers`)
      .set('Authorization', `Bearer ${adminToken}`).send({ galleryIds: [galleryA, galleryB, galleryC] });
    const notis = await testPrisma.notification.findMany({ where: { type: 'EXHIBITION_MANAGER_ASSIGNED' } });
    expect(notis.map(n => n.userId)).toEqual([OUTSIDER_OWNER]);
  });

  it('Gallery 계정은 운영 갤러리를 바꿀 수 없다', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/managers`)
      .set('Authorization', `Bearer ${aToken}`).send({ galleryIds: [galleryA] });
    expect(res.status).toBe(403);
  });

  it('빈 목록으로는 바꿀 수 없다 — 주관 갤러리가 사라지면 안 된다', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/managers`)
      .set('Authorization', `Bearer ${adminToken}`).send({ galleryIds: [] });
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────── 갤러리 상세
describe('갤러리 상세 — 운영을 위임받은 공고도 함께 보인다', () => {
  let exId: number;
  beforeEach(async () => {
    exId = (await createHosted([galleryA, galleryB])).body.id;
  });

  const exhibitionIds = async (galleryId: number) =>
    (await (await request.get(`/api/galleries/${galleryId}`)).body.exhibitions as any[]).map(e => e.id);

  it('위임받은 갤러리(주관 아님) 페이지에 나온다', async () => {
    const res = await request.get(`/api/galleries/${galleryB}`);
    expect(res.status).toBe(200);
    const found = res.body.exhibitions.find((e: any) => e.id === exId);
    expect(found).toBeTruthy();
    expect(found.hostType).toBe('ADMIN'); // 배지를 붙일 수 있어야 한다
  });

  it('주관 갤러리 페이지에는 딱 한 번만 나온다 (관계 + 위임 중복 방지)', async () => {
    const res = await request.get(`/api/galleries/${galleryA}`);
    expect(res.body.exhibitions.filter((e: any) => e.id === exId)).toHaveLength(1);
  });

  it('위임받지 않은 갤러리 페이지에는 나오지 않는다', async () => {
    expect(await exhibitionIds(galleryC)).not.toContain(exId);
  });

  it('마감일 순 정렬이 유지된다', async () => {
    // 이 공모보다 마감이 빠른 갤러리B 자체 공모를 하나 만든다
    await testPrisma.exhibition.create({
      data: {
        title: '갤러리B 자체 공모', type: 'SOLO',
        deadline: new Date(Date.now() + 5 * 86400000),
        exhibitDate: new Date(Date.now() + 60 * 86400000),
        capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: galleryB,
      },
    });
    const list = (await request.get(`/api/galleries/${galleryB}`)).body.exhibitions as any[];
    const deadlines = list.map(e => new Date(e.deadline).getTime());
    expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);
  });

  it('승인 전(PENDING) 아트링크 주최 공모는 위임 갤러리 페이지에도 안 나온다', async () => {
    await testPrisma.exhibition.update({ where: { id: exId }, data: { status: 'PENDING' } });
    expect(await exhibitionIds(galleryB)).not.toContain(exId);
  });
});

// ───────────────────────────────────────────────────────── 공개 목록 회귀
describe('공개 화면 회귀', () => {
  it('아트링크 주최 공모도 모집공고 목록에 바로 노출된다', async () => {
    const { body } = await createHosted([galleryA]);
    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    const found = res.body.find((e: any) => e.id === body.id);
    expect(found).toBeTruthy();
    expect(found.hostType).toBe('ADMIN');
  });

  it('작가는 평소처럼 지원할 수 있다', async () => {
    const { body } = await createHosted([galleryA]);
    await testPrisma.portfolio.create({ data: { userId: ARTIST, biography: 'b' } });
    const res = await request.post(`/api/exhibitions/${body.id}/apply`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({
        biography: '약력입니다',
        artworkImages: ['https://example.com/a.jpg'],
        termsAgreed: true,
        termsVersion: 'artist_apply_2026-07-03',
      });
    expect(res.status).toBe(201);
  });
});
