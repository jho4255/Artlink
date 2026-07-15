/**
 * TourOverlay — framer-motion 기반 온보딩 코치마크 엔진
 *
 * useTourStore가 활성 투어를 들고 있으면, 현재 스텝을 읽어:
 *  1) step.route가 있으면 그 경로로 이동한 뒤
 *  2) step.target(data-tour) 요소가 나타날 때까지 대기 → 화면 안으로 스크롤
 *  3) 요소를 스포트라이트(주변 어둡게 + 구멍)로 강조하고 말풍선으로 안내
 * target이 없으면(환영/마무리) 화면 중앙 카드로 표시. 요소를 못 찾으면 중앙 카드로 폴백.
 *
 * Layout에 한 번만 렌더하면 앱 전역에서 동작. (트리거는 tourStore.start 호출부)
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useTourStore } from '@/stores/tourStore';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/axios';

const PADDING = 8; // 스포트라이트 여백
const MARGIN = 16; // 화면 가장자리 최소 여백

function waitForElement(selector: string, timeout = 3000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const immediate = document.querySelector<HTMLElement>(selector);
    if (immediate) return resolve(immediate);
    const start = performance.now();
    const iv = setInterval(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) { clearInterval(iv); resolve(el); }
      else if (performance.now() - start > timeout) { clearInterval(iv); resolve(null); }
    }, 100);
  });
}

// target 경로(쿼리 포함 가능)와 현재 경로가 같은지
function pathMatches(current: string, target: string): boolean {
  const [tPath, tQuery] = target.split('?');
  const [cPath, cQuery] = current.split('?');
  if (cPath !== tPath) return false;
  if (!tQuery) return true;
  return (cQuery || '') === tQuery;
}

// 스포트라이트 사각형 계산. 목업 데모가 있으면 탭 + 목업 콘텐츠를 하나로 묶어 강조.
function measureSpotlight(target: string, includeDemo: boolean): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  let r = el.getBoundingClientRect();
  if (includeDemo) {
    const demo = document.querySelector<HTMLElement>('[data-tour="tour-demo"]');
    if (demo) {
      const d = demo.getBoundingClientRect();
      const left = Math.min(r.left, d.left);
      const top = Math.min(r.top, d.top);
      const right = Math.max(r.right, d.right);
      const bottom = Math.max(r.bottom, d.bottom);
      r = new DOMRect(left, top, right - left, bottom - top);
    }
  }
  return r;
}

export default function TourOverlay() {
  const { tourId, steps, index, next, prev, stop } = useTourStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 이름(닉네임) 입력 스텝용 상태
  const [enteredName, setEnteredName] = useState('');
  const [nameValue, setNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [checking, setChecking] = useState(false);
  const [nameCheck, setNameCheck] = useState<{ available: boolean; msg: string } | null>(null);

  const step = tourId ? steps[index] : undefined;

  // 투어 시작 시 입력값 초기화 (기존 닉네임이 있으면 프리필)
  useEffect(() => {
    if (!tourId) return;
    const nick = user?.nickname ?? '';
    setEnteredName(nick);
    setNameValue(nick);
    setNameCheck(null);
    setChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  // {name} 치환: 이름이 있으면 "이름 ", 없으면 "" (예: "환영해요, {name}작가님")
  const interp = (text: string) => text.replace('{name}', enteredName ? `${enteredName} ` : '');

  // 중복확인 — 즉시 사용 가능 여부 피드백 (MyPage 닉네임 UX와 동일)
  const checkName = async () => {
    const v = nameValue.trim();
    if (v.length < 2 || v.length > 20) { setNameCheck({ available: false, msg: '2~20자로 입력해주세요.' }); return; }
    setChecking(true);
    try {
      const { data } = await api.get('/auth/nickname-check', { params: { nickname: v } });
      setNameCheck(data.available
        ? { available: true, msg: '사용 가능한 이름이에요.' }
        : { available: false, msg: data.reason || '이미 사용 중인 이름이에요.' });
    } catch {
      setNameCheck({ available: false, msg: '중복 확인에 실패했어요. 잠시 후 다시 시도해주세요.' });
    } finally {
      setChecking(false);
    }
  };

  // 이름 입력 제출 → 닉네임 저장 후 다음 스텝
  const submitName = async () => {
    const v = nameValue.trim();
    if (!v) { setEnteredName(''); next(); return; } // 빈 값이면 개인화 없이 진행
    if (v.length < 2 || v.length > 20) { setNameCheck({ available: false, msg: '2~20자로 입력해주세요.' }); return; }
    setSavingName(true);
    setNameCheck(null);
    try {
      const { data } = await api.put('/auth/me/nickname', { nickname: v });
      updateUser({ nickname: data.nickname });
      setEnteredName(v);
      next();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setNameCheck({ available: false, msg: '이미 사용 중인 이름이에요. 다른 이름을 입력해주세요.' });
      } else {
        // 저장 실패(네트워크 등)해도 인사말엔 사용하고 진행
        setEnteredName(v);
        next();
      }
    } finally {
      setSavingName(false);
    }
  };

  // 스텝 진입: 라우트 이동 → 요소 대기 → 스크롤 → 측정
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    setReady(false);
    setPos(null);

    const run = async () => {
      if (step.route && !pathMatches(location.pathname + location.search, step.route)) {
        navigate(step.route);
        return; // 위치 변경이 이 effect를 다시 트리거
      }
      if (!step.target) { setRect(null); setReady(true); return; }
      const el = await waitForElement(`[data-tour="${step.target}"]`);
      if (cancelled) return;
      if (!el) { setRect(null); setReady(true); return; } // 폴백: 중앙 카드
      // 목업 데모가 있으면 렌더될 때까지 잠깐 대기(합집합 스포트라이트에 포함)
      if (step.preview) await waitForElement('[data-tour="tour-demo"]', 1500);
      if (cancelled) return;
      if (step.preview) {
        // 탭이 sticky 네비게이션 바 바로 아래로 오게 스크롤(탭+목록이 함께 보이도록)
        const navH = document.querySelector('nav')?.getBoundingClientRect().height ?? 64;
        const y = window.scrollY + el.getBoundingClientRect().top - navH - 16;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      } else {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
      setTimeout(() => {
        if (cancelled) return;
        setRect(measureSpotlight(step.target!, !!step.preview));
        setReady(true);
      }, 400);
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId, index, location.pathname, location.search]);

  // 스크롤/리사이즈 시 스포트라이트 위치 갱신
  useEffect(() => {
    if (!ready || !step?.target) return;
    const update = () => {
      const r = measureSpotlight(step.target!, !!step.preview);
      if (r) setRect(r);
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [ready, step?.target, step?.preview]);

  // 말풍선 위치 계산 (요소 아래 우선, 공간 부족 시 위로)
  // 목업 데모 스텝은 스포트라이트가 크므로 카드를 하단 중앙 고정(아래 render) → pos 계산 불필요
  useLayoutEffect(() => {
    if (!ready || !rect || step?.preview) { setPos(null); return; }
    const tip = tipRef.current;
    if (!tip) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const th = tip.offsetHeight, tw = tip.offsetWidth;
    const gap = 14;
    let top = rect.bottom + gap;
    if (top + th > vh - MARGIN) top = rect.top - gap - th;
    if (top < MARGIN) top = MARGIN;
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
    setPos({ top, left });
  }, [ready, rect, index]);

  // ESC로 종료
  useEffect(() => {
    if (!tourId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourId, stop]);

  if (!tourId || !step) return null;

  const isLast = index === steps.length - 1;
  const centered = ready && !rect;
  const bottomAnchored = ready && !!rect && !!step.preview; // 목업 데모: 하단 중앙 고정

  const card = (
    <motion.div
      ref={tipRef}
      key={index}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto w-[300px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl p-5"
      style={
        centered || bottomAnchored
          ? undefined
          : { position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">{interp(step.title)}</h3>
        <button onClick={stop} aria-label="투어 닫기" className="text-gray-300 hover:text-gray-600 -mt-0.5 -mr-1">
          <X size={18} />
        </button>
      </div>
      <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{interp(step.body)}</p>

      {/* 이름 입력 스텝 */}
      {step.input && (
        <div className="mt-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={nameValue}
              onChange={(e) => { setNameValue(e.target.value); setNameCheck(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !savingName) submitName(); }}
              placeholder={step.input.placeholder}
              maxLength={20}
              className={`flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 ${nameCheck && !nameCheck.available ? 'border-red-400 ring-red-300' : 'border-gray-200 focus:ring-gray-400'}`}
            />
            <button
              onClick={checkName}
              disabled={checking || nameValue.trim().length < 2}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {checking ? '확인 중' : '중복확인'}
            </button>
          </div>
          {nameCheck ? (
            <p className={`mt-1.5 text-xs ${nameCheck.available ? 'text-green-600' : 'text-red-500'}`}>{nameCheck.msg}</p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-400">닉네임 또는 작가 이름 · 2~20자</p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        {/* 진행 점 */}
        <div className="flex items-center gap-1.5">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-gray-900' : 'w-1.5 bg-gray-200'}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <button onClick={prev} className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-900 cursor-pointer">이전</button>
          )}
          <button
            onClick={step.input ? submitName : next}
            disabled={savingName}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
          >
            {savingName ? '저장 중...' : isLast ? '시작하기' : '다음'}
          </button>
        </div>
      </div>

      {!isLast && (
        <button onClick={stop} className="mt-2 w-full text-center text-xs text-gray-400 hover:text-gray-600 cursor-pointer">
          건너뛰기
        </button>
      )}
    </motion.div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* 배경 클릭 차단 (실수로 넘어가지 않도록) */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {ready && rect ? (
        // 스포트라이트: 큰 box-shadow로 주변을 어둡게, 요소 자리에 구멍
        <motion.div
          className="pointer-events-none rounded-xl"
          initial={false}
          animate={{
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{ position: 'fixed', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <AnimatePresence mode="wait">
        {ready && (
          centered ? (
            <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">{card}</div>
          ) : bottomAnchored ? (
            <div className="fixed inset-x-0 bottom-4 flex justify-center px-4 pointer-events-none">{card}</div>
          ) : (
            card
          )
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
