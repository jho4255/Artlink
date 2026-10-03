import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import Notice from '@/components/flow/Notice';
import Disclosure from '@/components/flow/Disclosure';
import { dismissPdfHint, formatMB, inAppBrowserName, printedInfo } from '@/lib/portfolioMaker';
import {
  UPLOAD_MAX_BYTES, exportPortfolioPdf, logExport, saveBlob, setHomepagePortfolioFile, uploadPortfolioPdf,
  type ExportMethod, type ExportPhase,
} from '@/lib/portfolioExport';
import { printPortfolioBook } from '@/lib/portfolioPrint';
import { downloadPortfolioPptx, type BookPhase, type PdfDesign, type PortfolioBookData } from '@/lib/portfolioFormats';

/**
 * 저장 창 — [PDF 저장] 을 누르면 열린다 (2026-10-03).
 *
 * 예전 [PDF 저장] 은 곧바로 인쇄 창을 열었다. 거기서 대상을 'PDF 로 저장' 으로 바꿔야 한다는 안내는 버튼 아래 11px 회색 글씨였고,
 * 인쇄가 막힌 브라우저에서는 아무 일도 일어나지 않는데 성공 토스트가 떴다. 그리고 표지 이름·마지막 장의 연락처가
 * 무엇으로 찍히는지는 저장한 파일을 열어 봐야 알았다.
 *
 * 지금은 누르기 전에 한 번 보여 준다:
 *  1. **이렇게 실립니다** — 쪽수 · 이름 · 마지막 장의 연락처. [고치기] 는 꾸미기의 [이름·연락처] 로.
 *  2. **내 홈페이지 [포트폴리오] 탭에도 올리기**(기본 꺼짐) — 켜면 내려받으면서 홈페이지에도 올라가고, 다음 지원서에 자동으로 붙는다.
 *     방문자 누구나 본다는 것(연락처 포함)을 그 자리에서 말한다.
 *  3. **[PDF 내려받기]** — 파일이 바로 내려받아진다(`lib/portfolioExport.ts`). 진행과 결과는 이 창 안에 보인다
 *     (토스트는 화면 아래에 떠서 버튼을 가렸다).
 *  4. '다른 형식' — 글자가 살아 있는 PDF(인쇄 창. 누르기 **전에** 순서를 보여 준다) · PPT.
 *
 * 저장이 끝나면 다음에 할 일(모집공고 보기 · 내 홈페이지에서 보기)을 보여 준다 — 예전엔 저장한 뒤 아무 안내가 없었다.
 */
type Stage =
  | { kind: 'ready' }
  | { kind: 'working'; method: ExportMethod; label: string; percent: number }
  | { kind: 'error'; message: string }
  | {
    kind: 'done'; method: 'download';
    fileName: string; pages: number; bytes: number; lowered: boolean; overBudget: boolean; missing: number;
    upload: 'no' | 'yes' | 'failed' | 'skipped-missing' | 'skipped-large';
  }
  | { kind: 'done'; method: 'print'; pages: number; opened: boolean; missing: number }
  | { kind: 'done'; method: 'pptx'; pages: number; missing: number };

const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

export default function SaveDialog({
  book, design, pages, works, sizeLabel, currentFileUrl, homePath, userId, beforeExport, onUploaded, onEditInfo, onPickWorks, onClose,
}: {
  /** 미리보기가 쓰는 것과 같은 데이터(사진 비율 포함) — 그래야 화면에서 본 배치 그대로 저장된다 */
  book: PortfolioBookData;
  design: PdfDesign;
  pages: number;
  works: number;
  /** '세로 A4' */
  sizeLabel: string;
  /** 홈페이지에 이미 올려 둔 포트폴리오 파일(있으면 '바꿉니다' 라고 말한다) */
  currentFileUrl: string | null;
  homePath: string;
  userId: number;
  /** 저장하기 전에 — 아직 서버로 가지 않은 디자인을 마저 보낸다 */
  beforeExport: () => Promise<void>;
  onUploaded: (url: string) => void;
  onEditInfo: () => void;
  onPickWorks: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'ready' });
  const [alsoUpload, setAlsoUpload] = useState(false);
  /** 만든 파일 — [다시 내려받기]·[다시 올리기] 가 다시 굽지 않고 쓴다 */
  const made = useRef<{ blob: Blob; fileName: string } | null>(null);
  const working = stage.kind === 'working';
  const info = printedInfo(book, design);
  const inApp = typeof navigator !== 'undefined' ? inAppBrowserName(navigator.userAgent) : null;

  useEscapeKey(onClose, { enabled: !working });   // 만드는 중에는 닫히지 않는다
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /** 단계 → 한 줄 + 0~100 (사진 20 · 쪽 70 · 용량 8 · 올리기 2) */
  const progress = (method: ExportMethod) => (phase: ExportPhase | BookPhase, done: number, total: number) => {
    const r = total > 0 ? done / total : 0;
    const [label, percent] =
      phase === 'images' ? [`작품 사진 불러오는 중 ${done}/${total}`, r * 20]
      : phase === 'retry' ? [`못 받은 사진을 다시 받는 중 ${done}/${total}`, 20]
      : phase === 'render' ? [`쪽 만드는 중 ${done}/${total}`, 20 + r * 70]
      : [`용량 맞추는 중 ${done}/${total}`, 90 + r * 8];
    setStage({ kind: 'working', method, label, percent });
  };

  const upload = async (): Promise<'yes' | 'failed'> => {
    const m = made.current;
    if (!m) return 'failed';
    try {
      const url = await uploadPortfolioPdf(m.blob, m.fileName);
      onUploaded(await setHomepagePortfolioFile(url));
      return 'yes';
    } catch { return 'failed'; }
  };

  const download = async () => {
    setStage({ kind: 'working', method: 'download', label: '준비하는 중', percent: 0 });
    try {
      await beforeExport().catch(() => { /* 디자인 저장이 안 돼도 파일은 만든다 */ });
      const r = await exportPortfolioPdf(book, design, { onProgress: progress('download') });
      made.current = { blob: r.blob, fileName: r.fileName };
      saveBlob(r.blob, r.fileName);
      let up: Extract<Stage, { method: 'download' }>['upload'] = 'no';
      if (alsoUpload) {
        // 빈 칸이 있는 파일을 공개 홈페이지에 올리지 않는다 · 서버 한도(20MB)를 넘으면 올리지 못한다
        if (r.missing.length > 0) up = 'skipped-missing';
        else if (r.bytes > UPLOAD_MAX_BYTES) up = 'skipped-large';
        else {
          setStage({ kind: 'working', method: 'download', label: '내 홈페이지에 올리는 중', percent: 99 });
          up = await upload();
        }
      }
      logExport({ method: 'download', pages: r.pages, works: r.works, uploaded: up === 'yes' });
      dismissPdfHint(userId);
      setStage({
        kind: 'done', method: 'download', fileName: r.fileName, pages: r.pages, bytes: r.bytes,
        lowered: r.step > 0, overBudget: r.overBudget, missing: r.missing.length, upload: up,
      });
    } catch {
      setStage({ kind: 'error', message: 'PDF 를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
    }
  };

  const retryUpload = async () => {
    if (stage.kind !== 'done' || stage.method !== 'download') return;
    const keep = stage;
    setStage({ kind: 'working', method: 'download', label: '내 홈페이지에 올리는 중', percent: 99 });
    const up = await upload();
    if (up === 'yes') logExport({ method: 'download', pages: keep.pages, works, uploaded: true });
    setStage({ ...keep, upload: up });
  };

  const print = async () => {
    setStage({ kind: 'working', method: 'print', label: '준비하는 중', percent: 0 });
    try {
      await beforeExport().catch(() => {});
      const r = await printPortfolioBook(book, design, (d, t, phase) => progress('print')(phase, d, t));
      if (r.opened) { logExport({ method: 'print', pages: r.pages, works }); dismissPdfHint(userId); }
      setStage({ kind: 'done', method: 'print', pages: r.pages, opened: r.opened, missing: r.missing.length });
    } catch {
      setStage({ kind: 'error', message: '인쇄할 문서를 만들지 못했습니다. 위의 [PDF 내려받기] 를 써 주세요.' });
    }
  };

  const pptx = async () => {
    setStage({ kind: 'working', method: 'pptx', label: '준비하는 중', percent: 0 });
    try {
      await beforeExport().catch(() => {});
      const r = await downloadPortfolioPptx(book, 'archive', (d, t, phase) => progress('pptx')(phase, d, t), design);
      logExport({ method: 'pptx', pages: r.pages, works });
      setStage({ kind: 'done', method: 'pptx', pages: r.pages, missing: r.missing.length });
    } catch (err) {
      setStage({ kind: 'error', message: errText(err, 'PPT 를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.') });
    }
  };

  const primary = 'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 text-[15px] font-medium text-white hover:bg-gray-800 disabled:opacity-50';
  const secondary = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 hover:bg-gray-50';
  const missingNote = (n: number) => n > 0 && (
    <Notice tone="attention" title={`작품 사진 ${n}장을 불러오지 못했어요`} className="mt-3">
      그 자리가 빈 칸으로 저장됐습니다. 잠시 뒤 다시 저장해 주세요.
    </Notice>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={() => { if (!working) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="PDF 저장"
        data-testid="save-dialog"
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-2">
          <h3 className="text-base font-semibold text-gray-950">PDF 저장</h3>
          <button type="button" onClick={onClose} disabled={working} aria-label="닫기" className="-mr-2 grid h-11 w-11 place-items-center text-gray-500 hover:text-gray-900 disabled:opacity-30"><X size={20} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {stage.kind === 'ready' && (
            <>
              <p className="text-sm text-gray-600"><b className="font-semibold tabular-nums text-gray-950">{pages}쪽</b> · 작품 {works}점 · {sizeLabel}</p>

              {inApp && (
                <Notice className="mt-3">
                  {inApp} 안에서 열린 화면에서는 파일 저장이 막힐 수 있어요. 저장이 안 되면 오른쪽 위 메뉴에서 <b className="font-medium text-gray-900">다른 브라우저로 열기</b>를 눌러 주세요.
                </Notice>
              )}

              <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3" data-testid="printed-info">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-950">이렇게 실립니다</p>
                  <button type="button" onClick={onEditInfo} className="-mr-1 inline-flex min-h-[40px] min-w-[44px] items-center justify-center px-1 text-sm text-gray-700 underline underline-offset-4 hover:text-gray-950">고치기</button>
                </div>
                <dl className="mt-1 space-y-1.5 text-sm">
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 text-gray-500">이름</dt>
                    <dd className="min-w-0 break-all text-gray-900">{info.name}{info.canChooseName && <span className="text-gray-500"> ({design.nameSource === 'nickname' ? '닉네임' : '실명'})</span>}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 text-gray-500">마지막 장</dt>
                    <dd className="min-w-0 break-keep text-gray-900">{info.printedText || <span className="text-gray-500">연락처를 싣지 않습니다</span>}</dd>
                  </div>
                </dl>
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={alsoUpload} onChange={(e) => setAlsoUpload(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-gray-900" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-950">내 홈페이지 [포트폴리오] 탭에도 올리기</span>
                  <span className="mt-0.5 block break-keep text-xs leading-relaxed text-gray-500">
                    방문자 누구나 볼 수 있고{info.printedText ? ', 마지막 장의 연락처도 함께 공개됩니다' : ''}. 다음 지원서에는 이 파일이 자동으로 붙어요.
                    {currentFileUrl && <span className="text-gray-700"> 지금 올려 둔 파일은 이 PDF 로 바뀝니다.</span>}
                  </span>
                </span>
              </label>

              <button type="button" onClick={download} className={cn(primary, 'mt-5')}>
                <FileDown size={17} aria-hidden /> PDF 내려받기
              </button>

              <Disclosure variant="link" title="다른 형식으로 저장" className="mt-3">
                <div className="space-y-4 pb-1">
                  <div>
                    <p className="text-sm font-medium text-gray-950">글자가 살아 있는 PDF</p>
                    <p className="mt-0.5 break-keep text-xs leading-relaxed text-gray-500">글자를 선택·검색할 수 있고 용량이 더 작습니다. 인쇄 창을 거쳐 저장합니다.</p>
                    <ol className="mt-2 space-y-1 text-xs text-gray-700">
                      <li>1. 아래 버튼을 누르면 <b className="font-medium">인쇄 창</b>이 열립니다.</li>
                      <li>2. 대상(프린터)을 <b className="font-medium">'PDF로 저장'</b>으로 바꿉니다.</li>
                      <li>3. [저장]을 누릅니다.</li>
                    </ol>
                    <button type="button" onClick={print} className={cn(secondary, 'mt-2.5')}>인쇄 창 열기</button>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-950">파워포인트(PPT)</p>
                    <p className="mt-0.5 break-keep text-xs leading-relaxed text-gray-500">파워포인트에서 글과 사진을 하나씩 고칠 수 있습니다.</p>
                    <button type="button" onClick={pptx} className={cn(secondary, 'mt-2.5')}>PPT 내려받기</button>
                  </div>
                </div>
              </Disclosure>
            </>
          )}

          {stage.kind === 'working' && (
            <div className="py-6" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-medium text-gray-950"><Loader2 size={16} className="animate-spin" aria-hidden /> {stage.label}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                <div className="h-full rounded-full bg-gray-900 transition-[width] duration-200" style={{ width: `${Math.max(3, Math.min(100, stage.percent))}%` }} />
              </div>
              <p className="mt-3 break-keep text-xs leading-relaxed text-gray-500">
                이 창을 닫지 말고 기다려 주세요. 작품이 많거나 휴대폰이면 1분쯤 걸릴 수 있어요.
              </p>
            </div>
          )}

          {stage.kind === 'error' && (
            <div className="py-4">
              <Notice tone="attention" title="저장하지 못했어요">{stage.message}</Notice>
              <button type="button" onClick={() => setStage({ kind: 'ready' })} className={cn(secondary, 'mt-4')}>다시 시도</button>
            </div>
          )}

          {stage.kind === 'done' && stage.method === 'download' && (
            <div className="py-2" data-testid="save-result">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-gray-950"><CheckCircle2 size={18} aria-hidden /> PDF 를 저장했습니다</p>
              <p className="mt-1.5 break-all text-sm text-gray-600">{stage.fileName} · <span className="tabular-nums">{stage.pages}쪽 · {formatMB(stage.bytes)}</span></p>
              {stage.lowered && !stage.overBudget && <p className="mt-1 break-keep text-xs text-gray-500">공모 파일 한도(10MB)에 맞춰 화질을 조금 낮췄습니다.</p>}
              <p className="mt-1 break-keep text-xs text-gray-500">파일이 안 보이면 브라우저의 '다운로드' 목록을 확인해 주세요.</p>
              <button type="button" onClick={() => { const m = made.current; if (m) saveBlob(m.blob, m.fileName); }} className="inline-flex min-h-[40px] items-center text-sm text-gray-800 underline underline-offset-4 hover:text-gray-950">다시 내려받기</button>
              {stage.overBudget && (
                <Notice tone="attention" title={`파일이 10MB 를 넘습니다 (${formatMB(stage.bytes)})`} className="mt-3"
                  action={<button type="button" onClick={onPickWorks} className={secondary}>작품 고르기</button>}>
                  용량 제한이 있는 곳에 내려면 작품 수를 줄여 다시 저장해 주세요.
                </Notice>
              )}
              {missingNote(stage.missing)}
              {stage.upload === 'yes' && <p className="mt-3 text-sm text-gray-900">내 홈페이지 [포트폴리오] 탭에 올렸습니다.</p>}
              {stage.upload === 'skipped-missing' && <p className="mt-3 break-keep text-sm text-gray-700">빈 칸이 있어 홈페이지에는 올리지 않았습니다.</p>}
              {stage.upload === 'skipped-large' && <p className="mt-3 break-keep text-sm text-gray-700">파일이 20MB 를 넘어 홈페이지에는 올리지 못했습니다.</p>}
              {stage.upload === 'failed' && (
                <Notice tone="attention" title="홈페이지에는 올리지 못했어요" className="mt-3"
                  action={<button type="button" onClick={retryUpload} className={secondary}>다시 올리기</button>}>
                  파일은 내려받았습니다.
                </Notice>
              )}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                {stage.upload === 'yes' && <Link to={`${homePath}?tab=file`} className={secondary}>내 홈페이지에서 보기</Link>}
                <Link to="/exhibitions" className={secondary}>모집공고 보러 가기</Link>
                <button type="button" onClick={onClose} className="ml-auto min-h-[44px] px-3 text-sm text-gray-600 hover:text-gray-950">닫기</button>
              </div>
            </div>
          )}

          {stage.kind === 'done' && stage.method === 'print' && (
            <div className="py-2" data-testid="save-result">
              {stage.opened ? (
                <>
                  <p className="text-[15px] font-semibold text-gray-950">인쇄 창을 열었습니다</p>
                  <p className="mt-1.5 break-keep text-sm leading-relaxed text-gray-600">
                    인쇄 창의 대상(프린터)에서 <b className="font-medium text-gray-900">'PDF로 저장'</b>을 고르고 [저장]을 누르면 {stage.pages}쪽짜리 PDF 가 저장됩니다.
                  </p>
                </>
              ) : (
                <Notice tone="attention" title="이 브라우저에서는 인쇄 창이 열리지 않았어요">
                  [PDF 내려받기] 로 저장해 주세요 — 파일이 바로 내려받아집니다.
                </Notice>
              )}
              {missingNote(stage.missing)}
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => setStage({ kind: 'ready' })} className={secondary}>{stage.opened ? '다른 방법으로 저장' : 'PDF 내려받기로'}</button>
                <button type="button" onClick={onClose} className="ml-auto min-h-[44px] px-3 text-sm text-gray-600 hover:text-gray-950">닫기</button>
              </div>
            </div>
          )}

          {stage.kind === 'done' && stage.method === 'pptx' && (
            <div className="py-2" data-testid="save-result">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-gray-950"><CheckCircle2 size={18} aria-hidden /> PPT 를 저장했습니다</p>
              <p className="mt-1.5 break-keep text-sm text-gray-600">{stage.pages}쪽 · 파워포인트에서 열어 고칠 수 있습니다.</p>
              {missingNote(stage.missing)}
              <div className="mt-5 flex">
                <button type="button" onClick={onClose} className="ml-auto min-h-[44px] px-3 text-sm text-gray-600 hover:text-gray-950">닫기</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
