/**
 * 포트폴리오 작품 정보 — 작품별 메타(제목/재료/크기/연도/시리즈/설명/상태)와
 * 작가노트·한 줄 소개·시리즈 설명·포맷 선택 저장.
 *
 * 이 정보들이 빠지면 포맷 PDF에서 캡션이 통째로 사라지므로(레퍼런스 포트폴리오는 전부 캡션이 있다)
 * 저장·조회 경로를 확실히 잠가둔다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, testPrisma } from './helpers';

const ARTIST = 1;
const OTHER_ARTIST = 2;

async function myPortfolio(userId = ARTIST) {
  const res = await request.get('/api/portfolio').set('Authorization', `Bearer ${authToken(userId, 'ARTIST')}`);
  return res.body;
}

async function addImage(userId = ARTIST, body: Record<string, unknown> = {}) {
  const res = await request
    .post('/api/portfolio/images')
    .set('Authorization', `Bearer ${authToken(userId, 'ARTIST')}`)
    .send({ url: 'https://example.com/a.jpg', ...body });
  return res;
}

describe('포트폴리오 작품 정보', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    await myPortfolio(ARTIST);       // 포트폴리오 생성 (GET이 없으면 만든다)
    await myPortfolio(OTHER_ARTIST);
  });

  describe('PUT /api/portfolio — 작가노트 · 한 줄 소개 · 시리즈 설명 · 포맷', () => {
    it('작가노트/한 줄 소개/포맷/시리즈 설명을 저장하고 다시 내려준다', async () => {
      const res = await request
        .put('/api/portfolio')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({
          biography: '약력',
          career: { artFair: [], solo: [], group: [], education: [{ year: '', content: '2016 졸업' }] },
          statement: '기억은 흐르고, 감정은 겹쳐진다.',
          tagline: '기억의 층위를 회화로 옮기는 작가',
          themeId: 'studio',
          seriesInfo: [{ name: '산', note: '영속성에 대한 연작' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.statement).toBe('기억은 흐르고, 감정은 겹쳐진다.');
      expect(res.body.tagline).toBe('기억의 층위를 회화로 옮기는 작가');
      expect(res.body.themeId).toBe('studio');
      expect(res.body.seriesInfo).toEqual([{ name: '산', note: '영속성에 대한 연작' }]);
      // career의 확장 항목(학력)도 유실되지 않아야 한다
      expect(res.body.career.education).toEqual([{ year: '', content: '2016 졸업' }]);
    });

    it('알 수 없는 포맷 id는 저장하지 않는다 (null)', async () => {
      const res = await request
        .put('/api/portfolio')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ biography: '약력', career: {}, themeId: 'hacker' });
      expect(res.status).toBe(200);
      expect(res.body.themeId).toBeNull();
    });

    it('형태가 깨진 seriesInfo는 걸러서 저장한다', async () => {
      const res = await request
        .put('/api/portfolio')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ biography: '약력', career: {}, seriesInfo: [{ name: '', note: '이름 없음' }, 'x', { name: '산' }] });
      expect(res.status).toBe(200);
      // 이름 없는 항목과 문자열은 버리고, note 없는 항목은 빈 note로
      expect(res.body.seriesInfo).toEqual([{ name: '산', note: '' }]);
    });
  });

  describe('POST /api/portfolio/images — 등록하면서 작품 정보 함께 저장', () => {
    it('작품 정보를 함께 보내면 그대로 저장된다', async () => {
      const res = await addImage(ARTIST, {
        title: '기억의 화원', medium: 'Acrylic on canvas', sizeText: '45.5×45.5 cm',
        year: '2024', series: '사랑을 잇다', status: 'SOLD',
      });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('기억의 화원');
      expect(res.body.sizeText).toBe('45.5×45.5 cm');
      expect(res.body.series).toBe('사랑을 잇다');
      expect(res.body.status).toBe('SOLD');
    });

    it('정보 없이 등록하면 전부 null', async () => {
      const res = await addImage();
      expect(res.status).toBe(201);
      expect(res.body.title).toBeNull();
      expect(res.body.medium).toBeNull();
    });
  });

  describe('PATCH /api/portfolio/images/:id — 작품 정보 수정', () => {
    it('보낸 필드만 바꾸고 나머지는 유지한다', async () => {
      const created = await addImage(ARTIST, { title: '원래 제목', medium: 'Oil on canvas', year: '2023' });
      const res = await request
        .patch(`/api/portfolio/images/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ title: '바뀐 제목' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('바뀐 제목');
      expect(res.body.medium).toBe('Oil on canvas'); // 안 보낸 필드는 그대로
      expect(res.body.year).toBe('2023');
    });

    it('빈 문자열로 보내면 지워진다(null)', async () => {
      const created = await addImage(ARTIST, { title: '제목', medium: '재료' });
      const res = await request
        .patch(`/api/portfolio/images/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ medium: '   ' });
      expect(res.status).toBe(200);
      expect(res.body.medium).toBeNull();
    });


    it('알 수 없는 status는 null로 정규화한다', async () => {
      const created = await addImage(ARTIST, { status: 'SOLD' });
      const res = await request
        .patch(`/api/portfolio/images/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ status: 'FREE' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBeNull();
    });

    it('남의 작품은 수정할 수 없다 (IDOR 차단)', async () => {
      const created = await addImage(ARTIST, { title: '내 작품' });
      const res = await request
        .patch(`/api/portfolio/images/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken(OTHER_ARTIST, 'ARTIST')}`)
        .send({ title: '가로챈 제목' });
      expect(res.status).toBe(404);

      const after = await testPrisma.portfolioImage.findUnique({ where: { id: created.body.id } });
      expect(after?.title).toBe('내 작품');
    });

    it('바꿀 내용이 하나도 없으면 400', async () => {
      const created = await addImage();
      const res = await request
        .patch(`/api/portfolio/images/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/portfolio/images/order — 순서 저장', () => {
    it('보낸 순서대로 order를 0,1,2…로 다시 매긴다', async () => {
      const a = await addImage(ARTIST, { title: 'A' });
      const b = await addImage(ARTIST, { title: 'B' });
      const c = await addImage(ARTIST, { title: 'C' });

      const res = await request
        .put('/api/portfolio/images/order')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ ids: [c.body.id, a.body.id, b.body.id] });
      expect(res.status).toBe(200);

      const list = await testPrisma.portfolioImage.findMany({ orderBy: { order: 'asc' }, select: { title: true } });
      expect(list.map((i) => i.title)).toEqual(['C', 'A', 'B']);
    });

    it('남의 이미지 id가 섞이면 전체를 거절한다 (일부만 반영되는 상태 금지)', async () => {
      const mine = await addImage(ARTIST, { title: '내 것' });
      const theirs = await addImage(OTHER_ARTIST, { title: '남의 것' });

      const res = await request
        .put('/api/portfolio/images/order')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ ids: [theirs.body.id, mine.body.id] });
      expect(res.status).toBe(404);

      const after = await testPrisma.portfolioImage.findUnique({ where: { id: mine.body.id } });
      expect(after?.order).toBe(0); // 그대로
    });

    it('ids가 배열이 아니면 400', async () => {
      const res = await request
        .put('/api/portfolio/images/order')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({ ids: 'nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/portfolio/:userId — 공개 조회', () => {
    it('작품 정보와 작가노트·시리즈 설명을 공개로 내려준다', async () => {
      await request
        .put('/api/portfolio')
        .set('Authorization', `Bearer ${authToken(ARTIST, 'ARTIST')}`)
        .send({
          biography: '약력', career: {}, statement: '작가노트', tagline: '한 줄',
          seriesInfo: [{ name: '산', note: '설명' }],
        });
      await addImage(ARTIST, { title: '작품', series: '산', sizeText: '50×50 cm' });

      const res = await request.get(`/api/portfolio/${ARTIST}`);
      expect(res.status).toBe(200);
      expect(res.body.statement).toBe('작가노트');
      expect(res.body.tagline).toBe('한 줄');
      expect(res.body.seriesInfo).toEqual([{ name: '산', note: '설명' }]);
      expect(res.body.images[0].title).toBe('작품');
      expect(res.body.images[0].sizeText).toBe('50×50 cm');
    });

    it('포트폴리오가 없는 작가는 빈 값으로 내려준다', async () => {
      await testPrisma.portfolioImage.deleteMany();
      await testPrisma.portfolio.deleteMany();
      const res = await request.get(`/api/portfolio/${ARTIST}`);
      expect(res.status).toBe(200);
      expect(res.body.statement).toBeNull();
      expect(res.body.seriesInfo).toEqual([]);
      expect(res.body.images).toEqual([]);
    });
  });
});
