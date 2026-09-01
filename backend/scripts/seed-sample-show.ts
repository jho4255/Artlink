/**
 * **샘플 진행중 전시** 심기 — 홈 [진행중인 전시] 섹션을 채워진 상태로 확인하기 위한 것.
 *
 * · 멱등: 같은 제목이 이미 있으면 건너뛴다.
 * · 실제 존재하는 **승인된 갤러리**에 붙인다(없으면 중단). 포스터는 그 갤러리 대표 이미지를 쓴다.
 * · 시작 -3일 ~ 종료 +20일 → 항상 '진행중'(getShowStatus === 'ongoing').
 * · 제목이 [샘플]…MARK 로 시작/끝나 --clean 이 이것만 골라 지운다.
 *
 * ⚠️ 로컬 전용 — NODE_ENV=production 이면 중단.
 * 사용:  cd backend && npx tsx scripts/seed-sample-show.ts        (심기)
 *        cd backend && npx tsx scripts/seed-sample-show.ts --clean (지우기)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MARK = '​'; // 제목 끝 보이지 않는 표식

const SAMPLES = [
  { title: '[샘플] 봄의 결 — 회화 3인전', desc: '겨울을 지나 온 세 작가의 신작을 모았습니다. 물성과 빛에 대한 각자의 대답.', artists: ['김서연', '이도현', '박하늘'] },
  { title: '[샘플] 도시의 표면 — 사진·설치', desc: '매일 스쳐 지나는 도시의 표면을 다시 들여다보는 전시.', artists: ['정민우'] },
];

async function seed() {
  if (process.env.NODE_ENV === 'production') { console.error('⛔ production 에서는 실행하지 않습니다.'); return; }

  const gallery = await prisma.gallery.findFirst({
    where: { status: 'APPROVED' }, orderBy: { id: 'asc' },
    select: { id: true, name: true, address: true, region: true, mainImage: true },
  });
  if (!gallery) { console.error('승인된 갤러리가 없어 샘플 전시를 붙일 수 없습니다.'); return; }

  const now = Date.now();
  const start = new Date(now - 3 * 864e5);   // 3일 전
  const end = new Date(now + 20 * 864e5);    // 20일 후

  let made = 0;
  for (const s of SAMPLES) {
    const title = s.title + MARK;
    if (await prisma.show.findFirst({ where: { title }, select: { id: true } })) continue;
    await prisma.show.create({
      data: {
        title, description: s.desc + '\n\n(확인용 샘플 전시입니다.)',
        startDate: start, endDate: end,
        openingHours: '10:00 – 18:00 (월 휴관)', admissionFee: '무료',
        location: `${gallery.name} · ${gallery.address ?? ''}`.trim(),
        region: gallery.region || 'SEOUL',
        artists: JSON.stringify(s.artists),
        posterImage: gallery.mainImage || '',   // 없으면 위젯이 갤러리 대표 이미지로 폴백
        status: 'APPROVED',
        galleryId: gallery.id,
      },
    });
    made++;
  }
  console.log(`\n샘플 진행중 전시 ${made}개 추가 (갤러리: ${gallery.name}).\n`);
}

async function clean() {
  const r = await prisma.show.deleteMany({ where: { title: { endsWith: MARK } } });
  console.log(`\n샘플 전시 ${r.count}개 삭제(제목 끝 표식 기준).\n`);
}

(process.argv.includes('--clean') ? clean() : seed())
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
