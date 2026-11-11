/**
 * 화면 점검용 계정·대화방 (로컬 전용 — 실서버 복제본 artlink_prod 또는 데모 DB 에서 화면을 잴 때).
 * 이름에 '점검' 이 들어간 계정 둘(작가)과 그 둘의 갠톡 · 빈 갠톡(관리자와) 을 만든다. 메일은 example.com(보내지 않는 주소).
 *   cd backend && DATABASE_URL=... npx tsx scripts/seed-audit-chat.ts          # 만들기(멱등)
 *   cd backend && DATABASE_URL=... npx tsx scripts/seed-audit-chat.ts --clean  # 지우기
 * ⚠️ NODE_ENV=production 이면 멈춘다.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const A = 'audit.artist.a@example.com';
const B = 'audit.artist.b@example.com';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('운영에서 돌리지 말 것');
  if (process.argv.includes('--clean')) {
    const users = await prisma.user.findMany({ where: { email: { in: [A, B] } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const chats = await prisma.chatParticipant.findMany({ where: { userId: { in: ids } }, select: { chatId: true } });
    await prisma.chat.deleteMany({ where: { id: { in: chats.map((c) => c.chatId) }, exhibitionId: null } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`지움: 계정 ${ids.length} · 대화방 ${chats.length}`);
    return;
  }
  const a = await prisma.user.upsert({ where: { email: A }, update: {}, create: { email: A, name: '점검작가A', nickname: '점검작가A', role: 'ARTIST', provider: 'LOCAL' } });
  const b = await prisma.user.upsert({ where: { email: B }, update: {}, create: { email: B, name: '점검작가B', nickname: '점검 작가 B 이름이 아주 긴 경우', role: 'ARTIST', provider: 'LOCAL' } });
  const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
  let chat = await prisma.chat.findUnique({ where: { directKey: key } });
  if (!chat) {
    chat = await prisma.chat.create({ data: { kind: 'DIRECT', directKey: key, createdById: a.id, participants: { create: [{ userId: a.id }, { userId: b.id }] } } });
    const lines: Array<[number, string]> = [
      [b.id, '안녕하세요! 작품 잘 봤습니다.'],
      [a.id, '감사합니다 :)'],
      [b.id, '혹시 다음 달 단체전에 함께하실 수 있을까요? 일정은 11월 셋째 주이고, 장소는 성수동 갤러리입니다. 자세한 내용은 공고를 참고해 주세요.'],
      [a.id, '네 좋아요. 공고 확인해 볼게요.'],
      [b.id, '띄어쓰기없이아주길게이어쓴문장이화면폭을넘어가면어떻게보이는지확인하는메시지입니다띄어쓰기없이아주길게이어쓴문장'],
    ];
    let t = Date.now() - lines.length * 60_000;
    for (const [senderId, content] of lines) {
      await prisma.chatMessage.create({ data: { chatId: chat.id, senderId, content, createdAt: new Date((t += 60_000)) } });
    }
    await prisma.chat.update({ where: { id: chat.id }, data: { lastMessageAt: new Date(t) } });
  }
  // 빈 방 — '첫 메시지를 보내보세요' 자리
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null }, orderBy: { id: 'asc' } });
  let empty = null;
  if (admin) {
    const k2 = `${Math.min(a.id, admin.id)}-${Math.max(a.id, admin.id)}`;
    empty = await prisma.chat.findUnique({ where: { directKey: k2 } })
      ?? await prisma.chat.create({ data: { kind: 'DIRECT', directKey: k2, createdById: a.id, participants: { create: [{ userId: a.id }, { userId: admin.id }] } } });
  }
  console.log(JSON.stringify({ a: a.id, b: b.id, chat: chat.id, emptyChat: empty?.id }));
}

main().finally(() => prisma.$disconnect());
