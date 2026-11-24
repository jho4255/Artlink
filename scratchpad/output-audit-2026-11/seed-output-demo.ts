/**
 * 갤러리 자동화 결과물(캡션·출품 자료 PDF·도록·정산서·지원서) 품질 점검용 공모 하나 — 로컬 데모 DB 전용 (2026-11-24).
 *
 *   cd backend && DATABASE_URL=<로컬 데모 DB> npx tsx ../scratchpad/output-audit-2026-11/seed-output-demo.ts          # 만들기(다시 돌리면 지우고 새로)
 *   cd backend && DATABASE_URL=<로컬 데모 DB> npx tsx ../scratchpad/output-audit-2026-11/seed-output-demo.ts --clean  # 지우기
 *
 * 실서버 자료의 **모양**을 닮게 만든다(2026-11-15 복제본 집계 — 내용은 전부 지어낸 것):
 *   단체전 작가 12~18명 · 작가당 작품 중간 8점(최대 18) · 제목 평균 11자(최대 46, 3분의 1은 영문) · 재료 평균 18자(최대 90, 대소문자 제각각)
 *   작가노트 중간 973자(상위 10% 2,091자 · 최대 4,526자) · 43%가 작품별 설명(최대 11개, 본문 평균 352자 · 최대 1,565자)
 *   약력 개인전 평균 3(최대 14) · 단체전 평균 10(최대 46) · 아트페어 최대 40 · 수상 최대 9 · 학력은 아무도 안 적음
 * 회원 작가 8명(데모 계정) + 비회원 작가 2명 · 전시 종료 · 판매 14점(카드/현금) · 정산 확인 요청 중.
 */
import prisma from '../../backend/src/lib/prisma';
import { createGuestArtist, deleteGuestUsers, guestIdsOfExhibitions } from '../../backend/src/lib/guestArtists';
import { ARTIST_APPLY_TERMS_VERSION, ARTIST_APPLY_TERMS_HASH } from '../../backend/src/lib/terms';

const TITLE = '[점검] 2027 봄 기획전 《겹과 결》';
const CLEAN = process.argv.includes('--clean');

const dbUrl = process.env.DATABASE_URL ?? '';
if (process.env.NODE_ENV === 'production' || !/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) || /prod/i.test(dbUrl)) {
  console.error('⛔ 로컬 데모 DB(localhost/artlink)에서만 실행합니다.');
  process.exit(1);
}

const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const day = (n: number) => { const d = new Date(`${todayKst}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d; };

// 고정 난수 — 다시 돌려도 같은 자료
let seed = 20261124;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;

const IMAGES = ['blue-wall', 'city-walk', 'dawn-window', 'forgotten-alley', 'horizon', 'long-summer', 'quiet-afternoon', 'red-hill', 'small-room', 'square-garden', 'water-memory', 'winter-garden']
  .map((n) => `/demo-art/${n}.jpg`);

const TITLES_KO = ['새벽의 창', '붉은 언덕', '겨울 정원', '물의 기억', '조용한 오후', '작은 방', '잊힌 골목', '긴 여름', '수평선', '푸른 벽', '네모난 정원', '도시 산책',
  '겹', '결', '머무는 빛', '숨', '사이', '오래된 문', '남겨진 자리', '흐르는 것들'];
const TITLES_EN = ['Untitled (Blue Hour) No. 3', 'The Weight of Soft Things', 'Afterimage', 'Layers of Silence II', 'Somewhere Between', 'Still, Life', 'A Room of Light', 'Fold #12'];
const LONG_TITLE = '아무도 없는 오후 네 시의 거실에 남아 있던 빛과 그 빛을 기억하는 방법에 대하여';
const MEDIUMS = ['Acrylic on canvas', 'Acrylic on Canvas', 'acrylic on canvas', 'Oil on canvas', 'Oil on Canvas', '장지에 혼합재료', '장지에 채색, 혼합재료', '혼합재료',
  'Mixed media on unbleached cotton fabric', 'Mixed media on Canvas', '캔버스에 유채', '종이에 과슈'];
const LONG_MEDIUM = 'Acrylic, oil pastel, charcoal, colored pencil and collage on unbleached cotton canvas';
const SIZES = ['20×20 cm', '24.2×24.2 cm', '33.4×24.2 cm', '15×15 cm', '30×30 cm', '31.8×40.9 cm', '40.9×31.8 cm', '45.5×45.5 cm', '72.7×60.6 cm', '116.8×91.0 cm'];
const PRICES = [120000, 150000, 170000, 200000, 250000, 300000, 350000, 400000, 450000, 500000, 600000, 700000, 800000, 1000000, 1800000, 3500000];

const PARAS = [
  '나는 오래 들여다본 것들을 그린다. 창가에 놓인 컵, 벽에 남은 못 자국, 해가 기울 때 바닥에 길게 눕는 그림자 같은 것들이다. 대단한 사건은 없지만 그 앞에 서면 시간이 조금 느려진다.',
  '작업은 대개 얇은 층을 여러 번 올리는 일에서 시작한다. 마르기를 기다렸다가 다시 덮고, 덮은 것을 긁어내고, 긁어낸 자리에 처음 칠한 색이 비치면 그제야 화면이 숨을 쉬기 시작한다.',
  '겹은 시간의 다른 이름이다. 한 번에 칠한 색은 평평하지만 열 번에 걸쳐 올린 색은 깊이를 갖는다. 나는 그 깊이 안에 내가 지나온 계절과 다 하지 못한 말들이 함께 묻혀 있다고 믿는다.',
  '결은 재료가 스스로 가진 방향이다. 장지의 섬유, 캔버스의 올, 나무의 나이테는 내가 정한 것이 아니다. 나는 그 방향을 거스르지 않으려 하고, 거스를 때는 그 까닭을 화면에 남겨 두려 한다.',
  '색을 고를 때는 기억에 기대는 편이다. 어린 시절 살던 집의 부엌 타일, 장마가 끝난 뒤의 하늘, 오래 입은 스웨터의 색. 정확한 색이 아니라 그 색을 떠올릴 때의 온도를 옮기려고 한다.',
  '이번 전시에 내는 작품들은 지난 두 해 동안 작업실 창으로 본 풍경에서 나왔다. 같은 창인데도 아침과 저녁이 다르고, 봄과 겨울이 다르다. 나는 그 차이를 기록하기보다 그 차이 앞에서 내가 어떻게 달라지는지를 그렸다.',
  '그림 앞에서 무엇을 보아야 하는지 묻는 분들이 있다. 나는 무엇을 보아도 좋다고 답한다. 다만 조금 오래 서 있어 주기를 바란다. 천천히 보면 처음에는 보이지 않던 층이 하나씩 올라온다.',
  '작업실은 늘 조용하다. 라디오도 틀지 않는다. 붓이 화면을 지나가는 소리와 물이 마르는 시간만 있다. 그 조용함이 그림에 남아서 보는 사람에게도 건너가면 좋겠다.',
];
const prose = (chars: number) => {
  if (chars <= 0) return '';
  let out = '';
  let i = Math.floor(rnd() * PARAS.length);
  while (out.length < chars) { out += (out ? (rnd() < 0.25 ? '\n' : '\n\n') : '') + PARAS[i % PARAS.length]; i += 1; }
  return out.slice(0, chars).replace(/[^.다요]*$/, '') || out.slice(0, chars);
};

// 작가마다: 작품 수 · 작가노트 길이 · 작품별 설명 수 · 약력 항목 수 — 실서버 분포의 가운데와 양 끝을 다 넣는다
const SHAPES = [
  { n: 8, note: 973, sec: 0, solo: 3, group: 10, fair: 2, award: 1 },      // 가운데
  { n: 12, note: 2091, sec: 5, solo: 5, group: 18, fair: 6, award: 3 },    // 상위 10%
  { n: 6, note: 320, sec: 2, solo: 1, group: 4, fair: 0, award: 0 },       // 짧은 쪽
  { n: 14, note: 1082, sec: 0, solo: 14, group: 46, fair: 40, award: 9 },  // 약력이 아주 긴 작가
  { n: 5, note: 4526, sec: 3, solo: 2, group: 8, fair: 1, award: 0 },      // 작가노트가 아주 긴 작가
  { n: 9, note: 1500, sec: 11, solo: 4, group: 12, fair: 3, award: 2 },    // 작품별 설명이 가장 많은 작가
  { n: 18, note: 800, sec: 0, solo: 2, group: 9, fair: 5, award: 1 },      // 작품이 가장 많은 작가
  { n: 7, note: 600, sec: 0, solo: 0, group: 3, fair: 0, award: 0 },       // 신진
];
const GUESTS = [
  { name: '한지우', n: 3, note: 0, sec: 0, solo: 1, group: 2, fair: 0, award: 0 },   // 비회원 · 작가노트 없음
  { name: '윤서해', n: 8, note: 900, sec: 2, solo: 2, group: 6, fair: 1, award: 0 },
];
const MEMBER_EMAILS = ['yunseo.kang', 'haewon.noh', 'jiho.moon', 'somin.bae', 'jinwoo.seo', 'harin.oh', 'sea.lim', 'dokyung.han'].map((s) => `${s}@demo.artlink.local`);

const QUESTIONS = [
  { id: 'q-schedule', label: '작품 운송·설치가 가능한 일정을 적어주세요', type: 'text', required: true, maxLength: 200 },
  { id: 'q-space', label: '희망 전시 공간', type: 'select', required: false, options: ['1층 메인홀', '2층 소전시실'], maxSelect: 1 },
  { id: 'q-goods', label: '함께 판매하고 싶은 것(여러 개 선택)', type: 'multiselect', required: false, options: ['엽서', '도록', '에디션 판화', '없음'], maxSelect: 0 },
];

function worksFor(shape: { n: number }, ai: number) {
  return Array.from({ length: shape.n }, (_, i) => {
    const r = rnd();
    const title = ai === 4 && i === 0 ? LONG_TITLE
      : r < 0.33 ? pick(TITLES_EN)
      : r < 0.55 ? `${pick(TITLES_KO)} #${i + 1}` : pick(TITLES_KO);
    const price = ai === 2 && i === 1 ? '비매' : String(pick(PRICES));
    return {
      image: IMAGES[(ai * 5 + i * 7) % IMAGES.length]!, title,
      size: pick(SIZES), medium: ai === 5 && i === 2 ? LONG_MEDIUM : pick(MEDIUMS), year: rnd() < 0.75 ? '2026' : pick(['2025', '2024', '2023']), price,
    };
  });
}
const entries = (n: number, label: string) => Array.from({ length: n }, (_, i) => ({
  year: String(2026 - Math.floor((i * 9) / Math.max(n, 9))),
  content: `${label === 'solo' ? `개인전 「${pick(TITLES_KO)}」` : label === 'group' ? `단체전 「${pick(TITLES_KO)}와 ${pick(TITLES_KO)}」` : label === 'fair' ? `${pick(['서울', '부산', '대구', '인천'])} ${pick(['아트페어', '국제아트쇼', '호텔아트페어'])}` : `${pick(['신진작가상', '청년미술대전 입선', '레지던시 입주작가 선정'])}`}, ${pick(['갤러리 온', '스페이스 결', '아트스페이스 봄', '갤러리 사이', '문화공간 숨'])}, ${pick(['서울', '부산', '대전', '광주', '제주'])}`,
}));
function submissionOf(name: string, tel: string, email: string | null, shape: typeof SHAPES[number], ai: number) {
  const works = worksFor(shape, ai);
  const secTitles = works.slice(0, shape.sec);
  return {
    works,
    cv: { nameKo: name, nameEn: '', tel, email: email ?? '', education: [], solo: entries(shape.solo, 'solo'), group: entries(shape.group, 'group'), artFair: entries(shape.fair, 'fair'), award: entries(shape.award, 'award') },
    note: shape.note || shape.sec ? {
      statement: prose(shape.note),
      sections: secTitles.map((w, i) => ({ title: w.title, body: prose(ai === 5 && i === 0 ? 1565 : 150 + Math.floor(rnd() * 500)) })),
    } : null,
  };
}

async function clean() {
  const old = await prisma.exhibition.findMany({ where: { title: TITLE }, select: { id: true } });
  if (!old.length) return;
  const ids = old.map((e) => e.id);
  const guests = await guestIdsOfExhibitions(prisma, ids);
  await prisma.settlementApproval.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.artistSettlement.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.artworkSale.deleteMany({ where: { exhibitionId: { in: ids } } });
  await prisma.exhibition.deleteMany({ where: { id: { in: ids } } });
  await deleteGuestUsers(prisma, guests);
  console.log(`지웠다 — 공모 ${old.length}건 · 비회원 작가 ${guests.length}명`);
}

async function main() {
  await clean();
  if (CLEAN) return;
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'gallery@artlink.com' } });
  const gallery = await prisma.gallery.findFirstOrThrow({ where: { ownerId: owner.id, status: 'APPROVED' }, orderBy: { id: 'asc' } });
  const members = await prisma.user.findMany({ where: { email: { in: MEMBER_EMAILS } }, orderBy: { id: 'asc' } });
  if (members.length !== MEMBER_EMAILS.length) throw new Error('데모 작가 계정이 모자랍니다 — seed-gallery-artists.ts 를 먼저 돌리세요.');

  const ex = await prisma.exhibition.create({
    data: {
      title: TITLE, type: 'GROUP', capacity: 10, region: gallery.region ?? 'SEOUL',
      description: `<p>${PARAS[2]}</p><p>${PARAS[3]}</p><p>열 명의 작가가 저마다의 겹과 결로 봄을 맞는다. 회화와 한지 작업 아흔 점을 한자리에 건다.</p>`,
      imageUrl: '/demo-art/water-memory.jpg', status: 'APPROVED', hostType: 'GALLERY', galleryId: gallery.id,
      deadlineStart: day(-70), deadline: day(-50), selectionDeadline: day(-45), submissionDeadline: day(-30),
      exhibitStartDate: day(-20), exhibitDate: day(-3), recruitmentClosed: true, confirmed: true, ended: true,
      settlementRequestedAt: new Date(), cardFeeRate: 3.3, customFields: JSON.stringify(QUESTIONS),
    },
  });

  let total = 0;
  const sold: { uid: number; idx: number; title: string; price: number }[] = [];
  const putSubmission = async (uid: number, s: ReturnType<typeof submissionOf>, by: number) => {
    await prisma.exhibitionSubmission.create({
      data: { exhibitionId: ex.id, userId: uid, updatedById: by, representativeIndex: Math.min(1, s.works.length - 1),
        artworkList: JSON.stringify(s.works), cv: JSON.stringify(s.cv), note: s.note ? JSON.stringify(s.note) : null },
    });
    total += s.works.length;
    s.works.forEach((w, idx) => { if (/^\d+$/.test(w.price) && rnd() < 0.17) sold.push({ uid, idx, title: w.title, price: Number(w.price) }); });
  };

  for (const [i, u] of members.entries()) {
    const shape = SHAPES[i]!;
    const s = submissionOf(u.name, `010-0000-${String(1000 + i * 111).slice(0, 4)}`, u.email, shape, i);
    await prisma.application.create({
      data: {
        exhibitionId: ex.id, userId: u.id, status: 'ACCEPTED', biography: prose(260 + i * 60),
        career: JSON.stringify({ education: i % 3 === 0 ? [{ year: '2018', content: '예술대학 회화과 졸업' }] : [], solo: s.cv.solo.slice(0, 6), group: s.cv.group.slice(0, 12), artFair: s.cv.artFair.slice(0, 6), award: s.cv.award }),
        artworkImages: JSON.stringify(s.works.slice(0, 5 + (i % 6)).map((w) => w.image)),
        customAnswers: JSON.stringify([
          { fieldId: 'q-schedule', value: i % 2 ? '주말 오전에 직접 가져가겠습니다. 대형 작품 두 점은 화물로 따로 보냅니다.' : '3월 둘째 주 평일 오후 가능합니다.' },
          { fieldId: 'q-space', value: i % 2 ? '2층 소전시실' : '1층 메인홀' },
          { fieldId: 'q-goods', value: i % 3 === 0 ? ['엽서', '에디션 판화'] : ['없음'] },
        ]),
        termsAgreedAt: day(-60), termsVersion: ARTIST_APPLY_TERMS_VERSION, termsTextHash: ARTIST_APPLY_TERMS_HASH,
        createdAt: new Date(day(-60).getTime() + i * 60_000),
      },
    });
    await putSubmission(u.id, s, u.id);
  }
  for (const [gi, g] of GUESTS.entries()) {
    const gu = await createGuestArtist(ex.id, g.name, owner.id);
    await putSubmission(gu.id, submissionOf(g.name, '010-0000-0000', null, g, SHAPES.length + gi), owner.id);
  }

  // 판매·비율 — 카드/현금을 섞는다. 확인 요청은 회원에게만(비회원은 요청 없음, 규칙 91)
  const picked = sold.slice(0, 14);
  await prisma.artworkSale.createMany({
    data: picked.map((s, i) => ({ exhibitionId: ex.id, artistUserId: s.uid, artworkIndex: s.idx, title: s.title, soldPrice: s.price, paymentMethod: i % 3 === 1 ? 'CASH' : 'CARD' })),
  });
  const everyone = (await prisma.exhibitionSubmission.findMany({ where: { exhibitionId: ex.id }, select: { userId: true } })).map((r) => r.userId);
  for (const [i, uid] of everyone.entries()) {
    await prisma.artistSettlement.create({ data: { exhibitionId: ex.id, artistUserId: uid, galleryRatio: [40, 50, 30][i % 3]! } });
  }
  for (const u of members) {
    await prisma.settlementApproval.create({ data: { exhibitionId: ex.id, artistUserId: u.id, status: 'PENDING', askedAt: new Date() } });
  }

  console.log(`만들었다 — 공모 #${ex.id} "${TITLE}" · 작가 ${everyone.length}명 · 작품 ${total}점 · 판매 ${picked.length}점`);
  console.log(`갤러리: gallery@artlink.com → http://localhost:5183/mypage?tab=my-exhibitions&ex=${ex.id}&view=submissions`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
