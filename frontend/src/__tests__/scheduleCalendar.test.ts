/**
 * 공모 일정 달력 (2026-10-28 사용자 요청 — Skyscanner 가는 날/오는 날 방식)
 * 판단은 lib/scheduleCalendar.ts. 화면(SchedulePicker)은 jsdom 이 그리지 못해 소스 가드 + E2E(77)로 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addDays, applyPick, canPick, daysBetween, exhibitionSchedule, formatYmd, isYmd, monthGrid, openingMonth, rangeDays,
  rangeOf, shiftMonth, spokenYmd, stepMin, todayKst, toYmd,
} from '@/lib/scheduleCalendar';
import { validateExhibitionDates } from '@/lib/utils';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const TODAY = '2026-10-28';

describe('날짜 계산 — UTC 자정 기준, 하루가 밀리지 않는다', () => {
  it('오늘은 한국 날짜 — UTC 로는 전날 밤이어도 한국이 다음 날이면 다음 날', () => {
    expect(todayKst(Date.UTC(2026, 9, 27, 15, 0))).toBe('2026-10-28');   // KST 00:00
    expect(todayKst(Date.UTC(2026, 9, 27, 14, 59))).toBe('2026-10-27');  // KST 23:59
  });
  it('달·해·윤년을 넘는다', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-11', '2026-10-28')).toBe(14);
    expect(rangeDays('2026-10-28', '2026-11-11')).toBe(15);
  });
  it('형식 — 없는 날짜·다른 모양은 값이 아니다 · 서버의 ISO 값은 앞 10자', () => {
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-2-3')).toBe(false);
    expect(toYmd('2026-10-28T00:00:00.000Z')).toBe('2026-10-28');
    expect(toYmd(null)).toBe('');
    expect(toYmd(12)).toBe('');
  });
  it('칸 글자·읽는 이름', () => {
    expect(formatYmd('2026-10-28')).toBe('2026. 10. 28 (수)');
    expect(spokenYmd('2026-10-28')).toBe('2026년 10월 28일 수요일');
  });
  it('달 칸 — 일요일부터, 빈 칸은 null, 한 주는 7칸', () => {
    const g = monthGrid(2026, 9);   // 2026년 10월 1일 = 목요일
    expect(g[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(g[0][4]).toBe('2026-10-01');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(31);
    expect(shiftMonth({ y: 2026, m0: 11 }, 1)).toEqual({ y: 2027, m0: 0 });
  });
});

describe('고를 수 있는 날 — 지난 날 · 앞 칸보다 이른 날은 못 고른다', () => {
  const { steps } = exhibitionSchedule(false);
  it('첫 칸은 오늘부터', () => {
    expect(stepMin(steps, {}, 0, TODAY)).toBe(TODAY);
    expect(canPick(steps, {}, 0, '2026-10-27', TODAY)).toBe(false);
    expect(canPick(steps, {}, 0, TODAY, TODAY)).toBe(true);
  });
  it('마감은 시작과 같은 날도 되고 · 자료 제출은 마감 다음 날부터 · 전시 시작은 제출 다음 날부터 · 종료는 시작과 같은 날도', () => {
    const v = { deadlineStart: '2026-11-01', deadline: '2026-11-10', submissionDeadline: '2026-11-15', exhibitStartDate: '2026-11-20' };
    expect(stepMin(steps, v, 1, TODAY)).toBe('2026-11-01');
    expect(stepMin(steps, v, 2, TODAY)).toBe('2026-11-11');
    expect(stepMin(steps, v, 3, TODAY)).toBe('2026-11-16');
    expect(stepMin(steps, v, 4, TODAY)).toBe('2026-11-20');
  });
  it('가운데 칸이 비어 있으면 그 칸의 간격까지 더한다', () => {
    expect(stepMin(steps, { deadlineStart: '2026-11-01' }, 2, TODAY)).toBe('2026-11-02');
    expect(stepMin(steps, { deadline: '2026-11-10' }, 3, TODAY)).toBe('2026-11-12');
  });
  it('앞 칸이 지난 날이어도(임시저장) 오늘보다 이르게는 못 고른다', () => {
    expect(stepMin(steps, { deadlineStart: '2026-10-01' }, 1, TODAY)).toBe(TODAY);
  });
});

describe('고르면 — 다음 칸으로 · 순서가 깨진 뒤 칸은 비운다', () => {
  const { steps } = exhibitionSchedule(false);
  it('★ 다음 칸으로 넘어가고 마지막이면 닫는다(null)', () => {
    expect(applyPick(steps, {}, 0, '2026-11-01', TODAY).next).toBe(1);
    expect(applyPick(steps, {}, 4, '2026-12-01', TODAY).next).toBeNull();
  });
  it('★ 시작을 마감 뒤로 옮기면 마감이 비워진다(가는 날을 오는 날 뒤로 옮긴 것처럼) — 여전히 순서에 맞는 뒤 칸은 남는다', () => {
    const v = { deadlineStart: '2026-11-01', deadline: '2026-11-10', submissionDeadline: '2026-11-15', exhibitStartDate: '2026-11-20', exhibitDate: '2026-11-30' };
    expect(applyPick(steps, v, 0, '2026-11-12', TODAY).patch).toEqual({ deadlineStart: '2026-11-12', deadline: '' });
    // 시작을 전시 뒤로 옮기면 뒤가 전부 비워진다
    expect(applyPick(steps, v, 0, '2026-12-05', TODAY).patch)
      .toEqual({ deadlineStart: '2026-12-05', deadline: '', submissionDeadline: '', exhibitStartDate: '', exhibitDate: '' });
  });
  it('순서에 맞는 뒤 칸은 그대로 둔다', () => {
    const v = { deadlineStart: '2026-11-01', deadline: '2026-11-10', submissionDeadline: '2026-11-15', exhibitStartDate: '2026-11-20', exhibitDate: '2026-11-30' };
    expect(applyPick(steps, v, 1, '2026-11-12', TODAY).patch).toEqual({ deadline: '2026-11-12' });
    // 마감을 자료 제출과 같은 날로 → 자료 제출만 깨진다(전시는 그 뒤라 그대로)
    expect(applyPick(steps, v, 1, '2026-11-15', TODAY).patch).toEqual({ deadline: '2026-11-15', submissionDeadline: '' });
  });
  it('★ 칸마다 고를 수 있는 첫날만 골라도 서버 순서 규칙을 통과한다(같은 규칙인가)', () => {
    let v: Record<string, string> = {};
    for (let i = 0; i < steps.length; i++) {
      v = { ...v, ...applyPick(steps, v, i, stepMin(steps, v, i, TODAY), TODAY).patch };
    }
    expect(Object.values(v).every(Boolean)).toBe(true);
    const err = validateExhibitionDates(
      { deadlineStart: v.deadlineStart, deadline: v.deadline, submissionDeadline: v.submissionDeadline, exhibitStartDate: v.exhibitStartDate, exhibitDate: v.exhibitDate },
      () => 0,
    );
    expect(err).toBeNull();
    // 하루씩 앞당기면(간격 1 인 칸) 서버가 거절한다 — 간격이 서버 규칙과 정확히 같다
    expect(validateExhibitionDates({ ...v, deadline: v.deadline, submissionDeadline: v.deadline }, () => 0)).not.toBeNull();
    expect(validateExhibitionDates({ ...v, deadline: v.deadline, exhibitStartDate: v.submissionDeadline }, () => 0)).not.toBeNull();
  });
});

describe('공모 일정 칸 — 갤러리 등록·주최 공모 등록 공용', () => {
  it('공모만 진행이면 두 칸(시작·마감)뿐 — 자료 제출·전시 칸 자체가 없다', () => {
    const { steps, ranges } = exhibitionSchedule(true);
    expect(steps.map((s) => s.key)).toEqual(['deadlineStart', 'deadline']);
    expect(ranges.map((r) => r.label)).toEqual(['지원 기간']);
  });
  it('전시까지면 다섯 칸, 일어나는 순서대로 · 칸 id 는 예전 그대로(오류 스크롤·E2E)', () => {
    const { steps } = exhibitionSchedule(false);
    expect(steps.map((s) => s.key)).toEqual(['deadlineStart', 'deadline', 'submissionDeadline', 'exhibitStartDate', 'exhibitDate']);
    expect(steps.map((s) => s.id)).toEqual(['ex-start', 'ex-deadline', 'ex-submission', 'ex-show-start', 'ex-show-end']);
    expect(exhibitionSchedule(false, 'hosted').steps[0].id).toBe('hosted-start');
  });
  it('기간 칠하기 · 처음 보일 달', () => {
    const { steps, ranges } = exhibitionSchedule(false);
    const v = { deadlineStart: '2026-11-01', deadline: '2026-11-10' };
    expect(rangeOf(ranges, v, '2026-11-05')?.label).toBe('지원 기간');
    expect(rangeOf(ranges, v, '2026-11-11')).toBeNull();
    expect(openingMonth(steps, v, 1, TODAY)).toEqual({ y: 2026, m0: 10 });
    expect(openingMonth(steps, {}, 0, TODAY)).toEqual({ y: 2026, m0: 9 });
  });
});

describe('소스 가드 — 공모 등록 폼은 날짜를 달력으로 고른다', () => {
  it('갤러리 공모 등록·아트링크 주최 공모 등록이 SchedulePicker + exhibitionSchedule 을 쓰고, 일정 칸에 <input type="date"> 가 없다', () => {
    const my = src('pages/MyPage.tsx');
    expect(my).toMatch(/<SchedulePicker[\s\S]{0,200}exhibitionSchedule\(!!form\.recruitOnly\)/);
    for (const id of ['ex-start', 'ex-deadline', 'ex-submission', 'ex-show-start', 'ex-show-end']) {
      expect(my, id).not.toMatch(new RegExp(`id="${id}"[^>]*type="date"`));
    }
    const hosted = src('components/admin/HostedExhibitionsSection.tsx');
    expect(hosted).toMatch(/<SchedulePicker[\s\S]{0,200}exhibitionSchedule\(!!form\.recruitOnly, 'hosted'\)/);
    expect(hosted).not.toContain('type="date"');
  });
  it('고른 값은 함수형으로 합친다(편집기 콜백이 옛 form 을 붙들어도 다른 칸이 안 되돌아가게)', () => {
    for (const p of ['pages/MyPage.tsx', 'components/admin/HostedExhibitionsSection.tsx']) {
      expect(src(p), p).toMatch(/onChange=\{\(patch\) => \{ setForm\(prev => \(\{ \.\.\.prev, \.\.\.patch \}\)\)/);
    }
  });
  it('달력은 지난 날·앞 칸보다 이른 날을 disabled 로 그린다(흐리게)', () => {
    const picker = src('components/shared/SchedulePicker.tsx');
    expect(picker).toMatch(/const disabled = day < minYmd/);
    expect(picker).toMatch(/disabled=\{disabled\}/);
    expect(picker).toMatch(/data-schedule-day=\{day\}/);
  });
});

describe('소스 가드 — 홈페이지 프로필 사진(2026-10-28)', () => {
  it('켰고 사진이 있을 때만 이름 위에 그리고, 그때 이름을 한 단계 줄인다', () => {
    const view = src('components/shared/HomepageView.tsx');
    expect(view).toMatch(/const withAvatar = !!data\.showAvatar && !!avatarSrc/);
    expect(view).toMatch(/\{withAvatar && \(\s*<img/);
    expect(view).toMatch(/withAvatar \? \(compact \? 'text-2xl' : 'text-3xl md:text-5xl'\) : \(compact \? 'text-3xl' : 'text-4xl md:text-6xl'\)/);
  });
  it('공개 페이지·편집 미리보기 둘 다 showAvatar 를 넘기고, 편집 화면이 저장에 싣는다', () => {
    expect(src('pages/PortfolioPage.tsx')).toMatch(/showAvatar: portfolio\.showAvatar === true/);
    const ed = src('components/homepage-edit/HomepageEditor.tsx');
    expect(ed).toMatch(/designConfig: previewDesign,\s*showAvatar,/);
    expect(ed).toMatch(/showPrice,\s*showAvatar,\s*\}\);/);
    expect(ed).toMatch(/v\.showPrice, v\.showAvatar\]/);   // 고쳤는지 판정(지문)에도
  });
  it('프로필 카드와 편집 화면이 같은 업로드 함수를 쓴다', () => {
    expect(src('pages/MyPage.tsx')).toContain('await uploadAvatar(rawFile)');
    expect(src('components/homepage-edit/sections.tsx')).toContain('await uploadAvatar(f)');
  });
});

describe('소스 가드 — 포스터는 등록 창에서도 자르지 않는다 · [수정] 은 머리말 오른쪽 위 (2026-10-28)', () => {
  it('공모 등록(갤러리·아트링크 주최)·전시 등록의 포스터 칸은 fit="contain"(목록 카드와 같은 모양), 공모는 목록 카드 비율 210:297', () => {
    const my = src('pages/MyPage.tsx');
    expect(my).toMatch(/<HeroImageEdit fit="contain" value=\{form\.imageUrl\}[\s\S]{0,300}aspect-\[210\/297\]/);
    expect(my).toMatch(/<HeroImageEdit fit="contain" value=\{form\.posterImage\}/);
    const hosted = src('components/admin/HostedExhibitionsSection.tsx');
    expect(hosted).toMatch(/<HeroImageEdit\s+fit="contain"[\s\S]{0,300}aspect-\[210\/297\]/);
    const edit = src('components/shared/EditableField.tsx');
    expect(edit).toMatch(/fit === 'contain'[\s\S]{0,400}object-contain/);
  });
  it('아트링크 주최 공모 등록도 갤러리 공모 등록과 같은 틀 — 번호 구역·포스터 왼쪽·칸 이름(FormField)·일정 달력(form 모양)', () => {
    const hosted = src('components/admin/HostedExhibitionsSection.tsx');
    for (const t of ['진행 범위', '운영 갤러리 (선택)', '공고 내용', '일정', '추가 질문 (선택)']) {
      expect(hosted, t).toMatch(new RegExp(`<FormSection n=\\{\\d\\} title="${t.replace(/[()]/g, '\\$&')}"`));
    }
    expect(hosted).toContain('grid gap-5 sm:grid-cols-[168px_minmax(0,1fr)]');
    expect(hosted).not.toContain('variant="compact"');   // 예전 '미리보기 카드' 모양의 작은 칸
    expect(hosted).not.toContain('<EditableText');
  });
  it('[수정] 은 액션 줄이 아니라 ownerAction 으로 — HomepageView 가 오른쪽 위 칸에 한 번만 그린다', () => {
    const page = src('pages/PortfolioPage.tsx');
    expect(page).toMatch(/const ownerAction = isOwner \?/);
    expect(page).toMatch(/ownerAction=\{ownerAction\}/);
    const actionsBlock = page.slice(page.indexOf('const actions = ('), page.indexOf('const ownerAction'));
    expect(actionsBlock).not.toContain('수정');
    const view = src('components/shared/HomepageView.tsx');
    expect(view).toMatch(/\{ownerAction && <div className="col-start-2 row-start-1 self-start justify-self-end"/);
  });
});
