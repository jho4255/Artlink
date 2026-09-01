// 측정용 합성 작가 — **실제 가입자 데이터를 쓰지 않는다**(개인정보가 스크래치패드에 남지 않게).
// 대신 실서버 40명 조사에서 나온 분포를 흉내낸다: 작품 중앙 8점 · 한줄소개 거의 없음 ·
// 작가노트 대부분 없음 · 경력 편차 극심(0~72건).
const 재료 = ['캔버스에 유채', '장지에 분채', '한지에 수묵담채', 'Acrylic on canvas', '캔버스에 아크릴, 콜라주'];
const 제목 = ['달빛 아래', '여름의 기억', '흔적 · 열두 번째', '이름 없는 정원에서 보낸 아주 긴 여름날의 오후', 'Untitled', '숨', '푸른 방', '겨울 산책'];

const 작가노트 = `나는 오랫동안 사라지는 것들을 그려 왔다. 빛이 벽을 타고 넘어가는 짧은 순간, 물이 마르면서 남기는 얼룩, 사람이 떠난 자리에 남은 온기 같은 것들이다.

이 그림들은 대상을 재현하려는 시도가 아니다. 오히려 대상이 사라진 뒤에도 남아 있는 감각의 잔상을 붙잡으려는 반복적인 실패에 가깝다. 붓을 들 때마다 나는 그 실패를 조금 더 정확하게 기록하는 법을 배운다.

색은 기억의 온도를 따라간다. 차가운 회색은 겨울 아침의 창을, 눅눅한 갈색은 오래된 나무 바닥을 불러온다. 나는 그 온도를 먼저 정하고 형태는 나중에 따라오게 둔다.`;

const 약력_짧음 = `1988년 서울 출생.
서울에서 작업하고 있다.`;

const 약력_긴 = `1988년 서울에서 태어났다.
2012년 홍익대학교 회화과를 졸업하고 2015년 같은 학교 대학원에서 석사학위를 받았다.
2016년부터 2019년까지 경기도 파주의 공동 작업실에서 활동했으며, 이후 서울 성북구에 개인 작업실을 두고 작업을 이어 오고 있다.
2018년 서울문화재단 신진작가 지원사업에 선정되었고, 2021년에는 국립현대미술관 고양레지던시에 입주하였다.
회화를 중심으로 하되 드로잉과 판화 작업을 병행한다.
현재 여러 대학에 출강하며 후학을 지도하고 있다.`;

const 무공백 = '빛이사라지는순간에관하여오래생각했고그생각은대개실패로끝났지만그실패의기록이곧이그림들이며나는그것을부끄러워하지않는다왜냐하면그림이란본래완성되지않는것이고완성되지않는다는사실이야말로그림을계속그리게하는유일한이유이기때문이다';

const 설명_긴 = '이 작업은 2023년 겨울 강원도 고성에서 머무는 동안 시작되었다. 매일 같은 시간에 같은 창을 바라보며 빛이 방을 가로지르는 속도를 기록했고, 그 기록이 층층이 쌓여 화면이 되었다. 물감은 얇게 여러 번 올렸으며 마지막 층은 거의 투명하게 남겨 두었다.';
const 설명_짧 = '창을 통과한 빛이 바닥에 만든 얼룩을 그렸다.';

const 경력항목 = (n, pre) => Array.from({ length: n }, (_, i) => ({
  year: String(2024 - (i % 14)),
  content: `${pre} ${i + 1} 《${제목[i % 제목.length]}》, ${['갤러리 소요', '아트스페이스 휴', '금호미술관', '서울시립미술관 세마창고'][i % 4]}, 서울`,
}));

const works = (n, opts = {}) => Array.from({ length: n }, (_, i) => ({
  id: i + 1,
  url: '',                                   // 페이지에서 data URL 로 채운다
  aspect: [0.8, 1.5, 1, 1.25, 0.68][i % 5],  // 세로/가로/정사각 섞기 (회화 실제 분포)
  title: opts.longTitle && i % 3 === 0 ? 제목[3] : 제목[i % 제목.length],
  series: opts.series ? ['잔상', '겨울의 방'][i % 2] : null,
  medium: opts.meta === false ? null : 재료[i % 재료.length],
  width: opts.meta === false ? null : [72, 130, 45, 162][i % 4],
  height: opts.meta === false ? null : [60, 97, 53, 130][i % 4],
  year: opts.meta === false ? null : String(2019 + (i % 6)),
  status: ['AVAILABLE', 'SOLD', 'NFS', 'AVAILABLE'][i % 4],
  description: opts.desc === 'long' ? 설명_긴 : opts.desc === 'short' ? 설명_짧 : null,
  order: i,
}));

export const ARTISTS = {
  // 실서버 중앙값 — 대부분의 작가가 실제로 이렇다
  typical: {
    user: { name: '김서연', email: 'artist@example.com', phone: '010-0000-0000', instagramUrl: 'https://instagram.com/example' },
    tagline: null, statement: null, biography: 약력_짧음,
    career: { education: 경력항목(2, '학력'), solo: 경력항목(2, '개인전'), group: 경력항목(5, '단체전'), artFair: [], award: [] },
    seriesInfo: null, images: works(8, { desc: 'short' }), year: '2026',
  },
  // 다 채운 작가 — 30점 상한
  rich: {
    user: { name: '박지우', email: 'jiwoo@example.com', phone: '010-1111-2222', instagramUrl: 'https://instagram.com/jiwoo' },
    tagline: '사라지는 것들의 온도를 기록합니다',
    statement: 작가노트, biography: 약력_긴,
    career: { education: 경력항목(3, '학력'), solo: 경력항목(11, '개인전'), group: 경력항목(38, '단체전'), artFair: 경력항목(9, '아트페어'), award: 경력항목(11, '수상') },
    seriesInfo: [{ name: '잔상', note: 설명_긴 }, { name: '겨울의 방', note: 설명_짧 }],
    images: works(30, { desc: 'long', series: true, longTitle: true }), year: '2026',
  },
  // 최악 콘텐츠 — 무공백 장문·아주 긴 제목
  stress: {
    user: { name: '정하늘하늘하늘', email: 'verylongemailaddress.for.testing@example.co.kr', phone: '010-3333-4444', instagramUrl: 'https://instagram.com/averyverylonghandlename' },
    tagline: 무공백.slice(0, 80),
    statement: `${무공백}\n\n${무공백}\n\n${무공백}`,
    biography: `${무공백}\n${무공백.slice(0, 60)}\n${무공백.slice(0, 90)}`,
    career: { education: 경력항목(1, '학력'), solo: [{ year: '2024', content: 무공백.slice(0, 120) }], group: 경력항목(20, '단체전'), artFair: [], award: [] },
    seriesInfo: [{ name: 무공백.slice(0, 30), note: 무공백 }],
    images: works(6, { desc: 'long', longTitle: true, series: true }).map((w) => ({ ...w, title: 무공백.slice(0, 40), medium: 무공백.slice(0, 30), description: 무공백 })),
    year: '2026',
  },
  // 갓 가입한 작가 — 사진 1장, 나머지 비어 있음
  minimal: {
    user: { name: '이도현', email: 'do@example.com', phone: null, instagramUrl: null },
    tagline: null, statement: null, biography: null,
    career: {}, seriesInfo: null, images: works(1, { meta: false }), year: '2026',
  },
};
