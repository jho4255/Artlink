import { Toaster } from 'react-hot-toast';
import { TOAST_OPTIONS } from '@/lib/toastOptions';
import { useViewport } from '@/hooks/useViewport';

/**
 * 전역 토스트 — 넓은 화면은 아래 가운데, **좁은 화면(lg 미만)은 위쪽**(상단바 바로 아래) (2026-10-03 점검).
 * 휴대폰에선 하단 탭바 위에 저장 줄(지원서·출품 자료·홈페이지 편집)이 붙어 있는데, 아래에 뜬 토스트가 그 줄의 버튼을 4~5초 가렸다.
 * ⚠️ z-index: 모달(z-9999)·중첩 모달(z-10000) 위에 떠야 한다 — 어두운 오버레이 뒤로 가려져 안내를 못 보는 문제가 있었다.
 * duration 등 세부 설정과 그 이유는 lib/toastOptions.ts.
 */
export default function AppToaster() {
  const { w } = useViewport();
  const narrow = w < 1024;
  return (
    <Toaster
      position={narrow ? 'top-center' : 'bottom-center'}
      // 상단바 h-16(64px) 아래로
      containerStyle={narrow ? { zIndex: 100000, top: 72 } : { zIndex: 100000 }}
      toastOptions={TOAST_OPTIONS}
    />
  );
}
