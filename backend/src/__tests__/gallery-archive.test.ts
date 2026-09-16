/**
 * 갤러리 홈페이지 주소(`/@handle`) · 지난 활동 기록 — `routes/gallery.ts` + `routes/handle.ts` (2026-09-16)
 *
 * 지켜야 하는 것:
 *  ① **핸들은 작가와 한 이름공간을 쓴다** — `/@x` 하나가 작가일 수도 갤러리일 수도 있으므로
 *     한쪽이 쓰면 다른 쪽은 못 쓴다. 안 그러면 주소가 누구를 가리키는지 정해지지 않는다.
 *  ② 갤러리 상세는 숫자 id 와 `@handle` 둘 다로 열린다(옛 링크가 죽지 않게).
 *  ③ 기록 CUD 는 **그 갤러리 주인 또는 Admin 만**. 남의 기록은 404(403 은 존재를 알려준다 — 규칙 23).
 *  ④ 사진은 **우리 저장소 주소만** 받는다(외부 URL 주입 방지).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

const owner = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');
const artist = authToken(1, 'ARTIST');

let galleryId: number;

describe('갤러리 홈페이지 주소 · 지난 활동 기록', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    galleryId = (await seedGallery(3)).id;
  });

  describe('홈페이지 주소 (/@handle)', () => {
    it('주인이 정하면 숫자 id 와 @handle 둘 다로 열린다', async () => {
      const put = await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'gallery.m' });
      expect(put.status).toBe(200);
      expect(put.body.handle).toBe('gallery.m');

      expect((await request.get(`/api/galleries/${galleryId}`)).status).toBe(200);
      const byHandle = await request.get('/api/galleries/@gallery.m');
      expect(byHandle.status).toBe(200);
      expect(byHandle.body.id).toBe(galleryId);
    });

    it('★ 작가가 쓰는 주소는 갤러리가 못 가져간다 (한 이름공간)', async () => {
      await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'kiiryang' } });
      const r = await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'kiiryang' });
      expect(r.status).toBe(409);
      const check = await request.get(`/api/galleries/${galleryId}/handle-check?handle=kiiryang`).set('Authorization', `Bearer ${owner}`);
      expect(check.body.available).toBe(false);
    });

    it('★ 갤러리가 쓰는 주소는 작가가 못 가져간다 (반대 방향)', async () => {
      await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'gallery.m' });
      const r = await request.put('/api/auth/me/handle').set('Authorization', `Bearer ${artist}`).send({ handle: 'gallery.m' });
      expect(r.status).toBe(409);
    });

    it('내 주소를 그대로 다시 저장해도 중복이 아니다', async () => {
      await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'gallery.m' });
      expect((await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'gallery.m' })).status).toBe(200);
    });

    it('규칙에 안 맞으면 400, 남의 갤러리면 403', async () => {
      expect((await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'AB' })).status).toBe(400);
      expect((await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${artist}`).send({ handle: 'x-gallery' })).status).toBe(403);
    });

    it('★ /api/handles/:handle 이 작가인지 갤러리인지 알려준다 (없으면 404)', async () => {
      await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'kiiryang' } });
      await request.put(`/api/galleries/${galleryId}/handle`).set('Authorization', `Bearer ${owner}`).send({ handle: 'gallery.m' });

      expect((await request.get('/api/handles/kiiryang')).body).toEqual({ kind: 'artist', id: 1 });
      expect((await request.get('/api/handles/gallery.m')).body).toEqual({ kind: 'gallery', id: galleryId });
      expect((await request.get('/api/handles/nobody.here')).status).toBe(404);
    });
  });

  describe('지난 활동 기록', () => {
    const body = { title: '2025 대구아트페어', venue: '대구 엑스코', period: '2025.11.6 – 11.9', date: '2025-11-06', artists: '박기량, 마은영', body: '부스 하나로 참여했다.' };

    it('주인이 만들고 고치고 지운다 — 갤러리 상세에 날짜 내림차순으로 실린다', async () => {
      const a = await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send(body);
      expect(a.status).toBe(201);
      await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send({ title: '옛 전시', date: '2023-01-01' });

      const detail = await request.get(`/api/galleries/${galleryId}`);
      expect(detail.body.archives.map((x: any) => x.title)).toEqual(['2025 대구아트페어', '옛 전시']);
      expect(detail.body.archives[0].artists).toBe('박기량, 마은영');

      const patched = await request.patch(`/api/galleries/${galleryId}/archives/${a.body.id}`).set('Authorization', `Bearer ${owner}`).send({ ...body, title: '고침' });
      expect(patched.body.title).toBe('고침');

      expect((await request.delete(`/api/galleries/${galleryId}/archives/${a.body.id}`).set('Authorization', `Bearer ${owner}`)).status).toBe(200);
      expect((await request.get(`/api/galleries/${galleryId}`)).body.archives.map((x: any) => x.title)).toEqual(['옛 전시']);
    });

    it('제목만 있어도 된다 — 나머지는 전부 선택', async () => {
      const r = await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send({ title: '이름만 기억나는 전시' });
      expect(r.status).toBe(201);
      expect(r.body.date).toBeNull();
      expect(r.body.venue).toBeNull();
      expect(r.body.images).toEqual([]);
    });

    it('제목이 비면 400', async () => {
      expect((await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send({ title: '  ' })).status).toBe(400);
    });

    it('Admin 도 만들 수 있고, 남은 403', async () => {
      expect((await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${admin}`).send(body)).status).toBe(201);
      expect((await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${artist}`).send(body)).status).toBe(403);
      expect((await request.post(`/api/galleries/${galleryId}/archives`).send(body)).status).toBe(401);
    });

    it('★ 남의 갤러리 기록은 내 갤러리 id 로도 못 고친다 (IDOR) — 404', async () => {
      const mine = await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send(body);
      const other = await seedGallery(4); // Admin 소유의 다른 갤러리
      const r = await request.patch(`/api/galleries/${other.id}/archives/${mine.body.id}`).set('Authorization', `Bearer ${admin}`).send(body);
      expect(r.status).toBe(404);
      expect((await request.delete(`/api/galleries/${other.id}/archives/${mine.body.id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(404);
    });

    it('★ 사진은 우리 저장소 주소만 — 외부 URL 은 조용히 버린다', async () => {
      const r = await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send({
        ...body,
        images: ['/uploads/ok.jpg', 'https://evil.example.com/x.jpg', 'javascript:alert(1)', '/uploads/ok2.jpg'],
      });
      expect(r.status).toBe(201);
      expect(r.body.images).toEqual(['/uploads/ok.jpg', '/uploads/ok2.jpg']);
    });

    it('사진은 12장까지 — 넘치면 400', async () => {
      const many = Array.from({ length: 13 }, (_, i) => `/uploads/${i}.jpg`);
      expect((await request.post(`/api/galleries/${galleryId}/archives`).set('Authorization', `Bearer ${owner}`).send({ ...body, images: many })).status).toBe(400);
    });
  });
});
