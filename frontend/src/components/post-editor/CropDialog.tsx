import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RotateCcw, RotateCw } from 'lucide-react';
import { fetchImageOnce } from '@/lib/imageFetch';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * 사진 자르기·돌리기 (2026-11-13) — 이미 올린 사진을 다시 받아 캔버스에서 자르고, **새 파일로** 올린다(원본 파일은 건드리지 않는다).
 * - R2 사진은 `fetchImageOnce`(규칙 16 — 평범한 <img> 캐시 때문에 CORS fetch 가 막히는 함정, 그리고 결과를 쥐지 않는다).
 * - 비율: 자유 · 1:1 · 4:5 · 3:2 · 16:9. 돌리기 90°. 결과는 JPEG 0.9, 긴 변 2000px.
 * - 손가락·마우스 모두 포인터 이벤트 — 네 귀퉁이를 끌면 크기, 안쪽을 끌면 옮긴다. 이 칸 안에서는 화면이 밀리지 않는다(touch-action:none).
 * - ⚠️ 원본 주소를 문서에 남기지 않는다(얼굴·주소를 잘라 낸 사람의 원본이 공개 JSON 으로 샌다). 되돌리기는 편집기의 실행 취소.
 */
type Ratio = 'free' | '1:1' | '4:5' | '3:2' | '16:9';
const RATIOS: [Ratio, string, number | null][] = [['free', '자유', null], ['1:1', '1:1', 1], ['4:5', '4:5', 4 / 5], ['3:2', '3:2', 3 / 2], ['16:9', '16:9', 16 / 9]];
const OUT_MAX = 2000;
const WORK_MAX = 2400;
interface Rect { x: number; y: number; w: number; h: number }

export default function CropDialog({ src, onDone, onClose }: { src: string; onDone: (file: File) => void; onClose: () => void }) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [ratio, setRatio] = useState<Ratio>('free');
  const [rect, setRect] = useState<Rect | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const source = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);

  // 1) 사진 받기
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    (async () => {
      const got = src.startsWith('/') && !src.startsWith('//')
        ? await fetch(src, { cache: 'reload' }).then(async (r) => (r.ok ? { blob: await r.blob() } : null)).catch(() => null)
        : await fetchImageOnce(src);
      if (!alive) return;
      if (!got) { setFailed(true); return; }
      objUrl = URL.createObjectURL(got.blob);
      const img = new Image();
      img.onload = () => { if (alive) { source.current = img; setRotation(0); drawBase(img, 0); } };
      img.onerror = () => { if (alive) setFailed(true); };
      img.src = objUrl;
    })();
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  /** 돌린 사진을 작업 캔버스로(메모리를 묶으려고 긴 변 2400px) */
  const drawBase = useCallback((img: HTMLImageElement, rot: number) => {
    const turn = rot % 180 !== 0;
    const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const iw = Math.round(img.naturalWidth * scale), ih = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = turn ? ih : iw;
    c.height = turn ? iw : ih;
    const ctx = c.getContext('2d');
    if (!ctx) { setFailed(true); return; }
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    setBase(c);
    setRect({ x: 0, y: 0, w: c.width, h: c.height });
  }, []);

  // 2) 보이는 칸 크기
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 3) 작업 캔버스를 화면에 붙인다
  useEffect(() => {
    const host = canvasHost.current;
    if (!host || !base) return;
    host.replaceChildren(base);
    base.style.width = '100%';
    base.style.height = '100%';
    base.style.display = 'block';
  }, [base]);

  const scale = base && box.w && box.h ? Math.min((box.w - 24) / base.width, (box.h - 24) / base.height, 1.5) : 0;
  const dispW = base ? base.width * scale : 0;
  const dispH = base ? base.height * scale : 0;

  /** 비율을 고르면 가운데에서 가장 큰 칸 */
  const applyRatio = (r: Ratio) => {
    setRatio(r);
    if (!base) return;
    const want = RATIOS.find((x) => x[0] === r)![2];
    if (!want) { setRect({ x: 0, y: 0, w: base.width, h: base.height }); return; }
    let w = base.width, h = w / want;
    if (h > base.height) { h = base.height; w = h * want; }
    setRect({ x: (base.width - w) / 2, y: (base.height - h) / 2, w, h });
  };

  const rotate = (dir: 1 | -1) => {
    const img = source.current;
    if (!img) return;
    const next = (rotation + dir * 90 + 360) % 360;
    setRotation(next);
    drawBase(img, next);
    setRatio('free');
  };

  // 4) 끌기 — 귀퉁이(크기)·안쪽(옮기기)
  const drag = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; start: Rect } | null>(null);
  const onDown = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...rect } };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !base || !scale) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    const s = d.start;
    const min = Math.max(24, Math.min(base.width, base.height) * 0.06);
    const want = RATIOS.find((x) => x[0] === ratio)![2];
    if (d.mode === 'move') {
      setRect({ ...s, x: clamp(s.x + dx, 0, base.width - s.w), y: clamp(s.y + dy, 0, base.height - s.h) });
      return;
    }
    // 고정점 = 반대 귀퉁이
    const fx = d.mode.includes('w') ? s.x + s.w : s.x;
    const fy = d.mode.includes('n') ? s.y + s.h : s.y;
    let px = (d.mode.includes('w') ? s.x : s.x + s.w) + dx;
    let py = (d.mode.includes('n') ? s.y : s.y + s.h) + dy;
    px = clamp(px, 0, base.width);
    py = clamp(py, 0, base.height);
    let w = Math.max(min, Math.abs(px - fx));
    let h = Math.max(min, Math.abs(py - fy));
    if (want) {
      // 비율 고정 — 큰 쪽을 따르고, 칸 밖으로 나가면 줄인다
      if (w / h > want) h = w / want; else w = h * want;
      const maxW = d.mode.includes('w') ? fx : base.width - fx;
      const maxH = d.mode.includes('n') ? fy : base.height - fy;
      if (w > maxW) { w = maxW; h = w / want; }
      if (h > maxH) { h = maxH; w = h * want; }
    }
    const x = d.mode.includes('w') ? fx - w : fx;
    const y = d.mode.includes('n') ? fy - h : fy;
    setRect({ x, y, w, h });
  };
  const onUp = () => { drag.current = null; };

  const finish = async () => {
    if (!base || !rect || busy) return;
    setBusy(true);
    try {
      const k = Math.min(1, OUT_MAX / Math.max(rect.w, rect.h));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(rect.w * k));
      out.height = Math.max(1, Math.round(rect.h * k));
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(base, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error('blob');
      onDone(new File([blob], `crop-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const unchanged = !!base && !!rect && rotation === 0 && rect.x === 0 && rect.y === 0 && Math.round(rect.w) === base.width && Math.round(rect.h) === base.height;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="사진 자르기" className="fixed inset-0 z-[95] flex flex-col bg-gray-950 text-white">
      <header className="flex h-14 shrink-0 items-center justify-between px-2">
        <button type="button" onClick={onClose} className="h-11 px-3 text-[15px] text-gray-200">취소</button>
        <span className="text-[16px] font-semibold">자르기</span>
        <button type="button" onClick={finish} disabled={!base || busy || unchanged} className="inline-flex h-11 items-center gap-1.5 px-3 text-[15px] font-semibold disabled:opacity-40">
          {busy && <Loader2 size={15} className="animate-spin" />}완료
        </button>
      </header>
      <div ref={stage} className="relative min-h-0 flex-1 select-none [touch-action:none]" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {failed ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-300">사진을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>
        ) : !base ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-300"><Loader2 size={18} className="mr-2 animate-spin" />사진을 불러오는 중…</p>
        ) : (
          <div className="absolute" style={{ width: dispW, height: dispH, left: (box.w - dispW) / 2, top: (box.h - dispH) / 2 }}>
            <div ref={canvasHost} className="h-full w-full opacity-40" />
            {rect && (
              <div
                className="absolute cursor-move outline outline-1 outline-white/90"
                style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale, boxShadow: '0 0 0 9999px rgba(3,7,18,0.55)' }}
                onPointerDown={onDown('move')}
              >
                <CropPreview base={base} rect={rect} />
                {/* 3분할 선 */}
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/45" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/45" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/45" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/45" />
                {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                  <span
                    key={c}
                    role="presentation"
                    onPointerDown={onDown(c)}
                    className="absolute h-11 w-11"
                    style={{ left: c.includes('w') ? -22 : undefined, right: c.includes('e') ? -22 : undefined, top: c.includes('n') ? -22 : undefined, bottom: c.includes('s') ? -22 : undefined, cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                  >
                    <span
                      className="absolute h-[22px] w-[22px] border-white"
                      style={{
                        left: c.includes('w') ? 19 : undefined, right: c.includes('e') ? 19 : undefined,
                        top: c.includes('n') ? 19 : undefined, bottom: c.includes('s') ? 19 : undefined,
                        borderTopWidth: c.includes('n') ? 3 : 0, borderBottomWidth: c.includes('s') ? 3 : 0,
                        borderLeftWidth: c.includes('w') ? 3 : 0, borderRightWidth: c.includes('e') ? 3 : 0,
                      }}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div role="radiogroup" aria-label="비율" className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-3 scrollbar-hide">
        {RATIOS.map(([r, name]) => (
          <button key={r} type="button" role="radio" aria-checked={ratio === r} onClick={() => applyRatio(r)} disabled={!base}
            className={`h-10 shrink-0 rounded-full border px-4 text-sm font-medium ${ratio === r ? 'border-white bg-white text-gray-900' : 'border-gray-600 text-gray-200'}`}>
            {name}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        <button type="button" onClick={() => rotate(-1)} disabled={!base} className="inline-flex h-12 items-center gap-2 px-3 text-sm text-gray-200 disabled:opacity-40"><RotateCcw size={19} />왼쪽으로</button>
        <button type="button" onClick={() => rotate(1)} disabled={!base} className="inline-flex h-12 items-center gap-2 px-3 text-sm text-gray-200 disabled:opacity-40"><RotateCw size={19} />오른쪽으로</button>
        <span className="flex-1" />
        <button type="button" onClick={() => { const img = source.current; if (img) { setRotation(0); drawBase(img, 0); setRatio('free'); } }} disabled={!base}
          className="h-12 px-3 text-sm text-gray-300 underline underline-offset-4 disabled:opacity-40">원래대로</button>
      </div>
    </div>,
    document.body,
  );
}

/** 자를 칸 안은 밝게 — 같은 캔버스를 칸 크기로 다시 그린다 */
function CropPreview({ base, rect }: { base: HTMLCanvasElement; rect: Rect }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.max(1, Math.min(1200, Math.round(rect.w)));
    const h = Math.max(1, Math.round(w * (rect.h / rect.w)));
    c.width = w;
    c.height = h;
    c.getContext('2d')?.drawImage(base, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  }, [base, rect]);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
