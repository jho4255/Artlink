import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { dismissPushBanner, getPushBanner, subscribePushBanner } from '@/lib/pushBanner';
import { openNotification } from '@/lib/native';

/** 배너가 떠 있는 시간 — 카카오톡 인앱 배너처럼 잠깐 */
export const PUSH_BANNER_MS = 4500;

/**
 * 앱을 보고 있을 때 온 알림의 위쪽 배너 (2026-11-11, CLAUDE.md 규칙 79) — 띄울지는 lib/pushBanner.ts 가 정한다.
 * 누르면 알림을 누른 것과 같다(읽음 처리 + 그 화면, native.ts openNotification). 브라우저에서는 아무도 띄우지 않아 그리지 않는다.
 */
export default function PushBanner() {
  const item = useSyncExternalStore(subscribePushBanner, getPushBanner, () => null);

  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => dismissPushBanner(item.key), PUSH_BANNER_MS);
    return () => clearTimeout(t);
  }, [item]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-[70] flex justify-center px-3" role="status" aria-live="polite">
      <AnimatePresence>
        {item && (
          <motion.div
            key={item.key}
            initial={{ y: -24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex w-full max-w-md items-start gap-1 rounded-2xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur"
            data-testid="push-banner"
          >
            <button
              type="button"
              onClick={() => { dismissPushBanner(item.key); void openNotification(item.data); }}
              className="min-w-0 flex-1 px-4 py-3 text-left"
            >
              <p className="text-xs font-semibold text-gray-900">{item.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-gray-700 break-keep [overflow-wrap:anywhere]">{item.body}</p>
            </button>
            <button
              type="button"
              onClick={() => dismissPushBanner(item.key)}
              aria-label="알림 닫기"
              className="m-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
