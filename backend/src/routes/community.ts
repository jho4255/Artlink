/**
 * 커뮤니티 게시판 (블라인드식 글로벌 게시판) — 홈 [인기글]의 출처.
 *
 * ## 설계
 * - **글마다 실명/익명 선택**(`anonymous`). 익명이면 응답에서 작성자 신원을 가린다
 *   (id·닉네임·아바타·역할 모두 숨김) — 역추적 방지. 서버는 authz 를 위해 authorId 를 계속 안다.
 * - 목록·랭킹을 매번 집계하지 않으려고 `likeCount`/`commentCount` 를 비정규화해 들고 있는다.
 * - 읽기는 공개(비로그인도), 쓰기는 로그인 필요. 삭제는 작성자 본인 또는 Admin.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';
import { resolveMentions, notifyMentions } from '../lib/mention';

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

/** 글 사진은 **우리 저장소** 주소만 (화면이 방금 /api/upload/image 로 올린 것). 외부 URL 차단. */
function ownImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const u of raw.slice(0, 10)) {
    const s = safeFileUrl(u);
    if (s && (s.startsWith('/uploads/') || matchR2Base(s))) out.push(s);
  }
  return out;
}

const createSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해주세요.').max(120, '제목은 120자까지입니다.'),
  body: z.string().trim().min(1, '내용을 입력해주세요.').max(5000, '내용은 5000자까지입니다.'),
  anonymous: z.boolean().optional().default(false),
  images: z.array(z.string()).max(10, '사진은 10장까지입니다.').optional().default([]),
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
  /** 켜면 **Admin 만** 이 탭에 글을 쓸 수 있다(공지 탭 등). 읽기는 그대로 공개. */
  writeAdminOnly: z.boolean().optional(),
});
const categoryPatchSchema = categorySchema.partial();
const commentSchema = z.object({
  body: z.string().trim().min(1, '댓글을 입력해주세요.').max(2000, '댓글은 2000자까지입니다.'),
  anonymous: z.boolean().optional().default(false),
});

type AuthorRow = { id: number; name: string; nickname: string | null; avatar: string | null; role: string };
const authorSelect = { select: { id: true, name: true, nickname: true, avatar: true, role: true } } as const;

/** 작성자 표기 — 익명이면 신원을 통째로 가린다(역추적 방지). 실명이면 닉네임 우선 + 역할. */
function serializeAuthor(anonymous: boolean, author: AuthorRow, viewerId?: number) {
  const mine = viewerId != null && viewerId === author.id;
  if (anonymous) {
    // 본인에게만 '익명(나)' 로 표시해 삭제 버튼 맥락을 준다. 그 외에는 완전 익명.
    return { id: null as number | null, name: mine ? '익명(나)' : '익명', nickname: null, avatar: null, role: null, anonymous: true, mine };
  }
  return { id: author.id, name: author.nickname || author.name, nickname: author.nickname, avatar: author.avatar, role: author.role, anonymous: false, mine };
}

// ── 목록 ── (sort=recent|popular, page)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id;
    const sort = String(req.query.sort ?? 'recent');
    const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
    const take = 20;
    const bySort = sort === 'popular'
      ? [{ likeCount: 'desc' as const }, { commentCount: 'desc' as const }, { createdAt: 'desc' as const }]
      : [{ createdAt: 'desc' as const }];

    // 내 글 / 내 댓글단 글 필터 — 로그인 필요(없으면 빈 목록)
    const mine = String(req.query.mine ?? '');
    let where: Record<string, unknown> = {};
    if (mine === 'posts') where = viewerId ? { authorId: viewerId } : { id: -1 };
    else if (mine === 'comments') where = viewerId ? { comments: { some: { authorId: viewerId } } } : { id: -1 };

    // 탭 필터 — slug 로 받는다(이름을 바꿔도 링크가 안 죽게). 'none' 은 미분류.
    const cat = String(req.query.category ?? '').trim();
    if (cat === 'none') where.categoryId = null;
    else if (cat) {
      const c = await prisma.postCategory.findUnique({ where: { slug: cat }, select: { id: true } });
      // 없는 탭이면 빈 목록 — 지워진 탭 링크로 들어와도 전체가 쏟아지지 않게
      where.categoryId = c ? c.id : -1;
    }

    // ⚠️ 고정 글을 맨 위로. Postgres 는 `DESC` 에서 NULL 을 **먼저** 놓으므로 반드시 `nulls: 'last'`
    //    를 줘야 한다 — 안 주면 고정 안 된 글이 위로 올라온다(정반대).
    // ⚠️ '내 글/내 댓글' 필터에서는 고정을 적용하지 않는다. 그건 내 활동 목록이라
    //    남이 고정한 글이 맨 위에 끼어들 이유가 없다.
    const orderBy = mine
      ? bySort
      : [{ pinnedAt: { sort: 'desc' as const, nulls: 'last' as const } }, ...bySort];

    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy, skip: (page - 1) * take, take, include: { author: authorSelect, category: true } }),
      prisma.post.count({ where }),
    ]);

    res.json({
      posts: rows.map((p) => ({
        id: p.id, title: p.title,
        // 목록엔 본문을 짧게만 (전문은 상세에서)
        excerpt: p.body.length > 140 ? p.body.slice(0, 140) + '…' : p.body,
        thumbnail: p.images[0] ?? null, imageCount: p.images.length,
        likeCount: p.likeCount, commentCount: p.commentCount, viewCount: p.viewCount, createdAt: p.createdAt,
        notice: p.notice, pinned: p.pinnedAt != null,
        category: p.category ? { id: p.category.id, name: p.category.name, slug: p.category.slug } : null,
        author: serializeAuthor(p.anonymous, p.author, viewerId),
      })),
      total, page, hasMore: page * take < total,
    });
  } catch (e) { next(e); }
});

// ── 인기글 (홈 위젯) ── 좋아요 많은 순, 동률이면 최신
router.get('/popular', async (req, res, next) => {
  try {
    const limit = Math.min(10, Math.max(1, parseInt(String(req.query.limit ?? '5')) || 5));
    const rows = await prisma.post.findMany({
      orderBy: [{ likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }],
      take: limit, include: { author: authorSelect },
    });
    res.json(rows.map((p) => ({
      id: p.id, title: p.title, likeCount: p.likeCount, commentCount: p.commentCount, viewCount: p.viewCount, createdAt: p.createdAt,
      author: serializeAuthor(p.anonymous, p.author),
    })));
  } catch (e) { next(e); }
});

// ══ 탭(말머리) — 읽기는 공개, 쓰기는 Admin 전용 ═══════════════════════════
// ⚠️ **`/:id` 보다 먼저 선언해야 한다.** 뒤에 두면 `/community/categories` 가 `/:id` 로 잡혀
//    parseInt('categories') = NaN → 404 가 된다(에러 메시지가 엉뚱해 원인 찾기 어렵다).

// 탭 목록 — 일반 사용자는 켜진 탭만, Admin 은 꺼진 탭까지(관리 화면에서 다시 켜야 하므로)
router.get('/categories', optionalAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'ADMIN';
    const rows = await prisma.postCategory.findMany({
      where: isAdmin ? {} : { active: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { posts: true } } },
    });
    res.json(rows.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, order: c.order, active: c.active,
      writeAdminOnly: c.writeAdminOnly, postCount: c._count.posts,
    })));
  } catch (e) { next(e); }
});

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
    const c = await prisma.postCategory.create({
      data: { name, slug, order, active: req.body.active ?? true, writeAdminOnly: req.body.writeAdminOnly ?? false },
    });
    res.status(201).json({
      id: c.id, name: c.name, slug: c.slug, order: c.order, active: c.active,
      writeAdminOnly: c.writeAdminOnly, postCount: 0,
    });
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

// 탭 수정 (Admin) — 이름·순서·활성. ⚠️ slug 는 바꾸지 않는다(주소·북마크가 죽는다)
router.patch('/categories/:id', authenticate, authorize('ADMIN'), validate(categoryPatchSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const cur = await prisma.postCategory.findUnique({ where: { id }, select: { id: true } });
    if (!cur) throw new AppError('탭을 찾을 수 없습니다.', 404);
    const data: Record<string, unknown> = {};
    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      const dup = await prisma.postCategory.findUnique({ where: { name }, select: { id: true } });
      if (dup && dup.id !== id) throw new AppError('같은 이름의 탭이 이미 있습니다.', 409);
      data.name = name;
    }
    if (typeof req.body.order === 'number') data.order = req.body.order;
    if (typeof req.body.active === 'boolean') data.active = req.body.active;
    if (typeof req.body.writeAdminOnly === 'boolean') data.writeAdminOnly = req.body.writeAdminOnly;
    const c = await prisma.postCategory.update({ where: { id }, data });
    res.json({ id: c.id, name: c.name, slug: c.slug, order: c.order, active: c.active, writeAdminOnly: c.writeAdminOnly });
  } catch (e) { next(e); }
});

// 탭 삭제 (Admin) — ⚠️ **글은 지우지 않는다.** categoryId 가 null 이 되어 '미분류'로 내려온다.
//    몇 개가 내려오는지 응답으로 돌려준다(화면이 미리 경고할 수 있게).
router.delete('/categories/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const c = await prisma.postCategory.findUnique({ where: { id }, include: { _count: { select: { posts: true } } } });
    if (!c) throw new AppError('탭을 찾을 수 없습니다.', 404);
    await prisma.postCategory.delete({ where: { id } });   // FK 가 SetNull
    res.json({ ok: true, movedToUncategorized: c._count.posts });
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
      include: { author: authorSelect, category: true, comments: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } } },
    });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const liked = viewerId
      ? !!(await prisma.postLike.findUnique({ where: { postId_userId: { postId: id, userId: viewerId } }, select: { id: true } }))
      : false;

    // 조회수 +1 (작성자 본인 조회는 세지 않는다 — 자기 글 새로고침으로 부풀지 않게)
    const isAuthor = viewerId != null && viewerId === post.authorId;
    const viewCount = isAuthor ? post.viewCount : (await prisma.post.update({
      where: { id }, data: { viewCount: { increment: 1 } }, select: { viewCount: true },
    })).viewCount;

    res.json({
      id: post.id, title: post.title, body: post.body, images: post.images,
      notice: post.notice, pinned: post.pinnedAt != null,
      category: post.category ? { id: post.category.id, name: post.category.name, slug: post.category.slug } : null,
      likeCount: post.likeCount, commentCount: post.commentCount, viewCount,
      createdAt: post.createdAt, updatedAt: post.updatedAt,
      liked,
      author: serializeAuthor(post.anonymous, post.author, viewerId),
      comments: post.comments.map((c) => ({
        id: c.id, body: c.body, createdAt: c.createdAt,
        author: serializeAuthor(c.anonymous, c.author, viewerId),
      })),
    });
  } catch (e) { next(e); }
});

// ── 작성 ──
router.post('/', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const { title, body, anonymous } = req.body;
    const images = ownImageUrls(req.body.images);   // 외부 URL 차단, 우리 저장소만

    // ⚠️ **공지·고정은 Admin 만.** 클라이언트가 보냈다는 이유로 켜지면 안 된다
    //    (스키마는 값을 받기만 하고 권한 판정은 반드시 여기서 한다).
    const isAdmin = req.user!.role === 'ADMIN';
    const notice = isAdmin && !!req.body.notice;
    const pinnedAt = isAdmin && !!req.body.pinned ? new Date() : null;
    // 공지는 익명일 수 없다 — 누가 공지했는지 알 수 없으면 공지가 아니다
    const anon = notice ? false : !!anonymous;

    // 없는 탭 id 를 보내면 FK 에러 대신 미분류로 (화면이 옛 탭을 들고 있을 수 있다)
    let categoryId: number | null = null;
    if (typeof req.body.categoryId === 'number') {
      const c = await prisma.postCategory.findUnique({
        where: { id: req.body.categoryId }, select: { id: true, name: true, active: true, writeAdminOnly: true },
      });
      // ⚠️ **쓰기 제한 탭은 조용히 미분류로 내리지 않고 막는다(403).** 조용히 옮기면 작성자는
      //    공지 탭에 올렸다고 믿는데 실제로는 미분류에 있다 — 에러 없이 어긋나는 상태가 된다.
      if (c?.writeAdminOnly && !isAdmin) {
        throw new AppError(`‘${c.name}’ 탭에는 관리자만 글을 쓸 수 있습니다.`, 403);
      }
      // ⚠️ 숨긴 탭도 **같은 이유로** 조용히 내리지 않는다 — 위 주석의 함정이 플래그만 다른 것이다.
      //    (Admin 은 숨긴 탭에도 쓸 수 있다 — 공개 전에 미리 채워 두는 용도)
      if (c && !c.active && !isAdmin) {
        throw new AppError(`‘${c.name}’ 탭은 지금 숨겨져 있어 글을 쓸 수 없습니다.`, 403);
      }
      if (c) categoryId = c.id;
    }

    const post = await prisma.post.create({
      data: { authorId: req.user!.id, title: title.trim(), body: body.trim(), anonymous: anon, images, categoryId, notice, pinnedAt },
      include: { author: authorSelect },
    });
    res.status(201).json({ id: post.id, author: serializeAuthor(post.anonymous, post.author, req.user!.id) });
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
    const post = await prisma.post.findUnique({ where: { id }, select: { notice: true, anonymous: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    const want = typeof req.body?.notice === 'boolean' ? req.body.notice : !post.notice;

    // ⚠️⚠️ **남의 익명 글을 공지로 올려 신원을 벗기지 말 것.**
    //   "공지는 익명일 수 없다"는 맞지만, 그건 **글쓴이가 공지로 쓸 때** 얘기다.
    //   여기서 `anonymous:false` 를 강제하면 관리자가 남의 익명 글을 공지로 지정하는 순간
    //   작성자의 id·닉네임·역할이 게시판에 **영구히** 드러난다(공지를 풀어도 안 돌아온다).
    //   익명은 우리가 그 사람에게 한 약속이라 운영 편의로 깰 수 없다 — 익명 글은 **거절**한다.
    //   공지로 올려야 할 내용이면 운영 계정으로 다시 쓰거나, 글쓴이에게 실명 전환을 요청할 것.
    if (want && post.anonymous) {
      throw new AppError('익명 글은 공지로 지정할 수 없습니다. 작성자만 실명으로 바꿀 수 있습니다.', 400);
    }

    const updated = await prisma.post.update({ where: { id }, data: { notice: want }, select: { notice: true } });
    res.json({ notice: updated.notice });
  } catch (e) { next(e); }
});

// ── 글 탭 옮기기 (Admin) ──
router.patch('/:id/category', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    const raw = req.body?.categoryId;
    let categoryId: number | null = null;
    if (typeof raw === 'number') {
      const c = await prisma.postCategory.findUnique({ where: { id: raw }, select: { id: true } });
      if (!c) throw new AppError('탭을 찾을 수 없습니다.', 404);
      categoryId = c.id;
    }
    const updated = await prisma.post.update({ where: { id }, data: { categoryId }, include: { category: true } });
    res.json({ category: updated.category ? { id: updated.category.id, name: updated.category.name, slug: updated.category.slug } : null });
  } catch (e) { next(e); }
});

// ── 수정 (작성자만) ──
router.patch('/:id', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('글을 찾을 수 없습니다.', 404);
    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true, notice: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    if (post.authorId !== req.user!.id) {
      throw new AppError('수정 권한이 없습니다.', 403);
    }
    const { title, body, anonymous } = req.body;
    const updated = await prisma.post.update({
      where: { id },
      // ⚠️ **사진(`images`)은 건드리지 않는다.** 수정 폼이 제목·내용·익명만 보내는데
      //    `createSchema` 가 `images` 를 `[]` 로 채워 주므로, 그대로 쓰면 글을 고칠 때마다
      //    **사진이 조용히 전부 지워진다**. 보낸 것과 기본값을 구분할 수 없으니 아예 뺀다.
      // ⚠️ 공지는 익명일 수 없다(누가 공지했는지 모르면 공지가 아니다) — 작성 때와 같은 규칙.
      data: { title, body, anonymous: post.notice ? false : !!anonymous },
      include: { author: authorSelect, category: true },
    });
    res.json({
      id: updated.id, title: updated.title, body: updated.body, images: updated.images,
      notice: updated.notice, pinned: updated.pinnedAt != null,
      category: updated.category ? { id: updated.category.id, name: updated.category.name, slug: updated.category.slug } : null,
      likeCount: updated.likeCount, commentCount: updated.commentCount, viewCount: updated.viewCount,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
      author: serializeAuthor(updated.anonymous, updated.author, req.user!.id),
    });
  } catch (e) { next(e); }
});

// ── 삭제 (작성자 또는 Admin) ──
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    if (post.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.post.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 좋아요 토글 ──
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
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
      return { liked: true, likeCount: u.likeCount };
    });
    res.json(out);
  } catch (e) { next(e); }
});

// ── 댓글 작성 ──
router.post('/:id/comments', authenticate, validate(commentSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const { body, anonymous } = req.body;
    // 멘션은 **글을 고치지 않는다** — 부를 수 있는 사람(ArtLink · 서로 이웃)에게만 알림이 간다.
    const trimmed = body.trim();
    const mentions = await resolveMentions(prisma, me, trimmed);

    const [comment] = await prisma.$transaction([
      prisma.postComment.create({
        data: { postId: id, authorId: me, body: trimmed, anonymous: !!anonymous },
        include: { author: authorSelect },
      }),
      prisma.post.update({ where: { id }, data: { commentCount: { increment: 1 } } }),
    ]);
    if (mentions.length > 0) {
      // ⚠️ 익명 댓글이어도 **부른 사람에게는 알림이 가야** 멘션이다. 다만 누가 불렀는지는
      //    글에서 이미 가려져 있으므로 알림에도 이름을 쓰지 않는다(익명 신원 역추적 방지).
      const meUser = anonymous ? null : await prisma.user.findUnique({ where: { id: me }, select: { name: true, nickname: true } });
      await notifyMentions(prisma, {
        meId: me,
        meName: meUser ? (meUser.nickname || meUser.name) : '익명',
        targets: mentions,
        where: '커뮤니티 댓글', linkUrl: `/community/${id}`, refKey: `mention:post-comment:${comment.id}`,
      });
    }
    res.status(201).json({
      id: comment.id, body: comment.body, createdAt: comment.createdAt,
      author: serializeAuthor(comment.anonymous, comment.author, me),
    });
  } catch (e) { next(e); }
});

// ── 댓글 삭제 (작성자 또는 Admin) ──
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const commentId = parseInt(req.params.commentId as string);
    const comment = await prisma.postComment.findUnique({ where: { id: commentId }, select: { authorId: true, postId: true } });
    if (!comment || comment.postId !== id) throw new AppError('댓글을 찾을 수 없습니다.', 404);
    if (comment.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.$transaction([
      prisma.postComment.delete({ where: { id: commentId } }),
      prisma.post.update({ where: { id }, data: { commentCount: { decrement: 1 } } }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
