/**
 * 카드 결제 수수료 (`Exhibition.cardFeeRate`)
 *
 * ── 규칙 (2026-08-19 확정) ──────────────────────────────────
 * 수수료는 **카드로 팔린 금액에서 먼저 뗀 뒤**, 남은 금액을 갤러리:작가 비율로 나눈다.
 * 그래야 수수료를 양쪽이 비율만큼 나눠 부담한다. 현금 판매분에는 붙지 않는다.
 *
 * ── 여기서 반드시 지켜야 하는 것 ────────────────────────────
 * ⚠️ **수수료 0 이면 예전과 1원도 달라지면 안 된다.** 실서버에 이미 정산이 끝났거나 진행 중인
 *    공모가 있고, 작가가 수락해 둔 지문이 저장돼 있다. 금액이나 지문 형식이 바뀌면
 *    멀쩡한 수락이 통째로 풀려 갤러리가 정산을 완료하지 못한다.
 * ⚠️ 수수료율을 **바꾸면** 카드 판매가 있는 작가의 확인은 풀려야 한다 —
 *    본 적 없는 금액으로 정산이 확정되면 그게 곧 분쟁 근거다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const ownerTok = authToken(3, 'GALLERY');
const artist1Tok = authToken(1, 'ARTIST');
const artist2Tok = authToken(2, 'ARTIST');

describe('카드 수수료 정산', () => {
  let exId: number;

  const saveSettlement = (body: any) =>
    request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send(body);
  const getSettlement = () =>
    request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
  const artistOf = (body: any, id: number) => body.artists.find((a: any) => a.user.id === id);

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'ACCEPTED' } });

    for (const tok of [artist1Tok, artist2Tok]) {
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${tok}`).send({
        artworkList: [
          { title: 'A', size: '1', medium: '1', year: '1', price: '1' },
          { title: 'B', size: '1', medium: '1', year: '1', price: '1' },
        ],
        cv: null, note: null,
      });
    }
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
  });

  it('기본값은 0 — 예전과 똑같이 계산된다', async () => {
    await saveSettlement({
      sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' }],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }],
    });
    const r = await getSettlement();
    const a = artistOf(r.body, 1);
    expect(r.body.cardFeeRate).toBe(0);
    expect(a.cardFee).toBe(0);
    expect(a.total).toBe(1_000_000);
    expect(a.galleryAmount).toBe(400_000);
    expect(a.artistAmount).toBe(600_000);
  });

  it('카드 판매에 수수료를 먼저 떼고 남은 금액을 비율로 나눈다', async () => {
    await saveSettlement({
      cardFeeRate: 2.2,
      sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' }],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }],
    });
    const r = await getSettlement();
    const a = artistOf(r.body, 1);
    expect(r.body.cardFeeRate).toBe(2.2);
    expect(a.cardTotal).toBe(1_000_000);
    expect(a.cardFee).toBe(22_000);       // 1,000,000 × 2.2%
    expect(a.settleBase).toBe(978_000);
    expect(a.galleryAmount).toBe(391_200); // 978,000 × 40%
    expect(a.artistAmount).toBe(586_800);
    expect(a.galleryAmount + a.artistAmount).toBe(a.settleBase); // 1원도 새지 않는다
  });

  it('현금 판매에는 수수료가 붙지 않는다', async () => {
    await saveSettlement({
      cardFeeRate: 2.2,
      sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CASH' }],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }],
    });
    const a = artistOf((await getSettlement()).body, 1);
    expect(a.cashTotal).toBe(1_000_000);
    expect(a.cardFee).toBe(0);
    expect(a.artistAmount).toBe(600_000);
  });

  it('카드+현금이 섞이면 카드분에만 수수료가 붙는다', async () => {
    await saveSettlement({
      cardFeeRate: 2.2,
      sales: [
        { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
        { artistUserId: 1, artworkIndex: 1, title: 'B', soldPrice: 500_000, paymentMethod: 'CASH' },
      ],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }],
    });
    const a = artistOf((await getSettlement()).body, 1);
    expect(a.cardTotal).toBe(1_000_000);
    expect(a.cashTotal).toBe(500_000);
    expect(a.total).toBe(1_500_000);
    expect(a.cardFee).toBe(22_000);        // 카드분에만
    expect(a.settleBase).toBe(1_478_000);
    expect(a.galleryAmount).toBe(591_200);
    expect(a.artistAmount).toBe(886_800);
  });

  it('합계(grand)에도 수수료가 반영된다', async () => {
    await saveSettlement({
      cardFeeRate: 2.2,
      sales: [
        { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
        { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 2_000_000, paymentMethod: 'CARD' },
      ],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 50 }],
    });
    const g = (await getSettlement()).body.grand;
    expect(g.total).toBe(3_000_000);
    expect(g.cardFee).toBe(66_000);
    expect(g.settleBase).toBe(2_934_000);
    expect(g.galleryAmount + g.artistAmount).toBe(g.settleBase);
  });

  it('수수료율은 소수 둘째 자리까지 — 그 아래는 반올림해 저장한다', async () => {
    await saveSettlement({ cardFeeRate: 2.255, sales: [], ratios: [] });
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exId }, select: { cardFeeRate: true } });
    expect(ex!.cardFeeRate).toBe(2.26);
  });

  it('음수·범위 밖 값은 막는다 (수수료가 지급액을 늘리면 안 된다)', async () => {
    await saveSettlement({ cardFeeRate: -5, sales: [], ratios: [] });
    expect((await getSettlement()).body.cardFeeRate).toBe(0);
    await saveSettlement({ cardFeeRate: 999, sales: [], ratios: [] });
    expect((await getSettlement()).body.cardFeeRate).toBe(100);
  });

  it('수수료율을 안 보내면 기존 값을 유지한다 (옛 화면이 0으로 지우면 안 된다)', async () => {
    await saveSettlement({ cardFeeRate: 3.3, sales: [], ratios: [] });
    await saveSettlement({ sales: [], ratios: [] });   // 필드 자체를 뺀 요청
    expect((await getSettlement()).body.cardFeeRate).toBe(3.3);
  });

  it('작가 화면(my-settlement)에도 같은 금액과 수수료율이 보인다', async () => {
    await saveSettlement({
      cardFeeRate: 2.2,
      sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' }],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }],
    });
    await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);

    const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(mine.status).toBe(200);
    expect(mine.body.cardFeeRate).toBe(2.2);
    expect(mine.body.artist.cardFee).toBe(22_000);
    expect(mine.body.artist.artistAmount).toBe(586_800);
  });

  describe('수수료율 변경과 작가 재확인', () => {
    beforeEach(async () => {
      await saveSettlement({
        sales: [
          { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
          { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CASH' },
        ],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
      });
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      for (const [tok, id] of [[artist1Tok, 1], [artist2Tok, 2]] as const) {
        const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${tok}`);
        const r = await request.post(`/api/operations/${exId}/settlement/respond`)
          .set('Authorization', `Bearer ${tok}`).send({ approve: true, fingerprint: mine.body.fingerprint });
        expect(r.status, `artist${id} 수락`).toBe(200);
      }
    });

    it('수수료율을 새로 넣으면 카드 판매 작가만 재확인 대상이 된다', async () => {
      const put = await saveSettlement({
        cardFeeRate: 2.2,
        sales: [
          { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
          { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CASH' },
        ],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
      });
      // 현금으로만 판 artist2 는 금액이 그대로 → 수락 유지 (헛되이 다시 붙잡지 않는다)
      expect(put.body.resetIds).toEqual([1]);

      const apprs = await testPrisma.settlementApproval.findMany({ where: { exhibitionId: exId }, orderBy: { artistUserId: 'asc' } });
      expect(apprs.find(a => a.artistUserId === 1)!.status).toBe('PENDING');
      expect(apprs.find(a => a.artistUserId === 2)!.status).toBe('APPROVED');
    });

    it('수수료율이 그대로면 아무도 재확인하지 않는다', async () => {
      const put = await saveSettlement({
        sales: [
          { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
          { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CASH' },
        ],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
      });
      expect(put.body.resetIds).toEqual([]);
    });

    it('수수료를 붙인 채 완료하려면 카드 작가가 바뀐 금액을 다시 수락해야 한다', async () => {
      await saveSettlement({
        cardFeeRate: 2.2,
        sales: [
          { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
          { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CASH' },
        ],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
      });
      const blocked = await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`);
      expect(blocked.status).toBe(400);

      const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.artist.artistAmount).toBe(586_800);   // 수수료가 반영된 새 금액
      await request.post(`/api/operations/${exId}/settlement/respond`)
        .set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true, fingerprint: mine.body.fingerprint });

      const done = await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`);
      expect(done.status).toBe(200);
    });

    it('작가가 옛 화면(수수료 전 지문)으로 수락하면 409 — 못 본 금액에 동의시키지 않는다', async () => {
      const stale = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      await saveSettlement({
        cardFeeRate: 2.2,
        sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' }],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }],
      });
      const r = await request.post(`/api/operations/${exId}/settlement/respond`)
        .set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true, fingerprint: stale.body.fingerprint });
      expect(r.status).toBe(409);
    });
  });
});
