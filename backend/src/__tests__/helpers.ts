/**
 * 테스트 헬퍼 — supertest 요청, DB 정리, 시드 데이터 유틸리티
 */
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import prisma from '../lib/prisma';

// app과 동일한 Prisma 인스턴스 사용 (별도 인스턴스 간 deadlock 방지)
export const testPrisma = prisma;

// supertest 요청 객체
export const request = supertest(app);

// JWT 토큰 생성 (테스트 인증용)
export function authToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

const ALL_TABLES = [
  'ChatMessage', 'ChatParticipant', 'Chat',
  'KanbanSubtask', 'KanbanComment', 'KanbanCard', 'KanbanBoard',
  'MessageReport', 'Message',
  'Faq', 'Inquiry', 'Notification', 'ExhibitionInvite', 'ArtworkScrap',
  'Application', 'ApprovalRequest', 'Favorite', 'Review', 'PromoPhoto', 'ExhibitionManager',
  'PortfolioImage', 'Portfolio', 'GalleryOfMonth', 'ShowImage', 'Show', 'Exhibition',
  'GalleryImage', 'Gallery', 'HeroSlide', 'Benefit', 'User',
];

/**
 * ⚠️⚠️ **테스트 DB가 아니면 지우지 않는다.**
 *
 * 2026-09-04 사고: `npx vitest run` 을 **레포 루트에서** 돌렸다. 루트에는 `vitest.config.ts` 가
 * 없어서 `backend/vitest.config.ts` 의 `setupFiles`(= `DATABASE_URL` 을 `artlink_test` 로 덮어쓰는
 * 유일한 장치)가 **로드되지 않았고**, 기본 include 패턴이 `backend/src/**` 를 주워 담았다.
 * 그래서 `lib/prisma.ts` 가 `backend/.env` 의 `artlink_prod`(실서버 복제본)에 붙었고
 * `cleanDb()` 가 그걸 통째로 비웠다. **에러 없이, 초록색으로 통과하면서.**
 *
 * 안전장치를 `setup.ts`(설정 파일에 의존)에만 두면 이렇게 조용히 우회된다.
 * **지우는 지점에서** 막는다 — cwd·설정·실행 방법과 무관하게 항상 걸린다.
 */
function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  const db = url.split('/').pop()?.split('?')[0] ?? '';
  if (db !== 'artlink_test') {
    throw new Error(
      `[cleanDb] 테스트 DB 가 아닙니다: "${db || '(DATABASE_URL 없음)'}"\n` +
      `  테스트는 반드시 artlink_test 에서만 돌아야 합니다.\n` +
      `  → 백엔드 테스트는 backend/ 디렉터리에서 'npm test' 로 실행하세요.\n` +
      `    (레포 루트에서 'npx vitest run' 을 돌리면 setupFiles 가 안 걸려 실 DB 를 지웁니다)`,
    );
  }
}

// DB 전체 정리 — interactive transaction (단일 커넥션, deadlock 불가)
export async function cleanDb() {
  assertTestDatabase();
  await testPrisma.$transaction(async (tx) => {
    await tx.chatMessage.deleteMany();
    await tx.chatParticipant.deleteMany();
    await tx.chat.deleteMany();
    await tx.postLike.deleteMany();
    await tx.postComment.deleteMany();
    await tx.post.deleteMany();
    await tx.kanbanSubtask.deleteMany();
    await tx.kanbanComment.deleteMany();
    await tx.kanbanCard.deleteMany();
    await tx.kanbanBoard.deleteMany();
    await tx.messageReport.deleteMany();
    await tx.message.deleteMany();
    await tx.faq.deleteMany();
    await tx.inquiry.deleteMany();
    await tx.notification.deleteMany();
    await tx.exhibitionInvite.deleteMany();
    await tx.artworkScrap.deleteMany();
    await tx.application.deleteMany();
    await tx.approvalRequest.deleteMany();
    await tx.favorite.deleteMany();
    await tx.review.deleteMany();
    await tx.promoPhoto.deleteMany();
    await tx.portfolioImage.deleteMany();
    await tx.portfolio.deleteMany();
    await tx.galleryOfMonth.deleteMany();
    await tx.showImage.deleteMany();
    await tx.show.deleteMany();
    await tx.exhibition.deleteMany();
    await tx.galleryImage.deleteMany();
    await tx.gallery.deleteMany();
    await tx.heroSlide.deleteMany();
    await tx.benefit.deleteMany();
    await tx.user.deleteMany();
    await tx.appSetting.deleteMany(); // FK 없음 — 개발자 도구 토글이 테스트 간 누수되지 않도록 명시 삭제
    await tx.adBanner.deleteMany();    // FK 없음(User 캐스케이드 대상 아님) — 명시 삭제
    // Follow/Story/StoryLike/StoryComment/GuestbookEntry 는 User 캐스케이드로 함께 지워진다
  });
  // 시퀀스 리셋 (트랜잭션 외부 — DDL은 트랜잭션 안에서 불안정)
  for (const table of ALL_TABLES) {
    await testPrisma.$executeRawUnsafe(
      `SELECT setval('"${table}_id_seq"', 1, false)`
    );
  }
}

// 기본 테스트 유저 시드 (4명: Artist1, Artist2, Gallery, Admin)
export async function seedUsers() {
  const users = [
    { id: 1, email: 'artist1@test.com', name: 'Artist 1', role: 'ARTIST' },
    { id: 2, email: 'artist2@test.com', name: 'Artist 2', role: 'ARTIST' },
    { id: 3, email: 'gallery@test.com', name: 'Gallery Owner', role: 'GALLERY' },
    { id: 4, email: 'admin@test.com', name: 'Admin', role: 'ADMIN' },
  ];
  for (const u of users) {
    await testPrisma.user.upsert({
      where: { id: u.id },
      create: u,
      update: u,
    });
  }
  // autoincrement 시퀀스를 100으로 설정 (다음 create 시 충돌 방지)
  await testPrisma.$executeRawUnsafe(`SELECT setval('"User_id_seq"', 100, false)`);
}

// 승인된 갤러리 시드
export async function seedGallery(ownerId: number = 3) {
  return testPrisma.gallery.create({
    data: {
      name: 'Test Gallery',
      address: '서울시 종로구',
      phone: '02-1234-5678',
      description: '테스트 갤러리입니다',
      region: 'SEOUL',
      ownerName: 'Gallery Owner',
      status: 'APPROVED',
      ownerId,
    },
  });
}

// 승인된 전시(Show) 시드 (진행중)
export async function seedShow(galleryId: number) {
  return testPrisma.show.create({
    data: {
      title: 'Test Show',
      description: '테스트 전시입니다',
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      openingHours: '10:00-18:00',
      admissionFee: '무료',
      location: '서울시 종로구',
      region: 'SEOUL',
      posterImage: 'https://example.com/poster.jpg',
      artists: JSON.stringify(['작가1', '작가2']),
      status: 'APPROVED',
      galleryId,
    },
  });
}

// 승인된 공모 시드 (마감일: 30일 후)
export async function seedExhibition(galleryId: number) {
  return testPrisma.exhibition.create({
    data: {
      title: 'Test Exhibition',
      type: 'SOLO',
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      exhibitDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      capacity: 5,
      region: 'SEOUL',
      description: '테스트 공모입니다',
      status: 'APPROVED',
      galleryId,
    },
  });
}
