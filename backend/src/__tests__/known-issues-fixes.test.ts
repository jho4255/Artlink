import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';

/**
 * known-issues.md 일괄 수정 검증
 * - KI-2: 공모 정원 초과 — 2026-09-27 부터 정원은 '선정 인원'(지원은 무제한, 수락에서 막는다)
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

    // 2026-09-27 — 정원은 '선정 인원'이다(사용자 결정). 예전(KI-2, 2026-07)엔 지원 수로 막아 정원 5명이면 선착순 5명만 지원할 수 있었다.
    //   지금은 지원은 무제한, 정원은 **수락**에서 지킨다. 테스트 이름의 KI-2 는 '정원을 넘겨 선정되지 않는다'로 이어진다.
    const apply = (exId: number, artistId: number) => request.post(`/api/exhibitions/${exId}/apply`)
      .set('Authorization', `Bearer ${authToken(artistId, 'ARTIST')}`)
      .send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    const setStatus = (exId: number, appId: number, status: string) => request.patch(`/api/exhibitions/${exId}/applications/${appId}`)
      .set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`).send({ status });
    async function extraArtist(n: number) {
      const u = await testPrisma.user.create({ data: { email: `cap${n}@test.local`, name: `정원작가${n}`, role: 'ARTIST', provider: 'LOCAL' } });
      return u.id;
    }

    it('정원을 넘겨도 지원은 받는다(201) — 정원은 지원자 수가 아니다', async () => {
      const ex = await makeExhibition(1);
      expect((await apply(ex.id, 1)).status).toBe(201);
      expect((await apply(ex.id, 2)).status).toBe(201);
      const extra = await extraArtist(1);
      expect((await apply(ex.id, extra)).status).toBe(201);
    });

    it('선정 인원이 찬 뒤 수락하면 400', async () => {
      const ex = await makeExhibition(1);
      const a1 = await apply(ex.id, 1); const a2 = await apply(ex.id, 2);
      expect((await setStatus(ex.id, a1.body.id, 'ACCEPTED')).status).toBe(200);
      const r = await setStatus(ex.id, a2.body.id, 'ACCEPTED');
      expect(r.status).toBe(400);
      expect(r.body.error).toContain('선정 인원(1명)');
      // 거절로는 바꿀 수 있다 — 정원과 무관
      expect((await setStatus(ex.id, a2.body.id, 'REJECTED')).status).toBe(200);
    });

    it('거절된 지원은 선정 인원에 들어가지 않는다', async () => {
      const ex = await makeExhibition(1);
      const a1 = await apply(ex.id, 1); const a2 = await apply(ex.id, 2);
      expect((await setStatus(ex.id, a1.body.id, 'REJECTED')).status).toBe(200);
      expect((await setStatus(ex.id, a2.body.id, 'ACCEPTED')).status).toBe(200);
    });

    it('동시에 수락해도 정원을 넘기지 않는다(일괄 수락은 한 건씩 동시에 들어온다)', async () => {
      const ex = await makeExhibition(2);
      const ids: number[] = [];
      for (const artist of [1, 2, await extraArtist(2), await extraArtist(3), await extraArtist(4)]) ids.push((await apply(ex.id, artist)).body.id);
      const results = await Promise.all(ids.map((id) => setStatus(ex.id, id, 'ACCEPTED')));
      expect(results.filter((r) => r.status === 200)).toHaveLength(2);
      for (const r of results.filter((x) => x.status !== 200)) expect(r.body.error).toContain('선정 인원');
      expect(await testPrisma.application.count({ where: { exhibitionId: ex.id, status: 'ACCEPTED' } })).toBe(2);
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
