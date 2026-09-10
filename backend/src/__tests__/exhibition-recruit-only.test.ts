/**
 * 공모만 진행하는 공고 (`recruitOnly`, 2026-09-10)
 *
 * 지원 → **수락에서 끝**. 자료제출·전시확정/종료·판매·정산 단계가 아예 없다.
 *
 * 여기서 지켜야 하는 것:
 *   1. 등록할 때 **자료제출 마감일을 요구하지 않는다** (그 단계가 없으므로).
 *   2. 뒷 단계 라우트는 **서버가 400 으로 막는다** — 화면에서 버튼만 감추면
 *      옛 알림·주소로 들어와 아무도 안 보는 자료·정산 데이터가 생긴다.
 *   3. **지원·수락·모집마감은 그대로 된다** — 막는 건 그 뒤뿐이다.
 *   4. 기본값(`recruitOnly` 미지정)은 종전과 완전히 같다.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, testPrisma } from './helpers';

const GALLERY_OWNER = 3;
const ADMIN = 4;
const ARTIST = 1;

let galleryToken: string, adminToken: string, artistToken: string;
let galleryId: number;

const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

const basePayload = () => ({
  title: '공모만 하는 공고',
  type: 'GROUP',
  deadlineStart: future(-1),
  deadline: future(20),
  exhibitStartDate: future(40),
  exhibitDate: future(60),
  capacity: 5,
  region: 'SEOUL',
  description: '수락까지만 진행합니다.',
});

/** 갤러리가 등록 → Admin 승인까지 (공개 상태로 만들어야 지원이 된다) */
async function createApproved(extra: Record<string, unknown>) {
  const res = await request.post('/api/exhibitions')
    .set('Authorization', `Bearer ${galleryToken}`)
    .send({ ...basePayload(), galleryId, ...extra });
  if (res.status !== 201) return { status: res.status, body: res.body, id: 0 };
  await testPrisma.exhibition.update({ where: { id: res.body.id }, data: { status: 'APPROVED' } });
  return { status: res.status, body: res.body, id: res.body.id as number };
}

async function applyAndAccept(exhibitionId: number) {
  await testPrisma.portfolio.upsert({
    where: { userId: ARTIST }, update: {}, create: { userId: ARTIST, biography: 'b' },
  });
  const applied = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
    .set('Authorization', `Bearer ${artistToken}`)
    .send({
      biography: '약력입니다',
      artworkImages: ['https://example.com/a.jpg'],
      termsAgreed: true,
      termsVersion: 'artist_apply_2026-07-03',
    });
  expect(applied.status).toBe(201);
  const patched = await request.patch(`/api/exhibitions/${exhibitionId}/applications/${applied.body.id}`)
    .set('Authorization', `Bearer ${galleryToken}`)
    .send({ status: 'ACCEPTED' });
  expect(patched.status).toBe(200);
  return applied.body.id as number;
}

beforeAll(() => {
  galleryToken = authToken(GALLERY_OWNER, 'GALLERY');
  adminToken = authToken(ADMIN, 'ADMIN');
  artistToken = authToken(ARTIST, 'ARTIST');
});

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  galleryId = (await testPrisma.gallery.create({
    data: {
      name: '가나갤러리', address: '서울', phone: '02-0000-0000', description: 'd',
      region: 'SEOUL', ownerName: '가나', status: 'APPROVED', ownerId: GALLERY_OWNER,
    },
  })).id;
});

// ───────────────────────────────────────────────────────── 등록
describe('등록 — 자료제출 마감일 요구가 갈린다', () => {
  it('전시까지 진행하면 자료제출 마감일이 **필수**다 (종전 동작 유지)', async () => {
    const res = await request.post('/api/exhibitions')
      .set('Authorization', `Bearer ${galleryToken}`)
      .send({ ...basePayload(), galleryId });   // submissionDeadline 없음
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('자료제출 마감일');
  });

  it('★ 공모만 진행하면 자료제출 마감일 **없이** 등록된다', async () => {
    const res = await createApproved({ recruitOnly: true });
    expect(res.status).toBe(201);
    const saved = await testPrisma.exhibition.findUnique({ where: { id: res.id } });
    expect(saved!.recruitOnly).toBe(true);
    expect(saved!.submissionDeadline).toBeNull();
  });

  it('★ 공모만 진행이면 자료제출 마감일을 보내도 **저장하지 않는다** (없는 기한이 화면에 뜨면 안 된다)', async () => {
    const res = await createApproved({ recruitOnly: true, submissionDeadline: future(30) });
    expect(res.status).toBe(201);
    const saved = await testPrisma.exhibition.findUnique({ where: { id: res.id } });
    expect(saved!.submissionDeadline).toBeNull();
  });

  it('아무것도 안 보내면 기본값은 전시까지 진행이다 (기존 공모와 같은 동작)', async () => {
    const res = await createApproved({ submissionDeadline: future(30) });
    expect(res.status).toBe(201);
    const saved = await testPrisma.exhibition.findUnique({ where: { id: res.id } });
    expect(saved!.recruitOnly).toBe(false);
    expect(saved!.submissionDeadline).not.toBeNull();
  });

  it('아트링크 주최 공모도 공모만 진행할 수 있다', async () => {
    const res = await request.post('/api/exhibitions/hosted')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...basePayload(), galleryIds: [], recruitOnly: true });
    expect(res.status).toBe(201);
    const saved = await testPrisma.exhibition.findUnique({ where: { id: res.body.id } });
    expect(saved!.recruitOnly).toBe(true);
    expect(saved!.galleryId).toBeNull();
  });
});

// ───────────────────────────────────────────────────────── 되는 것
describe('★ 수락까지는 그대로 된다 — 막는 건 그 뒤뿐이다', () => {
  let exId: number;
  beforeEach(async () => { exId = (await createApproved({ recruitOnly: true })).id; });

  it('지원하고 수락받을 수 있다', async () => {
    await applyAndAccept(exId);
    const app = await testPrisma.application.findFirst({ where: { exhibitionId: exId } });
    expect(app!.status).toBe('ACCEPTED');
  });

  it('모집마감은 걸 수 있다 (없는 건 확정·전시종료뿐)', async () => {
    const res = await request.patch(`/api/operations/${exId}/lifecycle`)
      .set('Authorization', `Bearer ${galleryToken}`).send({ recruitmentClosed: true });
    expect(res.status).toBe(200);
    expect(res.body.recruitmentClosed).toBe(true);
  });

  it('운영 공지는 쓸 수 있다 (수락 작가에게 안내할 일이 있다)', async () => {
    const res = await request.post(`/api/operations/${exId}/notices`)
      .set('Authorization', `Bearer ${galleryToken}`).send({ title: '안내', content: '수락 결과 안내드립니다.' });
    expect(res.status).toBe(201);
  });

  it('운영 페이지 접근 정보에 recruitOnly 가 내려온다 (화면이 뒷 단계를 감추는 근거)', async () => {
    const res = await request.get(`/api/operations/${exId}/access`)
      .set('Authorization', `Bearer ${galleryToken}`);
    expect(res.status).toBe(200);
    expect(res.body.recruitOnly).toBe(true);
  });
});

// ───────────────────────────────────────────────────────── 막는 것
describe('★ 뒷 단계는 서버가 막는다 — 화면에서 감추는 것만으로는 부족하다', () => {
  let exId: number;
  beforeEach(async () => {
    exId = (await createApproved({ recruitOnly: true })).id;
    await applyAndAccept(exId);
  });

  const blocked: [string, 'get' | 'put' | 'post' | 'patch', string, 'gallery' | 'artist', any?][] = [
    ['작가 제출자료 조회', 'get', '/me', 'artist'],
    ['작가 제출자료 저장', 'put', '/me', 'artist', { artworkList: [] }],
    ['제출 현황 목록', 'get', '/submissions', 'gallery'],
    ['제출 재촉', 'post', '/submission-reminders', 'gallery', {}],
    ['캡션 HWP', 'get', '/caption.hwp', 'gallery'],
    ['정산 조회', 'get', '/settlement', 'gallery'],
    ['정산 저장', 'put', '/settlement', 'gallery', { sales: [] }],
    ['정산 확인 요청', 'post', '/settlement/request', 'gallery', {}],
    ['정산 완료', 'post', '/settlement/complete', 'gallery', {}],
    ['작가 정산 조회', 'get', '/my-settlement', 'artist'],
  ];

  for (const [label, method, path, who, body] of blocked) {
    it(`${label} → 400`, async () => {
      const token = who === 'gallery' ? galleryToken : artistToken;
      const req = (request as any)[method](`/api/operations/${exId}${path}`).set('Authorization', `Bearer ${token}`);
      const res = await (body === undefined ? req : req.send(body));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('공모만 진행');
    });
  }

  it('전시 확정 → 400', async () => {
    const res = await request.patch(`/api/operations/${exId}/lifecycle`)
      .set('Authorization', `Bearer ${galleryToken}`).send({ recruitmentClosed: true, confirmed: true });
    expect(res.status).toBe(400);
  });

  it('전시 종료 → 400', async () => {
    const res = await request.patch(`/api/operations/${exId}/lifecycle`)
      .set('Authorization', `Bearer ${galleryToken}`).send({ ended: true });
    expect(res.status).toBe(400);
  });

  it('자료제출 마감일 채워넣기 → 400 (없는 단계의 기한을 만들 수 없다)', async () => {
    const res = await request.patch(`/api/exhibitions/${exId}/submission-deadline`)
      .set('Authorization', `Bearer ${galleryToken}`).send({ submissionDeadline: future(30) });
    expect(res.status).toBe(400);
  });

  it('Admin 도 예외가 아니다 — 단계 자체가 없는 것이지 권한 문제가 아니다', async () => {
    const res = await request.get(`/api/operations/${exId}/settlement`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────── 회귀
describe('전시까지 진행하는 공모는 아무것도 안 바뀐다', () => {
  let exId: number;
  beforeEach(async () => {
    exId = (await createApproved({ submissionDeadline: future(30) })).id;
    await applyAndAccept(exId);
  });

  it('제출 현황·정산 라우트가 그대로 열린다', async () => {
    const subs = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${galleryToken}`);
    expect(subs.status).toBe(200);
    const stl = await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${galleryToken}`);
    expect(stl.status).toBe(200);
  });

  it('모집마감 → 확정까지 종전 순서대로 된다', async () => {
    const res = await request.patch(`/api/operations/${exId}/lifecycle`)
      .set('Authorization', `Bearer ${galleryToken}`).send({ recruitmentClosed: true, confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
  });
});
