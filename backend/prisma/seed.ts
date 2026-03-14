import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 시드 데이터 생성 중...');

  // 기본 유저 생성
  const artist1 = await prisma.user.upsert({
    where: { email: 'artist1@artlink.com' },
    update: {},
    create: { email: 'artist1@artlink.com', name: 'Artist 1', role: 'ARTIST' }
  });

  const artist2 = await prisma.user.upsert({
    where: { email: 'artist2@artlink.com' },
    update: {},
    create: { email: 'artist2@artlink.com', name: 'Artist 2', role: 'ARTIST' }
  });

  const galleryUser = await prisma.user.upsert({
    where: { email: 'gallery@artlink.com' },
    update: {},
    create: { email: 'gallery@artlink.com', name: 'Gallery Owner', role: 'GALLERY' }
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@artlink.com' },
    update: {},
    create: { email: 'admin@artlink.com', name: 'Admin', role: 'ADMIN' }
  });

  // 샘플 갤러리 생성
  const gallery1 = await prisma.gallery.upsert({
    where: { id: 1 },
    update: { instagramUrl: '@seoul_modern_gallery', email: 'info@seoulmodern.com' },
    create: {
      name: '서울 현대 갤러리',
      address: '서울특별시 강남구 청담동 123-45',
      phone: '02-1234-5678',
      description: '현대 미술의 다양한 작품을 만나보세요.',
      detailDesc: '서울 현대 갤러리는 2010년에 설립된 현대 미술 전문 갤러리입니다. 국내외 유명 작가들의 작품을 전시하며, 신진 작가 발굴에도 힘쓰고 있습니다.',
      region: 'SEOUL',
      status: 'APPROVED',
      ownerName: '김갤러리',
      mainImage: 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800',
      instagramUrl: '@seoul_modern_gallery',
      email: 'info@seoulmodern.com',
      ownerId: galleryUser.id
    }
  });

  const gallery2 = await prisma.gallery.upsert({
    where: { id: 2 },
    update: { instagramUrl: '@busan_art_center', email: 'contact@busanart.kr' },
    create: {
      name: '부산 해운대 아트센터',
      address: '부산광역시 해운대구 해운대로 456',
      phone: '051-9876-5432',
      description: '바다가 보이는 아름다운 전시 공간입니다.',
      detailDesc: '부산 해운대 아트센터는 해변가에 위치한 복합 문화 공간으로, 회화, 조각, 설치 미술 등 다양한 장르의 전시를 진행합니다.',
      region: 'BUSAN',
      status: 'APPROVED',
      ownerName: '김갤러리',
      mainImage: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800',
      instagramUrl: '@busan_art_center',
      email: 'contact@busanart.kr',
      ownerId: galleryUser.id
    }
  });

  const gallery3 = await prisma.gallery.upsert({
    where: { id: 3 },
    update: {},
    create: {
      name: '대전 예술의 전당',
      address: '대전광역시 서구 둔산로 100',
      phone: '042-1111-2222',
      description: '클래식과 현대가 공존하는 예술 공간.',
      region: 'DAEJEON',
      status: 'APPROVED',
      ownerName: '박대표',
      mainImage: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800',
      ownerId: galleryUser.id
    }
  });

  // 샘플 전시/공모
  await prisma.exhibition.upsert({
    where: { id: 1 },
    update: {
      deadlineStart: new Date('2026-03-01'),
      exhibitStartDate: new Date('2026-05-01'),
      exhibitDate: new Date('2026-05-10'),
      customFields: JSON.stringify([
        { id: 'cf1', label: '작품 소개 및 컨셉 설명', type: 'textarea', required: true },
        { id: 'cf2', label: '참여 경험', type: 'select', required: true, options: ['없음', '1~3회', '4회 이상'] },
        { id: 'cf3', label: '포트폴리오 파일 (PDF)', type: 'file', required: false },
      ]),
    },
    create: {
      title: 'Seoul International Art Fair 2026',
      type: 'ART_FAIR',
      deadlineStart: new Date('2026-03-01'),
      deadline: new Date('2026-04-15'),
      exhibitStartDate: new Date('2026-05-01'),
      exhibitDate: new Date('2026-05-10'),
      capacity: 50,
      region: 'SEOUL',
      description: '서울 국제 아트페어에 참여할 아티스트를 모집합니다.',
      customFields: JSON.stringify([
        { id: 'cf1', label: '작품 소개 및 컨셉 설명', type: 'textarea', required: true },
        { id: 'cf2', label: '참여 경험', type: 'select', required: true, options: ['없음', '1~3회', '4회 이상'] },
        { id: 'cf3', label: '포트폴리오 파일 (PDF)', type: 'file', required: false },
      ]),
      status: 'APPROVED',
      galleryId: gallery1.id
    }
  });

  await prisma.exhibition.upsert({
    where: { id: 2 },
    update: {
      deadlineStart: new Date('2026-03-01'),
      exhibitStartDate: new Date('2026-04-15'),
      exhibitDate: new Date('2026-04-20'),
      customFields: null,
    },
    create: {
      title: '신진 작가 개인전 모집',
      type: 'SOLO',
      deadlineStart: new Date('2026-03-01'),
      deadline: new Date('2026-03-30'),
      exhibitStartDate: new Date('2026-04-15'),
      exhibitDate: new Date('2026-04-20'),
      capacity: 5,
      region: 'BUSAN',
      description: '부산 해운대 아트센터에서 개인전을 열 신진 작가를 모집합니다.',
      status: 'APPROVED',
      galleryId: gallery2.id
    }
  });

  // 히어로 슬라이드
  await prisma.heroSlide.upsert({
    where: { id: 1 },
    update: {},
    create: {
      title: 'Seoul International Art Fair 2026',
      description: 'Discover emerging artists and connect with premier galleries',
      imageUrl: 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=1200',
      linkUrl: '/exhibitions',
      order: 0
    }
  });

  await prisma.heroSlide.upsert({
    where: { id: 2 },
    update: {},
    create: {
      title: '신진 작가 발굴 프로젝트',
      description: '새로운 예술의 시작, ArtLink와 함께하세요',
      imageUrl: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=1200',
      linkUrl: '/galleries',
      order: 1
    }
  });

  await prisma.heroSlide.upsert({
    where: { id: 3 },
    update: {},
    create: {
      title: '이달의 갤러리 특별전',
      description: '엄선된 갤러리의 특별한 전시를 만나보세요',
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=1200',
      order: 2
    }
  });

  // 이달의 갤러리
  await prisma.galleryOfMonth.upsert({
    where: { id: 1 },
    update: {},
    create: {
      galleryId: gallery1.id,
      expiresAt: new Date('2026-03-31')
    }
  });

  await prisma.galleryOfMonth.upsert({
    where: { id: 2 },
    update: {},
    create: {
      galleryId: gallery2.id,
      expiresAt: new Date('2026-03-31')
    }
  });

  // 샘플 혜택
  await prisma.benefit.upsert({
    where: { id: 1 },
    update: {},
    create: {
      title: '신규 가입 아티스트 전시 수수료 50% 할인',
      description: '2026년 상반기 신규 가입 아티스트에게 첫 전시 참여 시 수수료를 50% 할인해 드립니다.',
      imageUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800'
    }
  });

  await prisma.benefit.upsert({
    where: { id: 2 },
    update: {},
    create: {
      title: '갤러리 파트너십 프로그램',
      description: 'ArtLink 파트너 갤러리가 되시면 홍보 지원과 함께 우선 매칭 서비스를 제공합니다.',
      imageUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800'
    }
  });

  // 샘플 리뷰
  await prisma.review.upsert({
    where: { id: 1 },
    update: {},
    create: {
      userId: artist1.id,
      galleryId: gallery1.id,
      rating: 5,
      content: '정말 멋진 갤러리입니다. 작품 배치도 훌륭하고 직원분들도 친절해요.',
      anonymous: false
    }
  });

  await prisma.review.upsert({
    where: { id: 2 },
    update: {},
    create: {
      userId: artist2.id,
      galleryId: gallery1.id,
      rating: 4,
      content: '전시 공간이 넓고 조명이 좋습니다.',
      anonymous: true
    }
  });

  // Artist 1 포트폴리오
  await prisma.portfolio.upsert({
    where: { userId: artist1.id },
    update: {},
    create: {
      userId: artist1.id,
      biography: '서울대학교 미술대학 졸업. 현대 추상화를 주로 작업합니다.',
      exhibitionHistory: '2024 서울 아트페어 참가\n2025 갤러리H 개인전'
    }
  });

  // 샘플 전시(Show) — 진행중 1건, 예정 1건
  await prisma.show.upsert({
    where: { id: 1 },
    update: {
      title: '현대 추상미술의 새로운 흐름',
      description: '국내외 현대 추상미술 작가 3인의 작품을 한자리에서 만나보실 수 있습니다.',
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-04-15'),
      openingHours: '10:00-18:00',
      admissionFee: '무료',
      location: '서울특별시 강남구 청담동 123-45',
      region: 'SEOUL',
      posterImage: 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800',
      artists: JSON.stringify([{name: '김작가'}, {name: 'Artist 1', userId: artist1.id}, {name: '박작가'}]),
      status: 'APPROVED',
      galleryId: gallery1.id,
    },
    create: {
      title: '현대 추상미술의 새로운 흐름',
      description: '국내외 현대 추상미술 작가 3인의 작품을 한자리에서 만나보실 수 있습니다.',
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-04-15'),
      openingHours: '10:00-18:00',
      admissionFee: '무료',
      location: '서울특별시 강남구 청담동 123-45',
      region: 'SEOUL',
      posterImage: 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800',
      artists: JSON.stringify([{name: '김작가'}, {name: 'Artist 1', userId: artist1.id}, {name: '박작가'}]),
      status: 'APPROVED',
      galleryId: gallery1.id,
    },
  });

  await prisma.show.upsert({
    where: { id: 2 },
    update: {
      title: '바다와 예술: 해운대 특별전',
      description: '해운대의 아름다운 풍경을 담은 작품들을 전시합니다.',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-06-30'),
      openingHours: '11:00-19:00',
      admissionFee: '5,000원',
      location: '부산광역시 해운대구 해운대로 456',
      region: 'BUSAN',
      posterImage: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800',
      artists: JSON.stringify([{name: '최작가'}, {name: '정작가'}]),
      status: 'APPROVED',
      galleryId: gallery2.id,
    },
    create: {
      title: '바다와 예술: 해운대 특별전',
      description: '해운대의 아름다운 풍경을 담은 작품들을 전시합니다.',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-06-30'),
      openingHours: '11:00-19:00',
      admissionFee: '5,000원',
      location: '부산광역시 해운대구 해운대로 456',
      region: 'BUSAN',
      posterImage: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800',
      artists: JSON.stringify([{name: '최작가'}, {name: '정작가'}]),
      status: 'APPROVED',
      galleryId: gallery2.id,
    },
  });

  // 리뷰 기반 갤러리 rating 재계산
  const allGalleries = await prisma.gallery.findMany({ select: { id: true } });
  for (const g of allGalleries) {
    const agg = await prisma.review.aggregate({
      where: { galleryId: g.id },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await prisma.gallery.update({
      where: { id: g.id },
      data: {
        rating: agg._avg.rating || 0,
        reviewCount: agg._count.rating,
      },
    });
  }

  console.log('✅ 시드 데이터 생성 완료!');
  console.log(`  - 유저: ${artist1.name}, ${artist2.name}, ${galleryUser.name}, ${admin.name}`);
  console.log(`  - 갤러리: ${gallery1.name}, ${gallery2.name}, ${gallery3.name}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
