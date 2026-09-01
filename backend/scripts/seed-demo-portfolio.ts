/**
 * 데모용 리치 포트폴리오 채우기 — 제작 화면/PDF 레이아웃을 리뷰할 수 있게
 * 작동하는 사진 + 캡션(제목·재료·크기·연도·설명·상태) + 약력·작가노트·경력·시리즈.
 * 로컬 전용. `npx tsx scripts/seed-demo-portfolio.ts [userId=1]`
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
if (process.env.NODE_ENV === 'production') { console.error('로컬 전용입니다.'); process.exit(1); }

const userId = Number(process.argv[2] || 1);

const MEDIUMS = ['Oil on canvas', 'Acrylic on canvas', 'Mixed media on panel', 'Watercolor on paper', 'Charcoal and gesso on linen'];
const SERIES = ['빛의 결', '도시의 밤', '기억의 정원'];
const TITLES = ['새벽의 창', '고요한 오후', '붉은 언덕', '물의 기억', '겨울 정원', '도시 산책', '여름의 잔상', '푸른 방', '잊혀진 골목', '달빛 아래', '정원의 노래', '바다로 가는 길'];
// 비율이 제각각이어야 포트폴리오 레이아웃·ArtLook 이 제대로 검증된다(세로/가로/정사각/파노라마).
// ⚠️ 크기(cm)는 **그림 파일의 실제 비율과 맞춰야 한다** — 세로 그림에 가로 치수를 적으면
//    ArtLook 의 크기 반영이 엉뚱해진다. 4호 소품~100호까지 퍼뜨려 크기 차이도 눈에 보이게 한다.
const DEMO_ART: [string, string][] = [
  ['dawn-window', '72.7 × 90.9 cm'],      // 30호 세로
  ['quiet-afternoon', '80 × 60 cm'],
  ['red-hill', '90.9 × 68.2 cm'],
  ['water-memory', '72.7 × 96.9 cm'],
  ['winter-garden', '100 × 80 cm'],
  ['city-walk', '125 × 100 cm'],
  ['long-summer', '162.1 × 129.7 cm'],    // 100호 가로
  ['blue-wall', '130.3 × 162.1 cm'],      // 100호 세로
  ['forgotten-alley', '60.6 × 79.7 cm'],
  ['small-room', '24.2 × 33.3 cm'],       // 4호 소품
  ['square-garden', '100 × 100 cm'],
  ['horizon', '145.5 × 60.6 cm'],         // 파노라마
];

async function main() {
  const pf = await prisma.portfolio.upsert({ where: { userId }, create: { userId }, update: {} });
  await prisma.portfolioImage.deleteMany({ where: { portfolioId: pf.id } });

  const imgs = TITLES.map((title, i) => ({
    portfolioId: pf.id,
    // ⚠️ 외부 URL(예전 picsum)을 쓰면 **로컬에서 절대 안 뜬다** — 캔버스 taint 를 피하려고
    // 이미지를 `/api/upload/image-proxy` 로 받는데, 그 프록시는 SSRF 가드로 우리 저장소
    // 주소만 통과시켜 400 을 낸다. ArtLook·포트폴리오 PDF 가 통째로 빈 화면이 됐다(2026-08-30).
    // `frontend/public/demo-art/` 의 절차적 생성 그림을 쓴다 — 동일출처라 프록시가 필요 없다.
    url: `/demo-art/${DEMO_ART[i % DEMO_ART.length][0]}.jpg`,
    order: i,
    title,
    medium: MEDIUMS[i % MEDIUMS.length],
    sizeText: DEMO_ART[i % DEMO_ART.length][1],
    year: `${2019 + (i % 6)}`,
    series: SERIES[i % SERIES.length],
    description: `${title}은(는) 《${SERIES[i % SERIES.length]}》 연작의 한 점으로, 시간의 흐름 속에서 스러지는 감정의 잔상을 담았다. 반복된 붓질과 겹쳐진 색층으로 기억의 밀도를 쌓아 올린다. 화면 가장자리에서 번지는 빛은 사라짐과 남음의 경계를 이룬다.`,
    status: i % 3 === 0 ? 'SOLD' : 'AVAILABLE',
    showInExplore: true,
  }));
  await prisma.portfolioImage.createMany({ data: imgs });

  await prisma.portfolio.update({
    where: { id: pf.id },
    data: {
      tagline: '기억의 층위를 회화로 옮기는 작가',
      biography: '2015년 홍익대학교 회화과를 졸업하고 서울을 기반으로 활동하고 있다. 일상의 풍경에서 출발해 시간과 기억, 그리고 그 사이에 남는 감정의 잔상을 회화로 번역하는 작업을 이어 왔다. 다수의 개인전과 단체전에 참여했으며, 최근에는 빛과 색의 층위를 통해 사라지는 것들을 붙드는 연작에 집중하고 있다.',
      statement: '나의 작업은 시간의 흐름 속에서 휘발되는 기억과, 그 자리에 남은 감정의 잔상을 기록하는 과정이다.\n\n반복되는 붓질은 지나간 시간을 다시 불러오는 주문과 같다. 겹쳐진 색층은 한 번에 읽히지 않으며, 오래 바라볼수록 아래에 잠긴 색들이 서서히 떠오른다. 나는 그 더딘 드러남 속에서, 우리가 무언가를 기억하는 방식을 본다.\n\n화면 가장자리에서 번지는 빛은 사라짐과 남음의 경계다. 그 경계에서 나는 소멸하지 않는 것들을 붙들려 한다.',
      career: JSON.stringify({
        education: [{ year: '2015', content: '홍익대학교 미술대학 회화과 졸업' }],
        solo: [
          { year: '2023', content: '개인전 《빛의 결》, 갤러리 인사, 서울' },
          { year: '2021', content: '개인전 《도시의 밤》, 스페이스 원, 서울' },
          { year: '2019', content: '개인전 《기억의 정원》, 아트스페이스 휴, 파주' },
        ],
        group: [
          { year: '2022', content: '《청년 회화 2022》, 국립현대미술관 서울관' },
          { year: '2021', content: '《오늘의 시선》, 부산시립미술관' },
          { year: '2020', content: '《페인팅 나우》, 세종문화회관 미술관' },
        ],
        artFair: [
          { year: '2023', content: '화랑미술제, 코엑스, 서울' },
          { year: '2022', content: 'KIAF SEOUL, 코엑스, 서울' },
        ],
        award: [
          { year: '2022', content: '제44회 중앙미술대전 우수상' },
          { year: '2018', content: '단원미술제 청년작가상' },
        ],
      }),
      seriesInfo: JSON.stringify(SERIES.map((name) => ({
        name,
        note: `《${name}》 연작은 특정한 시간대의 빛과 그 아래 놓인 사물들의 관계를 다룬다. 색을 겹겹이 쌓아 올리며, 한 장면이 기억으로 굳어 가는 과정을 화면에 옮긴다.`,
      }))),
    },
  });
  console.log(`데모 포트폴리오 채움: userId=${userId}, 작품 ${imgs.length}점`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
