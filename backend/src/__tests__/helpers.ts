/**
 * 테스트 헬퍼 — supertest 요청, DB 정리, 시드 데이터 유틸리티
 */
import supertest from 'supertest';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import app from '../index';

// 테스트 전용 Prisma 클라이언트 (테스트 DB 연결)
export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// supertest 요청 객체
export const request = supertest(app);

// JWT 토큰 생성 (테스트 인증용)
export function authToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

// DB 전체 정리 — TRUNCATE CASCADE로 FK 순서 무관하게 안전 삭제
export async function cleanDb() {
  const tableNames = [
    'Application', 'ApprovalRequest', 'Favorite', 'Review', 'PromoPhoto',
    'PortfolioImage', 'Portfolio', 'GalleryOfMonth', 'Exhibition',
    'GalleryImage', 'Gallery', 'HeroSlide', 'Benefit', 'User',
  ];
  // PostgreSQL TRUNCATE CASCADE — FK 의존성 자동 처리
  for (const table of tableNames) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
  // 시퀀스 리셋 (autoincrement ID 초기화)
  for (const table of tableNames) {
    await testPrisma.$executeRawUnsafe(
      `ALTER SEQUENCE IF EXISTS "${table}_id_seq" RESTART WITH 1`
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
  // 순차 생성 (ID 순서 보장)
  for (const u of users) {
    await testPrisma.user.create({ data: u });
  }
  // autoincrement 시퀀스를 5 이상으로 설정 (다음 create 시 충돌 방지)
  await testPrisma.$executeRawUnsafe(`ALTER SEQUENCE "User_id_seq" RESTART WITH 100`);
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
