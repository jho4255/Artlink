/**
 * 공모 운영 페이지 라우트 (/api/operations)
 *
 * 접근 권한:
 *  - 갤러리 오너(공고 등록자) / Admin: 공지 관리, 전 작가 제출정보 열람
 *  - 수락(ACCEPTED)된 작가: 공지 열람 + 본인 제출정보 작성/조회 (타 작가 정보 열람 불가)
 *
 * 제출 정보: 출품리스트(artworkList) / 작가약력(cv) / 작가노트(note) — JSON 문자열 저장
 */
import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { buildCaptionHwp, CAPTION_CELL_CAPACITY } from '../lib/captionHwp';
import { toManWon } from '../lib/format';

const router = Router();

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb;
  try { return JSON.parse(raw) as T; } catch { return fb; }
}

function normalizeStr(v: any): string | null {
  if (v == null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// 확정 여부 계산: 수동 확정 || 전시 시작일 경과
function computeConfirmed(ex: { confirmed: boolean; exhibitStartDate: Date | null }): boolean {
  if (ex.confirmed) return true;
  if (ex.exhibitStartDate && new Date() >= ex.exhibitStartDate) return true;
  return false;
}

// 접근 권한 계산
async function getAccess(exhibitionId: number, userId: number, role: string) {
  const exhibition = await prisma.exhibition.findUnique({
    where: { id: exhibitionId },
    select: {
      id: true, title: true, galleryId: true,
      recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: true, settledAt: true, exhibitStartDate: true,
      gallery: { select: { ownerId: true, name: true } },
    },
  });
  if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
  const isOwner = exhibition.gallery.ownerId === userId;
  const isAdmin = role === 'ADMIN';
  let isAcceptedArtist = false;
  if (!isOwner && !isAdmin) {
    const app = await prisma.application.findUnique({
      where: { userId_exhibitionId: { userId, exhibitionId } },
      select: { status: true },
    });
    isAcceptedArtist = app?.status === 'ACCEPTED';
  }
  const isConfirmed = computeConfirmed(exhibition);
  return { exhibition, isOwner, isAdmin, isAcceptedArtist, isConfirmed };
}

const idOf = (s: any) => parseInt(s, 10);

// ── 접근 정보 (페이지 부트스트랩) ──
router.get('/:id/access', authenticate, async (req, res, next) => {
  try {
    const { exhibition, isOwner, isAdmin, isAcceptedArtist, isConfirmed } = await getAccess(idOf(req.params.id), req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin && !isAcceptedArtist) throw new AppError('운영 페이지 접근 권한이 없습니다.', 403);
    res.json({
      exhibitionId: exhibition.id,
      title: exhibition.title,
      galleryName: exhibition.gallery.name,
      isOwner, isAdmin, isAcceptedArtist,
      recruitmentClosed: exhibition.recruitmentClosed,
      confirmed: isConfirmed,        // 수동 확정 또는 전시 시작일 경과
      manualConfirmed: exhibition.confirmed,
      ended: exhibition.ended,
      settlementRequested: !!exhibition.settlementRequestedAt, // 정산 확인 요청 중(작가 검토 대기)
      settlementRequestedAt: exhibition.settlementRequestedAt,
      settled: !!exhibition.settledAt,   // 정산 완료 여부 (운영페이지 수정 잠금)
      settledAt: exhibition.settledAt,
    });
  } catch (e) { next(e); }
});

// ── 공지사항 ──
router.get('/:id/notices', authenticate, async (req, res, next) => {
  try {
    const { isOwner, isAdmin, isAcceptedArtist } = await getAccess(idOf(req.params.id), req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin && !isAcceptedArtist) throw new AppError('권한이 없습니다.', 403);
    const notices = await prisma.exhibitionNotice.findMany({
      where: { exhibitionId: idOf(req.params.id) },
      orderBy: { createdAt: 'desc' },
    });
    res.json(notices);
  } catch (e) { next(e); }
});

router.post('/:id/notices', authenticate, async (req, res, next) => {
  try {
    const { isOwner, isAdmin, exhibition } = await getAccess(idOf(req.params.id), req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('공지 작성 권한이 없습니다.', 403);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 운영 페이지를 수정할 수 없습니다.', 403);
    const { title, content } = req.body || {};
    if (!title?.trim() || !content?.trim()) throw new AppError('제목과 내용을 입력해주세요.', 400);
    const exhibitionId = idOf(req.params.id);
    const notice = await prisma.exhibitionNotice.create({
      data: { exhibitionId, title: title.trim(), content: content.trim() },
    });

    // 수락된 작가들에게 공지 알림 (best-effort)
    try {
      const exData = await prisma.exhibition.findUnique({ where: { id: exhibitionId }, select: { title: true } });
      const accepted = await prisma.application.findMany({
        where: { exhibitionId, status: 'ACCEPTED' },
        select: { userId: true },
      });
      if (accepted.length > 0) {
        await prisma.notification.createMany({
          data: accepted.map((a) => ({
            userId: a.userId,
            type: 'OPERATION_NOTICE',
            message: `"${exData?.title ?? '공모'}" 운영 공지: ${title.trim()}`,
            linkUrl: `/exhibitions/${exhibitionId}/operation`,
          })),
        });
      }
    } catch { /* 알림 실패해도 공지는 정상 */ }

    res.status(201).json(notice);
  } catch (e) { next(e); }
});

router.patch('/:id/notices/:noticeId', authenticate, async (req, res, next) => {
  try {
    const { isOwner, isAdmin, exhibition } = await getAccess(idOf(req.params.id), req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 운영 페이지를 수정할 수 없습니다.', 403);
    const noticeId = idOf(req.params.noticeId);
    const existing = await prisma.exhibitionNotice.findUnique({ where: { id: noticeId } });
    if (!existing || existing.exhibitionId !== idOf(req.params.id)) throw new AppError('공지를 찾을 수 없습니다.', 404);
    const { title, content } = req.body || {};
    if (!title?.trim() || !content?.trim()) throw new AppError('제목과 내용을 입력해주세요.', 400);
    const updated = await prisma.exhibitionNotice.update({
      where: { id: noticeId },
      data: { title: title.trim(), content: content.trim() },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/:id/notices/:noticeId', authenticate, async (req, res, next) => {
  try {
    const { isOwner, isAdmin, exhibition } = await getAccess(idOf(req.params.id), req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 운영 페이지를 수정할 수 없습니다.', 403);
    const noticeId = idOf(req.params.noticeId);
    const existing = await prisma.exhibitionNotice.findUnique({ where: { id: noticeId } });
    if (!existing || existing.exhibitionId !== idOf(req.params.id)) throw new AppError('공지를 찾을 수 없습니다.', 404);
    await prisma.exhibitionNotice.delete({ where: { id: noticeId } });
    res.json({ message: '삭제되었습니다.' });
  } catch (e) { next(e); }
});

// ── 작가 본인 제출정보 ──
function parseSubmission(s: any) {
  return s ? {
    ...s,
    artworkList: safeJson(s.artworkList, []),
    cv: safeJson(s.cv, null),
    note: safeJson(s.note, null),
    representativeIndex: s.representativeIndex ?? null,
  } : null;
}

const EMPTY_SUB = { artworkList: [], cv: null, note: null, representativeIndex: null };

router.get('/:id/me', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isAcceptedArtist } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isAcceptedArtist) throw new AppError('수락된 작가만 접근할 수 있습니다.', 403);
    const sub = await prisma.exhibitionSubmission.findUnique({
      where: { exhibitionId_userId: { exhibitionId, userId: req.user!.id } },
    });
    res.json(parseSubmission(sub) ?? EMPTY_SUB);
  } catch (e) { next(e); }
});

router.put('/:id/me', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isAcceptedArtist, isConfirmed } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isAcceptedArtist) throw new AppError('수락된 작가만 작성할 수 있습니다.', 403);
    if (isConfirmed) throw new AppError('전시 정보가 확정되어 더 이상 수정할 수 없습니다.', 403);
    const { artworkList, cv, note, representativeIndex } = req.body || {};
    // 대표작 인덱스: artworkList 범위 내 정수만 허용, 그 외 null
    const listLen = Array.isArray(artworkList) ? artworkList.length : 0;
    let repIdx: number | null = null;
    if (Number.isInteger(representativeIndex) && representativeIndex >= 0 && representativeIndex < listLen) {
      repIdx = representativeIndex;
    }
    const data = {
      artworkList: normalizeStr(artworkList),
      cv: normalizeStr(cv),
      note: normalizeStr(note),
      representativeIndex: repIdx,
    };
    const sub = await prisma.exhibitionSubmission.upsert({
      where: { exhibitionId_userId: { exhibitionId, userId: req.user!.id } },
      update: data,
      create: { exhibitionId, userId: req.user!.id, ...data },
    });
    res.json(parseSubmission(sub));
  } catch (e) { next(e); }
});

// ── 갤러리/Admin: 전 작가 제출정보 ──
router.get('/:id/submissions', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);

    // 수락된 작가 목록
    const accepted = await prisma.application.findMany({
      where: { exhibitionId, status: 'ACCEPTED' },
      include: { user: { select: { id: true, name: true, nickname: true, email: true, avatar: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const subs = await prisma.exhibitionSubmission.findMany({ where: { exhibitionId } });
    const subByUser = new Map(subs.map((s) => [s.userId, s]));

    const result = accepted.map((a) => ({
      user: a.user,
      submission: parseSubmission(subByUser.get(a.userId)) ?? EMPTY_SUB,
    }));
    res.json(result);
  } catch (e) { next(e); }
});

// ── 단일 작가 제출정보 (PDF 인쇄용) — 갤러리/Admin 또는 본인 ──
router.get('/:id/submissions/:userId', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const targetUserId = idOf(req.params.userId);
    const { exhibition, isOwner, isAdmin } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    const isSelf = req.user!.id === targetUserId;
    if (!isOwner && !isAdmin && !isSelf) throw new AppError('권한이 없습니다.', 403);

    // 대상이 실제 수락 작가인지 확인
    const app = await prisma.application.findUnique({
      where: { userId_exhibitionId: { userId: targetUserId, exhibitionId } },
      select: { status: true },
    });
    if (!app || app.status !== 'ACCEPTED') throw new AppError('해당 공모의 수락 작가가 아닙니다.', 404);

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, nickname: true, email: true },
    });
    const sub = await prisma.exhibitionSubmission.findUnique({
      where: { exhibitionId_userId: { exhibitionId, userId: targetUserId } },
    });
    res.json({
      exhibitionTitle: exhibition.title,
      user,
      submission: parseSubmission(sub) ?? EMPTY_SUB,
    });
  } catch (e) { next(e); }
});

// ── 캡션 HWP 다운로드 (오너/Admin) — 전체 출품작을 한글 양식으로 ──
router.get('/:id/caption.hwp', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);

    const accepted = await prisma.application.findMany({
      where: { exhibitionId, status: 'ACCEPTED' },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    const subs = await prisma.exhibitionSubmission.findMany({ where: { exhibitionId } });
    const byUser = new Map(subs.map((s) => [s.userId, safeJson<any[]>(s.artworkList, [])]));
    const works: any[] = [];
    for (const a of accepted) {
      for (const w of (byUser.get(a.userId) || [])) {
        works.push({ title: w.title, size: w.size, medium: w.medium, year: w.year, price: toManWon(w.price) });
      }
    }
    if (works.length === 0) throw new AppError('등록된 출품작이 없습니다.', 400);
    if (works.length > CAPTION_CELL_CAPACITY) {
      // 양식은 96칸 — 초과분은 잘림(로그만 남기고 진행)
      console.warn(`[caption] 출품작 ${works.length}점이 양식 용량(${CAPTION_CELL_CAPACITY})을 초과해 잘립니다. (공모 ${exhibitionId})`);
    }

    const buf = await buildCaptionHwp(works);
    const safe = (exhibition.title || '공모').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim() || '공모';
    const fname = `${safe}_작품캡션.hwp`;
    res.setHeader('Content-Type', 'application/x-hwp');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(buf);
  } catch (e) { next(e); }
});

// ── 공모 상태 토글 (모집마감/확정/종료) — 오너/Admin ──
router.patch('/:id/lifecycle', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 운영 페이지를 수정할 수 없습니다.', 403);
    const { recruitmentClosed, confirmed, ended } = req.body || {};
    const data: any = {};

    // 현재 상태 (단계 순서 강제: 모집마감 → 확정 → 전시종료)
    const curConfirmed = computeConfirmed(exhibition); // 수동 확정 또는 전시 시작일 경과
    const curRecruitmentClosed = exhibition.recruitmentClosed;
    const curEnded = exhibition.ended;

    // 순서 강제는 오너에게만 적용 — 관리자(Admin)는 단계와 무관하게 자유 수정 가능
    if (typeof recruitmentClosed === 'boolean') {
      // 모집 재개(false)는 확정/종료가 걸려있으면 불가 — 뒷 단계부터 취소해야 함
      if (!isAdmin && !recruitmentClosed && (exhibition.confirmed || curEnded)) {
        throw new AppError('확정·전시종료를 먼저 취소한 뒤 모집을 재개할 수 있습니다.', 400);
      }
      data.recruitmentClosed = recruitmentClosed;
    }
    if (typeof confirmed === 'boolean') {
      if (confirmed) {
        // 확정은 모집마감 이후에만
        if (!isAdmin && !curRecruitmentClosed && data.recruitmentClosed !== true) {
          throw new AppError('모집마감 후에 확정할 수 있습니다.', 400);
        }
      } else {
        // 확정 취소는 전시종료가 걸려있으면 불가
        if (!isAdmin && curEnded) throw new AppError('전시종료를 먼저 취소한 뒤 확정을 취소할 수 있습니다.', 400);
      }
      data.confirmed = confirmed;
    }
    if (typeof ended === 'boolean') {
      if (ended) {
        // 전시종료는 확정 이후에만 (수동 확정 또는 시작일 경과 자동 확정)
        if (!isAdmin && !curConfirmed && data.confirmed !== true) {
          throw new AppError('확정 후에 전시를 종료할 수 있습니다.', 400);
        }
        data.recruitmentClosed = true; // 종료 시 모집도 자동 마감
      }
      data.ended = ended;
    }
    const updated = await prisma.exhibition.update({
      where: { id: exhibitionId },
      data,
      select: { recruitmentClosed: true, confirmed: true, ended: true, exhibitStartDate: true },
    });
    res.json({
      recruitmentClosed: updated.recruitmentClosed,
      manualConfirmed: updated.confirmed,
      confirmed: computeConfirmed(updated),
      ended: updated.ended,
    });
  } catch (e) { next(e); }
});

// ── 정산: 판매작 + 작가별 비율 계산 결과 (오너/Admin) ──
function computeSettlement(rows: { user: any; artworkList: any[] }[], sales: any[], settlements: any[]) {
  const saleMap = new Map<string, { price: number; method: string }>(); // `${userId}:${idx}` → {price, method}
  for (const s of sales) saleMap.set(`${s.artistUserId}:${s.artworkIndex}`, { price: s.soldPrice, method: s.paymentMethod || 'CARD' });
  const ratioMap = new Map<number, number>();
  for (const st of settlements) ratioMap.set(st.artistUserId, st.galleryRatio);

  const artists = rows.map(({ user, artworkList }) => {
    const works = (artworkList || []).map((a, idx) => {
      const sale = saleMap.get(`${user.id}:${idx}`);
      return {
        index: idx,
        title: a.title || '',
        image: a.image || '',
        size: a.size || '',
        medium: a.medium || '',
        year: a.year || '',
        listPrice: a.price || '',
        sold: !!sale,
        soldPrice: sale?.price ?? 0,
        paymentMethod: sale?.method ?? 'CARD',
      };
    });
    const total = works.filter(w => w.sold).reduce((s, w) => s + w.soldPrice, 0);
    const galleryRatio = ratioMap.get(user.id) ?? 0;
    const galleryAmount = Math.round(total * galleryRatio / 100);
    const artistAmount = total - galleryAmount;
    return { user, galleryRatio, artistRatio: 100 - galleryRatio, works, total, galleryAmount, artistAmount };
  });
  const grand = {
    total: artists.reduce((s, a) => s + a.total, 0),
    galleryAmount: artists.reduce((s, a) => s + a.galleryAmount, 0),
    artistAmount: artists.reduce((s, a) => s + a.artistAmount, 0),
    soldCount: artists.reduce((s, a) => s + a.works.filter((w: any) => w.sold).length, 0),
  };
  return { artists, grand };
}

router.get('/:id/settlement', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);

    const accepted = await prisma.application.findMany({
      where: { exhibitionId, status: 'ACCEPTED' },
      include: { user: { select: { id: true, name: true, nickname: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const subs = await prisma.exhibitionSubmission.findMany({ where: { exhibitionId } });
    const subByUser = new Map(subs.map(s => [s.userId, safeJson<any[]>(s.artworkList, [])]));
    const rows = accepted.map(a => ({ user: a.user, artworkList: subByUser.get(a.userId) || [] }));

    const sales = await prisma.artworkSale.findMany({ where: { exhibitionId } });
    const settlements = await prisma.artistSettlement.findMany({ where: { exhibitionId } });
    const approvals = await prisma.settlementApproval.findMany({ where: { exhibitionId } });
    const apprMap = new Map(approvals.map(a => [a.artistUserId, { status: a.status, comment: a.comment }]));

    const computed = computeSettlement(rows, sales, settlements);
    const artists = computed.artists.map(a => ({ ...a, approval: apprMap.get(a.user.id) || null }));
    const allApproved = artists.length > 0 && artists.every(a => a.approval?.status === 'APPROVED');

    res.json({
      exhibitionTitle: exhibition.title,
      settlementRequested: !!exhibition.settlementRequestedAt,
      settlementRequestedAt: exhibition.settlementRequestedAt,
      allApproved,
      settled: !!exhibition.settledAt,
      settledAt: exhibition.settledAt,
      artists, grand: computed.grand,
    });
  } catch (e) { next(e); }
});

// ── 작가 본인 정산 내역 (수락 작가) ──
router.get('/:id/my-settlement', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const userId = req.user!.id;
    const { isAcceptedArtist, exhibition } = await getAccess(exhibitionId, userId, req.user!.role);
    if (!isAcceptedArtist) throw new AppError('수락된 작가만 조회할 수 있습니다.', 403);

    const requested = !!exhibition.settlementRequestedAt;
    const settled = !!exhibition.settledAt;
    // 확인 요청(검토) 또는 정산 완료 전에는 작가에게 정산 내역 비공개
    if (!requested && !settled) {
      return res.json({ exhibitionTitle: exhibition.title, ended: exhibition.ended, requested: false, settled: false, artist: null, myApproval: null });
    }

    const sub = await prisma.exhibitionSubmission.findUnique({ where: { exhibitionId_userId: { exhibitionId, userId } } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, nickname: true, email: true } });
    const sales = await prisma.artworkSale.findMany({ where: { exhibitionId, artistUserId: userId } });
    const settlements = await prisma.artistSettlement.findMany({ where: { exhibitionId, artistUserId: userId } });
    const appr = await prisma.settlementApproval.findUnique({ where: { exhibitionId_artistUserId: { exhibitionId, artistUserId: userId } } });

    const { artists } = computeSettlement(
      [{ user, artworkList: safeJson<any[]>(sub?.artworkList, []) }],
      sales, settlements
    );
    res.json({
      exhibitionTitle: exhibition.title, ended: exhibition.ended,
      requested, settled, settledAt: exhibition.settledAt,
      artist: artists[0],
      myApproval: appr ? { status: appr.status, comment: appr.comment } : null,
    });
  } catch (e) { next(e); }
});

router.put('/:id/settlement', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 더 이상 수정할 수 없습니다.', 403);
    if (exhibition.settlementRequestedAt && !isAdmin) throw new AppError('정산 확인 요청 중에는 수정할 수 없습니다. [요청 취소] 후 수정하세요.', 403);

    const { sales, ratios } = req.body || {};
    const saleRows = Array.isArray(sales) ? sales : [];
    const ratioRows = Array.isArray(ratios) ? ratios : [];

    await prisma.$transaction([
      prisma.artworkSale.deleteMany({ where: { exhibitionId } }),
      prisma.artworkSale.createMany({
        data: saleRows
          .filter((s: any) => Number.isInteger(s.artistUserId) && Number.isInteger(s.artworkIndex))
          .map((s: any) => ({
            exhibitionId,
            artistUserId: s.artistUserId,
            artworkIndex: s.artworkIndex,
            title: String(s.title ?? ''),
            soldPrice: Math.max(0, Math.round(Number(s.soldPrice) || 0)),
            paymentMethod: s.paymentMethod === 'CASH' ? 'CASH' : 'CARD',
          })),
      }),
      prisma.artistSettlement.deleteMany({ where: { exhibitionId } }),
      prisma.artistSettlement.createMany({
        data: ratioRows
          .filter((r: any) => Number.isInteger(r.artistUserId))
          .map((r: any) => ({
            exhibitionId,
            artistUserId: r.artistUserId,
            galleryRatio: Math.min(100, Math.max(0, Math.round(Number(r.galleryRatio) || 0))),
          })),
      }),
    ]);
    res.json({ message: '정산 정보가 저장되었습니다.' });
  } catch (e) { next(e); }
});

// ── 정산 완료 (오너/Admin) — 일방 확정: 수정 잠금 + 작가에게 정산 공개 ──
router.post('/:id/settlement/complete', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (!exhibition.ended) throw new AppError('전시 종료 후에 정산을 완료할 수 있습니다.', 400);
    if (exhibition.settledAt) throw new AppError('이미 정산이 완료되었습니다.', 400);
    if (!exhibition.settlementRequestedAt) throw new AppError('먼저 [정산 확인 요청]을 보내 작가 확인을 받아야 합니다.', 400);

    // 전원 수락 게이트: 수락 작가 모두 APPROVED여야 완료 가능
    const acceptedArtists = await prisma.application.findMany({ where: { exhibitionId, status: 'ACCEPTED' }, select: { userId: true } });
    const apprs = await prisma.settlementApproval.findMany({ where: { exhibitionId }, select: { artistUserId: true, status: true } });
    const okSet = new Set(apprs.filter((a) => a.status === 'APPROVED').map((a) => a.artistUserId));
    if (acceptedArtists.some((a) => !okSet.has(a.userId))) {
      throw new AppError('모든 참여 작가가 정산을 확인(수락)해야 완료할 수 있습니다.', 400);
    }

    const updated = await prisma.exhibition.update({
      where: { id: exhibitionId },
      data: { settledAt: new Date() },
      select: { settledAt: true },
    });

    // 수락 작가에게 정산 공개 알림 (best-effort)
    try {
      const accepted = await prisma.application.findMany({
        where: { exhibitionId, status: 'ACCEPTED' },
        select: { userId: true },
      });
      if (accepted.length > 0) {
        await prisma.notification.createMany({
          data: accepted.map((a) => ({
            userId: a.userId,
            type: 'SETTLEMENT_SHARED',
            message: `"${exhibition.title}" 전시의 정산 내역이 공개되었습니다.`,
            linkUrl: `/exhibitions/${exhibitionId}/operation`,
          })),
        });
      }
    } catch { /* 알림 실패해도 정산 완료는 정상 */ }

    res.json({ settled: true, settledAt: updated.settledAt });
  } catch (e) { next(e); }
});

// ── 정산 확인 요청 (오너/Admin) — 수락 작가 전원에게 확인 요청 + 알림 ──
router.post('/:id/settlement/request', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (!exhibition.ended) throw new AppError('전시 종료 후에 정산 확인을 요청할 수 있습니다.', 400);
    if (exhibition.settledAt) throw new AppError('이미 정산이 완료되었습니다.', 400);
    if (exhibition.settlementRequestedAt) throw new AppError('이미 정산 확인을 요청했습니다.', 400);

    const accepted = await prisma.application.findMany({ where: { exhibitionId, status: 'ACCEPTED' }, select: { userId: true } });

    await prisma.$transaction([
      // 이전 응답 초기화 후 전원 PENDING 생성
      prisma.settlementApproval.deleteMany({ where: { exhibitionId } }),
      prisma.settlementApproval.createMany({ data: accepted.map((a) => ({ exhibitionId, artistUserId: a.userId, status: 'PENDING' })) }),
      prisma.exhibition.update({ where: { id: exhibitionId }, data: { settlementRequestedAt: new Date() } }),
    ]);

    // 작가에게 확인 요청 알림 (best-effort)
    try {
      if (accepted.length > 0) {
        await prisma.notification.createMany({
          data: accepted.map((a) => ({
            userId: a.userId,
            type: 'SETTLEMENT_CONFIRM_REQUEST',
            message: `"${exhibition.title}" 전시의 정산 내역 확인을 요청했습니다. 확인 후 수락해주세요.`,
            linkUrl: `/exhibitions/${exhibitionId}/operation`,
          })),
        });
      }
    } catch { /* 알림 실패해도 요청은 정상 */ }

    res.json({ settlementRequested: true, requestedCount: accepted.length });
  } catch (e) { next(e); }
});

// ── 정산 확인 요청 취소 (오너/Admin) — 수정 위해 잠금 해제 ──
router.post('/:id/settlement/request/cancel', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt) throw new AppError('이미 정산이 완료되었습니다.', 400);
    if (!exhibition.settlementRequestedAt) throw new AppError('진행 중인 정산 확인 요청이 없습니다.', 400);

    await prisma.$transaction([
      prisma.settlementApproval.deleteMany({ where: { exhibitionId } }),
      prisma.exhibition.update({ where: { id: exhibitionId }, data: { settlementRequestedAt: null } }),
    ]);
    res.json({ settlementRequested: false });
  } catch (e) { next(e); }
});

// ── 작가: 정산 확인 응답 (수락 / 문제 제기 + 코멘트) ──
router.post('/:id/settlement/respond', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const userId = req.user!.id;
    const { isAcceptedArtist, exhibition } = await getAccess(exhibitionId, userId, req.user!.role);
    if (!isAcceptedArtist) throw new AppError('수락된 작가만 응답할 수 있습니다.', 403);
    if (!exhibition.settlementRequestedAt) throw new AppError('진행 중인 정산 확인 요청이 없습니다.', 400);
    if (exhibition.settledAt) throw new AppError('이미 정산이 완료되었습니다.', 400);

    const approve = req.body?.approve === true;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!approve && !comment) throw new AppError('문제 내용을 입력해주세요.', 400);

    await prisma.settlementApproval.upsert({
      where: { exhibitionId_artistUserId: { exhibitionId, artistUserId: userId } },
      update: { status: approve ? 'APPROVED' : 'ISSUE', comment: approve ? null : comment },
      create: { exhibitionId, artistUserId: userId, status: approve ? 'APPROVED' : 'ISSUE', comment: approve ? null : comment },
    });

    // 문제 제기 시 갤러리 오너에게 알림 (best-effort)
    if (!approve) {
      try {
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, nickname: true } });
        const who = me?.nickname || me?.name || '작가';
        await prisma.notification.create({
          data: {
            userId: exhibition.gallery.ownerId,
            type: 'SETTLEMENT_ISSUE',
            message: `"${exhibition.title}" 정산에 ${who}님이 문제를 제기했습니다: ${comment.slice(0, 80)}`,
            linkUrl: `/exhibitions/${exhibitionId}/operation`,
          },
        });
      } catch { /* 알림 실패해도 응답은 정상 */ }
    }

    res.json({ status: approve ? 'APPROVED' : 'ISSUE' });
  } catch (e) { next(e); }
});

export default router;
