/**
 * 작가 화면을 **단계별로 눈으로 확인**하기 위한 테스트 공모 묶음 (로컬 전용).
 *
 * 마이페이지 [내 전시] 는 지원 → 수락 → 자료제출 → 확정 → 전시종료 → 정산 으로 화면이 계속 바뀌는데,
 * 실제 데이터로는 한 단계만 볼 수 있어 나머지를 확인할 방법이 없었다. 단계마다 하나씩 만들어 둔다.
 *
 * ## 쓰는 법
 *   cd backend && npx tsx scripts/seed-artist-stages.ts          # 만들기(다시 돌리면 갈아끼움)
 *   cd backend && npx tsx scripts/seed-artist-stages.ts --clean  # 남김없이 지우기
 *
 * ## 안전장치
 * - 제목이 전부 `[TEST]` 로 시작한다. `--clean` 은 **그 제목의 공모만** 지운다.
 * - 로컬 DB(artlink_prod, 운영 복제본)를 건드리므로 **실서버에서는 절대 돌리지 말 것.**
 *   NODE_ENV=production 이면 즉시 멈춘다.
 * - 만들어진 공모는 `status='APPROVED'` 라 **공개 목록(모집공고)에도 뜬다** — 확인이 끝나면 --clean 할 것.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { ARTIST_APPLY_TERMS_VERSION } from '../src/lib/terms';

if (process.env.NODE_ENV === 'production') {
  console.error('운영 환경에서는 실행할 수 없습니다.');
  process.exit(1);
}

const PREFIX = '[TEST]';
const ARTIST_NAME = '한도윤';
const CLEAN = process.argv.includes('--clean');

const day = (n: number) => new Date(Date.now() + n * 86400000);

/** 자료 제출 완료로 보이게 하는 최소 내용 (lib/submission.ts 의 hasSubmissionContent 기준) */
function submissionPayload(imageUrl: string) {
  return {
    artworkList: JSON.stringify([
      { image: imageUrl, title: '테스트 출품작 1', size: '60x40', medium: '캔버스에 아크릴', year: '2026', price: '1200000' },
      { image: imageUrl, title: '테스트 출품작 2', size: '90x60', medium: '한지에 채색', year: '2026', price: '2500000' },
    ]),
    cv: JSON.stringify({
      nameKo: ARTIST_NAME, nameEn: 'Kim Hyewon', tel: '010-0000-0000', email: 'test@example.com',
      solo: [{ year: '2025', content: '테스트 개인전' }],
      group: [{ year: '2024', content: '테스트 단체전' }],
    }),
    note: JSON.stringify({ statement: '테스트용 작가노트입니다.', sections: [{ title: '작업 배경', body: '확인용 본문' }] }),
    representativeIndex: 0,
  };
}

/** 각 단계 — 화면에서 무엇이 달라지는지 함께 적는다 */
const STAGES = [
  { key: '1-심사중', appStatus: 'SUBMITTED', ex: { deadline: day(7), deadlineStart: day(-7), exhibitStartDate: day(30), exhibitDate: day(45) } },
  { key: '2-거절', appStatus: 'REJECTED', ex: { deadline: day(-1), deadlineStart: day(-14), exhibitStartDate: day(20), exhibitDate: day(35) } },
  { key: '3-수락-자료미제출', appStatus: 'ACCEPTED', ex: { deadline: day(-1), deadlineStart: day(-14), exhibitStartDate: day(20), exhibitDate: day(35), submissionDeadline: day(5), recruitmentClosed: true } },
  { key: '4-수락-자료제출완료', appStatus: 'ACCEPTED', submit: true, ex: { deadline: day(-3), deadlineStart: day(-17), exhibitStartDate: day(14), exhibitDate: day(28), submissionDeadline: day(3), recruitmentClosed: true } },
  { key: '5-확정', appStatus: 'ACCEPTED', submit: true, ex: { deadline: day(-20), deadlineStart: day(-34), exhibitStartDate: day(-2), exhibitDate: day(12), submissionDeadline: day(-5), recruitmentClosed: true, confirmed: true } },
  { key: '6-전시종료-정산전', appStatus: 'ACCEPTED', submit: true, sales: true, ex: { deadline: day(-40), deadlineStart: day(-54), exhibitStartDate: day(-20), exhibitDate: day(-3), submissionDeadline: day(-25), recruitmentClosed: true, confirmed: true, ended: true } },
  { key: '7-정산확인요청', appStatus: 'ACCEPTED', submit: true, sales: true, approval: 'PENDING', ex: { deadline: day(-50), deadlineStart: day(-64), exhibitStartDate: day(-30), exhibitDate: day(-10), submissionDeadline: day(-35), recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: day(-1) } },
  { key: '8-정산완료', appStatus: 'ACCEPTED', submit: true, sales: true, approval: 'APPROVED', ex: { deadline: day(-70), deadlineStart: day(-84), exhibitStartDate: day(-50), exhibitDate: day(-30), submissionDeadline: day(-55), recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: day(-10), settledAt: day(-5) } },
] as const;

async function clean() {
  const targets = await prisma.exhibition.findMany({
    where: { title: { startsWith: PREFIX } }, select: { id: true, title: true },
  });
  if (targets.length === 0) { console.log('지울 테스트 공모가 없습니다.'); return; }
  const ids = targets.map(t => t.id);
  // Exhibition 삭제는 Application/Submission/Sale 등을 Cascade 로 지우지만,
  // ArtworkSale/ArtistSettlement/SettlementApproval 은 artist 쪽이 Restrict 라 먼저 지운다
  await prisma.settlementApproval.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.artistSettlement.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.artworkSale.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.exhibition.deleteMany({ where: { id: { in: ids } } });
  console.log(`테스트 공모 ${targets.length}건 삭제:\n  ${targets.map(t => t.title).join('\n  ')}`);
}

async function main() {
  const artist = await prisma.user.findFirst({ where: { name: { contains: ARTIST_NAME }, role: 'ARTIST', deletedAt: null } });
  if (!artist) throw new Error(`${ARTIST_NAME} 작가를 찾을 수 없습니다.`);

  await clean();                       // 다시 돌리면 항상 깨끗한 상태에서 시작
  if (CLEAN) return;

  const gallery = await prisma.gallery.findFirst({ where: { status: 'APPROVED' }, orderBy: { id: 'asc' } });
  if (!gallery) throw new Error('승인된 갤러리가 없습니다.');

  const img = await prisma.portfolioImage.findFirst({
    where: { portfolio: { userId: artist.id } }, orderBy: { id: 'asc' }, select: { url: true },
  });
  const imageUrl = img?.url ?? '';

  console.log(`작가 ${artist.name}(#${artist.id}) · 갤러리 ${gallery.name}(#${gallery.id})\n`);

  for (const stage of STAGES) {
    const ex = await prisma.exhibition.create({
      data: {
        title: `${PREFIX} ${stage.key}`,
        type: 'GROUP',
        capacity: 10,
        region: gallery.region ?? 'SEOUL',
        description: `작가 화면 단계 확인용 테스트 공모입니다. (${stage.key})`,
        imageUrl: imageUrl || null,
        status: 'APPROVED',
        galleryId: gallery.id,
        ...stage.ex,
      },
    });

    await prisma.application.create({
      data: {
        exhibitionId: ex.id,
        userId: artist.id,
        status: stage.appStatus,
        biography: '테스트 지원서 약력입니다.',
        artworkImages: JSON.stringify(imageUrl ? [imageUrl] : []),
        termsAgreedAt: new Date(),
        termsVersion: ARTIST_APPLY_TERMS_VERSION,
      },
    });

    if ('submit' in stage && stage.submit) {
      await prisma.exhibitionSubmission.create({
        data: { exhibitionId: ex.id, userId: artist.id, ...submissionPayload(imageUrl) },
      });
    }

    if ('sales' in stage && stage.sales) {
      await prisma.artworkSale.createMany({
        data: [
          { exhibitionId: ex.id, artistUserId: artist.id, artworkIndex: 0, title: '테스트 출품작 1', soldPrice: 1_200_000, paymentMethod: 'CARD' },
          { exhibitionId: ex.id, artistUserId: artist.id, artworkIndex: 1, title: '테스트 출품작 2', soldPrice: 2_500_000, paymentMethod: 'CASH' },
        ],
      });
      await prisma.artistSettlement.create({ data: { exhibitionId: ex.id, artistUserId: artist.id, galleryRatio: 40 } });
    }

    if ('approval' in stage && stage.approval) {
      await prisma.settlementApproval.create({
        data: {
          exhibitionId: ex.id, artistUserId: artist.id,
          status: stage.approval,
          // askedAt 이 있어야 무응답 자동 수락 대상이 된다(lib/settlementDeadline.ts)
          askedAt: day(-1),
        },
      });
    }

    console.log(`  ✔ ${PREFIX} ${stage.key}  (exhibitionId=${ex.id})`);
  }

  console.log(`\n확인: http://localhost:5173/mypage?tab=applications`);
  console.log(`정리: npx tsx scripts/seed-artist-stages.ts --clean`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
