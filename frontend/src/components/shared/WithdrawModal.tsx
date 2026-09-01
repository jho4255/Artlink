import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';

/**
 * 회원 탈퇴 모달.
 *
 * 원래 마이페이지 프로필 탭 안에 있었는데, 프로필을 고치러 들어간 사람 눈앞에 빨간 [회원 탈퇴]가
 * 늘 놓여 있는 게 맞지 않아 **고객센터 우측 하단**으로 옮겼다(2026-08-27). 컴포넌트는 그대로다.
 *
 * 탈퇴는 소프트 삭제 + 익명화다(`User.deletedAt`) — 행은 남기고 로그인만 막는다.
 * 영향 요약(보유 갤러리·진행 중 공고·처리 대기 지원자)을 먼저 보여주고,
 * 본인확인 방식은 계정 종류에 따라 비밀번호 또는 문구 입력으로 갈린다.
 */
interface WithdrawInfo {
  role: string;
  confirmMethod: 'password' | 'text';
  galleries: { id: number; name: string; status: string }[];
  ongoingExhibitions: number;
  activeApplicants: number;
  myApplications: number;
  myReviews: number;
}
export default function WithdrawModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logout } = useAuthStore();
  const [info, setInfo] = useState<WithdrawInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchInfo = () => {
    setLoading(true);
    setLoadError(false);
    api.get('/auth/me/withdraw-info')
      .then(({ data }) => setInfo(data))
      .catch(() => { setLoadError(true); toast.error('정보를 불러오지 못했습니다.'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasGalleries = (info?.galleries.length ?? 0) > 0;
  const confirmOk = info?.confirmMethod === 'password' ? password.length > 0 : confirmText.trim() === '탈퇴';
  const canSubmit = !submitting && !!info && confirmOk && (!hasGalleries || acknowledge);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.delete('/auth/me', {
        data: info?.confirmMethod === 'password'
          ? { password }
          : { confirmText: confirmText.trim(), acknowledge },
      });
      toast.success('회원 탈퇴가 완료되었습니다.');
      queryClient.clear();
      logout();
      navigate('/login');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.response?.data?.message || '탈퇴에 실패했습니다.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-1.5">
            <AlertTriangle size={18} className="text-red-500" /> 회원 탈퇴
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="닫기"><X size={20} /></button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : loadError ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-gray-500">정보를 불러오지 못했습니다.</p>
            <button
              onClick={fetchInfo}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">
              탈퇴하면 이름·이메일·연락처 등 <strong>개인정보가 즉시 삭제</strong>되고 계정으로 다시 로그인할 수 없습니다. 이 작업은 되돌릴 수 없습니다.
            </p>

            {/* 갤러리 보유 시 영향 안내 + 책임 고지 */}
            {hasGalleries && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="font-medium text-red-700">보유하신 갤러리·공모가 함께 비공개 처리됩니다.</p>
                <ul className="text-xs text-red-700/90 list-disc pl-4 space-y-0.5">
                  <li>갤러리 {info!.galleries.length}개 — {info!.galleries.map((g) => g.name).join(', ')}</li>
                  <li>진행 중인 공고 {info!.ongoingExhibitions}건이 마감 처리됩니다.</li>
                  <li>처리 대기 중인 지원자 {info!.activeApplicants}명의 관리가 불가능해집니다.</li>
                </ul>
                <p className="text-xs text-red-700">
                  진행 중인 공고와 지원자가 있다면 <strong>정리 후 탈퇴</strong>를 권장합니다.
                  탈퇴를 진행할 경우 <strong>진행 중 공고·지원자에 대한 모든 책임은 본인에게 있습니다.</strong>
                </p>
                <label className="flex items-start gap-2 text-xs text-gray-700 pt-1">
                  <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} className="rounded mt-0.5" />
                  <span>위 내용을 확인했으며, 진행 중 공고·지원자에 대한 모든 책임이 본인에게 있음에 동의합니다.</span>
                </label>
              </div>
            )}

            {/* 본인 확인 */}
            {info?.confirmMethod === 'password' ? (
              <div>
                <label className="block font-medium text-gray-700 mb-1">비밀번호 확인</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="현재 비밀번호"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
            ) : (
              <div>
                <label className="block font-medium text-gray-700 mb-1">확인을 위해 <span className="text-red-600 font-semibold">탈퇴</span> 를 입력하세요.</label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="탈퇴"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '처리 중...' : '탈퇴하기'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
