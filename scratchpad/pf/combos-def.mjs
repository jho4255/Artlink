/** 20조합 정의 — `combos.mjs`(렌더)와 `review.mjs`(계측)가 같이 쓴다. */
// ── 작가 ────────────────────────────────────────────────────────────────
// fill='all' 은 작품정보가 통째로 비어 있어 우리가 채우는 작가다.
const ARTISTS = {
  503: { name: '박기량', note: '작품정보 전부 실데이터 · 시리즈 5 · 작가노트' },
  574: { name: '김다은', note: '작품정보 전부 실데이터 · 작가노트 1466자' },
  540: { name: '최성원', note: '제목·재료·크기 실데이터, 연도만 채움' },
  526: { name: '마은영', note: '작품정보 대역(원본은 전무)' },
  537: { name: '윤정열', note: '작품정보 대역(원본은 전무)' },
  521: { name: '오무',   note: '작품정보 대역 · 약력 1246자' },
};

// ── 20조합 ──────────────────────────────────────────────────────────────
// 표지 15종 전부 · 작품배치 7종+자동 전부 · 판형 3종 · 글꼴 6종 · 배경 8종을 한 번씩은 지나간다.
const D = (o) => ({ coverEyebrow: true, coverYear: true, proseAlign: 'left', ...o });
const COMBOS = [
  { n: 1,  uid: 503, why: '[추천] 갤러리 제출용',        d: D({ bg:'ivory',    ink:'charcoal', accent:'plum',   font:'noto',     page:'a4-portrait',  coverLayout:'matted',      worksLayout:'hero',    desc:'short', worksCaption:'below'   }) },
  { n: 2,  uid: 574, why: '[추천] 미니멀',               d: D({ bg:'white',    ink:'black',    accent:'mono',   font:'gowun',    page:'a4-portrait',  coverLayout:'ruleFrame',   worksLayout:'hero',    desc:'none',  worksCaption:'below'   }) },
  { n: 3,  uid: 503, why: '[추천] 에디토리얼',           d: D({ bg:'white',    ink:'charcoal', accent:'red',    font:'myeongjo', page:'a4-portrait',  coverLayout:'side',        worksLayout:'feature', desc:'short', worksCaption:'left'    }) },
  { n: 4,  uid: 526, why: '[추천] 작품 우선(전면)',      d: D({ bg:'white',    ink:'black',    accent:'mono',   font:'gothic',   page:'a4-landscape', coverLayout:'fullTint',    worksLayout:'full',    desc:'none',  worksCaption:'minimal' }) },
  { n: 5,  uid: 521, why: '[추천] 다크',                 d: D({ bg:'ink',      ink:'white',    accent:'orange', font:'plex',     page:'a4-landscape', coverLayout:'split',       worksLayout:'hero',    desc:'short', worksCaption:'below'   }) },
  { n: 6,  uid: 537, why: '[추천] 다작 모아보기',        d: D({ bg:'white',    ink:'charcoal', accent:'mono',   font:'plex',     page:'a4-portrait',  coverLayout:'grid2x2',     worksLayout:'grid',    desc:'none',  worksCaption:'below'   }) },
  { n: 7,  uid: 503, why: '자동 편집(새 사용자 기본값)', d: D({ bg:'white',    ink:'black',    accent:'red',    font:'myeongjo', page:'a4-portrait',  coverLayout:'bandTop',     auto:true,             desc:'short', worksCaption:'below'   }) },
  { n: 8,  uid: 526, why: '자동 편집 · 가로 판형',       d: D({ bg:'sand',     ink:'brown',    accent:'gold',   font:'gothic',   page:'a4-landscape', coverLayout:'mosaic',      auto:true,             desc:'short', worksCaption:'below'   }) },
  { n: 9,  uid: 503, why: '뮤지엄 라벨(작품+설명)',      d: D({ bg:'ivory',    ink:'charcoal', accent:'mono',   font:'noto',     page:'a4-portrait',  coverLayout:'bandBottom',  worksLayout:'label',   desc:'full',  worksCaption:'below'   }) },
  { n: 10, uid: 526, why: '6점 목록(도판 색인)',         d: D({ bg:'white',    ink:'charcoal', accent:'mono',   font:'gothic',   page:'a4-portrait',  coverLayout:'stacked',     worksLayout:'index',   desc:'none',  worksCaption:'minimal' }) },
  { n: 11, uid: 574, why: '2점씩',                       d: D({ bg:'blush',    ink:'brown',    accent:'plum',   font:'gowun',    page:'a4-portrait',  coverLayout:'squareHero',  worksLayout:'duo',     desc:'short', worksCaption:'below'   }) },
  { n: 12, uid: 537, why: '4점 격자 · 와이드(16:9)',     d: D({ bg:'mist',     ink:'navy',     accent:'blue',   font:'plex',     page:'wide',         coverLayout:'colorBand',   worksLayout:'grid',    desc:'none',  worksCaption:'below'   }) },
  { n: 13, uid: 521, why: '1점 크게 · 와이드 · 남색',    d: D({ bg:'navy',     ink:'cream',    accent:'gold',   font:'gothic',   page:'wide',         coverLayout:'accentField', worksLayout:'hero',    desc:'short', worksCaption:'below'   }) },
  { n: 14, uid: 526, why: '전면 · 짙은 회색',            d: D({ bg:'graphite', ink:'cream',    accent:'orange', font:'plex',     page:'a4-landscape', coverLayout:'fullTint',    worksLayout:'full',    desc:'none',  worksCaption:'minimal' }) },
  { n: 15, uid: 540, why: '1점 크게+2점 작게',           d: D({ bg:'white',    ink:'black',    accent:'red',    font:'myeongjo', page:'a4-portrait',  coverLayout:'mosaic',      worksLayout:'feature', desc:'short', worksCaption:'below'   }) },
  { n: 16, uid: 574, why: '라벨 · 가로 판형',            d: D({ bg:'ivory',    ink:'charcoal', accent:'green',  font:'noto',     page:'a4-landscape', coverLayout:'side',        worksLayout:'label',   desc:'full',  worksCaption:'below'   }) },
  { n: 17, uid: 503, why: '사진 없는 표지(타이포)',      d: D({ bg:'sand',     ink:'brown',    accent:'mono',   font:'gowun',    page:'a4-portrait',  coverLayout:'serifCenter', worksLayout:'hero',    desc:'short', worksCaption:'below'   }) },
  { n: 18, uid: 537, why: '명패 표지 · 2점씩',           d: D({ bg:'white',    ink:'slate',    accent:'blue',   font:'nanum',    page:'a4-portrait',  coverLayout:'nameplate',   worksLayout:'duo',     desc:'short', worksCaption:'left'    }) },
  { n: 19, uid: 503, why: '4점 격자 · 먹색 바탕',        d: D({ bg:'ink',      ink:'cream',    accent:'gold',   font:'nanum',    page:'a4-landscape', coverLayout:'grid2x2',     worksLayout:'grid',    desc:'none',  worksCaption:'below'   }) },
  { n: 20, uid: 521, why: '가운데 액자 표지 · 목록',     d: D({ bg:'mist',     ink:'charcoal', accent:'mono',   font:'myeongjo', page:'wide',         coverLayout:'matted',      worksLayout:'index',   desc:'none',  worksCaption:'minimal' }) },
];


export { ARTISTS, COMBOS };
