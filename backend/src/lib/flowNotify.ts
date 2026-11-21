/**
 * 공모 흐름에서 **단계가 넘어가는 순간**을 상대에게 알린다 (2026-11-20, 공모 흐름 개편 — CLAUDE.md 규칙 88).
 *
 * 그 전까지는 한쪽이 일을 끝내도 다른 쪽은 몰랐다:
 *  ① 작가가 출품 자료를 다 채워 내도 갤러리에게 알림이 없었다 — 갤러리는 [출품 자료]를 열어 봐야 알았다
 *  ② 갤러리가 전시를 확정해도(= 작가 자료가 잠긴다) 작가에게 알림이 없었다 — 고치러 들어와서야 잠긴 걸 알았다
 *  ③ 작가가 정산을 확인해도, **마지막 작가가 확인해도** 갤러리에게 알림이 없었다 — [정산 완료]를 누를 때를 몰랐다(이의만 알렸다)
 *  ④ 모집을 마감할 때 검토하지 않은 지원자가 남아 있으면 그 작가는 '심사 중'으로 영영 남았다
 *
 * ⚠️ 운영자에게 가는 알림은 `exhibitionNotifyTargets`(규칙 22) — 갤러리 없는 아트링크 주최 공모는 관리자 전원.
 * ⚠️ 링크는 받는 사람별(`lib/notifyLinks.ts`) — 운영자는 `operationLink`(역할마다 맞는 화면으로 간다), 작가는 `artistExhibitionLink`.
 * ⚠️ 알림 실패가 저장·전환을 막으면 안 된다 — 부르는 쪽이 try/catch 로 감싼다(best-effort).
 */
import prisma from './prisma';
import { withKeyLock, LOCK_NS } from './keyLock';
import { exhibitionNotifyTargets, type OperatorShape } from './exhibitionAccess';
import { artistExhibitionLink, operationLink } from './notifyLinks';
import { hasSubmissionContent } from './submission';

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb;
  try { return JSON.parse(raw) as T; } catch { return fb; }
}

/** 출품 자료가 다 찼는가 — 운영 개요(`my-operation-overview`)·화면 '제출 완료'와 같은 규칙(임시저장 작품은 빼고 센다) */
export function isSubmissionComplete(sub: { artworkList?: string | null; cv?: string | null; note?: string | null } | null | undefined): boolean {
  if (!sub) return false;
  const artworks = safeJson<any[]>(sub.artworkList, []);
  const hasArtwork = Array.isArray(artworks) && artworks.some((a) => a && typeof a === 'object' && !a.draft);
  return hasArtwork && hasSubmissionContent(safeJson(sub.cv, null)) && hasSubmissionContent(safeJson(sub.note, null));
}

type FlowExhibition = OperatorShape & { id: number; title: string };

/**
 * ① 작가가 출품 자료를 **다 채운 순간** — 운영자에게. 공모마다 안 읽은 한 줄로 합친다(작가가 열 명이면 열 줄이 아니라
 * '○○님이 냈어요 (7/10)' 한 줄이 계속 고쳐진다). 새로 낸 작가가 생길 때마다 다시 울린다(`REPUSH_TYPES`).
 * 다 모이면 '모두 모였어요. 전시를 확정하세요.' — 갤러리의 다음 할 일이 바로 그것이다.
 */
export async function notifySubmissionReceived(exhibition: FlowExhibition, artistUserId: number): Promise<void> {
  const targets = await exhibitionNotifyTargets(exhibition);
  if (targets.length === 0) return;
  const [artist, accepted] = await Promise.all([
    prisma.user.findUnique({ where: { id: artistUserId }, select: { name: true, nickname: true } }),
    prisma.application.findMany({ where: { exhibitionId: exhibition.id, status: 'ACCEPTED' }, select: { userId: true } }),
  ]);
  const acceptedIds = accepted.map((a) => a.userId);
  const subs = acceptedIds.length
    ? await prisma.exhibitionSubmission.findMany({ where: { exhibitionId: exhibition.id, userId: { in: acceptedIds } }, select: { artworkList: true, cv: true, note: true } })
    : [];
  const complete = subs.filter(isSubmissionComplete).length;
  const required = acceptedIds.length;
  const who = artist?.nickname || artist?.name || '작가';
  const message = required > 0 && complete >= required
    ? `"${exhibition.title}" 출품 자료가 모두 모였어요 (${complete}/${required}). 전시를 확정하세요.`
    : `"${exhibition.title}" ${who}님이 출품 자료를 냈어요 (${complete}/${required})`;
  const refKey = `submission:${exhibition.id}`;
  const linkUrl = operationLink(exhibition.id, 'submissions');
  // '고쳐 쓸 줄이 없으면 만든다'를 공모마다 줄 세운다 — 두 작가가 동시에 내면 둘 다 '없음'을 보고 두 줄이 됐다(규칙 46, Notification.refKey 는 unique 가 아니다).
  // 한 줄을 **update**(updateMany 아님)로 고쳐야 push 갈고리가 다시 울린다(lib/push.ts — update 만 본다).
  await withKeyLock(LOCK_NS.submissionNotes, exhibition.id, async (tx) => {
    for (const userId of targets) {
      const row = await tx.notification.findFirst({ where: { userId, refKey, read: false }, select: { id: true, message: true } });
      // 같은 문구면 고쳐 쓰지 않는다 — 고쳐 쓰면 푸시가 다시 울린다(같은 작가가 [제출]을 동시에 두 번 보낸 경우 · TESTCASES S9)
      if (row) { if (row.message !== message) await tx.notification.update({ where: { id: row.id }, data: { message, linkUrl, createdAt: new Date() } }); }
      else await tx.notification.create({ data: { userId, type: 'SUBMISSION_RECEIVED', message, linkUrl, refKey } });
    }
  });
}

/** ② 갤러리가 전시를 확정한 순간 — 수락된 작가 전원에게(출품 자료가 잠긴다는 것을 고치러 들어오기 전에 알게) */
export async function notifyExhibitionConfirmed(exhibition: { id: number; title: string }): Promise<void> {
  const accepted = await prisma.application.findMany({ where: { exhibitionId: exhibition.id, status: 'ACCEPTED' }, select: { userId: true } });
  if (accepted.length === 0) return;
  await prisma.notification.createMany({
    data: accepted.map((a) => ({
      userId: a.userId,
      type: 'EXHIBITION_CONFIRMED',
      message: `"${exhibition.title}" 전시가 확정되었어요. 출품 자료는 더 고칠 수 없어요.`,
      linkUrl: artistExhibitionLink(exhibition.id),
    })),
  });
}

/** 수락된 작가 전원이 정산을 확인했는가(이의·미응답 0) — 운영 화면의 `allApproved` 와 같은 규칙 */
export async function allSettlementApproved(exhibitionId: number): Promise<{ all: boolean; total: number }> {
  const accepted = await prisma.application.findMany({ where: { exhibitionId, status: 'ACCEPTED' }, select: { userId: true } });
  if (accepted.length === 0) return { all: false, total: 0 };
  const approved = await prisma.settlementApproval.count({
    where: { exhibitionId, status: 'APPROVED', artistUserId: { in: accepted.map((a) => a.userId) } },
  });
  return { all: approved >= accepted.length, total: accepted.length };
}

/**
 * ③ 마지막 작가가 정산을 확인한 순간(직접 · 무응답 자동 수락 둘 다) — 운영자에게 한 번. 갤러리의 다음 할 일이 [정산 완료]다.
 * 같은 줄이 이미 안 읽은 채로 있으면 새로 만들지 않는다(동시에 두 작가가 마지막으로 눌러도 한 줄).
 */
export async function notifySettlementAllApproved(exhibition: FlowExhibition & { settledAt?: Date | null }): Promise<void> {
  if (exhibition.settledAt) return;
  const { all, total } = await allSettlementApproved(exhibition.id);
  if (!all) return;
  const targets = await exhibitionNotifyTargets(exhibition);
  if (targets.length === 0) return;
  const refKey = `settle-all:${exhibition.id}`;
  const message = `"${exhibition.title}" 작가 ${total}명이 모두 정산을 확인했어요. 정산을 완료하세요.`;
  const linkUrl = operationLink(exhibition.id, 'settlement');
  await withKeyLock(LOCK_NS.settlementAllNotes, exhibition.id, async (tx) => {
    for (const userId of targets) {
      const row = await tx.notification.findFirst({ where: { userId, refKey, read: false }, select: { id: true } });
      if (!row) await tx.notification.create({ data: { userId, type: 'SETTLEMENT_ALL_APPROVED', message, linkUrl, refKey } });
    }
  });
}

// ④ 모집 마감 때 남은 검토 대기를 미선정으로 — 2026-11-21 부터 **알림 없이 늘** 그렇게 된다(사용자 결정, 규칙 90).
//    여기 있던 `rejectPendingApplications`(D2 — 확인창의 체크, 미선정 알림을 보냈다)는 `lib/applicationWindow.ts closeOutPendingApplications` 로 옮겼다.
