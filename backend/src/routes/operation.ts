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
import { buildCaptionHwp, CAPTION_MAX_WORKS } from '../lib/captionHwp';
import { toManWon } from '../lib/format';
import { pushToUser } from '../lib/sse';
import { hasSubmissionContent } from '../lib/submission';
import { canOperateExhibition, operatorUserIds } from '../lib/exhibitionAccess';
import { fingerprintsOf, settlementFingerprint } from '../lib/settlementFingerprint';

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
      id: true, title: true, galleryId: true, hostType: true,
      recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: true, settledAt: true, exhibitStartDate: true,
      gallery: { select: { ownerId: true, name: true } },
      // 아트링크 주최 공모는 admin 이 지정한 운영 갤러리도 오너와 동일하게 운영한다
      managers: { select: { gallery: { select: { ownerId: true } } } },
    },
  });
  if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
  const isOwner = canOperateExhibition(exhibition, userId);
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
      // 아트링크 주최 공모는 gallery 가 '주관' 갤러리일 뿐이라, 위임받은 갤러리가 보면 남의 이름이 뜬다.
      // 화면에 쓸 이름은 주최자 기준으로 내려준다(주관 갤러리명은 hostGalleryName 으로 따로).
      galleryName: exhibition.hostType === 'ADMIN' ? '아트링크 주최' : exhibition.gallery.name,
      hostGalleryName: exhibition.gallery.name,
      hostType: exhibition.hostType,
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
            linkUrl: `/exhibitions/${exhibitionId}/operation/new`,
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

/**
 * 갤러리·관리자에게 내보내는 제출정보 — 작가가 '임시저장'한 작품(draft:true)은 제거한다.
 * 임시저장은 "아직 보여주고 싶지 않은 작성 중인 내용"이라, 여기서 한 번 걸러야
 * 목록·PDF·정산 등 갤러리 쪽 모든 화면에서 일관되게 감춰진다.
 * 대표작 인덱스도 제거 후 배열 기준으로 다시 매핑한다(엉뚱한 작품이 대표작이 되는 것 방지).
 */
/** 캡션·정산처럼 출품작 배열만 필요한 곳 — 임시저장(draft) 제외 */
function publishedArtworks(s: any): any[] {
  const list = safeJson<any[]>(s?.artworkList, []);
  // DB에 배열이 아닌 JSON이 저장돼 있어도(구버전/비정상 클라이언트) 갤러리 화면 전체가 500으로 죽지 않게
  return Array.isArray(list) ? list.filter((a) => !a?.draft) : [];
}

function publicSubmission(s: any) {
  const parsed = parseSubmission(s);
  if (!parsed) return null;
  const raw: any[] = Array.isArray(parsed.artworkList) ? parsed.artworkList : [];
  const kept: any[] = [];
  let repIndex: number | null = null;
  const draftTitles = new Set<string>();
  raw.forEach((a, i) => {
    if (a?.draft) { if (a?.title?.trim()) draftTitles.add(a.title.trim()); return; }
    if (parsed.representativeIndex === i) repIndex = kept.length;
    kept.push(a);
  });
  // 노트의 작품별 상세설명도 draft 작품 것은 감춘다 — 작품은 숨겼는데
  // 설명 본문으로 제목·내용이 새는 것을 막기 위해 (공개 작품과 제목이 겹치면 유지)
  const publishedTitles = new Set(kept.map((a) => a?.title?.trim()).filter(Boolean));
  let note = parsed.note;
  if (note?.sections?.length) {
    const sections = note.sections.filter((sec: any) => {
      const t = sec?.title?.trim();
      return !t || !draftTitles.has(t) || publishedTitles.has(t);
    });
    if (sections.length !== note.sections.length) note = { ...note, sections };
  }
  return { ...parsed, artworkList: kept, representativeIndex: repIndex, note };
}

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
    // 배열이 아닌 artworkList는 거부 — 저장되면 갤러리 쪽 모든 조회가 500으로 죽는다
    if (artworkList != null && !Array.isArray(artworkList)) throw new AppError('출품 목록 형식이 올바르지 않습니다.', 400);
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
      submission: publicSubmission(subByUser.get(a.userId)) ?? EMPTY_SUB,
    }));
    res.json(result);
  } catch (e) { next(e); }
});

// ── 단일 작가 제출정보 (PDF 인쇄용) — 갤러리/Admin 또는 본인 ──
router.post('/:id/submission-reminders', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { exhibition, isOwner, isAdmin } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 운영 페이지를 수정할 수 없습니다.', 403);
    if (exhibition.ended && !isAdmin) throw new AppError('전시 종료 후에는 자료 제출 안내를 보낼 수 없습니다.', 400);

    const accepted = await prisma.application.findMany({
      where: { exhibitionId, status: 'ACCEPTED' },
      include: { user: { select: { id: true, name: true, nickname: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const subs = await prisma.exhibitionSubmission.findMany({ where: { exhibitionId } });
    // 임시저장(draft)만 있는 작가는 아직 제출 전 — 안내 대상에 포함되도록 publicSubmission 기준으로 판단
    const subByUser = new Map(subs.map((s) => [s.userId, publicSubmission(s)]));
    const targets = accepted.filter((a) => {
      const sub = subByUser.get(a.userId);
      const hasArtwork = (sub?.artworkList?.length || 0) > 0;
      const hasCv = hasSubmissionContent(sub?.cv);
      const hasNote = hasSubmissionContent(sub?.note);
      return !(hasArtwork && hasCv && hasNote);
    });

    if (targets.length === 0) return res.json({ sentCount: 0, targets: [] });

    const subject = String(req.body?.subject || `[${exhibition.title}] 전시 자료 제출 안내`).trim();
    const content = String(req.body?.content || [
      `안녕하세요. ${exhibition.title} 운영팀입니다.`,
      '',
      '전시 운영을 위해 작품 정보, 작가 약력, 작가노트 제출이 필요합니다.',
      '운영 페이지에서 누락된 항목을 확인한 뒤 제출해 주세요.',
      '',
      `바로가기: /exhibitions/${exhibitionId}/operation/new`,
    ].join('\n')).trim();
    if (!subject || !content) throw new AppError('DM 제목과 내용을 입력해주세요.', 400);

    const messages = await prisma.$transaction(
      targets.map((target) => prisma.message.create({
        data: {
          senderId: req.user!.id,
          receiverId: target.userId,
          subject,
          content,
          exhibitionId,
        },
        include: {
          sender: { select: { id: true, name: true, nickname: true, role: true } },
          receiver: { select: { id: true, name: true, nickname: true, role: true } },
          exhibition: { select: { id: true, title: true } },
        },
      })),
    );

    try {
      await prisma.notification.createMany({
        data: targets.map((target) => ({
          userId: target.userId,
          type: 'SUBMISSION_REMINDER',
          message: `"${exhibition.title}" 전시 자료 제출 안내가 도착했습니다.`,
          linkUrl: `/messages?partner=${req.user!.id}&exhibition=${exhibitionId}&subject=${encodeURIComponent(subject)}`,
        })),
      });
      for (const message of messages) {
        pushToUser(message.receiverId, 'message', message);
        pushToUser(req.user!.id, 'message', message);
      }
    } catch {
      // 메시지는 이미 생성되었으므로 알림/SSE 실패는 무시합니다.
    }

    res.json({
      sentCount: targets.length,
      targets: targets.map((target) => ({ id: target.user.id, name: target.user.nickname || target.user.name })),
    });
  } catch (e) { next(e); }
});

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
      submission: publicSubmission(sub) ?? EMPTY_SUB,
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
    const byUser = new Map(subs.map((s) => [s.userId, publishedArtworks(s)]));
    const works: any[] = [];
    for (const a of accepted) {
      for (const w of (byUser.get(a.userId) || [])) {
        works.push({ title: w.title, size: w.size, medium: w.medium, year: w.year, price: toManWon(w.price) });
      }
    }
    if (works.length === 0) throw new AppError('등록된 출품작이 없습니다.', 400);
    // 페이지 수는 출품작 수에 맞춰 자동 확장(1페이지=24칸) — 잘림 없음. 상한만 방어.
    if (works.length > CAPTION_MAX_WORKS) {
      throw new AppError(`출품작이 너무 많아 캡션을 한 파일로 만들 수 없습니다. (${works.length}점 / 최대 ${CAPTION_MAX_WORKS}점)`, 400);
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
        // 전시 시작일이 지나 자동 확정된 경우 수동 취소 불가 (조용한 무반응 방지)
        if (!isAdmin && !exhibition.confirmed && curConfirmed) {
          throw new AppError('전시 시작일이 지나 자동 확정된 상태입니다. 확정을 취소할 수 없습니다.', 400);
        }
        // 판매/정산 데이터가 있으면 확정 해제 불가 — 확정 해제 시 작가가 출품작을 수정하면
        // 인덱스 기반 판매기록이 어긋난다. 먼저 정산을 취소하고 판매 내역을 비워야 함.
        if (!isAdmin) {
          const saleCount = await prisma.artworkSale.count({ where: { exhibitionId } });
          if (saleCount > 0) {
            throw new AppError('판매·정산 데이터가 있어 확정을 해제할 수 없습니다. 먼저 정산 요청을 취소하고 판매 내역을 비워주세요.', 400);
          }
        }
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
    const subByUser = new Map(subs.map(s => [s.userId, publishedArtworks(s)]));
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

    // publishedArtworks 필수 — 갤러리가 판매를 기록하는 정산 화면도 draft 제외 목록이라,
    // 여기서 원본 목록을 쓰면 artworkIndex(위치 기반)가 어긋나 작가에게 엉뚱한 작품이 '판매됨'으로 보인다
    const { artists } = computeSettlement(
      [{ user, artworkList: publishedArtworks(sub) }],
      sales, settlements
    );
    res.json({
      exhibitionTitle: exhibition.title, ended: exhibition.ended,
      requested, settled, settledAt: exhibition.settledAt,
      artist: artists[0],
      myApproval: appr ? { status: appr.status, comment: appr.comment } : null,
      // 지금 화면에 그린 금액의 지문. 수락할 때 그대로 돌려보내면 서버가 대조해
      // **보던 화면과 다른 금액에 동의하는 사고**를 막는다(갤러리가 검토 중에 고칠 수 있으므로).
      fingerprint: settlementFingerprint(sales, settlements[0]?.galleryRatio ?? 0),
    });
  } catch (e) { next(e); }
});

router.put('/:id/settlement', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    // 전시 종료 후에만 판매 입력 가능 — 종료 전에는 작가가 출품 목록을 고칠 수 있어
    // 위치 기반 artworkIndex가 다른 작품을 가리키게 된다 (작가 편집은 확정 시점에 잠김)
    if (!exhibition.ended && !isAdmin) throw new AppError('전시 종료 후에 정산을 입력할 수 있습니다.', 400);
    if (exhibition.settledAt && !isAdmin) throw new AppError('정산이 완료되어 더 이상 수정할 수 없습니다.', 403);
    // ⚠️ 확인 요청 중에도 수정할 수 있다. 예전엔 여기서 403 으로 막아, 한 작가의 문제를 고치려면
    // **요청 전체를 내려야** 했다 — 그러면 아직 검토 중이던 다른 작가의 화면까지 닫히고
    // (`my-settlement` 가 requested:false 로 비공개), 다들 처음부터 다시 하는 꼴이 된다.
    // 대신 아래에서 ①금액이 바뀐 작가만 PENDING 으로 되돌리고 ②그 사람에게만 재확인 알림을 보낸다.
    // 작가가 옛 화면을 보고 수락하는 사고는 `respond` 의 지문 대조(409)로 막는다.

    const { sales, ratios } = req.body || {};
    const saleRows = Array.isArray(sales) ? sales : [];
    const ratioRows = Array.isArray(ratios) ? ratios : [];

    // 정산 대상은 이 공모의 '수락된 작가'로 한정 — 임의 artistUserId 주입으로 인한
    // 고아/오귀속 재무 레코드 생성 차단 (데이터 정합성)
    const acceptedArtists = await prisma.application.findMany({
      where: { exhibitionId, status: 'ACCEPTED' },
      select: { userId: true },
    });
    const acceptedIds = acceptedArtists.map((a) => a.userId);
    const acceptedSet = new Set(acceptedIds);

    const saleData = saleRows
      .filter((s: any) => Number.isInteger(s.artistUserId) && Number.isInteger(s.artworkIndex) && acceptedSet.has(s.artistUserId))
      .map((s: any) => ({
        exhibitionId,
        artistUserId: s.artistUserId as number,
        artworkIndex: s.artworkIndex as number,
        title: String(s.title ?? ''),
        soldPrice: Math.max(0, Math.round(Number(s.soldPrice) || 0)),
        paymentMethod: s.paymentMethod === 'CASH' ? 'CASH' : 'CARD',
      }));
    const ratioData = ratioRows
      .filter((r: any) => Number.isInteger(r.artistUserId) && acceptedSet.has(r.artistUserId))
      .map((r: any) => ({
        exhibitionId,
        artistUserId: r.artistUserId as number,
        galleryRatio: Math.min(100, Math.max(0, Math.round(Number(r.galleryRatio) || 0))),
      }));

    // 이 저장으로 **금액이 실제로 달라진 작가만** 확인을 무효화한다.
    // 예전엔 요청 취소가 승인 기록을 통째로 지워 전원이 다시 확인해야 했다(10명 중 1명 때문에 9명 재확인).
    const fps = fingerprintsOf(acceptedIds, saleData, ratioData);
    const approvals = await prisma.settlementApproval.findMany({
      where: { exhibitionId },
      select: { artistUserId: true, status: true, snapshot: true },
    });
    const staleIds = approvals
      .filter((a) => a.status !== 'PENDING' && a.snapshot !== (fps.get(a.artistUserId) ?? null))
      .map((a) => a.artistUserId);

    await prisma.$transaction([
      prisma.artworkSale.deleteMany({ where: { exhibitionId } }),
      prisma.artworkSale.createMany({ data: saleData }),
      prisma.artistSettlement.deleteMany({ where: { exhibitionId } }),
      prisma.artistSettlement.createMany({ data: ratioData }),
      ...(staleIds.length > 0
        ? [prisma.settlementApproval.updateMany({
            where: { exhibitionId, artistUserId: { in: staleIds } },
            data: { status: 'PENDING', comment: null, snapshot: null },
          })]
        : []),
    ]);
    // 확인 요청이 열려 있는 채로 금액을 고쳤다면, **그 작가에게만** 다시 봐달라고 알린다.
    // 요청을 내렸다 다시 올릴 필요 없이 여기서 끝난다 — 나머지 작가의 검토는 그대로 이어진다.
    let notified = 0;
    if (exhibition.settlementRequestedAt && staleIds.length > 0) {
      try {
        await prisma.notification.createMany({
          data: staleIds.map((uid) => ({
            userId: uid,
            type: 'SETTLEMENT_CONFIRM_REQUEST',
            message: `"${exhibition.title}" 전시의 정산 내역이 수정되었습니다. 다시 확인해주세요.`,
            linkUrl: `/exhibitions/${exhibitionId}/operation/new`,
          })),
        });
        notified = staleIds.length;
      } catch { /* 알림 실패해도 저장은 정상 */ }
    }

    // resetIds: 이번 저장으로 재확인 대상이 된 작가들.
    // 화면의 [이 작가에게 다시 확인 요청]은 저장을 먼저 하는데, 저장이 이미 그 작가를 되돌리고
    // 알림까지 보냈다면 재요청을 또 부르지 않는다 — 안 그러면 **알림이 두 번** 간다.
    res.json({ message: '정산 정보가 저장되었습니다.', resetCount: staleIds.length, resetIds: staleIds, notified });
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
    const apprs = await prisma.settlementApproval.findMany({ where: { exhibitionId }, select: { artistUserId: true, status: true, snapshot: true } });
    const okSet = new Set(apprs.filter((a) => a.status === 'APPROVED').map((a) => a.artistUserId));
    if (acceptedArtists.some((a) => !okSet.has(a.userId))) {
      throw new AppError('모든 참여 작가가 정산을 확인(수락)해야 완료할 수 있습니다.', 400);
    }

    // 확인 이후 금액이 바뀐 채로 완료되는 것을 막는다 — 작가는 **자기가 못 본 금액**에 동의한 셈이 된다.
    // 정상 경로(PUT /settlement)에서는 이미 PENDING 으로 되돌아가므로 여기 걸릴 일이 없지만,
    // 정산은 돈 문제라 기록이 어긋나면 나중에 다툼의 근거가 사라진다. 마지막 문에서 한 번 더 본다.
    const acceptedIds = acceptedArtists.map((a) => a.userId);
    const sales = await prisma.artworkSale.findMany({ where: { exhibitionId } });
    const ratios = await prisma.artistSettlement.findMany({ where: { exhibitionId } });
    const fps = fingerprintsOf(acceptedIds, sales, ratios);
    const staleCount = apprs.filter((a) => a.status === 'APPROVED' && acceptedIds.includes(a.artistUserId) && a.snapshot !== fps.get(a.artistUserId)).length;
    if (staleCount > 0) {
      throw new AppError(`작가 확인 이후 정산 내용이 바뀐 작가가 ${staleCount}명 있습니다. [정산 확인 요청]을 다시 보내주세요.`, 400);
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
            linkUrl: `/exhibitions/${exhibitionId}/operation/new`,
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
    const acceptedIds = accepted.map((a) => a.userId);

    // 재요청 시 **이미 수락했고 그 뒤로 금액이 안 바뀐 작가는 그대로 둔다**.
    // 나머지(미응답·문제제기·금액 변경)만 PENDING 으로 새로 만들어 다시 묻는다.
    // 문제를 제기한 작가는 금액이 안 바뀌었어도 다시 묻는다 — 갤러리가 화면 밖에서 설명해 풀었을 수 있고,
    // 그 사람의 '문제 있음' 이 남은 채로는 어차피 정산을 완료할 수 없다.
    const existing = await prisma.settlementApproval.findMany({
      where: { exhibitionId },
      select: { artistUserId: true, status: true, snapshot: true },
    });
    const sales = await prisma.artworkSale.findMany({ where: { exhibitionId } });
    const ratios = await prisma.artistSettlement.findMany({ where: { exhibitionId } });
    const fps = fingerprintsOf(acceptedIds, sales, ratios);

    const byArtist = new Map(existing.map((e) => [e.artistUserId, e]));
    const keptIds: number[] = [];
    const askIds: number[] = [];
    for (const uid of acceptedIds) {
      const prev = byArtist.get(uid);
      if (prev && prev.status === 'APPROVED' && prev.snapshot === fps.get(uid)) keptIds.push(uid);
      else askIds.push(uid);
    }

    await prisma.$transaction([
      // 더 이상 수락 상태가 아닌 작가(거절로 되돌림 등)의 행 정리
      ...(acceptedIds.length > 0
        ? [prisma.settlementApproval.deleteMany({ where: { exhibitionId, artistUserId: { notIn: acceptedIds } } })]
        : [prisma.settlementApproval.deleteMany({ where: { exhibitionId } })]),
      // 다시 확인 받을 작가만 초기화 후 PENDING 재생성 (수락 유지 대상은 건드리지 않는다)
      prisma.settlementApproval.deleteMany({ where: { exhibitionId, artistUserId: { in: askIds } } }),
      prisma.settlementApproval.createMany({ data: askIds.map((uid) => ({ exhibitionId, artistUserId: uid, status: 'PENDING' })) }),
      prisma.exhibition.update({ where: { id: exhibitionId }, data: { settlementRequestedAt: new Date() } }),
    ]);

    // 알림은 **다시 물어야 하는 작가에게만** — 수락이 유지된 작가에게 보내면 이미 끝낸 일을 또 하라는 소리가 된다
    try {
      if (askIds.length > 0) {
        await prisma.notification.createMany({
          data: askIds.map((uid) => ({
            userId: uid,
            type: 'SETTLEMENT_CONFIRM_REQUEST',
            message: `"${exhibition.title}" 전시의 정산 내역 확인을 요청했습니다. 확인 후 수락해주세요.`,
            linkUrl: `/exhibitions/${exhibitionId}/operation/new`,
          })),
        });
      }
    } catch { /* 알림 실패해도 요청은 정상 */ }

    res.json({ settlementRequested: true, requestedCount: askIds.length, keptCount: keptIds.length });
  } catch (e) { next(e); }
});

// ── 작가 한 명에게만 다시 확인 요청 (오너/Admin) ──
//
// 금액을 고치면 `PUT /settlement` 이 알아서 그 작가를 재확인 대상으로 돌린다. 문제는 **고칠 게 없을 때**다.
// 작가가 잘못 봤거나 전화로 이미 설명이 끝난 경우, 금액은 그대로인데 '문제 제기' 상태가 남아
// 전원 수락이 안 되니 정산을 못 끝낸다. 그렇다고 요청 전체를 내렸다 올리면 남들까지 다시 붙잡는다.
// 그래서 그 사람만 콕 집어 PENDING 으로 되돌리고 알린다.
router.post('/:id/settlement/request/artist/:artistUserId', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const artistUserId = idOf(req.params.artistUserId);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (exhibition.settledAt) throw new AppError('이미 정산이 완료되었습니다.', 400);
    if (!exhibition.settlementRequestedAt) throw new AppError('먼저 [정산 확인 요청]을 보내주세요.', 400);

    // 이 공모의 수락 작가만 — 임의 id 주입으로 고아 승인행이 생기는 것을 막는다
    const app = await prisma.application.findUnique({
      where: { userId_exhibitionId: { userId: artistUserId, exhibitionId } },
      select: { status: true },
    });
    if (app?.status !== 'ACCEPTED') throw new AppError('이 공모의 참여 작가가 아닙니다.', 400);

    await prisma.settlementApproval.upsert({
      where: { exhibitionId_artistUserId: { exhibitionId, artistUserId } },
      update: { status: 'PENDING', comment: null, snapshot: null },
      create: { exhibitionId, artistUserId, status: 'PENDING' },
    });

    try {
      await prisma.notification.create({
        data: {
          userId: artistUserId,
          type: 'SETTLEMENT_CONFIRM_REQUEST',
          message: `"${exhibition.title}" 전시의 정산 확인을 다시 요청했습니다. 확인 후 수락해주세요.`,
          linkUrl: `/exhibitions/${exhibitionId}/operation/new`,
        },
      });
    } catch { /* 알림 실패해도 요청은 정상 */ }

    res.json({ status: 'PENDING' });
  } catch (e) { next(e); }
});

// ── 정산 확인 재안내 (오너/Admin) — 미응답(PENDING) 작가에게 DM + 알림 ──
router.post('/:id/settlement/reminders', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = idOf(req.params.id);
    const { isOwner, isAdmin, exhibition } = await getAccess(exhibitionId, req.user!.id, req.user!.role);
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);
    if (!exhibition.ended) throw new AppError('전시 종료 후 사용할 수 있습니다.', 400);
    if (exhibition.settledAt) throw new AppError('이미 정산이 완료되었습니다.', 400);
    if (!exhibition.settlementRequestedAt) throw new AppError('먼저 정산 확인 요청을 보내주세요.', 400);

    const pending = await prisma.settlementApproval.findMany({
      where: { exhibitionId, status: 'PENDING' },
      select: { artistUserId: true },
    });
    const pendingIds = pending.map((row) => row.artistUserId);
    if (pendingIds.length === 0) return res.json({ sentCount: 0, targets: [] });

    const targets = await prisma.user.findMany({
      where: { id: { in: pendingIds } },
      select: { id: true, name: true, nickname: true, role: true },
    });

    const subject = String(req.body?.subject || `[${exhibition.title}] 정산 확인 부탁드립니다`).trim();
    const content = String(req.body?.content || [
      `안녕하세요. ${exhibition.title} 운영팀입니다.`,
      '',
      '정산 내역 확인 요청을 다시 안내드립니다.',
      '운영 페이지에서 정산 금액을 확인한 뒤 수락 또는 문의를 남겨주세요.',
      '',
      `바로가기: /exhibitions/${exhibitionId}/operation/new`,
    ].join('\n')).trim();
    if (!subject || !content) throw new AppError('DM 제목과 내용을 입력해주세요.', 400);

    const messages = await prisma.$transaction(
      targets.map((target) => prisma.message.create({
        data: {
          senderId: req.user!.id,
          receiverId: target.id,
          subject,
          content,
          exhibitionId,
        },
        include: {
          sender: { select: { id: true, name: true, nickname: true, role: true } },
          receiver: { select: { id: true, name: true, nickname: true, role: true } },
          exhibition: { select: { id: true, title: true } },
        },
      })),
    );

    try {
      await prisma.notification.createMany({
        data: targets.map((target) => ({
          userId: target.id,
          type: 'SETTLEMENT_CONFIRM_REQUEST',
          message: `"${exhibition.title}" 정산 확인 재안내가 도착했습니다. 확인 후 수락해주세요.`,
          linkUrl: `/messages?partner=${req.user!.id}&exhibition=${exhibitionId}&subject=${encodeURIComponent(subject)}`,
        })),
      });
      for (const message of messages) {
        pushToUser(message.receiverId, 'message', message);
        pushToUser(req.user!.id, 'message', message);
      }
    } catch {
      // 메시지는 이미 생성되었으므로 알림/SSE 실패는 무시합니다.
    }

    res.json({
      sentCount: targets.length,
      targets: targets.map((target) => ({ id: target.id, name: target.nickname || target.name })),
    });
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

    // ⚠️ 승인 기록을 **지우지 않는다**. 예전엔 여기서 deleteMany 로 통째로 밀어서,
    // 한 명이 문제를 제기하면 이미 수락한 작가까지 전부 다시 확인해야 했다.
    // 지금은 기록을 남겨두고 `PUT /settlement` 이 금액이 바뀐 작가만 PENDING 으로 되돌린다.
    await prisma.exhibition.update({ where: { id: exhibitionId }, data: { settlementRequestedAt: null } });
    const kept = await prisma.settlementApproval.count({ where: { exhibitionId, status: 'APPROVED' } });
    res.json({ settlementRequested: false, keptCount: kept });
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

    // 응답한 **그 금액**을 지문으로 남긴다 — 이후 갤러리가 이 작가 금액을 고치면 지문이 어긋나
    // 자동으로 재확인 대상이 되고, 안 고치면 재요청해도 수락이 유지된다.
    const mySales = await prisma.artworkSale.findMany({ where: { exhibitionId, artistUserId: userId } });
    const myRatio = await prisma.artistSettlement.findUnique({
      where: { exhibitionId_artistUserId: { exhibitionId, artistUserId: userId } },
      select: { galleryRatio: true },
    });
    const snapshot = settlementFingerprint(mySales, myRatio?.galleryRatio ?? 0);

    // 갤러리는 확인 요청 중에도 금액을 고칠 수 있다. 작가가 **고쳐지기 전 화면**을 띄워둔 채
    // 수락을 누르면, 본 적 없는 금액에 동의한 기록이 남는다 — 정산은 돈 문제라 그게 곧 분쟁 근거다.
    // 화면이 그릴 때 받은 지문을 되돌려받아 대조한다(구버전 클라이언트는 지문을 안 보내므로 통과).
    const seen = typeof req.body?.fingerprint === 'string' ? req.body.fingerprint : null;
    if (seen !== null && seen !== snapshot) {
      throw new AppError('정산 내역이 방금 수정되었습니다. 새로고침해서 바뀐 금액을 확인해주세요.', 409);
    }

    await prisma.settlementApproval.upsert({
      where: { exhibitionId_artistUserId: { exhibitionId, artistUserId: userId } },
      update: { status: approve ? 'APPROVED' : 'ISSUE', comment: approve ? null : comment, snapshot },
      create: { exhibitionId, artistUserId: userId, status: approve ? 'APPROVED' : 'ISSUE', comment: approve ? null : comment, snapshot },
    });

    // 문제 제기 시 갤러리 오너에게 알림 (best-effort)
    if (!approve) {
      try {
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, nickname: true } });
        const who = me?.nickname || me?.name || '작가';
        // 아트링크 주최 공모는 위임받은 운영 갤러리들도 정산 담당이므로 모두에게 보낸다
        await prisma.notification.createMany({
          data: operatorUserIds(exhibition).map((uid) => ({
            userId: uid,
            type: 'SETTLEMENT_ISSUE',
            message: `"${exhibition.title}" 정산에 ${who}님이 문제를 제기했습니다: ${comment.slice(0, 80)}`,
            linkUrl: `/exhibitions/${exhibitionId}/operation/new`,
          })),
        });
      } catch { /* 알림 실패해도 응답은 정상 */ }
    }

    res.json({ status: approve ? 'APPROVED' : 'ISSUE' });
  } catch (e) { next(e); }
});

export default router;
