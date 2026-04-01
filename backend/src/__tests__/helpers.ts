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
  'Inquiry', 'Notification', 'Application', 'ApprovalRequest', 'Favorite', 'Review', 'PromoPhoto',
  'PortfolioImage', 'Portfolio', 'GalleryOfMonth', 'ShowImage', 'Show', 'Exhibition',
  'GalleryImage', 'Gallery', 'HeroSlide', 'Benefit', 'User',
];

// DB 전체 정리 — interactive transaction (단일 커넥션, deadlock 불가)
export async function cleanDb() {
  await testPrisma.$transaction(async (tx) => {
    await tx.inquiry.deleteMany();
    await tx.notification.deleteMany();
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
