import { POST_DOC_LIMITS, type PollAttrs } from './postDoc';

/**
 * 커뮤니티 글 투표 (2026-11-13) — 화면 쪽 도우미. 판정(마감·결과 공개·표 바꾸기)은 서버 `backend/src/lib/postPoll.ts` 가 한다.
 * 한 글에 하나 · 단일/복수 선택 · 마감(없음/며칠 뒤) · 결과(표 수)는 투표한 사람·글쓴이·마감 뒤에만.
 */
export interface PollView {
  question: string;
  multiple: boolean;
  endsAt: string | null;
  closed: boolean;
  voters: number;
  showResults: boolean;
  options: { id: string; text: string; count: number | null }[];
  myVotes: string[];
}

/** 보기 id — 무작위 8자(서버 /^[A-Za-z0-9]{4,24}$/). 글자를 고쳐도 표가 따라가게 보기마다 하나 */
export function newOptionId(): string {
  let s = '';
  while (s.length < 8) s += Math.random().toString(36).slice(2);
  return s.slice(0, 8);
}

export const emptyPoll = (): PollAttrs => ({
  question: '',
  options: [{ id: newOptionId(), text: '' }, { id: newOptionId(), text: '' }],
  multiple: false,
  endsAt: null,
});

/** 마감 고르기 — 며칠 뒤(0 = 없음) */
export const POLL_DURATIONS: [number, string][] = [[0, '마감 없음'], [1, '1일 뒤'], [3, '3일 뒤'], [7, '7일 뒤'], [14, '14일 뒤']];

export function endsAtAfterDays(days: number, now = Date.now()): string | null {
  return days > 0 ? new Date(now + days * 86_400_000).toISOString() : null;
}

/** '11월 20일 오후 6:00 마감' · 지났으면 '마감됨' · 없으면 '' */
export function pollDeadlineText(endsAt: string | null | undefined, now = Date.now()): string {
  if (!endsAt) return '';
  const t = Date.parse(endsAt);
  if (!Number.isFinite(t)) return '';
  if (t <= now) return '마감됨';
  return `${new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} 마감`;
}

/** 넣기 전에 — 문제가 있으면 이유(서버 등록 규칙과 같다) */
export function pollProblem(p: PollAttrs): string | null {
  if (!p.question.trim()) return '질문을 써 주세요.';
  const filled = p.options.filter((o) => o.text.trim());
  if (filled.length < POST_DOC_LIMITS.pollOptionsMin) return `보기를 ${POST_DOC_LIMITS.pollOptionsMin}개 이상 써 주세요.`;
  const texts = filled.map((o) => o.text.trim());
  if (new Set(texts).size !== texts.length) return '같은 보기가 두 번 있어요.';
  return null;
}

/** 빈 보기를 빼고 글자 앞뒤 공백을 다듬는다(보기 id 는 지킨다) */
export function tidyPoll(p: PollAttrs): PollAttrs {
  return {
    question: p.question.trim().slice(0, POST_DOC_LIMITS.pollQuestionChars),
    options: p.options.filter((o) => o.text.trim()).map((o) => ({ id: o.id, text: o.text.trim().slice(0, POST_DOC_LIMITS.pollOptionChars) })),
    multiple: !!p.multiple,
    endsAt: p.endsAt ?? null,
  };
}

/**
 * 같은 투표인가 — 보기 id 가 하나라도 겹치면 '고친 것', 하나도 안 겹치면 '빼고 새로 넣은 것'(서버 lib/postPoll.ts samePoll 과 같다).
 * 이미 표가 모인 투표를 **고칠 때만** 질문·보기를 잠근다 — 빼고 새로 넣은 투표는 잠그지 않는다(올리면 옛 표는 지워진다).
 */
export function samePoll(a: Pick<PollAttrs, 'options'>, b: Pick<PollAttrs, 'options'>): boolean {
  return (a.options ?? []).some((o) => (b.options ?? []).some((x) => x.id === o.id));
}

/** 백분율(표 0 이면 0) */
export const pollPercent = (count: number | null, total: number): number => (count && total > 0 ? Math.round((count / total) * 100) : 0);
