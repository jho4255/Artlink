import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { safeFileUrl } from '../lib/safeUrl';
import { deleteUploadedFile } from '../lib/storage';
import { ensureHandle, isHandleParam, normalizeHandle, validateHandle } from '../lib/handle';
import { readImageDims } from '../lib/imageDims';

const router = Router();

// career JSON 문자열 → 객체 파싱 (프론트엔드는 항상 객체로 받음)
function parseCareer(raw: string | null | undefined) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// 시리즈 설명 JSON: [{ name, note }] — 깨진 값이 들어와도 화면이 죽지 않게 배열/필드 형태를 강제한다
function parseSeriesInfo(raw: string | null | undefined): { name: string; note: string }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((s) => s && typeof s === 'object')
      .map((s: any) => ({ name: String(s.name ?? '').slice(0, 120), note: String(s.note ?? '').slice(0, 2000) }))
      .filter((s) => s.name);
  } catch { return []; }
}

// 가이드형 디자인 설정(색감 팔레트 등) — 작은 JSON. 화면이 normalizePdfDesign 으로 최종 정규화하므로
// 여기서는 "객체이고 너무 크지 않은가"만 본다(깨진 값·거대 값 차단).
function parseDesignConfig(raw: string | null | undefined) {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
function sanitizeDesignConfig(input: unknown): string | null {
  if (input == null) return null;
  try {
    const obj = typeof input === 'string' ? JSON.parse(input) : input;
    if (!obj || typeof obj !== 'object') return null;
    const s = JSON.stringify(obj);
    return s.length <= 4000 ? s : null;
  } catch { return null; }
}

// 자유 텍스트 정규화 — 빈 문자열은 null로(있는 항목만 캡션에 조립하므로 ''와 null을 구분할 필요가 없다)
function text(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}
const oneOf = (v: unknown, allowed: string[]): string | null => {
  const s = typeof v === 'string' ? v : '';
  return allowed.includes(s) ? s : null;
};

const THEME_IDS = ['gallery', 'studio', 'story', 'archive'];

// 작품 메타(제목/재료/크기/연도/시리즈/설명/상태) — 생성·수정 공용.
// `undefined`인 키는 결과에서 빼서 PATCH가 "보낸 필드만" 바꾸도록 한다.
function artworkMeta(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };
  if ('title' in body) put('title', text(body.title, 200));
  if ('medium' in body) put('medium', text(body.medium, 200));
  if ('sizeText' in body) put('sizeText', text(body.sizeText, 100));
  if ('year' in body) put('year', text(body.year, 40));
  if ('series' in body) put('series', text(body.series, 120));
  if ('description' in body) put('description', text(body.description, 2000));
  if ('status' in body) put('status', oneOf(body.status, ['AVAILABLE', 'SOLD', 'NFS']));
  return out;
}

// 작가 검색 (Gallery 유저용, 전시 등록 시 작가 연동)
router.get('/search', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) return res.json([]);

    const users = await prisma.user.findMany({
      where: { role: 'ARTIST', name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, nickname: true, avatar: true },
      take: 10,
    });
    res.json(users);
  } catch (error) { next(error); }
});

// 공개 포트폴리오 조회 (인증 불필요)
router.get('/:userId', optionalAuth, async (req, res, next) => {
  try {
    // 숫자 id 또는 `@handle` (2026-09-16). 핸들이 규칙에 안 맞으면 조회조차 하지 않는다(404).
    const param = String(req.params.userId ?? '');
    let where: { id: number } | { handle: string };
    if (isHandleParam(param)) {
      const h = normalizeHandle(param);
      if (validateHandle(h)) throw new AppError('포트폴리오를 찾을 수 없습니다.', 404);
      where = { handle: h };
    } else {
      const userId = parseInt(param);
      if (isNaN(userId)) throw new AppError('유효하지 않은 유저 ID입니다.', 400);
      where = { id: userId };
    }

    // 탈퇴(deletedAt) 회원의 포트폴리오는 공개에서 숨김 → 404
    const user = await prisma.user.findFirst({
      where: { ...where, deletedAt: null },
      select: { id: true, name: true, nickname: true, handle: true, avatar: true, role: true, instagramUrl: true },
    });
    if (!user || user.role !== 'ARTIST') {
      throw new AppError('포트폴리오를 찾을 수 없습니다.', 404);
    }
    const userId = user.id;
    // 핸들이 없으면 인스타 아이디로 한 번 만들어 둔다 — 공유 링크가 처음부터 `/@handle` 이 되게
    const handle = await ensureHandle(user);

    let portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { images: { orderBy: { order: 'asc' }, include: { _count: { select: { likes: true } } } } },
    });

    // 포트폴리오가 없으면 빈 데이터 반환
    const { role, ...userInfo } = { ...user, handle };
    res.json({
      id: portfolio?.id || 0,
      biography: portfolio?.biography || null,
      exhibitionHistory: portfolio?.exhibitionHistory || null,
      career: parseCareer(portfolio?.career),
      portfolioFileUrl: portfolio?.portfolioFileUrl || null,
      statement: portfolio?.statement || null,
      tagline: portfolio?.tagline || null,
      themeId: portfolio?.themeId || null,
      seriesInfo: parseSeriesInfo(portfolio?.seriesInfo),
      designConfig: parseDesignConfig(portfolio?.designConfig),
      images: portfolio?.images || [],
      // 보는 사람이 좋아요한 작품 — 홈페이지 라이트박스의 하트 상태(2026-09-19). 비로그인은 빈 배열.
      likedImageIds: req.user && portfolio
        ? (await prisma.portfolioImageLike.findMany({ where: { userId: req.user.id, imageId: { in: portfolio.images.map((i) => i.id) } }, select: { imageId: true } })).map((l) => l.imageId)
        : [],
      user: userInfo,
    });
  } catch (error) { next(error); }
});

// 버전 응답 — design 은 JSON 문자열로 저장하고 객체로 내려준다(designConfig 와 같은 규칙)
const serializeVersion = (v: { id: number; name: string; workIds: number[]; design: string | null; createdAt: Date; updatedAt: Date }) =>
  ({ id: v.id, name: v.name, workIds: v.workIds, design: parseDesignConfig(v.design), createdAt: v.createdAt, updatedAt: v.updatedAt });
const VERSION_INCLUDE = { images: { orderBy: { order: 'asc' as const }, include: { _count: { select: { likes: true } } } }, versions: { orderBy: { createdAt: 'asc' as const } } };

// 내 포트폴리오 조회 (+ PDF 버전 목록)
router.get('/', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    let portfolio = await prisma.portfolio.findUnique({ where: { userId: req.user!.id }, include: VERSION_INCLUDE });
    if (!portfolio) {
      portfolio = await prisma.portfolio.create({ data: { userId: req.user!.id }, include: VERSION_INCLUDE });
    }
    res.json({
      ...portfolio,
      career: parseCareer(portfolio.career), seriesInfo: parseSeriesInfo(portfolio.seriesInfo), designConfig: parseDesignConfig(portfolio.designConfig),
      versions: portfolio.versions.map(serializeVersion),
    });
  } catch (error) { next(error); }
});

// ── PDF 버전 (2026-09-16) ───────────────────────────────────────────────────
// 작품 선택·순서·디자인을 묶어 이름 붙여 저장한다. "공모용 10점"·"갤러리용 전체" 처럼 보내는 곳마다 다른 책.
// ⚠️ 홈페이지 작품 순서(PortfolioImage.order)는 건드리지 않는다 — 버전은 그 위의 선택이다.
const MAX_VERSIONS = 12;
const versionName = (v: unknown) => text(v, 60);
/** 내 포트폴리오에 실제로 있는 작품 id 만, 중복 없이, 보낸 순서대로 */
async function ownWorkIds(portfolioId: number, raw: unknown): Promise<number[]> {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  const mine = new Set((await prisma.portfolioImage.findMany({ where: { portfolioId, id: { in: ids } }, select: { id: true } })).map((i) => i.id));
  return [...new Set(ids)].filter((id) => mine.has(id));
}
async function myPortfolioId(userId: number): Promise<number> {
  const p = await prisma.portfolio.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } });
  return p.id;
}

router.post('/versions', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const name = versionName(req.body?.name);
    if (!name) throw new AppError('버전 이름을 입력해주세요.', 400);
    const portfolioId = await myPortfolioId(req.user!.id);
    const count = await prisma.portfolioVersion.count({ where: { portfolioId } });
    if (count >= MAX_VERSIONS) throw new AppError(`버전은 ${MAX_VERSIONS}개까지 만들 수 있습니다.`, 400);
    const v = await prisma.portfolioVersion.create({
      data: {
        portfolioId, name,
        workIds: await ownWorkIds(portfolioId, req.body?.workIds),
        design: 'design' in (req.body ?? {}) ? sanitizeDesignConfig(req.body.design) : null,
      },
    });
    res.status(201).json(serializeVersion(v));
  } catch (error) { next(error); }
});

router.patch('/versions/:id', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const portfolioId = await myPortfolioId(req.user!.id);
    // 남의 버전은 404 (403 은 존재를 알려준다 — 규칙 23)
    const cur = await prisma.portfolioVersion.findFirst({ where: { id, portfolioId } });
    if (!cur) throw new AppError('버전을 찾을 수 없습니다.', 404);
    const body = req.body ?? {};
    const data: Record<string, unknown> = {};
    if ('name' in body) { const n = versionName(body.name); if (!n) throw new AppError('버전 이름을 입력해주세요.', 400); data.name = n; }
    if ('workIds' in body) data.workIds = await ownWorkIds(portfolioId, body.workIds);
    if ('design' in body) data.design = sanitizeDesignConfig(body.design);
    const v = await prisma.portfolioVersion.update({ where: { id }, data });
    res.json(serializeVersion(v));
  } catch (error) { next(error); }
});

router.delete('/versions/:id', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const portfolioId = await myPortfolioId(req.user!.id);
    const cur = await prisma.portfolioVersion.findFirst({ where: { id, portfolioId } });
    if (!cur) throw new AppError('버전을 찾을 수 없습니다.', 404);
    await prisma.portfolioVersion.delete({ where: { id } });
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

// 포트폴리오 수정
router.put('/', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const { biography, career, portfolioFileUrl, statement, tagline, themeId, seriesInfo } = req.body;
    // career는 객체로 올 수 있으므로 JSON 문자열로 정규화
    const careerStr =
      career == null ? null : typeof career === 'string' ? career : JSON.stringify(career);
    // seriesInfo도 동일. 저장 전에 parseSeriesInfo로 한 번 걸러 형태가 깨진 값이 DB에 남지 않게 한다.
    const seriesStr =
      seriesInfo == null
        ? null
        : JSON.stringify(parseSeriesInfo(typeof seriesInfo === 'string' ? seriesInfo : JSON.stringify(seriesInfo)));
    const base = {
      biography,
      career: careerStr,
      portfolioFileUrl: safeFileUrl(portfolioFileUrl),
      statement: text(statement, 4000),
      tagline: text(tagline, 200),
      themeId: oneOf(themeId, THEME_IDS),
      seriesInfo: seriesStr,
    };
    // designConfig 는 **보냈을 때만** 갱신한다 — 홈페이지 내용 저장(전체 교체)이 색감 설정을 지우지 않게(독립 필드).
    const data = 'designConfig' in req.body
      ? { ...base, designConfig: sanitizeDesignConfig(req.body.designConfig) }
      : base;
    const portfolio = await prisma.portfolio.upsert({
      where: { userId: req.user!.id },
      update: data,
      create: { userId: req.user!.id, ...data },
      include: { images: { orderBy: { order: 'asc' }, include: { _count: { select: { likes: true } } } } }
    });
    res.json({ ...portfolio, career: parseCareer(portfolio.career), seriesInfo: parseSeriesInfo(portfolio.seriesInfo), designConfig: parseDesignConfig(portfolio.designConfig) });
  } catch (error) { next(error); }
});

// 포트폴리오 이미지 추가 (최대 30장)
router.post('/images', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId: req.user!.id },
      include: { images: true }
    });
    if (!portfolio) {
      throw new AppError('포트폴리오를 먼저 생성해주세요.', 400);
    }
    if (portfolio.images.length >= 30) {
      throw new AppError('작품 사진은 최대 30장까지 등록 가능합니다.', 400);
    }

    const url = safeFileUrl(req.body.url);
    if (!url) throw new AppError('유효하지 않은 이미지 URL입니다.', 400);
    // 중간 삭제 후에도 order가 겹치지 않도록 (기존 최대 order) + 1 사용
    const nextOrder = portfolio.images.reduce((max, img) => Math.max(max, img.order), -1) + 1;
    // 픽셀 크기를 한 번 재서 저장한다(배치가 비율을 미리 알아야 화면이 안 튄다). 못 재면 null — 업로드는 막지 않는다.
    const dims = await readImageDims(url);
    const image = await prisma.portfolioImage.create({
      data: {
        url,
        portfolioId: portfolio.id,
        order: nextOrder,
        ...(dims ?? {}),
        ...artworkMeta(req.body), // 업로드하면서 바로 제목/재료 등을 넘길 수도 있다
      }
    });
    res.status(201).json(image);
  } catch (error) { next(error); }
});

// 작품 정보 수정 (제목/재료/크기/연도/시리즈/설명/상태/분류, 순서)
// 보낸 필드만 바꾼다 — 모달에서 일부만 고쳐도 나머지가 지워지지 않게.
router.patch('/images/:imageId', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    if (isNaN(imageId)) throw new AppError('유효하지 않은 이미지 ID입니다.', 400);

    // 소유권 확인 (IDOR 차단)
    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });
    if (!image || image.portfolio.userId !== req.user!.id) {
      throw new AppError('이미지를 찾을 수 없습니다.', 404);
    }

    const data = artworkMeta(req.body);
    if (req.body.order !== undefined) {
      const n = Number(req.body.order);
      if (!Number.isFinite(n) || n < 0) throw new AppError('유효하지 않은 순서입니다.', 400);
      data.order = Math.floor(n);
    }
    if (Object.keys(data).length === 0) throw new AppError('수정할 내용이 없습니다.', 400);

    const updated = await prisma.portfolioImage.update({ where: { id: imageId }, data });
    res.json(updated);
  } catch (error) { next(error); }
});

// 작품 순서 일괄 저장 — [id, ...] 순서대로 order 0,1,2...
// 낱개 PATCH를 여러 번 쏘면 중간에 실패했을 때 순서가 뒤엉키므로 트랜잭션으로 한 번에 쓴다.
router.put('/images/order', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((v: unknown) => Number(v)) : null;
    if (!ids || ids.some((n: number) => !Number.isInteger(n))) {
      throw new AppError('유효하지 않은 순서 목록입니다.', 400);
    }
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId: req.user!.id },
      include: { images: { select: { id: true } } },
    });
    if (!portfolio) throw new AppError('포트폴리오를 먼저 생성해주세요.', 400);

    // 남의 이미지 id가 섞여 들어오면 전체를 거절 (일부만 반영되는 애매한 상태 금지)
    const mine = new Set(portfolio.images.map((i) => i.id));
    if (ids.some((id: number) => !mine.has(id))) throw new AppError('이미지를 찾을 수 없습니다.', 404);

    await prisma.$transaction(
      ids.map((id: number, i: number) => prisma.portfolioImage.update({ where: { id }, data: { order: i } })),
    );
    res.json({ message: '순서가 저장되었습니다.' });
  } catch (error) { next(error); }
});

// PATCH /images/:imageId/explore — showInExplore 토글 (ARTIST 본인 전용)
router.patch('/images/:imageId/explore', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user!.id;

    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });

    if (!image || image.portfolio.userId !== userId) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const updated = await prisma.portfolioImage.update({
      where: { id: imageId },
      data: { showInExplore: !image.showInExplore },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// 포트폴리오 이미지 삭제 (본인 포트폴리오 이미지만)
router.delete('/images/:imageId', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    // 소유권 확인: 이미지가 요청자 본인의 포트폴리오에 속하는지 검증 (IDOR 차단)
    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });
    if (!image || image.portfolio.userId !== req.user!.id) {
      throw new AppError('이미지를 찾을 수 없습니다.', 404);
    }
    await prisma.portfolioImage.delete({ where: { id: imageId } });
    void deleteUploadedFile(image.url); // orphan 방지
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
