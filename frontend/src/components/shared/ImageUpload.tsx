import { useState, useRef, type ReactNode } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { compressImage, MAX_IMAGE_BYTES } from '@/lib/utils';

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onRemove?: () => void;
  className?: string;
  placeholder?: string;
}

// 단일 이미지 업로드 컴포넌트
export default function ImageUpload({ value, onChange, onRemove, className = '', placeholder = '이미지 업로드' }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 드래그앤드롭으로 떨어뜨린 첫 이미지 파일 업로드
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (file) handleUpload(file);
    else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };

  const handleUpload = async (rawFile: File) => {
    setUploading(true);
    try {
      const file = await compressImage(rawFile);
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`이미지 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
        return;
      }
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(res.data.url);
      toast.success('이미지가 업로드되었습니다.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      {value ? (
        <div className="relative group">
          <img src={value} alt="" className="w-full h-40 object-cover rounded-lg" />
          {/* 터치 기기에는 hover가 없으므로 항상 노출(md 이상에서만 hover 게이트), 히트 영역 44px */}
          {onRemove && (
            <button
              onClick={onRemove}
              aria-label="이미지 삭제"
              className="absolute top-0 right-0 min-h-[44px] min-w-[44px] flex items-start justify-end p-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            >
              <span className="p-1 bg-accent text-white rounded-full shadow"><X size={14} /></span>
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`w-full h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${dragOver ? 'border-gray-500 bg-gray-50 text-gray-600' : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-500'}`}
        >
          {uploading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
          <span className="text-sm mt-2">{uploading ? '업로드 중...' : dragOver ? '여기에 놓기' : placeholder}</span>
          {!uploading && !dragOver && <span className="text-xs mt-0.5 text-gray-300">클릭 또는 드래그</span>}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

interface MultiImageUploadProps {
  images: { id?: number; url: string }[];
  /**
   * 한 장 올릴 때마다 부른다. ⚠️ 여러 장을 한꺼번에 고르면 **연달아 여러 번** 불리므로, 부르는 쪽은 반드시
   * 함수형 갱신(`setX(prev => [...prev, url])`)으로 받을 것 — 렌더 시점의 배열에 붙이면 마지막 한 장만 남는다
   * (갤러리 지난 활동 기록이 그랬다, 2026-09-27).
   */
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  maxCount?: number;
  /** 사진 칸 아래에 붙일 것(예: 사진마다 설명 입력칸). 있으면 칸이 넓어지도록 열 수를 줄인다 */
  renderBelow?: (index: number) => ReactNode;
}

// 다중 이미지 업로드 컴포넌트 (한번에 여러 장 선택 가능)
// 미리보기 칸은 정사각 + contain — 자르지 않는다(CLAUDE.md 18). 예전엔 h-24 + object-cover 라 세로 작품이 가운데만 보였다.
export function MultiImageUpload({ images, onAdd, onRemove, maxCount = 30, renderBelow }: MultiImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      handleUploadMultiple(dt.files);
    } else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };

  const handleUploadMultiple = async (files: FileList) => {
    const remaining = maxCount - images.length;
    if (remaining <= 0) {
      toast.error(`이미지는 최대 ${maxCount}장까지 등록 가능합니다.`);
      return;
    }
    const fileArray = Array.from(files).slice(0, remaining);
    setUploading(true);
    setUploadCount(fileArray.length);
    let successCount = 0;
    for (const rawFile of fileArray) {
      try {
        const file = await compressImage(rawFile);
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${rawFile.name}: 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
          continue;
        }
        const formData = new FormData();
        formData.append('image', file);
        const res = await api.post('/upload/image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        onAdd(res.data.url);
        successCount++;
      } catch {
        toast.error(`${rawFile.name} 업로드 실패`);
      }
    }
    if (successCount > 0) toast.success(`${successCount}장 업로드 완료`);
    setUploading(false);
    setUploadCount(0);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={handleDrop}
      className={dragOver ? 'rounded-lg ring-2 ring-gray-400 ring-offset-2' : ''}
    >
      <div className={`grid gap-2 ${renderBelow ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4'}`}>
        {images.map((img, i) => (
          <div key={img.id ?? `${img.url}-${i}`} className="min-w-0">
            <div className="relative group aspect-square rounded-lg bg-gray-50">
              <img src={img.url} alt="" className="h-full w-full object-contain" />
              {/* 터치 기기에는 hover가 없으므로 항상 노출(md 이상에서만 hover 게이트), 히트 영역 44px */}
              <button
                onClick={() => onRemove(i)}
                aria-label="이미지 삭제"
                className="absolute top-0 right-0 min-h-[44px] min-w-[44px] flex items-start justify-end p-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              >
                <span className="p-1 bg-accent text-white rounded-full shadow"><X size={12} /></span>
              </button>
            </div>
            {renderBelow?.(i)}
          </div>
        ))}
        {images.length < maxCount && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`aspect-square border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${dragOver ? 'border-gray-500 text-gray-600 bg-gray-50' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}
          >
            {uploading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span className="text-xs mt-1">{uploadCount}장 처리중</span>
              </>
            ) : (
              <>
                <Upload size={18} />
                <span className="text-xs mt-1">{images.length}/{maxCount}</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleUploadMultiple(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
