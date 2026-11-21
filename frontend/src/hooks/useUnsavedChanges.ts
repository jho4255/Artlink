/**
 * useUnsavedChanges - 미저장 변경사항 이탈 경고 훅
 *
 * 막는 경로 3가지:
 *  1) 브라우저 닫기 / 새로고침  → beforeunload (문구는 브라우저 기본, 커스텀 불가)
 *  2) 브라우저 뒤로가기          → 가드용 히스토리 항목 + popstate 확인
 *  3) 앱 안의 링크 클릭          → 캡처 단계에서 가로채 confirm
 *
 * react-router의 useBlocker를 쓰지 않는 이유: 그건 데이터 라우터(createBrowserRouter)
 * 전용인데 이 앱은 <BrowserRouter>를 쓴다.
 *
 * 구현 주의점 (실제로 겪은 버그들):
 *  - 뒤로가기 confirm 수락 후 history.back()이 다시 popstate를 울린다 → leaving 플래그로
 *    한 번만 처리하지 않으면 confirm이 두 번 뜨고 두 페이지를 되돌아간다.
 *  - 가드 항목을 정리(cleanup)에서 걷어내지 않으면 저장 후에도 항목이 쌓여
 *    뒤로가기를 여러 번 눌러야 나가진다. state에 표식을 넣어 우리 항목일 때만 걷어낸다.
 *
 * @see Phase 4 - 폼 UX 개선
 */
import { useEffect } from 'react';

const DEFAULT_MESSAGE = '저장하지 않은 내용이 있습니다.\n이 페이지를 벗어나면 작성 중인 내용이 사라집니다.\n\n그래도 나가시겠습니까?';
const GUARD = '__unsavedGuard';

/**
 * 지금 화면에 떠 있는 '저장 안 된 입력' — 페이지를 떠나지 않고 **화면 안에서** 입력을 떼어 내는 동작(카드 접기·다른 카드 열기·
 * 목록 필터 바꾸기)이 먼저 묻게 한다(2026-10-03 공모 흐름 점검 P1-2). 위 세 경로는 페이지 이동만 막아서, 정산 판매가·출품 자료를
 * 적다가 카드를 접으면 경고 없이 사라졌다.
 */
const active = new Set<{ message: string }>();

/** 저장 안 된 입력이 있는가 */
export function hasUnsavedChanges(): boolean {
  return active.size > 0;
}

/**
 * 다른 페이지로 옮겨도 되는가 — **링크(a)가 아닌 이동**(벨 알림·앱 알림 배너의 navigate())은 위 세 경로가 못 봐서
 * 부르는 쪽이 먼저 묻는다(2026-11-21 e2e 89 REL-20 — 정산 금액을 쓰다 벨 알림을 누르면 말없이 사라졌다).
 * 저장 안 된 입력이 없으면 바로 true. 문구는 그 입력의 '이 페이지를 벗어나면…' 그대로.
 */
export function confirmLeaveUnsaved(): boolean {
  const first = active.values().next().value as { message: string } | undefined;
  if (!first) return true;
  // eslint-disable-next-line no-alert
  return window.confirm(first.message);
}

/** 버려도 되는가 — 저장 안 된 입력이 없으면 바로 true, 있으면 묻는다(문구는 그 입력의 것) */
export function confirmDiscardUnsaved(): boolean {
  const first = active.values().next().value as { message: string } | undefined;
  if (!first) return true;
  // eslint-disable-next-line no-alert
  return window.confirm(first.message.replace('이 페이지를 벗어나면', '닫으면').replace('그래도 나가시겠습니까?', '그래도 닫을까요?'));
}

export function useUnsavedChanges(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!isDirty) return;
    const entry = { message };
    active.add(entry);

    let leaving = false; // 뒤로가기 confirm 수락 후 재진입 방지

    // 1) 닫기 / 새로고침
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 표준 방식: returnValue 설정 (대부분의 브라우저에서 커스텀 메시지는 무시됨)
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // 2) 뒤로가기 — 가드 항목을 하나 쌓아두고, 뒤로 갈 때 확인 후 진행/복원
    window.history.pushState({ [GUARD]: true }, '', window.location.href);
    const onPopState = () => {
      if (leaving) return;
      // eslint-disable-next-line no-alert
      if (window.confirm(message)) {
        leaving = true;
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.history.back();
      } else {
        window.history.pushState({ [GUARD]: true }, '', window.location.href);
      }
    };
    window.addEventListener('popstate', onPopState);

    // 3) 앱 내부 링크 클릭 (Navbar 등) — 라우터가 처리하기 전에 캡처 단계에서 확인
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // 외부 링크·새 탭·앵커 이동은 그대로 둔다 (새 탭은 현재 페이지를 떠나지 않음)
      if (!href.startsWith('/') || anchor.target === '_blank') return;
      if (href === window.location.pathname) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation(); }
      else leaving = true;
    };
    document.addEventListener('click', onClick, true);

    return () => {
      active.delete(entry);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
      // 저장 등으로 dirty가 풀렸을 때: 우리가 쌓은 가드 항목이 그대로면 걷어낸다
      // (안 걷으면 뒤로가기를 두 번 눌러야 나가진다). 이탈 중이면 이미 소비된 상태.
      /*
        ⚠️ 이 판단은 **같은 렌더의 효과가 다 돈 뒤에**(microtask) 한다(2026-11-21). 화면이 통째로 내려가며 다른 곳으로 옮겨질 때 —
        로그인이 풀려 ProtectedRoute 가 <Navigate to="/login" replace> 를 그리면 — 이 정리가 그 이동보다 **먼저** 돈다.
        그 자리에서 back() 을 부르면, 곧이어 /login 으로 바뀐 기록을 그 back() 이 되감아 쓰던 화면 주소로 돌아가고,
        로그아웃된 채 빈 화면에 멈췄다(공모 흐름 점검 REL-12 — 쓰던 정산·출품 자료·지원서가 있을 때만). 이동이 끝난 뒤엔
        지금 기록이 가드 항목이 아니므로 걷지 않는다.
      */
      if (!leaving) {
        queueMicrotask(() => {
          if ((window.history.state as Record<string, unknown> | null)?.[GUARD]) window.history.back();
        });
      }
    };
  }, [isDirty, message]);
}
