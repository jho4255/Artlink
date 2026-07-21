import { useState, useRef } from 'react';
import { Upload, Loader2, ImagePlus, X } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { compressImage, MAX_IMAGE_BYTES } from '@/lib/utils';

/**
 * 상세 페이지 디자인 위에서 바로 편집(WYSIWYG)하기 위한 인라인 편집 요소들.
 * - 평소엔 최종 텍스트처럼 보이고, 호버/포커스 시 편집 가능함을 드러냄.
 */

interface EditableTextProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;   // 텍스트 스타일 (크기/굵기/색)
  error?: boolean;
  rows?: number;
  maxLength?: number;
}

export function EditableText({ value, onChange, placeholder, multiline, className, error, rows = 4, maxLength }: EditableTextProps) {
  const base = cn(
    'w-full bg-transparent rounded-md px-2 py-1 -mx-2 transition-colors outline-none',
    'border border-dashed',
    error ? 'border-red-400 bg-red-50/40' : 'border-transparent hover:border-gray-300 focus:border-gray-400 focus:bg-gray-50',
    'placeholder:text-gray-300 placeholder:font-normal',
    className,
  );
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={cn(base, 'resize-y leading-relaxed')}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={base}
    />
  );
}

interface HeroImageEditProps {
  value?: string;
  onChange: (url: string) => void;
  onRemove?: () => void;
  className?: string;   // 래퍼 크기/비율 (예: 'aspect-[4/3]')
  label?: string;
  error?: boolean;
}

/** 상세 페이지 대표 이미지 자리 — 클릭하면 업로드, 호버 시 변경/삭제 */
export function HeroImageEdit({ value, onChange, onRemove, className, label = '대표 이미지', error }: HeroImageEditProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find(file => file.type.startsWith('image/'));
    if (f) handle(f);
    else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };

  const handle = async (raw: File) => {
    setUploading(true);
    try {
      const file = await compressImage(raw);
      if (file.size > MAX_IMAGE_BYTES) { toast.error(`이미지 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`); return; }
      const fd = new FormData();
      fd.append('image', file);
      const res = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(res.data.url);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || '이미지 업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={cn('relative group bg-gray-100 overflow-hidden', error && 'ring-2 ring-red-300', dragOver && 'ring-2 ring-gray-500', className)}
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}
    >
      {value ? (
        <>
          <img src={value} alt="" className="w-full h-full object-cover" />
          {/* 터치 기기에는 hover가 없으므로 모바일에서는 항상 노출, md 이상에서만 hover 게이트 */}
          <div className="absolute inset-0 bg-black/20 md:bg-black/0 md:group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100">
            <button type="button" onClick={() => inputRef.current?.click()} className="px-3 min-h-[40px] bg-white/90 text-gray-800 text-xs rounded-lg flex items-center gap-1">
              <Upload size={13} /> 변경
            </button>
            {onRemove && (
              <button type="button" onClick={onRemove} className="px-3 min-h-[40px] bg-white/90 text-red-500 text-xs rounded-lg flex items-center gap-1">
                <X size={13} /> 삭제
              </button>
            )}
          </div>
        </>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-gray-500 hover:bg-gray-50 transition-colors">
          {uploading ? <Loader2 size={26} className="animate-spin" /> : <ImagePlus size={26} strokeWidth={1.5} />}
          <span className="text-sm">{uploading ? '업로드 중...' : dragOver ? '여기에 놓기' : `${label} 추가`}</span>
          {!uploading && !dragOver && <span className="text-xs text-gray-300">클릭 또는 드래그</span>}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
    </div>
  );
}
