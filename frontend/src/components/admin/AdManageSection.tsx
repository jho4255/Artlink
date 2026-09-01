import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import ImageUpload from '@/components/shared/ImageUpload';

/**
 * 광고 관리 (Admin) — 사이드바 하단 광고 슬롯(`AdSlot`)에 뜨는 배너를 등록/수정/삭제.
 * 활성 배너 중 position 이 작은 것이 노출된다. 이미지는 필수, 링크·제목은 선택.
 */
interface Ad { id: number; imageUrl: string; title: string; linkUrl: string; active: boolean; position: number }
const EMPTY = { imageUrl: '', title: '', linkUrl: '', active: true, position: 0 };

export default function AdManageSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data: ads = [] } = useQuery<Ad[]>({
    queryKey: ['ads-all'],
    queryFn: () => api.get('/ads/all').then((r) => r.data),
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['ads-all'] }); qc.invalidateQueries({ queryKey: ['ads'] }); };

  const reset = () => { setShowForm(false); setEditingId(null); setForm(EMPTY); };

  const save = useMutation({
    mutationFn: () => (editingId ? api.patch(`/ads/${editingId}`, form) : api.post('/ads', form)),
    onSuccess: () => { invalidate(); reset(); toast.success(editingId ? '광고를 수정했습니다.' : '광고를 등록했습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장에 실패했습니다.'),
  });

  const toggle = useMutation({
    mutationFn: (ad: Ad) => api.patch(`/ads/${ad.id}`, { active: !ad.active }),
    onSuccess: invalidate,
    onError: () => toast.error('변경에 실패했습니다.'),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/ads/${id}`),
    onSuccess: () => { invalidate(); toast.success('삭제했습니다.'); },
    onError: () => toast.error('삭제에 실패했습니다.'),
  });

  const startEdit = (ad: Ad) => {
    setForm({ imageUrl: ad.imageUrl, title: ad.title, linkUrl: ad.linkUrl, active: ad.active, position: ad.position });
    setEditingId(ad.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">광고 배너 ({ads.length}개)</h3>
        <button onClick={() => { reset(); setShowForm(true); }} className="flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white">
          <Plus size={14} /> 새 광고
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-400">사이드바 하단(로그아웃 아래)에 노출됩니다. 활성 배너 중 순서가 앞선 것이 보입니다.</p>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl bg-gray-50 p-4">
          <h4 className="text-sm font-medium">{editingId ? '광고 수정' : '새 광고 등록'}</h4>
          <ImageUpload value={form.imageUrl} onChange={(url) => setForm({ ...form, imageUrl: url })} onRemove={() => setForm({ ...form, imageUrl: '' })} placeholder="광고 이미지 업로드" />
          <input placeholder="제목/문구 (선택)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-gray-200 p-2.5 text-sm" />
          <input placeholder="링크 URL — 내부(/exhibitions/1) 또는 외부(https://…) (선택)" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} className="w-full rounded-lg border border-gray-200 p-2.5 text-sm" />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              순서 <input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: Number(e.target.value) })} className="w-20 rounded-lg border border-gray-200 p-2 text-sm" />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-gray-900" /> 활성
            </label>
          </div>

          {form.imageUrl && (
            <div className="relative w-40 overflow-hidden rounded-lg border border-gray-100">
              <img src={form.imageUrl} alt="" className="w-full object-cover" />
              <span className="absolute right-1 top-1 rounded-sm bg-black/45 px-1 py-0.5 text-[9px] text-white/90">AD</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { if (!form.imageUrl) { toast.error('이미지는 필수입니다.'); return; } save.mutate(); }}
              disabled={save.isPending}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >{editingId ? '수정' : '등록'}</button>
            <button onClick={reset} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {ads.map((ad) => (
          <div key={ad.id} className={`flex items-center gap-3 rounded-xl border p-3 ${ad.active ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-60'}`}>
            <img src={ad.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-800">{ad.title || '(문구 없음)'}</p>
              <p className="truncate text-xs text-gray-400">{ad.linkUrl || '링크 없음'} · 순서 {ad.position} · {ad.active ? '활성' : '비활성'}</p>
            </div>
            <button onClick={() => toggle.mutate(ad)} aria-label="활성 토글" className="p-1.5 text-gray-400 hover:text-gray-900">{ad.active ? <Eye size={16} /> : <EyeOff size={16} />}</button>
            <button onClick={() => startEdit(ad)} aria-label="수정" className="p-1.5 text-gray-400 hover:text-gray-900"><Pencil size={16} /></button>
            <button onClick={() => del.mutate(ad.id)} aria-label="삭제" className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
          </div>
        ))}
        {ads.length === 0 && <p className="py-8 text-center text-sm text-gray-400">등록된 광고가 없습니다.</p>}
      </div>
    </div>
  );
}
