/**
 * **데모 데이터** — 새 소셜/광고 기능(이웃·ArtStory·방명록·광고)을 채워진 상태로 시연하기 위한 것.
 *
 * 커뮤니티 글·진행중 전시는 각각 `seed-community-samples.ts`·`seed-sample-show.ts` 가 따로 채운다.
 * 셋 다 멱등이라 여러 번 돌려도 안 불어난다. `--clean` 으로 이 스크립트가 만든 것만 지운다.
 *
 * ⚠️ 로컬 전용(NODE_ENV=production 이면 중단). 실제 존재하는 시드 계정(역할별 최소 id)을 쓴다.
 * 사용:  cd backend && npx tsx scripts/seed-demo.ts        (채우기)
 *        cd backend && npx tsx scripts/seed-demo.ts --clean (지우기)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

const DEMO_PW = 'demo1234'; // 팀 데모용 — 시드 계정에 이 비번을 심어 일반 로그인 폼으로 들어간다

const MARK = '​'; // 보이지 않는 표식(zero-width space) — --clean 이 데모분만 고르게

async function pick(role: string, skipId?: number) {
  return prisma.user.findFirst({
    where: { role, deletedAt: null, ...(skipId ? { id: { not: skipId } } : {}) },
    orderBy: { id: 'asc' }, select: { id: true, name: true, nickname: true },
  });
}

async function seed() {
  if (process.env.NODE_ENV === 'production') { console.error('⛔ production 에서는 실행하지 않습니다.'); return; }

  const artist1 = await pick('ARTIST');
  const artist2 = artist1 ? await pick('ARTIST', artist1.id) : null;
  const gallery = await pick('GALLERY');
  const admin = await pick('ADMIN');
  if (!artist1 || !artist2 || !gallery) { console.error('시드 계정(작가 2·갤러리 1)이 부족합니다.'); return; }

  // ── 데모 로그인 비번 심기 — 일반 로그인 폼으로 들어갈 수 있게(dev-login 불필요) ──
  const pwHash = await bcrypt.hash(DEMO_PW, 10);
  const demoAccounts = [artist1, artist2, gallery, admin].filter((u): u is NonNullable<typeof u> => !!u);
  for (const u of demoAccounts) await prisma.user.update({ where: { id: u.id }, data: { password: pwHash } });
  const emails = await prisma.user.findMany({ where: { id: { in: demoAccounts.map((u) => u.id) } }, select: { email: true, role: true } });

  const imgs = (await prisma.portfolioImage.findMany({ take: 8, select: { url: true } })).map((r) => r.url);
  const pic = (i: number) => (imgs.length ? [imgs[i % imgs.length]!] : []);

  // ── 이웃(팔로우) ──
  const follows: [number, number][] = [
    [artist1.id, artist2.id], [artist1.id, gallery.id],
    [artist2.id, artist1.id], [gallery.id, artist1.id],
    ...(admin ? [[admin.id, artist1.id]] as [number, number][] : []),
  ];
  for (const [f, t] of follows) {
    await prisma.follow.upsert({ where: { followerId_followingId: { followerId: f, followingId: t } }, create: { followerId: f, followingId: t }, update: {} });
  }

  // ── 스토리(ArtStory) ── caption 끝에 MARK
  const stories = [
    { author: artist1.id, caption: '오늘 작업실. 큰 캔버스에 초벌 올렸어요. 색이 마르는 동안 커피 한 잔 ☕', vis: 'PUBLIC', img: pic(0) },
    { author: artist1.id, caption: '이웃들만 살짝 — 다음 전시 신작 스케치 미리보기 👀', vis: 'NEIGHBORS', img: pic(1) },
    { author: artist2.id, caption: '드로잉 30분 챌린지 3일차. 손이 좀 풀리네요.', vis: 'PUBLIC', img: pic(2) },
    { author: gallery.id, caption: '이번 주말 오프닝 준비 중입니다. 많이 놀러 오세요!', vis: 'PUBLIC', img: pic(3) },
  ];
  let madeStories = 0;
  for (const s of stories) {
    const caption = s.caption + MARK;
    if (await prisma.story.findFirst({ where: { caption }, select: { id: true } })) continue;
    const story = await prisma.story.create({ data: { authorId: s.author, caption, images: s.img, visibility: s.vis } });
    // 좋아요: 작성자 아닌 사람들
    const likers = [artist1.id, artist2.id, gallery.id, admin?.id].filter((id): id is number => !!id && id !== s.author).slice(0, 2);
    for (const uid of likers) { try { await prisma.storyLike.create({ data: { storyId: story.id, userId: uid } }); } catch { /* dup */ } }
    // 댓글 하나
    const commenter = likers[0];
    if (commenter) await prisma.storyComment.create({ data: { storyId: story.id, authorId: commenter, body: '멋져요! 응원합니다 🙌' + MARK } });
    await prisma.story.update({ where: { id: story.id }, data: { likeCount: likers.length, commentCount: commenter ? 1 : 0 } });
    madeStories++;
  }

  // ── 방명록(작가1 홈페이지) ── body 끝에 MARK
  const gbSamples = [
    { author: artist2.id, body: '작품 잘 보고 갑니다. 다음 전시도 기대할게요!', secret: false },
    { author: gallery.id, body: '전시 협업 관련해 따로 연락드리고 싶어요. (비밀글)', secret: true },
  ];
  let madeGb = 0;
  for (const g of gbSamples) {
    const body = g.body + MARK;
    if (await prisma.guestbookEntry.findFirst({ where: { body }, select: { id: true } })) continue;
    const entry = await prisma.guestbookEntry.create({ data: { targetUserId: artist1.id, authorId: g.author, body, secret: g.secret } });
    // 방 주인(artist1) 답글은 공개 글에만
    if (!g.secret) await prisma.guestbookEntry.create({ data: { targetUserId: artist1.id, authorId: artist1.id, body: '감사합니다! 자주 들러주세요 😊' + MARK, parentId: entry.id } });
    madeGb++;
  }

  // ── 광고 배너 ── title 끝에 MARK
  const adImg = imgs[0] ?? (await prisma.gallery.findFirst({ where: { mainImage: { not: '' } }, select: { mainImage: true } }))?.mainImage;
  const adTitle = '아트페어 2026 프리뷰 — 지금 신청' + MARK;
  if (adImg && !(await prisma.adBanner.findFirst({ where: { title: adTitle }, select: { id: true } }))) {
    await prisma.adBanner.create({ data: { imageUrl: adImg, title: adTitle, linkUrl: '/exhibitions', active: true, position: 0 } });
  }

  console.log(`\n데모 데이터 완료 — 이웃 ${follows.length}쌍 · 스토리 ${madeStories} · 방명록 ${madeGb} · 광고 1.`);
  console.log(`\n로그인(비번 ${DEMO_PW}):`);
  for (const e of emails) console.log(`  · ${e.role.padEnd(7)} ${e.email}`);
  console.log('');
}

async function clean() {
  await prisma.storyComment.deleteMany({ where: { body: { endsWith: MARK } } });
  const st = await prisma.story.deleteMany({ where: { caption: { endsWith: MARK } } });
  const gb = await prisma.guestbookEntry.deleteMany({ where: { body: { endsWith: MARK } } });
  const ad = await prisma.adBanner.deleteMany({ where: { title: { endsWith: MARK } } });
  // 데모 팔로우 정리(작가1 을 중심으로 만든 것만)
  const a1 = await pick('ARTIST');
  if (a1) await prisma.follow.deleteMany({ where: { OR: [{ followerId: a1.id }, { followingId: a1.id }] } });
  console.log(`\n데모 삭제 — 스토리 ${st.count} · 방명록 ${gb.count} · 광고 ${ad.count} (팔로우 정리 포함).\n`);
}

(process.argv.includes('--clean') ? clean() : seed())
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
