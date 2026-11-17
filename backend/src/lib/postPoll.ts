import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { POST_DOC_LIMITS, type PollDef } from './postDoc';

/**
 * 커뮤니티 글 투표 (2026-11-13) — 한 글에 하나. 정의는 문서의 `poll` 블록에서 서버가 뽑아 `Post.poll` 에 두고, 표는 `PostPollVote`(사람 × 보기).
 *
 * - **누가 무엇을 골랐는지는 내보내지 않는다** — 보기마다 표 수와 참여한 사람 수, 그리고 **내 표**만.
 * - 결과(표 수)는 **투표한 사람·마감 뒤·글쓴이·관리자**에게만 — 먼저 결과를 보면 쏠린다(흔한 관례). 참여 인원은 누구에게나.
 * - 마감 전에는 표를 바꾸거나 취소할 수 있다.
 * - ⚠️ 표가 생긴 뒤에는 질문·보기·복수 선택을 **못 바꾼다**(`samePollShape`) — 고른 뒤 보기가 바뀌면 그 표는 다른 질문에 대한 답이 된다.
 *   마감 시각은 바꿀 수 있다(연장·조기 마감). 투표 블록을 통째로 빼면 표도 지운다.
 */

/** DB 의 JSON → 투표 정의(모양이 틀리면 null — 던지지 않는다) */
export function asPollDef(raw: unknown): PollDef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.question !== 'string' || !Array.isArray(r.options)) return null;
  const options = r.options
    .filter((o): o is { id: string; text: string } => !!o && typeof o === 'object' && typeof (o as { id?: unknown }).id === 'string' && typeof (o as { text?: unknown }).text === 'string')
    .slice(0, POST_DOC_LIMITS.pollOptionsMax);
  if (options.length === 0) return null;
  return { question: r.question, options, multiple: r.multiple === true, endsAt: typeof r.endsAt === 'string' ? r.endsAt : null };
}

export const pollClosed = (def: PollDef, now = Date.now()): boolean => def.endsAt != null && Date.parse(def.endsAt) <= now;

/** 질문·보기(id·글자)·복수 선택이 같은가 — 마감 시각은 보지 않는다 */
export function samePollShape(a: PollDef, b: PollDef): boolean {
  if (a.question !== b.question || a.multiple !== b.multiple || a.options.length !== b.options.length) return false;
  return a.options.every((o, i) => o.id === b.options[i]!.id && o.text === b.options[i]!.text);
}

/**
 * 같은 투표인가 — 보기 id 가 하나라도 겹치면 '고친 것', 하나도 안 겹치면 '빼고 새로 넣은 것'.
 * 새로 넣은 투표는 옛 표를 지우고 받는다(옛 표가 다른 질문의 답으로 남지 않으니 괜찮다). 고친 것만 표가 있으면 잠근다.
 */
export function samePoll(a: PollDef, b: PollDef): boolean {
  return a.options.some((o) => b.options.some((x) => x.id === o.id));
}

export interface PollView {
  question: string;
  multiple: boolean;
  endsAt: string | null;
  closed: boolean;
  /** 참여한 사람 수 */
  voters: number;
  /** 결과를 보여 줘도 되는가 — false 면 count 는 null */
  showResults: boolean;
  options: { id: string; text: string; count: number | null }[];
  /** 내가 고른 보기 */
  myVotes: string[];
}

export async function pollView(
  db: PrismaClient,
  postId: number,
  def: PollDef,
  viewer: { id: number; isAuthor: boolean; isAdmin: boolean } | null,
): Promise<PollView> {
  const [byOption, byUser, mine] = await Promise.all([
    db.postPollVote.groupBy({ by: ['optionId'], where: { postId }, _count: { _all: true } }),
    db.postPollVote.groupBy({ by: ['userId'], where: { postId } }),
    viewer ? db.postPollVote.findMany({ where: { postId, userId: viewer.id }, select: { optionId: true } }) : Promise.resolve([]),
  ]);
  const counts = new Map(byOption.map((g) => [g.optionId, g._count._all]));
  const closed = pollClosed(def);
  const myVotes = mine.map((m) => m.optionId).filter((id) => def.options.some((o) => o.id === id));
  const showResults = closed || myVotes.length > 0 || !!viewer?.isAuthor || !!viewer?.isAdmin;
  return {
    question: def.question,
    multiple: def.multiple,
    endsAt: def.endsAt,
    closed,
    voters: byUser.length,
    showResults,
    options: def.options.map((o) => ({ id: o.id, text: o.text, count: showResults ? counts.get(o.id) ?? 0 : null })),
    myVotes,
  };
}

/** 받은 표가 이 투표에 맞는가 — 단일 선택은 정확히 하나, 복수는 하나 이상. 같은 보기를 두 번 보내도 하나로 */
export function checkVote(def: PollDef, optionIds: string[]): string[] {
  if (pollClosed(def)) throw new AppError('마감된 투표예요.', 400);
  const uniq = [...new Set(optionIds)];
  if (uniq.length === 0) throw new AppError('보기를 골라 주세요.', 400);
  if (uniq.some((id) => !def.options.some((o) => o.id === id))) throw new AppError('없는 보기예요. 화면을 새로고침해 주세요.', 400);
  if (!def.multiple && uniq.length !== 1) throw new AppError('하나만 고를 수 있어요.', 400);
  return uniq;
}
