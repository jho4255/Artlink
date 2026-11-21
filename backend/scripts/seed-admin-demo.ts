/**
 * 관리자 화면(2026-11-21 개편, 규칙 89)을 눈으로 확인하기 위한 예시 데이터 (로컬 데모 DB 전용).
 *
 * 데모 DB 에는 아트링크 주최 공모 · 승인 대기 갤러리 · 수정 요청 · 답하지 않은 문의가 없어
 * [주최 공모]·[승인 관리]·[통계] 요약의 '지금 처리할 일'이 빈 화면으로만 보인다.
 *
 * ## 쓰는 법 (먼저 seed-gallery-artists.ts · seed-flow-stages.ts)
 *   cd backend && npx tsx scripts/seed-admin-demo.ts          # 만들기(다시 돌리면 지우고 새로)
 *   cd backend && npx tsx scripts/seed-admin-demo.ts --clean  # 남김없이 지우기
 *
 * 관리자 admin@artlink.com 으로 마이페이지(관리자)를 본다.
 *
 * ## 안전장치
 * - 만드는 것의 제목·이름이 전부 `[관리자 예시]` 로 시작한다. `--clean` 은 그것만 지운다.
 * - DB 가 localhost 가 아니거나 이름에 prod 가 들어 있으면 멈춘다(운영 복제본의 관리자는 실제 계정이다).
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { kstDay } from '../src/lib/visitStats';

const PREFIX = '[관리자 예시]';
const CLEAN = process.argv.includes('--clean');

if (process.env.NODE_ENV === 'production') { console.error('⛔ 운영 환경에서는 실행하지 않습니다.'); process.exit(1); }
const dbUrl = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) || /prod/i.test(dbUrl)) {
  console.error('⛔ 로컬 데모 DB(localhost/artlink)에서만 실행합니다. DATABASE_URL 을 확인하세요.');
  process.exit(1);
}

const DAY = 86400000;
const dateIn = (n: number) => new Date(kstDay().getTime() + n * DAY);
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600000);

async function clean() {
  const ex = await prisma.exhibition.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = ex.map((e) => e.id);
  await prisma.application.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.exhibition.deleteMany({ where: { id: { in: ids } } });
  await prisma.approvalRequest.deleteMany({ where: { changes: { contains: PREFIX } } });
  await prisma.gallery.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.inquiry.deleteMany({ where: { subject: { startsWith: PREFIX } } });
  console.log(`지웠다 — 공모 ${ids.length}건과 함께 만든 갤러리·수정 요청·문의`);
}

async function main() {
  await clean();
  if (CLEAN) return;
  const artists = await prisma.user.findMany({ where: { role: 'ARTIST' }, orderBy: { id: 'asc' }, select: { id: true }, take: 8 });
  if (artists.length < 4) throw new Error('데모 작가가 모자라다 — 먼저 seed-gallery-artists.ts');
  const gallery = await prisma.gallery.findFirst({ where: { status: 'APPROVED' }, orderBy: { id: 'asc' } });
  if (!gallery) throw new Error('승인된 갤러리가 없다 — 먼저 seed.ts');
  const attach = [{ url: '/uploads/demo-guide.pdf', name: '모집 요강.pdf', size: 1240000 }];
  const base = { type: 'GROUP', region: 'SEOUL', description: '<p>관리자 화면 확인용 예시 공모예요.</p>', status: 'APPROVED', hostType: 'ADMIN', capacity: 5 } as const;

  // 1) 바깥 접수(첨부) · 많이 봄 · 지원 0 — 공모 성과의 '첨부 받음'
  const first = await prisma.exhibition.create({ data: { ...base, title: `${PREFIX} 2027 신진작가 공모전 《첫 장》`, type: 'SOLO', recruitOnly: true, capacityMask: 'ONE', capacity: 9, deadline: dateIn(12), selectionDeadline: dateIn(15), viewCount: 1295, attachments: attach, createdAt: ago(9) } });
  await prisma.exhibitionAttachmentHit.createMany({ data: [0, 1, 2, 3, 5, 8].map((d, i) => ({ exhibitionId: first.id, day: dateIn(-d), count: [6, 4, 9, 3, 2, 5][i] })) });
  // 2) 운영 갤러리 있음 · 2일 뒤 마감 · 검토 대기 2 · 수락 2
  const second = await prisma.exhibition.create({ data: { ...base, title: `${PREFIX} 겨울 드로잉 클럽 참여 작가 모집`, deadline: dateIn(2), deadlineStart: dateIn(-14), selectionDeadline: dateIn(5), exhibitStartDate: dateIn(20), exhibitDate: dateIn(34), submissionDeadline: dateIn(10), capacity: 8, viewCount: 318, galleryId: gallery.id, managers: { create: [{ galleryId: gallery.id }] }, createdAt: ago(14) } });
  // 지원서 본문도 채운다(2026-11-21) — 실제 지원은 약력·작품 사진이 반드시 있다. 비어 있으면 [지원서 수정](규칙 90)이 '작품 사진' 에서 멈춘다
  const body = (bio: string, imgs: string[]) => ({ biography: bio, artworkImages: JSON.stringify(imgs.map((f) => `/demo-art/${f}.jpg`)) });
  await prisma.application.createMany({ data: [
    { userId: artists[0].id, exhibitionId: second.id, status: 'SUBMITTED', createdAt: ago(1, 3), ...body('일상의 장면을 오래 들여다보고 그 안에 남는 감정을 연필과 목탄으로 옮깁니다.', ['winter-garden', 'blue-wall', 'long-summer']) },
    { userId: artists[1].id, exhibitionId: second.id, status: 'SUBMITTED', createdAt: ago(3), ...body('물과 빛의 기억을 수채로 그립니다.', ['water-memory', 'city-walk']) },
    // 모집 중인 공모의 수락은 초대 코드로만 생긴다(수락·거절은 마감 뒤 — 규칙 90)
    { userId: artists[2].id, exhibitionId: second.id, status: 'ACCEPTED', joinedVia: 'CODE', createdAt: ago(8), updatedAt: ago(6) },
    { userId: artists[3].id, exhibitionId: second.id, status: 'ACCEPTED', joinedVia: 'CODE', createdAt: ago(9), updatedAt: ago(6) },
  ] });
  // 3) 직접 운영 · 검토 대기 1(관리자가 결정할 몫)
  const third = await prisma.exhibition.create({ data: { ...base, title: `${PREFIX} 아트페어 부스 참가 작가 모집`, type: 'ART_FAIR', recruitOnly: true, capacityMask: 'TWO', capacity: 99, deadline: dateIn(20), selectionDeadline: dateIn(23), viewCount: 442, createdAt: ago(5) } });
  await prisma.application.create({ data: { userId: artists[4].id, exhibitionId: third.id, status: 'SUBMITTED', createdAt: ago(0, 5), ...body('아트페어에서 소품 연작을 소개하고 싶습니다.', ['square-garden']) } });
  // 4) 마감한 주최 공모
  await prisma.exhibition.create({ data: { ...base, title: `${PREFIX} 봄 기획전 《움트는 것들》 참여 작가 공모`, recruitOnly: true, deadline: dateIn(-10), selectionDeadline: dateIn(-5), recruitmentClosed: true, viewCount: 1105, createdAt: ago(40) } });

  // 승인 대기 갤러리 · 수정 요청 · 답하지 않은 문의
  await prisma.gallery.create({ data: { name: `${PREFIX} 스튜디오 물결`, address: '경기도 성남시 분당구 판교역로 1', phone: '031-000-0000', description: '판교의 작은 전시 공간', region: 'GYEONGGI_SOUTH', ownerName: '예시 대표', ownerId: (await prisma.user.findFirst({ where: { role: 'GALLERY' } }))!.id, status: 'PENDING', createdAt: ago(1, 2) } });
  const target = await prisma.exhibition.findFirst({ where: { title: { startsWith: '[단계 03]' } } });
  if (target) {
    await prisma.approvalRequest.create({ data: { type: 'EXHIBITION_EDIT', targetId: target.id, requesterId: target.galleryId ? (await prisma.gallery.findUnique({ where: { id: target.galleryId } }))!.ownerId : 3, changes: JSON.stringify({ capacity: 8, deadline: dateIn(11).toISOString().slice(0, 10), title: `${PREFIX} ${target.title.replace(/^\[단계 03\] /, '')} (모집 연장)` }), createdAt: ago(0, 3) } });
  }
  await prisma.inquiry.create({ data: { subject: `${PREFIX} 정산서는 어디서 받나요?`, content: '전시가 끝났는데 정산서 PDF 를 어디서 받는지 모르겠어요.', userId: artists[0].id, createdAt: ago(2, 4) } });
  console.log('만들었다 — 주최 공모 4 · 승인 대기 갤러리 1 · 공모 수정 요청 1 · 문의 1');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
