/**
 * 실데이터에 **빠진 작품정보만** 채운다 (제목·재료·크기·연도·설명·시리즈).
 *
 * 왜 필요한가 — 실서버 작가 31명 중 작품정보를 채운 사람은 3명뿐이다(2026-09-13 실측).
 * 그대로 뽑으면 캡션이 통째로 빠지므로(`captionParts` 가 빈 캡션은 자리조차 예약하지 않는다)
 * 20조합 중 대부분이 "그림만 있는 같은 얼굴"로 나와 배치를 비교할 수 없다.
 *
 * ⚠️ **여기서 만든 글은 그 작가가 쓴 것이 아니다.** 사진·이름·약력은 실제 것이고
 *    작품정보만 대역이다. 결과물은 로컬 디자인 검토용이며 커밋·배포·공유 금지.
 * ⚠️ 이미 값이 있으면 **절대 덮어쓰지 않는다** — 실데이터가 언제나 우선이다.
 * ⚠️ 크기는 사진의 실제 비율에서 만든다(짧은 변을 호수 치수에서 고르고 긴 변을 계산).
 *    비율과 어긋난 치수를 적으면 ArtLook 실치수 배치와 캡션이 서로 거짓말을 한다.
 */

/** 작가별 대역 프로필 — 실제 그림을 보고 정했다(재료·소재·화면) */
export const PROFILES = {
  526: {
    // 밝은 색띠 하늘 위의 열기구와 동물들, 사바나 풍경. 세필까지 들어간 채색
    mediums: ['캔버스에 아크릴', '캔버스에 아크릴, 유채'],
    shortSides: [45.5, 53.0, 60.6, 72.7, 90.9],
    years: ['2022', '2023', '2024', '2025', '2026'],
    series: [
      { name: '여행자', count: 10, note: '어디로 가는지 묻지 않는 여행을 그린다. 기구에 올라탄 것들은 서로 다른 곳에서 왔지만 같은 바람을 타고 간다.' },
      { name: '초원의 시간', count: 9, note: '하루의 빛이 초원을 건너가는 속도를 색의 띠로 옮겼다. 멀리 보이는 산은 실제 풍경이면서 마음속 지형이기도 하다.' },
    ],
    titles: [
      '붉은 기구', '함께 가는 길', '출발', '언덕 위에서', '작은 행렬', '무지개 지나간 자리', '먼 산을 보다',
      '동행', '바람의 방향', '높이 더 높이', '사바나의 아침', '초원을 건너다', '물가의 오후', '그늘을 나누다',
      '해가 기울면', '긴 목의 친구', '뒤따르는 것들', '노란 오후', '구름 위의 식탁', '낮은 언덕',
      '두 개의 발자국', '멀리서 보면', '저녁이 오는 속도', '색이 지나간 자리', '돌아오는 길', '작은 소란', '첫 번째 하늘',
    ],
    descs: [
      '하늘을 가로지르는 색의 띠 위에 여행의 한 장면을 올렸다. 화면 아래의 풍경은 실제 장소가 아니라 지나온 시간에 가깝다.',
      '함께 간다는 말이 무엇인지 그리고 싶었다. 서로 닮지 않은 것들이 한 자리에 올라타 같은 방향을 본다.',
      '멀리 있는 것은 흐리게, 가까운 것은 끝까지 그린다. 거리가 곧 기억의 선명도다.',
      '색을 겹쳐 올리면 빛이 지나간 시간이 쌓인다. 초원의 노랑은 한 번에 칠한 색이 아니다.',
    ],
  },
  537: {
    // 수채 산 풍경. 파노라마 구도가 많다
    mediums: ['종이에 수채', '아르쉬지에 수채'],
    shortSides: [27.3, 33.4, 40.9, 45.5, 53.0],
    years: ['2021', '2022', '2023', '2024', '2025', '2026'],
    series: [
      { name: '산의 기록', count: 11, note: '같은 능선을 계절마다 다시 찾아가 그린다. 산은 그대로인데 매번 다른 그림이 된다.' },
      { name: '빛과 그늘', count: 10, note: '해가 능선을 넘어오는 짧은 순간만 그린다. 그늘이 물러나는 몇 분 안에 화면의 온도가 정해진다.' },
    ],
    titles: [
      '돌로미티의 아침', '고개 너머', '설산 아래 초원', '구름이 지나는 자리', '능선을 따라', '이른 빛',
      '초여름 목초지', '바위의 시간', '산장으로 가는 길', '해가 닿는 곳', '오후의 그늘', '먼 봉우리',
      '눈이 남은 자리', '초록이 오는 속도', '길은 굽어 있다', '비 갠 뒤', '낮은 구름', '골짜기의 소리',
      '바람이 지나간 능선', '해질 무렵의 암벽', '다시 그 자리',
    ],
    descs: [
      '빛이 능선을 넘어오는 짧은 순간을 기다려 그렸다. 물감이 마르기 전에 번지는 자리를 남겨 공기가 지나간 흔적을 붙잡는다.',
      '바위는 덧칠하지 않는다. 한 번에 올린 붓자국이 곧 그 바위의 단단함이다.',
      '초록은 한 가지 색이 아니다. 목초지에 앉아 보면 대여섯 개의 초록이 시간마다 자리를 바꾼다.',
      '흰 종이를 남기는 일이 그리는 일보다 어렵다. 눈과 구름은 칠하지 않은 자리에서 나온다.',
    ],
  },
  521: {
    // 흰 바탕에 두꺼운 파란 임파스토 형상. 미니멀
    mediums: ['캔버스에 유채', '캔버스에 유채, 연필'],
    shortSides: [72.7, 90.9, 112.1],
    years: ['2023', '2024', '2025', '2026'],
    series: [
      { name: 'BLUE', count: 7, note: '파랑 하나로만 그린다. 색을 줄이면 두께와 자국이 대신 말을 한다.' },
      { name: '두 개의 형태', count: 6, note: '무엇인지 말하지 않는 형태 둘을 나란히 놓는다. 관계는 보는 사람이 만든다.' },
    ],
    titles: [
      '파란 것 01', '파란 것 02', '나란히', '둘', '작은 발', '서 있는 것', '기다리는 자세',
      '두 개의 형태 01', '두 개의 형태 02', '가까이', '멀찍이', '같은 방향', '남겨 둔 자리',
    ],
    descs: [
      '형태를 설명하지 않는다. 두꺼운 물감이 지나간 자리와 남겨 둔 바탕 사이에서 무엇인가가 서 있을 뿐이다.',
      '붓 대신 나이프로 밀어 올린다. 물감이 걸리는 자리마다 바탕색이 드러나 형태에 숨구멍이 생긴다.',
      '바탕을 비워 둘수록 형태가 커진다. 화면의 대부분은 그리지 않은 자리다.',
    ],
  },
};

const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 사진 비율에서 실제로 있을 법한 치수를 만든다 */
function sizeFrom(aspect, pool, i) {
  const short = pool[i % pool.length];
  const a = aspect && isFinite(aspect) && aspect > 0 ? aspect : 1;
  const [w, h] = a >= 1 ? [round1(short * a), short] : [short, round1(short / a)];
  return `${fmt(w)} × ${fmt(h)} cm`;
}

/**
 * @param pf   실서버 `/api/portfolio/:id` 응답
 * @param id   작가 id
 * @param dims url → {w,h} (sharp 로 잰 실제 사진 크기)
 * @returns    { filled: 채운 항목 수, data }
 */
export function fillPortfolio(pf, id, dims = {}) {
  const p = PROFILES[id];
  const images = (pf.images ?? []).map((x) => ({ ...x }));
  let filled = 0;
  const put = (o, k, v) => {
    if (o[k] != null && String(o[k]).trim()) return;     // 실데이터 우선 — 덮어쓰지 않는다
    o[k] = v; filled += 1;
  };

  if (p) {
    // 시리즈는 앞에서부터 차례로 배정하고 남은 작품은 무시리즈로 둔다(실제 포트폴리오가 대개 그렇다)
    const belongs = [];
    for (const s of p.series) for (let k = 0; k < s.count; k += 1) belongs.push(s.name);

    images.forEach((im, i) => {
      const d = dims[im.url];
      put(im, 'title', p.titles[i % p.titles.length]);
      put(im, 'medium', p.mediums[i % p.mediums.length]);
      put(im, 'sizeText', sizeFrom(d ? d.w / d.h : 1, p.shortSides, i));
      put(im, 'year', p.years[(p.years.length - 1) - (i % p.years.length)]);
      put(im, 'description', p.descs[i % p.descs.length]);
      if (belongs[i]) put(im, 'series', belongs[i]);
      // 판매상태: 대부분 판매중, 드물게 판매완료·비매 — 캡션 배지가 어떻게 보이는지 확인용
      put(im, 'status', i % 7 === 3 ? 'SOLD' : i % 11 === 8 ? 'NFS' : 'AVAILABLE');
    });
  } else {
    // 프로필이 없는 작가(대부분 실데이터가 있다) — 비어 있는 칸만 최소로 메운다
    images.forEach((im, i) => {
      if (!String(im.year ?? '').trim() && String(im.title ?? '').trim()) {
        im.year = String(2026 - (i % 4)); filled += 1;
      }
    });
  }

  // 시리즈 소개글은 우리가 만든 시리즈에만 붙인다(실제 작가가 쓴 글을 흉내내지 않는다)
  let seriesInfo = null;
  try { seriesInfo = JSON.parse(pf.seriesInfo || 'null'); } catch { seriesInfo = null; }
  if (p && (!seriesInfo || !seriesInfo.length)) {
    seriesInfo = p.series.map((s) => ({ name: s.name, note: s.note }));
  }

  return {
    filled,
    data: {
      user: pf.user ?? { name: pf.name ?? '작가' },
      tagline: pf.tagline,
      statement: pf.statement,
      biography: pf.biography,
      career: pf.career,
      seriesInfo,
      images,
    },
  };
}
