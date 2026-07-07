import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';

/**
 * known-issues.md 일괄 수정 검증
 * - KI-2: 공모 정원 초과 지원 차단
 * - KI-3: 삭제된 대상의 수정요청 승인 시 친절한 404
 */
describe('Known issues 수정', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  describe('KI-2: 정원 초과 지원 차단', () => {
    async function makeExhibition(capacity: number) {
      const gallery = await seedGallery(3);
      return testPrisma.exhibition.create({
        data: {
          title: '정원테스트', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 864e5),
          exhibitDate: new Date(Date.now() + 60 * 864e5),
          capacity, region: 'SEOUL', description: 'x', status: 'APPROVED', galleryId: gallery.id,
        },
      });
    }

    it('정원이 찬 뒤 추가 지원하면 400', async () => {
      const ex = await makeExhibition(1);
      const r1 = await request.post(`/api/exhibitions/${ex.id}/apply`)
        .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`).send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
      expect(r1.status).toBe(201);
      const r2 = await request.post(`/api/exhibitions/${ex.id}/apply`)
        .set('Authorization', `Bearer ${authToken(2, 'ARTIST')}`).send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
      expect(r2.status).toBe(400);
      expect(r2.body.error).toContain('마감');
    });

    it('정원이 남아있으면 정상 지원(201)', async () => {
      const ex = await makeExhibition(2);
      const r1 = await request.post(`/api/exhibitions/${ex.id}/apply`)
        .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`).send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
      const r2 = await request.post(`/api/exhibitions/${ex.id}/apply`)
        .set('Authorization', `Bearer ${authToken(2, 'ARTIST')}`).send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
    });

    it('거절된 지원은 정원에서 제외되어 슬롯이 복구됨', async () => {
      const ex = await makeExhibition(1);
      // 작가1 지원 → 정원 참
      const r1 = await request.post(`/api/exhibitions/${ex.id}/apply`)
        .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`).send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
      expect(r1.status).toBe(201);
      // 갤러리 오너(3)가 작가1 거절
      const rej = await request.patch(`/api/exhibitions/${ex.id}/applications/${r1.body.id}`)
        .set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`).send({ status: 'REJECTED' });
      expect(rej.status).toBe(200);
      // 작가2는 이제 지원 가능해야 함 (거절이 슬롯을 점유하지 않음)
      const r2 = await request.post(`/api/exhibitions/${ex.id}/apply`)
        .set('Authorization', `Bearer ${authToken(2, 'ARTIST')}`).send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
      expect(r2.status).toBe(201);
    });
  });

  describe('KI-3: 삭제된 대상 수정요청 승인', () => {
    it('대상 갤러리가 없으면 승인 시 404 + 요청은 PENDING 유지', async () => {
      const reqRow = await testPrisma.approvalRequest.create({
        data: { type: 'GALLERY_EDIT', targetId: 999999, changes: JSON.stringify({ description: 'x' }), status: 'PENDING', requesterId: 3 },
      });
      const res = await request.patch(`/api/approvals/edit-request/${reqRow.id}`)
        .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`).send({ status: 'APPROVED' });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('찾을 수 없');
      const after = await testPrisma.approvalRequest.findUnique({ where: { id: reqRow.id } });
      expect(after?.status).toBe('PENDING'); // 대상 없으니 승인 처리 안 됨
    });

    it('대상이 존재하면 정상 승인 + 변경 반영', async () => {
      const gallery = await seedGallery(3);
      const reqRow = await testPrisma.approvalRequest.create({
        data: { type: 'GALLERY_EDIT', targetId: gallery.id, changes: JSON.stringify({ description: '수정 반영됨' }), status: 'PENDING', requesterId: 3 },
      });
      const res = await request.patch(`/api/approvals/edit-request/${reqRow.id}`)
        .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`).send({ status: 'APPROVED' });
      expect(res.status).toBe(200);
      const g = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(g?.description).toBe('수정 반영됨');
    });
  });
});
