import type { ToastOptions } from 'react-hot-toast';

/**
 * 전역 토스트 설정 (main.tsx의 <Toaster toastOptions={...}>)
 *
 * ⚠️ **로딩 토스트는 duration: Infinity 여야 한다.**
 * react-hot-toast는 loading 타입의 기본 duration이 Infinity지만,
 * `toastOptions.duration`을 주면 **모든 타입에 일괄 적용**되어 로딩 토스트도 그 시간이 지나면 사라진다.
 * 전역 3초만 두었더니 운영페이지의 "N/M장 모으는 중" 진행률이 3초마다 사라졌다가
 * 다음 진행 콜백에서 다시 생기는 **깜빡임**이 발생했다(2026-08 신고).
 * 진행률은 작업이 끝날 때까지 유지되어야 하므로 loading만 Infinity로 되돌린다.
 *
 * 로딩 토스트는 전부 `const t = toast.loading(...)` → `toast.success/error(..., { id: t })`로
 * try/catch/finally에서 반드시 닫는다. 닫지 않으면 Infinity라 영원히 남으므로 주의.
 */
export const TOAST_OPTIONS: ToastOptions & { loading: ToastOptions } = {
  duration: 3000,
  style: { fontSize: '14px', borderRadius: '12px' },
  loading: { duration: Infinity },
};
