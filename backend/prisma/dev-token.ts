/**
 * 로컬 개발용 JWT 발급 — 카카오 OAuth 없이 시드 계정으로 로그인 상태를 만든다.
 *
 * ⚠️ 로컬 전용. 운영(NODE_ENV=production)에서는 실행을 거부한다.
 *
 * 사용법:
 *   cd backend && npx tsx prisma/dev-token.ts [email]
 *   (email 생략 시 기본값: gallery@artlink.com — 시드의 GALLERY 계정)
 *
 * 예) npx tsx prisma/dev-token.ts admin@artlink.com
 *
 * 출력된 "브라우저 콘솔 스니펫"을 프론트(localhost:5173) 개발자도구 Console에
 * 붙여넣고 실행하면 해당 계정으로 로그인된 상태가 된다.
 */
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'artlink-dev-secret';

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ 운영 환경에서는 사용할 수 없습니다.');
    process.exit(1);
  }

  const email = process.argv[2] || 'gallery@artlink.com';
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ 해당 이메일의 유저가 없습니다: ${email}`);
    console.error('   먼저 시드를 실행하세요: npx tsx prisma/seed.ts');
    process.exit(1);
  }

  // auth.ts의 generateToken과 동일한 페이로드/시크릿
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

  // 프론트 authStore(zustand persist, key='artlink-auth')에 주입할 형태
  const authUser = {
    id: user.id,
    name: user.name,
    nickname: user.nickname,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
  };
  const persisted = JSON.stringify({ state: { token, user: authUser, isAuthenticated: true }, version: 0 });

  console.log(`\n✅ 토큰 발급: ${user.email} (${user.role}, id=${user.id})\n`);
  console.log('━━━ 브라우저 콘솔 스니펫 (localhost:5173 → F12 → Console에 붙여넣기) ━━━\n');
  console.log(`localStorage.setItem('artlink-auth', ${JSON.stringify(persisted)}); location.reload();`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
