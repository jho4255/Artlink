/**
 * 특정 유저를 ADMIN으로 승격 (운영자용 일회성 스크립트)
 *
 * 사용법:
 *   로컬:  cd backend && npx tsx prisma/make-admin.ts <email>
 *   운영:  cd backend && DATABASE_URL="<운영 DB 연결문자열>" npx tsx prisma/make-admin.ts <email>
 *
 * 예) npx tsx prisma/make-admin.ts hunoh@example.com
 *
 * ⚠️ 카카오 가입은 ARTIST/GALLERY만 가능하므로, 먼저 그 사람이 카카오로 가입한 뒤
 *    이 스크립트로 해당 이메일 계정을 ADMIN으로 올려주세요.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const email = process.argv[2];
  if (!email) {
    console.error('사용법: npx tsx prisma/make-admin.ts <email>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ 해당 이메일의 유저가 없습니다: ${email} (먼저 카카오로 가입해야 합니다)`);
    process.exit(1);
  }
  if (user.role === 'ADMIN') {
    console.log(`ℹ️  이미 ADMIN입니다: ${email}`);
    process.exit(0);
  }
  const updated = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
  console.log(`✅ ${updated.email} (${user.role} → ADMIN) 승격 완료`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
