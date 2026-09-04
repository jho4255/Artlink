import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import type { CommunityTab } from '@/components/community/TabManager';

/**
 * 커뮤니티 글쓰기 — 전용 페이지(모달 아님). 블라인드 글쓰기 화면을 우리 스타일로.
 *   상단: [취소] · [등록]   /   제목 · 내용   /   하단 툴바: [사진] · [익명]
 *   사진은 /api/upload/image 로 올린 뒤 그 주소로 글에 첨부(우리 저장소만, 서버가 재검증).
 */
export default function CommunityWritePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  // Admin 전용 — 서버가 role 로 다시 막으므로 화면 상태는 편의일 뿐이다
  const [notice, setNotice] = useState(false);
  const [pinned, setPinned] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tabs } = useQuery<CommunityTab[]>({
    queryKey: ['community-tabs'],
    queryFn: () => api.get('/community/categories').then((r) => r.data),
  });

  const writableTabs = (tabs ?? []).filter((t) => t.active && (isAdmin || !t.writeAdminOnly));

  const create = useMutation({
    mutationFn: () => api.post('/community', {
      title: title.trim(), body: body.trim(), anonymous, images,
      categoryId: categoryId === '' ? null : categoryId,
      ...(isAdmin ? { notice, pinned } : {}),
    }).then((r) => r.data),
    onSuccess: (data: { id: number }) => {
      queryClient.invalidateQueries({ queryKey: ['community'] });
      queryClient.invalidateQueries({ queryKey: ['community-popular'] });
      navigate(`/community/${data.id}`, { replace: true });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '등록에 실패했습니다.'),
  });

  const onPickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const room = 10 - images.length;
    if (room <= 0) { toast.error('사진은 10장까지입니다.'); return; }
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, room)) {
        if (file.size > 15 * 1024 * 1024) { toast.error('사진은 최대 15MB 까지입니다.'); continue; }
        const form = new FormData();
        form.append('image', file);
        const { data } = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        urls.push(data.url);
      }
      setImages((prev) => [...prev, ...urls]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || '사진 업로드 실패');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSubmit = !!title.trim() && !!body.trim() && !create.isPending && !uploading;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col px-4 md:px-6">
      {/* 상단 바 — 취소 / 등록 */}
      <div className="flex items-center justify-between border-b border-gray-100 py-3">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-900">취소</button>
        <button
          onClick={() => create.mutate()}
          disabled={!canSubmit}
          className={`text-sm font-semibold ${canSubmit ? 'text-[#dc3545]' : 'text-gray-300'}`}
        >
          {create.isPending ? '등록 중…' : '등록'}
        </button>
      </div>

      {/* 제목 */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="제목을 입력해주세요."
        className="mt-2 w-full border-b border-gray-100 py-3 text-lg font-semibold text-gray-900 placeholder:text-gray-300 focus:outline-none"
      />

      {/* 내용 */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 5000))}
        placeholder="내용을 입력해주세요."
        className="mt-2 min-h-[240px] flex-1 resize-none py-2 text-[15px] leading-relaxed text-gray-800 placeholder:text-gray-300 focus:outline-none"
      />

      {/* 첨부한 사진 미리보기 */}
      {images.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((url, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-lg border border-gray-100">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                aria-label="사진 삭제"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 하단 툴바 — 사진 / 익명 */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t border-gray-100 bg-white py-3">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || images.length >= 10}
          aria-label="사진 첨부"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
        </button>
        <span className="text-xs text-gray-400">{images.length}/10</span>

        {/* 탭(말머리) — Admin 이 만든 탭이 있을 때만 보인다. 없으면 '미분류'로 들어간다.
            ⚠️ **쓸 수 없는 탭은 아예 안 보여준다** — 고르게 해 놓고 등록에서 403 을 주면 함정이다.
               서버도 같은 규칙으로 다시 막는다(화면만 감추는 건 권한이 아니다). */}
        {writableTabs.length > 0 && (
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700 focus:border-gray-500 focus:outline-none"
          >
            <option value="">탭 없음</option>
            {writableTabs.map((t) => <option key={t.id} value={t.id}>{t.name}{t.writeAdminOnly ? ' (관리자)' : ''}</option>)}
          </select>
        )}

        {/* ⚠️ 공지·고정은 **Admin 에게만** 보인다. 감추는 것만으로는 권한이 아니라서
            서버가 role 로 한 번 더 막는다(클라이언트가 보냈다고 켜지지 않는다). */}
        {isAdmin && (
          <>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600" title="공지글로 표시합니다 (관리자)">
              <input
                type="checkbox" checked={notice}
                onChange={(e) => { setNotice(e.target.checked); if (e.target.checked) setAnonymous(false); }}
                className="accent-[#c4302b]"
              />
              공지
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600" title="목록 맨 위에 고정합니다 (관리자)">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-amber-600" />
              고정
            </label>
          </>
        )}

        <label className={`ml-auto flex items-center gap-1.5 text-sm ${notice ? 'cursor-not-allowed text-gray-300' : 'cursor-pointer text-gray-600'}`}
          title={notice ? '공지는 익명으로 쓸 수 없습니다' : undefined}>
          <input
            type="checkbox" checked={anonymous} disabled={notice}
            onChange={(e) => setAnonymous(e.target.checked)} className="accent-gray-900"
          />
          익명
        </label>
      </div>
    </div>
  );
}
