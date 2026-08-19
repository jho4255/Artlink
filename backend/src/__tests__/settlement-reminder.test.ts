/**
 * 정산 방치 재촉 알림 (lib/settlementReminder.ts)
 *
 * 전시가 끝났는데 정산을 시작하지 않으면 20일째에 목록에서 종료로 내려간다.
 * **아무 말 없이 사라지면** 갤러리는 자기 공모가 어디 갔는지 모른다.
 *   D+5 · D+10 · D+15 재촉 → D+20 종료 통보
 *
 * ⚠️ 읽기 요청마다 도는 구조라 **중복 방지가 핵심**이다. refKey 가 없으면
 *    갤러리가 새로고침할 때마다 같은 알림이 쌓인다.
 * ⚠️ 정산을 시작한 공모는 재촉하지 않는다 — 하고 있는 사람을 재촉하면 안 된다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { testPrisma, cleanDb, seedUsers, seedGallery } from './helpers';
import {
  sweepSettlementReminders, resetReminderThrottle, daysSinceExhibit, reminderFor, REMIND_DAYS,
} from '../lib/settlementReminder';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('reminderFor — 오늘 보낼 알림 고르기', () => {
  it('5·10·15일째만 재촉한다', () => {
    for (const d of REMIND_DAYS) expect(reminderFor(d)?.kind).toBe('remind');
    for (const d of [1, 4, 6, 9, 11, 14, 16]) expect(reminderFor(d)).toBeNull();
  });

  it('남은 일수를 함께 알려준다 (문구에 쓴다)', () => {
    expect(reminderFor(5)?.left).toBe(15);
    expect(reminderFor(15)?.left).toBe(5);
  });

  it('20일 이상은 종료 통보 — 하루 놓쳐도 나가야 한다', () => {
    expect(reminderFor(20)?.kind).toBe('closed');
    expect(reminderFor(37)?.kind).toBe('closed');
  });

  it('전시가 아직 안 끝났으면 아무것도 안 보낸다', () => {
    expect(reminderFor(0)).toBeNull();
    expect(reminderFor(-3)).toBeNull();
  });
});

describe('daysSinceExhibit — KST 달력 날짜 기준', () => {
  it('같은 날은 0일', () => {
    expect(daysSinceExhibit(new Date('2026-08-19T00:00:00.000Z'), new Date('2026-08-19T14:00:00.000Z'))).toBe(0);
  });
  it('KST 자정을 넘기면 하루가 는다', () => {
    // 2026-08-19T15:10Z = KST 8/20 00:10
    expect(daysSinceExhibit(new Date('2026-08-19T00:00:00.000Z'), new Date('2026-08-19T15:10:00.000Z'))).toBe(1);
  });
});

describe('sweepSettlementReminders', () => {
  let galleryId: number;

  const makeEx = (title: string, endedDaysAgo: number, extra: Record<string, unknown> = {}) =>
    testPrisma.exhibition.create({
      data: {
        title, type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
        deadline: daysAgo(endedDaysAgo + 40), exhibitStartDate: daysAgo(endedDaysAgo + 10),
        exhibitDate: daysAgo(endedDaysAgo),
        status: 'APPROVED', galleryId, ended: true,
        ...extra,
      },
    });
  const notisOf = (exhibitionId: number) =>
    testPrisma.notification.findMany({ where: { refKey: { startsWith: `settlement-` }, linkUrl: { contains: `/${exhibitionId}/` } } });

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    galleryId = (await seedGallery(3)).id;
    resetReminderThrottle();
  });

  it('D+5 에 갤러리 오너에게 재촉이 간다', async () => {
    const ex = await makeEx('방치 공모', 5);
    await sweepSettlementReminders();

    const notis = await notisOf(ex.id);
    expect(notis).toHaveLength(1);
    expect(notis[0]!.userId).toBe(3);                 // 갤러리 오너
    expect(notis[0]!.type).toBe('SETTLEMENT_REMINDER');
    expect(notis[0]!.message).toContain('15일 뒤');
  });

  /** 이 테스트가 이 파일의 존재 이유다 — 읽기마다 도는 구조라 중복이 제일 위험하다 */
  it('여러 번 돌아도 같은 알림은 한 번만', async () => {
    const ex = await makeEx('방치 공모', 10);
    for (let i = 0; i < 5; i++) {
      resetReminderThrottle();
      await sweepSettlementReminders();
    }
    expect(await notisOf(ex.id)).toHaveLength(1);
  });

  it('스로틀 — 5분 안에 다시 부르면 돌지 않는다', async () => {
    await makeEx('방치 공모', 5);
    await sweepSettlementReminders();
    await testPrisma.notification.deleteMany({});
    await sweepSettlementReminders();              // resetThrottle 없이 곧바로
    expect(await testPrisma.notification.count()).toBe(0);
  });

  it('재촉 시점이 아닌 날에는 아무것도 안 보낸다', async () => {
    const ex = await makeEx('방치 공모', 7);
    await sweepSettlementReminders();
    expect(await notisOf(ex.id)).toHaveLength(0);
  });

  it('20일이 지나면 종료 통보', async () => {
    const ex = await makeEx('방치 공모', 21);
    await sweepSettlementReminders();
    const notis = await notisOf(ex.id);
    expect(notis).toHaveLength(1);
    expect(notis[0]!.type).toBe('SETTLEMENT_AUTO_CLOSED');
    expect(notis[0]!.message).toContain('종료된 공모');
  });

  describe('정산을 시작한 공모는 재촉하지 않는다', () => {
    it('판매를 입력했으면 조용히 둔다', async () => {
      const ex = await makeEx('정산중', 10);
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });
      await testPrisma.artworkSale.create({
        data: { exhibitionId: ex.id, artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1000, paymentMethod: 'CARD' },
      });
      await sweepSettlementReminders();
      expect(await notisOf(ex.id)).toHaveLength(0);
    });

    it('확인 요청을 보냈으면 조용히 둔다', async () => {
      const ex = await makeEx('요청함', 10, { settlementRequestedAt: daysAgo(1) });
      await sweepSettlementReminders();
      expect(await notisOf(ex.id)).toHaveLength(0);
    });

    it('정산이 끝났으면 당연히 안 보낸다', async () => {
      const ex = await makeEx('완료', 21, { settledAt: daysAgo(1) });
      await sweepSettlementReminders();
      expect(await notisOf(ex.id)).toHaveLength(0);
    });
  });

  it('미승인 공모는 건드리지 않는다', async () => {
    const ex = await makeEx('심사중', 10, { status: 'PENDING' });
    await sweepSettlementReminders();
    expect(await notisOf(ex.id)).toHaveLength(0);
  });

  it('전시가 아직 안 끝난 공모도 건드리지 않는다', async () => {
    const ex = await makeEx('진행중', -5, { ended: false });
    await sweepSettlementReminders();
    expect(await notisOf(ex.id)).toHaveLength(0);
  });

  it('갤러리가 [전시종료]를 안 눌렀어도 전시 종료일 기준으로 보낸다', async () => {
    // 방치의 전형 — 버튼을 안 눌렀으니 ended=false 지만 날짜상 끝난 지 오래다
    const ex = await makeEx('버튼 안 누름', 15, { ended: false });
    await sweepSettlementReminders();
    expect(await notisOf(ex.id)).toHaveLength(1);
  });
});
