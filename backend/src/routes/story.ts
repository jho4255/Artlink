/**
 * ArtStory 소식 (작업 중 사진 + 짧은 글)
 *
 * ## 설계 (2026-11-14 개편, CLAUDE.md 규칙 81)
 * - **전체공개 소식은 누구나 본다** — 홈 맨 위 ArtStory 줄(`GET /public?rail=1`)과 [전체 보기](`GET /public`).
 *   블라인드 스토리 방식이다. 그 전엔 '내가 이웃한 사람 + 나' 만 보였는데, 이웃이 없으니 볼 게 없고 볼 사람이 없으니
 *   아무도 올리지 않았다(실서버 9월 말: 소식 0건 · 이웃 관계 7건).
 * - 공개 범위는 **글마다** — `PUBLIC`(전체공개, 기본) | `NEIGHBORS`(이웃공개 — 홈에는 안 나오고 나를 이웃 추가한 사람만 본다).
 * - 이웃은 남는다 — 뜻이 '보려면 필요한 것'에서 '이 사람 소식을 놓치지 않으려는 것'으로 바뀌었다([이웃] 탭 = `GET /feed?scope=neighbors`).
 * - 모두에게 보이는 만큼: 신고(3명이면 저절로 내림) · 운영이 내리기/되살리기 · 이 사람 소식 그만 보기 · 하루 10개.
 *   내린 소식은 **지우지 않고 가린다**(`hiddenAt`) — 주인·관리자 말고는 없는 소식으로 친다(404, 규칙 23).
 * - 스토리는 익명이 없다 — 소식은 '누가 무엇을' 이 핵심이고, 홈페이지로 이어지는 길이다.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';
import { resolveMentions, notifyMentions } from '../lib/mention';
import { authorProfiles } from '../lib/authorProfiles';
import { withKeyLock, LOCK_NS } from '../lib/keyLock';
import { logger } from '../lib/logger';
import {
  STORY_BG_KEYS, STORY_REPORT_REASONS, STORY_REPORT_HIDE_AT, STORY_DAILY_MAX, STORY_RAIL_MAX, STORY_PAGE_SIZE,
  STORY_OVERLAY_MAX, STORY_OVERLAY_SIZES, STORY_OVERLAY_STYLES,
  STORY_PUBLIC_DAYS, STORY_SHUFFLE_MAX, STORY_SEEN_MAX, STORY_MINE_FRONT_MS,
} from '../lib/storyRules';
import { shuffledStoryIds, parseSeed, parseIdList } from '../lib/storyOrder';
import { personStoryScope } from '../lib/homepageNews';

const router = Router();

/**
 * 알림이 가리키는 곳 — **그 소식이 열린 채로** 연다.
 * ⚠️ 예전엔 그냥 `/feed` 라, 알림을 눌러도 [소식] 첫 화면이 뜰 뿐 무엇 때문에 온 건지 알 수 없었다.
 */
const storyLink = (storyId: number, commentId?: number) =>
  `/feed?story=${storyId}${commentId ? `&comment=${commentId}` : ''}`;

/**
 * 스토리 사진도 **우리 저장소** 주소만 (외부 URL 차단).
 * `kept` — 보낸 순서의 몇 번째가 살아남았나(사진 위 글의 사진 번호를 옮겨 적으려고. 바깥 주소가 빠지면 번호가 밀린다).
 */
function ownImageUrls(raw: unknown): { urls: string[]; kept: number[] } {
  const urls: string[] = [];
  const kept: number[] = [];
  if (!Array.isArray(raw)) return { urls, kept };
  raw.slice(0, 10).forEach((u, i) => {
    const s = safeFileUrl(u);
    if (s && (s.startsWith('/uploads/') || matchR2Base(s))) { urls.push(s); kept.push(i); }
  });
  return { urls, kept };
}

const overlaySchema = z.object({
  i: z.number().int().min(0).max(9),
  text: z.string().trim().min(1).max(STORY_OVERLAY_MAX, `사진 위 글은 ${STORY_OVERLAY_MAX}자까지예요.`),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  size: z.enum(STORY_OVERLAY_SIZES).optional().default('m'),
  style: z.enum(STORY_OVERLAY_STYLES).optional().default('plain'),
});
type Overlay = z.infer<typeof overlaySchema>;

/**
 * 사진 위 글 — 남아 있는 사진에만, 사진 하나에 하나(먼저 온 것), 자리는 사진 안쪽(가장자리 5%)으로.
 * 사진 번호는 살아남은 사진 기준으로 옮겨 적는다.
 */
function cleanOverlays(raw: Overlay[] | undefined, kept: number[]): Overlay[] {
  const out: Overlay[] = [];
  const seen = new Set<number>();
  const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v));
  for (const o of raw ?? []) {
    const i = kept.indexOf(o.i);
    if (i < 0 || seen.has(i)) continue;
    seen.add(i);
    out.push({ i, text: o.text.slice(0, STORY_OVERLAY_MAX), x: clamp(o.x), y: clamp(o.y), size: o.size, style: o.style });
  }
  return out;
}

type Viewer = { id: number; role: string } | undefined;

const authorSelect = { select: { id: true, name: true, nickname: true, avatar: true, role: true, handle: true, deletedAt: true } } as const;
type AuthorRow = { id: number; name: string; nickname: string | null; avatar: string | null; role: string; handle: string | null; deletedAt: Date | null };
const serializeAuthor = (a: AuthorRow, homepage: string | null = null) => ({
  id: a.id, name: a.deletedAt ? '탈퇴한 회원' : (a.nickname || a.name), avatar: a.deletedAt ? null : a.avatar, role: a.role,
  homepage: a.deletedAt ? null : homepage,
});

type StoryRow = {
  id: number; authorId: number; caption: string; images: string[]; bg: string | null; overlays: unknown; visibility: string; createdAt: Date;
  hiddenAt: Date | null; hiddenReason: string | null;
  author: AuthorRow; likeCount: number; commentCount: number;
};

/**
 * 소식 하나를 내보낼 모양. 내린 소식 표시(`hidden`)는 **주인·관리자에게만** 싣는다 — 남에게는 애초에 오지 않는다.
 * `homepage` 는 [홈페이지] 버튼이 갈 곳(작가·갤러리만, 일반 회원은 null).
 */
function serialize(s: StoryRow, viewer: Viewer, liked: boolean, homepage: string | null) {
  const mine = viewer?.id === s.authorId;
  const staff = mine || viewer?.role === 'ADMIN';
  return {
    id: s.id, caption: s.caption, images: s.images, bg: s.bg, overlays: Array.isArray(s.overlays) ? s.overlays : [],
    visibility: s.visibility, createdAt: s.createdAt,
    author: serializeAuthor(s.author, homepage), mine,
    likeCount: s.likeCount, commentCount: s.commentCount, liked,
    ...(staff ? { hidden: !!s.hiddenAt, hiddenReason: s.hiddenAt ? s.hiddenReason : null } : {}),
  };
}

/** 뷰어가 좋아요한 스토리 id 집합 (여러 스토리를 한 번에) */
async function likedSet(viewerId: number | undefined, storyIds: number[]): Promise<Set<number>> {
  if (!viewerId || storyIds.length === 0) return new Set();
  const rows = await prisma.storyLike.findMany({ where: { userId: viewerId, storyId: { in: storyIds } }, select: { storyId: true } });
  return new Set(rows.map((r) => r.storyId));
}

/** 여러 소식을 한 번에 내보낸다 — 좋아요 여부·작성자 홈페이지를 소식마다 묻지 않는다(N+1 금지) */
async function serializeMany(rows: StoryRow[], viewer: Viewer) {
  const [liked, profiles] = await Promise.all([
    likedSet(viewer?.id, rows.map((s) => s.id)),
    authorProfiles(rows.filter((s) => !s.author.deletedAt).map((s) => s.author)),
  ]);
  return rows.map((s) => serialize(s, viewer, liked.has(s.id), profiles[s.author.id]?.homepage ?? null));
}

/**
 * 공개 목록에 함께 거는 조건 — 안 내려간 것 · 탈퇴하지 않은 사람 ·
 * (로그인했으면) 내가 그만 보기 한 사람 빼고 · 내가 신고한 소식 빼고(신고하면 내 화면에서는 곧바로 사라진다).
 */
function listFilters(me?: number): Prisma.StoryWhereInput {
  return {
    hiddenAt: null,
    author: { deletedAt: null, ...(me ? { storyMutedBy: { none: { userId: me } } } : {}) },
    ...(me ? { reports: { none: { reporterId: me } } } : {}),
  };
}

const ORDER: Prisma.StoryOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

/**
 * `?cursor=<마지막으로 받은 소식 id>` 다음부터. 정렬이 (시각, id) 라 커서도 둘 다로 자른다 —
 * id 만으로 자르면 시각과 id 순서가 어긋난 행(옮겨 온 데이터·시각을 고친 시드)이 건너뛰어지거나 두 번 온다.
 * 커서 소식이 그새 지워졌으면 id 만으로 자른다(빈 결과보다 낫다).
 */
async function cursorWhere(raw: unknown): Promise<Prisma.StoryWhereInput | null> {
  const id = parseInt(String(raw ?? ''));
  if (!Number.isFinite(id) || id <= 0) return null;
  const c = await prisma.story.findUnique({ where: { id }, select: { createdAt: true } });
  if (!c) return { id: { lt: id } };
  return { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: id } }] };
}

function pageSize(raw: unknown, def: number, max: number): number {
  const n = parseInt(String(raw ?? ''));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

/** 한 쪽을 받는다 — 하나 더 받아 다음 쪽이 있는지 안다 */
async function fetchPage(where: Prisma.StoryWhereInput, cursor: unknown, take: number, viewer: Viewer) {
  const after = await cursorWhere(cursor);
  const rows = await prisma.story.findMany({
    where: after ? { AND: [where, after] } : where,
    orderBy: ORDER, take: take + 1, include: { author: authorSelect },
  });
  const page = rows.slice(0, take);
  return {
    stories: await serializeMany(page, viewer),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
  };
}

/**
 * GET /public — 전체공개 소식 (로그인 없이도). **최근 `STORY_PUBLIC_DAYS`(30)일 안 소식만** — 너무 오래된 건 안 뜬다(2026-11-14 사용자 결정).
 *  · `?rail=1` — 홈 줄. **한 사람당 가장 새 소식 하나**만(한 사람이 다섯 개 올려 줄을 다 차지하지 않게), 최대 12.
 *  · `?seed=N&seen=1,2&offset=K` — [전체 보기] 무작위 순서(`lib/storyOrder.ts`): 하루 안 된 내 소식 → 안 본 소식(시드로 섞음) → 본 소식(최신순).
 *    화면이 열 때·[새로고침] 때 새 시드를 만든다. `nextCursor` 는 다음 offset.
 *  · 그 밖 — 최신순, `?cursor=` 로 이어 받는다(시드 없이 부르는 옛 화면·다른 쓰임).
 */
router.get('/public', optionalAuth, async (req, res, next) => {
  try {
    const viewer = req.user;
    const since = new Date(Date.now() - STORY_PUBLIC_DAYS * 24 * 60 * 60 * 1000);
    const where: Prisma.StoryWhereInput = { visibility: 'PUBLIC', createdAt: { gte: since }, ...listFilters(viewer?.id) };
    const seed = parseSeed(req.query.seed);
    if (seed && req.query.rail !== '1') {
      const take = pageSize(req.query.limit, STORY_PAGE_SIZE, 48);
      const offset = Math.max(0, Math.min(STORY_SHUFFLE_MAX, parseInt(String(req.query.offset ?? '0')) || 0));
      const heads = await prisma.story.findMany({ where, orderBy: ORDER, take: STORY_SHUFFLE_MAX, select: { id: true, authorId: true, createdAt: true } });
      const order = shuffledStoryIds(heads, { seed, seen: parseIdList(req.query.seen, STORY_SEEN_MAX), me: viewer?.id, mineFrontMs: STORY_MINE_FRONT_MS });
      const ids = order.slice(offset, offset + take);
      const rows = ids.length ? await prisma.story.findMany({ where: { id: { in: ids } }, include: { author: authorSelect } }) : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as StoryRow[];
      return res.json({ stories: await serializeMany(ordered, viewer), nextCursor: offset + take < order.length ? offset + take : null });
    }
    if (req.query.rail === '1') {
      const limit = pageSize(req.query.limit, STORY_RAIL_MAX, 20);
      // 가볍게 id·작성자만 넉넉히 받아 사람마다 첫 줄을 고른다(하루 10개 상한이라 120줄이면 열두 사람을 넘는다)
      const heads = await prisma.story.findMany({ where, orderBy: ORDER, take: 120, select: { id: true, authorId: true } });
      const seen = new Set<number>();
      const ids: number[] = [];
      for (const h of heads) {
        if (seen.has(h.authorId)) continue;
        seen.add(h.authorId);
        ids.push(h.id);
        if (ids.length >= limit) break;
      }
      const rows = ids.length ? await prisma.story.findMany({ where: { id: { in: ids } }, include: { author: authorSelect } }) : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as StoryRow[];
      return res.json({ stories: await serializeMany(ordered, viewer), nextCursor: null });
    }
    res.json(await fetchPage(where, req.query.cursor, pageSize(req.query.limit, STORY_PAGE_SIZE, 48), viewer));
  } catch (e) { next(e); }
});

/**
 * GET /feed — 이웃 소식 (로그인 필요).
 *  · `?scope=neighbors` — 내가 이웃 추가한 사람들(나는 빼고, [내 소식] 탭이 따로 있다). 이웃공개 소식도 보인다(이웃이니까).
 *  · 쿼리 없이 `?page=` — 옛 화면(배포 사이에 남은 탭)용. 나 + 이웃, 쪽 번호.
 */
router.get('/feed', authenticate, async (req, res, next) => {
  try {
    const viewer = req.user!;
    const me = viewer.id;
    const following = await prisma.follow.findMany({ where: { followerId: me }, select: { followingId: true } });
    const followIds = following.map((f) => f.followingId);

    if (req.query.scope === 'neighbors' || req.query.cursor !== undefined) {
      const where: Prisma.StoryWhereInput = { authorId: { in: followIds }, ...listFilters(me) };
      const page = await fetchPage(where, req.query.cursor, pageSize(req.query.limit, STORY_PAGE_SIZE, 48), viewer);
      return res.json({ ...page, followingCount: followIds.length });
    }

    const pageNo = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
    const take = 20;
    // 옛 모양 — 내 소식(내린 것 포함)과 이웃의 안 내린 소식
    const where: Prisma.StoryWhereInput = {
      OR: [{ authorId: me }, { authorId: { in: followIds }, ...listFilters(me) }],
    };
    const [rows, total] = await Promise.all([
      prisma.story.findMany({ where, orderBy: ORDER, skip: (pageNo - 1) * take, take, include: { author: authorSelect } }),
      prisma.story.count({ where }),
    ]);
    res.json({
      stories: await serializeMany(rows, viewer),
      total, page: pageNo, hasMore: pageNo * take < total,
      followingCount: followIds.length,
    });
  } catch (e) { next(e); }
});

/**
 * GET /user/:userId — 한 사람의 소식 ([내 소식] 탭 · 작가 홈페이지). 비팔로워는 전체공개만, 내린 소식은 주인·관리자만.
 * `?cursor=` 로 이어 받는다(기본 30개).
 */
router.get('/user/:userId', optionalAuth, async (req, res, next) => {
  try {
    const viewer = req.user;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);

    // 규칙은 lib/homepageNews.ts 한 곳 — 홈페이지 [소식] 탭을 그릴지(storyCount)도 같은 함수를 본다
    const { where, canSeeNeighbors } = await personStoryScope(viewer, target);
    const page = await fetchPage(where, req.query.cursor, pageSize(req.query.limit, 30, 60), viewer);
    res.json({ ...page, canSeeNeighbors });
  } catch (e) { next(e); }
});

// ── 작성 ──
const createSchema = z.object({
  caption: z.string().trim().max(1000, '글은 1000자까지입니다.').optional().default(''),
  images: z.array(z.string()).max(10, '사진은 10장까지입니다.').optional().default([]),
  visibility: z.enum(['PUBLIC', 'NEIGHBORS']).optional().default('PUBLIC'),
  /** 글만 있는 소식의 바탕색 — 사진이 있으면 저장하지 않는다 */
  bg: z.enum(STORY_BG_KEYS).nullable().optional(),
  /** 사진 위 글 — 사진 소식에만 */
  overlays: z.array(overlaySchema).max(10).optional(),
});

router.post('/', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const caption = String(req.body.caption ?? '').trim();
    const { urls: images, kept } = ownImageUrls(req.body.images);
    if (!caption && images.length === 0) throw new AppError('사진이나 글 중 하나는 있어야 합니다.', 400);
    const overlays = images.length ? cleanOverlays(req.body.overlays, kept) : [];
    const me = req.user!.id;
    const mentions = await resolveMentions(prisma, me, caption);
    // 하루(24시간) 10개 — '세고 나서 만들기'라 한 사람씩 줄 세운다(동시에 보내도 11개가 되지 않게, keyLock 주석)
    const story = await withKeyLock(LOCK_NS.storyDaily, me, async (tx) => {
      const recent = await tx.story.count({ where: { authorId: me, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
      if (recent >= STORY_DAILY_MAX) throw new AppError(`소식은 하루에 ${STORY_DAILY_MAX}개까지 올릴 수 있어요.`, 429);
      return tx.story.create({
        data: {
          authorId: me, caption, images,
          visibility: req.body.visibility ?? 'PUBLIC',
          bg: images.length === 0 ? (req.body.bg ?? null) : null,
          overlays: overlays.length ? overlays : undefined,
        },
        include: { author: authorSelect },
      });
    });
    await notifyMentions(prisma, {
      meId: me, meName: story.author.nickname || story.author.name, targets: mentions,
      where: '소식', linkUrl: storyLink(story.id), refKey: `mention:story:${story.id}`,
    });
    const [out] = await serializeMany([story], req.user);
    res.status(201).json(out);
  } catch (e) { next(e); }
});

/**
 * 이 소식을 이 사람이 볼 수 있는가 — `GET /:id` 와 **같은 규칙**을 댓글·좋아요·좋아요 명단·신고 라우트도 통과한다 (2026-09-19).
 *  · 주인·관리자 → 늘
 *  · 내린 소식·탈퇴한 사람의 소식 → 아무도(위 둘 빼고)
 *  · 전체공개 → 누구나 / 이웃공개 → 작성자를 이웃 추가한 사람
 * @returns 볼 수 있으면 스토리 행, 아니면 null (호출부가 404 로 답한다 — 403 은 존재를 알려준다)
 */
async function visibleStory(id: number, viewer?: Viewer) {
  if (!Number.isFinite(id)) return null;
  const s = await prisma.story.findUnique({
    where: { id },
    select: { id: true, authorId: true, visibility: true, caption: true, hiddenAt: true, reviewedAt: true, author: { select: { deletedAt: true } } },
  });
  if (!s) return null;
  const me = viewer?.id;
  if (s.authorId === me || viewer?.role === 'ADMIN') return s;
  if (s.hiddenAt || s.author.deletedAt) return null;
  if (s.visibility === 'PUBLIC') return s;
  if (!me) return null;
  const follows = await prisma.follow.findFirst({ where: { followerId: me, followingId: s.authorId }, select: { id: true } });
  return follows ? s : null;
}

// ── 좋아요 누른 사람 목록 (스토리는 익명 없음 — 누가 눌렀는지 보인다) ──
router.get('/:id/likers', optionalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!(await visibleStory(id, req.user))) throw new AppError('소식을 찾을 수 없습니다.', 404);
    const rows = await prisma.storyLike.findMany({
      where: { storyId: id, user: { deletedAt: null } }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: authorSelect },
    });
    const profiles = await authorProfiles(rows.map((r) => r.user));
    res.json(rows.map((r) => serializeAuthor(r.user, profiles[r.user.id]?.homepage ?? null)));
  } catch (e) { next(e); }
});

/**
 * 내 소식에 좋아요가 오면 알린다 (2026-11-14) — 글 좋아요(`community.ts notifyPostLike`)와 같은 방식.
 * **소식마다 한 줄로 합친다**: 24시간 안에 그 소식의 안 읽은 좋아요 알림이 있으면 새로 쌓지 않고 문구·시각만 고친다
 * ("○○님 외 N명이 내 소식을 좋아해요"). 푸시는 처음 만들 때만 울린다(합산 갱신은 updateMany 라 안 울린다).
 * ⚠️ '고쳐 쓸 줄이 없으면 만든다'를 소식마다 줄 세운다 — refKey 가 unique 가 아니라 동시에 누르면 두 줄이 된다(규칙 46).
 */
const STORY_LIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
async function notifyStoryLike(story: { id: number; authorId: number; caption: string }, likerId: number): Promise<void> {
  if (story.authorId === likerId) return;
  const liker = await prisma.user.findUnique({ where: { id: likerId }, select: { name: true, nickname: true } });
  const who = liker ? (liker.nickname || liker.name) : '누군가';
  const line = story.caption.replace(/\s+/g, ' ').trim();
  const snippet = line ? `: ${line.length > 24 ? `${line.slice(0, 24)}…` : line}` : '';
  const refKey = `story-like:${story.id}`;
  const linkUrl = storyLink(story.id);
  await withKeyLock(LOCK_NS.storyLikeNotes, story.id, async (tx) => {
    const since = new Date(Date.now() - STORY_LIKE_WINDOW_MS);
    const recent = await tx.storyLike.count({ where: { storyId: story.id, createdAt: { gte: since }, userId: { not: story.authorId } } });
    const others = Math.max(recent - 1, 0);
    const message = `${who}님${others > 0 ? ` 외 ${others}명이` : '이'} 내 소식을 좋아해요${snippet}`;
    const upd = await tx.notification.updateMany({
      where: { userId: story.authorId, refKey, read: false, createdAt: { gte: since } },
      data: { message, linkUrl, createdAt: new Date() },
    });
    if (upd.count === 0) {
      await tx.notification.create({ data: { userId: story.authorId, type: 'STORY_LIKE', message, linkUrl, refKey } });
    }
  });
}

// ── 좋아요 토글 ──
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const story = await visibleStory(id, req.user);
    if (!story) throw new AppError('스토리를 찾을 수 없습니다.', 404);

    // ⚠️ 연타(더블탭) 경합 — 자세한 이유는 `routes/community.ts` 의 같은 자리 주석 참고.
    //    확인 없이 지우고/만들고, 카운터는 **실제로 바뀐 행 수만큼** 움직인다.
    const out = await prisma.$transaction(async (tx) => {
      const del = await tx.storyLike.deleteMany({ where: { storyId: id, userId: me } });
      if (del.count > 0) {
        const u = await tx.story.update({
          where: { id }, data: { likeCount: { decrement: del.count } }, select: { likeCount: true },
        });
        return { liked: false, likeCount: u.likeCount, created: false };
      }
      const add = await tx.storyLike.createMany({
        data: [{ storyId: id, userId: me }], skipDuplicates: true,
      });
      const u = await tx.story.update({
        where: { id }, data: { likeCount: { increment: add.count } }, select: { likeCount: true },
      });
      return { liked: true, likeCount: u.likeCount, created: add.count > 0 };
    });
    // 이번 요청이 실제로 켰을 때만 알린다(연타로 겹친 요청·끄기는 알리지 않는다)
    if (out.created) {
      try { await notifyStoryLike(story, me); } catch (e) { logger.warn('Story', `좋아요 알림 실패(story ${id}): ${(e as Error).message}`); }
    }
    res.json({ liked: out.liked, likeCount: out.likeCount });
  } catch (e) { next(e); }
});

// ── 댓글 목록 ──
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user?.id;
    if (!(await visibleStory(id, req.user))) throw new AppError('소식을 찾을 수 없습니다.', 404);
    const rows = await prisma.storyComment.findMany({
      where: { storyId: id }, orderBy: { createdAt: 'asc' }, include: { author: authorSelect }, take: 500,
    });
    const profiles = await authorProfiles(rows.filter((c) => !c.author.deletedAt).map((c) => c.author));
    res.json(rows.map((c) => ({
      id: c.id, body: c.body, createdAt: c.createdAt,
      author: serializeAuthor(c.author, profiles[c.author.id]?.homepage ?? null), mine: me != null && me === c.authorId,
    })));
  } catch (e) { next(e); }
});

// ── 댓글 작성 (@mention 지원) ──
const commentSchema = z.object({ body: z.string().trim().min(1, '댓글을 입력해주세요.').max(1000, '댓글은 1000자까지입니다.') });
router.post('/:id/comments', authenticate, validate(commentSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const story = await visibleStory(id, req.user);
    if (!story) throw new AppError('스토리를 찾을 수 없습니다.', 404);

    const body = req.body.body.trim();
    // 멘션은 **글을 고치지 않는다** — 부를 수 있는 사람에게만 알림이 간다(`lib/mention.ts`).
    const mentions = await resolveMentions(prisma, me, body);

    const [comment] = await prisma.$transaction([
      prisma.storyComment.create({ data: { storyId: id, authorId: me, body }, include: { author: authorSelect } }),
      prisma.story.update({ where: { id }, data: { commentCount: { increment: 1 } } }),
    ]);
    const meName = comment.author.nickname || comment.author.name;
    // 스토리 주인에게 알림 (자기 글에 자기가 달면 없음)
    if (story.authorId !== me) {
      try {
        await prisma.notification.create({
          data: { userId: story.authorId, type: 'STORY_COMMENT', message: `${meName}님이 소식에 댓글을 남겼습니다.`, linkUrl: storyLink(id, comment.id) },
        });
      } catch { /* best-effort */ }
    }
    await notifyMentions(prisma, {
      meId: me, meName, targets: mentions,
      where: '소식 댓글', linkUrl: storyLink(id, comment.id), refKey: `mention:story-comment:${comment.id}`,
      skip: story.authorId !== me ? [story.authorId] : [],   // 방금 댓글 알림을 받았다
    });
    const profiles = await authorProfiles([comment.author]);
    res.status(201).json({
      id: comment.id, body: comment.body, createdAt: comment.createdAt,
      author: serializeAuthor(comment.author, profiles[comment.author.id]?.homepage ?? null), mine: true,
    });
  } catch (e) { next(e); }
});

// ── 댓글 삭제 (작성자 · 스토리 주인 · Admin) ──
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const commentId = parseInt(req.params.commentId as string);
    const me = req.user!.id;
    const comment = await prisma.storyComment.findUnique({ where: { id: commentId }, select: { authorId: true, storyId: true, story: { select: { authorId: true } } } });
    if (!comment || comment.storyId !== id) throw new AppError('댓글을 찾을 수 없습니다.', 404);
    if (comment.authorId !== me && comment.story.authorId !== me && req.user!.role !== 'ADMIN') throw new AppError('삭제 권한이 없습니다.', 403);
    // 지운 행 수만큼만 센다 — 같은 댓글을 두 번 지우는 요청이 겹쳐도 카운터가 음수로 가지 않게(규칙 46)
    await prisma.$transaction(async (tx) => {
      const del = await tx.storyComment.deleteMany({ where: { id: commentId } });
      if (del.count > 0) await tx.story.update({ where: { id }, data: { commentCount: { decrement: del.count } } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 공개 범위 바꾸기 (주인만) — [이웃 공개로 바꾸기]면 홈에서 내려간다 ──
router.patch('/:id/visibility', authenticate, validate(z.object({ visibility: z.enum(['PUBLIC', 'NEIGHBORS']) })), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const s = Number.isFinite(id) ? await prisma.story.findUnique({ where: { id }, select: { authorId: true } }) : null;
    if (!s) throw new AppError('소식을 찾을 수 없습니다.', 404);
    if (s.authorId !== req.user!.id) throw new AppError('내 소식만 바꿀 수 있어요.', 403);
    const u = await prisma.story.update({ where: { id }, data: { visibility: req.body.visibility }, select: { visibility: true } });
    res.json(u);
  } catch (e) { next(e); }
});

/**
 * 신고 (2026-11-14) — 한 사람이 한 소식에 한 번(두 번째는 조용히 성공). 내 소식은 신고 못 한다.
 * 신고하면 그 소식은 **신고한 사람 화면에서 곧바로 빠진다**(목록 조건 `listFilters`).
 * 서로 다른 3명이면 저절로 내리고(`hiddenReason='REPORTS'`) 관리자 전원과 주인에게 알린다.
 * ⚠️ 관리자가 되살렸으면(`reviewedAt`) 그 뒤에 들어온 신고만 센다 — 옛 신고로 곧바로 다시 내려가지 않게.
 * ⚠️ 내리기는 `hiddenAt: null` 조건을 단 updateMany 한 번이 판정한다 — 동시에 셋째·넷째 신고가 와도 알림은 한 번.
 */
router.post('/:id/report', authenticate, validate(z.object({ reason: z.enum(STORY_REPORT_REASONS) })), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const story = await visibleStory(id, req.user);
    if (!story) throw new AppError('소식을 찾을 수 없습니다.', 404);
    if (story.authorId === me) throw new AppError('내 소식은 신고할 수 없어요.', 400);

    const add = await prisma.storyReport.createMany({ data: [{ storyId: id, reporterId: me, reason: req.body.reason }], skipDuplicates: true });
    if (add.count > 0 && !story.hiddenAt) {
      const count = await prisma.storyReport.count({
        where: { storyId: id, ...(story.reviewedAt ? { createdAt: { gt: story.reviewedAt } } : {}) },
      });
      if (count >= STORY_REPORT_HIDE_AT) {
        const hid = await prisma.story.updateMany({ where: { id, hiddenAt: null }, data: { hiddenAt: new Date(), hiddenReason: 'REPORTS' } });
        if (hid.count > 0) {
          try {
            const admins = await prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { id: true } });
            await prisma.notification.createMany({
              data: [
                { userId: story.authorId, type: 'STORY_HIDDEN', message: '신고가 여러 건 들어와 소식을 잠시 내렸어요. 운영자가 확인한 뒤 다시 보일 수 있어요.', linkUrl: storyLink(id) },
                ...admins.map((a) => ({ userId: a.id, type: 'STORY_REPORTED', message: `신고가 ${count}건 쌓여 소식을 저절로 내렸어요. 확인해 주세요.`, linkUrl: '/mypage?tab=report-manage' })),
              ],
            });
          } catch (e) { logger.warn('Story', `신고 알림 실패(story ${id}): ${(e as Error).message}`); }
        }
      }
    }
    res.json({ ok: true, already: add.count === 0 });
  } catch (e) { next(e); }
});

/**
 * 운영이 내리기/되살리기 (관리자). 둘 다 '확인했다'(`reviewedAt`)를 남겨 [신고 관리]의 확인할 목록에서 빠진다.
 * 상태가 실제로 바뀔 때만 주인에게 알린다.
 */
router.patch('/:id/hidden', authenticate, authorize('ADMIN'), validate(z.object({ hidden: z.boolean() })), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const s = Number.isFinite(id) ? await prisma.story.findUnique({ where: { id }, select: { authorId: true, hiddenAt: true } }) : null;
    if (!s) throw new AppError('소식을 찾을 수 없습니다.', 404);
    const now = new Date();
    if (req.body.hidden) {
      const changed = await prisma.story.updateMany({ where: { id, hiddenAt: null }, data: { hiddenAt: now, hiddenReason: 'ADMIN', reviewedAt: now } });
      if (changed.count === 0) await prisma.story.update({ where: { id }, data: { hiddenReason: 'ADMIN', reviewedAt: now } });   // 신고로 내려간 것을 운영이 확정
      if (changed.count > 0) {
        await prisma.notification.create({ data: { userId: s.authorId, type: 'STORY_HIDDEN', message: '운영 기준에 맞지 않아 소식을 내렸어요. 내 소식에서는 계속 볼 수 있어요.', linkUrl: storyLink(id) } }).catch(() => {});
      }
    } else {
      const changed = await prisma.story.updateMany({ where: { id, hiddenAt: { not: null } }, data: { hiddenAt: null, hiddenReason: null, reviewedAt: now } });
      if (changed.count === 0) await prisma.story.update({ where: { id }, data: { reviewedAt: now } });   // 신고만 있던 것 — '문제없음'
      if (changed.count > 0) {
        await prisma.notification.create({ data: { userId: s.authorId, type: 'STORY_RESTORED', message: '운영자가 확인했어요. 소식이 다시 보여요.', linkUrl: storyLink(id) } }).catch(() => {});
      }
    }
    const u = await prisma.story.findUnique({ where: { id }, select: { hiddenAt: true, hiddenReason: true } });
    res.json({ hidden: !!u?.hiddenAt, hiddenReason: u?.hiddenReason ?? null });
  } catch (e) { next(e); }
});

/**
 * GET /reports — [신고 관리]의 소식 신고 (관리자).
 * 신고가 있거나 내려간 소식. `pending` = 관리자가 마지막으로 확인한 뒤에 새 신고가 있다(확인할 것).
 */
router.get('/reports', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const rows = await prisma.story.findMany({
      where: { OR: [{ reports: { some: {} } }, { hiddenAt: { not: null } }] },
      include: {
        author: authorSelect,
        reports: { orderBy: { createdAt: 'desc' }, take: 50, include: { reporter: { select: { id: true, name: true, nickname: true } } } },
      },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
    const items = rows.map((s) => {
      const latest = s.reports[0]?.createdAt ?? null;
      const fresh = s.reports.filter((r) => !s.reviewedAt || r.createdAt > s.reviewedAt);
      const reasons: Record<string, number> = {};
      for (const r of s.reports) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      return {
        id: s.id, caption: s.caption, images: s.images, bg: s.bg, overlays: Array.isArray(s.overlays) ? s.overlays : [],
        visibility: s.visibility, createdAt: s.createdAt,
        author: serializeAuthor(s.author),
        hidden: !!s.hiddenAt, hiddenReason: s.hiddenAt ? s.hiddenReason : null, hiddenAt: s.hiddenAt, reviewedAt: s.reviewedAt,
        reportCount: s.reports.length, freshCount: fresh.length, pending: fresh.length > 0, reasons, latestReportAt: latest,
        reporters: s.reports.slice(0, 5).map((r) => ({ name: r.reporter.nickname || r.reporter.name, reason: r.reason, createdAt: r.createdAt })),
      };
    });
    // 확인할 것 먼저, 그 안에서는 최근 신고 순
    items.sort((a, b) => (a.pending === b.pending ? +(b.latestReportAt ?? b.hiddenAt ?? 0) - +(a.latestReportAt ?? a.hiddenAt ?? 0) : a.pending ? -1 : 1));
    res.json(items);
  } catch (e) { next(e); }
});

// ── 이 사람 소식 그만 보기 (내 화면에서만) ──
router.get('/mutes', authenticate, async (req, res, next) => {
  try {
    const rows = await prisma.storyMute.findMany({
      where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' },
      include: { mutedUser: authorSelect },
    });
    res.json(rows.map((r) => serializeAuthor(r.mutedUser)));
  } catch (e) { next(e); }
});

router.post('/mutes/:userId', authenticate, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);
    if (target === me) throw new AppError('내 소식은 그만 볼 수 없어요.', 400);
    const exists = await prisma.user.findUnique({ where: { id: target }, select: { id: true } });
    if (!exists) throw new AppError('대상을 찾을 수 없습니다.', 404);
    await prisma.storyMute.createMany({ data: [{ userId: me, mutedUserId: target }], skipDuplicates: true });
    res.json({ muted: true });
  } catch (e) { next(e); }
});

router.delete('/mutes/:userId', authenticate, async (req, res, next) => {
  try {
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);
    await prisma.storyMute.deleteMany({ where: { userId: req.user!.id, mutedUserId: target } });
    res.json({ muted: false });
  } catch (e) { next(e); }
});

// ── 삭제 (작성자 또는 Admin) ──
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const story = Number.isFinite(id) ? await prisma.story.findUnique({ where: { id }, select: { authorId: true } }) : null;
    if (!story) throw new AppError('스토리를 찾을 수 없습니다.', 404);
    if (story.authorId !== req.user!.id && req.user!.role !== 'ADMIN') throw new AppError('삭제 권한이 없습니다.', 403);
    await prisma.story.deleteMany({ where: { id } });   // 두 번 눌러도 404 대신 성공(규칙 46)
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 하이라이트 관리 (인스타그램 하이라이트처럼 프로필에 영구 보존) ──
// POST /highlights — 하이라이트 생성 (이름, 공개 여부)
router.post('/highlights', authenticate, async (req, res, next) => {
  try {
    const { name, isPublic } = req.body;
    if (!name || typeof name !== 'string' || name.length < 1 || name.length > 50) {
      throw new AppError('이름은 1~50자 사이여야 합니다.', 400);
    }
    const highlight = await prisma.storyHighlight.create({
      data: {
        userId: req.user!.id,
        name,
        isPublic: isPublic === false ? false : true,
        order: 0,
        storyIds: [],
      },
    });
    res.status(201).json(highlight);
  } catch (e: any) {
    if (e.code === 'P2002') return next(new AppError('이미 같은 이름의 하이라이트가 있습니다.', 409));
    next(e);
  }
});

// GET /highlights/:userId — 사용자의 하이라이트 목록 조회 (공개 것 + 본인 것)
router.get('/highlights/:userId', optionalAuth, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string);
    const isOwn = req.user?.id === userId;
    const highlights = await prisma.storyHighlight.findMany({
      where: {
        userId,
        ...(isOwn ? {} : { isPublic: true }), // 본인이 아니면 공개 것만
      },
      orderBy: { order: 'asc' },
    });

    // ── 커버 사진 ──
    // ⚠️ **첫 스토리만 보고 포기하지 말 것.** 스토리는 글만 있어도 되므로(사진 0장) 맨 앞이
    //    글뿐이면 커버가 비어 이니셜로 떨어진다 — 뒤에 사진이 멀쩡히 있는데도.
    //    그래서 **사진이 나올 때까지 순서대로 훑는다**: 지정 커버 → 담은 순서 → 없으면 null.
    // ⚠️ 하이라이트마다 쿼리를 돌리지 말 것(N+1) — 프로필을 열 때마다 도는 경로다. 한 번에 받는다.
    // ⚠️ 지운 스토리 id 는 `storyIds` 에 그대로 남는다(배열이라 FK 가 없다) — 실제로 있는 것만 센다.
    // ⚠️ 내린 소식(hiddenAt)은 주인 말고는 없는 것으로 친다(2026-11-14).
    const allIds = [...new Set(highlights.flatMap((h) => h.storyIds))];
    const stories = allIds.length
      ? await prisma.story.findMany({ where: { id: { in: allIds }, ...(isOwn ? {} : { hiddenAt: null }) }, select: { id: true, images: true } })
      : [];
    const imagesOf = new Map<number, string[]>(stories.map((s) => [s.id, s.images]));

    res.json(highlights.map((h) => {
      const live = h.storyIds.filter((id) => imagesOf.has(id));
      const order = h.coverStoryId ? [h.coverStoryId, ...live] : live;
      const coverImage = order.map((id) => imagesOf.get(id)?.[0]).find(Boolean) ?? null;
      return { ...h, coverImage, storyCount: live.length };
    }));
  } catch (e) { next(e); }
});

// GET /highlights/:id/stories — 하이라이트에 담긴 스토리 (동그라미를 눌렀을 때 펼칠 것)
// ⚠️ `/highlights/:userId` 와 헷갈리지 말 것 — 이쪽 `:id` 는 **하이라이트 id** 다.
//    세그먼트 수가 달라 라우트가 겹치지는 않는다.
router.get('/highlights/:id/stories', optionalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const h = await prisma.storyHighlight.findUnique({ where: { id } });
    // 비공개는 주인 말고는 **없는 것으로** 답한다(403 은 존재를 알려준다 — 규칙 23)
    if (!h || (!h.isPublic && h.userId !== req.user?.id)) throw new AppError('하이라이트를 찾을 수 없습니다.', 404);
    const isOwn = h.userId === req.user?.id;

    const rows = await prisma.story.findMany({
      where: { id: { in: h.storyIds }, ...(isOwn ? {} : { hiddenAt: null }) },
      include: { author: authorSelect },
    });
    // 담은 순서를 지킨다 — `findMany` 순서를 믿지 말 것
    const byId = new Map(rows.map((s) => [s.id, s]));
    const ordered = h.storyIds.map((sid) => byId.get(sid)).filter(Boolean) as typeof rows;

    res.json({
      id: h.id, name: h.name, isPublic: h.isPublic,
      mine: isOwn,   // 뷰어가 이름 바꾸기·공개 전환·소식 빼기·삭제 버튼을 그릴지 판정한다(2026-09-19)
      stories: await serializeMany(ordered, req.user),
    });
  } catch (e) { next(e); }
});

// PATCH /highlights/:id — 하이라이트 이름/커버/공개 설정/순서 변경 (본인만)
router.patch('/highlights/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, order, coverStoryId, isPublic } = req.body;
    const highlight = await prisma.storyHighlight.findUnique({ where: { id }, select: { userId: true } });
    if (!highlight) throw new AppError('하이라이트를 찾을 수 없습니다.', 404);
    if (highlight.userId !== req.user!.id) throw new AppError('수정 권한이 없습니다.', 403);

    const data: any = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length < 1 || name.length > 50) {
        throw new AppError('이름은 1~50자 사이여야 합니다.', 400);
      }
      data.name = name;
    }
    if (order !== undefined && typeof order === 'number') data.order = order;
    if (coverStoryId !== undefined) data.coverStoryId = coverStoryId || null;
    if (isPublic !== undefined) data.isPublic = !!isPublic;

    const updated = await prisma.storyHighlight.update({ where: { id }, data });
    res.json(updated);
  } catch (e: any) {
    if (e.code === 'P2002') return next(new AppError('이미 같은 이름의 하이라이트가 있습니다.', 409));
    next(e);
  }
});

// DELETE /highlights/:id — 하이라이트 삭제
router.delete('/highlights/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const highlight = await prisma.storyHighlight.findUnique({ where: { id }, select: { userId: true } });
    if (!highlight) throw new AppError('하이라이트를 찾을 수 없습니다.', 404);
    if (highlight.userId !== req.user!.id) throw new AppError('삭제 권한이 없습니다.', 403);
    await prisma.storyHighlight.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /highlights/:id/stories/:storyId — 스토리를 하이라이트에 추가 (본인 스토리만)
router.post('/highlights/:id/stories/:storyId', authenticate, async (req, res, next) => {
  try {
    const highlightId = parseInt(req.params.id as string);
    const storyId = parseInt(req.params.storyId as string);

    const highlight = await prisma.storyHighlight.findUnique({ where: { id: highlightId }, select: { userId: true, storyIds: true } });
    if (!highlight) throw new AppError('하이라이트를 찾을 수 없습니다.', 404);
    if (highlight.userId !== req.user!.id) throw new AppError('수정 권한이 없습니다.', 403);

    // 스토리가 본인 것인지 확인
    const story = await prisma.story.findFirst({ where: { id: storyId, authorId: req.user!.id } });
    if (!story) throw new AppError('본인 스토리만 추가할 수 있습니다.', 403);

    // 이미 있으면 무시, 없으면 추가
    const updated = await prisma.storyHighlight.update({
      where: { id: highlightId },
      data: { storyIds: Array.from(new Set([...highlight.storyIds, storyId])) },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

// DELETE /highlights/:id/stories/:storyId — 하이라이트에서 스토리 제거 (본인만)
router.delete('/highlights/:id/stories/:storyId', authenticate, async (req, res, next) => {
  try {
    const highlightId = parseInt(req.params.id as string);
    const storyId = parseInt(req.params.storyId as string);

    const highlight = await prisma.storyHighlight.findUnique({ where: { id: highlightId }, select: { userId: true, storyIds: true } });
    if (!highlight) throw new AppError('하이라이트를 찾을 수 없습니다.', 404);
    if (highlight.userId !== req.user!.id) throw new AppError('삭제 권한이 없습니다.', 403);

    const updated = await prisma.storyHighlight.update({
      where: { id: highlightId },
      data: { storyIds: highlight.storyIds.filter(id => id !== storyId) },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

/**
 * GET /:id — 스토리 하나. 알림·공유 링크(`/feed?story=`)가 가리키는 곳 — 보기 화면이 이 소식부터 연다.
 *
 * ⚠️ 목록에 없는 글일 수 있다 — 이웃공개 글, ArtLink(운영)를 부른 글, 내 소식의 알림.
 * ⚠️ **공개범위는 그대로 지킨다** — `visibleStory` 와 같은 규칙. 아니면 **404** (403 은 그런 글이 있다는 걸 알려준다 — 규칙 23).
 * ⚠️⚠️ **이 라우트는 반드시 맨 아래에 둘 것.** `/:id` 는 한 조각짜리 주소를 다 잡아먹어서
 *    위로 올리면 `/feed`·`/public`·`/reports`·`/mutes` 가 `id='feed'` 로 걸린다(`parseInt` 가 NaN → 404, 원인이 안 보인다).
 */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!(await visibleStory(id, req.user))) throw new AppError('소식을 찾을 수 없습니다.', 404);
    const s = await prisma.story.findUnique({ where: { id }, include: { author: authorSelect } });
    if (!s) throw new AppError('소식을 찾을 수 없습니다.', 404);
    const [out] = await serializeMany([s], req.user);
    res.json(out);
  } catch (e) { next(e); }
});

export default router;
