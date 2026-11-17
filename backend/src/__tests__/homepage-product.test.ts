/**
 * 작가·갤러리 홈페이지 개편 (2026-11-14, CLAUDE.md 규칙 82) — 서버 쪽.
 *  · [소식] 탭을 그릴지: 홈페이지 응답의 storyCount/highlightCount 가 `/stories/user/:id` 와 **같은 규칙**
 *  · 작가 첫 화면 '전시 중' 띠(nowShowing) · 갤러리 '지금 전시'(nowShow) · 관람 시간(openHours)
 *  · 홈페이지 비회원 문의(HomepageInquiry) — 켜야 받는다 · 한도 세 겹 · 알림 · 받은 사람만 보고 지운다 · 1년 뒤 · 탈퇴하면 함께
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, seedGallery, testPrisma } from './helpers';
import { __resetInquiryThrottle, pruneHomepageInquiries, INQUIRY_PER_IP_HOUR, INQUIRY_PER_OWNER_DAY, isContactLike, countLinks } from '../lib/homepageInquiry';

const ARTIST = 1;
const OTHER = 2;
const GALLERY_OWNER = 3;
const ADMIN = 4;
const DAY = 24 * 60 * 60 * 1000;
const bearer = (id: number, role: string) => ({ Authorization: `Bearer ${authToken(id, role)}` });

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  __resetInquiryThrottle();
});

async function story(authorId: number, data: Record<string, unknown> = {}) {
  return testPrisma.story.create({ data: { authorId, caption: '소식', images: [], ...data } });
}

describe('[소식] 탭 — 홈페이지 응답의 storyCount 는 /stories/user/:id 와 같은 규칙', () => {
  it('비회원은 전체공개만 · 이웃은 이웃 공개까지 · 내린 소식은 본인만', async () => {
    await story(ARTIST);
    await story(ARTIST, { visibility: 'NEIGHBORS' });
    await story(ARTIST, { hiddenAt: new Date(), hiddenReason: 'ADMIN' });
    await testPrisma.portfolio.create({ data: { userId: ARTIST } });

    const guest = await request.get(`/api/portfolio/${ARTIST}`);
    expect(guest.status).toBe(200);
    expect(guest.body.storyCount).toBe(1);
    const guestList = await request.get(`/api/stories/user/${ARTIST}`);
    expect(guestList.body.stories).toHaveLength(1);

    await testPrisma.follow.create({ data: { followerId: OTHER, followingId: ARTIST } });
    const neighbor = await request.get(`/api/portfolio/${ARTIST}`).set(bearer(OTHER, 'ARTIST'));
    expect(neighbor.body.storyCount).toBe(2);
    const neighborList = await request.get(`/api/stories/user/${ARTIST}`).set(bearer(OTHER, 'ARTIST'));
    expect(neighborList.body.stories).toHaveLength(2);

    const self = await request.get(`/api/portfolio/${ARTIST}`).set(bearer(ARTIST, 'ARTIST'));
    expect(self.body.storyCount).toBe(3);
  });

  it('하이라이트는 소식이 하나라도 남은 공개 것만 센다 · 비공개는 본인만', async () => {
    const s = await story(ARTIST);
    await testPrisma.portfolio.create({ data: { userId: ARTIST } });
    await testPrisma.storyHighlight.create({ data: { userId: ARTIST, name: '전시', storyIds: [s.id] } });
    await testPrisma.storyHighlight.create({ data: { userId: ARTIST, name: '빈 것', storyIds: [99999] } });
    await testPrisma.storyHighlight.create({ data: { userId: ARTIST, name: '나만', storyIds: [s.id], isPublic: false } });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.highlightCount).toBe(1);
    expect((await request.get(`/api/portfolio/${ARTIST}`).set(bearer(ARTIST, 'ARTIST'))).body.highlightCount).toBe(2);
  });

  it('갤러리 응답도 주인 계정의 소식으로 센다', async () => {
    const g = await seedGallery(GALLERY_OWNER);
    await story(GALLERY_OWNER);
    await story(GALLERY_OWNER, { visibility: 'NEIGHBORS' });
    const r = await request.get(`/api/galleries/${g.id}`);
    expect(r.status).toBe(200);
    expect(r.body.storyCount).toBe(1);
    expect(r.body.highlightCount).toBe(0);
  });
});

async function acceptedExhibition(opts: { start: number; end: number; recruitOnly?: boolean; ended?: boolean; hide?: boolean; noGallery?: boolean; status?: string }) {
  const g = opts.noGallery ? null : await seedGallery(GALLERY_OWNER);
  if (g && opts.hide) await testPrisma.gallery.update({ where: { id: g.id }, data: { hiddenArtistIds: [ARTIST] } });
  const ex = await testPrisma.exhibition.create({
    data: {
      title: '빛의 결', type: 'SOLO', capacity: 5, region: 'SEOUL', description: '소개',
      status: opts.status ?? 'APPROVED', hostType: opts.noGallery ? 'ADMIN' : 'GALLERY', galleryId: g?.id ?? null,
      deadline: new Date(Date.now() - 20 * DAY),
      exhibitStartDate: new Date(Date.now() + opts.start * DAY),
      exhibitDate: new Date(Date.now() + opts.end * DAY),
      recruitOnly: !!opts.recruitOnly, ended: !!opts.ended,
    },
  });
  await testPrisma.application.create({ data: { userId: ARTIST, exhibitionId: ex.id, status: 'ACCEPTED' } as any });
  return { ex, g };
}

describe("작가 첫 화면 '전시 중' 띠 — nowShowing", () => {
  beforeEach(async () => { await testPrisma.portfolio.create({ data: { userId: ARTIST } }); });

  it('선정된 공모가 오늘 전시 기간이면 ongoing(갤러리 이름·주소와 함께)', async () => {
    const { ex, g } = await acceptedExhibition({ start: -3, end: 10 });
    const r = await request.get(`/api/portfolio/${ARTIST}`);
    expect(r.body.nowShowing).toMatchObject({ state: 'ongoing', exhibitionId: ex.id, title: '빛의 결', gallery: { id: g!.id, name: 'Test Gallery' } });
  });

  it('30일 안에 시작하면 upcoming · 그보다 뒤면 없다', async () => {
    await acceptedExhibition({ start: 10, end: 20 });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing?.state).toBe('upcoming');
    await testPrisma.exhibition.updateMany({ data: { exhibitStartDate: new Date(Date.now() + 40 * DAY), exhibitDate: new Date(Date.now() + 50 * DAY) } });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toBeNull();
  });

  it('공모만 진행·끝난 전시·승인 전·갤러리가 숨긴 작가면 없다 · 갤러리 없는 아트링크 공모는 gallery:null', async () => {
    await acceptedExhibition({ start: -1, end: 5, recruitOnly: true });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toBeNull();
    await testPrisma.application.deleteMany(); await testPrisma.exhibition.deleteMany(); await testPrisma.gallery.deleteMany();
    await acceptedExhibition({ start: -1, end: 5, ended: true });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toBeNull();
    await testPrisma.application.deleteMany(); await testPrisma.exhibition.deleteMany(); await testPrisma.gallery.deleteMany();
    await acceptedExhibition({ start: -1, end: 5, status: 'PENDING' });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toBeNull();
    await testPrisma.application.deleteMany(); await testPrisma.exhibition.deleteMany(); await testPrisma.gallery.deleteMany();
    await acceptedExhibition({ start: -1, end: 5, hide: true });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toBeNull();
    await testPrisma.application.deleteMany(); await testPrisma.exhibition.deleteMany(); await testPrisma.gallery.deleteMany();
    await acceptedExhibition({ start: -1, end: 5, noGallery: true });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toMatchObject({ state: 'ongoing', gallery: null });
  });

  it('작가가 [꾸미기]에서 끄면 공개 응답엔 없고, 본인 조회(편집 미리보기)엔 그대로 있다', async () => {
    await acceptedExhibition({ start: -3, end: 10 });
    await testPrisma.portfolio.update({ where: { userId: ARTIST }, data: { designConfig: JSON.stringify({ showNow: false }) } });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.nowShowing).toBeNull();
    const own = await request.get('/api/portfolio').set(bearer(ARTIST, 'ARTIST'));
    expect(own.body.nowShowing?.state).toBe('ongoing');
  });
});

describe("갤러리 '지금 전시' · 관람 시간", () => {
  const show = (galleryId: number, start: number, end: number, status = 'APPROVED') => testPrisma.show.create({
    data: {
      title: `전시 ${start}`, description: '소개', openingHours: '10-18', admissionFee: '무료', location: '서울', region: 'SEOUL',
      posterImage: '/uploads/poster.jpg', status, galleryId,
      startDate: new Date(Date.now() + start * DAY), endDate: new Date(Date.now() + end * DAY),
    },
  });

  it('진행 중이면 곧 끝나는 것 · 없으면 60일 안에 시작하는 것 · 승인 전은 없다', async () => {
    const g = await seedGallery(GALLERY_OWNER);
    await show(g.id, -1, 3, 'PENDING');
    expect((await request.get(`/api/galleries/${g.id}`)).body.nowShow).toBeNull();
    const up = await show(g.id, 20, 40);
    expect((await request.get(`/api/galleries/${g.id}`)).body.nowShow).toMatchObject({ state: 'upcoming', id: up.id });
    await show(g.id, -10, 30);
    const soon = await show(g.id, -2, 5);
    expect((await request.get(`/api/galleries/${g.id}`)).body.nowShow).toMatchObject({ state: 'ongoing', id: soon.id, posterImage: '/uploads/poster.jpg' });
  });

  it('관람 시간 — 주인이 고친다 · 공백 정리 · 80자 넘으면 400 · 비우면 지운다', async () => {
    const g = await seedGallery(GALLERY_OWNER);
    const patch = (body: Record<string, unknown>, who = GALLERY_OWNER) =>
      request.patch(`/api/galleries/${g.id}/detail`).set(bearer(who, who === GALLERY_OWNER ? 'GALLERY' : 'ARTIST')).send(body);
    expect((await patch({ openHours: '  화–일   11:00–18:00 · 월 휴관 ' })).status).toBe(200);
    expect((await request.get(`/api/galleries/${g.id}`)).body.openHours).toBe('화–일 11:00–18:00 · 월 휴관');
    expect((await patch({ openHours: 'x'.repeat(81) })).status).toBe(400);
    expect((await patch({ openHours: 3 })).status).toBe(400);
    expect((await patch({ openHours: '' })).status).toBe(200);
    expect((await request.get(`/api/galleries/${g.id}`)).body.openHours).toBeNull();
    expect((await patch({ openHours: '남의 것' }, ARTIST)).status).toBe(403);
  });
});

describe('홈페이지 비회원 문의', () => {
  const send = (body: Record<string, unknown>, ip = '203.0.113.1') =>
    request.post('/api/homepage-inquiries').set('CF-Connecting-IP', ip)
      .send({ artistId: ARTIST, name: '김관람', contact: 'visitor@example.com', message: '구매 문의드립니다.', agree: true, ...body });
  const enableArtist = () => testPrisma.portfolio.upsert({ where: { userId: ARTIST }, update: { guestInquiry: true }, create: { userId: ARTIST, guestInquiry: true } });

  it('★ 기본은 꺼짐 — 받기를 안 켠 작가에게는 403 · 공개 응답 guestInquiry:false', async () => {
    await testPrisma.portfolio.create({ data: { userId: ARTIST } });
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.guestInquiry).toBe(false);
    const r = await send({});
    expect(r.status).toBe(403);
    expect(await testPrisma.homepageInquiry.count()).toBe(0);
  });

  it('켜면 저장되고 받은 사람에게 알림 하나(이름·작품 이름까지만, 연락처·내용은 싣지 않는다)', async () => {
    await enableArtist();
    const p = await testPrisma.portfolio.findUniqueOrThrow({ where: { userId: ARTIST } });
    const img = await testPrisma.portfolioImage.create({ data: { portfolioId: p.id, url: '/uploads/w.jpg', title: '조용한 오후', order: 0 } });
    const r = await send({ imageId: img.id });
    expect(r.status).toBe(201);
    const row = await testPrisma.homepageInquiry.findFirstOrThrow();
    expect(row).toMatchObject({ ownerId: ARTIST, imageId: img.id, workTitle: '조용한 오후', name: '김관람', galleryId: null });
    const notes = await testPrisma.notification.findMany({ where: { userId: ARTIST } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'HOMEPAGE_INQUIRY', linkUrl: `/mypage?tab=received-inquiries&inquiry=${row.id}` });
    expect(notes[0]!.message).toContain('김관람');
    expect(notes[0]!.message).toContain('조용한 오후');
    expect(notes[0]!.message).not.toContain('visitor@example.com');
    expect(notes[0]!.message).not.toContain('구매 문의');
  });

  it('남의 작품 id 는 조용히 뺀다', async () => {
    await enableArtist();
    const other = await testPrisma.portfolio.create({ data: { userId: OTHER } });
    const img = await testPrisma.portfolioImage.create({ data: { portfolioId: other.id, url: '/uploads/o.jpg', title: '남의 작품', order: 0 } });
    expect((await send({ imageId: img.id })).status).toBe(201);
    expect(await testPrisma.homepageInquiry.findFirstOrThrow()).toMatchObject({ imageId: null, workTitle: null });
  });

  it('동의·연락처·링크 — 틀리면 400 · 숨은 칸을 채운 봇은 201 이지만 저장하지 않는다', async () => {
    await enableArtist();
    expect((await send({ agree: false })).status).toBe(400);
    expect((await send({ agree: undefined })).status).toBe(400);
    expect((await send({ contact: '그냥 글자' })).status).toBe(400);
    expect((await send({ contact: '1234' })).status).toBe(400);
    expect((await send({ message: 'http://a.kr http://b.kr http://c.kr www.d.kr' })).status).toBe(400);
    expect((await send({ name: '' })).status).toBe(400);
    expect((await send({ website: 'http://spam.example' })).status).toBe(201);
    expect(await testPrisma.homepageInquiry.count()).toBe(0);
    expect((await send({ contact: '010-1234-5678' })).status).toBe(201);
    expect(isContactLike('+82 10 1234 5678')).toBe(true);
    expect(isContactLike('me@x')).toBe(false);
    expect(countLinks('https://a http://b www.c')).toBe(3);
  });

  it(`접속 주소당 1시간 ${INQUIRY_PER_IP_HOUR}건 — 동시에 보내도 넘지 않는다`, async () => {
    await enableArtist();
    const rs = await Promise.all(Array.from({ length: INQUIRY_PER_IP_HOUR + 4 }, () => send({}, '198.51.100.7')));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(INQUIRY_PER_IP_HOUR);
    expect(rs.filter((r) => r.status === 429).length).toBe(4);
    expect((await send({}, '198.51.100.8')).status).toBe(201);   // 다른 주소는 그대로
  });

  it(`받는 사람당 하루 ${INQUIRY_PER_OWNER_DAY}건 — 주소를 바꿔 동시에 보내도 넘지 않는다`, async () => {
    await enableArtist();
    await testPrisma.homepageInquiry.createMany({
      data: Array.from({ length: INQUIRY_PER_OWNER_DAY - 3 }, (_, i) => ({ ownerId: ARTIST, name: `n${i}`, contact: 'a@b.cd', message: 'm' })),
    });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => send({}, `192.0.2.${i + 10}`)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await testPrisma.homepageInquiry.count({ where: { ownerId: ARTIST } })).toBe(INQUIRY_PER_OWNER_DAY);
  });

  it('갤러리 — 승인된 갤러리가 켰을 때만, 주인에게 · galleryId 와 함께', async () => {
    const g = await seedGallery(GALLERY_OWNER);
    const sendG = () => request.post('/api/homepage-inquiries').send({ galleryId: g.id, name: '방문자', contact: '02-123-45678', message: '관람 문의', agree: true });
    expect((await sendG()).status).toBe(403);
    expect((await request.patch(`/api/galleries/${g.id}/detail`).set(bearer(GALLERY_OWNER, 'GALLERY')).send({ guestInquiry: 'yes' })).status).toBe(400);
    expect((await request.patch(`/api/galleries/${g.id}/detail`).set(bearer(GALLERY_OWNER, 'GALLERY')).send({ guestInquiry: true })).status).toBe(200);
    expect((await request.get(`/api/galleries/${g.id}`)).body.guestInquiry).toBe(true);
    expect((await sendG()).status).toBe(201);
    expect(await testPrisma.homepageInquiry.findFirstOrThrow()).toMatchObject({ ownerId: GALLERY_OWNER, galleryId: g.id });
    await testPrisma.gallery.update({ where: { id: g.id }, data: { status: 'PENDING' } });
    expect((await sendG()).status).toBe(404);
    expect((await request.post('/api/homepage-inquiries').send({ name: 'a', contact: 'a@b.cd', message: 'm', agree: true })).status).toBe(404);
  });

  it('받은 문의 — 본인 것만 · 읽으면 알림도 읽음 · 남의 것은 404 · 지우면 알림도 함께', async () => {
    await enableArtist();
    await send({});
    const row = await testPrisma.homepageInquiry.findFirstOrThrow();
    const mine = await request.get('/api/homepage-inquiries/mine').set(bearer(ARTIST, 'ARTIST'));
    expect(mine.status).toBe(200);
    expect(mine.body.unread).toBe(1);
    expect(mine.body.items[0]).toMatchObject({ id: row.id, name: '김관람', contact: 'visitor@example.com', readAt: null });
    expect((await request.get('/api/homepage-inquiries/mine').set(bearer(OTHER, 'ARTIST'))).body.items).toHaveLength(0);
    expect((await request.patch(`/api/homepage-inquiries/${row.id}/read`).set(bearer(OTHER, 'ARTIST'))).status).toBe(404);
    expect((await request.delete(`/api/homepage-inquiries/${row.id}`).set(bearer(ADMIN, 'ADMIN'))).status).toBe(404);
    expect((await request.patch(`/api/homepage-inquiries/${row.id}/read`).set(bearer(ARTIST, 'ARTIST'))).status).toBe(200);
    expect((await request.patch(`/api/homepage-inquiries/${row.id}/read`).set(bearer(ARTIST, 'ARTIST'))).status).toBe(200);
    expect((await testPrisma.notification.findFirstOrThrow({ where: { userId: ARTIST } })).read).toBe(true);
    expect((await request.get('/api/homepage-inquiries/mine').set(bearer(ARTIST, 'ARTIST'))).body.unread).toBe(0);
    expect((await request.delete(`/api/homepage-inquiries/${row.id}`).set(bearer(ARTIST, 'ARTIST'))).status).toBe(200);
    expect(await testPrisma.homepageInquiry.count()).toBe(0);
    expect(await testPrisma.notification.count({ where: { userId: ARTIST } })).toBe(0);
    expect((await request.get('/api/homepage-inquiries/mine')).status).toBe(401);
  });

  it('1년 지난 문의는 지운다 · 받은 사람이 탈퇴하면 함께 지운다', async () => {
    await testPrisma.homepageInquiry.create({ data: { ownerId: ARTIST, name: 'old', contact: 'a@b.cd', message: 'm', createdAt: new Date(Date.now() - 400 * DAY) } });
    await testPrisma.homepageInquiry.create({ data: { ownerId: ARTIST, name: 'new', contact: 'a@b.cd', message: 'm' } });
    expect(await pruneHomepageInquiries(Date.now(), true)).toBe(1);
    expect((await testPrisma.homepageInquiry.findMany()).map((r) => r.name)).toEqual(['new']);
    const w = await request.delete('/api/auth/me').set(bearer(ARTIST, 'ARTIST')).send({ confirmText: '탈퇴' });
    expect(w.status).toBe(200);
    expect(await testPrisma.homepageInquiry.count()).toBe(0);
  });

  it('PUT /portfolio 의 guestInquiry 는 보냈을 때만 바뀐다 · 형식이 틀리면 400', async () => {
    const save = (body: Record<string, unknown>) => request.put('/api/portfolio').set(bearer(ARTIST, 'ARTIST')).send({ biography: '', career: null, ...body });
    expect((await save({ guestInquiry: true })).body.guestInquiry).toBe(true);
    expect((await save({ tagline: '한 줄' })).body.guestInquiry).toBe(true);
    expect((await save({ guestInquiry: 'on' })).status).toBe(400);
    expect((await request.get(`/api/portfolio/${ARTIST}`)).body.guestInquiry).toBe(true);
  });
});
