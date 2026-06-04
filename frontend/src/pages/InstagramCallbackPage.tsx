/**
 * InstagramCallbackPage - Instagram OAuth 콜백 처리
 *
 * 흐름: MyPage [연동하기] → instagram.com/oauth/authorize → 이 페이지(?code=&state=)
 *  → 백엔드 POST /galleries/:id/instagram/connect 로 code 교환 → MyPage 복귀
 *
 * 로그인된 갤러리 오너 동작이므로 (로그인 플로우인 AuthCallbackPage와 별개) JWT가 필요하다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { useQueryClient } from '@tanstack/react-query';

export default function InstagramCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const ran = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const finish = (msg: string, ok: boolean) => {
      if (ok) toast.success(msg);
      else { toast.error(msg); setError(msg); }
      navigate('/mypage?tab=my-galleries', { replace: true });
    };

    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');
    const savedState = sessionStorage.getItem('ig_oauth_state');
    const galleryId = sessionStorage.getItem('ig_oauth_gallery');
    sessionStorage.removeItem('ig_oauth_state');
    sessionStorage.removeItem('ig_oauth_gallery');

    if (oauthError) {
      finish('Instagram 연동이 취소되었습니다.', false);
      return;
    }
    if (!code || !state || !galleryId || state !== savedState) {
      finish('Instagram 연동 요청이 올바르지 않습니다. 다시 시도해주세요.', false);
      return;
    }

    const redirectUri = `${window.location.origin}/auth/instagram/callback`;
    api
      .post(`/galleries/${galleryId}/instagram/connect`, { code, redirectUri })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
        queryClient.invalidateQueries({ queryKey: ['galleries'] });
        queryClient.invalidateQueries({ queryKey: ['gallery'] });
        finish('Instagram이 연동되었습니다.', true);
      })
      .catch((err) => {
        finish(err.response?.data?.error || 'Instagram 연동에 실패했습니다.', false);
      });
  }, [isAuthenticated, navigate, queryClient, searchParams]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-gray-500">
      {!error && <Loader2 size={28} className="animate-spin mb-3" />}
      <p className="text-sm">{error || 'Instagram 연동 처리 중...'}</p>
    </div>
  );
}
