/**
 * 운영 화면의 내려받기 — 출품 자료 · 작품 리스트 · 작품 원본 · 정산서 · 지원서 (클라이언트에서 만든다).
 *
 * 2026-11-24 (규칙 92): PDF 는 전부 **글자가 글자로 남는 문서**(pdfmake + Pretendard)로 바뀌었다 — 만드는 곳은 `lib/galleryDocs/`.
 * 예전엔 화면을 html2canvas 로 찍어 A4 높이로 잘라 붙여서 글자를 복사·검색할 수 없었고, 쪽 경계에서 글자 줄이 반으로 잘렸으며,
 * 2쪽부터는 표 머리·작가 이름·쪽 번호가 없었다. 함수 이름과 돌려주는 값은 그대로다(화면은 바뀌지 않았다).
 *  - 출품 자료: 작가마다 PDF 하나(약력 · 작가노트 · 출품 작품) — 예전 세 개(출품리스트·작가약력·작가노트)를 합쳤다
 *  - 작품 리스트: 전시 전체를 한 표로(PDF · 엑셀) — 새로 생겼다
 *  - 작품 원본(ZIP): 파일 이름 앞에 작품 리스트와 같은 번호
 * 한글 캡션(.hwp)은 사용자 결정으로 예전 그대로다(서버 `lib/captionHwp.ts`).
 */
import { nameWithNickname } from '@/lib/utils';
import { fetchImage, imageSrc, recoverFailed, mapLimit, IMAGE_CONCURRENCY } from './imageFetch';
import type { CustomField, OperationSubmission } from '@/types';
import { isNativeApp, saveFile } from '@/lib/native';
import { numberWorks, padNo } from './galleryDocs/format';
import { buildWorkListDoc, workListSheet } from './galleryDocs/workList';
import { buildSubmissionDoc } from './galleryDocs/submissionDoc';
import { buildApplicationDoc, type ApplicantLike } from './galleryDocs/applicationDoc';
import { buildArtistSettlementDoc, buildSettlementDoc, type DocSettlement, type DocSettlementArtist, type PayMethod } from './galleryDocs/settlementDoc';
import type { DocContext, ImgFn } from './galleryDocs/types';

export type { ApplicantLike };

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
// HTML 로 그리는 문서(포트폴리오·도록)가 쓰는 이미지 주소.
// 미리 받아둔 게 있으면 blob: URL(동일출처 → taint 없음, 재요청 없음), 없으면 동일출처 프록시로 폴백.
// 실제 획득 로직(R2 직접 → 프록시 폴백 → 재시도)·캐시·병렬은 lib/imageFetch.ts 참고.
export function proxied(url: string): string {
  return imageSrc(url);
}
// 파일명 안전화 (경로 구분자/제어문자 제거)
export function safeName(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim() || '무제';
}

// ── ZIP 폴더 이름 ──
// 전체 다운로드는 작가별 폴더로 나눈다(평평하게 쏟아지면 작가가 여럿일 때 정리가 안 된다).
//
// ⚠️ **동명이인 처리**가 핵심이다. 같은 이름 두 명을 한 폴더에 합치면 갤러리가 서로 다른 작가의
// 작품을 섞어버린다 — 파일이 사라지지 않으니 **눈치채기도 어렵다**. 이름이 겹치면 `(2)`, `(3)`을
// 붙여 반드시 분리한다. 반환값은 userId → 폴더명.
export function artistFolderNames(users: { id: number; name: string; nickname?: string | null }[]): Map<number, string> {
  const used = new Map<string, number>();
  const out = new Map<number, string>();
  for (const u of users) {
    if (out.has(u.id)) continue; // 같은 작가가 여러 번 들어와도 폴더는 하나
    const base = safeName(nameWithNickname(u));
    const seen = (used.get(base) || 0) + 1;
    used.set(base, seen);
    out.set(u.id, seen === 1 ? base : `${base} (${seen})`);
  }
  return out;
}

// ── 누락 메모 ──
// 자동 회수까지 했는데도 못 받은 이미지가 있으면 **ZIP 안에 목록을 동봉**한다.
// 화면 안내는 페이지를 닫으면 사라지지만, 파일은 남는다 — "하나 빠졌는데 모르고 넘어가는" 상황을 막는 마지막 안전망.
export const MISSING_NOTE_NAME = '_받지못한작품.txt';
export function missingNote(exTitle: string, what: string, items: string[]): string {
  return [
    `[${exTitle}] ${what} — 받지 못한 항목 ${items.length}건`,
    '',
    ...items.map((s, i) => `${i + 1}. ${s}`),
    '',
    '이 목록의 항목은 이 ZIP에 들어있지 않습니다.',
    '운영 페이지에서 [다시 받기]를 누르면 받지 못한 항목만 다시 시도합니다.',
    '(이미 받은 항목은 다시 내려받지 않으므로 금방 끝납니다.)',
  ].join('\n');
}

/**
 * 만든 파일을 내려받는다 — 이 앱의 **모든 파일 내려받기가 여기로 모인다**(PDF·ZIP·PPTX·한글 캡션·엑셀).
 * 앱(안드로이드 WebView)은 `<a download>` 를 무시하므로 공유 창으로 넘긴다(lib/native.ts saveFile). 새 내려받기도 이걸 쓸 것.
 */
export function triggerDownload(blob: Blob, filename: string) {
  if (isNativeApp()) { void saveFile(blob, filename); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SubmissionRow { user: { id: number; name: string; nickname?: string | null; email?: string | null; handle?: string | null }; guest?: boolean; submission: OperationSubmission; }

type Progress = (done: number, total: number, phase: 'images' | 'retry' | 'pdf') => void;

/** 문서 모듈(무겁다 — pdfmake·글꼴)은 누를 때 받는다 */
const docs = () => import('./galleryDocs/render');

/**
 * 빌더 하나 또는 여럿을 '그림 적기 → 그림 준비 → 대체 글꼴 → 만들기' 로 돌린다.
 * @returns 만든 PDF 들과 받지 못한 그림 주소
 */
async function makeDocs(build: (img: ImgFn) => import('pdfmake/interfaces').TDocumentDefinitions[], onProgress?: Progress): Promise<{ blobs: Blob[]; failed: string[] }> {
  const r = await docs();
  const rec = r.imageRecorder();
  build(rec.img);
  const [pm, prepared] = await Promise.all([r.loadPdfMake(), r.prepareImages(rec.wanted, onProgress)]);
  const list = build(prepared.img);
  await r.prepareFallbackFonts(pm, list);
  const blobs: Blob[] = [];
  for (let i = 0; i < list.length; i++) {
    blobs.push(await r.renderDoc(pm, list[i]!));
    onProgress?.(i + 1, list.length, 'pdf');
  }
  return { blobs, failed: prepared.failed };
}

/** 그림 주소 → '작가 · 작품명' (누락 안내용) */
function missingNames(rows: SubmissionRow[], failed: string[]): string[] {
  const bad = new Set(failed);
  return rows.flatMap(({ user, submission }) =>
    (submission.artworkList || []).filter((a) => a.image && bad.has(a.image)).map((a) => `${nameWithNickname(user)} · ${a.title || '무제'}`));
}

// ── 작품 원본 이미지 일괄 다운로드 ──
/** 출품작 **원본 이미지**를 그대로 ZIP으로 묶어 다운로드 (rows에 1명만 넘기면 개별 작가용).
 *
 *  - 받은 바이트를 그대로 넣는다(재인코딩 없음 — 화질·EXIF 그대로).
 *  - **동시 5개 병렬**. 실패분은 배치가 끝난 뒤 자동 회수(`recoverFailed`)를 거치고,
 *    그래도 남으면 목록으로 돌려주고 ZIP 안에 누락 메모까지 넣는다(조용히 빠지지 않게).
 *  구조: **작가명 폴더** 안에 파일 (작가가 여럿일 때 평평하게 쏟아지지 않게)
 *  파일명: 번호_작가명_작품제목_작품크기_재료_제작년도_가격.{원본확장자} (동일명은 _2,_3 부여)
 *    - 번호는 **작품 리스트·출품 자료와 같은 번호**(전시 전체, 2026-11-24) — 그래서 한 작가만 받을 때도 전체 목록(`numberingRows`)으로 센다
 *    - 폴더에 작가명이 있어도 파일명에 그대로 둔다. 파일을 폴더 밖으로 꺼내 인쇄소·디자이너에게
 *      넘기는 일이 잦은데, 그때 이름이 없으면 어느 작가 작품인지 알 수 없다.
 *  zipName 미지정 시 "{공모명}_작품원본.zip" */
export async function downloadAllArtworkImagesZip(
  exTitle: string,
  rows: SubmissionRow[],
  zipName?: string,
  onProgress?: (done: number, total: number, phase?: 'collect' | 'retry') => void,
  numberingRows: SubmissionRow[] = rows,
): Promise<{ ok: number; fail: number; failed: string[] }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { numberOf, total } = numberWorks(numberingRows);

  // 작가별 폴더 (동명이인은 자동 분리)
  const folders = artistFolderNames(rows.map((r) => r.user));

  // 작업 목록 평탄화 (작가 경계와 무관하게 전부 병렬로 돌린다 — 폴더는 담을 때만 쓴다)
  const jobs = rows.flatMap(({ user, submission }) =>
    (submission.artworkList || [])
      .map((a, i) => ({ artist: nameWithNickname(user), folder: folders.get(user.id)!, a, no: numberOf(user.id, i) }))
      .filter((j) => !!j.a.image),
  );

  const results = await mapLimit(
    jobs,
    IMAGE_CONCURRENCY,
    async (j) => ({ ...j, img: await fetchImage(j.a.image as string) }),
    (d, t) => onProgress?.(d, t, 'collect'),
  );

  // 실패분 자동 회수 — 배치가 끝나 동시성 경쟁이 사라진 뒤라 같은 요청도 성공할 수 있다.
  // 회수분 반영은 캐시 히트라 네트워크를 다시 타지 않는다.
  const lost = results.filter((r) => !r.img).map((r) => r.a.image as string);
  if (lost.length > 0) {
    await recoverFailed(lost, (d, t) => onProgress?.(d, t, 'retry'));
    for (const r of results) if (!r.img) r.img = await fetchImage(r.a.image as string);
  }

  // 이름 중복 검사는 **폴더별**로 — 다른 작가 폴더에 같은 파일명이 있어도 충돌이 아니다
  const usedByFolder = new Map<string, Set<string>>();
  let ok = 0;
  const failed: string[] = [];
  for (const { artist, folder, a, img, no } of results) {
    if (!img) { failed.push(`${artist} · ${a.title || '무제'}`); continue; }
    const parts = [artist, a.title, a.size, a.medium, a.year, a.price]
      .map(p => safeName(String(p ?? '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const base = [no ? padNo(no, total) : '', parts.join('_') || '작품'].filter(Boolean).join('_');
    const used = usedByFolder.get(folder) || new Set<string>();
    usedByFolder.set(folder, used);
    let name = `${base}.${img.ext}`;
    let n = 2;
    while (used.has(name)) { name = `${base}_${n}.${img.ext}`; n += 1; }
    used.add(name);
    zip.file(`${folder}/${name}`, img.blob);
    ok += 1;
  }

  // ZIP이 스스로 누락을 증언하게 한다 — 페이지를 닫아도 무엇이 빠졌는지 파일만 보면 안다.
  if (failed.length > 0) zip.file(MISSING_NOTE_NAME, missingNote(exTitle, '작품 원본 이미지', failed));

  if (ok > 0) {
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, zipName || `${safeName(exTitle)}_작품원본.zip`);
  }
  return { ok, fail: failed.length, failed };
}

// ── 작품 리스트 ──
/** 작품 리스트 PDF — 전시 전체 출품작을 한 표로(작품 원본 파일 이름과 같은 번호) */
export async function downloadWorkListPdf(exhibitionId: string | number, exTitle: string, rows: SubmissionRow[], onProgress?: Progress): Promise<{ missing: string[] }> {
  const r = await docs();
  const ctx: DocContext = await r.loadDocContext(exhibitionId, exTitle);
  const { blobs, failed } = await makeDocs((img) => [buildWorkListDoc(ctx, rows, img)], onProgress);
  triggerDownload(blobs[0]!, `${safeName(ctx.exTitle || exTitle)}_작품리스트.pdf`);
  return { missing: missingNames(rows, failed) };
}

/** 작품 리스트 엑셀(.xlsx) — 같은 표, 가격은 숫자 칸 */
export async function downloadWorkListXlsx(exTitle: string, rows: SubmissionRow[]): Promise<void> {
  const { buildXlsx } = await import('./galleryDocs/xlsx');
  const sheet = workListSheet(rows);
  const blob = await buildXlsx('작품 리스트', sheet.head, sheet.rows, sheet.widths);
  triggerDownload(blob, `${safeName(exTitle)}_작품리스트.xlsx`);
}

// ── 출품 자료 ──
/** 작가마다 출품 자료 PDF 하나(약력 · 작가노트 · 출품 작품)를 ZIP 으로.
 *  그림은 먼저 전부 병렬로 받아 칸 크기에 맞춰 줄여 둔다(그 뒤 PDF 는 네트워크 없이 만든다).
 *  진행률은 그림 모으기(이미지) → 재시도 → PDF 순서로 알린다. */
export async function downloadAllSubmissionsZip(
  exTitle: string,
  rows: SubmissionRow[],
  onProgress?: Progress,
): Promise<{ missing: string[] }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const exSafe = safeName(exTitle);
  const { numberOf } = numberWorks(rows);
  const { blobs, failed } = await makeDocs((img) => rows.map((row) => buildSubmissionDoc(exTitle, row, numberOf, img)), onProgress);

  // 파일 이름은 작가 이름(동명이인은 (2) — 폴더 이름과 같은 규칙). 폴더 밖으로 꺼내 메일로 보내도 누구 것인지 보이게
  const names = artistFolderNames(rows.map((r) => r.user));
  rows.forEach((row, i) => zip.file(`${exSafe}_${names.get(row.user.id)}_출품자료.pdf`, blobs[i]!));

  // 그림이 빈 채로 나간 PDF가 있으면 ZIP이 스스로 증언하게 한다
  const missing = missingNames(rows, failed);
  if (missing.length > 0) zip.file(MISSING_NOTE_NAME, missingNote(exTitle, 'PDF에 들어갈 작품 이미지', missing));

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${exSafe}_출품자료.zip`);
  return { missing };
}

// ── 정산서 ──
const methodWord = (m?: PayMethod) => (m === 'CASH' ? '현금' : m === 'CARD' ? '카드' : '');

/** 정산서에 실리는 판매작 그림이 못 받은 경우 → '작가 · 작품명' */
function settlementMissing(artists: DocSettlementArtist[], failed: string[]): string[] {
  const bad = new Set(failed);
  return artists.flatMap((a) => a.works.filter((w) => w.sold && w.image && bad.has(w.image)).map((w) => `${nameWithNickname(a.user)} · ${w.title || '무제'}`));
}

/**
 * 작가 한 사람의 정산서(method 를 주면 현금/카드 정산서).
 * @param opts.forArtist 작가 본인이 [내 정산서]로 받는 경우 — 갤러리 몫 금액 줄을 뺀다
 * @param opts.exhibitionId 발행처·전시 기간을 머리에 찍으려고(없으면 제목만)
 */
export async function downloadArtistSettlementPdf(
  exTitle: string, artist: DocSettlementArtist, method?: PayMethod,
  onProgress?: (done: number, total: number, phase: 'images' | 'retry') => void,
  opts?: { forArtist?: boolean; cardFeeRate?: number; exhibitionId?: string | number },
): Promise<{ missing: string[] }> {
  const r = await docs();
  const ctx = await r.loadDocContext(opts?.exhibitionId, exTitle);
  const { blobs, failed } = await makeDocs((img) => [buildArtistSettlementDoc(ctx, artist, method, { forArtist: opts?.forArtist, cardFeeRate: opts?.cardFeeRate }, img)],
    (d, t, p) => { if (p !== 'pdf') onProgress?.(d, t, p); });
  const label = method ? `${methodWord(method)}정산서` : '정산서';
  triggerDownload(blobs[0]!, `${safeName(ctx.exTitle || exTitle)}_${safeName(nameWithNickname(artist.user))}_${label}.pdf`);
  return { missing: settlementMissing([artist], failed) };
}

/** 전체 정산서(method 를 주면 현금/카드 정산서) */
export async function downloadOverallSettlementPdf(
  s: DocSettlement, method?: PayMethod,
  onProgress?: (done: number, total: number, phase: 'images' | 'retry') => void,
  opts?: { exhibitionId?: string | number },
): Promise<{ missing: string[] }> {
  const r = await docs();
  const ctx = await r.loadDocContext(opts?.exhibitionId, s.exhibitionTitle);
  const { blobs, failed } = await makeDocs((img) => [buildSettlementDoc(ctx, s, method, img)], (d, t, p) => { if (p !== 'pdf') onProgress?.(d, t, p); });
  const label = method ? `${methodWord(method)}정산서` : '전체정산서';
  triggerDownload(blobs[0]!, `${safeName(ctx.exTitle || s.exhibitionTitle)}_${label}.pdf`);
  return { missing: settlementMissing(s.artists, failed) };
}

// ── 지원서 ──
const applicationImages = (app: ApplicantLike) => (app.artworkImages || []).filter(Boolean);

/** 지원자 1명의 지원서 PDF — 파일명: 공모명_작가명_지원서.pdf */
export async function downloadApplicationPdf(
  exTitle: string, app: ApplicantLike, customFields?: CustomField[] | null,
  onProgress?: (done: number, total: number, phase: 'images' | 'retry') => void,
): Promise<{ missing: number }> {
  const { blobs, failed } = await makeDocs((img) => [buildApplicationDoc(exTitle, app, customFields, img, { origin: window.location.origin })],
    (d, t, p) => { if (p !== 'pdf') onProgress?.(d, t, p); });
  triggerDownload(blobs[0]!, `${safeName(exTitle)}_${safeName(nameWithNickname(app.user))}_지원서.pdf`);
  const bad = new Set(failed);
  return { missing: applicationImages(app).filter((u) => bad.has(u)).length };
}

/** 전체 지원자 지원서 PDF를 ZIP으로 — 파일명: 공모명_지원서.zip
 *  지원자마다 작품 사진이 최대 30장이라 그림 규모가 가장 크다 — 먼저 전부 받아 줄여 둔다. */
export async function downloadAllApplicationsZip(
  exTitle: string, apps: ApplicantLike[], customFields?: CustomField[] | null,
  onProgress?: Progress,
): Promise<{ count: number; missing: string[] }> {
  if (apps.length === 0) return { count: 0, missing: [] };
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const exSafe = safeName(exTitle);
  const { blobs, failed } = await makeDocs((img) => apps.map((app) => buildApplicationDoc(exTitle, app, customFields, img, { origin: window.location.origin })), onProgress);
  const bad = new Set(failed);
  const missing = apps
    .filter((app) => applicationImages(app).some((u) => bad.has(u)))
    .map((app) => `${nameWithNickname(app.user)} · 사진 ${applicationImages(app).filter((u) => bad.has(u)).length}장`);

  const used = new Set<string>();
  apps.forEach((app, i) => {
    const aSafe = safeName(nameWithNickname(app.user));
    let name = `${exSafe}_${aSafe}_지원서.pdf`;
    let n = 2;
    while (used.has(name)) { name = `${exSafe}_${aSafe}_${n}_지원서.pdf`; n += 1; }
    used.add(name);
    zip.file(name, blobs[i]!);
  });
  if (missing.length > 0) zip.file(MISSING_NOTE_NAME, missingNote(exTitle, '지원서에 들어갈 작품 사진', missing));
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${exSafe}_지원서.zip`);
  return { count: apps.length, missing };
}
