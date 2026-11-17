/**
 * 등록 화면 개편(2026-11-15) — 공모 등록(갤러리·아트링크 주최) · 갤러리 등록 · 전시 등록.
 *  · 남은 필수 칸(하단 줄과 [등록 요청]이 같은 목록) · 주소 한 줄 · 이메일 · 관람 시간 순서
 *  · 전시 기간 표시(목록·상세·미리보기가 같은 말) · 달력 칸
 *  · 소스 가드 — 약관은 확인 창 안 · 세 화면이 같은 하단 줄 · 주소 검색은 창 안에 끼워 넣는다(팝업 금지)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { exhibitionMissing, exhibitionDateError, type ExFormValues } from '@/components/exhibition-form/exhibitionForm';
import { emptyGalleryForm, fullAddress, galleryEmailError, galleryMissing } from '@/components/gallery-form/galleryForm';
import { emptyShowForm, openingHoursError, showMissing } from '@/components/show-form/showForm';
import { artistsLine, groupShows, openingHoursText, showSteps, showView, sortEnded } from '@/lib/listings';
import { showSchedule, showScheduleFloor, exhibitionSchedule } from '@/lib/scheduleCalendar';
import { instagramHref } from '@/lib/homepageSite';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf-8');

const exForm = (patch: Partial<ExFormValues> = {}): ExFormValues => ({
  title: '', type: 'SOLO', deadlineStart: '', deadline: '', exhibitStartDate: '', exhibitDate: '', submissionDeadline: '',
  recruitOnly: false, capacity: 1, capacityMask: null, region: 'SEOUL', description: '', imageUrl: '', customFields: [], attachments: [],
  galleryId: 0, ...patch,
});

describe('공모 등록 — 남은 필수 칸', () => {
  it('폼 순서대로, 칸 이름은 화면 이름 그대로(접수 시작일·접수 마감일)', () => {
    expect(exhibitionMissing(exForm(), { needGallery: true }).map((m) => m.label)).toEqual([
      '갤러리', '공모 제목', '접수 시작일', '접수 마감일', '출품 자료 제출 마감일', '전시 시작일', '전시 종료일', '공모 소개',
    ]);
  });
  it('공모만 진행이면 출품 자료·전시 칸을 묻지 않는다 · 아트링크 주최는 갤러리를 묻지 않는다', () => {
    const keys = exhibitionMissing(exForm({ recruitOnly: true }), { needGallery: false }).map((m) => m.key);
    expect(keys).toEqual(['title', 'deadlineStart', 'deadline', 'description']);
  });
  it('0명·00명이면 숫자 칸이 비어도 된다 · 서식 글은 태그만 있으면 빈 글', () => {
    expect(exhibitionMissing(exForm({ capacity: 0, capacityMask: 'ONE' }), { needGallery: false }).map((m) => m.key)).not.toContain('capacity');
    expect(exhibitionMissing(exForm({ capacity: 0 }), { needGallery: false }).map((m) => m.key)).toContain('capacity');
    expect(exhibitionMissing(exForm({ description: '<p></p>' }), { needGallery: false }).map((m) => m.key)).toContain('description');
  });
  it('날짜 순서 — 공모만 진행이면 남아 있는 전시 날짜로 검사하지 않는다', () => {
    const base = { deadlineStart: '2099-03-01', deadline: '2099-03-10' };
    expect(exhibitionDateError(exForm({ ...base, exhibitStartDate: '2099-03-05', exhibitDate: '2099-03-20' }))).toContain('접수 마감일');
    expect(exhibitionDateError(exForm({ ...base, recruitOnly: true, exhibitStartDate: '2099-03-05', exhibitDate: '2099-03-20' }))).toBeNull();
  });
  it('일정 칸 이름은 접수 — 상세 일정 띠(접수 시작 · 접수 마감)와 같은 말', () => {
    const { steps, ranges } = exhibitionSchedule(false);
    expect(steps.map((s) => s.label).slice(0, 2)).toEqual(['접수 시작일', '접수 마감일']);
    expect(ranges[0].label).toBe('접수 기간');
  });
});

describe('갤러리 등록', () => {
  it('남은 필수 칸 — 이름 · 한 줄 소개 · 주소 · 전화 · 대표자명(이메일·인스타는 선택)', () => {
    expect(galleryMissing(emptyGalleryForm).map((m) => m.key)).toEqual(['name', 'description', 'address', 'phone', 'ownerName']);
    expect(galleryMissing({ ...emptyGalleryForm, name: 'a', description: 'b', address: '서울 종로구 삼일대로 445', phone: '02', ownerName: 'c' })).toEqual([]);
  });
  it('주소는 한 줄로 보낸다 — 주소 + 상세 주소(서버·이미 등록된 갤러리는 문자열 하나)', () => {
    expect(fullAddress({ address: '서울 종로구 삼일대로 445', addressDetail: '1층' })).toBe('서울 종로구 삼일대로 445 1층');
    expect(fullAddress({ address: ' 서울 종로구 삼일대로 445 ', addressDetail: '' })).toBe('서울 종로구 삼일대로 445');
  });
  it('이메일은 선택 — 비면 통과, 적었으면 형식만', () => {
    expect(galleryEmailError('')).toBeNull();
    expect(galleryEmailError('a@b.co')).toBeNull();
    expect(galleryEmailError('ab.co')).not.toBeNull();
  });
  it('인스타 링크 — 적은 그대로 저장된 값을 링크로(주소·@아이디·아이디)', () => {
    expect(instagramHref('https://instagram.com/x')).toBe('https://instagram.com/x');
    expect(instagramHref('@gallery.m')).toBe('https://instagram.com/gallery.m');
    expect(instagramHref('instagram.com/gallery.m')).toBe('https://instagram.com/gallery.m');
    expect(instagramHref('')).toBeNull();
  });
});

describe('전시 — 기간 표시 · 묶음 · 등록 폼', () => {
  const now = new Date('2026-11-15T03:00:00Z');   // KST 11.15(일) 정오
  const at = (ymd: string) => `${ymd}T00:00:00.000Z`;
  it('진행 중 · 끝나기 7일 안 · 오늘 종료 · 예정 · 종료', () => {
    expect(showView({ startDate: at('2026-11-01'), endDate: at('2026-12-20') }, now)).toMatchObject({ state: 'ongoing', badge: '전시 중', hot: false, date: '12.20(일)까지' });
    expect(showView({ startDate: at('2026-11-01'), endDate: at('2026-11-18') }, now)).toMatchObject({ badge: 'D-3 종료', hot: true });
    expect(showView({ startDate: at('2026-11-01'), endDate: at('2026-11-15') }, now)).toMatchObject({ badge: '오늘 종료', hot: true });
    expect(showView({ startDate: at('2026-11-20'), endDate: at('2026-12-20') }, now)).toMatchObject({ state: 'upcoming', badge: '예정', date: '11.20(금)부터' });
    expect(showView({ startDate: at('2026-10-01'), endDate: at('2026-11-14') }, now)).toMatchObject({ state: 'ended', badge: '종료' });
  });
  it('[진행·예정] 묶음 — 전시 중(끝나는 날 순) → 예정(시작 순), 끝난 전시는 빠진다 · 지난 전시는 최근에 끝난 순', () => {
    const shows = [
      { id: 1, startDate: at('2026-11-01'), endDate: at('2026-12-31') },
      { id: 2, startDate: at('2026-11-10'), endDate: at('2026-11-20') },
      { id: 3, startDate: at('2026-12-01'), endDate: at('2026-12-10') },
      { id: 4, startDate: at('2026-11-25'), endDate: at('2026-12-10') },
      { id: 5, startDate: at('2026-09-01'), endDate: at('2026-10-01') },
      { id: 6, startDate: at('2026-09-01'), endDate: at('2026-11-01') },
    ];
    const g = groupShows(shows, now);
    expect(g.map((x) => [x.label, x.items.map((s) => s.id)])).toEqual([['전시 중', [2, 1]], ['예정', [4, 3]]]);
    expect(sortEnded(shows.filter((s) => showView(s, now).state === 'ended')).map((s) => s.id)).toEqual([6, 5]);
  });
  it('기간 띠 — 다음 단계만 진하게, 끝나기 7일 안이면 강조색', () => {
    expect(showSteps({ startDate: at('2026-11-01'), endDate: at('2026-11-18') }, now).map((s) => [s.state, s.note ?? '', !!s.hot])).toEqual([['past', '', false], ['next', '3일 남음', true]]);
    expect(showSteps({ startDate: at('2026-11-20'), endDate: at('2026-12-20') }, now).map((s) => s.state)).toEqual(['next', 'future']);
  });
  it('관람 시간 — 폼이 저장한 모양만 바꾸고, 옛 자유 글은 그대로', () => {
    expect(openingHoursText('11:00-19:00')).toBe('11:00 – 19:00');
    expect(openingHoursText('화–일 11시~7시')).toBe('화–일 11시~7시');
    expect(openingHoursError('19:00-11:00')).not.toBeNull();
    expect(openingHoursError('11:00-19:00')).toBeNull();
  });
  it('참여 작가 한 줄 — 셋까지, 넘으면 외 N명', () => {
    expect(artistsLine([{ name: '가' }, { name: '나' }])).toBe('가, 나');
    expect(artistsLine([{ name: '가' }, { name: '나' }, { name: '다' }, { name: '라' }])).toBe('가, 나, 다 외 1명');
    expect(artistsLine(null)).toBe('');
  });
  it('남은 필수 칸 — 포스터부터(목록 카드의 얼굴) · 관람 시간은 시작·끝 둘 다', () => {
    expect(showMissing(emptyShowForm, { needGallery: true }).map((m) => m.key)).toEqual([
      'posterImage', 'title', 'galleryId', 'startDate', 'endDate', 'openingHours', 'admissionFee', 'location', 'description',
    ]);
    expect(showMissing({ ...emptyShowForm, openingHours: '11:00-' }, { needGallery: false }).map((m) => m.key)).toContain('openingHours');
  });
  it('달력 — 전시 시작·종료 칸, 지난날도 고른다(1년 전까지)', () => {
    expect(showSchedule().steps.map((s) => [s.key, s.id])).toEqual([['startDate', 'show-start'], ['endDate', 'show-end']]);
    expect(showScheduleFloor('2026-11-15')).toBe('2025-11-15');
    expect(showScheduleFloor('2028-02-29')).toBe('2027-03-01');
  });
});

describe('소스 가드 — 등록 화면 셋', () => {
  const my = src('pages/MyPage.tsx');
  const hosted = src('components/admin/HostedExhibitionsSection.tsx');
  it('약관은 [등록 요청] 확인 창 안 — 폼 끝 약관 상자·체크하기 전 회색 버튼을 되살리지 않는다', () => {
    expect(my).not.toContain('위 약관에 동의합니다');
    for (const url of ['/terms/exhibition-application.txt', '/terms/gallery-registration.txt', '/terms/show-registration.txt']) {
      expect(my).toMatch(new RegExp(`<SubmitSheet[\\s\\S]{0,1600}terms=\\{\\{ url: '${url.replace(/[/.]/g, '\\$&')}'`));
    }
    // 아트링크 주최는 약관이 없다(승인 없이 바로 게시)
    expect(hosted).toContain('<SubmitSheet');
    expect(hosted.slice(hosted.indexOf('<SubmitSheet'), hosted.indexOf('/>', hosted.indexOf('<SubmitSheet')))).not.toContain('terms=');
  });
  it('세 화면이 같은 하단 줄(남은 필수 → 그 칸으로)과 같은 미리보기 틀을 쓴다', () => {
    expect((my.match(/<StickySubmitBar/g) ?? []).length).toBe(3);
    expect(hosted).toContain('<StickySubmitBar');
    for (const s of [my, hosted]) {
      expect(s).toContain('onJump={jumpToField}');
      expect(s).toContain('<PreviewAside');
      expect(s).toContain('<PreviewSheet');
    }
  });
  it('미리보기는 상세 화면 하나 — 진짜 상세 부품으로 그린다(흉내 금지) · 찾기(목록) 카드는 미리 보여 주지 않는다', () => {
    const ex = src('components/exhibition-form/exhibitionForm.tsx');
    const gal = src('components/gallery-form/galleryForm.tsx');
    const show = src('components/show-form/showForm.tsx');
    expect(ex).toContain("import { DeadlineText, Fact, ScheduleStrip } from '@/components/exhibition/DetailBits'");
    expect(ex).toContain("return { label: '공고 상세', node: detail };");
    expect(gal).toContain("import GalleryVisitInfo from '@/components/homepage/GalleryVisitInfo'");
    expect(src('pages/GalleryDetailPage.tsx')).toContain('<GalleryVisitInfo');
    expect(gal).toContain("return { label: '갤러리 홈페이지', node: home };");
    expect(show).toContain("import { ShowPeriodLine, type ShowCardData } from '@/components/listing/ShowCards'");
    expect(show).toContain("import { Fact, ScheduleStrip } from '@/components/exhibition/DetailBits'");
    expect(show).toContain("return { label: '전시 상세', node: detail };");
    // 2026-11-15 사용자 결정 — "갤러리 홈페이지만 되면 된다, 전시·모집공고도 찾기는 미리보기 안 해도 된다"
    for (const s of [ex, gal, show]) expect(s).not.toMatch(/(CallCard|CallRow|GalleryCard|GalleryRow|ShowCard|ShowRow)/);
  });
  it('주소 검색은 우리 창 안에 끼워 넣는다 — 팝업(.open)은 앱·인앱에서 막힌다 · 스크립트는 누를 때 받는다', () => {
    const pc = src('lib/postcode.ts');
    expect(pc).toContain("const SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'");
    const field = src('components/form/AddressField.tsx');
    expect(field).toContain('.embed(boxRef.current');
    expect(field).not.toMatch(/\.open\(/);
    expect(src('components/gallery-form/GalleryFormBody.tsx')).toContain('<AddressField');
    expect(src('pages/GalleryDetailPage.tsx')).toContain('<AddressField');
    // 첫 화면 index.html 에 외부 스크립트를 얹지 않는다
    expect(readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf-8')).not.toContain('postcode');
  });
  it('관람 시간·홈페이지 주소(@)는 갤러리 등록에서 받지 않는다(2026-11-15 — 고르지 않은 안). 대표자명은 공개 안 함 구역', () => {
    const body = src('components/gallery-form/GalleryFormBody.tsx');
    expect(body).not.toContain('openHours');
    expect(body).not.toContain('handle');
    expect(body).toMatch(/title="확인용" titleNote=/);
  });
});
