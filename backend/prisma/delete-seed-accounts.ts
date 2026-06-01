/**
 * 데모(개발용) 시드 계정 + 그들이 만든 데모 콘텐츠 일괄 삭제 (운영 정리용)
 *
 * 대상: artist1/artist2/gallery/admin @artlink.com (provider=LOCAL 시드 계정)
 * 삭제: 소유 갤러리(→공모/전시/리뷰/이미지 연쇄) + 작성 리뷰/지원/찜/포트폴리오/수정요청 → 계정
 *       (notification/inquiry/message/messageReport/portfolioImageLike 는 user 삭제 시 cascade)
 *
 * 사용: cd backend && DATABASE_URL="<운영DB>" npx tsx prisma/delete-seed-accounts.ts
 *       (안전을 위해 기본은 dry-run. 실제 삭제하려면 끝에 --yes 추가)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SEED_EMAILS = ['artist1@artlink.com', 'artist2@artlink.com', 'gallery@artlink.com', 'admin@artlink.com'];

(async () => {
  const apply = process.argv.includes('--yes');
  const users = await prisma.user.findMany({
    where: { email: { in: SEED_EMAILS }, provider: 'LOCAL' },
    select: { id: true, email: true, role: true },
  });
  if (users.length === 0) { console.log('삭제할 시드 계정이 없습니다.'); process.exit(0); }
  const ids = users.map(u => u.id);
  console.log('대상 시드 계정:', users.map(u => `${u.email}(id ${u.id}, ${u.role})`).join(', '));

  const galleries = await prisma.gallery.count({ where: { ownerId: { in: ids } } });
  const reviews = await prisma.review.count({ where: { userId: { in: ids } } });
  const apps = await prisma.application.count({ where: { userId: { in: ids } } });
  console.log(`연관 데이터: 갤러리 ${galleries}(공모/전시/리뷰 연쇄삭제), 작성리뷰 ${reviews}, 지원 ${apps}`);

  if (!apply) {
    console.log('\n[DRY-RUN] 실제로 지우려면 끝에 --yes 를 붙여 다시 실행하세요.');
    process.exit(0);
  }

  await prisma.$transaction([
    // 소유 갤러리 삭제 (Cascade: GalleryImage/Exhibition→Application·PromoPhoto/Show→ShowImage/Review/Favorite/GalleryOfMonth)
    prisma.gallery.deleteMany({ where: { ownerId: { in: ids } } }),
    // 시드 계정이 직접 참조하는 Restrict FK 레코드 정리
    prisma.review.deleteMany({ where: { userId: { in: ids } } }),
    prisma.favorite.deleteMany({ where: { userId: { in: ids } } }),
    prisma.application.deleteMany({ where: { userId: { in: ids } } }),
    prisma.portfolio.deleteMany({ where: { userId: { in: ids } } }), // cascade: PortfolioImage→PortfolioImageLike
    prisma.approvalRequest.deleteMany({ where: { requesterId: { in: ids } } }),
    // 마지막으로 계정 삭제 (cascade: Notification/Inquiry/Message/MessageReport/PortfolioImageLike)
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`\n✅ 시드 계정 ${ids.length}개 + 데모 콘텐츠 삭제 완료`);
  const remaining = await prisma.user.findMany({ select: { email: true, role: true, provider: true } });
  console.log('남은 유저:', remaining.map(u => `${u.email}(${u.role}/${u.provider})`).join(', ') || '(없음)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
