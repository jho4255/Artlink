/**
 * 실서버 QA용 **테스트 작가/갤러리 계정**을 만들고, 브라우저에 붙여넣을 로그인 토큰을 찍는다.
 *
 * ## 왜 이렇게 하나 (백도어 없이)
 * 로그인은 카카오 OAuth 뿐이라 admin(운영진) 계정 말고 작가/갤러리로 들어갈 방법이 없다.
 * `dev-login` 을 실서버에 켜는 건 **인증 우회 통로**라 금지(ENABLE_DEV_LOGIN 은 Render 에 절대 설정 금지).
 *
 * 대신 `authenticate` 는 「JWT_SECRET 으로 검증 + DB 에 그 유저가 있는지 조회」만 본다(우리 E2E 와 같은 구조).
 * 그래서 ①DB 에 유저 행을 만들고 ②JWT_SECRET 으로 토큰을 서명해 ③브라우저 localStorage 에 넣으면 로그인된다.
 * HTTP 엔드포인트를 안 만드니 새로 열리는 공격면이 없고, 토큰은 만료된다.
 *
 * ## 어디서 돌리나 — **Render 셸에서만**
 * DATABASE_URL·JWT_SECRET 이 Render 환경변수에 이미 있으므로 **비밀을 어디에도 붙여넣지 않는다.**
 *   Render 대시보드 → 이 서비스 → Shell →  cd backend && npx tsx scripts/make-test-accounts.ts create
 *
 * ## 사용
 *   npx tsx scripts/make-test-accounts.ts create        # 계정 생성(멱등) + 토큰·주입 스니펫 출력
 *   npx tsx scripts/make-test-accounts.ts clean          # 테스트 계정을 소프트 삭제(로그인 차단)
 *   npx tsx scripts/make-test-accounts.ts clean --hard    # 완전 삭제(연결 데이터 없을 때만)
 *
 * 출력된 스니펫을 https://artlink.cc 브라우저 콘솔에 붙여넣으면 그 계정으로 로그인된다.
 * 다 쓰면 반드시 `clean` 으로 지울 것 — 이름이 [TEST] 로 시작하고 이메일이 @test.artlink.local 이라 식별된다.
 */
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// 30일이면 QA 한 주기로 충분하고, 오래 방치돼도 자동 만료된다
const TOKEN_TTL = '30d';

// 실 가입자와 절대 안 겹치는 표식 — 정리할 때도 이걸로 찾는다
const ACCOUNTS = [
  { email: 'artist@test.artlink.local', name: '[TEST] 테스트작가', role: 'ARTIST' as const, phone: '010-0000-0001' },
  { email: 'gallery@test.artlink.local', name: '[TEST] 테스트갤러리', role: 'GALLERY' as const, phone: '010-0000-0002' },
];

function requireSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error('✗ JWT_SECRET 환경변수가 없습니다. 이 스크립트는 Render 셸(또는 실서버와 같은 JWT_SECRET 이 설정된 곳)에서 돌려야 합니다.');
    process.exit(1);
  }
  return s;
}

async function create() {
  const secret = requireSecret();
  console.log('\n=== 테스트 계정 생성/확인 ===\n');

  for (const acc of ACCOUNTS) {
    // upsert: 있으면 되살리고(soft-delete 해제), 없으면 만든다. provider 는 기본 LOCAL — 카카오 불필요.
    const user = await prisma.user.upsert({
      where: { email: acc.email },
      update: { name: acc.name, role: acc.role, deletedAt: null },
      create: { email: acc.email, name: acc.name, role: acc.role, phone: acc.phone, provider: 'LOCAL' },
    });

    // 작가는 포트폴리오가 있어야 작품 등록·홈페이지 편집 등이 열린다(없으면 400)
    if (acc.role === 'ARTIST') {
      await prisma.portfolio.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, biography: '테스트 계정입니다.' },
      });
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, secret, { expiresIn: TOKEN_TTL });
    const storeUser = {
      id: user.id, name: user.name, nickname: user.nickname ?? null,
      email: user.email, role: user.role, avatar: user.avatar ?? null,
      phone: user.phone ?? null, instagramUrl: user.instagramUrl ?? null,
    };
    const payload = JSON.stringify({ state: { token, user: storeUser, isAuthenticated: true }, version: 0 });

    console.log(`▶ ${acc.role}  (id=${user.id}, ${user.email})  — 토큰 만료 ${TOKEN_TTL}`);
    console.log('  https://artlink.cc 를 연 뒤 브라우저 콘솔(F12)에 아래 한 줄을 붙여넣으세요:\n');
    console.log(`  localStorage.setItem('artlink-auth', ${JSON.stringify(payload)}); location.reload();`);
    console.log('');
  }

  console.log('※ 로그아웃하려면 콘솔에서:  localStorage.removeItem(\'artlink-auth\'); location.reload();');
  console.log('※ QA 가 끝나면 반드시:  npx tsx scripts/make-test-accounts.ts clean\n');
}

async function clean(hard: boolean) {
  const emails = ACCOUNTS.map(a => a.email);
  if (hard) {
    // 연결 데이터(지원·정산 등)가 있으면 FK 로 막힌다 — 그럴 땐 soft-delete 를 쓸 것
    const r = await prisma.user.deleteMany({ where: { email: { in: emails } } });
    console.log(`\n완전 삭제: ${r.count}건\n`);
  } else {
    const r = await prisma.user.updateMany({ where: { email: { in: emails } }, data: { deletedAt: new Date() } });
    console.log(`\n소프트 삭제(로그인 차단): ${r.count}건. 되살리려면 create 를 다시 실행.\n`);
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'create') await create();
  else if (cmd === 'clean') await clean(process.argv.includes('--hard'));
  else {
    console.log('사용법: npx tsx scripts/make-test-accounts.ts <create|clean [--hard]>');
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
