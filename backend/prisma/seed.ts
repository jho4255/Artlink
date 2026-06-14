import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 비즈니스 키 기반 upsert 헬퍼
// 기존 id 기반 upsert는 레코드 삭제 후 재배포 시 매번 중복 생성됨
// (PostgreSQL auto-increment는 삭제된 id를 재사용하지 않으므로)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function upsertByKey(
  model: any,
  findWhere: Record<string, any>,
  updateData: Record<string, any>,
  createData: Record<string, any>,
) {
  const existing = await model.findFirst({ where: findWhere });
  if (existing) {
    return model.update({ where: { id: existing.id }, data: updateData });
  }
  return model.create({ data: createData });
}

/**
 * 중복 레코드 정리 — 같은 비즈니스 키를 가진 레코드 중 가장 오래된(id 최소) 것만 유지
 * Gallery는 onDelete: Cascade로 Exhibition, Show, Review, Favorite 등 연쇄 삭제
 */
async function cleanupDuplicates(
  model: any,
  keyFn: (item: any) => string,
  label: string,
) {
  const items = await model.findMany({ orderBy: { id: 'asc' } });
  const seen = new Map<string, number>();
  const toDelete: number[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) toDelete.push(item.id);
    else seen.set(key, item.id);
  }
  if (toDelete.length > 0) {
    await model.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`🧹 중복 ${label} ${toDelete.length}개 정리됨`);
  }
}

async function main() {
  // 운영 환경에서는 데모 시드(테스트 계정/갤러리 등) 생성 안 함 — 실데이터만 유지
  if (process.env.NODE_ENV === 'production') {
    console.log('⏭️  운영 환경 — 데모 시드 데이터 생성을 건너뜁니다.');
    return;
  }
  console.log('🌱 시드 데이터 생성 중...');

  // ━━━ 중복 정리 (이전 id 기반 upsert 버그로 인한 중복) ━━━
  await cleanupDuplicates(
    prisma.gallery,
    (g) => `${g.name}::${g.ownerId}`,
    '갤러리',
  );

  // ━━━ 유저 (email @unique → Prisma upsert 안전) ━━━
  const artist1 = await prisma.user.upsert({
    where: { email: 'artist1@artlink.com' },
    update: { provider: 'LOCAL' },
    create: { email: 'artist1@artlink.com', name: 'Artist 1', role: 'ARTIST', provider: 'LOCAL' },
  });

  const artist2 = await prisma.user.upsert({
    where: { email: 'artist2@artlink.com' },
    update: { provider: 'LOCAL' },
    create: { email: 'artist2@artlink.com', name: 'Artist 2', role: 'ARTIST', provider: 'LOCAL' },
  });

  const galleryUser = await prisma.user.upsert({
    where: { email: 'gallery@artlink.com' },
    update: { provider: 'LOCAL' },
    create: { email: 'gallery@artlink.com', name: 'Gallery Owner', role: 'GALLERY', provider: 'LOCAL' },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@artlink.com' },
    update: { provider: 'LOCAL' },
    create: { email: 'admin@artlink.com', name: 'Admin', role: 'ADMIN', provider: 'LOCAL' },
  });

  // ━━━ 갤러리 (비즈니스 키: name + ownerId) ━━━
  const gallery1 = await upsertByKey(
    prisma.gallery,
    { name: '서울 현대 갤러리', ownerId: galleryUser.id },
    {
      mainImage: '/images/gallery-sculpture.webp',
      instagramUrl: '@seoul_modern_gallery',
      instagramProfileVisible: true,
      email: 'info@seoulmodern.com',
      status: 'APPROVED',
    },
    {
      name: '서울 현대 갤러리',
      address: '서울특별시 강남구 청담동 123-45',
      phone: '02-1234-5678',
      description: '현대 미술의 다양한 작품을 만나보세요.',
      detailDesc: '서울 현대 갤러리는 2010년에 설립된 현대 미술 전문 갤러리입니다. 국내외 유명 작가들의 작품을 전시하며, 신진 작가 발굴에도 힘쓰고 있습니다.',
      region: 'SEOUL',
      status: 'APPROVED',
      ownerName: '김갤러리',
      mainImage: '/images/gallery-sculpture.webp',
      instagramUrl: '@seoul_modern_gallery',
      instagramProfileVisible: true,
      email: 'info@seoulmodern.com',
      ownerId: galleryUser.id,
    },
  );

  const gallery2 = await upsertByKey(
    prisma.gallery,
    { name: '부산 해운대 아트센터', ownerId: galleryUser.id },
    {
      mainImage: '/images/gallery-painting.webp',
      instagramUrl: '@busan_art_center',
      instagramProfileVisible: true,
      email: 'contact@busanart.kr',
      status: 'APPROVED',
    },
    {
      name: '부산 해운대 아트센터',
      address: '부산광역시 해운대구 해운대로 456',
      phone: '051-9876-5432',
      description: '바다가 보이는 아름다운 전시 공간입니다.',
      detailDesc: '부산 해운대 아트센터는 해변가에 위치한 복합 문화 공간으로, 회화, 조각, 설치 미술 등 다양한 장르의 전시를 진행합니다.',
      region: 'BUSAN',
      status: 'APPROVED',
      ownerName: '김갤러리',
      mainImage: '/images/gallery-painting.webp',
      instagramUrl: '@busan_art_center',
      instagramProfileVisible: true,
      email: 'contact@busanart.kr',
      ownerId: galleryUser.id,
    },
  );

  const gallery3 = await upsertByKey(
    prisma.gallery,
    { name: '대전 예술의 전당', ownerId: galleryUser.id },
    { mainImage: '/images/hero-artfair.jpg', status: 'APPROVED' },
    {
      name: '대전 예술의 전당',
      address: '대전광역시 서구 둔산로 100',
      phone: '042-1111-2222',
      description: '클래식과 현대가 공존하는 예술 공간.',
      region: 'DAEJEON',
      status: 'APPROVED',
      ownerName: '박대표',
      mainImage: '/images/hero-artfair.jpg',
      ownerId: galleryUser.id,
    },
  );

  // ━━━ 공모 (비즈니스 키: title + galleryId) ━━━
  const customFields1 = JSON.stringify([
    { id: 'cf1', label: '작품 소개 및 컨셉 설명', type: 'textarea', required: true },
    { id: 'cf2', label: '참여 경험', type: 'select', required: true, options: ['없음', '1~3회', '4회 이상'] },
    { id: 'cf3', label: '포트폴리오 파일 (PDF)', type: 'file', required: false },
  ]);

  await upsertByKey(
    prisma.exhibition,
    { title: 'Seoul International Art Fair 2026', galleryId: gallery1.id },
    {
      deadlineStart: new Date('2026-03-01'),
      deadline: new Date('2026-06-30'),
      exhibitStartDate: new Date('2026-07-01'),
      exhibitDate: new Date('2026-07-10'),
      customFields: customFields1,
      status: 'APPROVED',
    },
    {
      title: 'Seoul International Art Fair 2026',
      type: 'ART_FAIR',
      deadlineStart: new Date('2026-03-01'),
      deadline: new Date('2026-06-30'),
      exhibitStartDate: new Date('2026-07-01'),
      exhibitDate: new Date('2026-07-10'),
      capacity: 50,
      region: 'SEOUL',
      description: '서울 국제 아트페어에 참여할 아티스트를 모집합니다.',
      customFields: customFields1,
      status: 'APPROVED',
      galleryId: gallery1.id,
    },
  );

  await upsertByKey(
    prisma.exhibition,
    { title: '신진 작가 개인전 모집', galleryId: gallery2.id },
    {
      deadlineStart: new Date('2026-03-01'),
      deadline: new Date('2026-06-15'),
      exhibitStartDate: new Date('2026-07-01'),
      exhibitDate: new Date('2026-07-05'),
      customFields: null,
      status: 'APPROVED',
    },
    {
      title: '신진 작가 개인전 모집',
      type: 'SOLO',
      deadlineStart: new Date('2026-03-01'),
      deadline: new Date('2026-06-15'),
      exhibitStartDate: new Date('2026-07-01'),
      exhibitDate: new Date('2026-07-05'),
      capacity: 5,
      region: 'BUSAN',
      description: '부산 해운대 아트센터에서 개인전을 열 신진 작가를 모집합니다.',
      status: 'APPROVED',
      galleryId: gallery2.id,
    },
  );

  // ━━━ 히어로 슬라이드 (비즈니스 키: title) ━━━
  await upsertByKey(
    prisma.heroSlide,
    { title: 'Seoul International Art Fair 2026' },
    { order: 0, imageUrl: '/images/hero-artfair.jpg' },
    {
      title: 'Seoul International Art Fair 2026',
      description: 'Discover emerging artists and connect with premier galleries',
      imageUrl: '/images/hero-artfair.jpg',
      linkUrl: '/exhibitions',
      order: 0,
    },
  );

  await upsertByKey(
    prisma.heroSlide,
    { title: '신진 작가 발굴 프로젝트' },
    { order: 1, imageUrl: '/images/gallery-sculpture.webp' },
    {
      title: '신진 작가 발굴 프로젝트',
      description: '새로운 예술의 시작, ArtLink와 함께하세요',
      imageUrl: '/images/gallery-sculpture.webp',
      linkUrl: '/galleries',
      order: 1,
    },
  );

  await upsertByKey(
    prisma.heroSlide,
    { title: '이달의 갤러리 특별전' },
    { order: 2, imageUrl: '/images/gallery-painting.webp' },
    {
      title: '이달의 갤러리 특별전',
      description: '엄선된 갤러리의 특별한 전시를 만나보세요',
      imageUrl: '/images/gallery-painting.webp',
      order: 2,
    },
  );

  // ━━━ 이달의 갤러리 (galleryId @unique → Prisma upsert 안전) ━━━
  await prisma.galleryOfMonth.upsert({
    where: { galleryId: gallery1.id },
    update: { expiresAt: new Date('2026-03-31') },
    create: { galleryId: gallery1.id, expiresAt: new Date('2026-03-31') },
  });

  await prisma.galleryOfMonth.upsert({
    where: { galleryId: gallery2.id },
    update: { expiresAt: new Date('2026-03-31') },
    create: { galleryId: gallery2.id, expiresAt: new Date('2026-03-31') },
  });

  // ━━━ 혜택 (비즈니스 키: title) ━━━
  await upsertByKey(
    prisma.benefit,
    { title: '신규 가입 아티스트 전시 수수료 50% 할인' },
    {},
    {
      title: '신규 가입 아티스트 전시 수수료 50% 할인',
      description: '2026년 상반기 신규 가입 아티스트에게 첫 전시 참여 시 수수료를 50% 할인해 드립니다.',
      imageUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800',
    },
  );

  await upsertByKey(
    prisma.benefit,
    { title: '갤러리 파트너십 프로그램' },
    {},
    {
      title: '갤러리 파트너십 프로그램',
      description: 'ArtLink 파트너 갤러리가 되시면 홍보 지원과 함께 우선 매칭 서비스를 제공합니다.',
      imageUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800',
    },
  );

  // ━━━ 리뷰 (비즈니스 키: userId + galleryId) ━━━
  await upsertByKey(
    prisma.review,
    { userId: artist1.id, galleryId: gallery1.id },
    {},
    {
      userId: artist1.id,
      galleryId: gallery1.id,
      rating: 5,
      content: '정말 멋진 갤러리입니다. 작품 배치도 훌륭하고 직원분들도 친절해요.',
      anonymous: false,
    },
  );

  await upsertByKey(
    prisma.review,
    { userId: artist2.id, galleryId: gallery1.id },
    {},
    {
      userId: artist2.id,
      galleryId: gallery1.id,
      rating: 4,
      content: '전시 공간이 넓고 조명이 좋습니다.',
      anonymous: true,
    },
  );

  // ━━━ 포트폴리오 (userId @unique → Prisma upsert 안전) ━━━
  const artist1Career = JSON.stringify({
    artFair: [{ year: '2024', content: '서울 아트페어 참가' }],
    solo: [{ year: '2025', content: '갤러리H 개인전 (서울)' }],
    group: [{ year: '2023', content: '청년 작가 단체전 (부산)' }],
  });
  await prisma.portfolio.upsert({
    where: { userId: artist1.id },
    // ⚠️ 스키마 신규 필드는 update 블록에도 반드시 포함 (기존 레코드는 update 경로를 탐)
    update: {
      biography: '서울대학교 미술대학 졸업. 현대 추상화를 주로 작업합니다.',
      career: artist1Career,
    },
    create: {
      userId: artist1.id,
      biography: '서울대학교 미술대학 졸업. 현대 추상화를 주로 작업합니다.',
      exhibitionHistory: '2024 서울 아트페어 참가\n2025 갤러리H 개인전',
      career: artist1Career,
    },
  });

  // ━━━ 전시 Show (비즈니스 키: title + galleryId) ━━━
  const showArtists1 = JSON.stringify([
    { name: '김작가' },
    { name: 'Artist 1', userId: artist1.id },
    { name: '박작가' },
  ]);
  const showFields1 = {
    title: '현대 추상미술의 새로운 흐름',
    description: '국내외 현대 추상미술 작가 3인의 작품을 한자리에서 만나보실 수 있습니다.',
    startDate: new Date('2026-03-01'),
    endDate: new Date('2026-04-15'),
    openingHours: '10:00-18:00',
    admissionFee: '무료',
    location: '서울특별시 강남구 청담동 123-45',
    region: 'SEOUL',
    posterImage: 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800',
    artists: showArtists1,
    status: 'APPROVED',
  };

  await upsertByKey(
    prisma.show,
    { title: '현대 추상미술의 새로운 흐름', galleryId: gallery1.id },
    showFields1,
    { ...showFields1, galleryId: gallery1.id },
  );

  const showArtists2 = JSON.stringify([
    { name: '최작가' },
    { name: '정작가' },
  ]);
  const showFields2 = {
    title: '바다와 예술: 해운대 특별전',
    description: '해운대의 아름다운 풍경을 담은 작품들을 전시합니다.',
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-06-30'),
    openingHours: '11:00-19:00',
    admissionFee: '5,000원',
    location: '부산광역시 해운대구 해운대로 456',
    region: 'BUSAN',
    posterImage: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800',
    artists: showArtists2,
    status: 'APPROVED',
  };

  await upsertByKey(
    prisma.show,
    { title: '바다와 예술: 해운대 특별전', galleryId: gallery2.id },
    showFields2,
    { ...showFields2, galleryId: gallery2.id },
  );

  // ━━━ 갤러리 rating 재계산 ━━━
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

  // ━━━ FAQ ━━━
  const faqData = [
    {
      order: 0,
      question: 'ArtLink는 어떤 서비스인가요?',
      answer: 'ArtLink는 갤러리와 아티스트를 연결하는 매칭 플랫폼입니다.\n갤러리는 공모전·전시를 등록하고 아티스트를 모집할 수 있으며, 아티스트는 포트폴리오를 등록하고 원하는 공모에 직접 지원할 수 있습니다.',
    },
    {
      order: 1,
      question: '회원가입은 어떻게 하나요?',
      answer: '카카오 계정으로 간편하게 가입할 수 있습니다.\n로그인 페이지에서 "카카오로 시작하기"를 클릭한 후, 역할(아티스트 또는 갤러리)과 연락처를 입력하면 가입이 완료됩니다.',
    },
    {
      order: 2,
      question: '아티스트와 갤러리 계정의 차이가 무엇인가요?',
      answer: '아티스트 계정은 포트폴리오 등록, 공모 지원, 갤러리 리뷰 작성, 찜하기 기능을 사용할 수 있습니다.\n갤러리 계정은 갤러리 등록, 공모·전시 등록, 지원자 관리, Instagram 피드 연동 기능을 사용할 수 있습니다.',
    },
    {
      order: 3,
      question: '포트폴리오는 어떻게 등록하나요?',
      answer: '로그인 후 마이페이지 > 포트폴리오 섹션에서 등록할 수 있습니다.\n작가 약력, 전시 이력(개인전·단체전·아트페어), 작품 사진(최대 30장)을 입력하면 됩니다.\n등록된 포트폴리오는 공모 지원 시 갤러리 담당자에게 자동으로 전달됩니다.',
    },
    {
      order: 4,
      question: '공모에 지원하면 어떻게 되나요?',
      answer: '공모 상세 페이지에서 "지원하기" 버튼을 클릭하면 갤러리 담당자에게 포트폴리오가 전달됩니다.\n지원 후 상태는 마이페이지 > 지원 내역에서 확인할 수 있으며, 접수 → 검토중 → 수락/거절 순서로 변경됩니다.\n갤러리에서 상태를 변경하면 알림이 발송됩니다.',
    },
    {
      order: 5,
      question: '지원한 공모의 결과는 어디서 확인하나요?',
      answer: '마이페이지 > 지원 내역 탭에서 확인할 수 있습니다.\n전체/접수/검토중/수락/거절 탭으로 필터링할 수 있으며, 각 카드를 클릭하면 내가 제출한 답변 내용도 확인할 수 있습니다.',
    },
    {
      order: 6,
      question: '갤러리 등록은 어떻게 하나요?',
      answer: '갤러리 계정으로 로그인 후 마이페이지 > 갤러리 등록에서 신청할 수 있습니다.\n갤러리명, 주소, 소개, 대표자명, 전화번호, 대표 이미지, 지역을 입력하고 승인 요청을 하면 운영팀 검토 후 승인됩니다.\n승인 완료 후 갤러리 찾기 페이지에 노출됩니다.',
    },
    {
      order: 7,
      question: '공모 등록 시 승인이 필요한가요?',
      answer: '네, 갤러리와 공모 모두 운영팀의 승인 후 플랫폼에 노출됩니다.\n승인까지 보통 1~3 영업일이 소요되며, 거절 시 사유를 확인하고 마이페이지에서 재등록할 수 있습니다.',
    },
    {
      order: 8,
      question: '승인된 갤러리 정보를 수정하고 싶어요.',
      answer: '승인 후에는 갤러리 소개(상세 설명) 수정만 직접 가능합니다.\n갤러리명, 주소 등 기본 정보 수정이 필요한 경우 마이페이지에서 수정 요청을 통해 운영팀에 문의해 주세요.',
    },
    {
      order: 9,
      question: 'Instagram 피드를 갤러리 페이지에 연동할 수 있나요?',
      answer: '네, 갤러리 계정의 마이페이지에서 Instagram 연동 기능을 사용할 수 있습니다.\nInstagram OAuth를 통해 연동하면 갤러리 상세 페이지에 최신 게시물이 자동으로 표시됩니다.\nInstagram 비즈니스 또는 크리에이터 계정이 필요합니다.',
    },
    {
      order: 10,
      question: '찜한 갤러리와 공모는 어디서 확인하나요?',
      answer: '마이페이지 > 찜 목록 탭에서 확인할 수 있습니다.\n갤러리와 공모가 구분되어 표시되며, 찜 취소 시 목록에서 즉시 제거됩니다.',
    },
    {
      order: 11,
      question: '갤러리 리뷰는 누가 작성할 수 있나요?',
      answer: '아티스트 계정으로 로그인한 경우 갤러리 상세 페이지에서 리뷰를 작성할 수 있습니다.\n별점과 텍스트를 입력할 수 있으며, 익명으로 작성하면 "익명의 예술가"로 표시됩니다.\n본인이 작성한 리뷰는 마이페이지 > 활동 내역에서 수정·삭제할 수 있습니다.',
    },
    {
      order: 12,
      question: '알림은 어떤 경우에 오나요?',
      answer: '다음과 같은 경우에 알림이 발송됩니다.\n· 갤러리/공모 승인 또는 거절 시\n· 지원한 공모의 상태 변경 시 (검토중·수락·거절)\n· 1:1 쪽지 수신 시\n알림은 상단 네비게이션의 벨 아이콘에서 확인할 수 있습니다.',
    },
    {
      order: 13,
      question: '갤러리에 직접 메시지를 보낼 수 있나요?',
      answer: '네, 갤러리 상세 페이지 또는 공모 상세 페이지에서 쪽지 보내기 기능을 사용할 수 있습니다.\n마이페이지 > 쪽지함에서 주고받은 메시지를 확인할 수 있습니다.',
    },
    {
      order: 14,
      question: '지원자 목록을 엑셀로 다운로드할 수 있나요?',
      answer: '네, 갤러리 계정의 마이페이지 > 공모 관리에서 지원자 목록을 CSV 파일로 다운로드할 수 있습니다.\n이름, 이메일, 지원일, 상태, 커스텀 답변 내용이 포함됩니다.',
    },
    {
      order: 15,
      question: '공모에 추가 질문 항목을 설정할 수 있나요?',
      answer: '네, 공모 등록 시 지원자에게 추가로 받을 정보를 직접 설정할 수 있습니다.\n텍스트 입력, 단일/복수 선택형, 파일 업로드 등 다양한 형식의 항목을 추가할 수 있습니다.',
    },
    {
      order: 16,
      question: '혜택 페이지에는 어떤 내용이 있나요?',
      answer: 'ArtLink와 제휴한 미술 관련 서비스·브랜드의 특별 혜택 정보를 제공합니다.\n재료 할인, 작업실 대여, 프린팅 서비스 등 아티스트 활동에 도움이 되는 다양한 혜택을 확인해 보세요.',
    },
    {
      order: 17,
      question: '문의는 어떻게 하나요?',
      answer: '고객센터 페이지의 1:1 문의 탭에서 문의를 남기실 수 있습니다.\n로그인 후 제목과 내용을 입력하면 운영팀이 검토 후 답변을 등록해 드립니다.\n긴급한 문의는 하단 연락처로 직접 연락해 주세요.',
    },
  ];

  // 기존 FAQ 없을 때만 삽입 (중복 방지)
  const existingFaqCount = await prisma.faq.count();
  if (existingFaqCount === 0) {
    await prisma.faq.createMany({ data: faqData });
    console.log(`  - FAQ: ${faqData.length}개 등록`);
  }

  console.log('✅ 시드 데이터 생성 완료!');
  console.log(`  - 유저: ${artist1.name}, ${artist2.name}, ${galleryUser.name}, ${admin.name}`);
  console.log(`  - 갤러리: ${gallery1.name}, ${gallery2.name}, ${gallery3.name}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
