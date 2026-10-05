/**
 * HeroSlider - 히어로 배너 캐러셀
 *
 * CSS scroll-snap 기반 네이티브 캐러셀
 * - 마우스 드래그 + 터치 스와이프로 좌우 슬라이드
 * - IntersectionObserver로 현재 슬라이드 추적
 * - 3초 자동 슬라이드, current 변경 시 타이머 리셋
 * - 이미지 평균색 → 배경 띠 색(`lib/heroTone.ts bandColor`)
 * - 사진 위 글자(자세히 보기·제목·넘김 표시·화살표)는 **그 자리의 실제 밝기**로 검정/흰색을 고른다(2026-10-05, `lib/heroTone.ts`).
 *   관리자가 슬라이드마다 고정할 수 있다(`textTone`). [자세히 보기]는 **사진의 오른쪽 위**(틀이 아니라 사진 — 넓은 화면에서
 *   사진 옆에 여백이 생겨도 버튼이 사진과 여백에 반씩 걸치지 않게).
 * - 슬라이드마다 **모바일 전용 이미지**(`mobileImageUrl`, 세로형)를 둘 수 있다 (2026-09-16).
 *   `<picture>` 가 화면 폭(sm 미만)에 따라 소스를 고른다. 없으면 가로 배너를 그대로 쓰되,
 *   띠가 얇으면(<200px) 제목·설명·바로가기를 사진 **아래 카드**로 내린다.
 *
 * @see CLAUDE.md - Hero Section 스펙
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import { bandColor, bandLum, colorLum, containRect, loadHeroAnalysis, pickTone, sampleBox, TONE_CLASS, type HeroAnalysis, type TextTone } from '@/lib/heroTone';
import type { HeroSlide } from '@/types';

/** 모바일 이미지 분기 폭 — Tailwind `sm`(640px) 과 같은 경계. `<picture>` 의 media 와 **반드시 같아야** 한다. */
export const HERO_MOBILE_MEDIA = '(max-width: 639px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

export default function HeroSlider() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  const dragState = useRef({ isDragging: false, startX: 0, scrollLeft: 0, didDrag: false });
  const isHovered = useRef(false);

  const { data: slides = [], isLoading } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  // 이미지 파일이 실제로 로드 완료됐는지 추적 (CDN 다운로드 동안 스켈레톤 유지)
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const markLoaded = useCallback((i: number) => {
    setLoadedImages((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  }, []);

  /**
   * 배너 높이는 **사진의 원래 비율**을 따른다 (2026-09-10).
   *
   * 예전엔 `aspect-[4/3] sm:aspect-[16/9]` 로 틀을 고정해 놓고 `object-cover` 라,
   * 창이 좁아지면 사진이 **잘렸다**. 실서버 배너는 2000×667(**3:1**)인데 모바일 틀이 4/3(1.33)이라
   * **가로의 56% 가 잘려 나갔다**(보이는 건 44%). 창을 줄이면 사진도 같이 작아져야지 잘리면 안 된다.
   *
   * ⚠️ 슬라이드는 한 트랙을 공유하므로 높이도 하나뿐이다. **가장 세로로 긴 사진**(=비율 최소)에 맞춘다 —
   *    그래야 나머지가 위아래로 넘치지 않는다. 남는 자리는 `object-contain` + 띠 배경색(dominant color)이 먹는다.
   * ⚠️ 극단적인 업로드를 대비해 [1.2, 3.4] 로 묶는다. 세로 사진 한 장 때문에 배너가 화면을 삼키면 안 된다.
   */
  /*
   * 좁은 화면에서는 세로형 모바일 이미지가 올 수 있으므로 비율 하한이 다르다 — 데스크톱 1.2, 모바일 0.8(4:5).
   * ⚠️ 비율은 **슬라이드별로** 들고 있다가 매번 최솟값을 구한다. 창 폭이 경계를 넘으면 브라우저가 `<picture>`
   *    소스를 바꿔 onLoad 가 다시 오는데, 누적 min 으로 두면 옛 소스(가로 3:1)의 비율이 그대로 남아
   *    세로 이미지가 위아래로 잘린 틀에 갇힌다.
   */
  const isNarrow = useMediaQuery(HERO_MOBILE_MEDIA);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const noteRatio = useCallback((i: number, w: number, h: number) => {
    if (!w || !h) return;
    const r = w / h;
    setRatios((prev) => (prev[i] === r ? prev : { ...prev, [i]: r }));
  }, []);
  const measured = Object.values(ratios);
  // 아직 한 장도 못 쟀으면 실서버 배너 비율(3:1)로 시작한다 — 뜨자마자 튀는 걸 줄인다
  const trackRatio = measured.length
    ? Math.min(3.4, Math.max(isNarrow ? 0.8 : 1.2, Math.min(...measured)))
    : 3;

  /**
   * 띠가 얇으면 **글씨를 사진 위에 얹지 않는다** (2026-09-10).
   *
   * 사진을 안 자르게 되니 3:1 배너는 375px 화면에서 높이가 **125px** 밖에 안 된다.
   * 거기에 흰 제목을 얹으면 배너가 이미 갖고 있는 디자인·글씨와 겹쳐 둘 다 안 읽힌다
   * (2026-08-15 에 하단 그래디언트를 뺀 것과 같은 이유 — 배너엔 이미 디자인이 다 들어 있다).
   * 그럴 땐 제목·바로가기를 **사진 아래 띠 색 위로** 내린다.
   *
   * ⚠️ 화면 폭이 아니라 **실제 높이**로 판정할 것 — 같은 폭이라도 배너 비율에 따라 높이가 다르다.
   */
  // 틀의 폭·높이 — 높이로 '얇은 배너'를 가르고, 폭·높이로 사진이 실제로 앉은 자리(contain)를 구한다
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setFrame((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);
  const trackH = frame.h;
  const compact = trackH > 0 && trackH < 200;
  const currentSlide = slides[current];
  // 사진 아래 캡션 줄에 실제로 그릴 것이 있는가 — 제목·설명(공백 제외), 바로가기, 또는 넘길 슬라이드(인디케이터)
  const captionHasContent = !!currentSlide
    && (!!currentSlide.title?.trim() || !!currentSlide.description?.trim() || !!currentSlide.linkUrl || slides.length > 1);

  /*
   * 사진 밝기 표 — 띠 색과 글자 색(검정/흰색)을 여기서 정한다(`lib/heroTone.ts`). 썸네일(t240)을 받아 잰다.
   * 좁은 화면에서 모바일 전용 이미지를 쓰면 그것도 잰다(글자는 화면에 걸린 사진 위에 있다). 띠 색은 예전처럼 가로 배너 기준.
   */
  const [analyses, setAnalyses] = useState<Record<string, HeroAnalysis | null>>({});
  const shownUrl = useCallback((s: HeroSlide) => (isNarrow && s.mobileImageUrl ? s.mobileImageUrl : s.imageUrl), [isNarrow]);
  useEffect(() => {
    let alive = true;
    const urls = new Set<string>();
    for (const s of slides) { urls.add(s.imageUrl); urls.add(shownUrl(s)); }
    for (const u of urls) {
      void loadHeroAnalysis(u).then((a) => {
        if (alive) setAnalyses((prev) => (u in prev ? prev : { ...prev, [u]: a }));
      });
    }
    return () => { alive = false; };
  }, [slides, shownUrl]);
  // 사진의 가로세로비 — 화면에 걸린 소스의 실제 크기(onLoad) 우선, 아직이면 밝기 표의 비율
  const ratioOf = useCallback((i: number) => {
    const s = slides[i];
    const a = s ? analyses[shownUrl(s)] : null;
    return ratios[i] ?? (a ? a.w / a.h : null);
  }, [slides, analyses, shownUrl, ratios]);

  /*
   * 사진 위 요소마다 글자 색 정하기 — 요소가 **실제로 놓인 상자**를 재서 그 밑의 사진 밝기로 고른다.
   *  - 슬라이드 안 요소(자세히 보기·제목): `data-tone-key` + `data-tone-slide` → '<i>:<key>'
   *  - 슬라이드 밖 공용 요소(화살표·넘김 표시): `data-tone-key` 만 → 지금 슬라이드의 사진으로
   * 사진 밖(contain 여백)에 걸린 부분은 슬라이드 칸의 배경색으로 친다. 밝기 표를 못 받았으면 흰색(예전 모습).
   * ⚠️ 색만 바뀌고 크기는 안 바뀌므로 이 effect 가 스스로를 다시 부르지 않는다.
   */
  const [tones, setTones] = useState<Record<string, TextTone>>({});
  const ratioKey = slides.map((_, i) => ratioOf(i) ?? 0).join(',');
  useEffect(() => {
    const frameEl = frameRef.current;
    if (!frameEl || compact || !frame.w) return;
    const raf = requestAnimationFrame(() => {
      const fr = frameEl.getBoundingClientRect();
      const next: Record<string, TextTone> = {};
      frameEl.parentElement!.querySelectorAll<HTMLElement>('[data-tone-key]').forEach((el) => {
        const own = el.dataset.toneSlide;
        const i = own != null ? Number(own) : current;
        const key = own != null ? `${i}:${el.dataset.toneKey}` : el.dataset.toneKey!;
        const s = slides[i];
        const slideEl = frameEl.querySelector<HTMLElement>(`[data-index="${i}"]`);
        const a = s ? analyses[shownUrl(s)] : null;
        if (!s || !slideEl || !a) { next[key] = 'white'; return; }
        const base = own != null ? slideEl.getBoundingClientRect() : fr;
        const r = el.getBoundingClientRect();
        const box = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
        const outside = colorLum(getComputedStyle(slideEl).backgroundColor) ?? bandLum(analyses[s.imageUrl]);
        next[key] = pickTone(sampleBox(box, containRect(fr.width, fr.height, ratioOf(i)), a, outside));
      });
      setTones((prev) => {
        const keys = Object.keys(next);
        return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [compact, frame.w, frame.h, ratioKey, analyses, current, slides, shownUrl, ratioOf]);
  // 관리자가 고정한 색이 먼저, 없으면 잰 값, 아직 못 쟀으면 흰색
  const toneOf = (i: number, key: string): TextTone => slides[i]?.textTone ?? tones[`${i}:${key}`] ?? 'white';
  const sharedTone = (key: string): TextTone => slides[current]?.textTone ?? tones[key] ?? 'white';

  // 슬라이드 전환은 **직접 애니메이션**한다 — 브라우저 기본 smooth 는 속도를 못 정한다.
  // 900ms ease-in-out 으로 천천히·부드럽게 넘긴다(그림을 홱 넘기지 않게).
  const animRef = useRef<number | null>(null);
  const SLIDE_MS = 900;
  const scrollToSlide = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    isScrolling.current = true;
    setCurrent(index);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const start = container.scrollLeft;
    const target = index * container.offsetWidth;
    const dist = target - start;
    if (Math.abs(dist) < 1) { isScrolling.current = false; return; }
    let startTs: number | null = null;
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const p = Math.min(1, (ts - startTs) / SLIDE_MS);
      container.scrollLeft = start + dist * easeInOut(p);
      if (p < 1) { animRef.current = requestAnimationFrame(step); }
      else { isScrolling.current = false; animRef.current = null; }
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || slides.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrolling.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!isNaN(index)) setCurrent(index);
          }
        }
      },
      { root: container, threshold: 0.5 }
    );
    const children = container.querySelectorAll('[data-index]');
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    // 10초마다 자동 전환 (예전 3초는 그림을 볼 새도 없이 넘어갔다)
    const timer = setInterval(() => {
      if (!isHovered.current) scrollToSlide((current + 1) % slides.length);
    }, 10000);
    return () => clearInterval(timer);
  }, [slides.length, current, scrollToSlide]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    dragState.current = {
      isDragging: true,
      startX: e.pageX - container.offsetLeft,
      scrollLeft: container.scrollLeft,
      didDrag: false,
    };
    container.style.cursor = 'grabbing';
    container.style.scrollSnapType = 'none';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current.isDragging) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const x = e.pageX - container.offsetLeft;
    const walk = x - dragState.current.startX;
    if (Math.abs(walk) > 5) dragState.current.didDrag = true;
    container.scrollLeft = dragState.current.scrollLeft - walk;
  };

  const handleMouseUp = () => {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = '';
    container.style.scrollSnapType = 'x mandatory';
  };

  const handleMouseLeave = () => {
    if (dragState.current.isDragging) handleMouseUp();
  };

  const handleLink = (url?: string) => {
    if (!url || dragState.current.didDrag) return;
    if (url.startsWith('http')) {
      window.open(url, '_blank');
    } else {
      navigate(url);
    }
  };

  const currentBg = bandColor(currentSlide ? analyses[currentSlide.imageUrl] : null);
  // 얇은 배너의 아래 줄은 띠 색 위에 놓인다 — 단색이라 잰 값이 늘 맞다(관리자 고정은 사진 위 글자에만)
  const capTone = useMemo<TextTone>(() => pickTone([bandLum(currentSlide ? analyses[currentSlide.imageUrl] : null)]), [currentSlide, analyses]);
  const cap = TONE_CLASS[capTone];

  // 데이터 로딩 중이거나 슬라이드가 없으면 전체 스켈레톤
  if (isLoading || slides.length === 0) {
    return (
      <div className="w-full bg-gray-100">
        <div className="max-w-7xl mx-auto">
          {/* 스켈레톤도 본체와 같은 규칙으로 — 다르면 뜨는 순간 높이가 튄다 */}
          <div
            style={{ aspectRatio: String(trackRatio) }}
            className="max-h-[70vh] md:max-h-[46vh] bg-gray-100 animate-pulse"
          />
        </div>
      </div>
    );
  }

  /*
    배너는 **화면 전체 폭을 채우는 색 띠**(currentBg) 위에 컨텐츠를 가운데(max-w-7xl)로 둔다.
    화면이 넓어지면 컨텐츠 좌우는 이 배경색이 자동으로 채운다("좌우 자동확장").
    그라데이션·글로우는 없앴다 — 배너 이미지에 이미 디자인이 다 들어 있어서 덮을 이유가 없다.
    색은 슬라이드 이미지의 dominant color 라 이미지와 띠가 자연스럽게 이어진다.
  */
  return (
    <div className="w-full transition-colors duration-700" style={{ backgroundColor: currentBg }}>
      <div className="max-w-7xl mx-auto">
        <div
          className="group relative overflow-hidden"
          onMouseEnter={() => { isHovered.current = true; }}
          onMouseLeave={() => { isHovered.current = false; }}
        >
          {/* 높이는 `aspectRatio`(사진 원래 비율)가 정한다. min/max 는 극단만 막는 안전선이고,
              그 구간에 걸려 틀이 사진보다 넓어져도 `object-contain` 이라 **잘리지는 않는다**(띠 배경이 채운다).

              ⚠️⚠️ **크기를 정하는 상자와 트랙을 한 요소에 합치지 말 것** (2026-10-01, 사파리에서 실제로 잘렸다).
              예전엔 트랙 하나에 `aspect-ratio` + `max-h` 를 걸고 슬라이드·사진을 `h-full` 로 내려 잡았다.
              사파리(WebKit)는 그 `height:100%` 를 **max-height 로 깎이기 전 높이**로 계산한다 — 그래서 상한에 걸리는 순간
              사진 칸이 트랙보다 커지고 `object-contain` 이 지킬 상자가 없어져 **아래가 잘렸다**(트랙이 세로로 스크롤되기까지 했다).
              실측: PC 사파리 1280×720 에서 3:1 배너의 77.6% 만 보임 · 아이폰 가로 95.7% · 세로형(4:5) 모바일 이미지를 올린
              아이폰 13 세로 95.3% · 16:9 배너는 46~57%. 크롬은 전부 100% 라 눈으로는 못 찾는다.
              지금은 바깥 상자가 크기만 정하고, 트랙과 사진은 `absolute inset-0` 으로 **실제 상자**에 붙는다 —
              절대 위치는 퍼센트 높이 해석에 기대지 않는다. 회귀는 `scratchpad/hero/matrix.js`(크롬+WebKit 128조합). */}
          <div
            data-hero-frame
            ref={frameRef}
            style={{ aspectRatio: String(trackRatio) }}
            className="relative w-full max-h-[70vh] md:max-h-[46vh]"
          >
          <div
            ref={containerRef}
            className="absolute inset-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-hide cursor-grab select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            {slides.map((slide, i) => {
              const t = TONE_CLASS[toneOf(i, 'title')];
              const b = TONE_CLASS[toneOf(i, 'btn')];
              // 사진이 실제로 앉은 자리 — [자세히 보기]는 그 오른쪽 위, 제목은 왼쪽 아래에 붙인다(여백이 아니라 사진 위).
              // 틀 기준이면 사진 옆·위아래 여백(contain)에 글자가 반쯤 걸려 어느 색도 잘 안 읽힌다(2026-10-05 실측).
              const ir = containRect(frame.w, frame.h, ratioOf(i));
              const wide = frame.w >= 768;
              const padX = wide ? 40 : 20;
              const irRight = Math.max(0, frame.w - (ir.x + ir.w));
              const irBottom = Math.max(0, frame.h - (ir.y + ir.h));
              return (
              <div
                key={slide.id ?? i}
                data-index={i}
                className="relative w-full h-full flex-shrink-0 snap-start bg-gray-100"
              >
                {/* 이미지 다운로드 동안 스켈레톤 유지 */}
                {!loadedImages.has(i) && (
                  <div className="absolute inset-0 bg-gray-100 animate-pulse" />
                )}
                {/* ⚠️ `object-cover` 로 되돌리지 말 것 — 창이 좁아지면 사진이 잘린다(위 `ratio` 주석 참고) */}
                {/* 모바일 전용 이미지가 있으면 좁은 화면에서 그걸 고른다. 고른 소스의 실제 크기가 onLoad 로 들어온다. */}
                {/* ⚠️ 사진은 `absolute inset-0` — 흐름 안에 두고 `h-full` 로 잡으면 사파리에서 칸 밖으로 넘친다(위 주석) */}
                <picture>
                  {slide.mobileImageUrl && <source media={HERO_MOBILE_MEDIA} srcSet={slide.mobileImageUrl} />}
                  <img
                    src={slide.imageUrl}
                    alt={slide.title}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      noteRatio(i, img.naturalWidth, img.naturalHeight);
                      markLoaded(i);
                    }}
                    onError={() => markLoaded(i)}
                    className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-500 ${loadedImages.has(i) ? 'opacity-100' : 'opacity-0'}`}
                    draggable={false}
                    loading={i === 0 ? 'eager' : 'lazy'}
                  />
                </picture>
                {/* 텍스트
                    하단 그래디언트는 뺐다(2026-08-15) — 배너 이미지에 이미 디자인이 다 들어 있는데
                    어둡게 덮어서 아래쪽이 안 보였다. 대신 **글자에만** 그림자를 줘서 밝은 이미지 위에서도
                    읽히게 한다. 배경을 덮지 않으니 같은 문제가 다시 생기지 않는다. */}
                <div
                  data-tone-key="title"
                  data-tone-slide={i}
                  style={{ left: ir.x + padX, bottom: irBottom + (wide ? 64 : 48), ...(wide ? {} : { right: irRight + padX }) }}
                  className={`absolute max-w-xl pointer-events-none ${t.shadow} ${compact ? 'hidden' : ''}`}
                >
                  {slide.description && (
                    <p className={`hidden sm:block text-[11px] md:text-xs tracking-[0.15em] uppercase mb-2 ${t.sub}`}>
                      {slide.description}
                    </p>
                  )}
                  <h2 className={`text-lg md:text-3xl font-semibold leading-snug ${t.text}`}>
                    {slide.title}
                  </h2>
                </div>

                {/* 바로가기 — 사진의 오른쪽 위(2026-10-05 사용자 결정). 예전엔 오른쪽 아래라 배너 안 글씨와 겹쳤다.
                    ⚠️ 틀이 아니라 **사진** 모서리에 붙인다 — 넓은 화면(비로그인 1280·1366px)은 사진 양옆에 88~110px 여백이 생겨,
                    틀 모서리에 두면 버튼이 사진과 여백에 반씩 걸친다. 틀을 아직 못 쟀으면(첫 렌더) 틀 모서리. */}
                {slide.linkUrl && !compact && (
                  <button
                    data-tone-key="btn"
                    data-tone-slide={i}
                    onClick={() => handleLink(slide.linkUrl)}
                    style={{ top: ir.y + (wide ? 20 : 12), right: irRight + (wide ? 28 : 16) }}
                    // p-3 + 네거티브 마진: 시각 위치는 유지하면서 터치 히트영역만 확대
                    className={`absolute z-10 p-3 -m-3 text-xs md:text-base tracking-wide transition-colors cursor-pointer underline underline-offset-4 ${b.link} ${b.shadow}`}
                  >
                    자세히 보기 →
                  </button>
                )}
              </div>
              );
            })}
          </div>
          </div>

          {/* 좌우 화살표 — 세련되게. 평소엔 옅게, 호버 때만 또렷이(그림을 가리지 않게).
              44px 히트영역은 유지하되 보이는 원은 작게(28px), 채움 대신 얇은 아웃라인.
              데스크톱은 호버로 드러나고(opacity-0→100), 터치기기는 스와이프가 있어 아주 옅게만 둔다. */}
          {slides.length > 1 && (
            <>
              <button
                onClick={() => scrollToSlide((current - 1 + slides.length) % slides.length)}
                aria-label="이전 슬라이드"
                className="group/nav absolute left-2 md:left-4 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center z-10 cursor-pointer opacity-0 max-md:opacity-40 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300"
              >
                <span data-tone-key="arrowL" className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 backdrop-blur-sm transition-colors ${TONE_CLASS[sharedTone('arrowL')].arrow}`}>
                  <ChevronLeft size={16} strokeWidth={2.2} />
                </span>
              </button>
              <button
                onClick={() => scrollToSlide((current + 1) % slides.length)}
                aria-label="다음 슬라이드"
                className="group/nav absolute right-2 md:right-4 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center z-10 cursor-pointer opacity-0 max-md:opacity-40 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300"
              >
                <span data-tone-key="arrowR" className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 backdrop-blur-sm transition-colors ${TONE_CLASS[sharedTone('arrowR')].arrow}`}>
                  <ChevronRight size={16} strokeWidth={2.2} />
                </span>
              </button>
            </>
          )}

          {/* 인디케이터 — 시각은 2px 라인 유지, 버튼 패딩으로 터치 히트영역만 확대.
              얇은 배너에서는 사진 위에 점이 얹히면 그림을 가리므로 아래 캡션 줄로 옮긴다.
              한 장뿐이면 그리지 않는다 — 넘길 곳이 없는데 선 하나만 덩그러니 남았다(2026-10-05). */}
          {slides.length > 1 && (
          <div data-tone-key="dots" className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 flex z-10 ${compact ? 'hidden' : ''}`}>
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToSlide(i)}
                aria-label={`${i + 1}번째 슬라이드로 이동`}
                className="py-4 px-1 min-h-[44px] flex items-center cursor-pointer"
              >
                <span
                  className={`block h-[2px] rounded-full transition-all ${
                    i === current ? `${TONE_CLASS[sharedTone('dots')].dotOn} w-6` : `${TONE_CLASS[sharedTone('dots')].dotOff} w-3`
                  }`}
                />
              </button>
            ))}
          </div>
          )}
        </div>

        {/*
          얇은 배너의 캡션 줄 — 사진 **아래**, 띠 색 위에 놓는다.
          사진 위에 얹으면 배너 자체 디자인과 겹쳐 둘 다 안 읽힌다(위 `compact` 주석 참고).
          글씨 색은 띠 색(사진 평균의 0.6배, 단색)으로 검정/흰색을 고른다(`capTone`, 2026-10-05) — 예전엔 흰색 고정이라
          밝은 배너(실서버 이벤트 배너)의 띠에서 3.4:1 이었다. 관리자 고정(textTone)은 사진 위 글자에만 쓴다.
        */}
        {/* 카드로 내릴 땐 제목을 한 줄로 자르지 않는다 — 얇은 배너에서는 이 글이 배너의 전부다(포스터 속 글씨는 이미 안 읽힌다). */}
        {/* ⚠️ 적을 게 없으면 줄째로 그리지 않는다 (2026-10-01) — 배너에 글씨가 이미 다 들어 있어 제목을 공백으로 둔
            슬라이드 한 장짜리(실서버가 그랬다)에서, 사진 아래에 **빈 색 띠**만 남았다. */}
        {compact && currentSlide && captionHasContent && (
          <div data-hero-caption className={`flex items-center gap-3 px-5 pb-3 pt-2.5 ${capTone === 'white' ? '[text-shadow:0_1px_3px_rgba(0,0,0,0.5)]' : ''}`}>
            <div className="min-w-0 flex-1">
              {currentSlide.description && (
                <p className={`line-clamp-1 text-[10px] uppercase tracking-[0.14em] ${cap.sub}`}>{currentSlide.description}</p>
              )}
              <h2 className={`line-clamp-2 text-[15px] font-semibold leading-snug ${cap.text}`}>{currentSlide.title}</h2>
            </div>
            {slides.length > 1 && (
              <div className="flex shrink-0 items-center">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => scrollToSlide(i)}
                    aria-label={`${i + 1}번째 슬라이드로 이동`}
                    className="flex min-h-[44px] cursor-pointer items-center px-1 py-4"
                  >
                    <span className={`block h-[2px] rounded-full transition-all ${i === current ? `w-5 ${cap.dotOn}` : `w-2.5 ${cap.dotOff}`}`} />
                  </button>
                ))}
              </div>
            )}
            {currentSlide.linkUrl && (
              <button
                onClick={() => handleLink(currentSlide.linkUrl)}
                className={`-m-2 shrink-0 cursor-pointer p-2 text-xs tracking-wide underline underline-offset-4 ${cap.link}`}
              >
                자세히 보기 →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
