/**
 * 공모·갤러리 **삭제 규칙** 한 곳 (2026-10-03, 공모 흐름 점검 후속 · 사용자 결정).
 *
 * ## 규칙
 *  - 공모: **수락한 작가가 한 명이라도 있거나** 판매·정산 기록(판매 입력 · 정산 확인 요청 · 정산 완료)이 있으면 갤러리가 직접 지울 수 없다.
 *    대신 사유를 적어 관리자에게 **삭제 요청**을 보낸다(`routes/approval.ts` 의 delete-request, `ApprovalRequest` 재사용).
 *  - 갤러리: 그런 공모가 하나라도 있거나, 아트링크 주최 공모의 **주관** 갤러리면 직접 지울 수 없다(같이 삭제 요청).
 *    ⚠️ 갤러리를 지우면 `Exhibition.galleryId onDelete: Cascade` 로 공모가 **통째로** 지워진다 — 예전엔 공모 직접 삭제는 정산 완료를 막으면서
 *       갤러리 삭제는 아무것도 안 막아, 정산이 끝난 공모의 판매·정산 기록까지 사라지고 작가 [내 전시]에서도 말없이 없어졌다(점검 P1-4).
 *  - 관리자는 그대로 지울 수 있다(잘못 만들어진 데이터를 치울 통로).
 *  - 어떤 길로 지우든(공모 직접 · 갤러리 · 삭제 요청 승인) **진행 중이던 작가에게 알린다** — 예전엔 알림이 없었다.
 *
 * ⚠️ 삭제 본체는 `deleteExhibitionWithNotice` · `deleteGalleryWithNotice` 두 함수뿐이다. 라우트에서 `prisma.exhibition.delete` 를 직접 부르지 말 것 —
 *    알림·파일 정리가 한쪽에서만 빠진다.
 */
import prisma from './prisma';
import { deleteUploadedFiles } from './storage';
import { ARTIST_EXHIBITION_LINK } from './notifyLinks';

export interface ExhibitionDeleteFacts {
  accepted: number;
  submissions: number;
  sales: number;
  settlementRequested: boolean;
  settled: boolean;
}

/** 지우면 무엇이 사라지는가 — 막을지 판단하고, 관리자 승인 화면에도 그대로 보여 준다 */
export async function exhibitionDeleteFacts(exhibitionId: number): Promise<ExhibitionDeleteFacts> {
  const [ex, accepted, submissions, sales] = await Promise.all([
    prisma.exhibition.findUnique({ where: { id: exhibitionId }, select: { settlementRequestedAt: true, settledAt: true } }),
    prisma.application.count({ where: { exhibitionId, status: 'ACCEPTED' } }),
    prisma.exhibitionSubmission.count({ where: { exhibitionId } }),
    prisma.artworkSale.count({ where: { exhibitionId } }),
  ]);
  return { accepted, submissions, sales, settlementRequested: !!ex?.settlementRequestedAt, settled: !!ex?.settledAt };
}

/** 갤러리가 직접 지울 수 없는 이유(없으면 null) */
export function exhibitionBlockReason(f: ExhibitionDeleteFacts): string | null {
  if (f.accepted > 0) return `수락한 작가가 ${f.accepted}명 있어 직접 삭제할 수 없어요.`;
  if (f.sales > 0 || f.settlementRequested || f.settled) return '판매·정산 기록이 있어 직접 삭제할 수 없어요.';
  return null;
}

/** 갤러리를 갤러리 계정이 직접 지울 수 없는 이유(없으면 null) — 걸린 공모 제목을 함께 */
export async function galleryBlockReason(galleryId: number): Promise<string | null> {
  const exhibitions = await prisma.exhibition.findMany({ where: { galleryId }, select: { id: true, title: true, hostType: true } });
  const hosted = exhibitions.filter((e) => e.hostType === 'ADMIN');
  if (hosted.length) return `아트링크 주최 공모 「${hosted[0]!.title}」의 주관 갤러리라 직접 삭제할 수 없어요.`;
  const blocked: string[] = [];
  for (const e of exhibitions) {
    if (exhibitionBlockReason(await exhibitionDeleteFacts(e.id))) blocked.push(e.title);
  }
  if (!blocked.length) return null;
  const head = blocked.slice(0, 2).map((t) => `「${t}」`).join(', ');
  return `작가가 참여 중이거나 정산 기록이 있는 공모(${head}${blocked.length > 2 ? ` 외 ${blocked.length - 2}건` : ''})가 있어 직접 삭제할 수 없어요.`;
}

/** 알림을 받을 작가 — 아직 진행 중이던 사람(접수·수락). 이미 미선정 결과를 받은 사람은 뺀다 */
async function involvedArtistIds(exhibitionIds: number[]): Promise<Map<number, number[]>> {
  if (!exhibitionIds.length) return new Map();
  const apps = await prisma.application.findMany({
    where: { exhibitionId: { in: exhibitionIds }, status: { in: ['SUBMITTED', 'REVIEWED', 'ACCEPTED'] } },
    select: { exhibitionId: true, userId: true },
  });
  const map = new Map<number, number[]>();
  for (const a of apps) map.set(a.exhibitionId, [...(map.get(a.exhibitionId) ?? []), a.userId]);
  return map;
}

async function exhibitionFileUrls(exhibitionIds: number[]): Promise<(string | null)[]> {
  if (!exhibitionIds.length) return [];
  const [imgs, promos, rows] = await Promise.all([
    prisma.exhibitionImage.findMany({ where: { exhibitionId: { in: exhibitionIds } }, select: { url: true } }),
    prisma.promoPhoto.findMany({ where: { exhibitionId: { in: exhibitionIds } }, select: { url: true } }),
    prisma.exhibition.findMany({ where: { id: { in: exhibitionIds } }, select: { imageUrl: true } }),
  ]);
  return [...imgs.map((i) => i.url), ...promos.map((p) => p.url), ...rows.map((r) => r.imageUrl)];
}

async function notifyDeleted(byExhibition: Map<number, number[]>, titles: Map<number, string>) {
  const data = [...byExhibition.entries()].flatMap(([exId, userIds]) => [...new Set(userIds)].map((userId) => ({
    userId,
    type: 'EXHIBITION_DELETED',
    message: `"${titles.get(exId) ?? '공모'}" 공모가 삭제되었어요.`,
    linkUrl: ARTIST_EXHIBITION_LINK,
  })));
  if (!data.length) return;
  try { await prisma.notification.createMany({ data }); } catch { /* 알림 실패가 삭제를 되돌리지 않는다 */ }
}

/** 공모 하나를 지운다 — 진행 중이던 작가에게 알리고 사진 파일도 정리한다 */
export async function deleteExhibitionWithNotice(exhibitionId: number): Promise<void> {
  const ex = await prisma.exhibition.findUnique({ where: { id: exhibitionId }, select: { id: true, title: true } });
  if (!ex) return;
  const [artists, files] = await Promise.all([involvedArtistIds([ex.id]), exhibitionFileUrls([ex.id])]);
  // cascade 로 Application·PromoPhoto·Favorite·제출 자료·판매·정산 행이 함께 지워진다(schema onDelete: Cascade)
  await prisma.exhibition.delete({ where: { id: ex.id } });
  await notifyDeleted(artists, new Map([[ex.id, ex.title]]));
  void deleteUploadedFiles(files);
}

/** 갤러리를 지운다 — 딸린 공모(cascade)의 작가에게도 알리고, 갤러리·공모 사진 파일을 정리한다 */
export async function deleteGalleryWithNotice(galleryId: number): Promise<void> {
  const gallery = await prisma.gallery.findUnique({ where: { id: galleryId }, select: { id: true, mainImage: true } });
  if (!gallery) return;
  const exhibitions = await prisma.exhibition.findMany({ where: { galleryId }, select: { id: true, title: true } });
  const exIds = exhibitions.map((e) => e.id);
  const [artists, exFiles, galleryImages] = await Promise.all([
    involvedArtistIds(exIds),
    exhibitionFileUrls(exIds),
    prisma.galleryImage.findMany({ where: { galleryId }, select: { url: true } }),
  ]);
  await prisma.gallery.delete({ where: { id: galleryId } });
  await notifyDeleted(artists, new Map(exhibitions.map((e) => [e.id, e.title])));
  void deleteUploadedFiles([...galleryImages.map((i) => i.url), gallery.mainImage, ...exFiles]);
}
