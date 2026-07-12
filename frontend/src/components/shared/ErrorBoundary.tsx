import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean }

/**
 * 라우트 렌더/지연로딩 오류를 잡아 흰 화면 대신 복구 UI를 보여준다.
 * 특히 새 배포 후 이전 청크가 404 나는 경우(lazyWithReload가 새로고침을 시도하고,
 * 그래도 실패하면 여기로) 사용자에게 새로고침 버튼을 제공한다.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-gray-700 font-medium">화면을 불러오지 못했어요.</p>
          <p className="text-sm text-gray-400">앱이 업데이트되었을 수 있어요. 새로고침하면 해결됩니다.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700"
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
