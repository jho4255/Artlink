import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { fetchImageOnce } from '@/lib/imageFetch';
import {
  GL_LOST, WALL_VIEW_URL, WallCache, isUnsupportedReason, readWallMessage, renderRequest,
  wallJobs, wallPrefetchAllowed, wallSourceUrl, wallViewLikelySupported, type WallQuality,
} from '@/lib/wallView';

/**
 * [벽에 걸어 보기] — 작품을 ArtLook 엔진으로 차콜 벽에 오크 플로터·넓은 매트로 걸어 그린 그림을 준다(2026-10-22, CLAUDE.md 규칙 74).
 * 판단(그릴 순서·보관·말 읽기)은 `lib/wallView.ts`, 여기는 iframe 을 띄우고 하나씩 그리는 일만 한다.
 *
 * - 엔진은 화면 밖 iframe(`/artlook/index.html?view=1`)이다. 벽 보기를 켜면(active) 띄우고, 그 전에 **미리 띄워 둘 수 있다**(`warm`) —
 *   ① 작품 창을 열어 사진이 다 뜨면(ArtworkViewer, 2026-10-26 사용자 결정 — 누를 때 받으니 너무 느렸다. 데이터 절약·느린 회선이면 안 한다)
 *   ② [벽에 걸어 보기]에 마우스를 올리거나 누르기 시작하면. warm 은 엔진을 띄우고(벽 사진 1.6MB·오크 플로터 사진 0.8MB를 받고 준비까지)
 *   지금 작품의 초안 사진도 받아 둔다 — 누를 때쯤엔 그리기만 남는다. 홈페이지만 보고 나가는 방문자는 아무것도 받지 않는다.
 *   작품 창이 닫히면(이 훅이 내려가면) iframe 도 걷는다 — ⚠️ 그 뒤에 늦게 온 warm 은 아무것도 하지 않는다(aliveRef, 안 그러면 걷을 사람이 없는 iframe 이 남는다).
 * - **한 번에 하나만**, 지금 작품부터: 초안(t800) → 원본 → 이웃 작품 초안(느린 회선·데이터 절약이면 이웃은 안 그린다).
 *   같은 출처 iframe 은 이 페이지와 같은 스레드라 그리는 동안 화면도 멈춘다(lib/wallView.ts 머리말).
 * - ⚠️ 작품 사진은 엔진이 뜨기를 **기다리지 않고 함께** 받는다 — 순서대로 하면 첫 그림이 사진 받는 시간(실측 0.25초)만큼 늦었다.
 * - 그린 그림은 모듈에 둔다(작품 창을 다시 열면 바로) — 12장을 넘으면 오래된 것부터 놓는다(WallCache).
 * - 못 그린 작품은 이번 방문에서 다시 시도하지 않는다([다시 시도]가 지운다). 이웃 미리 그리기의 실패는 '조용한 실패'라
 *   그 작품으로 넘어가면 한 번 더 해 본다.
 * - WebGL2 가 없는 등 이 브라우저에서 안 되면(`isUnsupportedReason`) 토글을 감춘다 — 다시 띄우지 않는다.
 * - ⚠️ React 개발 모드(StrictMode)는 마운트 때 effect 를 두 번 돌린다. 그래서 '세대'(genRef)로 옛 작업의 결과를 버린다 —
 *   불리언 하나로 막으면 두 번째 마운트가 첫 번째 작업의 실패를 받아 멀쩡한 작품이 '못 그림'이 된다(규칙 61 의 함정과 같은 종류).
 */

/** 엔진이 뜨고 벽 사진(약 1.7MB)·액자 결 텍스처(0.3MB)까지 받는 데 기다리는 시간 */
const BOOT_TIMEOUT_MS = 25_000;
/** 한 장 그리는 데 기다리는 시간(사진 받기는 따로 — imageFetch 가 정체 기준으로 끊는다) */
const RENDER_TIMEOUT_MS = 20_000;
/**
 * 한 장 끝나고 다음 장까지 쉬는 시간 — 방금 그린 그림이 먼저 화면에 오르고 손가락 입력이 끼어들 틈.
 * 쉬지 않으면 초안이 화면에 오르기도 전에 원본 합성이 스레드를 붙잡았다(헤드리스 실측 0.9초 — 초안이 원본과 함께 떴다).
 */
const GAP_MS = 160;
/** 이웃 미리 그리기는 넘기기를 멈추고 이만큼 지난 뒤에만 — 빠르게 넘기는 동안 화면을 붙잡지 않게 */
const PREFETCH_QUIET_MS = 700;
/**
 * 원본으로 다시 그리기는 그 작품에 이만큼 머문 뒤에만 — 초안이 떠 있는 동안 넘겨 버리면 그 작품의 원본은 그리지 않는다.
 * 원본 합성이 스레드를 붙잡는 동안(헤드리스 약 0.9초) 손가락 넘기기가 굳는다. 초안(t800)도 휴대폰 화면에서는 거의 같은 선명도다.
 */
const FULL_SETTLE_MS = 450;

const cache = new WallCache(12);
/** 지금 보던 작품을 못 그렸다 — 화면에 [다시 시도] */
const hardFailed = new Set<string>();
/** 이웃을 미리 그리다 못 그렸다 — 미리 그리기만 건너뛴다(그 작품으로 넘어가면 다시 해 본다) */
const softFailed = new Set<string>();
/** 이 브라우저에서는 엔진이 안 된다 — 한 번 알면 이 탭에서 다시 띄우지 않는다 */
const shared = { unsupported: !wallViewLikelySupported(), glRestarts: 0 };
/** WebGL 을 잃어 엔진을 새로 띄우는 것은 이 탭에서 이만큼까지 — 그 뒤로는 그 작품을 '못 그림'으로 둔다(계속 잃는 기기에서 헛돌지 않게) */
const GL_RESTART_MAX = 2;

class Unsupported extends Error {}

/**
 * 작품 사진 받기 — 진행 중인 약속을 잠깐 쥔다(미리 받기 `warm` → 그리기가 같은 것을 두 번 받지 않게).
 * 쓰면 바로 놓는다 — 사진(원본 평균 1MB)을 쥐고 있지 않는다. 쓰이지 않은 것도 넷을 넘으면 오래된 것부터 놓는다.
 */
const sources = new Map<string, Promise<Blob | null>>();
const sourceKey = (url: string, quality: WallQuality) => `${quality} ${url}`;
function source(url: string, quality: WallQuality): Promise<Blob | null> {
  const key = sourceKey(url, quality);
  let p = sources.get(key);
  if (!p) {
    const src = wallSourceUrl(url, quality);
    p = fetchImageOnce(src)
      .then((got) => got ?? (src !== url ? fetchImageOnce(url) : null))   // t800 이 없는 옛 파일이면 원본으로
      .then((got) => got?.blob ?? null);
    sources.set(key, p);
    while (sources.size > 4) sources.delete(sources.keys().next().value as string);
  }
  return p;
}

/** 화면 밖 iframe 하나 — 엔진을 '그리기 전용'으로 띄우고 그림을 주고받는다 */
class WallFrame {
  private frame: HTMLIFrameElement;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: { blob: Blob; ratio: string }) => void; reject: (e: Error) => void; timer: number }>();
  private bootTimer: number;
  private phase: 'booting' | 'ready' | 'dead' = 'booting';
  private readyPromise: Promise<void>;
  private settleReady: (err?: Error) => void = () => {};

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.settleReady = (err) => (err ? reject(err) : resolve());
    });
    this.readyPromise.catch(() => { /* 기다리는 쪽이 받는다 — 아무도 안 기다릴 때 '처리 안 된 거절'이 뜨지 않게 */ });
    window.addEventListener('message', this.onMessage);
    const f = document.createElement('iframe');
    f.src = WALL_VIEW_URL;
    f.title = '벽에 걸어 보기(그리기 전용)';
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.dataset.wallView = '1';
    // display:none 이면 일부 브라우저가 그 문서의 일을 미룬다 — 화면 밖 1px 로 둔다
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(f);
    this.frame = f;
    this.bootTimer = window.setTimeout(() => this.die(new Error('boot-timeout')), BOOT_TIMEOUT_MS);
  }

  get dead(): boolean {
    return this.phase === 'dead';
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  render(blob: Blob, quality: WallQuality): Promise<{ blob: Blob; ratio: string }> {
    if (this.phase === 'dead') return Promise.reject(new Error('closed'));
    const req = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting.delete(req);
        reject(new Error('render-timeout'));
      }, RENDER_TIMEOUT_MS);
      this.waiting.set(req, { resolve, reject, timer });
      try {
        this.frame.contentWindow?.postMessage(renderRequest(req, blob, quality), window.location.origin);
      } catch (e) {
        window.clearTimeout(timer);
        this.waiting.delete(req);
        reject(e instanceof Error ? e : new Error('post'));
      }
    });
  }

  destroy(): void {
    this.die(new Error('closed'));
  }

  private die(err: Error): void {
    if (this.phase === 'dead') return;
    const booting = this.phase === 'booting';
    this.phase = 'dead';
    window.clearTimeout(this.bootTimer);
    window.removeEventListener('message', this.onMessage);
    this.waiting.forEach((w) => { window.clearTimeout(w.timer); w.reject(err); });
    this.waiting.clear();
    if (booting) this.settleReady(err);
    this.frame.remove();
  }

  private onMessage = (e: MessageEvent) => {
    // ⚠️ 보낸 쪽 확인 — 이 iframe 의 창, 같은 출처(lib/artlook.ts 의 ArtLook 탭과 같은 규칙)
    if (e.source !== this.frame.contentWindow || e.origin !== window.location.origin) return;
    const m = readWallMessage(e.data);
    if (!m) return;
    if (m.type === 'ready') {
      if (this.phase === 'booting') {
        this.phase = 'ready';
        window.clearTimeout(this.bootTimer);
        this.settleReady();
      }
      return;
    }
    if (m.type === 'unsupported') {
      this.die(isUnsupportedReason(m.reason) ? new Unsupported(m.reason) : new Error(m.reason || 'boot'));
      return;
    }
    const w = this.waiting.get(m.req);
    if (!w) return;
    this.waiting.delete(m.req);
    window.clearTimeout(w.timer);
    if (m.type === 'rendered') w.resolve({ blob: m.blob, ratio: m.ratio });
    else w.reject(new Error(m.reason || 'render'));
  };
}

export interface WallView {
  /** 토글을 보일지 — 이 브라우저에서 엔진이 안 되면 false */
  available: boolean;
  /** 지금 작품의 벽 그림(초안 또는 원본) */
  src: string | null;
  quality: WallQuality | null;
  status: 'idle' | 'working' | 'ready' | 'failed';
  retry: () => void;
  /** 곧 벽 보기를 켤 것 같다(작품 창의 사진이 떴다 · 버튼에 마우스를 올렸다·누르기 시작했다) — 엔진을 미리 띄우고 지금 작품의 초안 사진을 받아 둔다(여러 번 불러도 된다) */
  warm: () => void;
}

export function useWallView({ urls, index, active }: { urls: string[]; index: number; active: boolean }): WallView {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [unsupported, setUnsupported] = useState(() => shared.unsupported);
  const liveRef = useRef({ urls, index, active });
  const frameRef = useRef<WallFrame | null>(null);
  const busyRef = useRef(false);
  const genRef = useRef(0);
  const timerRef = useRef(0);
  const navAtRef = useRef(0);
  const doneAtRef = useRef(0);
  const pumpRef = useRef<() => Promise<void>>(async () => {});
  const aliveRef = useRef(false);

  /** 다음 일은 조금 뒤에 — 타이머는 하나만(늦게 잡은 것이 이긴다) */
  const later = useCallback((ms: number) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void pumpRef.current(); }, ms);
  }, []);

  const pump = useCallback(async (): Promise<void> => {
    const gen = genRef.current;
    if (busyRef.current || shared.unsupported) return;
    const { urls, index, active } = liveRef.current;
    if (!active) return;
    const job = wallJobs({
      index,
      total: urls.length,
      has: (i) => cache.peek(urls[i]!)?.quality ?? null,
      failed: (i) => hardFailed.has(urls[i]!) || (i !== index && softFailed.has(urls[i]!)),
      prefetch: wallPrefetchAllowed(),
    })[0];
    if (!job) return;
    const url = urls[job.index]!;
    const forCurrent = job.index === index;
    const now = Date.now();
    const wait = !forCurrent
      ? PREFETCH_QUIET_MS - (now - navAtRef.current)
      : job.quality === 'full' ? FULL_SETTLE_MS - Math.min(now - navAtRef.current, now - doneAtRef.current) : 0;
    if (wait > 0) { later(wait); return; }
    busyRef.current = true;
    try {
      let frame = frameRef.current;
      if (!frame || frame.dead) frame = frameRef.current = new WallFrame();
      // 사진 받기와 엔진 준비를 함께 — 둘 다 끝나야 그린다(위 머리말)
      const pending = source(url, job.quality);
      pending.finally(() => sources.delete(sourceKey(url, job.quality))).catch(() => {});
      await frame.ready();
      if (gen !== genRef.current) return;
      const blob = await pending;
      if (gen !== genRef.current) return;
      if (!blob) throw new Error('fetch');
      const out = await frame.render(blob, job.quality);
      if (gen !== genRef.current) return;
      cache.put(url, job.quality, URL.createObjectURL(out.blob));
      softFailed.delete(url);
    } catch (e) {
      if (gen !== genRef.current) return;
      if (e instanceof Unsupported) {
        shared.unsupported = true;
        frameRef.current?.destroy();
        frameRef.current = null;
        setUnsupported(true);
      } else if (e instanceof Error && e.message === GL_LOST && shared.glRestarts < GL_RESTART_MAX) {
        // 엔진이 WebGL 을 잃었다(작품 없이 그림자만 남은 그림은 보내지 않았다) — 새 iframe 으로 다음 차례에 다시 그린다
        shared.glRestarts += 1;
        frameRef.current?.destroy();
        frameRef.current = null;
      } else if (forCurrent) {
        hardFailed.add(url);        // 초안이 있으면 그건 그대로 보인다 — 원본으로 다시 그리지 못했을 뿐
      } else {
        softFailed.add(url);
      }
    } finally {
      if (gen === genRef.current) { busyRef.current = false; doneAtRef.current = Date.now(); }
    }
    if (gen !== genRef.current) return;
    bump();
    later(GAP_MS);
  }, [later]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);

  // 세대 — 마운트마다 새로. 내려가면 iframe 을 걷고, 아직 돌던 작업의 결과는 버린다(위 머리말의 StrictMode)
  useEffect(() => {
    const gen = ++genRef.current;
    busyRef.current = false;
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (genRef.current === gen) genRef.current += 1;
      busyRef.current = false;
      window.clearTimeout(timerRef.current);
      frameRef.current?.destroy();
      frameRef.current = null;
      sources.clear();   // 미리 받아 두고 못 쓴 사진도 놓는다
    };
  }, []);

  useEffect(() => {
    const prev = liveRef.current;
    if (prev.index !== index || prev.urls !== urls) navAtRef.current = Date.now();
    liveRef.current = { urls, index, active };
    const u = urls[index];
    if (u) cache.touch(u);
    if (active) void pump();
  }, [urls, index, active, pump]);

  const warm = useCallback(() => {
    if (shared.unsupported || !aliveRef.current) return;
    if (!frameRef.current || frameRef.current.dead) {
      const frame = frameRef.current = new WallFrame();
      const gen = genRef.current;
      // 미리 띄운 엔진이 '이 브라우저는 안 된다'고 하면 누르기 전에 토글을 감춘다(그리던 중이면 pump 가 같은 일을 한다)
      frame.ready().catch((e) => {
        if (gen !== genRef.current || !(e instanceof Unsupported)) return;
        shared.unsupported = true;
        if (frameRef.current === frame) frameRef.current = null;
        setUnsupported(true);
      });
    }
    const { urls, index } = liveRef.current;
    const u = urls[index];
    if (u && !cache.peek(u) && !hardFailed.has(u)) void source(u, 'draft');
  }, []);

  const retry = useCallback(() => {
    const { urls, index } = liveRef.current;
    const u = urls[index];
    if (u) { hardFailed.delete(u); softFailed.delete(u); }
    bump();
    void pump();
  }, [pump]);

  const url = urls[index];
  const entry = url ? cache.peek(url) : null;
  const failed = !!url && hardFailed.has(url);
  return {
    available: !unsupported,
    src: entry?.src ?? null,
    quality: entry?.quality ?? null,
    status: entry ? 'ready' : failed ? 'failed' : active ? 'working' : 'idle',
    retry,
    warm,
  };
}
