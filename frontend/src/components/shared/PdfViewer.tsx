import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { formatBytes, pdfPageWidth, pdfRenderScale } from '@/lib/portfolioFile';

/**
 * 포트폴리오 PDF 를 **페이지 안에서** 한 쪽씩 펼쳐 보인다 (작가 홈페이지 [포트폴리오] 탭, 2026-09-25).
 *
 * 왜 `<iframe src=pdf>` 가 아니라 pdf.js 인가 — 방문자 대부분이 인스타 링크를 타고 **휴대폰**으로 온다.
 * 안드로이드 크롬은 iframe 안의 PDF 를 아예 안 그리고(내려받기로 넘어간다), iOS 사파리는 첫 쪽만 그림처럼 보인다.
 * 그러면 "내려받지 않고 페이지에서 보여준다"는 약속이 휴대폰에서 통째로 깨진다. pdf.js 는 어디서나 같은 모양이다.
 *
 * - **이 파일은 탭을 열 때만 받는다**(`HomepageView` 가 `lazy` 로 부른다) — pdf.js 는 본체 0.5MB + 워커 1.3MB 다.
 *   작품만 보고 나가는 방문자에게 그 무게를 지우지 않는다.
 * - legacy 빌드를 쓴다 — 인스타·카톡 인앱 브라우저는 OS 가 오래돼 최신 문법이 없는 경우가 있다.
 * - ⚠️ **PDF 를 우리가 직접 받아 bytes 로 넘긴다**(pdf.js 에 url 을 주지 않는다). CLAUDE.md 16번과 같은 함정 —
 *   예전의 [파일 보기] 링크로 같은 파일을 한 번 연 브라우저엔 **CORS 정보 없는 캐시**가 남아 있어, CORS 로 다시 받으면
 *   그 캐시를 재사용하다 막힌다. 그래서 평소처럼 받아 보고, 실패하면 `cache: 'reload'` 로 한 번 더 받는다.
 *   덕분에 진행률(몇 MB 중 몇 MB)도 보여 줄 수 있다.
 * - ⚠️ **화면에서 멀어진 쪽의 캔버스는 비운다.** 60쪽짜리를 전부 2배로 그려 두면 iOS 에서 캔버스 메모리가 넘쳐
 *   뒤쪽이 흰 판으로 나온다. 자리(높이)는 그대로 두므로 스크롤이 튀지 않는다.
 * - 링크·주석·폼은 그리지 않는다(캔버스만) — PDF 안의 스크립트가 돌 자리가 없다.
 */

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  }).catch((e) => {
    pdfjsPromise = null; // 청크를 못 받았으면(배포 직후 등) 다음에 다시 시도할 수 있게
    throw e;
  });
  return pdfjsPromise;
}

/** 받기 — 진행률을 알린다. 실패하면 캐시를 우회해 한 번 더(위 ⚠️ 참고) */
async function fetchPdfBytes(url: string, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    if (signal.aborted) throw e;
    res = await fetch(url, { signal, cache: 'reload' });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

type PageSize = { w: number; h: number };
type State =
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'ready'; doc: PDFDocumentProxy; sizes: PageSize[]; bytes: number }
  | { kind: 'error'; reason: 'password' | 'failed' };

const SUB: CSSProperties = { color: 'var(--hp-sub)' };
const LINE: CSSProperties = { borderColor: 'var(--hp-line)' };

/** 화면 높이 — 휴대폰 주소창이 들어갔다 나올 때(수십 px)마다 전 쪽을 다시 그리지 않게, 크게 바뀔 때만 갱신 */
function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => setH((prev) => (Math.abs(window.innerHeight - prev) > 120 ? window.innerHeight : prev)), 200);
    };
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); clearTimeout(t); };
  }, []);
  return h;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function PdfPage({ doc, pageNo, size, cssWidth, total }: { doc: PDFDocumentProxy; pageNo: number; size: PageSize; cssWidth: number; total: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // IntersectionObserver 가 없는 옛 브라우저는 전부 그린다(메모리 절약보다 보이는 게 먼저)
  const [near, setNear] = useState(() => pageNo <= 2 || typeof IntersectionObserver === 'undefined');
  /** 마지막으로 다 그린 폭 — 지금 폭과 같고 화면 근처일 때만 '그려져 있다' */
  const [drawnWidth, setDrawnWidth] = useState(0);
  const drawn = near && drawnWidth === cssWidth;

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // 앞뒤로 화면 1.5개만큼 미리 그리고, 그보다 멀어지면 비운다
    const io = new IntersectionObserver(([e]) => setNear(e!.isIntersecting), { rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (!near || cssWidth <= 0) {
      cv.width = 0; cv.height = 0; // 메모리 반납 — 자리는 바깥 div 가 지킨다
      return;
    }
    let task: RenderTask | null = null;
    let cancelled = false;
    doc.getPage(pageNo).then((page) => {
      if (cancelled) return;
      const scale = pdfRenderScale({ cssWidth, pageWidthPt: size.w, pageHeightPt: size.h, dpr: window.devicePixelRatio });
      const vp = page.getViewport({ scale });
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      task = page.render({ canvas: cv, viewport: vp });
      return task.promise.then(() => { if (!cancelled) setDrawnWidth(cssWidth); });
    }).catch((e: { name?: string }) => {
      if (e?.name !== 'RenderingCancelledException') console.warn('[PdfViewer] 쪽을 그리지 못했습니다', pageNo, e);
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [near, cssWidth, doc, pageNo, size.w, size.h]);

  const cssHeight = cssWidth > 0 ? Math.round((cssWidth * size.h) / size.w) : 0;
  return (
    <figure className="flex flex-col items-center" data-pdf-page={pageNo}>
      <div
        ref={holder}
        className={`relative border ${drawn ? '' : 'bg-current/5'}`}
        style={{ ...LINE, width: cssWidth, height: cssHeight, boxSizing: 'content-box' }}
      >
        <canvas ref={canvas} className="block h-full w-full" aria-label={`${pageNo}쪽`} role="img" />
        {/* 큰 사진이 든 쪽은 푸는 데 10초 넘게 걸린다(실서버 실측: 1500×14045px 사진 28장이 든 한 쪽 14초) — 빈 회색 판만 두면 고장으로 보인다.
            쪽이 아주 길 수 있어 가운데가 아니라 위쪽에 둔다 */}
        {!drawn && near && (
          <span className="pointer-events-none absolute inset-x-0 top-10 text-center text-[12px]" style={SUB}>{pageNo}쪽 그리는 중…</span>
        )}
      </div>
      <figcaption className="mt-2 text-[11px] tabular-nums" style={SUB}>{pageNo} / {total}</figcaption>
    </figure>
  );
}

/** ⚠️ 부르는 쪽은 `key={url}` 를 줄 것 — 파일을 바꾸면 처음(불러오는 중)부터 다시 시작해야 한다 */
export default function PdfViewer({ url, compact = false }: { url: string; compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading', loaded: 0, total: 0 });
  const [ref, containerWidth] = useWidth<HTMLDivElement>();
  const viewportHeight = useViewportHeight();

  useEffect(() => {
    const ac = new AbortController();
    // v6 부터 문서를 닫는 건 문서가 아니라 로딩 작업(`loadingTask.destroy()`) — 워커와 메모리를 함께 놓는다
    let loading: PDFDocumentLoadingTask | null = null;
    // 주소가 바뀌면 부르는 쪽이 `key={url}` 로 새로 만든다 — 여기서 상태를 되돌리지 않는다
    (async () => {
      const [lib, data] = await Promise.all([
        loadPdfjs(),
        fetchPdfBytes(url, ac.signal, (loaded, total) => {
          if (!ac.signal.aborted) setState({ kind: 'loading', loaded, total });
        }),
      ]);
      if (ac.signal.aborted) return;
      const bytes = data.byteLength; // getDocument 가 버퍼를 워커로 넘기면(transfer) 길이가 0 이 된다 — 먼저 잰다
      // 한글 글꼴을 심지 않은 PDF 를 위한 CMap·표준 글꼴은 필요할 때만 받는다(CDN, 버전 고정)
      const cdn = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${lib.version}/`;
      loading = lib.getDocument({
        data,
        cMapUrl: `${cdn}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${cdn}standard_fonts/`,
        wasmUrl: `${cdn}wasm/`,
        iccUrl: `${cdn}iccs/`,
      });
      const doc = await loading.promise;
      if (ac.signal.aborted) return;
      const sizes = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) =>
          doc.getPage(i + 1).then((p) => {
            const v = p.getViewport({ scale: 1 });
            return { w: v.width, h: v.height };
          })),
      );
      if (ac.signal.aborted) return;
      setState({ kind: 'ready', doc, sizes, bytes });
    })().catch((e: { name?: string }) => {
      if (ac.signal.aborted) return;
      console.warn('[PdfViewer] PDF 를 열지 못했습니다', e);
      setState({ kind: 'error', reason: e?.name === 'PasswordException' ? 'password' : 'failed' });
    });
    return () => { ac.abort(); void loading?.destroy(); };
  }, [url]);

  const openLink = (label: string) => (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm underline-offset-4 hover:underline" style={SUB}>
      {label} <ExternalLink size={13} />
    </a>
  );

  return (
    <div ref={ref} className="min-w-0">
      {state.kind === 'ready' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 border-b pb-1" style={LINE}>
          <p className="text-[13px]" style={SUB}>PDF · {state.sizes.length}쪽 · {formatBytes(state.bytes)}</p>
          {openLink('새 창에서 열기')}
        </div>
      )}

      {state.kind === 'loading' && (
        <div className="flex flex-col items-center justify-center gap-3 border py-24" style={LINE}>
          <p className="text-sm" style={SUB}>
            포트폴리오를 불러오는 중{state.total > 0 ? ` · ${formatBytes(state.loaded)} / ${formatBytes(state.total)}` : state.loaded > 0 ? ` · ${formatBytes(state.loaded)}` : ''}
          </p>
          <div className="h-[2px] w-48 overflow-hidden bg-current/10">
            <div
              className="h-full transition-[width] duration-200"
              style={{ width: state.total > 0 ? `${Math.min(100, (state.loaded / state.total) * 100)}%` : '30%', background: 'var(--hp-ink)' }}
            />
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex flex-col items-center justify-center gap-1 border py-16 text-center" style={LINE}>
          <p className="text-sm" style={SUB}>
            {state.reason === 'password' ? '암호가 걸린 PDF 라 여기서 펼쳐 볼 수 없습니다.' : '포트폴리오를 여기서 펼치지 못했습니다.'}
          </p>
          {openLink('파일 열기')}
        </div>
      )}

      {state.kind === 'ready' && (
        <div className={`flex flex-col ${compact ? 'gap-5' : 'gap-8'}`}>
          {state.sizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={state.doc}
              pageNo={i + 1}
              size={size}
              total={state.sizes.length}
              cssWidth={pdfPageWidth({
                // 테두리 1px × 2 를 빼 둔다 — 안 빼면 휴대폰에서 쪽이 컨테이너를 2px 넘어 페이지가 가로로 밀린다
                containerWidth: Math.max(0, containerWidth - 2),
                viewportHeight,
                aspect: size.w / size.h,
                // 편집 미리보기는 폭이 절반이라 높이에 맞추면 너무 작다 — 늘 폭에 맞춘다
                ...(compact ? { minWidth: containerWidth, maxWidth: containerWidth } : {}),
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
