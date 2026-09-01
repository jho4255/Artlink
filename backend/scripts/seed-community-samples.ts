/**
 * 커뮤니티 **샘플 글** 몇 개 심기 — 기능을 채워진 상태로 확인하기 위한 것.
 *
 * · 멱등: 같은 제목이 이미 있으면 건너뛴다(여러 번 돌려도 안 불어난다).
 * · 작성자는 **실제 존재하는 유저**(역할별로 골라 씀). 없으면 그 글은 건너뛴다.
 * · 좋아요는 적게(≤2) 넣어 인기글 검증 테스트와 부딪히지 않게 한다.
 *
 * 사용:  cd backend && npx tsx scripts/seed-community-samples.ts        (심기)
 *        cd backend && npx tsx scripts/seed-community-samples.ts --clean (지우기)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MARK = '​'; // 제목 끝에 보이지 않는 표식 — --clean 이 샘플만 골라 지우게

type Sample = {
  role: 'ARTIST' | 'GALLERY' | 'ADMIN';
  title: string; body: string; anonymous?: boolean; likes?: number;
  comments?: { role: 'ARTIST' | 'GALLERY' | 'ADMIN'; body: string; anonymous?: boolean }[];
};

const SAMPLES: Sample[] = [
  {
    role: 'ADMIN',
    title: '커뮤니티가 열렸어요 👋',
    body: '작가·갤러리·관람객 누구나 편하게 이야기 나누는 공간입니다.\n작업 고민, 전시 후기, 공간 대관, 재료 추천 — 뭐든 좋아요. 익명으로도 쓸 수 있습니다. 잘 부탁드려요!',
    likes: 2,
    comments: [{ role: 'ARTIST', body: '오 드디어! 잘 쓸게요 🙌' }],
  },
  {
    role: 'ARTIST',
    title: '첫 개인전 오프닝, 뭐부터 준비하면 좋을까요',
    body: '10월에 작은 공간에서 첫 개인전을 엽니다. 오프닝 다과랑 방명록 정도는 생각했는데, 막상 해보신 분들은 "이건 꼭 챙겨라" 하는 게 있을까요? 도록은 필수인지도 궁금합니다.',
    likes: 2,
    comments: [
      { role: 'GALLERY', body: '도록은 부담되면 리플렛으로도 충분해요. 명함 넉넉히 챙기시고요.' },
      { role: 'ARTIST', body: '방명록은 은근 오래 남더라고요. 추천!' },
    ],
  },
  {
    role: 'ARTIST',
    title: '작업 안 풀릴 때 다들 뭐 하세요',
    body: '2주째 캔버스 앞에서 멍만 때리는 중… 산책? 전시 보기? 아예 쉬기? 여러분의 슬럼프 탈출법이 궁금합니다.',
    likes: 1,
    anonymous: true,
    comments: [{ role: 'ARTIST', body: '전 무조건 남의 전시 보러 가요. 질투가 원동력…', anonymous: true }],
  },
  {
    role: 'GALLERY',
    title: '아트페어 부스, 첫 참가라 막막하네요',
    body: '내년 봄 아트페어 부스 신청을 넣어볼까 하는데, 처음이라 동선이며 조명이며 감이 안 옵니다. 작게라도 해보신 갤러리 분들 조언 부탁드려요.',
    likes: 1,
  },
  {
    role: 'ARTIST',
    title: '한지에 아크릴, 접착 어떻게 잡으세요?',
    body: '한지 위에 아크릴을 올리면 자꾸 우는 문제가 있어서요. 배접부터 다시 해야 할지, 미디엄으로 잡을 수 있는지 경험 공유 부탁드립니다.',
    likes: 0,
  },
];

async function pickUser(role: string): Promise<number | null> {
  const u = await prisma.user.findFirst({ where: { role, deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true } });
  return u?.id ?? null;
}

async function seed() {
  const byRole: Record<string, number | null> = {
    ARTIST: await pickUser('ARTIST'), GALLERY: await pickUser('GALLERY'), ADMIN: await pickUser('ADMIN'),
  };
  // 좋아요 눌러 줄 사람들(작성자 아닌 아무 유저 몇 명)
  const likers = (await prisma.user.findMany({ where: { deletedAt: null }, take: 3, orderBy: { id: 'desc' }, select: { id: true } })).map(u => u.id);

  let made = 0;
  for (const s of SAMPLES) {
    const authorId = byRole[s.role];
    if (!authorId) { console.log(`- ${s.role} 유저가 없어 건너뜀: ${s.title}`); continue; }
    const title = s.title + MARK;
    if (await prisma.post.findFirst({ where: { title }, select: { id: true } })) continue; // 이미 있음

    const post = await prisma.post.create({
      data: { authorId, title, body: s.body, anonymous: !!s.anonymous },
    });
    // 좋아요
    const likeIds = likers.filter(id => id !== authorId).slice(0, s.likes ?? 0);
    for (const uid of likeIds) {
      try { await prisma.postLike.create({ data: { postId: post.id, userId: uid } }); } catch { /* dup */ }
    }
    // 댓글
    for (const c of s.comments ?? []) {
      const cAuthor = byRole[c.role];
      if (!cAuthor) continue;
      await prisma.postComment.create({ data: { postId: post.id, authorId: cAuthor, body: c.body, anonymous: !!c.anonymous } });
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { likeCount: likeIds.length, commentCount: (s.comments ?? []).filter(c => byRole[c.role]).length, viewCount: 5 + made * 7 },
    });
    made++;
  }
  console.log(`\n샘플 글 ${made}개 추가 완료.\n`);
}

async function clean() {
  const r = await prisma.post.deleteMany({ where: { title: { endsWith: MARK } } });
  console.log(`\n샘플 글 ${r.count}개 삭제(제목 끝 표식 기준).\n`);
}

(process.argv.includes('--clean') ? clean() : seed())
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
