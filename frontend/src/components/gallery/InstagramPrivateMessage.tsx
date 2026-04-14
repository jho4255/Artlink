/**
 * InstagramPrivateMessage - Instagram 피드 비공개 상태 안내
 *
 * 갤러리 오너에게는 "마이페이지에서 설정하기" 버튼 노출
 */
import { useNavigate } from 'react-router-dom';
import { Instagram } from 'lucide-react';

interface InstagramPrivateMessageProps {
  isOwner: boolean;
}

export default function InstagramPrivateMessage({ isOwner }: InstagramPrivateMessageProps) {
  const navigate = useNavigate();

  return (
    <div className="border border-dashed border-gray-200 rounded-lg p-6 flex flex-col items-center text-center">
      <Instagram size={24} className="text-gray-300 mb-2" />
      <p className="text-sm text-gray-400">Instagram 피드가 비공개 상태입니다.</p>
      {isOwner && (
        <button
          onClick={() => navigate('/mypage')}
          className="mt-3 text-sm text-gray-400 hover:text-gray-900"
        >
          마이페이지에서 설정하기
        </button>
      )}
    </div>
  );
}
