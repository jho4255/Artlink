/**
 * 목록 키워드 검색(q) 테스트 — 갤러리/전시(show)/모집공고(exhibition)
 *
 * GET /api/galleries?q=     (이름·주소·소개)
 * GET /api/shows?q=         (제목·장소·작가)
 * GET /api/exhibitions?q=   (제목·소개)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, cleanDb, seedUsers } from './helpers';

async function makeGallery(name: string, address: string, description: string) {
  return testPrisma.gallery.create({
    data: { name, address, description, region: 'SEOUL', phone: '02-0000-0000', ownerName: '대표', status: 'APPROVED', ownerId: 3 },
  });
}

describe('목록 키워드 검색 (q)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  describe('갤러리', () => {
    beforeEach(async () => {
      await makeGallery('모던 갤러리', '서울시 종로구 1', '현대미술 전문');
      await makeGallery('부산 바다 갤러리', '부산시 해운대구 2', '조각 전문');
    });

    it('이름 부분일치', async () => {
      const res = await request.get('/api/galleries?q=모던');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('모던 갤러리');
    });

    it('주소 부분일치', async () => {
      const res = await request.get('/api/galleries?q=해운대');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('부산 바다 갤러리');
    });

    it('소개 부분일치', async () => {
      const res = await request.get('/api/galleries?q=조각');
      expect(res.body).toHaveLength(1);
    });

    it('검색어 없으면 전체', async () => {
      const res = await request.get('/api/galleries');
      expect(res.body.length).toBe(2);
    });

    it('일치 없으면 빈 배열', async () => {
      const res = await request.get('/api/galleries?q=없는키워드XYZ');
      expect(res.body).toHaveLength(0);
    });
  });

  describe('전시(show)', () => {
    let galleryId: number;
    beforeEach(async () => {
      const g = await makeGallery('갤러리A', '서울', '소개');
      galleryId = g.id;
      const base = { description: 'desc', startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 30 * 86400000), openingHours: '10:00-18:00', admissionFee: '무료', region: 'SEOUL', status: 'APPROVED', galleryId };
      await testPrisma.show.create({ data: { ...base, title: '봄의 정원', location: '제1전시실', posterImage: 'x', artists: JSON.stringify(['김작가', '이작가']) } });
      await testPrisma.show.create({ data: { ...base, title: '겨울 풍경', location: '제2전시실', posterImage: 'x', artists: JSON.stringify(['박작가']) } });
    });

    it('제목 검색', async () => {
      const res = await request.get('/api/shows?q=봄');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('봄의 정원');
    });

    it('작가 검색', async () => {
      const res = await request.get('/api/shows?q=김작가');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('봄의 정원');
    });

    it('장소 검색', async () => {
      const res = await request.get('/api/shows?q=제2전시실');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('겨울 풍경');
    });
  });

  describe('모집공고(exhibition)', () => {
    let galleryId: number;
    beforeEach(async () => {
      const g = await makeGallery('갤러리B', '서울', '소개');
      galleryId = g.id;
      const base = { type: 'SOLO', deadline: new Date(Date.now() + 30 * 86400000), exhibitDate: new Date(Date.now() + 60 * 86400000), capacity: 5, region: 'SEOUL', status: 'APPROVED', galleryId };
      await testPrisma.exhibition.create({ data: { ...base, title: '신진작가 공모', description: '회화 모집' } });
      await testPrisma.exhibition.create({ data: { ...base, title: '조각 페어', description: '입체 작업' } });
    });

    it('제목 검색', async () => {
      const res = await request.get('/api/exhibitions?q=신진');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('신진작가 공모');
    });

    it('소개 검색', async () => {
      const res = await request.get('/api/exhibitions?q=입체');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('조각 페어');
    });

    it('검색어 없으면 전체(마감 전)', async () => {
      const res = await request.get('/api/exhibitions');
      expect(res.body.length).toBe(2);
    });
  });
});
