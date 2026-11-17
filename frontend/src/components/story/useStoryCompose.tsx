/**
 * [+] — 곧바로 소식 올리기 화면(`/story/new`)으로 간다 (2026-11-14 사용자 결정 — 사진/글을 먼저 고르는 창은 없앴다).
 * 그 화면 한 장에서 글·사진·사진 위 글·공개 범위를 다 정한다(인스타 스토리 만들기처럼).
 * 로그인 안 했으면 로그인으로(돌아올 곳은 지금 화면).
 */
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';

/** 올리기 화면이 받는 라우터 state — 닫으면 돌아갈 곳(새 탭·새로고침으로 기록이 없을 때) */
export interface StoryComposeState { from?: string }

export function useStoryCompose() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuthStore();
  const from = location.pathname + location.search;

  const start = () => {
    if (!isAuthenticated) {
      setPostLoginRedirect(from);
      toast('로그인하고 올릴 수 있어요.');
      navigate('/login');
      return;
    }
    navigate('/story/new', { state: { from } satisfies StoryComposeState });
  };

  return { start };
}
