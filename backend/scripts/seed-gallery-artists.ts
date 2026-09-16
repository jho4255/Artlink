/**
 * '함께한 작가' 확인용 데모 데이터 — 로컬 전용 (2026-09-16).
 *
 * 갤러리 홈페이지의 [함께한 작가]는 **그 갤러리가 운영한 공모에 수락된 작가**를 자동으로 모은다
 * (`GET /galleries/:id` 의 `artists`). 그런데 로컬 시드에는 작품이 있는 작가가 둘뿐이고 수락된 지원도
 * 한 공모에만 있어서, 갤러리를 열어도 이 섹션이 거의 비어 보였다 — 기능이 있는 줄도 모른다.
 *
 * 그래서 작가 8명을 만들어 포트폴리오를 채우고(`frontend/public/demo-art` 의 절차적 그림),
 * 갤러리 1~4 의 승인된 공모에 **수락(ACCEPTED)** 지원을 흩뿌린다. 갤러리마다 3~5명이 되게 나눈다.
 *
 * ⚠️ 외부 URL 을 쓰지 말 것 — 업로드 프록시가 SSRF 가드로 우리 저장소 주소만 통과시켜 400 을 낸다
 *    (seed-demo-portfolio.ts 와 같은 이유). `/demo-art/*.jpg` 는 프론트가 같은 출처로 서빙한다.
 * ⚠️ 이메일이 `@demo.artlink.local` 로 끝나고 `--clean` 이 그것만 지운다. 실 가입자와 안 겹친다.
 *
 *   npx tsx scripts/seed-gallery-artists.ts          # 만들기(멱등)
 *   npx tsx scripts/seed-gallery-artists.ts --clean  # 만든 것만 지우기
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
if (process.env.NODE_ENV === 'production') { console.error('로컬 전용입니다.'); process.exit(1); }

const SUFFIX = '@demo.artlink.local';

// 가나다순 색인(ㄱ/ㄴ/ㄷ …)도 함께 확인되도록 초성을 흩뿌린다
const ARTISTS = [
  { name: '강윤서', handle: 'yunseo.kang', tagline: '도시의 표면을 긁어내는 회화' },
  { name: '노해원', handle: 'haewon.noh', tagline: '물과 종이의 시간을 그린다' },
  { name: '문지호', handle: 'jiho.moon', tagline: '빛이 지나간 자리를 남기는 작업' },
  { name: '배소민', handle: 'somin.bae', tagline: '기억의 결을 쌓는 유화' },
  { name: '서진우', handle: 'jinwoo.seo', tagline: '풍경에서 출발한 추상' },
  { name: '오하린', handle: 'harin.oh', tagline: '사라지는 것들의 초상' },
  { name: '임세아', handle: 'sea.lim', tagline: '겹쳐진 색으로 쓰는 일기' },
  { name: '한도경', handle: 'dokyung.han', tagline: '선과 여백 사이의 균형' },
];

// [파일명, 크기] — 비율이 제각각이어야 정렬 격자(justifiedRows)가 제대로 보인다
const ART: [string, string][] = [
  ['dawn-window', '72.7 × 90.9 cm'],
  ['quiet-afternoon', '80 × 60 cm'],
  ['red-hill', '90.9 × 68.2 cm'],
  ['water-memory', '72.7 × 96.9 cm'],
  ['winter-garden', '100 × 80 cm'],
  ['city-walk', '125 × 100 cm'],
  ['long-summer', '162.1 × 129.7 cm'],
  ['blue-wall', '130.3 × 162.1 cm'],
  ['square-garden', '100 × 100 cm'],
  ['horizon', '145.5 × 60.6 cm'],
];
const TITLES = ['이른 아침', '창밖의 오후', '붉은 언덕', '물의 기억', '겨울 정원', '도시 산책', '긴 여름', '푸른 방', '정원', '수평선'];
const MEDIUMS = ['캔버스에 유채', '캔버스에 아크릴', '장지에 분채', '린넨에 유채', '종이에 수채'];

async function clean() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: SUFFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) { console.log('지울 데모 작가가 없습니다.'); return; }
  // 지원 → 포트폴리오 이미지 → 포트폴리오 → 유저 순. FK 를 거스르지 않게 손으로 지운다.
  await prisma.application.deleteMany({ where: { userId: { in: ids } } });
  const pfs = await prisma.portfolio.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await prisma.portfolioImage.deleteMany({ where: { portfolioId: { in: pfs.map((p) => p.id) } } });
  await prisma.portfolio.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`데모 작가 ${ids.length}명과 그들의 지원·작품을 지웠습니다.`);
}

async function main() {
  if (process.argv.includes('--clean')) return clean();

  // 갤러리 1~4 의 승인된 공모 — 갤러리마다 하나씩(가장 최근 것)
  const galleries = await prisma.gallery.findMany({
    where: { status: 'APPROVED' },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, exhibitions: { where: { status: 'APPROVED' }, orderBy: { id: 'desc' }, select: { id: true, title: true } } },
  });
  const targets = galleries.filter((g) => g.exhibitions.length > 0);
  if (targets.length === 0) { console.error('승인된 공모가 있는 갤러리가 없습니다. 먼저 시드를 돌리세요.'); process.exit(1); }

  const created: number[] = [];
  for (const [i, a] of ARTISTS.entries()) {
    const user = await prisma.user.upsert({
      where: { email: `${a.handle}${SUFFIX}` },
      update: { name: a.name, role: 'ARTIST', handle: a.handle, deletedAt: null },
      create: { email: `${a.handle}${SUFFIX}`, name: a.name, role: 'ARTIST', handle: a.handle, provider: 'LOCAL' },
    });
    created.push(user.id);

    const pf = await prisma.portfolio.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    // 작가마다 작품 수를 다르게(6~10점) — 격자 마지막 행이 채워지는 모양이 작가마다 달라야 눈에 띈다
    const count = 6 + (i % 5);
    await prisma.portfolioImage.deleteMany({ where: { portfolioId: pf.id } });
    await prisma.portfolioImage.createMany({
      data: Array.from({ length: count }, (_, k) => {
        const [file, size] = ART[(i * 3 + k) % ART.length];
        return {
          portfolioId: pf.id,
          url: `/demo-art/${file}.jpg`,
          order: k,
          title: TITLES[(i * 3 + k) % TITLES.length],
          medium: MEDIUMS[(i + k) % MEDIUMS.length],
          sizeText: size,
          year: String(2019 + ((i + k) % 7)),
          status: (i + k) % 4 === 0 ? 'SOLD' : 'AVAILABLE',
          showInExplore: true,
        };
      }),
    });
    await prisma.portfolio.update({
      where: { id: pf.id },
      data: {
        tagline: a.tagline,
        biography: `${a.name}은(는) 서울을 기반으로 활동하는 작가다. 일상에서 마주친 장면을 오래 들여다보고, 그 안에 남는 감정의 잔상을 회화로 옮긴다. 다수의 단체전과 아트페어에 참여했다.`,
        statement: '나는 지나간 시간을 다시 불러오는 방법으로 그림을 그린다.\n\n겹쳐진 색층은 한 번에 읽히지 않는다. 오래 바라볼수록 아래에 잠긴 색이 떠오르고, 그 더딘 드러남이 기억하는 방식과 닮았다고 생각한다.',
      },
    });

    // 갤러리에 고르게 흩뿌린다 — 한 작가가 두 갤러리에 걸치게 해서 '여러 갤러리와 함께한 작가'도 만든다
    const picks = [targets[i % targets.length], targets[(i + 1) % targets.length]];
    for (const g of new Set(picks)) {
      const ex = g.exhibitions[0];
      const exist = await prisma.application.findFirst({ where: { userId: user.id, exhibitionId: ex.id } });
      if (exist) {
        if (exist.status !== 'ACCEPTED') await prisma.application.update({ where: { id: exist.id }, data: { status: 'ACCEPTED' } });
      } else {
        await prisma.application.create({ data: { userId: user.id, exhibitionId: ex.id, status: 'ACCEPTED' } });
      }
    }
  }

  for (const g of targets) {
    const n = await prisma.application.count({
      where: { exhibitionId: { in: g.exhibitions.map((e) => e.id) }, status: 'ACCEPTED', user: { role: 'ARTIST', deletedAt: null } },
    });
    console.log(`갤러리 ${g.id} ${g.name} — 수락 지원 ${n}건`);
  }
  console.log(`\n데모 작가 ${created.length}명(작품 6~10점씩) 준비 완료. 되돌리려면 --clean.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
