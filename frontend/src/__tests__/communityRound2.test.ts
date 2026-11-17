import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pageItems, pageCount, readPage } from '@/lib/pagination';
import { emptyPoll, endsAtAfterDays, newOptionId, pollDeadlineText, pollPercent, pollProblem, samePoll, tidyPoll } from '@/lib/postPoll';
import { POST_VIDEO_MAX_BYTES, type PollAttrs } from '@/lib/postDoc';
import { slideFrameRatio } from '@/lib/postLayout';

/**
 * 커뮤니티 글쓰기 2차(2026-11-13 로컬 확인 뒤) — 페이지 번호 · 투표 도우미 · 동영상 한도 · 넘겨 보기 틀.
 */
const backend = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../../backend', rel), 'utf8');

describe('페이지 번호 줄', () => {
  it('적으면 다 보인다', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(1, 7)).toEqual([1, 2, 3, '…', 7]);
  });
  it('★ 많으면 처음·끝·지금 쪽 양옆, 사이는 …', () => {
    expect(pageItems(6, 20)).toEqual([1, '…', 4, 5, 6, 7, 8, '…', 20]);
    expect(pageItems(1, 20)).toEqual([1, 2, 3, '…', 20]);
    expect(pageItems(20, 20)).toEqual([1, '…', 18, 19, 20]);
  });
  it('★ … 가 번호 하나를 가리면 그 번호를 그린다', () => {
    // 1 과 3 사이에 2 하나 — '…' 대신 2
    expect(pageItems(5, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, '…', 20]);
  });
  it('휴대폰 — 양옆 한 쪽씩', () => {
    expect(pageItems(6, 20, 1)).toEqual([1, '…', 5, 6, 7, '…', 20]);
  });
  it('범위 밖 쪽은 끝으로 묶는다 · 쪽 수 · 주소 읽기', () => {
    expect(pageItems(99, 3)).toEqual([1, 2, 3]);
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
    expect(readPage(null)).toBe(1);
    expect(readPage('abc')).toBe(1);
    expect(readPage('0')).toBe(1);
    expect(readPage('3')).toBe(3);
  });
});

describe('투표 도우미', () => {
  const poll = (o: Partial<PollAttrs> = {}): PollAttrs => ({ question: '주제는?', options: [{ id: 'aaaa1', text: '풍경' }, { id: 'bbbb2', text: '인물' }], multiple: false, endsAt: null, ...o });

  it('보기 id — 서버 규칙(/^[A-Za-z0-9]{4,24}$/)에 맞고 겹치지 않는다', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOptionId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{4,24}$/);
    expect(emptyPoll().options).toHaveLength(2);
  });
  it('★ 넣기 전 검사 — 질문 · 보기 둘 이상 · 같은 보기 두 번 금지', () => {
    expect(pollProblem(poll())).toBeNull();
    expect(pollProblem(poll({ question: '  ' }))).toBe('질문을 써 주세요.');
    expect(pollProblem(poll({ options: [{ id: 'a1b2', text: '하나' }, { id: 'c3d4', text: ' ' }] }))).toMatch('2개 이상');
    expect(pollProblem(poll({ options: [{ id: 'a1b2', text: '같다' }, { id: 'c3d4', text: '같다' }] }))).toBe('같은 보기가 두 번 있어요.');
  });
  it('다듬기 — 빈 보기를 빼고 앞뒤 공백을 떼되 보기 id 는 지킨다', () => {
    const t = tidyPoll(poll({ question: '  주제는?  ', options: [{ id: 'aaaa1', text: ' 풍경 ' }, { id: 'zzzz9', text: '' }, { id: 'bbbb2', text: '인물' }] }));
    expect(t).toEqual({ question: '주제는?', options: [{ id: 'aaaa1', text: '풍경' }, { id: 'bbbb2', text: '인물' }], multiple: false, endsAt: null });
  });
  it('★ 같은 투표인가 — 보기 id 가 하나라도 겹치면 고친 것(표가 있으면 잠금), 하나도 안 겹치면 새로 넣은 것(서버 samePoll 과 같다)', () => {
    expect(samePoll(poll(), poll({ options: [{ id: 'aaaa1', text: '바꾼 글자' }, { id: 'nnnn1', text: '새 보기' }] }))).toBe(true);
    expect(samePoll(poll(), poll({ options: [{ id: 'nnnn1', text: '풍경' }, { id: 'nnnn2', text: '인물' }] }))).toBe(false);
    const server = backend('src/lib/postPoll.ts');
    expect(server).toContain('export function samePoll(');
    expect(server).toMatch(/a\.options\.some\(\(o\) => b\.options\.some\(\(x\) => x\.id === o\.id\)\)/);
  });
  it('마감 글자 · 백분율', () => {
    const now = Date.parse('2026-11-13T09:00:00Z');
    expect(pollDeadlineText(null, now)).toBe('');
    expect(pollDeadlineText('2026-11-13T08:00:00Z', now)).toBe('마감됨');
    expect(pollDeadlineText(endsAtAfterDays(3, now), now)).toMatch(/마감$/);
    expect(endsAtAfterDays(0, now)).toBeNull();
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(null, 3)).toBe(0);
    expect(pollPercent(0, 0)).toBe(0);
  });
});

describe('동영상 · 넘겨 보기', () => {
  it('★ 글 동영상 한도는 서버 업로드 한도와 같다(25MB) — 화면이 먼저 막아 헛된 업로드를 줄인다', () => {
    const upload = backend('src/routes/upload.ts');
    const m = upload.match(/export const CHAT_VIDEO_MAX_BYTES = (\d+) \* 1024 \* 1024/);
    expect(m).not.toBeNull();
    expect(POST_VIDEO_MAX_BYTES).toBe(Number(m![1]) * 1024 * 1024);
    expect(upload).toMatch(/router\.post\('\/post-video', authenticate, uploadSlot, videoUpload\.single\('video'\)/);
  });
  it('★ 넘겨 보기 틀 — 가장 세로로 긴 사진에 맞추되 4:5 ~ 1.91:1 로 묶는다', () => {
    expect(slideFrameRatio([{ width: 1600, height: 900 }, { width: 1000, height: 1000 }])).toBe(1);
    expect(slideFrameRatio([{ width: 600, height: 1200 }])).toBe(0.8);
    expect(slideFrameRatio([{ width: 3000, height: 1000 }])).toBe(1.91);
    expect(slideFrameRatio([{ width: null, height: null }])).toBeCloseTo(4 / 3);
  });
  it('넘겨 보기는 한 장씩 — 다음 사진이 옆에 비치지 않는다(칸 폭 100%, 한 장씩 멈춤)', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');
    expect(css).toMatch(/\.post-slide\s*\{[^}]*flex:\s*0 0 100%/);
    expect(css).toMatch(/scroll-snap-stop:\s*always/);
  });
});
