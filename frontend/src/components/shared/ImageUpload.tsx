import { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(res.data.url);
      toast.success('이미지가 업로드되었습니다.');
    } catch {
      toast.error('이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      {value ? (
        <div className="relative group">
          <img src={value} alt="" className="w-full h-40 object-cover rounded-lg" />
          {onRemove && (
            <button
              onClick={onRemove}
              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-40 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
        >
          {uploading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
          <span className="text-sm mt-2">{uploading ? '업로드 중...' : placeholder}</span>
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
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  maxCount?: number;
}

// 다중 이미지 업로드 컴포넌트 (한번에 여러 장 선택 가능)
export function MultiImageUpload({ images, onAdd, onRemove, maxCount = 30 }: MultiImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
    for (const file of fileArray) {
      try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await api.post('/upload/image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        onAdd(res.data.url);
        successCount++;
      } catch {
        toast.error(`${file.name} 업로드 실패`);
      }
    }
    if (successCount > 0) toast.success(`${successCount}장 업로드 완료`);
    setUploading(false);
    setUploadCount(0);
  };

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {images.map((img, i) => (
          <div key={i} className="relative group">
            <img src={img.url} alt="" className="w-full h-24 object-cover rounded-lg" />
            <button
              onClick={() => onRemove(i)}
              className="absolute top-1 right-1 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {images.length < maxCount && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-24 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-gray-400 transition-colors"
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
