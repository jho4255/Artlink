/**
 * 공모 흐름을 **단계마다 하나씩** 눈으로 확인하기 위한 테스트 공모 묶음 (로컬 데모 DB 전용, 2026-09-29).
 *
 * 공모 등록 → 승인 → 모집(지원자 검토) → 모집 마감(출품 자료) → 전시 확정 → 전시 중 → 전시 종료(판매 입력)
 * → 정산 확인 요청 → 정산 완료 는 실제로 밟으면 몇 주가 걸리고, 한 공모로는 한 단계밖에 못 본다.
 * 같은 갤러리(gallery@artlink.com)와 같은 작가(Artist 1)로 단계마다 공모를 하나씩 만들어,
 * 갤러리 [내 공모] 와 작가 [내 전시] 양쪽에서 각 단계 화면을 나란히 볼 수 있게 한다.
 *
 * ## 쓰는 법
 *   cd backend && npx tsx scripts/seed-flow-stages.ts          # 만들기(다시 돌리면 지우고 새로)
 *   cd backend && npx tsx scripts/seed-flow-stages.ts --clean  # 남김없이 지우기
 *
 * ## 누구로 보나
 *   - 갤러리 : gallery@artlink.com (Gallery Owner) → 마이페이지 [내 공모]  (위에서부터 단계 순서)
 *   - 작가   : artist1@artlink.com (Artist 1)      → 마이페이지 [내 전시]  (받은 초대 · 심사 중 · 진행 중 · 종료)
 *   - 그 밖의 지원자는 데모 작가들(강윤서·노해원·문지호·배소민·서진우·오하린·임세아·한도경)
 *
 * ## 안전장치
 * - 제목이 전부 `[단계` 로 시작한다. `--clean` 은 **그 제목의 공모만** 지운다.
 * - DB 가 localhost 가 아니거나 이름에 prod 가 들어 있으면 멈춘다 — 운영 복제본(artlink_prod)에 테스트 공모를 섞지 않는다.
 * - 날짜가 과거인 단계(전시 중·종료·정산)는 API 로는 만들 수 없어 DB 에 직접 쓴다. 정산 수락은 서버와 **같은 함수**
 *   (`settlementFingerprint`)로 지문을 남긴다 — 빼면 화면이 '금액이 바뀌었다'로 읽어 [정산 완료]가 막힌다(CLAUDE.md 26).
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { ARTIST_APPLY_TERMS_VERSION, ARTIST_APPLY_TERMS_HASH } from '../src/lib/terms';
import { settlementFingerprint } from '../src/lib/settlementFingerprint';

const PREFIX = '[단계';
const CLEAN = process.argv.includes('--clean');

// ── 안전장치 ─────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') { console.error('⛔ 운영 환경에서는 실행하지 않습니다.'); process.exit(1); }
const dbUrl = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) || /prod/i.test(dbUrl)) {
  console.error('⛔ 로컬 데모 DB(localhost/artlink)에서만 실행합니다. DATABASE_URL 을 확인하세요.');
  process.exit(1);
}

// ── 날짜 — 화면과 같은 규칙: 'YYYY-MM-DD' → UTC 자정(= KST 09:00) ──
const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const day = (n: number) => {
  const d = new Date(`${todayKst}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000);

// ── 데이터 모양 ─────────────────────────────────────────
type Status = 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
type Sub = 'none' | 'complete' | 'artworks-only' | 'draft';
interface Person { who: string; status: Status; sub?: Sub; sold?: number[]; approval?: 'PENDING' | 'APPROVED' | 'ISSUE'; comment?: string; via?: 'CODE' }
interface Stage {
  n: number;
  label: string;
  note: string; // 이 단계에서 무엇을 보면 되는지 — 공모 소개에 적어 둔다
  type?: 'SOLO' | 'GROUP';
  capacity?: number;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason?: string;
  recruitOnly?: boolean;
  dates: { start: number; deadline: number; submission?: number; showStart?: number; showEnd?: number };
  flags?: { recruitmentClosed?: boolean; confirmed?: boolean; ended?: boolean; requested?: number; settled?: number };
  questions?: boolean;
  notice?: boolean;
  people?: Person[];
  inviteArtist1?: boolean;
}

const QUESTIONS = [
  { id: 'q-schedule', label: '작품 운송·설치가 가능한 일정을 적어주세요', type: 'text', required: true, maxLength: 200 },
  { id: 'q-space', label: '희망 전시 공간', type: 'select', required: false, options: ['1층 메인홀', '2층 소전시실'], maxSelect: 1 },
];
const ANSWERS = [
  [{ fieldId: 'q-schedule', value: '10월 셋째 주 평일 오후 가능합니다. 택배로 보냅니다.' }, { fieldId: 'q-space', value: '1층 메인홀' }],
  [{ fieldId: 'q-schedule', value: '주말 오전에 직접 가져가겠습니다.' }, { fieldId: 'q-space', value: '2층 소전시실' }],
  [{ fieldId: 'q-schedule', value: '언제든 가능합니다.' }],
];

// 전시까지 진행하는 공모의 일정 — 단계가 뒤로 갈수록 과거로 민다
const STAGES: Stage[] = [
  {
    n: 1, label: '승인 대기', note: '방금 등록한 공모 — 관리자 승인 전이라 모집공고에 아직 안 보인다.',
    status: 'PENDING', dates: { start: 1, deadline: 21, submission: 28, showStart: 40, showEnd: 55 },
  },
  {
    n: 2, label: '반려', note: '관리자가 반려한 공모 — 카드에 반려 사유가 보인다.',
    status: 'REJECTED', rejectReason: '공모 소개에 전시 기간과 장소가 빠져 있어요. 보완해서 다시 등록해 주세요.',
    dates: { start: 1, deadline: 21, submission: 28, showStart: 40, showEnd: 55 },
  },
  {
    n: 3, label: '모집 중 · 지원자 검토', note: '지원자 6명(검토 대기 3 · 수락 2 · 거절 1). 정원 4명이라 2자리 남음. 추가 질문 답변이 있다.',
    capacity: 4, questions: true, dates: { start: -5, deadline: 9, submission: 16, showStart: 30, showEnd: 44 },
    people: [
      { who: 'artist1@artlink.com', status: 'SUBMITTED' },
      { who: 'somin.bae@demo.artlink.local', status: 'SUBMITTED' },
      { who: 'jinwoo.seo@demo.artlink.local', status: 'SUBMITTED' },
      { who: 'harin.oh@demo.artlink.local', status: 'ACCEPTED' },
      { who: 'sea.lim@demo.artlink.local', status: 'ACCEPTED', via: 'CODE' },
      { who: 'dokyung.han@demo.artlink.local', status: 'REJECTED' },
    ],
  },
  {
    n: 4, label: '모집 마감 · 출품 자료 받는 중', note: '수락 4명 중 제출 완료 1명. Artist 1 은 아직 안 냄(작가 화면에 제출 안내), 노해원은 작품만 냄, 문지호는 임시저장만.',
    notice: true, dates: { start: -16, deadline: -2, submission: 6, showStart: 18, showEnd: 32 }, flags: { recruitmentClosed: true },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'none' },
      { who: 'yunseo.kang@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
      { who: 'haewon.noh@demo.artlink.local', status: 'ACCEPTED', sub: 'artworks-only' },
      { who: 'jiho.moon@demo.artlink.local', status: 'ACCEPTED', sub: 'draft' },
    ],
  },
  {
    n: 5, label: '출품 자료 다 모임 · 전시 확정 전', note: '수락 3명 모두 제출 완료. 갤러리가 [전시 확정하기]를 누를 차례.',
    notice: true, dates: { start: -20, deadline: -8, submission: -1, showStart: 10, showEnd: 24 }, flags: { recruitmentClosed: true },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete' },
      { who: 'yunseo.kang@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
      { who: 'somin.bae@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
    ],
  },
  {
    n: 6, label: '전시 확정 · 시작 전', note: '확정됨 — 작가는 출품 자료를 더 고칠 수 없다(잠긴 화면). 전시 시작 D-5.',
    notice: true, dates: { start: -25, deadline: -12, submission: -4, showStart: 5, showEnd: 19 }, flags: { recruitmentClosed: true, confirmed: true },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete' },
      { who: 'haewon.noh@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
    ],
  },
  {
    n: 7, label: '전시 중', note: '전시 기간 한가운데. 끝나면 갤러리가 [전시 종료하기]를 누른다.',
    dates: { start: -35, deadline: -20, submission: -12, showStart: -3, showEnd: 10 }, flags: { recruitmentClosed: true, confirmed: true },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete' },
      { who: 'jiho.moon@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
    ],
  },
  {
    n: 8, label: '전시 종료 · 판매 입력 전', note: '정산이 열렸다. 판매를 입력하고 [작가에게 확인 요청] — 비율 0% 로 요청하면 확인창이 뜬다.',
    dates: { start: -50, deadline: -35, submission: -25, showStart: -18, showEnd: -2 }, flags: { recruitmentClosed: true, confirmed: true, ended: true },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete' },
      { who: 'yunseo.kang@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
      { who: 'haewon.noh@demo.artlink.local', status: 'ACCEPTED', sub: 'complete' },
    ],
  },
  {
    n: 9, label: '정산 확인 요청 중', note: 'Artist 1 은 아직 응답 전(작가 화면에 확인 요청), 강윤서는 이의 제기, 노해원은 확인 완료.',
    dates: { start: -60, deadline: -45, submission: -35, showStart: -28, showEnd: -8 }, flags: { recruitmentClosed: true, confirmed: true, ended: true, requested: 1 },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete', sold: [0, 1], approval: 'PENDING' },
      { who: 'yunseo.kang@demo.artlink.local', status: 'ACCEPTED', sub: 'complete', sold: [0], approval: 'ISSUE', comment: "'테스트 출품작 1' 판매가가 다릅니다. 120만 원이 아니라 150만 원에 팔렸어요." },
      { who: 'haewon.noh@demo.artlink.local', status: 'ACCEPTED', sub: 'complete', approval: 'APPROVED' },
    ],
  },
  {
    n: 10, label: '작가 모두 확인 · 정산 완료 전', note: '작가 전원이 정산을 확인했다. 갤러리가 [정산 완료]를 누를 차례.',
    dates: { start: -70, deadline: -55, submission: -45, showStart: -38, showEnd: -15 }, flags: { recruitmentClosed: true, confirmed: true, ended: true, requested: 4 },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete', sold: [1], approval: 'APPROVED' },
      { who: 'somin.bae@demo.artlink.local', status: 'ACCEPTED', sub: 'complete', sold: [0, 1], approval: 'APPROVED' },
    ],
  },
  {
    n: 11, label: '정산 완료', note: '모든 단계가 끝난 공모 — 양쪽 모두 [종료] 탭에 있다.',
    dates: { start: -90, deadline: -75, submission: -65, showStart: -58, showEnd: -35 }, flags: { recruitmentClosed: true, confirmed: true, ended: true, requested: 20, settled: 15 },
    people: [
      { who: 'artist1@artlink.com', status: 'ACCEPTED', sub: 'complete', sold: [0], approval: 'APPROVED' },
      { who: 'jinwoo.seo@demo.artlink.local', status: 'ACCEPTED', sub: 'complete', approval: 'APPROVED' },
    ],
  },
  {
    n: 12, label: '공모만 진행 · 모집 중', note: '선정(수락)까지만 하는 공고. Artist 1 에게는 이 공모의 초대가 와 있다(작가 [받은 초대]).',
    type: 'SOLO', capacity: 3, recruitOnly: true, dates: { start: -3, deadline: 12 },
    people: [
      { who: 'yunseo.kang@demo.artlink.local', status: 'SUBMITTED' },
      { who: 'haewon.noh@demo.artlink.local', status: 'ACCEPTED' },
    ],
    inviteArtist1: true,
  },
  {
    n: 13, label: '공모만 진행 · 선정 완료', note: '모집을 마감해 선정이 끝난 공고. Artist 1 은 미선정(작가 화면에 결과).',
    type: 'SOLO', capacity: 2, recruitOnly: true, dates: { start: -20, deadline: -5 }, flags: { recruitmentClosed: true },
    people: [
      { who: 'jiho.moon@demo.artlink.local', status: 'ACCEPTED' },
      { who: 'somin.bae@demo.artlink.local', status: 'ACCEPTED' },
      { who: 'artist1@artlink.com', status: 'REJECTED' },
    ],
  },
];

const PRICES = [1_200_000, 2_500_000, 800_000];

async function clean() {
  const targets = await prisma.exhibition.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true, title: true } });
  if (targets.length === 0) { console.log('지울 단계 공모가 없습니다.'); return; }
  const ids = targets.map((t) => t.id);
  await prisma.settlementApproval.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.artistSettlement.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.artworkSale.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.exhibition.deleteMany({ where: { id: { in: ids } } }); // 지원·제출·공지·초대는 Cascade
  console.log(`단계 공모 ${targets.length}건 삭제`);
}

async function main() {
  await clean();
  if (CLEAN) return;

  const owner = await prisma.user.findUnique({ where: { email: 'gallery@artlink.com' } });
  if (!owner) throw new Error('gallery@artlink.com 계정이 없습니다.');
  const gallery = await prisma.gallery.findFirst({ where: { ownerId: owner.id, status: 'APPROVED' }, orderBy: { id: 'asc' } });
  if (!gallery) throw new Error('gallery@artlink.com 의 승인된 갤러리가 없습니다.');

  const emails = [...new Set(STAGES.flatMap((s) => (s.people ?? []).map((p) => p.who)).concat('artist1@artlink.com'))];
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, name: true, phone: true, portfolio: { select: { images: { orderBy: { order: 'asc' }, take: 3, select: { url: true, title: true, medium: true, sizeText: true, year: true } } } } },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const missing = emails.filter((e) => !byEmail.has(e));
  if (missing.length) throw new Error(`계정이 없습니다: ${missing.join(', ')} — seed-demo 를 먼저 돌렸는지 확인하세요.`);
  const artist1 = byEmail.get('artist1@artlink.com')!;
  const poster = users.flatMap((u) => u.portfolio?.images ?? [])[0]?.url ?? null;

  const artworksOf = (u: typeof users[number]) => {
    const imgs = u.portfolio?.images ?? [];
    return [0, 1].map((i) => ({
      image: imgs[i]?.url ?? '',
      title: imgs[i]?.title || `테스트 출품작 ${i + 1}`,
      size: '60x40',
      medium: imgs[i]?.medium || '캔버스에 아크릴',
      year: imgs[i]?.year || '2026',
      price: String(PRICES[i]),
    }));
  };
  const cvOf = (u: typeof users[number]) => ({
    nameKo: u.name, nameEn: '', tel: u.phone || '010-0000-0000', email: u.email,
    education: [{ year: '2018', content: '예술대학 회화과 졸업' }],
    solo: [{ year: '2025', content: `${u.name} 개인전 「빛의 결」` }],
    group: [{ year: '2024', content: '신진작가 단체전' }], artFair: [], award: [],
  });

  // 위에서부터 단계 순서로 보이게 — 목록이 최신순이라 1단계를 가장 늦게 만든 것처럼 적는다
  const base = Date.now();
  for (const [i, st] of STAGES.entries()) {
    const createdAt = new Date(base - i * 60_000);
    const d = st.dates;
    const f = st.flags ?? {};
    const ex = await prisma.exhibition.create({
      data: {
        title: `[단계 ${String(st.n).padStart(2, '0')}] ${st.label}`,
        type: st.type ?? 'GROUP',
        capacity: st.capacity ?? 5,
        region: gallery.region ?? 'SEOUL',
        description: `확인용 테스트 공모입니다.\n\n이 단계에서 볼 것: ${st.note}`,
        imageUrl: poster,
        status: st.status ?? 'APPROVED',
        rejectReason: st.rejectReason ?? null,
        hostType: 'GALLERY',
        galleryId: gallery.id,
        recruitOnly: !!st.recruitOnly,
        deadlineStart: day(d.start),
        deadline: day(d.deadline),
        submissionDeadline: st.recruitOnly || d.submission == null ? null : day(d.submission),
        exhibitStartDate: st.recruitOnly || d.showStart == null ? null : day(d.showStart),
        exhibitDate: st.recruitOnly || d.showEnd == null ? null : day(d.showEnd),
        recruitmentClosed: !!f.recruitmentClosed,
        confirmed: !!f.confirmed,
        ended: !!f.ended,
        settlementRequestedAt: f.requested != null ? day(-f.requested) : null,
        settledAt: f.settled != null ? day(-f.settled) : null,
        customFields: st.questions ? JSON.stringify(QUESTIONS) : null,
        createdAt,
      },
    });

    for (const [pi, p] of (st.people ?? []).entries()) {
      const u = byEmail.get(p.who)!;
      const works = artworksOf(u);
      await prisma.application.create({
        data: {
          exhibitionId: ex.id, userId: u.id, status: p.status,
          biography: `${u.name}은(는) 일상의 장면을 오래 들여다보고 그 안에 남는 감정을 회화로 옮긴다.`,
          career: JSON.stringify({ artFair: [], solo: [{ year: '2025', content: `${u.name} 개인전` }], group: [{ year: '2024', content: '신진작가 단체전' }] }),
          artworkImages: JSON.stringify(works.map((w) => w.image).filter(Boolean)),
          customAnswers: st.questions ? JSON.stringify(ANSWERS[pi % ANSWERS.length]) : null,
          termsAgreedAt: createdAt, termsVersion: ARTIST_APPLY_TERMS_VERSION, termsTextHash: ARTIST_APPLY_TERMS_HASH,
          joinedVia: p.via ?? null,
          createdAt: new Date(createdAt.getTime() - pi * 1000),
        },
      });

      if (p.sub && p.sub !== 'none') {
        const list = p.sub === 'draft' ? works.slice(0, 1).map((w) => ({ ...w, draft: true })) : works;
        const complete = p.sub === 'complete';
        await prisma.exhibitionSubmission.create({
          data: {
            exhibitionId: ex.id, userId: u.id,
            artworkList: JSON.stringify(list),
            cv: complete ? JSON.stringify(cvOf(u)) : null,
            note: complete ? JSON.stringify({ statement: `${u.name}의 작가노트 — 테스트용 문장입니다. 이번 전시에서는 빛이 벽에 남기는 자국을 따라갑니다.`, sections: [{ title: works[0].title, body: '이 작품은 오후 네 시의 창가에서 시작했다.' }] }) : null,
            representativeIndex: complete ? 0 : null,
            updatedById: u.id,
          },
        });
      }

      // 정산 — 판매·비율·응답. 지문은 서버와 같은 함수로(없으면 '금액이 바뀌었다'로 읽힌다)
      if (f.ended) {
        const sales = (p.sold ?? []).map((idx) => ({ artworkIndex: idx, soldPrice: PRICES[idx], paymentMethod: idx === 1 ? 'CASH' : 'CARD' }));
        if (sales.length) {
          await prisma.artworkSale.createMany({
            data: sales.map((s) => ({ exhibitionId: ex.id, artistUserId: u.id, artworkIndex: s.artworkIndex, title: works[s.artworkIndex].title, soldPrice: s.soldPrice, paymentMethod: s.paymentMethod })),
          });
        }
        if (f.requested != null) {
          await prisma.artistSettlement.create({ data: { exhibitionId: ex.id, artistUserId: u.id, galleryRatio: 40 } });
          if (p.approval) {
            await prisma.settlementApproval.create({
              data: {
                exhibitionId: ex.id, artistUserId: u.id, status: p.approval, comment: p.comment ?? null,
                snapshot: p.approval === 'PENDING' ? null : settlementFingerprint(sales, 40, 0),
                askedAt: ago(20), // 무응답 3일 자동 수락의 기준점 — 방금 요청한 것처럼
              },
            });
          }
        }
      }
    }

    if (st.notice) {
      await prisma.exhibitionNotice.create({ data: { exhibitionId: ex.id, title: '설치 일정 안내', content: '작품 반입은 전시 시작 이틀 전 오후 2시부터 6시까지입니다. 액자 걸이는 갤러리에서 준비합니다.' } });
    }
    if (st.inviteArtist1) {
      await prisma.exhibitionInvite.create({ data: { exhibitionId: ex.id, artistId: artist1.id, senderId: owner.id, message: '작품 잘 보았습니다. 이번 공모에 함께해 주시면 좋겠어요.' } });
    }
    console.log(`  ✔ ${ex.title}  (#${ex.id})`);
  }

  console.log(`\n갤러리: gallery@artlink.com → http://localhost:5173/mypage?tab=my-exhibitions`);
  console.log(`작가  : artist1@artlink.com → http://localhost:5173/mypage?tab=applications`);
  console.log(`정리  : npx tsx scripts/seed-flow-stages.ts --clean`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
