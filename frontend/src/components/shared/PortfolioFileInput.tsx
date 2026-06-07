import { useState, useRef } from 'react';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { safeHttpUrl } from '@/lib/utils';

interface PortfolioFileInputProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

const ACCEPT = '.pdf,.doc,.docx,.hwp,.hwpx';

// URL에서 표시용 파일명 추출
function fileNameFromUrl(url: string): string {
  try {
    const path = url.split('?')[0];
    const name = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1));
    return name || '포트폴리오 파일';
  } catch {
    return '포트폴리오 파일';
  }
}

/**
 * 포트폴리오 파일(pdf/doc/hwp) 업로드 컴포넌트 — 단일 파일.
 * POST /upload/file 사용. 첨부 후 파일명 + 보기 링크 + 삭제 버튼 표시.
 */
export default function PortfolioFileInput({ value, onChange, disabled }: PortfolioFileInputProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/upload/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(res.data.url);
      toast.success('포트폴리오 파일이 첨부되었습니다.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '파일 업로드에 실패했습니다. (pdf/doc/hwp, 최대 20MB)');
    } finally {
      setUploading(false);
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg">
        <FileText size={18} className="text-gray-500 shrink-0" />
        <a
          href={safeHttpUrl(value) ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="flex-1 min-w-0 text-sm text-gray-700 truncate hover:underline"
        >
          {fileNameFromUrl(value)}
        </a>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="파일 삭제"
            className="shrink-0 p-1 text-gray-400 hover:text-red-500 cursor-pointer"
          >
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || disabled}
        className="w-full h-16 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center gap-2 text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
        <span className="text-sm">{uploading ? '업로드 중...' : 'PDF / DOC / HWP 파일 첨부'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
