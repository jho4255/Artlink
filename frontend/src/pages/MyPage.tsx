import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  LogOut, Heart, FileText, Send, Building2, Star, X, Plus, Check, XCircle,
  Camera, Eye, Search, Calendar, Edit3, Trash2, Instagram, Save, AlertTriangle, Ticket
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, exhibitionTypeLabels, getDday, validateExhibitionDates, getShowStatus, showStatusLabels } from '@/lib/utils';
import ImageUpload, { MultiImageUpload } from '@/components/shared/ImageUpload';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { Favorite, Portfolio, Gallery, Exhibition, Show, CustomField, ArtistEntry } from '@/types';

const regions = ['SEOUL', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'BUSAN'];

export default function MyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState('profile');

  const handleLogout = () => {
    // 로그아웃 시 모든 캐시 제거 (다음 유저 로그인 시 stale 데이터 방지)
    queryClient.clear();
    logout();
    navigate('/login');
  };

  if (!user) return null;

  const tabs = user.role === 'ARTIST'
    ? [
        { id: 'profile', label: '프로필', icon: Camera },
        { id: 'portfolio', label: '포트폴리오', icon: FileText },
        { id: 'favorites', label: '찜 목록', icon: Heart },
        { id: 'reviews', label: '내 리뷰', icon: Star },
        { id: 'applications', label: '지원 내역', icon: Send },
      ]
    : user.role === 'GALLERY'
    ? [
        { id: 'profile', label: '프로필', icon: Camera },
        { id: 'my-galleries', label: '내 갤러리', icon: Building2 },
        { id: 'my-exhibitions', label: '내 공모', icon: FileText },
        { id: 'my-shows', label: '내 전시', icon: Ticket },
      ]
    : [
        { id: 'profile', label: '프로필', icon: Camera },
        { id: 'approvals', label: '승인 관리', icon: Check },
        { id: 'hero-manage', label: '히어로 관리', icon: Eye },
        { id: 'benefit-manage', label: '혜택 관리', icon: FileText },
        { id: 'gotm-manage', label: '이달의 갤러리', icon: Star },
      ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">마이페이지</h1>
        <button onClick={handleLogout} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600">
          <LogOut size={16} /> 로그아웃
        </button>
      </div>

      {/* 프로필 카드 */}
      <ProfileCard />

      {/* 탭 메뉴 */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-6 border-b border-gray-100 scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === 'profile' && <ProfileSection />}
      {activeTab === 'portfolio' && user.role === 'ARTIST' && <PortfolioSection />}
      {activeTab === 'favorites' && user.role === 'ARTIST' && <FavoritesSection />}
      {activeTab === 'reviews' && user.role === 'ARTIST' && <MyReviewsSection />}
      {activeTab === 'applications' && user.role === 'ARTIST' && <ApplicationsSection />}
      {activeTab === 'my-galleries' && user.role === 'GALLERY' && <MyGalleriesSection />}
      {activeTab === 'my-exhibitions' && user.role === 'GALLERY' && <MyExhibitionsSection />}
      {activeTab === 'my-shows' && user.role === 'GALLERY' && <MyShowsSection />}
      {activeTab === 'approvals' && user.role === 'ADMIN' && <ApprovalsSection />}
      {activeTab === 'hero-manage' && user.role === 'ADMIN' && <HeroManageSection />}
      {activeTab === 'benefit-manage' && user.role === 'ADMIN' && <BenefitManageSection />}
      {activeTab === 'gotm-manage' && user.role === 'ADMIN' && <GotmManageSection />}
    </motion.div>
  );
}

// ========== 프로필 카드 (프로필 사진 변경 포함) ==========
function ProfileCard() {
  const { user, updateUser } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleAvatarUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const uploadRes = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const avatarUrl = uploadRes.data.url;
      await api.put('/auth/me/avatar', { avatar: avatarUrl });
      updateUser({ avatar: avatarUrl });
      toast.success('프로필 사진이 변경되었습니다.');
    } catch {
      toast.error('프로필 사진 변경에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-gray-50 rounded-2xl p-6 mb-6">
      <div className="flex items-center gap-4">
        <div className="relative group">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center text-2xl font-bold text-gray-400 overflow-hidden">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              user?.name?.charAt(0)
            )}
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Camera size={18} className="text-white" />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarUpload(file);
              e.target.value = '';
            }}
          />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{user?.name}</h2>
          <p className="text-sm text-gray-500">{user?.email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-600">{user?.role}</span>
        </div>
      </div>
    </div>
  );
}

// ========== 프로필 섹션 ==========
function ProfileSection() {
  return (
    <div className="text-center py-8 text-gray-500">
      <p>프로필 카드 위 사진을 클릭하여 프로필 사진을 변경할 수 있습니다.</p>
    </div>
  );
}

// ========== Artist: 포트폴리오 관리 ==========
function PortfolioSection() {
  const queryClient = useQueryClient();
  const { data: portfolio, isLoading } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then(r => r.data),
  });

  const [biography, setBiography] = useState('');
  const [exhibitionHistory, setExhibitionHistory] = useState('');
  const [editing, setEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: { biography: string; exhibitionHistory: string }) => api.put('/portfolio', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      setEditing(false);
      toast.success('포트폴리오가 저장되었습니다.');
    },
  });

  // 포트폴리오 이미지 추가
  const addImageMutation = useMutation({
    mutationFn: (url: string) => api.post('/portfolio/images', { url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('작품 사진이 추가되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '이미지 추가 실패'),
  });

  // 포트폴리오 이미지 삭제
  const removeImageMutation = useMutation({
    mutationFn: (imageId: number) => api.delete(`/portfolio/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('작품 사진이 삭제되었습니다.');
    },
  });

  if (isLoading) return <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />;

  const startEdit = () => {
    setBiography(portfolio?.biography || '');
    setExhibitionHistory(portfolio?.exhibitionHistory || '');
    setEditing(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">포트폴리오</h3>
        {!editing && <button onClick={startEdit} className="text-sm text-blue-500">수정</button>}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">작가 약력</label>
            <textarea value={biography} onChange={e => setBiography(e.target.value)} className="w-full h-24 p-3 mt-1 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">전시 참가 이력</label>
            <textarea value={exhibitionHistory} onChange={e => setExhibitionHistory(e.target.value)} className="w-full h-24 p-3 mt-1 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => mutation.mutate({ biography, exhibitionHistory })} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg">저장</button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-500">작가 약력</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{portfolio?.biography || '등록된 약력이 없습니다.'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">전시 참가 이력</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{portfolio?.exhibitionHistory || '등록된 이력이 없습니다.'}</p>
          </div>
        </div>
      )}

      {/* 작품 사진 관리 */}
      <div>
        <p className="text-sm font-medium text-gray-500 mb-2">작품 사진 ({portfolio?.images?.length || 0}/30)</p>
        <MultiImageUpload
          images={portfolio?.images || []}
          onAdd={(url) => addImageMutation.mutate(url)}
          onRemove={(index) => {
            const img = portfolio?.images?.[index];
            if (img?.id) removeImageMutation.mutate(img.id);
          }}
          maxCount={30}
        />
      </div>
    </div>
  );
}

// ========== Artist: 찜 목록 ==========
function FavoritesSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'gallery' | 'exhibition' | 'show'>('all');

  const { data: favorites = [] } = useQuery<Favorite[]>({
    queryKey: ['favorites'],
    queryFn: () => api.get('/favorites').then(r => r.data),
  });

  // 찜 해제 - 낙관적 업데이트 + 교차 캐시 직접 수정 (stale 깜빡임 방지)
  const removeFav = useMutation({
    mutationFn: (data: { galleryId?: number; exhibitionId?: number; showId?: number }) => api.post('/favorites/toggle', data),
    onMutate: async (data) => {
      // 1) 찜 목록 캐시에서 즉시 제거
      await queryClient.cancelQueries({ queryKey: ['favorites'] });
      const prev = queryClient.getQueryData<Favorite[]>(['favorites']);
      if (prev) {
        queryClient.setQueryData(['favorites'],
          prev.filter(f => {
            if (data.galleryId) return f.galleryId !== data.galleryId;
            if (data.exhibitionId) return f.exhibitionId !== data.exhibitionId;
            return true;
          })
        );
      }
      // 2) 갤러리/공모 목록 캐시에서도 isFavorited 즉시 false로 설정
      //    (페이지 이동 시 stale 캐시에 하트가 잠깐 보이는 현상 방지)
      if (data.galleryId) {
        queryClient.setQueriesData<Gallery[]>(
          { queryKey: ['galleries'], exact: false },
          (old) => old?.map(g => g.id === data.galleryId ? { ...g, isFavorited: false } : g)
        );
        queryClient.setQueriesData<any>(
          { queryKey: ['gallery'], exact: false },
          (old: any) => old?.id === data.galleryId ? { ...old, isFavorited: false } : old
        );
      }
      if (data.exhibitionId) {
        queryClient.setQueriesData<Exhibition[]>(
          { queryKey: ['exhibitions'], exact: false },
          (old) => old?.map(ex => ex.id === data.exhibitionId ? { ...ex, isFavorited: false } : ex)
        );
        queryClient.setQueriesData<any>(
          { queryKey: ['exhibition'], exact: false },
          (old: any) => old?.id === data.exhibitionId ? { ...old, isFavorited: false } : old
        );
      }
      if (data.showId) {
        queryClient.setQueriesData<Show[]>(
          { queryKey: ['shows'], exact: false },
          (old) => old?.map(s => s.id === data.showId ? { ...s, isFavorited: false } : s)
        );
        queryClient.setQueriesData<any>(
          { queryKey: ['show'], exact: false },
          (old: any) => old?.id === data.showId ? { ...old, isFavorited: false } : old
        );
      }
      return { prev };
    },
    onError: (_err, _data, context) => {
      // rollback: 찜 목록만 복원 (다른 캐시는 onSettled에서 refetch)
      if (context?.prev) queryClient.setQueryData(['favorites'], context.prev);
      toast.error('찜 해제에 실패했습니다.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibition'] });
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['show'] });
      toast.success('찜이 해제되었습니다.');
    },
  });

  const filtered = favorites.filter(f => {
    if (filter === 'gallery') return !!f.galleryId;
    if (filter === 'exhibition') return !!f.exhibitionId;
    if (filter === 'show') return !!f.showId;
    return true;
  });

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {(['all', 'gallery', 'exhibition', 'show'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-full ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f === 'all' ? '전체' : f === 'gallery' ? '갤러리' : f === 'exhibition' ? '공모' : '전시'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-8">찜한 항목이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(fav => (
            <div key={fav.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
              <button
                onClick={() => {
                  if (fav.galleryId) navigate(`/galleries/${fav.galleryId}`);
                  else if (fav.exhibitionId) navigate(`/exhibitions/${fav.exhibitionId}`);
                  else if (fav.showId) navigate(`/shows/${fav.showId}`);
                }}
                className="text-sm font-medium text-left hover:text-blue-500"
              >
                {fav.gallery ? fav.gallery.name : fav.exhibition ? `${fav.exhibition.gallery.name} - ${fav.exhibition.title}` : fav.show ? `${fav.show.gallery.name} - ${fav.show.title}` : ''}
              </button>
              <button
                onClick={() => removeFav.mutate({ galleryId: fav.galleryId || undefined, exhibitionId: fav.exhibitionId || undefined, showId: fav.showId || undefined })}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Artist: 내 리뷰 ==========
function MyReviewsSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: reviews = [] } = useQuery<any[]>({
    queryKey: ['my-reviews'],
    queryFn: () => api.get('/reviews/my').then(r => r.data),
  });

  const deleteReviewMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/reviews/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
      toast.success('리뷰가 삭제되었습니다.');
    },
    onError: () => toast.error('리뷰 삭제에 실패했습니다.'),
  });

  return reviews.length === 0 ? (
    <p className="text-gray-400 text-center py-8">작성한 리뷰가 없습니다.</p>
  ) : (
    <div className="space-y-3">
      {reviews.map((r: any) => (
        <div key={r.id} className="p-4 border border-gray-100 rounded-xl">
          <div className="flex justify-between items-start">
            <div>
              <button onClick={() => navigate(`/galleries/${r.galleryId}`)} className="text-sm font-medium text-blue-500 hover:underline">
                {r.gallery?.name}
              </button>
              <div className="flex gap-0.5 mt-1">
                {[1,2,3,4,5].map(s => <Star key={s} size={12} className={s <= r.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />)}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate(`/galleries/${r.galleryId}`)}
                className="p-1 text-gray-400 hover:text-blue-500"
                title="갤러리에서 수정"
              >
                <Edit3 size={14} />
              </button>
              <button
                onClick={() => { if (window.confirm('이 리뷰를 삭제하시겠습니까?')) deleteReviewMutation.mutate(r.id); }}
                className="p-1 text-gray-400 hover:text-red-500"
                title="삭제"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-700 mt-1">{r.content}</p>
        </div>
      ))}
    </div>
  );
}

// ========== Artist: 지원 내역 ==========
function ApplicationsSection() {
  const { data: apps = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ['my-applications'],
    queryFn: () => api.get('/exhibitions/my-applications').then(r => r.data),
  });

  if (isError) {
    return <p className="text-red-400 text-center py-8">지원 내역을 불러오는 중 오류가 발생했습니다.</p>;
  }

  if (isLoading) return <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />;

  return apps.length === 0 ? (
    <p className="text-gray-400 text-center py-8">지원한 공고가 없습니다.</p>
  ) : (
    <div className="space-y-3">
      {apps.map((app: any) => (
        <div key={app.id} className="p-4 border border-gray-100 rounded-xl">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-medium text-sm">{app.exhibition?.title}</h4>
              <p className="text-xs text-gray-500 mt-1">{app.exhibition?.gallery?.name}</p>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(app.createdAt).toLocaleDateString('ko')}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ========== Gallery: 내 갤러리 ==========
function MyGalleriesSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { name: '', address: '', phone: '', description: '', region: 'SEOUL', ownerName: '', mainImage: '', email: '' };
  const [form, setForm] = useState(emptyForm);
  const [galleryTerms, setGalleryTerms] = useState('');
  const [galleryAgreed, setGalleryAgreed] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | null>(null);

  // 임시저장 훅
  const { hasDraft, autoSave, saveDraft, clearDraft, restoreDraft } = useFormDraft('draft_gallery_form', emptyForm);

  // 폼 변경 감지 (이탈 경고용)
  const isDirty = showForm && JSON.stringify(form) !== JSON.stringify(emptyForm);
  useUnsavedChanges(isDirty);

  // 폼 변경 시 자동저장
  useEffect(() => {
    if (showForm && isDirty) autoSave(form);
  }, [form, showForm, isDirty, autoSave]);

  // 폼 열 때 draft 복원 확인
  const openForm = () => {
    if (hasDraft) {
      const draft = restoreDraft();
      if (draft && window.confirm('이전에 작성하던 내용이 있습니다. 복원하시겠습니까?')) {
        setForm(draft);
      }
    }
    setShowForm(true);
  };

  // 약관 텍스트 로드
  useEffect(() => {
    if (showForm) {
      fetch('/terms/gallery-registration.txt').then(r => r.text()).then(setGalleryTerms).catch(() => setGalleryTerms('약관을 불러올 수 없습니다.'));
    }
  }, [showForm]);

  const { data: galleries = [] } = useQuery<any[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data).catch(() => []),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/galleries', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      setShowForm(false);
      setForm(emptyForm);
      setGalleryAgreed(false);
      clearDraft();
      toast.success('갤러리 등록 요청이 제출되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  // Instagram 연동 상태
  const [instagramModalGalleryId, setInstagramModalGalleryId] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState('');

  // Instagram 토큰 저장
  const saveTokenMutation = useMutation({
    mutationFn: ({ galleryId, accessToken }: { galleryId: number; accessToken: string }) =>
      api.post(`/galleries/${galleryId}/instagram-token`, { accessToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      setInstagramModalGalleryId(null);
      setTokenInput('');
      toast.success('Instagram이 연동되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Instagram 연동에 실패했습니다.'),
  });

  // Instagram 프로필 링크 토글
  const toggleProfileVisibilityMutation = useMutation({
    mutationFn: ({ galleryId, visible }: { galleryId: number; visible: boolean }) =>
      api.patch(`/galleries/${galleryId}/instagram-profile-visibility`, { visible }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '설정 변경에 실패했습니다.'),
  });

  // Instagram 피드 공개 토글 (낙관적 업데이트)
  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ galleryId, visible }: { galleryId: number; visible: boolean }) =>
      api.patch(`/galleries/${galleryId}/instagram-visibility`, { visible }),
    onMutate: async ({ galleryId, visible }) => {
      await queryClient.cancelQueries({ queryKey: ['my-galleries'] });
      const prev = queryClient.getQueryData<any[]>(['my-galleries']);
      if (prev) {
        queryClient.setQueryData(['my-galleries'], prev.map((g: any) =>
          g.id === galleryId ? { ...g, instagramFeedVisible: visible } : g
        ));
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['my-galleries'], context.prev);
      toast.error('설정 변경에 실패했습니다.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
    },
  });

  const statusColors: Record<string, string> = { PENDING: 'bg-yellow-100 text-yellow-700', APPROVED: 'bg-green-100 text-green-700', REJECTED: 'bg-red-100 text-red-700' };
  const statusLabels: Record<string, string> = { PENDING: '승인 대기', APPROVED: '승인 완료', REJECTED: '승인 거절' };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">Admin 승인 후 검색에 노출됩니다.</p>
        <button onClick={() => showForm ? setShowForm(false) : openForm()} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 갤러리 등록
        </button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-sm">갤러리 등록 요청</h4>
            <button onClick={() => { saveDraft(form); toast.success('임시저장되었습니다.'); }} className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600">
              <Save size={12} /> 임시저장
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="갤러리명 *" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="col-span-2 p-2.5 border border-gray-200 rounded-lg text-sm" />
            <input placeholder="주소 *" value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="col-span-2 p-2.5 border border-gray-200 rounded-lg text-sm" />
            <input placeholder="대표자명 *" value={form.ownerName} onChange={e => setForm({...form, ownerName: e.target.value})} className="p-2.5 border border-gray-200 rounded-lg text-sm" />
            <input placeholder="전화번호 *" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="p-2.5 border border-gray-200 rounded-lg text-sm" />
            <input placeholder="이메일 주소 (선택)" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="col-span-2 p-2.5 border border-gray-200 rounded-lg text-sm" />
            <select value={form.region} onChange={e => setForm({...form, region: e.target.value})} className="col-span-2 p-2.5 border border-gray-200 rounded-lg text-sm">
              {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
            </select>
            <textarea placeholder="한줄 소개 *" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="col-span-2 p-2.5 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
          </div>
          <ImageUpload value={form.mainImage} onChange={(url) => setForm({...form, mainImage: url})} onRemove={() => setForm({...form, mainImage: ''})} placeholder="대표 이미지 업로드" />
          {/* 약관 동의 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-40 overflow-y-auto p-3 bg-white text-xs text-gray-600 whitespace-pre-wrap">{galleryTerms || '약관 로딩 중...'}</div>
            <label className="flex items-center gap-2 p-3 bg-gray-100 border-t border-gray-200 cursor-pointer text-sm">
              <input type="checkbox" checked={galleryAgreed} onChange={e => setGalleryAgreed(e.target.checked)} className="rounded" />
              위 약관에 동의합니다
            </label>
          </div>
          <div className="flex gap-2">
            <button
              disabled={createMutation.isPending || !galleryAgreed}
              onClick={() => {
                if (!form.name || !form.address || !form.phone || !form.description || !form.ownerName) {
                  toast.error('필수 항목을 모두 입력해주세요.'); return;
                }
                setConfirmAction('submit');
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >{createMutation.isPending ? '등록 중...' : '등록 요청'}</button>
            <button onClick={() => isDirty ? setConfirmAction('cancel') : (() => { setShowForm(false); setGalleryAgreed(false); })()} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      {/* 등록 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        title="갤러리 등록"
        message="이 내용으로 갤러리 등록을 요청하시겠습니까?"
        confirmText="등록 요청"
        onConfirm={() => { setConfirmAction(null); createMutation.mutate(form); }}
        onCancel={() => setConfirmAction(null)}
      />
      {/* 취소 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="작성 취소"
        message="작성 중인 내용이 있습니다. 정말 취소하시겠습니까?\n임시저장된 내용은 유지됩니다."
        confirmText="취소하기"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); setShowForm(false); setGalleryAgreed(false); }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* 갤러리 목록 */}
      {galleries.length === 0 && !showForm ? (
        <p className="text-gray-400 text-center py-8">등록된 갤러리가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {galleries.map((g: any) => (
            <div
              key={g.id}
              className="p-4 border border-gray-100 rounded-xl"
            >
              <div
                className={`flex justify-between items-start ${g.status === 'APPROVED' ? 'cursor-pointer hover:opacity-70' : ''}`}
                onClick={() => g.status === 'APPROVED' && navigate(`/galleries/${g.id}`)}
              >
                <div>
                  <h3 className="font-medium">{g.name}</h3>
                  <p className="text-sm text-gray-500">{g.address}</p>
                  {g.status === 'APPROVED' && (
                    <p className="text-xs text-blue-500 mt-1">상세페이지 보기 →</p>
                  )}
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[g.status] || ''}`}>
                  {statusLabels[g.status] || g.status}
                </span>
              </div>
              {g.status === 'REJECTED' && g.rejectReason && (
                <p className="text-sm text-red-500 mt-2">거절 사유: {g.rejectReason}</p>
              )}
              {/* Instagram 설정 블록 (승인 갤러리만) */}
              {g.status === 'APPROVED' && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2 text-sm">
                    <Instagram size={14} className="text-pink-500" />
                    <span className="font-medium">Instagram 연동</span>
                  </div>
                  {/* 연동 상태 + 버튼 */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {g.instagramConnected ? '연결됨' : '미연동'}
                    </span>
                    <button
                      onClick={() => { setInstagramModalGalleryId(g.id); setTokenInput(''); }}
                      className="text-xs px-2.5 py-1 bg-pink-50 text-pink-600 rounded-lg hover:bg-pink-100"
                    >
                      {g.instagramConnected ? '재연동' : '연동하기'}
                    </button>
                  </div>
                  {/* 토글들 (연동된 경우만) */}
                  {g.instagramConnected && (
                    <div className="space-y-1.5">
                      {/* 프로필 링크 토글 */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">프로필 링크 표시</span>
                        <button
                          onClick={() => toggleProfileVisibilityMutation.mutate({ galleryId: g.id, visible: !g.instagramUrl })}
                          className={`w-10 h-5 rounded-full relative transition-colors ${g.instagramUrl ? 'bg-pink-500' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${g.instagramUrl ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                      {/* 피드 표시 토글 */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">피드 표시</span>
                        <button
                          onClick={() => toggleVisibilityMutation.mutate({ galleryId: g.id, visible: !g.instagramFeedVisible })}
                          className={`w-10 h-5 rounded-full relative transition-colors ${g.instagramFeedVisible ? 'bg-pink-500' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${g.instagramFeedVisible ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Instagram 토큰 입력 모달 */}
      {instagramModalGalleryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInstagramModalGalleryId(null)}>
          <div className="bg-white rounded-xl p-6 mx-4 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold flex items-center gap-2">
              <Instagram size={18} className="text-pink-500" /> Instagram 연동
            </h3>
            <p className="text-xs text-gray-500">
              Instagram Graph API 액세스 토큰을 입력해주세요.
            </p>
            <input
              type="text"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="액세스 토큰"
              className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setInstagramModalGalleryId(null)}
                className="px-4 py-2 text-sm text-gray-500"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!tokenInput.trim()) { toast.error('토큰을 입력해주세요.'); return; }
                  saveTokenMutation.mutate({ galleryId: instagramModalGalleryId, accessToken: tokenInput });
                }}
                disabled={saveTokenMutation.isPending}
                className="px-4 py-2 bg-pink-500 text-white text-sm rounded-lg disabled:opacity-50"
              >
                {saveTokenMutation.isPending ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== Gallery: 내 공모 ==========
function MyExhibitionsSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const emptyExForm = { galleryId: 0, title: '', type: 'SOLO', deadlineStart: '', deadline: '', exhibitStartDate: '', exhibitDate: '', capacity: 1, region: 'SEOUL', description: '', imageUrl: '', customFields: [] as CustomField[] };
  const [form, setForm] = useState(emptyExForm);
  const [exhibitionTerms, setExhibitionTerms] = useState('');
  const [exhibitionAgreed, setExhibitionAgreed] = useState(false);
  const [enableCustomFields, setEnableCustomFields] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | null>(null);
  // 커스텀 필드 인라인 수정 상태
  const [editingCfExId, setEditingCfExId] = useState<number | null>(null);
  const [editingCfFields, setEditingCfFields] = useState<CustomField[]>([]);

  // 임시저장 훅
  const { hasDraft, autoSave, saveDraft, clearDraft, restoreDraft } = useFormDraft('draft_exhibition_form', emptyExForm);

  // 폼 변경 감지
  const isDirty = showForm && JSON.stringify(form) !== JSON.stringify(emptyExForm);
  useUnsavedChanges(isDirty);

  // 폼 변경 시 자동저장
  useEffect(() => {
    if (showForm && isDirty) autoSave(form);
  }, [form, showForm, isDirty, autoSave]);

  // 날짜 검증
  const dateError = useMemo(() => validateExhibitionDates({
    deadlineStart: form.deadlineStart || undefined,
    deadline: form.deadline,
    exhibitStartDate: form.exhibitStartDate || undefined,
    exhibitDate: form.exhibitDate,
  }), [form.deadlineStart, form.deadline, form.exhibitStartDate, form.exhibitDate]);

  // 폼 열기 (draft 복원)
  const openExForm = () => {
    if (hasDraft) {
      const draft = restoreDraft();
      if (draft && window.confirm('이전에 작성하던 내용이 있습니다. 복원하시겠습니까?')) {
        setForm(draft);
        if (draft.customFields && draft.customFields.length > 0) setEnableCustomFields(true);
      }
    }
    setShowForm(true);
  };

  // 약관 텍스트 로드
  useEffect(() => {
    if (showForm) {
      fetch('/terms/exhibition-application.txt').then(r => r.text()).then(setExhibitionTerms).catch(() => setExhibitionTerms('약관을 불러올 수 없습니다.'));
    }
  }, [showForm]);

  // 내 갤러리 목록 (승인된 것만 공모 등록 가능)
  const { data: myGalleries = [] } = useQuery<any[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data).catch(() => []),
  });
  const approvedGalleries = myGalleries.filter((g: any) => g.status === 'APPROVED');

  // 내 공모 목록
  const { data: exhibitions = [] } = useQuery<any[]>({
    queryKey: ['my-exhibitions'],
    queryFn: () => api.get('/exhibitions/my-exhibitions').then(r => r.data).catch(() => []),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/exhibitions', {
      ...data,
      customFields: data.customFields?.length > 0 ? data.customFields : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      setShowForm(false);
      setForm(emptyExForm);
      setExhibitionAgreed(false);
      setEnableCustomFields(false);
      clearDraft();
      toast.success('공모 등록 요청이 제출되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  // 커스텀 필드 수정 mutation
  const updateCfMutation = useMutation({
    mutationFn: ({ id, customFields }: { id: number; customFields: CustomField[] | null }) =>
      api.patch(`/exhibitions/${id}/custom-fields`, { customFields }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      setEditingCfExId(null);
      toast.success('요청 정보가 수정되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '수정 실패'),
  });

  // 공모 삭제
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      toast.success('공모가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  const handleDeleteExhibition = (id: number) => {
    if (window.confirm('정말 이 공모를 삭제하시겠습니까?')) {
      deleteMutation.mutate(id);
    }
  };

  // 커스텀 필드 추가
  const addCustomField = () => {
    const newField: CustomField = { id: `cf_${Date.now()}`, label: '', type: 'text', required: false };
    setForm({ ...form, customFields: [...form.customFields, newField] });
  };
  const updateCustomField = (idx: number, field: Partial<CustomField>) => {
    const updated = [...form.customFields];
    updated[idx] = { ...updated[idx], ...field };
    setForm({ ...form, customFields: updated });
  };
  const removeCustomField = (idx: number) => {
    setForm({ ...form, customFields: form.customFields.filter((_, i) => i !== idx) });
  };

  const statusColors: Record<string, string> = { PENDING: 'bg-yellow-100 text-yellow-700', APPROVED: 'bg-green-100 text-green-700', REJECTED: 'bg-red-100 text-red-700' };
  const statusLabels: Record<string, string> = { PENDING: '승인 대기', APPROVED: '승인 완료', REJECTED: '승인 거절' };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">Admin 승인 후 공고에 노출됩니다.</p>
        <button onClick={() => showForm ? setShowForm(false) : openExForm()} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 공모 등록
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-sm">공모 등록 요청</h4>
            <button onClick={() => { saveDraft(form); toast.success('임시저장되었습니다.'); }} className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600">
              <Save size={12} /> 임시저장
            </button>
          </div>
          {approvedGalleries.length === 0 ? (
            <p className="text-sm text-red-500">승인된 갤러리가 없습니다. 먼저 갤러리를 등록해주세요.</p>
          ) : (
            <>
              <select value={form.galleryId} onChange={e => setForm({...form, galleryId: Number(e.target.value)})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm">
                <option value={0}>갤러리 선택 *</option>
                {approvedGalleries.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <input placeholder="공모 제목 *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="p-2.5 border border-gray-200 rounded-lg text-sm">
                  <option value="SOLO">개인전</option>
                  <option value="GROUP">단체전</option>
                  <option value="ART_FAIR">아트페어</option>
                </select>
                <div>
                  <label className="text-xs text-gray-500">모집 작가 수</label>
                  <input type="number" min={1} value={form.capacity} onChange={e => setForm({...form, capacity: Number(e.target.value)})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">공모 시작일</label>
                  <input type="date" value={form.deadlineStart} onChange={e => setForm({...form, deadlineStart: e.target.value})} max={form.deadline || undefined} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">공모 마감일 *</label>
                  <input type="date" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} min={form.deadlineStart || undefined} max={form.exhibitStartDate || form.exhibitDate || undefined} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">전시 시작일</label>
                  <input type="date" value={form.exhibitStartDate} onChange={e => setForm({...form, exhibitStartDate: e.target.value})} min={form.deadline || undefined} max={form.exhibitDate || undefined} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">전시 종료일 *</label>
                  <input type="date" value={form.exhibitDate} onChange={e => setForm({...form, exhibitDate: e.target.value})} min={form.exhibitStartDate || form.deadline || undefined} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              {/* 날짜 검증 에러 */}
              {dateError && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle size={12} /> {dateError}
                </p>
              )}
              <select value={form.region} onChange={e => setForm({...form, region: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm">
                {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
              </select>
              <textarea placeholder="간단 소개 *" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
              <ImageUpload value={form.imageUrl} onChange={(url) => setForm({...form, imageUrl: url})} onRemove={() => setForm({...form, imageUrl: ''})} placeholder="공모 대표 이미지 (선택)" />

              {/* 커스텀 질문 항목 빌더 */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={enableCustomFields} onChange={e => {
                    setEnableCustomFields(e.target.checked);
                    if (!e.target.checked) setForm({ ...form, customFields: [] });
                  }} className="rounded" />
                  지원 시 추가 요청 정보 설정
                </label>
                {enableCustomFields && (
                  <div className="space-y-2 pt-2">
                    {form.customFields.map((cf, idx) => (
                      <div key={cf.id} className="flex gap-2 items-start bg-white p-2 rounded border border-gray-100">
                        <div className="flex-1 space-y-1.5">
                          <input
                            placeholder="질문 (예: 작품 소개)"
                            value={cf.label}
                            onChange={e => updateCustomField(idx, { label: e.target.value })}
                            className="w-full p-1.5 border border-gray-200 rounded text-xs"
                          />
                          <div className="flex gap-2">
                            <select value={cf.type} onChange={e => updateCustomField(idx, { type: e.target.value as CustomField['type'] })} className="p-1.5 border border-gray-200 rounded text-xs">
                              <option value="text">짧은 텍스트</option>
                              <option value="textarea">긴 텍스트</option>
                              <option value="select">선택형</option>
                              <option value="file">파일 업로드</option>
                            </select>
                            <label className="flex items-center gap-1 text-xs">
                              <input type="checkbox" checked={cf.required} onChange={e => updateCustomField(idx, { required: e.target.checked })} className="rounded" />
                              필수
                            </label>
                          </div>
                          {cf.type === 'select' && (
                            <input
                              placeholder="옵션 (콤마로 구분: 옵션1,옵션2,옵션3)"
                              value={cf.options?.join(',') || ''}
                              onChange={e => updateCustomField(idx, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                              className="w-full p-1.5 border border-gray-200 rounded text-xs"
                            />
                          )}
                        </div>
                        <button onClick={() => removeCustomField(idx)} className="p-1 text-gray-400 hover:text-red-500"><X size={14} /></button>
                      </div>
                    ))}
                    <button onClick={addCustomField} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
                      <Plus size={12} /> 항목 추가
                    </button>
                  </div>
                )}
              </div>

              {/* 약관 동의 */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="max-h-40 overflow-y-auto p-3 bg-white text-xs text-gray-600 whitespace-pre-wrap">{exhibitionTerms || '약관 로딩 중...'}</div>
                <label className="flex items-center gap-2 p-3 bg-gray-100 border-t border-gray-200 cursor-pointer text-sm">
                  <input type="checkbox" checked={exhibitionAgreed} onChange={e => setExhibitionAgreed(e.target.checked)} className="rounded" />
                  위 약관에 동의합니다
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={createMutation.isPending || !exhibitionAgreed || !!dateError}
                  onClick={() => {
                    if (!form.galleryId || !form.title || !form.deadline || !form.exhibitDate || !form.description) {
                      toast.error('필수 항목을 모두 입력해주세요.'); return;
                    }
                    setConfirmAction('submit');
                  }}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >{createMutation.isPending ? '등록 중...' : '등록 요청'}</button>
                <button onClick={() => isDirty ? setConfirmAction('cancel') : (() => { setShowForm(false); setExhibitionAgreed(false); })()} className="px-4 py-2 text-sm text-gray-500">취소</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 등록/취소 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        title="공모 등록"
        message="이 내용으로 공모 등록을 요청하시겠습니까?"
        confirmText="등록 요청"
        onConfirm={() => { setConfirmAction(null); createMutation.mutate(form); }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="작성 취소"
        message="작성 중인 내용이 있습니다. 정말 취소하시겠습니까?\n임시저장된 내용은 유지됩니다."
        confirmText="취소하기"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); setShowForm(false); setExhibitionAgreed(false); setEnableCustomFields(false); }}
        onCancel={() => setConfirmAction(null)}
      />

      {exhibitions.length === 0 && !showForm ? (
        <p className="text-gray-400 text-center py-8">등록된 공모가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {exhibitions.map((ex: any) => (
            <div key={ex.id} className="p-4 border border-gray-100 rounded-xl">
              <div className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/exhibitions/${ex.id}`)}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium">{ex.title}</h3>
                    <p className="text-sm text-gray-500">{ex.gallery?.name} · {exhibitionTypeLabels[ex.type]} · {regionLabels[ex.region]}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[ex.status] || ''}`}>
                      {statusLabels[ex.status] || ex.status}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteExhibition(ex.id); }}
                      className="p-1 text-gray-400 hover:text-red-500"
                      title="공모 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {ex.status === 'REJECTED' && ex.rejectReason && (
                  <p className="text-sm text-red-500 mt-2">거절 사유: {ex.rejectReason}</p>
                )}
              </div>
              {/* 커스텀 필드 표시/수정 */}
              {ex.customFields && ex.customFields.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-gray-500">요청 정보 ({ex.customFields.length}개 항목)</span>
                    <button
                      onClick={() => {
                        if (editingCfExId === ex.id) { setEditingCfExId(null); }
                        else { setEditingCfExId(ex.id); setEditingCfFields([...ex.customFields]); }
                      }}
                      className="text-xs text-blue-500 hover:text-blue-600"
                    >
                      {editingCfExId === ex.id ? '취소' : <><Edit3 size={10} className="inline" /> 수정</>}
                    </button>
                  </div>
                  {editingCfExId === ex.id ? (
                    <div className="space-y-1.5">
                      {editingCfFields.map((cf, idx) => (
                        <div key={cf.id} className="flex gap-1.5 items-center">
                          <input value={cf.label} onChange={e => { const u = [...editingCfFields]; u[idx] = { ...u[idx], label: e.target.value }; setEditingCfFields(u); }} className="flex-1 p-1 border border-gray-200 rounded text-xs" />
                          <select value={cf.type} onChange={e => { const u = [...editingCfFields]; u[idx] = { ...u[idx], type: e.target.value as CustomField['type'] }; setEditingCfFields(u); }} className="p-1 border border-gray-200 rounded text-xs">
                            <option value="text">텍스트</option>
                            <option value="textarea">긴 텍스트</option>
                            <option value="select">선택형</option>
                            <option value="file">파일</option>
                          </select>
                          <button onClick={() => setEditingCfFields(editingCfFields.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500"><X size={12} /></button>
                        </div>
                      ))}
                      <button
                        onClick={() => updateCfMutation.mutate({ id: ex.id, customFields: editingCfFields.length > 0 ? editingCfFields : null })}
                        disabled={updateCfMutation.isPending}
                        className="text-xs px-2 py-1 bg-gray-900 text-white rounded disabled:opacity-50"
                      >저장</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {ex.customFields.map((cf: CustomField) => (
                        <span key={cf.id} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded">
                          {cf.label} ({cf.type}){cf.required ? ' *' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Gallery: 내 전시(Show) 관리 ==========
function MyShowsSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showForm, setShowForm] = useState(false);

  // 내 갤러리 (전시 등록 시 선택용)
  const { data: myGalleries = [] } = useQuery<Gallery[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries/my').then(r => r.data),
  });
  const approvedGalleries = myGalleries.filter(g => g.status === 'APPROVED');

  // 내 전시 목록
  const { data: myShows = [], isLoading } = useQuery<Show[]>({
    queryKey: ['my-shows'],
    queryFn: () => api.get('/shows/my-shows').then(r => r.data),
  });

  // 전시 등록 폼 상태
  const [form, setForm] = useState({
    title: '', description: '', startDate: '', endDate: '',
    openingHours: '', admissionFee: '', location: '', region: 'SEOUL',
    posterImage: '', galleryId: 0,
    additionalImages: [] as { url: string }[],
  });

  // 작가 목록 (동적)
  const [artists, setArtists] = useState<ArtistEntry[]>([{ name: '' }]);
  const [searchResults, setSearchResults] = useState<{ id: number; name: string; avatar?: string }[]>([]);
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);

  // 약관 동의
  const [agreedTerms, setAgreedTerms] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/shows', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shows'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      setShowForm(false);
      setForm({ title: '', description: '', startDate: '', endDate: '', openingHours: '', admissionFee: '', location: '', region: 'SEOUL', posterImage: '', galleryId: 0, additionalImages: [] });
      setArtists([{ name: '' }]);
      setAgreedTerms(false);
      toast.success('전시 등록 요청이 완료되었습니다. Admin 승인을 기다려주세요.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shows'] });
      toast.success('전시가 삭제되었습니다.');
    },
  });

  // 작가 검색
  const searchArtist = async (idx: number) => {
    const name = artists[idx]?.name?.trim();
    if (!name) { toast.error('작가 이름을 입력해주세요.'); return; }
    try {
      const res = await api.get(`/portfolio/search?q=${encodeURIComponent(name)}`);
      setSearchResults(res.data);
      setSearchingIdx(idx);
    } catch { toast.error('검색에 실패했습니다.'); }
  };

  // 작가 선택 (연동)
  const linkArtist = (idx: number, user: { id: number; name: string }) => {
    const updated = [...artists];
    updated[idx] = { name: user.name, userId: user.id };
    setArtists(updated);
    setSearchingIdx(null);
    setSearchResults([]);
  };

  const handleSubmit = () => {
    if (!form.title || !form.description || !form.startDate || !form.endDate || !form.openingHours || !form.admissionFee || !form.location || !form.posterImage || !form.galleryId) {
      toast.error('모든 필수 항목을 입력해주세요.');
      return;
    }
    if (new Date(form.startDate) > new Date(form.endDate)) {
      toast.error('시작일은 종료일 이전이어야 합니다.');
      return;
    }
    const validArtists = artists.filter(a => a.name.trim());
    createMutation.mutate({
      ...form,
      artists: validArtists.length > 0 ? validArtists : null,
      additionalImages: form.additionalImages.map(img => img.url),
    });
  };

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<string, string> = {
    PENDING: '승인 대기', APPROVED: '승인 완료', REJECTED: '승인 거절',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">내 전시</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg"
        >
          <Plus size={14} /> 전시 등록
        </button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <select value={form.galleryId} onChange={e => setForm({ ...form, galleryId: Number(e.target.value) })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm">
            <option value={0}>갤러리 선택</option>
            {approvedGalleries.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <input placeholder="전시 제목" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
          <textarea placeholder="전시 소개" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm min-h-[80px]" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">시작일</label>
              <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500">종료일</label>
              <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <input placeholder="관람 시간 (예: 10:00-18:00)" value={form.openingHours} onChange={e => setForm({ ...form, openingHours: e.target.value })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
          <input placeholder="입장료 (예: 무료, 5,000원)" value={form.admissionFee} onChange={e => setForm({ ...form, admissionFee: e.target.value })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
          <input placeholder="위치 (주소)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
          <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm">
            {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
          </select>
          {/* 참여 작가 (동적 목록) */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">참여 작가</label>
            {artists.map((artist, idx) => (
              <div key={idx} className="relative">
                <div className="flex gap-2">
                  <input
                    placeholder="작가 이름"
                    value={artist.name}
                    onChange={e => {
                      const updated = [...artists];
                      updated[idx] = { name: e.target.value };
                      setArtists(updated);
                    }}
                    className={`flex-1 p-2 border rounded-lg text-sm ${artist.userId ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
                  />
                  {artist.userId ? (
                    <button type="button" onClick={() => { const updated = [...artists]; updated[idx] = { name: artist.name }; setArtists(updated); }}
                      className="px-2 text-xs text-blue-500 border border-blue-200 rounded-lg flex items-center gap-1">
                      <Check size={12} /> 연동됨
                    </button>
                  ) : (
                    <button type="button" onClick={() => searchArtist(idx)}
                      className="px-2 text-xs text-gray-500 border border-gray-200 rounded-lg flex items-center gap-1 hover:border-gray-400">
                      <Search size={12} /> 검색
                    </button>
                  )}
                  {artists.length > 1 && (
                    <button type="button" onClick={() => setArtists(artists.filter((_, i) => i !== idx))}
                      className="p-2 text-gray-400 hover:text-red-500">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {/* 검색 결과 드롭다운 */}
                {searchingIdx === idx && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                    {searchResults.map(u => (
                      <button key={u.id} type="button" onClick={() => linkArtist(idx, u)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                        {u.avatar ? <img src={u.avatar} className="w-6 h-6 rounded-full object-cover" /> : <div className="w-6 h-6 rounded-full bg-gray-200" />}
                        {u.name}
                      </button>
                    ))}
                  </div>
                )}
                {searchingIdx === idx && searchResults.length === 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 px-3 py-2 text-sm text-gray-400">
                    검색 결과가 없습니다.
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setArtists([...artists, { name: '' }])}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <Plus size={12} /> 작가 추가
            </button>
          </div>
          <ImageUpload
            value={form.posterImage}
            onChange={(url) => setForm({ ...form, posterImage: url })}
            placeholder="포스터 이미지"
          />
          <MultiImageUpload
            images={form.additionalImages}
            onAdd={(url: string) => setForm({ ...form, additionalImages: [...form.additionalImages, { url }] })}
            onRemove={(index: number) => setForm({ ...form, additionalImages: form.additionalImages.filter((_: { url: string }, i: number) => i !== index) })}
            maxCount={10}
          />
          {/* 약관 동의 */}
          <label className="flex items-start gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={agreedTerms} onChange={e => setAgreedTerms(e.target.checked)}
              className="mt-1" />
            <span>전시 등록 약관에 동의합니다.</span>
          </label>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !agreedTerms}
            className="w-full py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {createMutation.isPending ? '등록 중...' : '전시 등록 요청'}
          </button>
        </div>
      )}

      {/* 내 전시 목록 */}
      {isLoading ? (
        <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
      ) : myShows.length === 0 ? (
        <p className="text-gray-400 text-center py-8">등록한 전시가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {myShows.map(show => (
            <div key={show.id} className="p-4 border border-gray-100 rounded-xl">
              <div className="flex justify-between items-start">
                <div>
                  <button onClick={() => navigate(`/shows/${show.id}`)} className="font-medium hover:text-blue-500">{show.title}</button>
                  <p className="text-xs text-gray-500 mt-1">{show.gallery?.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[show.status]}`}>
                    {statusLabels[show.status]}
                  </span>
                  <button onClick={() => { if (confirm('삭제하시겠습니까?')) deleteMutation.mutate(show.id); }}
                    className="p-1 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {show.rejectReason && (
                <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                  <AlertTriangle size={12} /> 거절 사유: {show.rejectReason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Admin: 승인 관리 ==========
function ApprovalsSection() {
  const queryClient = useQueryClient();
  // 모든 useState/useQuery/useMutation 훅은 조건부 return 전에 선언 (React 훅 규칙)
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<{ type: string; id: number } | null>(null);
  const [adminTab, setAdminTab] = useState<'pending' | 'manage'>('pending');

  const { data, isLoading } = useQuery<{ pendingGalleries: any[]; pendingExhibitions: any[]; pendingShows: any[]; pendingRequests: any[] }>({
    queryKey: ['approvals'],
    queryFn: () => api.get('/approvals').then(r => r.data),
    staleTime: 0, // 승인 큐는 항상 최신 데이터 사용
    refetchOnMount: 'always', // 탭 전환 시에도 반드시 refetch
  });

  // 승인된 갤러리/공모 조회 (Admin 삭제용)
  const { data: allGalleries = [] } = useQuery<any[]>({
    queryKey: ['admin-all-galleries'],
    queryFn: () => api.get('/galleries').then(r => r.data),
  });

  const { data: allExhibitions = [] } = useQuery<any[]>({
    queryKey: ['admin-all-exhibitions'],
    queryFn: () => api.get('/exhibitions').then(r => r.data),
  });

  const { data: allShows = [] } = useQuery<any[]>({
    queryKey: ['admin-all-shows'],
    queryFn: () => api.get('/shows').then(r => r.data),
  });

  const invalidateAllRelated = () => {
    // refetchType: 'all' → 비활성(언마운트) 쿼리도 stale 마킹하여 다음 마운트 시 즉시 refetch
    const opts = { refetchType: 'all' as const };
    queryClient.invalidateQueries({ queryKey: ['approvals'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['my-galleries'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['galleries'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['my-exhibitions'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['exhibitions'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['admin-all-galleries'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['admin-all-exhibitions'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['my-shows'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['shows'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['admin-all-shows'], ...opts });
  };

  const approveMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      api.patch(`/approvals/${type}/${id}`, { status: 'APPROVED' }),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('승인되었습니다.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ type, id, reason }: { type: string; id: number; reason: string }) =>
      api.patch(`/approvals/${type}/${id}`, { status: 'REJECTED', rejectReason: reason }),
    onSuccess: () => {
      invalidateAllRelated();
      setRejectingId(null);
      setRejectReason('');
      toast.success('거절되었습니다.');
    },
  });

  // Admin: 갤러리 삭제
  const deleteGalleryMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/galleries/${id}`),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('갤러리가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // Admin: 공모 삭제
  const deleteExhibitionMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('공모가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // Admin: 전시 삭제
  const deleteShowMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shows/${id}`),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('전시가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // 로딩 상태 (모든 훅 선언 후에 조건부 return)
  if (isLoading) return <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />;

  const allPending = [
    ...(data?.pendingGalleries?.map(g => ({ ...g, _type: 'gallery' })) || []),
    ...(data?.pendingExhibitions?.map(e => ({ ...e, _type: 'exhibition' })) || []),
    ...(data?.pendingShows?.map(s => ({ ...s, _type: 'show' })) || []),
  ];

  return (
    <div>
      {/* Admin 서브탭 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setAdminTab('pending')} className={`px-3 py-1.5 text-sm rounded-full ${adminTab === 'pending' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
          승인 대기 ({allPending.length})
        </button>
        <button onClick={() => setAdminTab('manage')} className={`px-3 py-1.5 text-sm rounded-full ${adminTab === 'manage' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
          등록 관리
        </button>
      </div>

      {/* 등록 관리 탭 - 승인된 갤러리/공모 삭제 */}
      {adminTab === 'manage' && (
        <div className="space-y-6">
          <div>
            <h4 className="font-medium text-sm mb-2 text-gray-700">등록된 갤러리 ({allGalleries.length})</h4>
            {allGalleries.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">등록된 갤러리가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {allGalleries.map((g: any) => (
                  <div key={g.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{g.name}</p>
                      <p className="text-xs text-gray-500">{g.address} · {regionLabels[g.region]}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${g.name}" 갤러리를 삭제하시겠습니까? 관련 공모, 리뷰 등 모든 데이터가 삭제됩니다.`)) {
                          deleteGalleryMutation.mutate(g.id);
                        }
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2 text-gray-700">진행중인 공모 ({allExhibitions.length})</h4>
            {allExhibitions.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">진행중인 공모가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {allExhibitions.map((ex: any) => (
                  <div key={ex.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{ex.title}</p>
                      <p className="text-xs text-gray-500">{ex.gallery?.name} · {exhibitionTypeLabels[ex.type]}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${ex.title}" 공모를 삭제하시겠습니까?`)) {
                          deleteExhibitionMutation.mutate(ex.id);
                        }
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2 text-gray-700">등록된 전시 ({allShows.length})</h4>
            {allShows.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">등록된 전시가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {allShows.map((s: any) => (
                  <div key={s.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-gray-500">{s.gallery?.name} · {regionLabels[s.region]}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${s.title}" 전시를 삭제하시겠습니까?`)) {
                          deleteShowMutation.mutate(s.id);
                        }
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {adminTab === 'pending' && <>
      <h3 className="font-semibold mb-4">승인 대기 목록 ({allPending.length})</h3>
      {allPending.length === 0 ? (
        <p className="text-gray-400 text-center py-8">대기중인 승인 요청이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {allPending.map(item => (
            <div key={`${item._type}-${item.id}`} className="p-4 border border-gray-100 rounded-xl">
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {item._type === 'gallery' ? '갤러리' : item._type === 'exhibition' ? '공모' : '전시'}
              </span>
              <h4 className="font-medium mt-1">{item.name || item.title}</h4>
              {item._type === 'gallery' && (
                <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                  <p>주소: {item.address}</p>
                  <p>전화: {item.phone} · 대표: {item.ownerName}</p>
                  <p>지역: {regionLabels[item.region]}</p>
                  {item.instagramUrl && <p>인스타: {item.instagramUrl}</p>}
                  {item.email && <p>이메일: {item.email}</p>}
                  {item.mainImage && <img src={item.mainImage} alt="" className="w-full h-32 object-cover rounded-lg mt-2" />}
                </div>
              )}
              {item._type === 'exhibition' && (
                <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                  <p>갤러리: {item.gallery?.name} ({regionLabels[item.gallery?.region] || item.region})</p>
                  <p>유형: {exhibitionTypeLabels[item.type]} · 모집 {item.capacity}명 · 지역: {regionLabels[item.region]}</p>
                  <p>공모 기간: {item.deadlineStart ? new Date(item.deadlineStart).toLocaleDateString('ko') + ' ~ ' : ''}{new Date(item.deadline).toLocaleDateString('ko')}</p>
                  <p>전시 기간: {item.exhibitStartDate ? new Date(item.exhibitStartDate).toLocaleDateString('ko') + ' ~ ' : ''}{new Date(item.exhibitDate).toLocaleDateString('ko')}</p>
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full h-32 object-cover rounded-lg mt-2" />}
                </div>
              )}
              {item._type === 'show' && (
                <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                  <p>갤러리: {item.gallery?.name} ({regionLabels[item.gallery?.region] || item.region})</p>
                  <p>전시 기간: {new Date(item.startDate).toLocaleDateString('ko')} ~ {new Date(item.endDate).toLocaleDateString('ko')}</p>
                  <p>관람: {item.openingHours} · 입장료: {item.admissionFee}</p>
                  <p>위치: {item.location} · 지역: {regionLabels[item.region]}</p>
                  {item.posterImage && <img src={item.posterImage} alt="" className="w-full h-32 object-cover rounded-lg mt-2" />}
                </div>
              )}
              {item.description && <p className="text-sm text-gray-600 mt-2 bg-gray-50 p-2 rounded">{item.description}</p>}

              {rejectingId?.type === item._type && rejectingId?.id === item.id ? (
                <div className="mt-3 space-y-2">
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="거절 사유를 입력하세요 (필수)" className="w-full h-20 p-2 border border-gray-200 rounded-lg text-sm resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => rejectMutation.mutate({ type: item._type, id: item.id, reason: rejectReason })} disabled={!rejectReason.trim()} className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg disabled:opacity-50">거절 확인</button>
                    <button onClick={() => setRejectingId(null)} className="px-3 py-1.5 text-sm text-gray-500">취소</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => approveMutation.mutate({ type: item._type, id: item.id })} className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg flex items-center gap-1"><Check size={14} /> 승인</button>
                  <button onClick={() => setRejectingId({ type: item._type, id: item.id })} className="px-3 py-1.5 bg-red-50 text-red-500 text-sm rounded-lg flex items-center gap-1"><XCircle size={14} /> 거절</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}

// ========== Admin: 히어로 슬라이드 관리 ==========
function HeroManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', description: '', imageUrl: '', linkUrl: '', order: 0 });
  const [preview, setPreview] = useState(false);

  const { data: slides = [] } = useQuery<any[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/hero-slides', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hero-slides'] });
      resetForm();
      toast.success('슬라이드가 등록되었습니다.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/hero-slides/${editingId}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hero-slides'] });
      resetForm();
      toast.success('슬라이드가 수정되었습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/hero-slides/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hero-slides'] });
      toast.success('슬라이드가 삭제되었습니다.');
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: '', description: '', imageUrl: '', linkUrl: '', order: 0 });
    setPreview(false);
  };

  const startEdit = (s: any) => {
    setForm({ title: s.title, description: s.description || '', imageUrl: s.imageUrl, linkUrl: s.linkUrl || '', order: s.order });
    setEditingId(s.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">히어로 슬라이드 ({slides.length}개)</h3>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 새 슬라이드
        </button>
      </div>

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <h4 className="font-medium text-sm">{editingId ? '슬라이드 수정' : '새 슬라이드 등록'}</h4>
          <input placeholder="제목 *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <input placeholder="설명" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <input placeholder="링크 URL (선택)" value={form.linkUrl} onChange={e => setForm({...form, linkUrl: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <input type="number" placeholder="순서" value={form.order} onChange={e => setForm({...form, order: Number(e.target.value)})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <ImageUpload value={form.imageUrl} onChange={(url) => setForm({...form, imageUrl: url})} onRemove={() => setForm({...form, imageUrl: ''})} placeholder="슬라이드 이미지 업로드" />

          {/* 미리보기 */}
          <button onClick={() => setPreview(!preview)} className="flex items-center gap-1 text-sm text-blue-500">
            <Eye size={14} /> {preview ? '미리보기 닫기' : '미리보기'}
          </button>
          {preview && form.imageUrl && (
            <div className="relative w-full h-40 rounded-lg overflow-hidden">
              <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute bottom-3 left-3">
                <p className="text-white font-bold text-sm">{form.title || '제목'}</p>
                <p className="text-white/70 text-xs">{form.description || '설명'}</p>
              </div>
              {form.linkUrl && <span className="absolute bottom-3 right-3 text-xs bg-white text-gray-900 px-2 py-1 rounded">바로가기 →</span>}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!form.title || !form.imageUrl) { toast.error('제목과 이미지는 필수입니다.'); return; }
                editingId ? updateMutation.mutate() : createMutation.mutate();
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg"
            >{editingId ? '수정' : '등록'}</button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      {/* 슬라이드 목록 */}
      <div className="space-y-3">
        {slides.map((s: any) => (
          <div key={s.id} className="flex gap-3 p-3 border border-gray-100 rounded-xl items-center">
            <img src={s.imageUrl} alt="" className="w-20 h-14 object-cover rounded-lg flex-none" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{s.title}</p>
              <p className="text-xs text-gray-500 truncate">{s.description}</p>
            </div>
            <div className="flex gap-1 flex-none">
              <button onClick={() => startEdit(s)} className="p-1.5 text-gray-400 hover:text-blue-500"><Edit3 size={14} /></button>
              <button onClick={() => deleteMutation.mutate(s.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== Admin: 혜택 관리 ==========
function BenefitManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', description: '', imageUrl: '', linkUrl: '' });
  const [preview, setPreview] = useState(false);

  const { data: benefits = [] } = useQuery<any[]>({
    queryKey: ['benefits'],
    queryFn: () => api.get('/benefits').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/benefits', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benefits'] });
      resetForm();
      toast.success('혜택이 등록되었습니다.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/benefits/${editingId}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benefits'] });
      resetForm();
      toast.success('혜택이 수정되었습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/benefits/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benefits'] });
      toast.success('혜택이 삭제되었습니다.');
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: '', description: '', imageUrl: '', linkUrl: '' });
    setPreview(false);
  };

  const startEdit = (b: any) => {
    setForm({ title: b.title, description: b.description, imageUrl: b.imageUrl || '', linkUrl: b.linkUrl || '' });
    setEditingId(b.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">혜택 목록 ({benefits.length}개)</h3>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 새 혜택
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <h4 className="font-medium text-sm">{editingId ? '혜택 수정' : '새 혜택 등록'}</h4>
          <input placeholder="제목 *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <textarea placeholder="설명 *" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
          <input placeholder="링크 URL (선택)" value={form.linkUrl} onChange={e => setForm({...form, linkUrl: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <ImageUpload value={form.imageUrl} onChange={(url) => setForm({...form, imageUrl: url})} onRemove={() => setForm({...form, imageUrl: ''})} placeholder="혜택 이미지 업로드" />

          <button onClick={() => setPreview(!preview)} className="flex items-center gap-1 text-sm text-blue-500">
            <Eye size={14} /> {preview ? '미리보기 닫기' : '미리보기'}
          </button>
          {preview && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {form.imageUrl && <img src={form.imageUrl} alt="" className="w-full h-32 object-cover" />}
              <div className="p-3">
                <p className="font-semibold text-sm">{form.title || '제목'}</p>
                <p className="text-xs text-gray-600 mt-1">{form.description || '설명'}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!form.title || !form.description) { toast.error('제목과 설명은 필수입니다.'); return; }
                editingId ? updateMutation.mutate() : createMutation.mutate();
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg"
            >{editingId ? '수정' : '등록'}</button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {benefits.map((b: any) => (
          <div key={b.id} className="flex gap-3 p-3 border border-gray-100 rounded-xl items-center">
            {b.imageUrl && <img src={b.imageUrl} alt="" className="w-20 h-14 object-cover rounded-lg flex-none" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{b.title}</p>
              <p className="text-xs text-gray-500 truncate">{b.description}</p>
            </div>
            <div className="flex gap-1 flex-none">
              <button onClick={() => startEdit(b)} className="p-1.5 text-gray-400 hover:text-blue-500"><Edit3 size={14} /></button>
              <button onClick={() => deleteMutation.mutate(b.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== Admin: 이달의 갤러리 관리 ==========
function GotmManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGalleryId, setSelectedGalleryId] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState('');

  const { data: gotm = [] } = useQuery<any[]>({
    queryKey: ['gallery-of-month'],
    queryFn: () => api.get('/gallery-of-month').then(r => r.data),
  });

  // 갤러리 검색
  const { data: searchResults = [] } = useQuery<any[]>({
    queryKey: ['galleries-search', searchQuery],
    queryFn: () => api.get('/galleries').then(r => r.data),
    enabled: showForm,
  });

  const filteredResults = searchResults.filter((g: any) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !gotm.some((item: any) => item.galleryId === g.id)
  );

  const createMutation = useMutation({
    mutationFn: () => api.post('/gallery-of-month', { galleryId: selectedGalleryId, expiresAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      setShowForm(false);
      setSelectedGalleryId(null);
      setExpiresAt('');
      toast.success('이달의 갤러리가 등록되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/gallery-of-month/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      toast.success('삭제되었습니다.');
    },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">이달의 갤러리 ({gotm.length}개)</h3>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 갤러리 선정
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <h4 className="font-medium text-sm">갤러리 검색 및 선정</h4>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="갤러리명 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 p-2.5 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          {filteredResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
              {filteredResults.map((g: any) => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGalleryId(g.id)}
                  className={`w-full text-left p-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-gray-50 ${selectedGalleryId === g.id ? 'bg-blue-50' : ''}`}
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-gray-400 ml-2">({regionLabels[g.region]})</span>
                </button>
              ))}
            </div>
          )}
          {selectedGalleryId && (
            <p className="text-sm text-green-600">선택됨: {searchResults.find((g: any) => g.id === selectedGalleryId)?.name}</p>
          )}
          <div>
            <label className="text-xs text-gray-500">등록 기한</label>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!selectedGalleryId || !expiresAt) { toast.error('갤러리와 기한을 선택해주세요.'); return; }
                createMutation.mutate();
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg"
            >선정</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {gotm.map((item: any) => (
          <div key={item.id} className="flex gap-3 p-3 border border-gray-100 rounded-xl items-center">
            {item.gallery?.mainImage && <img src={item.gallery.mainImage} alt="" className="w-14 h-14 object-cover rounded-lg flex-none" />}
            <div className="flex-1">
              <p className="font-medium text-sm">{item.gallery?.name}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar size={12} /> 만료: {new Date(item.expiresAt).toLocaleDateString('ko')}
              </p>
            </div>
            <button onClick={() => deleteMutation.mutate(item.id)} className="p-1.5 text-gray-400 hover:text-red-500">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
