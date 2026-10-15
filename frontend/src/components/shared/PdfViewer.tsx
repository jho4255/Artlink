import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { formatBytes, pagesInView, pdfCanvasSize, pdfPageBox, pdfPageWidth, pdfZoomStep } from '@/lib/portfolioFile';

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
 *
 * ## 화질 (2026-10-15, "홈페이지에서 포트폴리오를 보면 화질이 깨진다 · 글자가 뭉개지고 흐리다")
 * - ⚠️⚠️ **가장 큰 원인은 쪽을 작게 놓은 것이었다.** 예전엔 '한 쪽이 한 화면에' 들어오게 높이에 맞춰 PC 에서 A4 세로가 640px —
 *   10pt 본문이 7px 남짓이라 보통 모니터(기기 배율 1)에서 뭉개졌다. 그리기 자체는 정확했다(같은 크기로 PyMuPDF 가 그린 것과 같다).
 *   지금은 폭에 맞추고(`pdfPageWidth`, 크롬 PDF 보기와 같다) 글자가 사이트 본문(16px)보다 커지지 않게 배율로만 묶는다 → A4 세로 1000px.
 * - **기기 배율 그대로(최대 3배) 그린다.** 예전엔 2배로 묶어 3배 화면(아이폰·갤럭시)에서 1.5배 늘려 보였다.
 * - **확대하면 다시 그린다.** 휴대폰에서 A4 한 쪽은 폭 340px 남짓이라 글자가 6px 쯤이고, 읽으려면 손가락으로 확대한다 —
 *   예전엔 그때 이미 그린 그림을 늘리기만 해서 흐려지고 깨졌다. 지금은 확대가 멈추면(0.25초) 보이는 쪽(최대 둘)만
 *   그 배율로 다시 그린다(`pdfZoomStep` 계단 · 확대 중 픽셀 상한 12M). 줄이면 평소 해상도로 돌아가 메모리를 돌려준다.
 *   PC 의 Ctrl+확대(기기 배율이 바뀐다)도 다시 그린다 — 예전엔 쪽 폭이 그대로면(640px 하한) 다시 그리지 않았다.
 * - **다 그린 뒤에 바꾼다.** 다시 그리는 동안 옛 그림이 그대로 보인다(캔버스를 손으로 갈아 끼운다 — 아래 `slot`).
 * - 그래도 **PDF 자체의 해상도보다 선명해지지는 않는다** — 쪽마다 사진 한 장인 PDF(우리 [PDF 내려받기]도 그렇다)는 그 사진의 픽셀이 끝이다.
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

/** 기기 배율 — PC 에서 Ctrl+확대·축소하면 바뀐다(`resolution` 미디어 쿼리가 알려 준다) */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(window.devicePixelRatio || 1);
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener?.(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener?.(on); };
  }, [dpr]);
  return dpr;
}


/**
 * 손가락·트랙패드로 확대한 배율(계단)과 그때 **선명하게 다시 그릴 쪽**(지금 보이는 쪽, 최대 둘).
 * 확대가 **멈춘 뒤**(0.25초)에만 잰다 — 손가락을 움직이는 동안 다시 그리면 버벅인다. 평소(1배)에는 스크롤해도 아무 일도 안 한다.
 * 확대한 채로 움직이면(옆 쪽으로 넘어가면) 다시 재서 그 쪽을 선명하게 그린다.
 */
function useVisualZoom(listRef: React.RefObject<HTMLDivElement | null>): { zoom: number; pages: ReadonlySet<number> } {
  const [v, setV] = useState<{ zoom: number; pages: ReadonlySet<number> }>({ zoom: 1, pages: NO_PAGES });
  useEffect(() => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (!vv) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const zoom = pdfZoomStep(vv.scale);
        const list = listRef.current;
        let pick: number[] = [];
        if (zoom > 1 && list) {
          const pages = [...list.querySelectorAll<HTMLElement>('[data-pdf-page]')].map((el) => {
            const r = el.getBoundingClientRect();
            return { n: Number(el.dataset.pdfPage), r: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
          });
          pick = pagesInView(pages, { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height });
        }
        setV((prev) => (prev.zoom === zoom && pick.length === prev.pages.size && pick.every((n) => prev.pages.has(n))
          ? prev
          : { zoom, pages: pick.length ? new Set(pick) : NO_PAGES }));
      }, 250);
    };
    vv.addEventListener('resize', settle);
    vv.addEventListener('scroll', settle);
    window.addEventListener('scroll', settle, { passive: true });
    return () => {
      vv.removeEventListener('resize', settle);
      vv.removeEventListener('scroll', settle);
      window.removeEventListener('scroll', settle);
      clearTimeout(t);
    };
  }, [listRef]);
  return v;
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

/** 캔버스 메모리를 바로 돌려준다(iOS 는 떼어 낸 캔버스도 한동안 메모리를 쥐고 있다) */
const release = (cv: HTMLCanvasElement | null | undefined) => { if (cv) { cv.width = 0; cv.height = 0; } };

function PdfPage({ doc, pageNo, size, cssWidth, total, dpr, zoom }: {
  doc: PDFDocumentProxy; pageNo: number; size: PageSize; cssWidth: number; total: number;
  /** 기기 배율 */
  dpr: number;
  /** 이 쪽을 다시 그릴 확대 배율 — 지금 보이는 쪽만 1보다 크다(`PdfViewer` 가 고른다) */
  zoom: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  /** 쪽 상자(CSS px) — 기기 배율을 곱하면 정수 픽셀이 되게 맞춘다(pdfPageBox) */
  const { w: boxW, h: boxH } = pdfPageBox({ cssWidth, pageWidthPt: size.w, pageHeightPt: size.h, dpr });
  /**
   * 캔버스를 **손으로** 넣고 빼는 빈 칸 — React 는 여기에 자식을 그리지 않는다.
   * 다시 그릴 때 새 캔버스에 다 그린 다음 바꿔 끼운다: 한 캔버스에 다시 그리면 그리는 동안(큰 쪽은 몇 초) 빈 판이 보인다.
   */
  const slot = useRef<HTMLDivElement>(null);
  // IntersectionObserver 가 없는 옛 브라우저는 전부 그린다(메모리 절약보다 보이는 게 먼저)
  const [near, setNear] = useState(() => pageNo <= 2 || typeof IntersectionObserver === 'undefined');
  /** 칸에 캔버스가 있는가 — 없을 때만 '그리는 중' 을 띄운다(다시 그릴 때는 옛 그림이 그대로 보인다) */
  const [hasCanvas, setHasCanvas] = useState(false);

  /*
   * ⚠️ 캔버스를 **기기 픽셀 경계**에 맞춘다(2026-10-15). 쪽을 가운데 정렬하면 1.25·1.5·1.75 배 화면(윈도 노트북)에서
   *    왼쪽 끝이 337.5 같은 반 픽셀에 떨어지고, 그러면 브라우저가 캔버스 전체를 반 칸씩 섞어(보간) 찍어 글자가 흐려졌다
   *    (실측: 크기를 맞춘 뒤에도 화면 ↔ 캔버스 평균 차이 2.2 → 이걸로 0). 문서 좌표 기준으로 남는 소수만큼 1px 미만으로 옮긴다.
   *    스크롤은 브라우저가 기기 픽셀 단위로 하므로 문서 좌표만 맞으면 된다.
   */
  useLayoutEffect(() => {
    const s = slot.current;
    if (!s) return;
    const snap = () => {
      s.style.transform = '';
      const r = s.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      // 크롬은 소수 CSS 위치를 **CSS px 로 반올림한 뒤** 배율을 곱한다(1배 화면의 140.5 는 141 로 맞춰 찍지만, 1.5배의 141 → 211.5 는 그대로).
      // 그래서 반올림된 CSS 위치에 배율을 곱해 남는 소수만 옮긴다 — 1·2·3배 화면은 늘 0 이라 아무것도 안 한다.
      const nx = Math.round(r.left + window.scrollX) * d, ny = Math.round(r.top + window.scrollY) * d;
      const dx = Math.round(nx) - nx, dy = Math.round(ny) - ny;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) s.style.transform = `translate(${dx / d}px, ${dy / d}px)`;
    };
    snap();
    window.addEventListener('resize', snap);
    return () => window.removeEventListener('resize', snap);
  }, [boxW, boxH, dpr, hasCanvas, near]);

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // 앞뒤로 화면 1.5개만큼 미리 그리고, 그보다 멀어지면 캔버스를 떼어 메모리를 돌려준다 — 자리(높이)는 바깥 div 가 지킨다
    const io = new IntersectionObserver(([e]) => {
      const isNear = e!.isIntersecting;
      setNear(isNear);
      if (isNear) return;
      const s = slot.current;
      if (s?.firstElementChild) { release(s.firstElementChild as HTMLCanvasElement); s.replaceChildren(); }
      setHasCanvas(false);
    }, { rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const s = slot.current;
    if (!s || !near || boxW <= 0) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const next = document.createElement('canvas');
    next.className = 'block h-full w-full';
    next.setAttribute('role', 'img');
    next.setAttribute('aria-label', `${pageNo}쪽`);
    doc.getPage(pageNo).then((page) => {
      if (cancelled) return;
      // 캔버스 픽셀 = 상자 × 배율(정수로 떨어지게 잡아 둔 상자) — 1px 만 어긋나도 쪽 전체가 보간돼 흐려진다(pdfPageBox)
      const px = pdfCanvasSize({ w: boxW, h: boxH }, size, dpr, zoom);
      if (!px.w || !px.h) return;
      const vp = page.getViewport({ scale: px.scale });
      next.width = px.w;
      next.height = px.h;
      next.dataset.zoom = String(zoom);   // 하니스·E2E 가 '확대해서 다시 그렸는가'를 본다
      task = page.render({ canvas: next, viewport: vp });
      return task.promise.then(() => {
        if (cancelled) return;
        const old = s.firstElementChild as HTMLCanvasElement | null;
        s.replaceChildren(next);
        if (old && old !== next) release(old);
        setHasCanvas(true);
      });
    }).catch((e: { name?: string }) => {
      if (e?.name !== 'RenderingCancelledException') console.warn('[PdfViewer] 쪽을 그리지 못했습니다', pageNo, e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      if (!next.isConnected) release(next);   // 끝까지 못 그린 새 캔버스만 버린다 — 바꿔 끼운 건 지금 보이는 그림이다
    };
  }, [near, boxW, boxH, dpr, zoom, doc, pageNo, size]);

  return (
    <figure className="flex flex-col items-center" data-pdf-page={pageNo}>
      <div
        ref={holder}
        className={`relative border ${hasCanvas ? '' : 'bg-current/5'}`}
        style={{ ...LINE, width: boxW, height: boxH, boxSizing: 'content-box' }}
      >
        <div ref={slot} className="h-full w-full" />
        {/* 큰 사진이 든 쪽은 푸는 데 10초 넘게 걸린다(실서버 실측: 1500×14045px 사진 28장이 든 한 쪽 14초) — 빈 회색 판만 두면 고장으로 보인다.
            쪽이 아주 길 수 있어 가운데가 아니라 위쪽에 둔다 */}
        {!hasCanvas && near && (
          <span className="pointer-events-none absolute inset-x-0 top-10 text-center text-[12px]" style={SUB}>{pageNo}쪽 그리는 중…</span>
        )}
      </div>
      <figcaption className="mt-2 text-[11px] tabular-nums" style={SUB}>{pageNo} / {total}</figcaption>
    </figure>
  );
}

const NO_PAGES: ReadonlySet<number> = new Set();

/** ⚠️ 부르는 쪽은 `key={url}` 를 줄 것 — 파일을 바꾸면 처음(불러오는 중)부터 다시 시작해야 한다 */
export default function PdfViewer({ url, compact = false }: { url: string; compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading', loaded: 0, total: 0 });
  const [ref, containerWidth] = useWidth<HTMLDivElement>();
  const dpr = useDevicePixelRatio();
  const listRef = useRef<HTMLDivElement>(null);
  /** 확대 배율과 그때 선명하게 다시 그릴 쪽 — 확대하지 않았으면 비어 있다 */
  const { zoom, pages: zoomPages } = useVisualZoom(listRef);

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
        <div ref={listRef} className={`flex flex-col ${compact ? 'gap-5' : 'gap-8'}`}>
          {state.sizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={state.doc}
              pageNo={i + 1}
              size={size}
              total={state.sizes.length}
              dpr={dpr}
              zoom={zoomPages.has(i + 1) ? zoom : 1}
              cssWidth={pdfPageWidth({
                // 테두리 1px × 2 를 빼 둔다 — 안 빼면 휴대폰에서 쪽이 컨테이너를 2px 넘어 페이지가 가로로 밀린다
                containerWidth: Math.max(0, containerWidth - 2),
                pageWidthPt: size.w,
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
