import { FileText } from 'lucide-react';
import type { Career } from '@/types';

const LABELS: { key: keyof Career; label: string }[] = [
  { key: 'artFair', label: '아트페어' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
];

function normalizeCareer(c?: Career | null): Career {
  return { artFair: c?.artFair ?? [], solo: c?.solo ?? [], group: c?.group ?? [] };
}

export interface ApplicationLike {
  biography?: string | null;
  career?: Career | null;
  artworkImages?: string[] | null;
  portfolioFileUrl?: string | null;
}

interface Props {
  app: ApplicationLike;
  /** 작품 사진 클릭 시 라이트박스 오픈 */
  onImageClick?: (images: string[], index: number) => void;
}

/**
 * 지원서 제출 내용 표시 — 작가 약력 / 경력(아트페어·개인전·단체전) / 작품 사진 / 포트폴리오 파일.
 * 갤러리 지원자 관리 + Admin 오버사이트 공용.
 */
export default function ApplicationContent({ app, onImageClick }: Props) {
  const career = normalizeCareer(app.career);
  const images = app.artworkImages ?? [];
  const careerEmpty = career.artFair.length === 0 && career.solo.length === 0 && career.group.length === 0;

  return (
    <div className="space-y-2 bg-gray-50 rounded-lg p-3">
      <p className="text-xs font-medium text-gray-600">📋 지원서 내용</p>

      {/* 작가 약력 */}
      <div>
        <p className="text-xs text-gray-400 mb-0.5">작가 약력</p>
        <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">{app.biography || '-'}</p>
      </div>

      {/* 경력 */}
      <div>
        <p className="text-xs text-gray-400 mb-0.5">경력</p>
        {careerEmpty ? (
          <p className="text-xs text-gray-400">없음</p>
        ) : (
          <div className="space-y-1">
            {LABELS.map(({ key, label }) => career[key].length > 0 && (
              <div key={key}>
                <p className="text-[11px] font-medium text-gray-500">{label}</p>
                <ul className="space-y-0.5">
                  {career[key].map((e, i) => (
                    <li key={i} className="text-xs text-gray-700">
                      <span className="text-gray-400 mr-1.5">{e.year}</span>{e.content}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 작품 사진 */}
      <div>
        <p className="text-xs text-gray-400 mb-1">작품 사진 ({images.length}장)</p>
        {images.length === 0 ? (
          <p className="text-xs text-gray-400">없음</p>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {images.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`작품 ${idx + 1}`}
                className="w-full aspect-square object-cover rounded cursor-pointer hover:opacity-80"
                onClick={() => onImageClick?.(images, idx)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 포트폴리오 파일 */}
      <div>
        <p className="text-xs text-gray-400 mb-0.5">포트폴리오 파일</p>
        {app.portfolioFileUrl ? (
          <a href={app.portfolioFileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-700 hover:underline">
            <FileText size={13} /> 파일 보기
          </a>
        ) : (
          <p className="text-xs text-gray-400">없음</p>
        )}
      </div>
    </div>
  );
}
