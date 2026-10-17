/**
 * 비회원 소개 팝업(규칙 73) 그림을 찍을 **샘플 작가** — 로컬 데모 DB 전용.
 *   npx tsx scripts/seed-intro-sample.ts          만들기(다시 돌리면 같은 상태로 덮는다)
 *   npx tsx scripts/seed-intro-sample.ts --clean  지우기
 *
 * 그림은 `frontend/public/demo-art/` 의 절차적 생성 그림이고 이름·글·경력은 **지어낸 것**이다.
 * 샘플 갤러리 '아트링크 갤러리'(/@artlink.gallery)와 그 전시 '윤서진 개인전 《빛의 결》'도 만든다 — 갤러리 대표 사진·전시 포스터는
 * `scratchpad/guest-intro/sample-media.mjs` 가 로컬 업로드 폴더(`backend/uploads/intro-sample/`, git 제외)에 먼저 만들어 둔다.
 * ⚠️ 경력에 실존 학교·미술관·공모전 이름을 쓰지 말 것 — 이 화면을 찍어 공개 팝업에 싣는다(지어낸 수상 기록이 실존 기관 이름으로 나간다).
 * 찍는 법은 `scratchpad/guest-intro/capture.mjs`.
 */
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') { console.error('로컬 전용입니다.'); process.exit(1); }
const prisma = new PrismaClient();

export const SAMPLE_EMAIL = 'intro-sample@artlink.test';
const GALLERY_EMAIL = 'intro-gallery@artlink.test';
const ART_DIR = path.resolve(__dirname, '../../frontend/public/demo-art');

// [파일, 제목, 연도, 크기(세로×가로)] — 크기는 그림 파일 비율과 맞춘다(규칙 54)
const WORKS: [string, string, string, string][] = [
  ['long-summer', '긴 여름', '2025', '130.3 × 162.2 cm'],
  ['blue-wall', '푸른 벽', '2025', '162.2 × 130.3 cm'],
  ['red-hill', '붉은 언덕', '2024', '68.2 × 90.9 cm'],
  ['quiet-afternoon', '고요한 오후', '2024', '60.6 × 80.3 cm'],
  ['square-garden', '네모난 정원', '2024', '100 × 100 cm'],
  ['dawn-window', '새벽의 창', '2023', '90.9 × 72.7 cm'],
  ['water-memory', '물의 기억', '2023', '96.9 × 72.7 cm'],
  ['city-walk', '도시 산책', '2023', '100 × 125 cm'],
  ['forgotten-alley', '잊힌 골목', '2022', '79.7 × 60.6 cm'],
];

async function clean() {
  const g = await prisma.user.findUnique({ where: { email: GALLERY_EMAIL } });
  if (g) {
    await prisma.gallery.deleteMany({ where: { ownerId: g.id } });   // 전시·사진은 함께 지워진다(cascade)
    await prisma.user.delete({ where: { id: g.id } }).catch(() => prisma.user.update({ where: { id: g.id }, data: { deletedAt: new Date() } }));
    console.log('샘플 갤러리 지움', g.id);
  }
  const u = await prisma.user.findUnique({ where: { email: SAMPLE_EMAIL } });
  if (!u) return console.log('샘플 작가 없음');
  await prisma.portfolio.deleteMany({ where: { userId: u.id } });
  await prisma.user.delete({ where: { id: u.id } }).catch(async () => {
    // 지원 기록 등이 남아 있으면 지우지 못한다 — 그때는 탈퇴로 둔다
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date(), handle: null, nickname: null } });
  });
  console.log('샘플 작가 지움', u.id);
}

async function main() {
  if (process.argv.includes('--clean')) return clean();

  const user = await prisma.user.upsert({
    where: { email: SAMPLE_EMAIL },
    create: { email: SAMPLE_EMAIL, name: '윤서진', nickname: '윤서진', handle: 'seojin.yoon', role: 'ARTIST', termsAgreedAt: new Date(), privacyAgreedAt: new Date() },
    update: { name: '윤서진', nickname: '윤서진', handle: 'seojin.yoon', role: 'ARTIST', deletedAt: null },
  });
  const pf = await prisma.portfolio.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  await prisma.portfolioImage.deleteMany({ where: { portfolioId: pf.id } });

  for (const [i, [file, title, year, size]] of WORKS.entries()) {
    const meta = await sharp(path.join(ART_DIR, `${file}.jpg`)).metadata();
    await prisma.portfolioImage.create({
      data: {
        portfolioId: pf.id, url: `/demo-art/${file}.jpg`, order: i, width: meta.width, height: meta.height,
        title, year, medium: '캔버스에 유채', sizeText: size, status: 'AVAILABLE',
        series: i < 5 ? '빛의 결' : '기억의 정원',
        // 작가 탭에 내보내지 않는다 — 로컬 데모 DB 의 [작가] 탭 작품 격자를 어지럽히지 않게(홈페이지에는 다 보인다)
        showInExplore: false,
      },
    });
  }

  await prisma.portfolio.update({
    where: { id: pf.id },
    data: {
      tagline: '빛과 기억의 층위를 그리는 화가',
      statement: '나의 작업은 하루의 빛이 지나간 자리에 남는 감정을 붙잡는 일이다.\n\n같은 풍경을 여러 번 덧칠하며 시간이 쌓이는 방식을 화면에 옮긴다. 겹쳐진 색층은 한 번에 읽히지 않고, 오래 볼수록 아래의 색이 천천히 떠오른다.',
      biography: '서울에서 활동하는 화가. 일상의 풍경에서 출발해 빛과 기억이 겹쳐지는 순간을 회화로 옮긴다. 최근에는 같은 장소를 계절마다 다시 그리는 연작 《빛의 결》에 집중하고 있다.',
      career: JSON.stringify({
        education: [{ year: '2018', content: '회화과 졸업' }],
        solo: [{ year: '2025', content: '개인전 《빛의 결》, 서울' }, { year: '2023', content: '개인전 《기억의 정원》, 서울' }],
        group: [{ year: '2024', content: '단체전 《오늘의 풍경》, 서울' }, { year: '2022', content: '단체전 《새로운 시선》, 부산' }],
        artFair: [],
        award: [],
      }),
      seriesInfo: JSON.stringify([
        { name: '빛의 결', note: '같은 장소를 계절마다 다시 그리는 연작.' },
        { name: '기억의 정원', note: '오래된 기억 속 풍경을 색층으로 쌓아 올린 연작.' },
      ]),
    },
  });
  console.log(`샘플 작가 ${user.id} · /@seojin.yoon · 작품 ${WORKS.length}점`);

  // 샘플 갤러리 + 진행 중인 전시
  const owner = await prisma.user.upsert({
    where: { email: GALLERY_EMAIL },
    create: { email: GALLERY_EMAIL, name: '아트링크 갤러리', role: 'GALLERY', termsAgreedAt: new Date(), privacyAgreedAt: new Date() },
    update: { name: '아트링크 갤러리', role: 'GALLERY', deletedAt: null },
  });
  await prisma.gallery.deleteMany({ where: { ownerId: owner.id } });
  const gallery = await prisma.gallery.create({
    data: {
      ownerId: owner.id, name: '아트링크 갤러리', handle: 'artlink.gallery', status: 'APPROVED', region: 'SEOUL',
      address: '서울', phone: '02-0000-0000', ownerName: '아트링크',
      description: '빛과 기억을 다루는 동시대 회화를 소개하는 갤러리',
      detailDesc: '<p>아트링크 갤러리는 신진 작가의 첫 개인전을 함께 준비하는 공간입니다.</p><p>매 시즌 공모로 작가를 만나고, 전시가 끝난 뒤에도 작품이 새 주인을 찾을 때까지 함께합니다.</p>',
      mainImage: '/uploads/intro-sample/gallery-main.jpg',
    },
  });
  const day = 86_400_000;
  await prisma.show.create({
    data: {
      galleryId: gallery.id, status: 'APPROVED', region: 'SEOUL',
      title: '윤서진 개인전 《빛의 결》',
      description: '<p>같은 장소를 계절마다 다시 그려 온 윤서진의 연작 《빛의 결》을 처음으로 한자리에 모읍니다.</p><p>겹겹이 쌓인 색층 사이로 하루의 빛이 지나간 자리를 따라가 보세요.</p>',
      startDate: new Date(Date.now() - 5 * day), endDate: new Date(Date.now() + 25 * day),
      openingHours: '11:00-19:00', admissionFee: '무료', location: '아트링크 갤러리',
      artists: JSON.stringify(['윤서진']),
      posterImage: '/uploads/intro-sample/show-poster.jpg',
      images: { create: ['long-summer', 'blue-wall', 'red-hill', 'quiet-afternoon'].map((f, order) => ({ url: `/demo-art/${f}.jpg`, order })) },
    },
  });
  console.log(`샘플 갤러리 ${gallery.id} · /@artlink.gallery · 전시 1`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
