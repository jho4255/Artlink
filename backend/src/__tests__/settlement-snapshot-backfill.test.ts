/**
 * 기존 승인행 지문 백필 마이그레이션 검증
 * (prisma/migrations/20260817130000_backfill_settlement_snapshot)
 *
 * ── 왜 테스트가 필요한가 ────────────────────────────────────
 * 배포 시점에 실서버에는 **snapshot 이 NULL 인 승인행**이 이미 쌓여 있다(옛 코드가 만든 것).
 * 그대로 두면 지문 대조가 전부 불일치로 나와 **운영 중인 정산이 깨진다**. 실측한 증상:
 *   · 전원 수락한 공모에서 [정산 완료] → 400
 *   · 내용을 안 바꾸고 저장만 해도 수락이 전부 풀리고 작가들에게 헛알림
 *
 * 백필 SQL 은 `lib/settlementFingerprint.ts` 와 **바이트 단위로 같은 문자열**을 만들어야 한다.
 * 한 글자만 달라도 위 증상이 그대로 재현되는데, 조용히 일어나므로 눈으로는 못 잡는다.
 * 그래서 마이그레이션 파일을 **직접 읽어** 실행하고 JS 결과와 맞춰 본다(둘이 갈라지면 여기서 깨진다).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { testPrisma, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { settlementFingerprint } from '../lib/settlementFingerprint';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../prisma/migrations/20260817130000_backfill_settlement_snapshot/migration.sql'),
  'utf8',
);

describe('정산 지문 백필 마이그레이션', () => {
  let exId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    for (const userId of [1, 2]) {
      await testPrisma.application.create({ data: { userId, exhibitionId: exId, status: 'ACCEPTED' } });
    }
  });

  /** 옛 코드가 남긴 모습 그대로 — 승인은 있는데 지문은 없다 */
  const legacyApproval = (userId: number, status = 'APPROVED') =>
    testPrisma.settlementApproval.create({ data: { exhibitionId: exId, artistUserId: userId, status, snapshot: null } });

  const runBackfill = () => testPrisma.$executeRawUnsafe(SQL);

  const snapshotOf = async (userId: number) =>
    (await testPrisma.settlementApproval.findUnique({
      where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: userId } },
    }))!.snapshot;

  const expectedFor = async (userId: number) => {
    const sales = await testPrisma.artworkSale.findMany({ where: { exhibitionId: exId, artistUserId: userId } });
    const st = await testPrisma.artistSettlement.findUnique({
      where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: userId } },
    });
    return settlementFingerprint(sales, st?.galleryRatio ?? 0);
  };

  it('판매 여러 건 + 카드/현금 혼합 — SQL 결과가 JS 지문과 정확히 같다', async () => {
    await testPrisma.artistSettlement.create({ data: { exhibitionId: exId, artistUserId: 1, galleryRatio: 37 } });
    await testPrisma.artworkSale.createMany({
      data: [
        // 일부러 index 역순으로 넣는다 — SQL 의 ORDER BY 가 빠지면 여기서 깨진다
        { exhibitionId: exId, artistUserId: 1, artworkIndex: 5, title: 'C', soldPrice: 3_300_000, paymentMethod: 'CASH' },
        { exhibitionId: exId, artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
        { exhibitionId: exId, artistUserId: 1, artworkIndex: 2, title: 'B', soldPrice: 2_000_000, paymentMethod: 'CARD' },
      ],
    });
    await legacyApproval(1);
    await runBackfill();

    const got = await snapshotOf(1);
    expect(got).toBe(await expectedFor(1));
    expect(got).toBe('r37|0:1000000:CARD,2:2000000:CARD,5:3300000:CASH');
  });

  it('판매도 비율도 없는 작가 — r0| (undefined 와 비교되면 안 된다)', async () => {
    await legacyApproval(1);
    await runBackfill();
    expect(await snapshotOf(1)).toBe('r0|');
    expect(await snapshotOf(1)).toBe(await expectedFor(1));
  });

  it('비율만 있고 판매가 없는 작가', async () => {
    await testPrisma.artistSettlement.create({ data: { exhibitionId: exId, artistUserId: 1, galleryRatio: 50 } });
    await legacyApproval(1);
    await runBackfill();
    expect(await snapshotOf(1)).toBe('r50|');
    expect(await snapshotOf(1)).toBe(await expectedFor(1));
  });

  it('작가별로 자기 판매분만 — 남의 판매가 섞이면 안 된다', async () => {
    await testPrisma.artistSettlement.createMany({
      data: [
        { exhibitionId: exId, artistUserId: 1, galleryRatio: 30 },
        { exhibitionId: exId, artistUserId: 2, galleryRatio: 40 },
      ],
    });
    await testPrisma.artworkSale.createMany({
      data: [
        { exhibitionId: exId, artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
        { exhibitionId: exId, artistUserId: 2, artworkIndex: 0, title: 'B', soldPrice: 9_999_000, paymentMethod: 'CASH' },
      ],
    });
    await legacyApproval(1);
    await legacyApproval(2, 'ISSUE');
    await runBackfill();

    expect(await snapshotOf(1)).toBe('r30|0:1000000:CARD');
    expect(await snapshotOf(2)).toBe('r40|0:9999000:CASH');
  });

  it('PENDING 은 채우지 않는다 (아직 응답 안 한 사람 — 응답할 때 서버가 쓴다)', async () => {
    await testPrisma.artistSettlement.create({ data: { exhibitionId: exId, artistUserId: 1, galleryRatio: 30 } });
    await legacyApproval(1, 'PENDING');
    await runBackfill();
    expect(await snapshotOf(1)).toBeNull();
  });

  it('이미 지문이 있는 행은 건드리지 않는다 (재실행해도 안전)', async () => {
    await testPrisma.artistSettlement.create({ data: { exhibitionId: exId, artistUserId: 1, galleryRatio: 30 } });
    await testPrisma.settlementApproval.create({
      data: { exhibitionId: exId, artistUserId: 1, status: 'APPROVED', snapshot: '손으로-넣은-값' },
    });
    await runBackfill();
    await runBackfill();
    expect(await snapshotOf(1)).toBe('손으로-넣은-값');
  });
});
