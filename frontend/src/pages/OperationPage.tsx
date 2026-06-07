/**
 * OperationPage — 공모 운영 페이지 (/exhibitions/:id/operation)
 *
 * 접근: 갤러리 오너 / Admin / 수락(ACCEPTED)된 작가
 *  - 공지사항: 모두 열람, 오너·Admin 작성/수정/삭제
 *  - 수락 작가: 본인 전시정보(출품리스트/약력/작가노트) 작성·수정
 *  - 오너·Admin: 전 작가 제출정보 열람 + 문서별 PDF 저장 (타 작가끼리는 비공개)
 *
 * API: /api/operations/:id/(access|notices|me|submissions|submissions/:userId)
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Minus, Trash2, Edit3, Megaphone, FileDown, ChevronDown, ChevronUp, Loader2, Upload, ImageOff, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { displayName, compressImage, MAX_IMAGE_BYTES, formatPhoneNumber } from '@/lib/utils';
import type {
  OperationAccess, ExhibitionNotice, OperationSubmission,
  ArtworkItem, ArtistCv, CvEntry, ArtistNote, Settlement, SettlementArtist,
} from '@/types';
import { EMPTY_CV, EMPTY_NOTE } from '@/types';

const CV_SECTIONS: { key: keyof Pick<ArtistCv, 'solo' | 'group' | 'artFair' | 'award'>; label: string }[] = [
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어 / 옥션' },
  { key: 'award', label: '수상 및 선정' },
];

export default function OperationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data: access, isLoading, error } = useQuery<OperationAccess>({
    queryKey: ['operation-access', id],
    queryFn: () => api.get(`/operations/${id}/access`).then(r => r.data),
    enabled: !!id,
    retry: false,
  });

  if (isLoading) return <div className="max-w-3xl mx-auto px-6 py-10"><div className="h-40 bg-gray-100 animate-pulse rounded-xl" /></div>;
  if (error || !access) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center text-gray-400">
        <p>운영 페이지에 접근할 수 없습니다.</p>
        <button onClick={() => navigate(`/exhibitions/${id}`)} className="mt-4 text-sm text-gray-600 hover:text-gray-900 underline">공모 상세로 이동</button>
      </div>
    );
  }

  const canManage = access.isOwner || access.isAdmin;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <button onClick={() => navigate(`/exhibitions/${id}`)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900 mb-4">
        <ArrowLeft size={15} /> 공모 상세
      </button>
      <div className="mb-8">
        <p className="text-xs text-gray-400">{access.galleryName} · 운영 페이지</p>
        <h1 className="text-2xl md:text-3xl font-serif text-gray-900 mt-1">{access.title}</h1>
      </div>

      {canManage && <StatusPanel exhibitionId={id!} access={access} />}

      <NoticesSection exhibitionId={id!} canManage={canManage} />

      {access.isAcceptedArtist && access.ended && <MyArtistSettlementSection exhibitionId={id!} />}

      {access.isAcceptedArtist && <MySubmissionSection exhibitionId={id!} myUserId={user!.id} confirmed={access.confirmed} />}

      {canManage && <AdminSubmissionsSection exhibitionId={id!} exhibitionTitle={access.title} />}

      {canManage && access.ended && <SettlementSection exhibitionId={id!} />}
    </div>
  );
}

// ============ 공모 상태 관리 (모집마감/확정/전시종료) ============
function StatusPanel({ exhibitionId, access }: { exhibitionId: string; access: OperationAccess }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch(`/operations/${exhibitionId}/lifecycle`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] }); qc.invalidateQueries({ queryKey: ['exhibitions'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '변경 실패'),
  });

  const Toggle = ({ active, onLabel, offLabel, onClick, activeClass }: { active: boolean; onLabel: string; offLabel: string; onClick: () => void; activeClass: string }) => (
    <button onClick={onClick} disabled={mutation.isPending}
      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${active ? activeClass : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
      {active ? onLabel : offLabel}
    </button>
  );

  return (
    <section className="mb-8 border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-900">공모 상태 관리</h2>
        <div className="flex gap-1.5">
          {access.recruitmentClosed && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">모집마감</span>}
          {access.confirmed && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">확정</span>}
          {access.ended && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">전시종료</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Toggle active={access.recruitmentClosed} onLabel="모집 재개" offLabel="모집마감" activeClass="border-gray-800 bg-gray-800 text-white"
          onClick={() => mutation.mutate({ recruitmentClosed: !access.recruitmentClosed })} />
        <Toggle active={access.manualConfirmed} onLabel="확정 취소" offLabel="확정" activeClass="border-blue-600 bg-blue-600 text-white"
          onClick={() => mutation.mutate({ confirmed: !access.manualConfirmed })} />
        <Toggle active={access.ended} onLabel="종료 취소" offLabel="전시종료" activeClass="border-red-500 bg-red-500 text-white"
          onClick={() => mutation.mutate({ ended: !access.ended })} />
      </div>
      <p className="text-xs text-gray-400 mt-2 leading-relaxed">
        · 모집마감: 모집공고가 목록에서 내려갑니다.<br />
        · 확정: 작가의 전시정보 수정이 잠깁니다. <b>전시 시작일이 지나면 자동 확정</b>됩니다{access.confirmed && !access.manualConfirmed ? ' (현재 시작일 경과로 자동 확정됨)' : ''}.<br />
        · 전시종료: 정산 단계로 전환되며 아래에 정산 입력이 나타납니다.
      </p>
    </section>
  );
}

// ============ 공지사항 ============
function NoticesSection({ exhibitionId, canManage }: { exhibitionId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: notices = [], isLoading } = useQuery<ExhibitionNotice[]>({
    queryKey: ['operation-notices', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/notices`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const reset = () => { setShowForm(false); setEditId(null); setTitle(''); setContent(''); };

  const saveMutation = useMutation({
    mutationFn: () => editId
      ? api.patch(`/operations/${exhibitionId}/notices/${editId}`, { title, content })
      : api.post(`/operations/${exhibitionId}/notices`, { title, content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-notices', exhibitionId] }); reset(); toast.success('공지가 저장되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (nid: number) => api.delete(`/operations/${exhibitionId}/notices/${nid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-notices', exhibitionId] }); toast.success('삭제되었습니다.'); },
  });

  const startEdit = (n: ExhibitionNotice) => { setEditId(n.id); setTitle(n.title); setContent(n.content); setShowForm(true); };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-lg font-medium text-gray-900"><Megaphone size={18} /> 공지사항</h2>
        {canManage && !showForm && (
          <button onClick={() => { reset(); setShowForm(true); }} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <Plus size={15} /> 공지 작성
          </button>
        )}
      </div>

      {showForm && (
        <div className="border border-gray-200 rounded-xl p-4 mb-4 space-y-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="제목" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400" />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="공지 내용" className="w-full h-28 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-gray-400" />
          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="px-3 py-1.5 text-sm text-gray-500">취소</button>
            <button onClick={() => { if (!title.trim() || !content.trim()) { toast.error('제목과 내용을 입력해주세요.'); return; } saveMutation.mutate(); }} disabled={saveMutation.isPending} className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">{editId ? '수정' : '등록'}</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
      ) : notices.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">등록된 공지가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {notices.map(n => (
            <div key={n.id} className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-medium text-sm text-gray-900">{n.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString('ko')}</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(n)} className="p-1 text-gray-400 hover:text-gray-900" aria-label="수정"><Edit3 size={14} /></button>
                    <button onClick={() => { if (window.confirm('이 공지를 삭제할까요?')) deleteMutation.mutate(n.id); }} className="p-1 text-gray-400 hover:text-red-500" aria-label="삭제"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap mt-2">{n.content}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============ 작가 본인 제출정보 ============
function MySubmissionSection({ exhibitionId, myUserId, confirmed }: { exhibitionId: string; myUserId: number; confirmed: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<OperationSubmission>({
    queryKey: ['operation-me', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/me`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [artworkList, setArtworkList] = useState<ArtworkItem[]>([]);
  const [cv, setCv] = useState<ArtistCv>(EMPTY_CV);
  const [note, setNote] = useState<ArtistNote>(EMPTY_NOTE);
  const [tab, setTab] = useState<'artwork' | 'cv' | 'note'>('artwork');

  useEffect(() => {
    if (data) {
      setArtworkList(data.artworkList || []);
      setCv(data.cv || EMPTY_CV);
      setNote(data.note || EMPTY_NOTE);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/operations/${exhibitionId}/me`, { artworkList, cv, note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-me', exhibitionId] }); toast.success('전시 정보가 저장되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  const loadFromPortfolio = async () => {
    try {
      const { data: p } = await api.get('/portfolio');
      const c = p.career || {};
      setCv(prev => ({
        ...prev,
        solo: (c.solo || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        group: (c.group || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        artFair: (c.artFair || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
      }));
      toast.success('포트폴리오 약력을 불러왔습니다. (개인전/단체전/아트페어)');
    } catch {
      toast.error('포트폴리오를 불러오지 못했습니다.');
    }
  };

  const openPrint = (doc: 'artwork' | 'cv' | 'note') => {
    window.open(`/exhibitions/${exhibitionId}/operation/print/${myUserId}/${doc}`, '_blank');
  };

  if (isLoading) return <div className="h-40 bg-gray-100 animate-pulse rounded-xl mb-10" />;

  // 확정됨 → 읽기 전용
  if (confirmed) {
    return (
      <section className="mb-10">
        <h2 className="text-lg font-medium text-gray-900 mb-2">내 전시 정보</h2>
        <div className="mb-3 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          전시 정보가 <b>확정</b>되어 더 이상 수정할 수 없습니다. (제출 내용은 아래에서 확인 가능)
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => openPrint('artwork')} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1"><FileDown size={13} /> 출품리스트 PDF</button>
          <button onClick={() => openPrint('cv')} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1"><FileDown size={13} /> 작가약력 PDF</button>
          <button onClick={() => openPrint('note')} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1"><FileDown size={13} /> 작가노트 PDF</button>
        </div>
        <SubmissionReadonly submission={{ artworkList, cv, note }} />
      </section>
    );
  }

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium text-gray-900">내 전시 정보</h2>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">
          {saveMutation.isPending ? '저장 중...' : '저장'}
        </button>
      </div>

      <div className="flex gap-1.5 mb-4">
        {([['artwork', '출품리스트'], ['cv', '작가약력'], ['note', '작가노트']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-sm rounded-full transition-colors ${tab === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{label}</button>
        ))}
      </div>

      <div className="border border-gray-100 rounded-xl p-4">
        {tab === 'artwork' && (
          <>
            <div className="flex justify-end mb-2">
              <button onClick={() => openPrint('artwork')} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} /> PDF 미리보기</button>
            </div>
            <ArtworkListEditor value={artworkList} onChange={setArtworkList} />
          </>
        )}
        {tab === 'cv' && (
          <>
            <div className="flex justify-between mb-2">
              <button onClick={loadFromPortfolio} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">포트폴리오 약력 불러오기</button>
              <button onClick={() => openPrint('cv')} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} /> PDF 미리보기</button>
            </div>
            <CvEditor value={cv} onChange={setCv} />
          </>
        )}
        {tab === 'note' && (
          <>
            <div className="flex justify-end mb-2">
              <button onClick={() => openPrint('note')} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} /> PDF 미리보기</button>
            </div>
            <NoteEditor value={note} onChange={setNote} />
          </>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">* 입력 내용은 [저장] 후 갤러리·관리자에게 전달됩니다. 다른 작가는 내 정보를 볼 수 없습니다.</p>
    </section>
  );
}

// ============ 갤러리/Admin: 전 작가 제출정보 ============
function AdminSubmissionsSection({ exhibitionId, exhibitionTitle }: { exhibitionId: string; exhibitionTitle: string }) {
  const { data = [], isLoading, refetch, isFetching } = useQuery<{ user: any; submission: OperationSubmission }[]>({
    queryKey: ['operation-submissions', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/submissions`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);

  const openPrint = (userId: number, doc: 'artwork' | 'cv' | 'note') => {
    window.open(`/exhibitions/${exhibitionId}/operation/print/${userId}/${doc}`, '_blank');
  };

  const downloadAllZip = async () => {
    if (data.length === 0) { toast.error('수락된 작가가 없습니다.'); return; }
    setZipping(true);
    const t = toast.loading('전체 제출물 PDF를 생성하는 중입니다... (작가 수에 따라 다소 걸릴 수 있어요)');
    try {
      const { downloadAllSubmissionsZip } = await import('@/lib/operationPdf');
      await downloadAllSubmissionsZip(exhibitionTitle, data);
      toast.success('ZIP 다운로드를 시작합니다.', { id: t });
    } catch (e) {
      toast.error('PDF 생성에 실패했습니다.', { id: t });
    } finally {
      setZipping(false);
    }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-lg font-medium text-gray-900">작가 제출 정보 <span className="text-sm text-gray-400">({data.length}명)</span></h2>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => refetch()} disabled={isFetching} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50">{isFetching ? '불러오는 중...' : '새로고침'}</button>
          {data.length > 0 && (
            <button onClick={downloadAllZip} disabled={zipping} className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {zipping ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {zipping ? '생성 중...' : '전체 PDF (ZIP)'}
            </button>
          )}
        </div>
      </div>
      {isLoading ? (
        <div className="h-20 bg-gray-100 animate-pulse rounded-xl" />
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">아직 수락된 작가가 없습니다. 지원자를 '수락'하면 이곳에 표시됩니다.</p>
      ) : (
        <div className="space-y-3">
          {data.map(({ user, submission }) => {
            const isOpen = openId === user.id;
            const artCount = submission.artworkList?.length || 0;
            const hasCv = !!submission.cv;
            const hasNote = !!(submission.note && (submission.note.statement || submission.note.sections?.length));
            return (
              <div key={user.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <button onClick={() => setOpenId(isOpen ? null : user.id)} className="w-full flex items-center justify-between gap-2 p-3 hover:bg-gray-50">
                  <div className="flex items-center gap-2 min-w-0">
                    {user.avatar ? <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover" /> : <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center"><User size={14} className="text-gray-400" /></div>}
                    <span className="text-sm font-medium text-gray-900">{displayName(user)}</span>
                    <span className="text-xs text-gray-400">출품 {artCount} · 약력 {hasCv ? 'O' : '–'} · 노트 {hasNote ? 'O' : '–'}</span>
                  </div>
                  {isOpen ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 p-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openPrint(user.id, 'artwork')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"><FileDown size={13} /> 출품리스트 PDF</button>
                      <button onClick={() => openPrint(user.id, 'cv')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"><FileDown size={13} /> 작가약력 PDF</button>
                      <button onClick={() => openPrint(user.id, 'note')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"><FileDown size={13} /> 작가노트 PDF</button>
                    </div>
                    <SubmissionReadonly submission={submission} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// 읽기 전용 제출정보 (갤러리/Admin)
function SubmissionReadonly({ submission }: { submission: OperationSubmission }) {
  const { artworkList = [], cv, note } = submission;
  return (
    <div className="space-y-4 text-sm">
      {/* 출품리스트 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">출품리스트 ({artworkList.length})</p>
        {artworkList.length === 0 ? <p className="text-xs text-gray-400">미입력</p> : (
          <div className="space-y-1.5">
            {artworkList.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {a.image ? <img src={a.image} alt="" className="w-10 h-10 object-cover rounded shrink-0" /> : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0"><ImageOff size={14} className="text-gray-300" /></div>}
                <span className="text-gray-800">{a.title || '(제목 없음)'}</span>
                <span className="text-gray-400">{[a.size, a.medium, a.year, a.price].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 약력 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">작가약력</p>
        {!cv ? <p className="text-xs text-gray-400">미입력</p> : (
          <div className="text-xs text-gray-700 space-y-1">
            <p>{cv.nameKo} {cv.nameEn} {cv.birth && `(${cv.birth})`}</p>
            {CV_SECTIONS.map(({ key, label }) => (cv[key]?.length > 0) && (
              <p key={key}><span className="text-gray-400">{label}: </span>{cv[key].map(e => `${e.year} ${e.content}`).join(' / ')}</p>
            ))}
          </div>
        )}
      </div>
      {/* 노트 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">작가노트</p>
        {!note || (!note.statement && !(note.sections?.length)) ? <p className="text-xs text-gray-400">미입력</p> : (
          <div className="text-xs text-gray-700 whitespace-pre-wrap">
            {note.statement}
            {note.sections?.map((s, i) => <div key={i} className="mt-2"><span className="font-medium">{s.title}</span>{'\n'}{s.body}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 정산 (전시종료 후) ============
const won = (n: number) => `${(n || 0).toLocaleString('ko')}원`;

type EditWork = { index: number; title: string; image?: string; size?: string; medium?: string; year?: string; listPrice: string; sold: boolean; soldPrice: number };
type EditArtist = { user: { id: number; name: string; nickname?: string | null; email?: string }; galleryRatio: number; works: EditWork[] };

function artistTotals(a: EditArtist) {
  const total = a.works.filter(w => w.sold).reduce((s, w) => s + (w.soldPrice || 0), 0);
  const galleryAmount = Math.round(total * a.galleryRatio / 100);
  return { total, galleryAmount, artistAmount: total - galleryAmount };
}

// 작가 본인 정산 내역 (전시종료 후)
function MyArtistSettlementSection({ exhibitionId }: { exhibitionId: string }) {
  const { data, isLoading } = useQuery<{ exhibitionTitle: string; ended: boolean; artist: SettlementArtist }>({
    queryKey: ['operation-my-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/my-settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [downloading, setDownloading] = useState(false);

  if (isLoading) return <div className="h-24 bg-gray-100 animate-pulse rounded-xl mb-10" />;
  if (!data?.artist) return null;
  const a = data.artist;
  const sold = a.works.filter(w => w.sold);

  const downloadMine = async () => {
    setDownloading(true);
    try {
      const { downloadArtistSettlementPdf } = await import('@/lib/operationPdf');
      await downloadArtistSettlementPdf(data.exhibitionTitle, a);
    } catch { toast.error('PDF 생성 실패'); } finally { setDownloading(false); }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium text-gray-900">내 정산 내역</h2>
        <button onClick={downloadMine} disabled={downloading} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} 내 정산서 PDF
        </button>
      </div>
      <div className="border border-gray-200 rounded-xl p-4">
        {sold.length === 0 ? (
          <p className="text-sm text-gray-400">아직 판매된 작품이 없습니다.</p>
        ) : (
          <div className="space-y-2 mb-3">
            {sold.map((w, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                {w.image ? <img src={w.image} alt="" className="w-12 h-12 object-cover rounded shrink-0" /> : <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center shrink-0"><ImageOff size={14} className="text-gray-300" /></div>}
                <span className="flex-1 min-w-0 truncate">{w.title || '(제목 없음)'}</span>
                <span className="text-gray-700 shrink-0">{w.soldPrice.toLocaleString('ko')}원</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-3 border-t border-gray-100 text-sm">
          <span className="text-gray-500">판매 합계 <b className="text-gray-900">{a.total.toLocaleString('ko')}원</b></span>
          <span className="text-gray-500">정산 비율 <b className="text-gray-900">갤러리 {a.galleryRatio}% : 작가 {a.artistRatio}%</b></span>
          <span className="text-gray-900 font-medium">내 정산액 {a.artistAmount.toLocaleString('ko')}원</span>
        </div>
      </div>
    </section>
  );
}

function SettlementSection({ exhibitionId }: { exhibitionId: string }) {
  const { data, isLoading } = useQuery<Settlement>({
    queryKey: ['operation-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [artists, setArtists] = useState<EditArtist[]>([]);
  const [exTitle, setExTitle] = useState('');
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    if (data) {
      setExTitle(data.exhibitionTitle);
      setArtists(data.artists.map(a => ({
        user: a.user,
        galleryRatio: a.galleryRatio,
        works: a.works.map(w => ({ index: w.index, title: w.title, image: w.image, size: w.size, medium: w.medium, year: w.year, listPrice: w.listPrice, sold: w.sold, soldPrice: w.soldPrice })),
      })));
    }
  }, [data]);

  const updWork = (ai: number, wi: number, patch: Partial<EditWork>) =>
    setArtists(prev => prev.map((a, i) => i !== ai ? a : { ...a, works: a.works.map((w, j) => j === wi ? { ...w, ...patch } : w) }));
  const updRatio = (ai: number, ratio: number) =>
    setArtists(prev => prev.map((a, i) => i === ai ? { ...a, galleryRatio: Math.min(100, Math.max(0, ratio)) } : a));

  const saveMutation = useMutation({
    mutationFn: () => {
      const sales = artists.flatMap(a => a.works.filter(w => w.sold).map(w => ({ artistUserId: a.user.id, artworkIndex: w.index, title: w.title, soldPrice: w.soldPrice || 0 })));
      const ratios = artists.map(a => ({ artistUserId: a.user.id, galleryRatio: a.galleryRatio }));
      return api.put(`/operations/${exhibitionId}/settlement`, { sales, ratios });
    },
    onSuccess: () => toast.success('정산 정보가 저장되었습니다.'),
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  // 현재 편집 상태로 정산 객체 구성 (PDF용)
  const buildSettlement = (): Settlement => {
    const built = artists.map(a => {
      const t = artistTotals(a);
      return { user: a.user, galleryRatio: a.galleryRatio, artistRatio: 100 - a.galleryRatio, works: a.works, ...t };
    });
    return {
      exhibitionTitle: exTitle,
      artists: built,
      grand: {
        total: built.reduce((s, a) => s + a.total, 0),
        galleryAmount: built.reduce((s, a) => s + a.galleryAmount, 0),
        artistAmount: built.reduce((s, a) => s + a.artistAmount, 0),
        soldCount: built.reduce((s, a) => s + a.works.filter(w => w.sold).length, 0),
      },
    };
  };

  const downloadOverall = async () => {
    setZipping(true);
    try {
      const { downloadOverallSettlementPdf } = await import('@/lib/operationPdf');
      await downloadOverallSettlementPdf(buildSettlement());
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };
  const downloadArtist = async (ai: number) => {
    setZipping(true);
    try {
      const s = buildSettlement();
      const { downloadArtistSettlementPdf } = await import('@/lib/operationPdf');
      await downloadArtistSettlementPdf(s.exhibitionTitle, s.artists[ai]);
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };

  if (isLoading) return <div className="h-32 bg-gray-100 animate-pulse rounded-xl mb-10" />;

  const grand = buildSettlement().grand;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-medium text-gray-900">정산</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">{saveMutation.isPending ? '저장 중...' : '정산 저장'}</button>
          <button onClick={downloadOverall} disabled={zipping} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"><FileDown size={13} /> 전체 정산 PDF</button>
        </div>
      </div>

      {artists.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">수락된 작가가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {artists.map((a, ai) => {
            const t = artistTotals(a);
            return (
              <div key={a.user.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm text-gray-900">{displayName(a.user)}</span>
                  <button onClick={() => downloadArtist(ai)} disabled={zipping} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"><FileDown size={12} /> 작가 정산 PDF</button>
                </div>

                {a.works.length === 0 ? (
                  <p className="text-xs text-gray-400">등록된 출품작이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {a.works.map((w, wi) => (
                      <div key={wi} className={`flex items-center gap-3 p-2 rounded-lg border ${w.sold ? 'border-gray-300 bg-gray-50' : 'border-gray-100'}`}>
                        <input type="checkbox" checked={w.sold} onChange={e => updWork(ai, wi, { sold: e.target.checked })} className="shrink-0" />
                        {/* 작품 사진 */}
                        {w.image ? (
                          <img src={w.image} alt="" className="w-14 h-14 object-cover rounded shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded bg-gray-100 flex items-center justify-center shrink-0"><ImageOff size={16} className="text-gray-300" /></div>
                        )}
                        {/* 작품 정보 */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{w.title || '(제목 없음)'}</p>
                          <p className="text-xs text-gray-400 truncate">{[w.size, w.medium, w.year].filter(Boolean).join(' · ')}{w.listPrice ? ` · 희망 ${w.listPrice}` : ''}</p>
                        </div>
                        {/* 판매가 */}
                        {w.sold && (
                          <div className="flex items-center gap-1 shrink-0">
                            <input type="text" inputMode="numeric" value={w.soldPrice ? w.soldPrice.toLocaleString('ko') : ''}
                              onChange={e => updWork(ai, wi, { soldPrice: parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0 })}
                              placeholder="판매가" className="w-28 px-2 py-1 border border-gray-300 rounded text-sm text-right" />
                            <span className="text-xs text-gray-400">원</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100 text-sm">
                  <span className="text-gray-500">판매 합계 <b className="text-gray-900">{won(t.total)}</b></span>
                  <span className="flex items-center gap-1">
                    갤러리
                    <input type="number" min={0} max={100} value={a.galleryRatio} onChange={e => updRatio(ai, parseInt(e.target.value) || 0)} className="w-14 px-1.5 py-0.5 border border-gray-200 rounded text-sm text-right" />%
                    <span className="text-gray-400">: 작가 {100 - a.galleryRatio}%</span>
                  </span>
                  <span className="text-gray-500">갤러리 <b className="text-gray-900">{won(t.galleryAmount)}</b></span>
                  <span className="text-gray-500">작가 <b className="text-gray-900">{won(t.artistAmount)}</b></span>
                </div>
              </div>
            );
          })}

          {/* 전체 합계 */}
          <div className="border border-gray-300 rounded-xl p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-900 mb-1">전체 정산</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
              <span>판매 작품 <b className="text-gray-900">{grand.soldCount}점</b></span>
              <span>판매 합계 <b className="text-gray-900">{won(grand.total)}</b></span>
              <span>갤러리 합계 <b className="text-gray-900">{won(grand.galleryAmount)}</b></span>
              <span>작가 지급 합계 <b className="text-gray-900">{won(grand.artistAmount)}</b></span>
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">* 비율·판매가 변경 후 [정산 저장]을 눌러야 보관됩니다. PDF는 현재 화면 값으로 생성됩니다.</p>
    </section>
  );
}

// ============ 에디터들 ============

// 출품작 이미지 셀 (compact 업로드)
function ArtworkImageCell({ value, onChange }: { value?: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (raw: File) => {
    setUploading(true);
    try {
      const file = await compressImage(raw);
      if (file.size > MAX_IMAGE_BYTES) { toast.error('이미지 용량이 너무 큽니다.'); return; }
      const fd = new FormData(); fd.append('image', file);
      const res = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(res.data.url);
    } catch { toast.error('이미지 업로드 실패'); } finally { setUploading(false); }
  };
  return (
    <button type="button" onClick={() => inputRef.current?.click()} className="w-16 h-16 shrink-0 rounded border border-dashed border-gray-300 overflow-hidden flex items-center justify-center text-gray-400 hover:border-gray-400 bg-gray-50">
      {uploading ? <Loader2 size={16} className="animate-spin" /> : value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <Upload size={16} />}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
    </button>
  );
}

function ArtworkListEditor({ value, onChange }: { value: ArtworkItem[]; onChange: (v: ArtworkItem[]) => void }) {
  const add = () => onChange([...value, { image: '', title: '', size: '', medium: '', year: '', price: '' }]);
  const upd = (i: number, patch: Partial<ArtworkItem>) => onChange(value.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const rm = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-xs text-gray-400">출품할 작품을 추가하세요.</p>}
      {value.map((a, i) => (
        <div key={i} className="flex gap-2 items-start border border-gray-100 rounded-lg p-2">
          <span className="text-xs text-gray-400 w-5 pt-1 text-center shrink-0">{i + 1}</span>
          <ArtworkImageCell value={a.image} onChange={url => upd(i, { image: url })} />
          <div className="flex-1 grid grid-cols-2 gap-1.5 min-w-0">
            <input value={a.title} onChange={e => upd(i, { title: e.target.value })} placeholder="작품명" className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm" />
            <input value={a.size} onChange={e => upd(i, { size: e.target.value })} placeholder="크기 (33.4x24.2 cm)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
            <input value={a.medium} onChange={e => upd(i, { medium: e.target.value })} placeholder="재료 (Acrylic on Canvas)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
            <input value={a.year} onChange={e => upd(i, { year: e.target.value })} placeholder="제작년도" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
            <input value={a.price} onChange={e => upd(i, { price: e.target.value })} placeholder="가격 (비매/₩320,000)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
          </div>
          <button onClick={() => rm(i)} className="p-1 text-gray-400 hover:text-red-500 shrink-0" aria-label="삭제"><Minus size={16} /></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Plus size={15} /> 작품 추가</button>
    </div>
  );
}

// {year, content} 리스트 에디터
function EntryListEditor({ label, value, onChange }: { label: string; value: CvEntry[]; onChange: (v: CvEntry[]) => void }) {
  const add = () => onChange([...value, { year: '', content: '' }]);
  const upd = (i: number, patch: Partial<CvEntry>) => onChange(value.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  const rm = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <button onClick={add} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Plus size={13} /> 추가</button>
      </div>
      {value.length === 0 ? <p className="text-xs text-gray-400">항목을 추가하세요.</p> : (
        <div className="space-y-1.5">
          {value.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={e.year} onChange={ev => upd(i, { year: ev.target.value })} placeholder="연도" className="w-16 shrink-0 px-2 py-1.5 border border-gray-200 rounded text-sm" />
              <input value={e.content} onChange={ev => upd(i, { content: ev.target.value })} placeholder="내용 (전시명, 장소 등)" className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-sm" />
              <button onClick={() => rm(i)} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0" aria-label="삭제"><Minus size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CvEditor({ value, onChange }: { value: ArtistCv; onChange: (v: ArtistCv) => void }) {
  const set = (patch: Partial<ArtistCv>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <input value={value.nameKo} onChange={e => set({ nameKo: e.target.value })} placeholder="이름 (한글)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
        <input value={value.nameEn} onChange={e => set({ nameEn: e.target.value })} placeholder="이름 (영문)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
        <input value={value.birth} onChange={e => set({ birth: e.target.value })} placeholder="출생 (예: b. 1993, Seoul)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
        <input value={value.tel} onChange={e => set({ tel: formatPhoneNumber(e.target.value) })} placeholder="연락처 (010-1234-5678)" inputMode="numeric" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
        <input value={value.email} onChange={e => set({ email: e.target.value })} placeholder="이메일" className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm" />
      </div>
      {CV_SECTIONS.map(({ key, label }) => (
        <EntryListEditor key={key} label={label} value={value[key]} onChange={v => set({ [key]: v } as Partial<ArtistCv>)} />
      ))}
    </div>
  );
}

function NoteEditor({ value, onChange }: { value: ArtistNote; onChange: (v: ArtistNote) => void }) {
  const set = (patch: Partial<ArtistNote>) => onChange({ ...value, ...patch });
  const addSection = () => set({ sections: [...value.sections, { title: '', body: '' }] });
  const updSection = (i: number, patch: Partial<{ title: string; body: string }>) => set({ sections: value.sections.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const rmSection = (i: number) => set({ sections: value.sections.filter((_, idx) => idx !== i) });
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">작가노트 (전체)</label>
        <textarea value={value.statement} onChange={e => set({ statement: e.target.value })} placeholder="작품 세계 전반에 대한 이야기를 자유롭게 작성하세요." className="w-full h-40 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y focus:outline-none focus:ring-1 focus:ring-gray-400" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">시리즈 / 섹션</span>
          <button onClick={addSection} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Plus size={13} /> 섹션 추가</button>
        </div>
        {value.sections.length === 0 ? <p className="text-xs text-gray-400">시리즈별로 나눠 쓰려면 섹션을 추가하세요. (선택)</p> : (
          <div className="space-y-2">
            {value.sections.map((s, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input value={s.title} onChange={e => updSection(i, { title: e.target.value })} placeholder="소제목 (예: 호랑이 시리즈)" className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm" />
                  <button onClick={() => rmSection(i)} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0" aria-label="삭제"><Minus size={15} /></button>
                </div>
                <textarea value={s.body} onChange={e => updSection(i, { body: e.target.value })} placeholder="섹션 내용" className="w-full h-24 px-2 py-1.5 border border-gray-200 rounded text-sm resize-y" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
