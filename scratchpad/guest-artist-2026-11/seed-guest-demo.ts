/**
 * 비회원 작가(규칙 91) 확인용 공모 하나 — 로컬 데모 DB 전용 (2026-11-23).
 *
 *   cd backend && DATABASE_URL=<로컬 데모 DB> npx tsx ../scratchpad/guest-artist-2026-11/seed-guest-demo.ts          # 만들기(다시 돌리면 지우고 새로)
 *   cd backend && DATABASE_URL=<로컬 데모 DB> npx tsx ../scratchpad/guest-artist-2026-11/seed-guest-demo.ts --clean  # 지우기
 *
 * 갤러리 gallery@artlink.com 의 '전시 준비' 단계 공모: 회원 작가 둘(Artist 1 자료 다 냄 · 강윤서 아직) + 비회원 작가 둘(한지우 자료 채움 · 윤서해 빈 칸).
 * 비회원 작가는 서버와 같은 함수(`createGuestArtist`)로 만든다. 지우면 비회원 계정도 함께 지운다(`deleteGuestUsers`).
 */
import prisma from '../../backend/src/lib/prisma';
import { createGuestArtist, deleteGuestUsers, guestIdsOfExhibitions } from '../../backend/src/lib/guestArtists';
import { ARTIST_APPLY_TERMS_VERSION, ARTIST_APPLY_TERMS_HASH } from '../../backend/src/lib/terms';

const TITLE = '[확인] 비회원 작가 — 2027 봄 기획전 《새싹》';
const CLEAN = process.argv.includes('--clean');

const dbUrl = process.env.DATABASE_URL ?? '';
if (process.env.NODE_ENV === 'production' || !/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) || /prod/i.test(dbUrl)) {
  console.error('⛔ 로컬 데모 DB(localhost/artlink)에서만 실행합니다.');
  process.exit(1);
}

const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const day = (n: number) => { const d = new Date(`${todayKst}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d; };

const work = (image: string, title: string, size: string, medium: string, price: string) => ({ image, title, size, medium, year: '2026', price });

async function clean() {
  const old = await prisma.exhibition.findMany({ where: { title: TITLE }, select: { id: true } });
  if (!old.length) return;
  const guests = await guestIdsOfExhibitions(prisma, old.map((e) => e.id));
  await prisma.exhibition.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
  await deleteGuestUsers(prisma, guests);
  console.log(`지웠다 — 공모 ${old.length}건 · 비회원 작가 ${guests.length}명`);
}

async function main() {
  await clean();
  if (CLEAN) return;
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'gallery@artlink.com' } });
  const gallery = await prisma.gallery.findFirstOrThrow({ where: { ownerId: owner.id, status: 'APPROVED' }, orderBy: { id: 'asc' } });
  const artist1 = await prisma.user.findUniqueOrThrow({ where: { email: 'artist1@artlink.com' } });
  const kang = await prisma.user.findUniqueOrThrow({ where: { email: 'yunseo.kang@demo.artlink.local' } });

  const ex = await prisma.exhibition.create({
    data: {
      title: TITLE, type: 'GROUP', capacity: 3, region: gallery.region ?? 'SEOUL',
      description: '<p>비회원 작가 확인용 공모입니다. [출품 자료] 탭 맨 아래 [비회원 작가 추가]로 가입하지 않은 작가를 넣고 자료를 채워 보세요.</p>',
      imageUrl: '/demo-art/water-memory.jpg', status: 'APPROVED', hostType: 'GALLERY', galleryId: gallery.id,
      deadlineStart: day(-20), deadline: day(-5), selectionDeadline: day(-2), submissionDeadline: day(10),
      exhibitStartDate: day(20), exhibitDate: day(34), recruitmentClosed: true,
    },
  });

  // 회원 작가 둘 — 수락됨. Artist 1 은 자료를 다 냈고 강윤서는 아직
  for (const [i, u] of [artist1, kang].entries()) {
    await prisma.application.create({
      data: {
        exhibitionId: ex.id, userId: u.id, status: 'ACCEPTED',
        biography: `${u.name}은(는) 일상의 장면을 회화로 옮긴다.`,
        career: JSON.stringify({ artFair: [], solo: [{ year: '2025', content: `${u.name} 개인전` }], group: [] }),
        artworkImages: JSON.stringify(['/demo-art/dawn-window.jpg']),
        termsAgreedAt: new Date(), termsVersion: ARTIST_APPLY_TERMS_VERSION, termsTextHash: ARTIST_APPLY_TERMS_HASH,
        createdAt: new Date(Date.now() - (2 - i) * 60_000),
      },
    });
  }
  await prisma.exhibitionSubmission.create({
    data: {
      exhibitionId: ex.id, userId: artist1.id, updatedById: artist1.id, representativeIndex: 0,
      artworkList: JSON.stringify([work('/demo-art/dawn-window.jpg', '이른 아침', '53x45.5', '캔버스에 유채', '1500000'), work('/demo-art/quiet-afternoon.jpg', '창밖의 오후', '40x30', '캔버스에 아크릴', '900000')]),
      cv: JSON.stringify({ nameKo: artist1.name, solo: [{ year: '2025', content: '개인전 「빛의 결」' }] }),
      note: JSON.stringify({ statement: '빛이 벽에 남기는 자국을 따라갑니다.', sections: [] }),
    },
  });

  // 비회원 작가 둘 — 서버와 같은 함수로. 한지우는 자료를 채워 두고 윤서해는 빈 칸
  const g1 = await createGuestArtist(ex.id, '한지우', owner.id);
  await createGuestArtist(ex.id, '윤서해', owner.id);
  await prisma.exhibitionSubmission.create({
    data: {
      exhibitionId: ex.id, userId: g1.id, updatedById: owner.id, representativeIndex: 0,
      artworkList: JSON.stringify([work('/demo-art/red-hill.jpg', '붉은 언덕', '72.7x60.6', '캔버스에 유채', '2200000'), work('/demo-art/winter-garden.jpg', '겨울 정원', '45.5x38', '종이에 과슈', '800000')]),
      cv: JSON.stringify({ nameKo: '한지우', tel: '010-0000-0000', solo: [{ year: '2024', content: '한지우 개인전 「봄의 문턱」' }] }),
      note: JSON.stringify({ statement: '계절이 바뀌는 문턱의 색을 그립니다.', sections: [] }),
    },
  });

  console.log(`만들었다 — 공모 #${ex.id} "${TITLE}"`);
  console.log(`갤러리: gallery@artlink.com → http://localhost:5183/mypage?tab=my-exhibitions&ex=${ex.id}&view=submissions`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
