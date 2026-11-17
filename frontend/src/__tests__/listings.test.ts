/**
 * 모집공고 찾기 · 상세 · 갤러리 찾기 개편(2026-11-15)의 판단 — `lib/listings.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addressArea, addressCheck, daysUntil, deadlineView, groupByDeadline, isOpenCall, presentRegions, presentTypes, regionFromAddress, scheduleSteps, shortDate, sortNewest,
} from '@/lib/listings';

// 2026-11-15(일) 14:00 KST
const NOW = new Date('2026-11-15T05:00:00Z');
/** KST 그날 09:00 (= <input type="date"> 가 저장하는 UTC 자정) */
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toISOString();

describe('마감 표시 — 목록·상세·따라오는 줄이 같은 말', () => {
  it('KST 달력 날짜로 센다 — 마감일 당일은 종일 오늘 마감', () => {
    expect(daysUntil(day('2026-11-15'), NOW)).toBe(0);
    expect(daysUntil(day('2026-11-15'), new Date('2026-11-15T14:59:00Z'))).toBe(0);   // KST 23:59
    expect(daysUntil(day('2026-11-15'), new Date('2026-11-15T15:00:00Z'))).toBe(-1);  // KST 다음날 0:00
    expect(shortDate(day('2026-11-24'))).toBe('11.24(화)');
  });

  it('모집 중 · 오늘 마감 · 7일 안은 빨강', () => {
    expect(deadlineView({ deadline: day('2026-11-24') }, { now: NOW })).toMatchObject({ state: 'open', badge: 'D-9', hot: false, date: '11.24(화)까지' });
    expect(deadlineView({ deadline: day('2026-11-22') }, { now: NOW })).toMatchObject({ badge: 'D-7', hot: true });
    expect(deadlineView({ deadline: day('2026-11-15') }, { now: NOW })).toMatchObject({ badge: '오늘 마감', hot: true });
  });

  it('시작 전 → 모집 예정 · 마감일이 남아도 수동 마감·전시 종료면 조기 마감 · 지난 것은 날짜와 함께', () => {
    expect(deadlineView({ deadline: day('2026-11-30'), deadlineStart: day('2026-11-20') }, { now: NOW }))
      .toMatchObject({ state: 'upcoming', badge: '모집 예정', date: '11.20(금)부터' });
    expect(deadlineView({ deadline: day('2026-11-30'), recruitmentClosed: true }, { now: NOW }))
      .toMatchObject({ state: 'closed', badge: '조기 마감', date: '' });
    expect(deadlineView({ deadline: day('2026-11-30'), ended: true }, { now: NOW }).state).toBe('closed');
    // '마감 11.12(목) 마감' 처럼 겹쳐 쓰지 않는다
    expect(deadlineView({ deadline: day('2026-11-12') }, { now: NOW })).toMatchObject({ state: 'closed', badge: '마감', date: '11.12(목)' });
    expect(deadlineView({ deadline: day('2026-11-30') }, { now: NOW, closedScope: true }).state).toBe('closed');
  });
});

describe('모집 중 — 모집공고 목록·갤러리 카드·갤러리 홈페이지 [모집 중] 탭이 같은 답(서버 openCallWhere 와 같은 규칙)', () => {
  it('마감일이 남았어도 일찍 닫았거나(수동 마감·전시 종료) 시작 전이면 모집 중이 아니다', () => {
    expect(isOpenCall({ deadline: day('2026-11-24') }, NOW)).toBe(true);
    expect(isOpenCall({ deadline: day('2026-11-15') }, NOW)).toBe(true);                       // 마감일 당일
    expect(isOpenCall({ deadline: day('2026-11-14') }, NOW)).toBe(false);
    expect(isOpenCall({ deadline: day('2026-11-24'), recruitmentClosed: true }, NOW)).toBe(false);
    expect(isOpenCall({ deadline: day('2026-11-24'), ended: true }, NOW)).toBe(false);
    expect(isOpenCall({ deadline: day('2026-11-24'), deadlineStart: day('2026-11-20') }, NOW)).toBe(false);
    expect(isOpenCall({ deadline: day('2026-11-24'), deadlineStart: day('2026-11-15') }, NOW)).toBe(true);  // 시작일 당일부터
  });
});

describe('마감 묶음 — 마감 임박(7일 안) → N월 마감', () => {
  it('넣은 순서와 상관없이 마감 순으로 묶고, 해가 바뀌면 연도를 붙인다', () => {
    const items = [
      { id: 6, deadline: day('2027-01-05') },
      { id: 1, deadline: day('2026-11-15') },
      { id: 4, deadline: day('2026-11-30') },
      { id: 3, deadline: day('2026-11-22') },
      { id: 5, deadline: day('2026-12-07') },
      { id: 2, deadline: day('2026-11-16') },
      { id: 7, deadline: day('2026-11-23') },
    ];
    const groups = groupByDeadline(items, NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['마감 임박', [1, 2, 3]],
      ['11월 마감', [7, 4]],
      ['12월 마감', [5]],
      ['2027년 1월 마감', [6]],
    ]);
  });

  it('최신 등록 순', () => {
    const rows = sortNewest([
      { id: 1, createdAt: '2026-11-01T00:00:00Z' },
      { id: 2, createdAt: '2026-11-10T00:00:00Z' },
      { id: 3, createdAt: '2026-11-10T00:00:00Z' },
    ]);
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe('있는 값만 거르기 — 빈 지역을 늘어놓지 않는다', () => {
  it('REGION_CODES 순서로 · 고른 값은 없어도 남긴다', () => {
    const items = [{ region: 'GYEONGNAM', type: 'SOLO' }, { region: 'SEOUL', type: 'GROUP' }, { region: 'SEOUL', type: 'GROUP' }];
    expect(presentRegions(items)).toEqual(['SEOUL', 'GYEONGNAM']);
    expect(presentRegions(items, 'JEJU')).toEqual(['SEOUL', 'GYEONGNAM', 'JEJU']);
    expect(presentTypes(items)).toEqual(['SOLO', 'GROUP']);
    expect(presentTypes(items, 'ART_FAIR')).toEqual(['SOLO', 'GROUP', 'ART_FAIR']);
  });
});

describe('짧은 주소 — 서울 종로구 처럼 동네까지만', () => {
  it.each([
    ['서울 종로구 삼일대로 445, 1층', 'SEOUL', '서울 종로구'],
    ['서울특별시 영등포구 경인로704, 1층', 'SEOUL', '서울 영등포구'],
    ['서울시 강동구 고덕비즈밸리로 60 그린스토어', 'SEOUL', '서울 강동구'],
    ['경상남도 양산시 하북면 충렬로 173', 'GYEONGNAM', '경남 양산시'],
    ['인천광역시 연수구 샘말로8번길 9', 'INCHEON', '인천 연수구'],
    ['부산 해운대구 해운대해변로 203', 'BUSAN', '부산 해운대구'],
    ['제주특별자치도 제주시 연동', 'JEJU', '제주 제주시'],
    ['수원시 팔달구 정조로 1', 'GYEONGGI_SOUTH', '수원시 팔달구'],
    ['서울', 'SEOUL', '서울'],
    ['H 아트브릿지', 'SEOUL', '서울'],
    ['', 'BUSAN', '부산'],
  ])('%s → %s', (address, region, expected) => {
    expect(addressArea(address, region)).toBe(expected);
  });
});

describe('화면 소스 — 개편의 약속', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('모집공고·갤러리 찾기에 건수를 그리지 않는다(사용자 결정) · 거르기는 있는 값만', () => {
    for (const p of ['pages/ExhibitionsPage.tsx', 'pages/GalleriesPage.tsx']) {
      const src = read(p);
      expect(src, p).toContain('presentRegions(');
      expect(src, p).not.toMatch(/\.length\}\s*<\/span>/);
    }
  });

  it('갤러리 카드에 글로우 그림자·둥근 모서리·전화번호가 없다', () => {
    const src = read('pages/GalleriesPage.tsx');
    expect(src).not.toContain('extractColor');
    expect(src).not.toContain('boxShadow');
    expect(src).not.toContain('gallery.phone');
  });

  it('갤러리 홈페이지 [모집 중] 탭은 마감일만 보지 않는다 — isOpenCall(일찍 닫은 공모는 지난 전시로)', () => {
    const src = read('pages/GalleryDetailPage.tsx');
    expect(src).toMatch(/const openCalls = \(gallery\.exhibitions \?\? \[\]\)\.filter\(\(e\) => isOpenCall\(e\)\)/);
    expect(src).toMatch(/const pastCalls = \(gallery\.exhibitions \?\? \[\]\)\.filter\(\(e\) => deadlineView\(e\)\.state === 'closed'\)/);
    expect(src).not.toMatch(/filter\(e => getDday\(e\.deadline\) >= 0\)/);
  });

  it('공모 상세 — [지원하기] 는 따라오는 줄 하나뿐 · 마감 표시는 lib/listings 하나', () => {
    const src = read('pages/ExhibitionDetailPage.tsx');
    expect(src).toContain('data-apply-bar');
    expect(src).toContain('deadlineView(');
    expect(src.match(/>\s*<Send[^>]*\/>\s*지원하기\s*</g) ?? []).toHaveLength(1);
  });
});

describe('공모 상세 일정 띠', () => {
  const full = {
    deadlineStart: day('2026-11-01'), deadline: day('2026-11-24'), submissionDeadline: day('2026-12-01'),
    exhibitStartDate: day('2026-12-12'), exhibitDate: day('2026-12-27'),
  };

  it('접수 중 — 시작은 지났고 마감이 다음 단계(9일 남음), 나머지는 그 뒤', () => {
    const s = scheduleSteps(full, NOW);
    expect(s.map((x) => [x.label, x.date, x.state, x.note ?? ''])).toEqual([
      ['접수 시작', '11.1(일)', 'past', ''],
      ['접수 마감', '11.24(화)', 'next', '9일 남음'],
      ['출품 자료 제출', '12.1(화)까지', 'future', ''],
      ['전시', '12.12(토) – 12.27(일)', 'future', ''],
    ]);
    expect(s[1].hot).toBe(false);
    expect(scheduleSteps({ ...full, deadline: day('2026-11-15') }, NOW)[1]).toMatchObject({ note: '오늘 마감', hot: true });
  });

  it('시작 전이면 접수 시작이 다음 단계 · 일찍 닫으면 접수는 지난 것(조기 마감)', () => {
    expect(scheduleSteps({ ...full, deadlineStart: day('2026-11-20') }, NOW)[0]).toMatchObject({ state: 'next', note: '5일 뒤' });
    const early = scheduleSteps({ ...full, recruitmentClosed: true }, NOW);
    expect(early[1]).toMatchObject({ state: 'past', note: '조기 마감' });
    expect(early[2]).toMatchObject({ state: 'next', note: '16일 남음' });
  });

  it('전시 중 · 전시 종료 · 공모만 진행(출품·전시 단계 없음) · 값이 없는 단계는 없다', () => {
    const during = scheduleSteps(full, new Date('2026-12-15T05:00:00Z'));
    expect(during[3]).toMatchObject({ state: 'next', note: '진행 중' });
    expect(scheduleSteps({ ...full, ended: true, recruitmentClosed: true }, NOW).every((x) => x.state === 'past')).toBe(true);
    expect(scheduleSteps({ ...full, recruitOnly: true }, NOW).map((x) => x.key)).toEqual(['start', 'deadline']);
    expect(scheduleSteps({ deadline: day('2026-11-24') }, NOW).map((x) => x.key)).toEqual(['deadline']);
  });
});

describe('주소 → 지역 · 이미 등록된 갤러리 주소 점검', () => {
  it('주소 검색 결과와 사람이 친 주소 둘 다 지역으로 읽는다 · 경기는 시·군으로 북부/남부', () => {
    expect(regionFromAddress('서울 종로구 삼일대로 445')).toBe('SEOUL');
    expect(regionFromAddress('서울특별시 영등포구 경인로 704')).toBe('SEOUL');
    expect(regionFromAddress('인천광역시 연수구 샘말로8번길 9')).toBe('INCHEON');
    expect(regionFromAddress('경기 고양시 덕양구 화중로 104')).toBe('GYEONGGI_NORTH');
    expect(regionFromAddress('경기도 수원시 팔달구 정조로 1')).toBe('GYEONGGI_SOUTH');
    expect(regionFromAddress('경상남도 양산시 하북면 충렬로 1733')).toBe('GYEONGNAM');
    expect(regionFromAddress('제주특별자치도 제주시 연동')).toBe('JEJU');
    expect(regionFromAddress('광주 동구 금남로 1')).toBeNull();     // 지역 칸에 없다 — 사람이 고른다
    expect(regionFromAddress('H 아트브릿지')).toBeNull();
  });
  it('실서버 갤러리 주소로 — 읽을 수 없는 주소 · 지역과 다른 주소를 가른다', () => {
    expect(addressCheck('서울 종로구 삼일대로 445, 1층 갤러리 엠', 'SEOUL')).toBe('ok');
    expect(addressCheck('인천 연수구 새말로 27 B1층', 'SEOUL')).toBe('mismatch');
    expect(addressCheck('H 아트브릿지', 'SEOUL')).toBe('unknown');
    expect(addressCheck('서울', 'SEOUL')).toBe('unknown');
    expect(addressCheck('경상남도 양산시 하북면 충렬로 1733', 'GYEONGNAM')).toBe('ok');
    // 지역 칸에 없는 시·도(광주·세종·강원) — 읽을 수는 있으니 다시 넣으라고 하지 않는다
    expect(addressCheck('광주 동구 금남로 1', 'SEOUL')).toBe('ok');
    expect(addressCheck('세종특별자치시 한누리대로 2130', 'CHUNGNAM')).toBe('ok');
    expect(addressCheck('강원특별자치도 춘천시 중앙로 1', 'SEOUL')).toBe('ok');
    expect(addressCheck('', 'SEOUL')).toBe('unknown');
  });
});
