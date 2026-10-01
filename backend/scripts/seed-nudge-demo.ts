/**
 * 작가 로그인 뒤 '홈페이지 완성' 팝업을 눈으로 확인하기 위한 계정 둘 (로컬 데모 DB 전용, 2026-10-01).
 *
 * 데모 작가들은 홈페이지가 전부 채워져 있어 팝업이 뜨지 않는다. 그래서 일부러 덜 채운 작가를 만든다.
 *
 * ## 쓰는 법
 *   cd backend && npx tsx scripts/seed-nudge-demo.ts          # 만들기(다시 돌리면 지우고 새로)
 *   cd backend && npx tsx scripts/seed-nudge-demo.ts --clean  # 남김없이 지우기
 *
 * ## 누구로 보나 — 로그인 화면 맨 아래 [개발자 로그인]의 계정 검색에서 '팝업' 으로 찾는다
 *   - 팝업확인 일부채움 (nudge.partial@demo.artlink.local)
 *       작품 4점 중 2점만 정보가 있고, 작가노트가 없고, [작가] 탭에 공개한 작품이 없다 → 로그인하면 **팝업이 뜬다**.
 *   - 팝업확인 작품없음 (nudge.empty@demo.artlink.local)
 *       작품이 0점 → 로그인하면 곧바로 홈페이지 편집 화면(시작하기 안내)으로 가고 **팝업은 뜨지 않는다**.
 *
 * ## 안전장치
 * - DB 가 localhost 가 아니거나 이름에 prod 가 들어 있으면 멈춘다. 운영 환경에서도 멈춘다.
 * - `--clean` 은 위 두 이메일의 계정과 이 스크립트가 만든 파일(`uploads/nudge-demo-*.jpg`)만 지운다.
 * - 작품 사진은 절차적으로 그린 색면이다(실제 작가 작품이 아니다).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import prisma from '../src/lib/prisma';

const CLEAN = process.argv.includes('--clean');
const EMAILS = { partial: 'nudge.partial@demo.artlink.local', empty: 'nudge.empty@demo.artlink.local' };
const UPLOADS = path.join(__dirname, '..', 'uploads');
const fileName = (n: number) => `nudge-demo-${n}.jpg`;

if (process.env.NODE_ENV === 'production') { console.error('⛔ 운영 환경에서는 실행하지 않습니다.'); process.exit(1); }
const dbUrl = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) || /prod/i.test(dbUrl)) {
  console.error('⛔ 로컬 데모 DB(localhost/artlink)에서만 실행합니다. DATABASE_URL 을 확인하세요.');
  process.exit(1);
}

const WORKS: { w: number; h: number; a: string; b: string; meta?: { title: string; medium: string; sizeText: string; year: string } }[] = [
  { w: 900, h: 1100, a: '#223a5e', b: '#d67a3c', meta: { title: '머무는 빛', medium: 'Oil on canvas', sizeText: '72.7 × 60.6 cm', year: '2025' } },
  { w: 1200, h: 900, a: '#782832', b: '#ecd6aa', meta: { title: '오후 네 시', medium: 'Acrylic on canvas', sizeText: '60.6 × 80.3 cm', year: '2024' } },
  { w: 1000, h: 1000, a: '#285a46', b: '#e6c85a' }, // 정보 없음
  { w: 800, h: 1200, a: '#463c6e', b: '#f0aa96' }, // 정보 없음
];

async function paint(n: number, w: number, h: number, a: string, b: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <ellipse cx="${w * 0.34}" cy="${h * 0.4}" rx="${w * 0.3}" ry="${h * 0.16}" fill="${b}" opacity="0.55"/>
    <ellipse cx="${w * 0.66}" cy="${h * 0.68}" rx="${w * 0.24}" ry="${h * 0.2}" fill="${a}" opacity="0.5"/>
    <rect x="${w * 0.12}" y="${h * 0.8}" width="${w * 0.5}" height="${h * 0.035}" fill="${b}" opacity="0.7"/></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toFile(path.join(UPLOADS, fileName(n)));
}

async function clean() {
  const users = await prisma.user.findMany({ where: { email: { in: Object.values(EMAILS) } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.portfolio.deleteMany({ where: { userId: { in: ids } } }); // 작품은 cascade
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.dailyVisit.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  for (let n = 1; n <= WORKS.length; n++) fs.rmSync(path.join(UPLOADS, fileName(n)), { force: true });
  return ids.length;
}

async function main() {
  const removed = await clean();
  if (CLEAN) { console.log(`지웠습니다 — 계정 ${removed}개`); return; }

  fs.mkdirSync(UPLOADS, { recursive: true });
  const now = new Date();
  const base = { role: 'ARTIST', provider: 'LOCAL', termsAgreedAt: now, privacyAgreedAt: now };

  const partial = await prisma.user.create({ data: { ...base, email: EMAILS.partial, name: '팝업확인 일부채움' } });
  const portfolio = await prisma.portfolio.create({
    data: { userId: partial.id, biography: '홍익대학교 회화과 졸업\n2024 개인전 〈머무는 빛〉, 서울', statement: '' },
  });
  for (const [i, w] of WORKS.entries()) {
    await paint(i + 1, w.w, w.h, w.a, w.b);
    await prisma.portfolioImage.create({
      data: { portfolioId: portfolio.id, url: `/uploads/${fileName(i + 1)}`, order: i, width: w.w, height: w.h, showInExplore: false, ...(w.meta ?? {}) },
    });
  }

  await prisma.user.create({ data: { ...base, email: EMAILS.empty, name: '팝업확인 작품없음' } });

  console.log('만들었습니다 — 로그인 화면 [개발자 로그인] 계정 검색에서 "팝업" 으로 찾으세요.');
  console.log(`  · 팝업확인 일부채움 (${EMAILS.partial}) → 로그인하면 팝업: 작품 정보 2/4 · 작가노트 · 공개 0/4`);
  console.log(`  · 팝업확인 작품없음 (${EMAILS.empty}) → 홈페이지 편집 화면으로 가고 팝업 없음`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
