/**
 * 커뮤니티 게시판 (블라인드식 글로벌 게시판) — 홈 [인기글]의 출처.
 *
 * ## 설계
 * - **글마다 실명/익명 선택**(`anonymous`). 익명이면 응답에서 작성자 신원을 가린다
 *   (id·닉네임·아바타·역할 모두 숨김) — 역추적 방지. 서버는 authz 를 위해 authorId 를 계속 안다.
 * - 목록·랭킹을 매번 집계하지 않으려고 `likeCount`/`commentCount` 를 비정규화해 들고 있는다.
 * - 읽기는 공개(비로그인도), 쓰기는 로그인 필요. 삭제는 작성자 본인 또는 Admin.
 *
 * ## 블로그형 글쓰기 (2026-11-13)
 * - 글은 **문서 JSON**(`Post.doc`, TipTap)으로 쓴다 — 글 중간의 사진·모아 놓기·팁 상자·영상. 검증은 `lib/postDoc.ts` 한 곳.
 *   문서 글도 `body`(문서에서 뽑은 글)·`images`(문서 속 사진)를 채워 둔다 → 목록 발췌·썸네일·멘션·옛 화면이 그대로 돈다.
 *   옛 형식(`{title, body, images}`)도 계속 받는다(배포 중 옛 화면·API).
 * - 쓰는 중인 글은 **작업본**(`PostDraft`, `/drafts`)에 자동 저장 — `rev` 로 다른 기기·탭과의 충돌을 409 로 가른다.
 * - 탭마다 누가 쓰나(`writePolicy`)·익명 허용(`allowAnonymous`)·목록 모양(`layout`) — 판정은 `lib/communityAccess.ts`.
 *   필진(`CommunityWriter`)은 관리자가 정한다. **필진 탭의 실명 글**은 처음 올릴 때 이웃에게 알린다(`POST_NEW`).
 * - 사진·동영상 파일은 글쓰기로 올린 것(`PostAsset`)만, 아무 글·작업본도 안 쓸 때만 지운다(`lib/postAssets.ts`).
 * - 표지는 따로 고르지 않는다 — 첫 사진(2026-11-13 사용자 결정).
 * - 투표(한 글에 하나, `lib/postPoll.ts`) · 대댓글(한 단계, 답글이 곧 그 사람을 부르는 것 — 댓글 @멘션은 없앴다).
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authorProfiles } from '../lib/authorProfiles';
import { shouldCountView } from '../lib/viewCount';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';
import { resolveMentions, notifyMentions } from '../lib/mention';
import {
  sanitizePostDoc, applyAssetInfo, legacyToPostDoc, readingMinutes, postExcerpt, postDocLede, POST_DOC_LIMITS, POST_DOC_VERSION,
  type PostDoc,
} from '../lib/postDoc';
import {
  asTabLayout, asWritePolicy, isCommunityWriter, resolveAnonymous, resolveWritableTab, writeBlockReason, WRITE_POLICIES, TAB_LAYOUTS, ensureDefaultTab,
  type TabRule,
} from '../lib/communityAccess';
import { cleanupPostImages, prunePostAssets } from '../lib/postAssets';
import { withKeyLock, LOCK_NS } from '../lib/keyLock';
import { asPollDef, checkVote, pollView, samePoll, samePollShape } from '../lib/postPoll';
import { logger } from '../lib/logger';

const router = Router();

/**
 * 탭 키(slug) — 목록 쿼리(`?category=`)에 쓴다. 한글 이름과 **별개로** 안정적이어야 한다
 * (이름을 바꿔도 링크가 안 죽게). 한글은 slug 로 못 쓰므로 이름이 전부 비ASCII 면 `tab-<n>` 로 떨어진다.
 */
function toSlug(name: string): string {
  const s = name.trim().toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return /^[a-z0-9-]+$/.test(s) && s.length > 0 ? s.slice(0, 40) : '';
}

/** 글 사진은 **우리 저장소** 주소만 (화면이 방금 /api/upload/image 로 올린 것). 외부 URL 차단. — 옛 형식 글 */
function ownImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const u of raw.slice(0, 10)) {
    const s = safeFileUrl(u);
    if (s && (s.startsWith('/uploads/') || matchR2Base(s))) out.push(s);
  }
  return out;
}

const titleField = z.string().trim().min(1, '제목을 입력해주세요.').max(POST_DOC_LIMITS.titleChars, '제목은 120자까지입니다.');
const createSchema = z.object({
  title: titleField,
  // 옛 형식 — 본문 글 + 사진 목록. 문서(`doc`)가 오면 쓰지 않는다
  body: z.string().trim().max(5000, '내용은 5000자까지입니다.').optional(),
  images: z.array(z.string()).max(10, '사진은 10장까지입니다.').optional().default([]),
  // 새 형식 — 문서 JSON(lib/postDoc.ts 가 검증)
  doc: z.unknown().optional(),
  /** 이 글을 쓰던 작업본 — 올리면서 지운다 */
  draftId: z.number().int().positive().optional(),
  anonymous: z.boolean().optional().default(false),
  categoryId: z.number().int().positive().nullable().optional(),
  // ⚠️ 아래 둘은 **Admin 만** 반영된다. 스키마에서 받기만 하고 권한은 핸들러가 판정한다
  //    (클라이언트가 보냈다는 이유로 공지·고정이 되면 안 된다).
  notice: z.boolean().optional().default(false),
  pinned: z.boolean().optional().default(false),
});
const categorySchema = z.object({
  name: z.string().trim().min(1, '탭 이름을 입력해주세요.').max(20, '탭 이름은 20자까지입니다.'),
  order: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
  /** 옛 칸 — 켜면 관리자만. `writePolicy` 가 오면 그게 이긴다 */
  writeAdminOnly: z.boolean().optional(),
  writePolicy: z.enum(WRITE_POLICIES).optional(),
  layout: z.enum(TAB_LAYOUTS).optional(),
  allowAnonymous: z.boolean().optional(),
  description: z.string().trim().max(120, '탭 소개는 120자까지입니다.').nullable().optional(),
});
const categoryPatchSchema = categorySchema.partial();
const commentSchema = z.object({
  body: z.string().trim().min(1, '댓글을 입력해주세요.').max(2000, '댓글은 2000자까지입니다.'),
  anonymous: z.boolean().optional().default(false),
  /** 답글이면 답하는 댓글(맨 위 댓글이든 답글이든) — 서버가 맨 위 댓글(parentId)을 찾아 붙인다 */
  replyTo: z.number().int().positive().optional(),
});
const pollVoteSchema = z.object({ optionIds: z.array(z.string().min(1).max(40)).min(1).max(20) });

type AuthorRow = { id: number; name: string; nickname: string | null; avatar: string | null; role: string; handle?: string | null };
const authorSelect = { select: { id: true, name: true, nickname: true, avatar: true, role: true, handle: true } } as const;

/** 작성자 표기 — 익명이면 신원을 통째로 가린다(역추적 방지). 실명이면 닉네임 우선 + 역할. */
function serializeAuthor(anonymous: boolean, author: AuthorRow, viewerId?: number) {
  const mine = viewerId != null && viewerId === author.id;
  if (anonymous) {
    // 본인에게만 '익명(나)' 로 표시해 삭제 버튼 맥락을 준다. 그 외에는 완전 익명.
    return { id: null as number | null, name: mine ? '익명(나)' : '익명', nickname: null, avatar: null, role: null, anonymous: true, mine };
  }
  return { id: author.id, name: author.nickname || author.name, nickname: author.nickname, avatar: author.avatar, role: author.role, anonymous: false, mine };
}

type CategoryRow = {
  id: number; name: string; slug: string; order: number; active: boolean;
  writePolicy: string; layout: string; allowAnonymous: boolean; description: string | null; isDefault?: boolean;
};
/** 탭 응답 — `writeAdminOnly` 는 옛 화면(배포 중 캐시된 번들)을 위해 함께 싣는다 */
function serializeTab(c: CategoryRow, extra: { postCount?: number; canWrite?: boolean } = {}) {
  const writePolicy = asWritePolicy(c.writePolicy);
  return {
    id: c.id, name: c.name, slug: c.slug, order: c.order, active: c.active,
    writeAdminOnly: writePolicy === 'admin', writePolicy, layout: asTabLayout(c.layout),
    allowAnonymous: c.allowAnonymous, description: c.description,
    // 기본 탭(자유게시판) — 글쓰기 화면이 처음에 고르고, 관리 화면은 지우기·숨기기를 감춘다
    isDefault: !!c.isDefault,
    ...extra,
  };
}
const shortTab = (c: { id: number; name: string; slug: string; layout?: string; writePolicy?: string } | null) =>
  c ? { id: c.id, name: c.name, slug: c.slug, layout: asTabLayout(c.layout), writePolicy: asWritePolicy(c.writePolicy) } : null;

/**
 * 목록 한 줄에 필요한 칸만 — ⚠️ `doc`(문서 JSON 전체)를 싣지 말 것. 목록·이 탭의 다른 글·필진 띠가 글마다 문서 전체를 읽게 된다.
 * 요약은 등록 때 만들어 둔 `excerpt`(리드), 읽는 시간은 `body` 길이로 낸다.
 */
const rowSelect = {
  id: true, title: true, body: true, images: true, videos: true, excerpt: true,
  likeCount: true, commentCount: true, viewCount: true, createdAt: true, notice: true, pinnedAt: true, anonymous: true,
  author: authorSelect, category: true,
} as const;

/** 글 목록 한 줄 — 목록·인기글·이 탭의 다른 글이 같이 쓴다 */
function serializeRow(p: {
  id: number; title: string; body: string; images: string[]; videos: string[]; excerpt: string | null;
  likeCount: number; commentCount: number; viewCount: number; createdAt: Date; notice: boolean; pinnedAt: Date | null; anonymous: boolean;
  author: AuthorRow; category: { id: number; name: string; slug: string; layout?: string; writePolicy?: string } | null;
}, viewerId?: number) {
  return {
    id: p.id, title: p.title,
    // 목록엔 본문을 짧게만 (전문은 상세에서) — 문서 글은 등록 때 만든 리드(소제목·목록을 건너뛴 첫 문단들), 옛 글은 body 앞부분
    excerpt: p.excerpt || postExcerpt(p.body),
    // 표지는 따로 고르지 않는다 — 첫 사진(동영상은 표지가 되지 않는다)
    thumbnail: p.images[0] ?? null,
    cover: p.images[0] ?? null,
    imageCount: p.images.length,
    videoCount: p.videos.length,
    readingMinutes: readingMinutes(p.body.length, p.images.length + p.videos.length),
    likeCount: p.likeCount, commentCount: p.commentCount, viewCount: p.viewCount, createdAt: p.createdAt,
    notice: p.notice, pinned: p.pinnedAt != null,
    category: shortTab(p.category),
    author: serializeAuthor(p.anonymous, p.author, viewerId),
  };
}

/** 문서 → 저장할 값(글·사진·동영상·투표·문서·요약). 사진 치수·큰 썸네일 여부는 사진 기록(PostAsset)이 이긴다 */
async function docContent(raw: unknown, mode: 'draft' | 'publish') {
  const s = sanitizePostDoc(raw, mode);
  const assets = s.images.length
    ? await prisma.postAsset.findMany({ where: { url: { in: s.images } }, select: { url: true, width: true, height: true } })
    : [];
  const doc = applyAssetInfo(s.doc, new Map(assets.map((a) => [a.url, { width: a.width, height: a.height }])));
  return { body: s.text, images: s.images, videos: s.videos, poll: s.poll, doc, excerpt: postDocLede(doc) };
}

// 여러 사람의 홈페이지·한 줄 소개 — `lib/authorProfiles.ts` (ArtStory 도 같이 쓴다, 2026-11-14)

type CommentRow = {
  id: number; body: string; anonymous: boolean; createdAt: Date; parentId: number | null; replyToId: number | null; deletedAt: Date | null;
  author: AuthorRow;
};
/** 댓글 하나 — 지운 댓글(답글이 달려 자리만 남긴 것)은 글·작성자를 싣지 않는다 */
function serializeComment(c: CommentRow, viewerId?: number) {
  if (c.deletedAt) return { id: c.id, body: '', createdAt: c.createdAt, deleted: true, author: null };
  return { id: c.id, body: c.body, createdAt: c.createdAt, deleted: false, author: serializeAuthor(c.anonymous, c.author, viewerId) };
}
/** 맨 위 댓글 + 그 아래 답글(오래된 순). 답글의 답글이면 누구에게 단 답인지(`replyTo`) — 맨 위 댓글에 단 답은 따로 적지 않는다 */
function threadComments(rows: CommentRow[], viewerId?: number) {
  const byId = new Map(rows.map((c) => [c.id, c]));
  const replies = new Map<number, CommentRow[]>();
  for (const c of rows) if (c.parentId != null) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  return rows
    .filter((c) => c.parentId == null)
    .map((c) => {
      const kids = (replies.get(c.id) ?? []).map((r) => {
        const to = r.replyToId != null && r.replyToId !== c.id ? byId.get(r.replyToId) : undefined;
        return { ...serializeComment(r, viewerId), replyTo: to && !to.deletedAt ? { name: to.anonymous ? '익명' : (to.author.nickname || to.author.name) } : null };
      });
      return { ...serializeComment(c, viewerId), replies: kids };
    })
    // 지운 댓글인데 답글도 없으면 자리를 남길 이유가 없다
    .filter((c) => !c.deleted || c.replies.length > 0);
}

/**
 * 필진 탭의 실명 글을 **처음 올렸을 때** 이웃(나를 이웃 추가한 사람)에게 알린다.
 * 익명 글·자유 탭 글은 알리지 않는다 — 익명이면 누군지 드러나고, 잡담마다 알림이 가면 사람들이 알림을 끈다.
 */
async function notifyFollowersOfNewPost(post: { id: number; title: string }, author: AuthorRow): Promise<void> {
  try {
    const followers = await prisma.follow.findMany({
      where: { followingId: author.id, followerId: { not: author.id }, follower: { deletedAt: null } },
      select: { followerId: true },
    });
    if (followers.length === 0) return;
    const name = author.nickname || author.name;
    await prisma.notification.createMany({
      data: followers.map((f) => ({
        userId: f.followerId, type: 'POST_NEW', message: `${name}님이 새 글을 올렸어요: ${post.title}`,
        linkUrl: `/community/${post.id}`, refKey: `post:${post.id}`,
      })),
    });
  } catch (e) {
    logger.warn('Community', `새 글 이웃 알림 실패(무시): ${(e as Error).message}`);
  }
}

/** 등록·삭제 뒤 — 버려진 글 사진 정리(한 시간에 한 번). 테스트에서는 직접 부른다 */
function maybePrune(): void {
  if (process.env.NODE_ENV === 'test') return;
  void prunePostAssets();
}

// ── 목록 ── (sort=recent|popular, page, category=slug|none, mine=posts|comments, policy=writers)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id;
    const sort = String(req.query.sort ?? 'recent');
    const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
    const take = Math.min(30, Math.max(1, parseInt(String(req.query.take ?? '20')) || 20));
    const bySort = sort === 'popular'
      ? [{ likeCount: 'desc' as const }, { commentCount: 'desc' as const }, { createdAt: 'desc' as const }]
      : [{ createdAt: 'desc' as const }];

    // 내 글 / 내 댓글단 글 필터 — 로그인 필요(없으면 빈 목록)
    const mine = String(req.query.mine ?? '');
    let where: Record<string, unknown> = {};
    if (mine === 'posts') where = viewerId ? { authorId: viewerId } : { id: -1 };
    else if (mine === 'comments') where = viewerId ? { comments: { some: { authorId: viewerId, deletedAt: null } } } : { id: -1 };

    // 탭 필터 — slug 로 받는다(이름을 바꿔도 링크가 안 죽게). '탭 없음'(옛 'none')은 없다 — 그런 slug 는 빈 목록
    const cat = String(req.query.category ?? '').trim();
    if (cat) {
      const c = await prisma.postCategory.findUnique({ where: { slug: cat }, select: { id: true } });
      // 없는 탭이면 빈 목록 — 지워진 탭 링크로 들어와도 전체가 쏟아지지 않게
      where.categoryId = c ? c.id : -1;
    }
    // 필진 글만(전체 탭 맨 위 '필진의 새 글') — 필진 탭의 실명 글
    if (String(req.query.policy ?? '') === 'writers') {
      where.category = { writePolicy: 'writers', active: true };
      where.anonymous = false;
    }

    // ⚠️ 고정 글을 맨 위로. Postgres 는 `DESC` 에서 NULL 을 **먼저** 놓으므로 반드시 `nulls: 'last'`
    //    를 줘야 한다 — 안 주면 고정 안 된 글이 위로 올라온다(정반대).
    // ⚠️ '내 글/내 댓글' 필터에서는 고정을 적용하지 않는다. 그건 내 활동 목록이라
    //    남이 고정한 글이 맨 위에 끼어들 이유가 없다.
    const orderBy = mine
      ? bySort
      : [{ pinnedAt: { sort: 'desc' as const, nulls: 'last' as const } }, ...bySort];

    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy, skip: (page - 1) * take, take, select: rowSelect }),
      prisma.post.count({ where }),
    ]);

    res.json({ posts: rows.map((p) => serializeRow(p, viewerId)), total, page, hasMore: page * take < total });
  } catch (e) { next(e); }
});

// ── 인기글 (홈 위젯 · 목록 옆칸) ── 좋아요 많은 순, 동률이면 최신. days 를 주면 그 기간에 쓴 글만
router.get('/popular', async (req, res, next) => {
  try {
    const limit = Math.min(10, Math.max(1, parseInt(String(req.query.limit ?? '5')) || 5));
    const days = Math.min(365, Math.max(0, parseInt(String(req.query.days ?? '0')) || 0));
    const rows = await prisma.post.findMany({
      where: days ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {},
      orderBy: [{ likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true, title: true, likeCount: true, commentCount: true, viewCount: true, createdAt: true, anonymous: true, author: authorSelect, category: true },
    });
    res.json(rows.map((p) => ({
      id: p.id, title: p.title, likeCount: p.likeCount, commentCount: p.commentCount, viewCount: p.viewCount, createdAt: p.createdAt,
      category: shortTab(p.category),
      author: serializeAuthor(p.anonymous, p.author),
    })));
  } catch (e) { next(e); }
});

// ══ 탭(말머리) — 읽기는 공개, 쓰기는 Admin 전용 ═══════════════════════════
// ⚠️ **`/:id` 보다 먼저 선언해야 한다.** 뒤에 두면 `/community/categories` 가 `/:id` 로 잡혀
//    parseInt('categories') = NaN → 404 가 된다(에러 메시지가 엉뚱해 원인 찾기 어렵다).

// 탭 목록 — 일반 사용자는 켜진 탭만, Admin 은 꺼진 탭까지(관리 화면에서 다시 켜야 하므로).
// `canWrite` — 지금 보는 사람이 이 탭에 쓸 수 있나(글쓰기 화면이 고를 수 있는 탭만 보여 준다. 판정은 서버와 같은 함수)
router.get('/categories', optionalAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'ADMIN';
    const [rows, writer] = await Promise.all([
      prisma.postCategory.findMany({
        where: isAdmin ? {} : { active: true },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        include: { _count: { select: { posts: true } } },
      }),
      isCommunityWriter(prisma, req.user?.id),
    ]);
    res.json(rows.map((c) => serializeTab(c, {
      postCount: c._count.posts,
      canWrite: !!req.user && writeBlockReason(c, { id: req.user.id, role: req.user.role }, writer) === null,
    })));
  } catch (e) { next(e); }
});

/** 탭 쓰기 권한 — 새 칸(writePolicy)이 오면 그것, 옛 칸(writeAdminOnly)만 오면 그걸로 */
function policyFromBody(body: { writePolicy?: string; writeAdminOnly?: boolean }): string | undefined {
  if (body.writePolicy) return body.writePolicy;
  if (typeof body.writeAdminOnly === 'boolean') return body.writeAdminOnly ? 'admin' : 'all';
  return undefined;
}

// 탭 생성 (Admin)
router.post('/categories', authenticate, authorize('ADMIN'), validate(categorySchema), async (req, res, next) => {
  try {
    const name = String(req.body.name).trim();
    // slug 는 이름에서 뽑되, 한글만이면 안정적인 대체 키를 쓴다. 충돌하면 뒤에 번호를 붙인다.
    const base = toSlug(name) || 'tab';
    let slug = base;
    for (let n = 2; await prisma.postCategory.findUnique({ where: { slug }, select: { id: true } }); n++) slug = `${base}-${n}`;
    // 순서를 안 주면 맨 뒤로
    const order = req.body.order ?? ((await prisma.postCategory.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1;
    const writePolicy = policyFromBody(req.body) ?? 'all';
    const c = await prisma.postCategory.create({
      data: {
        name, slug, order, active: req.body.active ?? true,
        writePolicy, writeAdminOnly: writePolicy === 'admin',
        layout: req.body.layout ?? 'list',
        allowAnonymous: req.body.allowAnonymous ?? true,
        description: req.body.description || null,
      },
    });
    res.status(201).json(serializeTab(c, { postCount: 0, canWrite: true }));
  } catch (e: any) {
    // ⚠️ **확인하고 만들지 말 것**(규칙 46). 예전엔 `findUnique` 로 중복을 본 뒤 `create` 했는데
    //    그 확인이 트랜잭션 밖이라 같은 이름을 동시에 보내면 둘 다 "없음"을 보고 들어가
    //    unique 위반이 났다. 그러면 `errorHandler` 가 **400**("데이터 처리 중 오류")으로 뭉개
    //    화면에 "이미 있는 이름"이라고 알려 줄 수가 없다.
    //    지금은 **DB 의 unique 가 판정**하고 여기서 409 로 번역한다 — 경합해도 답이 같다.
    if (e?.code === 'P2002') return next(new AppError('같은 이름의 탭이 이미 있습니다.', 409));
    next(e);
  }
});

// 탭 수정 (Admin) — 이름·순서·활성·쓰기 권한·모양·익명·소개. ⚠️ slug 는 바꾸지 않는다(주소·북마크가 죽는다)
router.patch('/categories/:id', authenticate, authorize('ADMIN'), validate(categoryPatchSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const cur = await prisma.postCategory.findUnique({ where: { id }, select: { id: true, isDefault: true, name: true } });
    if (!cur) throw new AppError('탭을 찾을 수 없습니다.', 404);
    // 기본 탭(자유게시판)은 숨기지 못한다 — 탭을 안 고른 글이 가는 곳이라 숨기면 그 글들이 갈 곳이 닫힌다
    if (cur.isDefault && req.body.active === false) throw new AppError(`‘${cur.name}’은 기본 탭이라 숨길 수 없어요.`, 400);
    const data: Record<string, unknown> = {};
    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      const dup = await prisma.postCategory.findUnique({ where: { name }, select: { id: true } });
      if (dup && dup.id !== id) throw new AppError('같은 이름의 탭이 이미 있습니다.', 409);
      data.name = name;
    }
    if (typeof req.body.order === 'number') data.order = req.body.order;
    if (typeof req.body.active === 'boolean') data.active = req.body.active;
    const writePolicy = policyFromBody(req.body);
    if (writePolicy) { data.writePolicy = writePolicy; data.writeAdminOnly = writePolicy === 'admin'; }
    if (req.body.layout) data.layout = req.body.layout;
    if (typeof req.body.allowAnonymous === 'boolean') data.allowAnonymous = req.body.allowAnonymous;
    if (req.body.description !== undefined) data.description = req.body.description || null;
    const c = await prisma.postCategory.update({ where: { id }, data });
    res.json(serializeTab(c));
  } catch (e) { next(e); }
});

// 탭 삭제 (Admin) — ⚠️ **글은 지우지 않는다.** 그 탭의 글(과 쓰던 글)은 **기본 탭(자유게시판)** 으로 옮긴다 — '탭 없음'은 없다(2026-11-21).
//    몇 개가 어디로 갔는지 응답으로 돌려준다(화면이 미리 경고하고 결과를 말한다). 기본 탭 자신은 지울 수 없다(400).
router.delete('/categories/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const c = await prisma.postCategory.findUnique({ where: { id }, select: { id: true, name: true, isDefault: true } });
    if (!c) throw new AppError('탭을 찾을 수 없습니다.', 404);
    if (c.isDefault) throw new AppError(`‘${c.name}’은 기본 탭이라 지울 수 없어요.`, 400);
    const { moved, to } = await prisma.$transaction(async (tx) => {
      const to = await ensureDefaultTab(tx);
      const m = await tx.post.updateMany({ where: { categoryId: id }, data: { categoryId: to.id } });
      await tx.postDraft.updateMany({ where: { categoryId: id }, data: { categoryId: to.id } });
      await tx.postCategory.delete({ where: { id } });
      return { moved: m.count, to };
    });
    res.json({ ok: true, moved, movedTo: { id: to.id, name: to.name } });
  } catch (e) { next(e); }
});

// ══ 필진 — 관리자가 정한다(역할 무관) ═══════════════════════════════════════
router.get('/writers', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    const rows = await prisma.communityWriter.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, nickname: true, email: true, role: true, avatar: true, deletedAt: true } } },
    });
    const counts = await prisma.post.groupBy({
      by: ['authorId'],
      where: { authorId: { in: rows.map((r) => r.userId) }, category: { writePolicy: 'writers' } },
      _count: { _all: true },
    });
    const byUser = new Map(counts.map((c) => [c.authorId, c._count._all]));
    res.json(rows.map((r) => ({
      userId: r.userId, name: r.user.nickname || r.user.name, realName: r.user.name, email: r.user.email, role: r.user.role,
      avatar: r.user.avatar, withdrawn: !!r.user.deletedAt, createdAt: r.createdAt, postCount: byUser.get(r.userId) ?? 0,
    })));
  } catch (e) { next(e); }
});

router.put('/writers/:userId', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string);
    const user = Number.isFinite(userId)
      ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } })
      : null;
    if (!user || user.deletedAt) throw new AppError('회원을 찾을 수 없습니다.', 404);
    // 확인하고 만들지 않는다(규칙 46) — 두 번 눌러도 한 줄, 알림도 한 번
    const added = await prisma.communityWriter.createMany({ data: [{ userId, addedById: req.user!.id }], skipDuplicates: true });
    if (added.count > 0 && userId !== req.user!.id) {
      await prisma.notification.create({
        data: { userId, type: 'COMMUNITY_WRITER', message: '커뮤니티 필진이 되었어요. 필진 탭에 글을 쓸 수 있어요.', linkUrl: '/community/write' },
      }).catch(() => { /* best-effort */ });
    }
    res.json({ ok: true, added: added.count > 0 });
  } catch (e) { next(e); }
});

router.delete('/writers/:userId', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string);
    const del = await prisma.communityWriter.deleteMany({ where: { userId: Number.isFinite(userId) ? userId : -1 } });
    res.json({ ok: true, removed: del.count > 0 });
  } catch (e) { next(e); }
});

// ══ 작업본(쓰는 중인 글) — 본인만. 공개 응답과 섞지 않는다 ═══════════════════
const DRAFT_MAX = 30;
const draftWriteSchema = z.object({
  title: z.string().max(1000).optional(),
  doc: z.unknown().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  anonymous: z.boolean().optional(),
});
const draftCreateSchema = draftWriteSchema.extend({ postId: z.number().int().positive().optional() });
const draftSaveSchema = draftWriteSchema.extend({ baseRev: z.number().int().min(0) });

type DraftRow = {
  id: number; postId: number | null; title: string; doc: unknown; categoryId: number | null; anonymous: boolean;
  rev: number; images: string[]; videos: string[]; createdAt: Date; updatedAt: Date;
};
type DraftPostInfo = { notice: boolean; pollLocked: boolean };
const serializeDraft = (d: DraftRow, info: DraftPostInfo = { notice: false, pollLocked: false }) => ({
  id: d.id, postId: d.postId, title: d.title, doc: d.doc, categoryId: d.categoryId, anonymous: d.anonymous,
  rev: d.rev, imageCount: d.images.length, videoCount: d.videos.length, createdAt: d.createdAt, updatedAt: d.updatedAt,
  // 고치는 글이 공지면 익명을 고를 수 없다 — 글쓰기 화면이 익명 칸을 끈다
  notice: info.notice,
  // 고치는 글의 투표에 이미 표가 있으면 질문·보기를 잠근다(마감만 바꾼다) — 서버 PATCH 와 같은 규칙
  pollLocked: info.pollLocked,
});
/** 고치는 글이면 — 그 글이 공지인가 · 투표에 표가 있는가 */
async function draftPostInfo(d: { postId: number | null }): Promise<DraftPostInfo> {
  if (!d.postId) return { notice: false, pollLocked: false };
  const [p, votes] = await Promise.all([
    prisma.post.findUnique({ where: { id: d.postId }, select: { notice: true } }),
    prisma.postPollVote.count({ where: { postId: d.postId } }),
  ]);
  return { notice: !!p?.notice, pollLocked: votes > 0 };
}

/** 작업본에 쓸 탭 — 없는 탭이면 null(FK 오류 대신). 쓰기 권한은 올릴 때 본다 */
async function draftCategoryId(raw: unknown): Promise<number | null> {
  if (typeof raw !== 'number') return null;
  const c = await prisma.postCategory.findUnique({ where: { id: raw }, select: { id: true } });
  return c ? c.id : null;
}

/** 받은 작업본 내용을 저장할 값으로 — 느슨하게(모르는 것은 버린다) */
async function draftData(body: z.infer<typeof draftWriteSchema>) {
  const content = body.doc !== undefined ? await docContent(body.doc, 'draft') : null;
  return {
    title: (body.title ?? '').replace(/\s+/g, ' ').trim().slice(0, POST_DOC_LIMITS.titleChars),
    ...(content ? { doc: content.doc as object, images: content.images, videos: content.videos } : {}),
    categoryId: await draftCategoryId(body.categoryId),
    anonymous: !!body.anonymous,
  };
}

// 내 작업본 목록 — 글쓰기 화면의 '쓰던 글'
router.get('/drafts', authenticate, async (req, res, next) => {
  try {
    const rows = await prisma.postDraft.findMany({
      where: { authorId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      take: DRAFT_MAX + 20,
      select: { id: true, postId: true, title: true, images: true, categoryId: true, updatedAt: true, createdAt: true },
    });
    res.json(rows.map((d) => ({ id: d.id, postId: d.postId, title: d.title, imageCount: d.images.length, categoryId: d.categoryId, updatedAt: d.updatedAt, createdAt: d.createdAt })));
  } catch (e) { next(e); }
});

// 작업본 만들기 — postId 가 있으면 그 글을 고치는 작업본(있으면 그것을 돌려준다), 없으면 새 글
router.post('/drafts', authenticate, validate(draftCreateSchema), async (req, res, next) => {
  try {
    const me = req.user!.id;
    if (req.body.postId) {
      const postId = req.body.postId as number;
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, authorId: true, title: true, body: true, images: true, videos: true, doc: true, categoryId: true, anonymous: true },
      });
      // 남의 글은 404(있는지도 알리지 않는다). 수정은 작성자만 — 예전 규칙 그대로
      if (!post || post.authorId !== me) throw new AppError('글을 찾을 수 없습니다.', 404);
      const info = await draftPostInfo({ postId });
      const found = await prisma.postDraft.findUnique({ where: { postId } });
      if (found) return res.json(serializeDraft(found, info));
      const doc = (post.doc as PostDoc | null) ?? legacyToPostDoc(post.body, post.images);
      // 확인하고 만들지 않는다(규칙 46) — 탭 둘에서 동시에 열면(개발 모드는 늘 두 번 연다) 둘째가 unique 에 걸린다.
      // create 로 잡아 처리하면 응답은 맞아도 Prisma 가 오류 로그를 남긴다 → skipDuplicates 로 던지지 않게, 먼저 만든 것을 돌려준다
      const made = await prisma.postDraft.createMany({
        data: [{
          authorId: me, postId, title: post.title, doc: doc as object, images: post.images,
          videos: post.videos, categoryId: post.categoryId, anonymous: post.anonymous,
        }],
        skipDuplicates: true,
      });
      const row = await prisma.postDraft.findUnique({ where: { postId } });
      if (!row) throw new AppError('쓰던 글을 만들지 못했어요. 다시 시도해 주세요.', 500);
      return res.status(made.count > 0 ? 201 : 200).json(serializeDraft(row, info));
    }
    const data = await draftData(req.body);
    const created = await withKeyLock(LOCK_NS.postDrafts, me, async (tx) => {
      const n = await tx.postDraft.count({ where: { authorId: me, postId: null } });
      if (n >= DRAFT_MAX) throw new AppError(`쓰던 글이 ${DRAFT_MAX}개예요. 안 쓰는 글을 지운 뒤 새로 써 주세요.`, 400);
      return tx.postDraft.create({ data: { authorId: me, doc: { type: 'doc', content: [{ type: 'paragraph' }] }, ...data } });
    });
    res.status(201).json(serializeDraft(created));
  } catch (e) { next(e); }
});

router.get('/drafts/:draftId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.draftId as string);
    const d = Number.isFinite(id) ? await prisma.postDraft.findUnique({ where: { id } }) : null;
    if (!d || d.authorId !== req.user!.id) throw new AppError('쓰던 글을 찾을 수 없습니다.', 404);
    res.json(serializeDraft(d, await draftPostInfo(d)));
  } catch (e) { next(e); }
});

/**
 * 자동 저장 — 받은 `baseRev` 가 지금 rev 와 같을 때만 쓴다(확인하고 쓰지 않는다 — updateMany 한 번이 판정, 규칙 46).
 * 다르면 409 와 지금 rev — 화면이 "다른 곳에서 고친 내용이 있어요"를 묻고, 덮어쓰려면 그 rev 로 다시 보낸다.
 */
router.put('/drafts/:draftId', authenticate, validate(draftSaveSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.draftId as string);
    const me = req.user!.id;
    if (!Number.isFinite(id)) throw new AppError('쓰던 글을 찾을 수 없습니다.', 404);
    const data = await draftData(req.body);
    const upd = await prisma.postDraft.updateMany({
      where: { id, authorId: me, rev: req.body.baseRev },
      data: { ...data, rev: { increment: 1 } },
    });
    const cur = await prisma.postDraft.findUnique({ where: { id }, select: { authorId: true, rev: true, updatedAt: true } });
    if (!cur || cur.authorId !== me) throw new AppError('쓰던 글을 찾을 수 없습니다.', 404);
    if (upd.count === 0) {
      return res.status(409).json({ error: '다른 곳에서 고친 내용이 있어요.', rev: cur.rev, updatedAt: cur.updatedAt });
    }
    res.json({ rev: cur.rev, updatedAt: cur.updatedAt });
  } catch (e) { next(e); }
});

router.delete('/drafts/:draftId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.draftId as string);
    const del = await prisma.postDraft.deleteMany({ where: { id: Number.isFinite(id) ? id : -1, authorId: req.user!.id } });
    res.json({ ok: true, deleted: del.count > 0 });
  } catch (e) { next(e); }
});

// ── 상세 (+ 댓글) ──
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id;
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('글을 찾을 수 없습니다.', 404);
    const post = await prisma.post.findUnique({
      where: { id },
      include: { author: authorSelect, category: true, comments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { author: authorSelect } } },
    });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const liked = viewerId
      ? !!(await prisma.postLike.findUnique({ where: { postId_userId: { postId: id, userId: viewerId } }, select: { id: true } }))
      : false;

    // 조회수 +1 (작성자 본인 조회는 세지 않는다 — 자기 글 새로고침으로 부풀지 않게)
    // ⚠️ 같은 사람이 30분 안에 다시 열어도 안 센다 — 좋아요·댓글이 상세를 invalidate 해 하트 껐다 켜면 +2 였다(2026-09-19)
    const isAuthor = viewerId != null && viewerId === post.authorId;
    const viewCount = isAuthor || !shouldCountView(`post:${id}`, viewerId ?? req.ip ?? '') ? post.viewCount : (await prisma.post.update({
      where: { id }, data: { viewCount: { increment: 1 } }, select: { viewCount: true },
    })).viewCount;

    // 프로필 카드(글쓴이·댓글 쓴 사람 — **실명인 사람만**) · 이 탭의 다른 글 · 투표
    const named = [
      ...(post.anonymous ? [] : [post.author]),
      ...post.comments.filter((c) => !c.anonymous && !c.deletedAt).map((c) => c.author),
    ];
    const pollDef = asPollDef(post.poll);
    const [profiles, related, poll] = await Promise.all([
      authorProfiles(named),
      prisma.post.findMany({
        where: { id: { not: id }, categoryId: post.categoryId },
        orderBy: [{ createdAt: 'desc' }], take: 3,
        select: rowSelect,
      }),
      pollDef ? pollView(prisma, id, pollDef, viewerId != null ? { id: viewerId, isAuthor, isAdmin: req.user?.role === 'ADMIN' } : null) : Promise.resolve(null),
    ]);
    const empty = { homepage: null, intro: null };

    res.json({
      id: post.id, title: post.title, body: post.body, images: post.images,
      doc: post.doc ?? null, docVersion: post.docVersion,
      readingMinutes: readingMinutes(post.body.length, post.images.length + post.videos.length),
      notice: post.notice, pinned: post.pinnedAt != null,
      category: shortTab(post.category),
      likeCount: post.likeCount, commentCount: post.commentCount, viewCount,
      createdAt: post.createdAt, updatedAt: post.updatedAt,
      liked,
      author: { ...serializeAuthor(post.anonymous, post.author, viewerId), ...(post.anonymous ? empty : profiles[post.author.id] ?? empty) },
      related: related.map((p) => serializeRow(p, viewerId)),
      comments: threadComments(post.comments, viewerId),
      /** 실명인 글쓴이·댓글 쓴 사람의 홈페이지·한 줄 소개(user id → ) — 이름을 누르면 뜨는 프로필 카드 */
      profiles,
      poll,
    });
  } catch (e) { next(e); }
});

// ── 작성 ──
router.post('/', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const me = req.user!;
    // ⚠️ **공지·고정은 Admin 만.** 클라이언트가 보냈다는 이유로 켜지면 안 된다
    //    (스키마는 값을 받기만 하고 권한 판정은 반드시 여기서 한다).
    const isAdmin = me.role === 'ADMIN';
    const notice = isAdmin && !!req.body.notice;
    const pinnedAt = isAdmin && !!req.body.pinned ? new Date() : null;

    // 탭 — 안 골랐거나 없는 탭 id 면 기본 탭(자유게시판, '탭 없음'은 없다). 못 쓰는 탭은 403(조용히 다른 탭으로 내리지 않는다)
    const tab = await resolveWritableTab(prisma, req.body.categoryId, { id: me.id, role: me.role });
    // 공지는 익명일 수 없다(조용히 실명) · 익명을 막은 탭에 익명이면 400(말없이 실명으로 바꾸면 이름이 드러난다)
    const anon = resolveAnonymous(tab, notice, !!req.body.anonymous);

    let content: { body: string; images: string[]; videos: string[]; poll: ReturnType<typeof asPollDef>; doc: PostDoc | null; excerpt: string | null };
    if (req.body.doc !== undefined) {
      content = await docContent(req.body.doc, 'publish');
    } else {
      const body = (req.body.body ?? '').trim();
      if (!body) throw new AppError('내용을 입력해주세요.', 400);
      content = { body, images: ownImageUrls(req.body.images), videos: [], poll: null, doc: null, excerpt: null };
    }

    const post = await prisma.post.create({
      data: {
        authorId: me.id, title: req.body.title.trim(), body: content.body, anonymous: anon, images: content.images, videos: content.videos,
        ...(content.doc ? { doc: content.doc as object, docVersion: POST_DOC_VERSION } : {}),
        ...(content.poll ? { poll: content.poll as unknown as Prisma.InputJsonValue } : {}),
        excerpt: content.excerpt, categoryId: tab.id, notice, pinnedAt,
      },
      include: { author: authorSelect },
    });
    // 이 글을 쓰던 작업본은 지운다(내 새 글 작업본만)
    if (req.body.draftId) {
      await prisma.postDraft.deleteMany({ where: { id: req.body.draftId, authorId: me.id, postId: null } });
    }
    // 글 본문의 @멘션 — 댓글에는 있었는데 글에는 없어 본문에서 부르면 아무 일도 안 났다(2026-09-19 감사 S23).
    // 규칙은 댓글과 같다: 글은 고치지 않고, 부를 수 있는 사람(ArtLink · 서로 이웃)에게만 알림. 익명이면 이름을 안 쓴다.
    try {
      const mentions = await resolveMentions(prisma, me.id, post.body);
      if (mentions.length > 0) {
        await notifyMentions(prisma, {
          meId: me.id,
          meName: anon ? '익명' : (post.author.nickname || post.author.name),
          targets: mentions,
          where: '커뮤니티 글', linkUrl: `/community/${post.id}`, refKey: `mention:post:${post.id}`,
        });
      }
    } catch { /* 글은 이미 저장됐다 */ }
    // 필진 탭의 실명 글은 이웃에게 알린다(처음 올릴 때 한 번 — 고쳐 올려도 다시 안 간다)
    if (!anon && tab && asWritePolicy(tab.writePolicy) === 'writers') await notifyFollowersOfNewPost(post, post.author);
    maybePrune();
    res.status(201).json({ id: post.id, author: serializeAuthor(post.anonymous, post.author, me.id) });
  } catch (e) { next(e); }
});

// ── 고정 / 고정 해제 (Admin) ──
// 남의 글도 고정할 수 있다(공지가 아니어도 중요한 글은 위로 올릴 수 있어야 한다).
router.patch('/:id/pin', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const post = await prisma.post.findUnique({ where: { id }, select: { pinnedAt: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    // 명시값이 오면 그대로, 없으면 토글
    const want = typeof req.body?.pinned === 'boolean' ? req.body.pinned : post.pinnedAt == null;
    const updated = await prisma.post.update({
      where: { id }, data: { pinnedAt: want ? new Date() : null }, select: { pinnedAt: true },
    });
    res.json({ pinned: updated.pinnedAt != null });
  } catch (e) { next(e); }
});

// ── 공지 지정 / 해제 (Admin) ──
router.patch('/:id/notice', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const post = await prisma.post.findUnique({ where: { id }, select: { notice: true, anonymous: true, authorId: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    const want = typeof req.body?.notice === 'boolean' ? req.body.notice : !post.notice;

    // ⚠️⚠️ **남의 익명 글을 공지로 올려 신원을 벗기지 말 것.**
    //   "공지는 익명일 수 없다"는 맞지만, 그건 **글쓴이 자신**에게만 적용된다.
    //   예전엔 무조건 `anonymous:false` 를 강제해서, 관리자가 남의 익명 글을 공지로 지정하는 순간
    //   작성자의 id·닉네임·역할이 게시판에 **영구히** 드러났다(공지를 풀어도 안 돌아온다).
    //   익명은 그 사람에게 한 약속이라 운영 편의로 깰 수 없다.
    //   내 글이면 내가 익명을 푸는 것이니 그대로 두고, **남의 글이면 거절**한다.
    const mine = post.authorId === req.user!.id;
    if (want && post.anonymous && !mine) {
      throw new AppError('남의 익명 글은 공지로 지정할 수 없습니다. 작성자에게 실명 전환을 요청해 주세요.', 400);
    }

    const updated = await prisma.post.update({
      where: { id },
      data: { notice: want, ...(want && mine ? { anonymous: false } : {}) },
      select: { notice: true },
    });
    res.json({ notice: updated.notice });
  } catch (e) { next(e); }
});

// ── 글 탭 옮기기 (관리자 · 글쓴이) — 2026-11-21 글쓴이도 ──
// 관리자는 어느 탭으로든(숨긴 탭·관리자 전용 탭 포함), 글쓴이는 **그 탭에 새로 쓸 수 있을 때만**(글쓰기와 같은 `writeBlockReason` — 403).
// ⚠️ 익명 글은 익명을 받지 않는 탭으로 못 옮긴다(400) — 관리자도. 익명은 운영도 벗길 수 없고, 탭 규칙을 어긴 글이 그 탭에 남으면 안 된다.
//    글쓴이는 글을 고쳐 익명을 끈 뒤 옮기면 된다. '탭 없음'(null)으로는 못 옮긴다 — 그런 건 없다(2026-11-21, 기본 탭은 자유게시판).
// 옮겨도 이웃 알림(POST_NEW)은 보내지 않는다 — 새 글이 아니다(고쳐 올림과 같은 규칙).
router.patch('/:id/category', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('글을 찾을 수 없습니다.', 404);
    const me = req.user!;
    const isAdmin = me.role === 'ADMIN';
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, anonymous: true, categoryId: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    if (!isAdmin && post.authorId !== me.id) throw new AppError('탭을 옮길 권한이 없습니다.', 403);

    const raw = req.body?.categoryId;
    if (typeof raw !== 'number') throw new AppError('옮길 탭을 골라 주세요.', 400);
    const tab = await prisma.postCategory.findUnique({
      where: { id: raw },
      select: { id: true, name: true, slug: true, active: true, writePolicy: true, allowAnonymous: true },
    });
    if (!tab) throw new AppError('탭을 찾을 수 없습니다.', 404);
    if (tab.id !== post.categoryId) {
      if (!isAdmin) {
        const reason = writeBlockReason(tab, { id: me.id, role: me.role }, await isCommunityWriter(prisma, me.id));
        if (reason) throw new AppError(reason, 403);
      }
      if (post.anonymous && !tab.allowAnonymous) {
        throw new AppError(isAdmin
          ? `‘${tab.name}’ 탭은 익명 글을 받지 않아요.`
          : `‘${tab.name}’ 탭은 익명 글을 받지 않아요. 글을 고쳐 익명을 끈 뒤 옮겨 주세요.`, 400);
      }
    }
    if (tab.id !== post.categoryId) await prisma.post.update({ where: { id }, data: { categoryId: tab.id } });
    res.json({ category: { id: tab.id, name: tab.name, slug: tab.slug } });
  } catch (e) { next(e); }
});


// ── 수정 (작성자만) ──
// ⚠️ 수정은 **전용 스키마** — `createSchema` 는 `anonymous` 를 `.default(false)` 로 채우므로 클라이언트가 그 필드를 생략하면
//    익명 글이 **영구히 벗겨졌다**(옛 번들·직접 호출 하나면 작성자 신원 노출, 2026-09-19 수정). 보낸 것만 반영한다.
// 2026-11-13 — 문서(`doc`)로 고치면 사진까지 바뀐다(글 중간 사진). 옛 형식(`body`)은 예전처럼 사진을 건드리지 않는다.
const updateSchema = z.object({
  title: titleField,
  body: z.string().trim().max(5000, '내용은 5000자까지입니다.').optional(),
  doc: z.unknown().optional(),
  anonymous: z.boolean().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});
router.patch('/:id', authenticate, validate(updateSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('글을 찾을 수 없습니다.', 404);
    const me = req.user!;
    const post = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true, notice: true, anonymous: true, images: true, videos: true, poll: true, categoryId: true, doc: true, category: { select: { id: true, name: true, active: true, writePolicy: true, allowAnonymous: true } } },
    });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    if (post.authorId !== me.id) {
      throw new AppError('수정 권한이 없습니다.', 403);
    }

    // 탭을 바꾸면 새 탭의 쓰기 권한을 본다. 안 바꾸면 그대로(필진에서 빠진 뒤에도 내 글은 고칠 수 있다)
    const moving = req.body.categoryId !== undefined && (req.body.categoryId ?? null) !== post.categoryId;
    const tab: TabRule | null = moving
      ? await resolveWritableTab(prisma, req.body.categoryId, { id: me.id, role: me.role })
      : post.category;
    const wantAnon = req.body.anonymous === undefined ? post.anonymous : !!req.body.anonymous;
    // ⚠️ 공지는 익명일 수 없다(누가 공지했는지 모르면 공지가 아니다) — 작성 때와 같은 규칙.
    // 탭을 옮기지 않고 익명 여부도 그대로면 예전 상태를 지킨다 — 관리자가 나중에 탭의 익명을 막았어도 옛 익명 글을 고칠 수 있어야 한다
    const anonymous = !moving && wantAnon === post.anonymous
      ? (post.notice ? false : post.anonymous)
      : resolveAnonymous(tab, post.notice, wantAnon);

    let content: { body: string; images?: string[]; videos?: string[]; poll?: ReturnType<typeof asPollDef>; doc?: PostDoc; excerpt?: string };
    if (req.body.doc !== undefined) {
      content = await docContent(req.body.doc, 'publish');
      // 투표 — 표가 생긴 뒤에는 질문·보기·복수 선택을 못 바꾼다(마감 시각만). 고른 뒤 보기가 바뀌면 그 표는 다른 질문의 답이 된다.
      // 투표를 빼고 **새로 넣은 것**(보기 id 가 하나도 안 겹친다)은 받는다 — 옛 표는 아래에서 지운다
      const oldPoll = asPollDef(post.poll);
      if (oldPoll && content.poll && samePoll(oldPoll, content.poll) && !samePollShape(oldPoll, content.poll)) {
        const votes = await prisma.postPollVote.count({ where: { postId: id } });
        if (votes > 0) throw new AppError('투표가 시작되어 질문·보기는 바꿀 수 없어요. 마감 시각만 바꿀 수 있어요.', 400);
      }
    } else {
      // ⚠️ 문서로 쓴 글을 옛 형식(글만)으로 고치면 안 된다 — 읽는 화면은 문서를 그리므로 고친 글이 **아무 데도 안 보인다**.
      //    배포 직후 옛 화면(캐시된 번들)만 이 길로 온다. 새로고침하면 새 편집기로 고친다.
      if (post.doc != null) throw new AppError('화면이 예전 판이에요. 새로고침한 뒤 다시 고쳐 주세요.', 409);
      const body = (req.body.body ?? '').trim();
      if (!body) throw new AppError('내용을 입력해주세요.', 400);
      // ⚠️ **사진(`images`)은 건드리지 않는다.** 옛 수정 폼이 제목·내용·익명만 보낸다 —
      //    보낸 것과 기본값을 구분할 수 없으니 아예 뺀다(예전엔 글을 고칠 때마다 사진이 조용히 전부 지워졌다).
      content = { body };
    }

    const updated = await prisma.post.update({
      where: { id },
      data: {
        title: req.body.title.trim(), body: content.body, anonymous,
        ...(content.doc ? {
          doc: content.doc as object, docVersion: POST_DOC_VERSION, images: content.images, videos: content.videos, excerpt: content.excerpt ?? null,
          poll: content.poll ? content.poll as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        } : {}),
        ...(moving ? { categoryId: tab && 'id' in tab ? (tab as { id: number }).id : null } : {}),
      },
      include: { author: authorSelect, category: true },
    });
    // 고친 글의 작업본은 지운다(올렸으니 끝)
    await prisma.postDraft.deleteMany({ where: { postId: id } });
    // 투표를 뺐거나 보기가 바뀌었으면(표가 없을 때만 바뀐다) 남은 표를 지운다
    if (content.doc && (!content.poll || (asPollDef(post.poll) && !samePollShape(asPollDef(post.poll)!, content.poll)))) {
      await prisma.postPollVote.deleteMany({ where: { postId: id } });
    }
    // 빠진 사진·동영상 — 내가 글쓰기로 올린 것 가운데 아무도 안 쓰는 것만 지운다
    if (content.images) {
      const removed = [
        ...post.images.filter((u) => !content.images!.includes(u)),
        ...post.videos.filter((u) => !(content.videos ?? []).includes(u)),
      ];
      if (removed.length) await cleanupPostImages(removed, post.authorId);
    }
    maybePrune();
    res.json({
      id: updated.id, title: updated.title, body: updated.body, images: updated.images,
      doc: updated.doc ?? null,
      notice: updated.notice, pinned: updated.pinnedAt != null,
      category: shortTab(updated.category),
      likeCount: updated.likeCount, commentCount: updated.commentCount, viewCount: updated.viewCount,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
      author: serializeAuthor(updated.anonymous, updated.author, me.id),
    });
  } catch (e) { next(e); }
});

// ── 삭제 (작성자 또는 Admin) ──
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true, images: true, videos: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    if (post.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.post.delete({ where: { id } });
    // 글쓴이가 글쓰기로 올린 사진·동영상 가운데 이제 아무도 안 쓰는 것만 지운다(남의 파일·다른 글의 것은 그대로)
    await cleanupPostImages([...post.images, ...post.videos], post.authorId);
    maybePrune();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 좋아요 토글 ──
/**
 * 내 글 좋아요 알림 (2026-11-14 사용자 결정 — 작품 좋아요 `notifyArtworkLike` 와 같은 방식).
 * **글마다 한 줄로 합친다** — 24시간 안에 그 글의 안 읽은 좋아요 알림이 있으면 새로 쌓지 않고 문구·시각만 고친다
 * ("○○님 외 N명이 내 글을 좋아해요: 제목", 고치면 벨 맨 위로 올라온다). 좋아요마다 한 통이면 벨이 넘치고 앱 푸시가 시끄럽다 —
 * 앱 푸시도 처음 만들 때 한 번만 울린다(합산 갱신은 `updateMany` 라 다시 울리지 않는다, lib/push.ts).
 * 내 글에 내가 누른 건 알리지 않는다(세지도 않는다). 좋아요를 끈 건 알리지 않는다. 실패해도 좋아요는 성공 — best-effort.
 * N 은 24시간 안에 누른 사람 수 − 1(작품 좋아요와 같은 셈). 링크는 그 글.
 */
const POST_LIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
async function notifyPostLike(post: { id: number; authorId: number; title: string }, likerId: number): Promise<void> {
  if (post.authorId === likerId) return;
  const liker = await prisma.user.findUnique({ where: { id: likerId }, select: { name: true, nickname: true } });
  const who = liker ? (liker.nickname || liker.name) : '누군가';
  const title = post.title.length > 30 ? `${post.title.slice(0, 30)}…` : post.title;
  const refKey = `post-like:${post.id}`;
  const linkUrl = `/community/${post.id}`;
  // ⚠️ '고쳐 쓸 줄이 없으면 만든다'를 글마다 줄 세운다 — 동시에 누르면 둘 다 '없음'을 보고 두 줄이 됐다(실측 6번 동시 → 여러 줄).
  //    `Notification.refKey` 는 unique 가 아니라 DB 가 막아 주지 않는다(규칙 46). 알림 만들기가 잠금 안의 **마지막 쿼리**다.
  await withKeyLock(LOCK_NS.postLikeNotes, post.id, async (tx) => {
    const since = new Date(Date.now() - POST_LIKE_WINDOW_MS);
    const recent = await tx.postLike.count({ where: { postId: post.id, createdAt: { gte: since }, userId: { not: post.authorId } } });
    const others = Math.max(recent - 1, 0);
    const message = `${who}님${others > 0 ? ` 외 ${others}명이` : '이'} 내 글을 좋아해요: ${title}`;
    const upd = await tx.notification.updateMany({
      where: { userId: post.authorId, refKey, read: false, createdAt: { gte: since } },
      data: { message, linkUrl, createdAt: new Date() },
    });
    if (upd.count === 0) {
      await tx.notification.create({ data: { userId: post.authorId, type: 'POST_LIKE', message, linkUrl, refKey } });
    }
  });
}

router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, title: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    /*
      ⚠️⚠️ **확인하고 나서 만들지 말 것**(check-then-act). 예전엔 `findUnique` 로 있나 본 뒤
        `create`/`delete` 했는데, 그 확인이 트랜잭션 밖이라 하트를 **연타하면** 두 요청이 모두
        "없음"을 보고 들어가 unique 위반으로 떨어졌다 — 실측 동시 10회에 200 1건 + **400 9건**.
        커뮤니티는 낙관적 갱신이 조용히 롤백돼 "눌렀는데 안 눌림"이 되고, ArtStory 는 에러 토스트가 떴다.

      해법은 두 가지를 함께 지키는 것:
        ① `deleteMany`/`createMany(skipDuplicates)` — 없는 걸 지우거나 있는 걸 만들어도 **안 던진다**
        ② 카운터를 1이 아니라 **실제로 바뀐 행 수(`.count`)만큼** 움직인다
           → 아무것도 안 바뀐 요청은 카운터도 안 건드리므로 드리프트가 원천 차단된다
      같은 해법이 `explore.ts` 작품 좋아요에 먼저 있었다(거긴 카운트를 매번 세지만, 여기는
      인기순 정렬 근거로 `likeCount` 컬럼을 들고 있어 셀 수 없다).
    */
    const out = await prisma.$transaction(async (tx) => {
      const del = await tx.postLike.deleteMany({ where: { postId: id, userId: me } });
      if (del.count > 0) {
        const u = await tx.post.update({
          where: { id }, data: { likeCount: { decrement: del.count } }, select: { likeCount: true },
        });
        return { liked: false, likeCount: u.likeCount };
      }
      const add = await tx.postLike.createMany({
        data: [{ postId: id, userId: me }], skipDuplicates: true,
      });
      const u = await tx.post.update({
        where: { id }, data: { likeCount: { increment: add.count } }, select: { likeCount: true },
      });
      // 스킵됐어도(동시 요청이 먼저 만들었어도) 행은 존재하므로 켜진 상태가 맞다
      return { liked: true, likeCount: u.likeCount, created: add.count > 0 };
    });
    // 이번 요청이 실제로 좋아요를 켰을 때만 알린다(동시에 겹친 요청·끈 것은 알리지 않는다)
    if ('created' in out && out.created) {
      try { await notifyPostLike(post, me); } catch (e) { logger.warn('Community', `좋아요 알림 실패(post ${id}): ${(e as Error).message}`); }
    }
    res.json({ liked: out.liked, likeCount: out.likeCount });
  } catch (e) { next(e); }
});

// ── 댓글 작성 ── (답글이면 replyTo — 맨 위 댓글이든 답글이든 받고, 서버가 맨 위 댓글에 붙인다. 한 단계만)
// ⚠️ 댓글 @멘션은 없앴다(2026-11-13 사용자 결정) — **답글이 곧 그 사람을 부르는 것**이다(답글을 받은 사람에게 알림).
router.post('/:id/comments', authenticate, validate(commentSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const { body, anonymous } = req.body;
    let parentId: number | null = null;
    let replyToId: number | null = null;
    let replyToAuthor: number | null = null;
    if (req.body.replyTo) {
      const target = await prisma.postComment.findUnique({
        where: { id: req.body.replyTo as number },
        select: { id: true, postId: true, parentId: true, authorId: true, deletedAt: true },
      });
      // 남의 글 댓글 번호를 들고 와도 붙지 않는다
      if (!target || target.postId !== id) throw new AppError('답글을 달 댓글을 찾을 수 없어요.', 404);
      if (target.deletedAt) throw new AppError('삭제된 댓글에는 답글을 달 수 없어요.', 400);
      parentId = target.parentId ?? target.id;
      replyToId = target.id;
      replyToAuthor = target.authorId;
    }

    const [comment] = await prisma.$transaction([
      prisma.postComment.create({
        data: { postId: id, authorId: me, body: body.trim(), anonymous: !!anonymous, parentId, replyToId },
        include: { author: authorSelect },
      }),
      prisma.post.update({ where: { id }, data: { commentCount: { increment: 1 } } }),
    ]);
    // 알림 — 익명이면 이름을 안 쓴다. 답글을 받은 사람에게 '답글', 글쓴이에게 '댓글'(같은 사람이면 한 통만 — 답글 알림)
    try {
      const who = anonymous ? '누군가' : await prisma.user.findUnique({ where: { id: me }, select: { name: true, nickname: true } }).then((u) => (u ? (u.nickname || u.name) : '누군가'));
      const link = `/community/${id}?comment=${comment.id}`;
      const notes: Prisma.NotificationCreateManyInput[] = [];
      if (replyToAuthor != null && replyToAuthor !== me) {
        notes.push({ userId: replyToAuthor, type: 'COMMENT_REPLY', message: `${who}님이 내 댓글에 답글을 남겼어요.`, linkUrl: link });
      }
      if (post.authorId !== me && post.authorId !== replyToAuthor) {
        notes.push({ userId: post.authorId, type: 'POST_COMMENT', message: `${who}님이 내 글에 댓글을 남겼습니다.`, linkUrl: link });
      }
      if (notes.length) await prisma.notification.createMany({ data: notes });
    } catch { /* best-effort */ }
    res.status(201).json({
      id: comment.id, body: comment.body, createdAt: comment.createdAt, parentId: comment.parentId, replyToId: comment.replyToId,
      author: serializeAuthor(comment.anonymous, comment.author, me),
    });
  } catch (e) { next(e); }
});

// ── 댓글 삭제 (작성자 또는 Admin) ──
// 답글이 달린 댓글은 자리만 남긴다("삭제된 댓글입니다") — 지우면 답글이 맥락 없이 떠돈다. 마지막 답글이 지워지면 그 자리도 치운다.
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const commentId = parseInt(req.params.commentId as string);
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, postId: true, parentId: true, deletedAt: true, _count: { select: { replies: true } } },
    });
    if (!comment || comment.postId !== id || comment.deletedAt) throw new AppError('댓글을 찾을 수 없습니다.', 404);
    if (comment.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.$transaction(async (tx) => {
      // ⚠️ 확인하고 지우지 않는다 — 두 번 눌러도 카운트는 한 번만 내린다(실제로 지운·가린 행 수만큼)
      let changed = 0;
      if (comment._count.replies > 0) {
        changed = (await tx.postComment.updateMany({ where: { id: commentId, deletedAt: null }, data: { deletedAt: new Date(), body: '' } })).count;
      } else {
        changed = (await tx.postComment.deleteMany({ where: { id: commentId } })).count;
        // 지운 게 답글이고, 그 맨 위 댓글이 이미 지운 자리뿐이며 답글이 더 없으면 자리도 치운다
        if (changed && comment.parentId) {
          const left = await tx.postComment.count({ where: { parentId: comment.parentId } });
          if (left === 0) await tx.postComment.deleteMany({ where: { id: comment.parentId, deletedAt: { not: null } } });
        }
      }
      if (changed) await tx.post.update({ where: { id }, data: { commentCount: { decrement: changed } } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 투표 ── 한 글에 하나(lib/postPoll.ts). 마감 전에는 바꾸거나 취소할 수 있다
router.post('/:id/poll', authenticate, validate(pollVoteSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!;
    const post = await prisma.post.findUnique({ where: { id }, select: { poll: true, authorId: true } });
    const def = post ? asPollDef(post.poll) : null;
    if (!post || !def) throw new AppError('투표를 찾을 수 없어요.', 404);
    const optionIds = checkVote(def, req.body.optionIds);
    // 한 사람의 표를 바꿔 넣는 동안은 잠근다 — 단일 선택에 동시에 두 번 누르면 두 표가 될 수 있다
    await withKeyLock(LOCK_NS.pollVotes, me.id, async (tx) => {
      await tx.postPollVote.deleteMany({ where: { postId: id, userId: me.id } });
      await tx.postPollVote.createMany({ data: optionIds.map((optionId) => ({ postId: id, userId: me.id, optionId })), skipDuplicates: true });
    });
    res.json(await pollView(prisma, id, def, { id: me.id, isAuthor: post.authorId === me.id, isAdmin: me.role === 'ADMIN' }));
  } catch (e) { next(e); }
});

router.delete('/:id/poll', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!;
    const post = await prisma.post.findUnique({ where: { id }, select: { poll: true, authorId: true } });
    const def = post ? asPollDef(post.poll) : null;
    if (!post || !def) throw new AppError('투표를 찾을 수 없어요.', 404);
    if (Date.parse(def.endsAt ?? '') <= Date.now()) throw new AppError('마감된 투표예요.', 400);
    await prisma.postPollVote.deleteMany({ where: { postId: id, userId: me.id } });
    res.json(await pollView(prisma, id, def, { id: me.id, isAuthor: post.authorId === me.id, isAdmin: me.role === 'ADMIN' }));
  } catch (e) { next(e); }
});

export default router;
