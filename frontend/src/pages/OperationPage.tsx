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
import { ArrowLeft, Plus, Minus, Trash2, Edit3, Megaphone, FileDown, ChevronDown, ChevronUp, Loader2, Upload, ImageOff, User, Star, Check, ArrowRight, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { displayName, compressImage, MAX_IMAGE_BYTES, formatPhoneNumber, koreanWon } from '@/lib/utils';
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

      {canManage && access.ended && <SettlementSection exhibitionId={id!} isAdmin={access.isAdmin} />}
    </div>
  );
}

// ============ 공모 상태 관리 — 모집마감 → 확정 → 전시종료 스텝퍼 ============
const LIFECYCLE_STEPS: { label: string; desc: string; next: Record<string, boolean>; back: Record<string, boolean> }[] = [
  { label: '모집마감', desc: '모집공고가 목록에서 내려갑니다.', next: { recruitmentClosed: true }, back: { recruitmentClosed: false } },
  { label: '확정', desc: '작가의 전시정보 수정이 잠깁니다. (전시 시작일이 지나면 자동 확정)', next: { confirmed: true }, back: { confirmed: false } },
  { label: '전시종료', desc: '정산 단계로 전환되며 아래에 정산 입력이 나타납니다.', next: { ended: true }, back: { ended: false } },
];

function StatusPanel({ exhibitionId, access }: { exhibitionId: string; access: OperationAccess }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch(`/operations/${exhibitionId}/lifecycle`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] }); qc.invalidateQueries({ queryKey: ['exhibitions'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '변경 실패'),
  });

  const locked = !!access.settled && !access.isAdmin;   // 관리자는 완료 후에도 수정 가능
  // 현재 단계: 0=모집중, 1=모집마감, 2=확정, 3=전시종료
  const stage = access.ended ? 3 : access.confirmed ? 2 : access.recruitmentClosed ? 1 : 0;
  const stageLabel = ['모집중', '모집마감', '확정', '전시종료'][stage];

  const goNext = () => {
    if (stage >= 3) return;
    const step = LIFECYCLE_STEPS[stage];
    if (step.next.ended && !window.confirm('전시를 종료하고 정산 단계로 넘어갈까요?')) return;
    mutation.mutate(step.next);
  };
  const goPrev = () => {
    if (stage <= 0) return;
    mutation.mutate(LIFECYCLE_STEPS[stage - 1].back);
  };

  return (
    <section className="mb-8 border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-medium text-gray-900">공모 진행 단계</h2>
        {locked && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">정산완료</span>}
      </div>

      {/* 스텝퍼 */}
      <div className="flex items-center">
        {LIFECYCLE_STEPS.map((s, i) => {
          const idx = i + 1;            // 이 노드가 나타내는 단계
          const done = stage >= idx;    // 도달 완료
          const target = stage + 1 === idx; // 다음에 진행할 단계
          return (
            <div key={s.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  done ? 'bg-gray-900 text-white'
                    : target ? 'bg-white text-gray-900 ring-2 ring-gray-900'
                    : 'bg-gray-100 text-gray-400'}`}>
                  {done ? <Check size={16} /> : idx}
                </div>
                <span className={`mt-1.5 text-xs whitespace-nowrap ${done || target ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{s.label}</span>
              </div>
              {i < LIFECYCLE_STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-2 mb-5 rounded-full transition-colors ${stage >= idx + 1 ? 'bg-gray-900' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* 현재 상태 + 안내 */}
      <p className="text-xs text-gray-500 mt-4 leading-relaxed">
        현재 <b className="text-gray-900">{stageLabel}</b> 단계입니다.
        {stage < 3 && <> 다음 단계: <b className="text-gray-900">{LIFECYCLE_STEPS[stage].label}</b> — {LIFECYCLE_STEPS[stage].desc}</>}
        {stage === 2 && access.confirmed && !access.manualConfirmed && <span className="text-gray-400"> (전시 시작일 경과로 자동 확정됨)</span>}
      </p>

      {/* 액션 */}
      {locked ? (
        <p className="text-xs text-gray-400 mt-3">· <b className="text-green-700">정산이 완료</b>되어 운영 페이지가 잠겼습니다.</p>
      ) : (
        <div className="flex items-center gap-2 mt-4">
          {stage < 3 && (
            <button
              onClick={goNext}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
            >
              다음 단계로 — {LIFECYCLE_STEPS[stage].label}
              <ArrowRight size={15} />
            </button>
          )}
          {stage > 0 && (
            <button
              onClick={goPrev}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
            >
              <Undo2 size={14} /> 이전 단계로
            </button>
          )}
          {stage === 3 && (
            <span className="text-sm text-gray-500">전시가 종료되었습니다. 아래에서 정산을 진행하세요.</span>
          )}
        </div>
      )}
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
  const [repIndex, setRepIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<'artwork' | 'cv' | 'note'>('artwork');

  useEffect(() => {
    if (data) {
      setArtworkList(data.artworkList || []);
      setCv(data.cv || EMPTY_CV);
      setNote(data.note || EMPTY_NOTE);
      setRepIndex(data.representativeIndex ?? null);
    }
  }, [data]);

  // 대표작 인덱스가 출품작 범위를 벗어나면 해제
  useEffect(() => {
    if (repIndex != null && repIndex >= artworkList.length) setRepIndex(null);
  }, [artworkList.length, repIndex]);

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/operations/${exhibitionId}/me`, { artworkList, cv, note, representativeIndex: repIndex }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-me', exhibitionId] }); toast.success('전시 정보가 저장되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  // 캡션에 들어갈 내용(출품작 제목/크기/재료/년도/가격)은 필수 — 비면 저장 차단
  const collectMissing = (): string[] => {
    const missing: string[] = [];
    if (artworkList.length === 0) {
      missing.push('출품작을 1개 이상 등록해주세요.');
      return missing;
    }
    const labels: [keyof ArtworkItem, string][] = [['title', '제목'], ['size', '크기'], ['medium', '재료'], ['year', '제작년도'], ['price', '가격']];
    artworkList.forEach((a, i) => {
      const lack = labels.filter(([k]) => !String(a[k] ?? '').trim()).map(([, l]) => l);
      if (lack.length) missing.push(`작품 ${i + 1}: ${lack.join(', ')} 미입력`);
    });
    return missing;
  };

  const handleSave = () => {
    const missing = collectMissing();
    if (missing.length) {
      setTab('artwork');
      toast.error(
        (t) => (
          <div style={{ whiteSpace: 'pre-line' }} onClick={() => toast.dismiss(t.id)}>
            {'캡션에 들어갈 내용이 비어 있어 저장할 수 없습니다.\n(작품 제목·크기·재료·제작년도·가격은 필수)\n\n' + missing.join('\n')}
          </div>
        ),
        { duration: 7000 },
      );
      return;
    }
    // 엽서 대표작 미선택 시 저장 차단 + 안내 팝업
    if (repIndex == null) {
      setTab('artwork');
      toast.error(
        (t) => (
          <div onClick={() => toast.dismiss(t.id)}>
            엽서 대표작을 선택해주세요.<br />
            <span style={{ fontSize: 12, opacity: 0.8 }}>출품작 중 1점을 엽서·홍보물용 대표작으로 선택해야 저장됩니다.</span>
          </div>
        ),
        { duration: 6000 },
      );
      return;
    }
    saveMutation.mutate();
  };

  // 포트폴리오 경력 + 내 개인정보(이름/연락처/이메일)를 한 번에 약력으로 불러온다
  const loadFromPortfolio = async () => {
    try {
      const [{ data: p }, { data: me }] = await Promise.all([
        api.get('/portfolio'),
        api.get('/auth/me').then(r => r).catch(() => ({ data: { user: null } })),
      ]);
      const c = p.career || {};
      const u = me?.user;
      setCv(prev => ({
        ...prev,
        nameKo: prev.nameKo || u?.name || '',
        tel: prev.tel || u?.phone || '',
        email: prev.email || u?.email || '',
        solo: (c.solo || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        group: (c.group || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        artFair: (c.artFair || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
      }));
      toast.success('내 정보·포트폴리오 약력을 불러왔습니다.');
    } catch {
      toast.error('불러오지 못했습니다.');
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
        <SubmissionReadonly submission={{ artworkList, cv, note, representativeIndex: repIndex }} />
      </section>
    );
  }

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium text-gray-900">내 전시 정보</h2>
        <button onClick={handleSave} disabled={saveMutation.isPending} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">
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
            <RepresentativeSelector artworkList={artworkList} value={repIndex} onChange={setRepIndex} />
          </>
        )}
        {tab === 'cv' && (
          <>
            <div className="flex justify-between mb-2">
              <button onClick={loadFromPortfolio} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">내 정보·포트폴리오 불러오기</button>
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
  const [captioning, setCaptioning] = useState(false);
  const [imgZipping, setImgZipping] = useState(false);

  const totalArtworks = data.reduce((s, d) => s + (d.submission.artworkList?.length || 0), 0);

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

  // 캡션 HWP (한글 파일) — 서버에서 원본 양식 채워 생성, 작가명 미표기
  const downloadCaptions = async () => {
    if (totalArtworks === 0) { toast.error('등록된 출품작이 없습니다.'); return; }
    setCaptioning(true);
    const t = toast.loading('캡션(한글 파일)을 생성하는 중입니다...');
    try {
      const res = await api.get(`/operations/${exhibitionId}/caption.hwp`, { responseType: 'blob' });
      let fname = `${exhibitionTitle}_작품캡션.hwp`;
      const cd: string = res.headers['content-disposition'] || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      if (m) { try { fname = decodeURIComponent(m[1]); } catch { /* keep default */ } }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      toast.success('캡션 한글 파일 다운로드를 시작합니다.', { id: t });
    } catch (e: any) {
      const msg = e?.response?.status === 400 ? '등록된 출품작이 없습니다.' : '캡션 생성에 실패했습니다.';
      toast.error(msg, { id: t });
    } finally { setCaptioning(false); }
  };

  // 작품 원본 이미지 일괄 다운로드 (jpg ZIP)
  const downloadImages = async () => {
    if (totalArtworks === 0) { toast.error('등록된 출품작이 없습니다.'); return; }
    setImgZipping(true);
    const t = toast.loading('작품 원본 이미지를 모으는 중입니다...');
    try {
      const { downloadAllArtworkImagesZip } = await import('@/lib/operationPdf');
      const { ok, fail } = await downloadAllArtworkImagesZip(exhibitionTitle, data);
      if (ok === 0) toast.error('다운로드 가능한 작품 이미지가 없습니다.', { id: t });
      else toast.success(`원본 ${ok}개 ZIP 다운로드 시작${fail ? ` (실패 ${fail}개)` : ''}`, { id: t });
    } catch { toast.error('이미지 ZIP 생성에 실패했습니다.', { id: t }); }
    finally { setImgZipping(false); }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-lg font-medium text-gray-900">작가 제출 정보 <span className="text-sm text-gray-400">({data.length}명)</span></h2>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => refetch()} disabled={isFetching} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50">{isFetching ? '불러오는 중...' : '새로고침'}</button>
          {data.length > 0 && (
            <>
              <button onClick={downloadCaptions} disabled={captioning} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {captioning ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                {captioning ? '생성 중...' : '캡션(한글)'}
              </button>
              <button onClick={downloadImages} disabled={imgZipping} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {imgZipping ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                {imgZipping ? '모으는 중...' : '작품 원본(ZIP)'}
              </button>
              <button onClick={downloadAllZip} disabled={zipping} className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {zipping ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                {zipping ? '생성 중...' : '전체 PDF (ZIP)'}
              </button>
            </>
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

// 엽서용 대표작 선택 (작가) — 출품작 중 1개
function RepresentativeSelector({ artworkList, value, onChange }: { artworkList: ArtworkItem[]; value: number | null; onChange: (v: number | null) => void }) {
  if (artworkList.length === 0) return null;
  return (
    <div className="mt-5 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-900 flex items-center gap-1"><Star size={14} className="text-amber-500" /> 엽서 대표작</p>
        {value != null && <button onClick={() => onChange(null)} className="text-xs text-gray-400 hover:text-gray-700 underline">선택 해제</button>}
      </div>
      <p className="text-xs text-gray-400 mb-2">엽서·홍보물에 사용할 대표작 1점을 선택하세요. (선택 후 [저장])</p>
      <div className="flex flex-wrap gap-2">
        {artworkList.map((a, i) => {
          const selected = value === i;
          return (
            <button key={i} type="button" onClick={() => onChange(i)}
              className={`relative w-20 text-left rounded-lg border-2 overflow-hidden transition-colors ${selected ? 'border-amber-500' : 'border-gray-200 hover:border-gray-300'}`}>
              {a.image ? <img src={a.image} alt="" className="w-full h-20 object-cover" /> : <div className="w-full h-20 bg-gray-100 flex items-center justify-center"><ImageOff size={16} className="text-gray-300" /></div>}
              {selected && <span className="absolute top-1 right-1 bg-amber-500 text-white rounded-full p-0.5"><Star size={11} className="fill-white" /></span>}
              <span className="block px-1 py-0.5 text-[10px] text-gray-600 truncate">{a.title || `작품 ${i + 1}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 읽기 전용 제출정보 (갤러리/Admin)
function SubmissionReadonly({ submission }: { submission: OperationSubmission }) {
  const { artworkList = [], cv, note } = submission;
  const repIndex = submission.representativeIndex ?? null;
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
                {repIndex === i && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0"><Star size={9} className="fill-amber-500 text-amber-500" /> 엽서 대표작</span>}
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
            <p>{cv.nameKo}{cv.tel ? ` · ${cv.tel}` : ''}{cv.email ? ` · ${cv.email}` : ''}</p>
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

// 판매 작품들을 ArtLook(액자·전시공간 홍보 도구)로 넘겨 새 탭에서 연다.
// 핸드오프: localStorage 'artlook:works' = [{url,title}] (동일 출처라 탭 간 공유됨)
function openArtLook(works: { url: string; title: string; artist?: string; exhibition?: string }[]) {
  const valid = works.filter(w => w.url);
  if (valid.length === 0) { toast.error('홍보할 판매 작품 이미지가 없습니다.'); return; }
  try { localStorage.setItem('artlook:works', JSON.stringify(valid)); } catch { /* noop */ }
  // 정적 페이지 — 명시적 index.html 경로(개발 Vite·운영 모두 안전, SPA fallback 회피)
  window.open('/artlook/index.html', '_blank');
}

type EditWork = { index: number; title: string; image?: string; size?: string; medium?: string; year?: string; listPrice: string; sold: boolean; soldPrice: number; paymentMethod: 'CARD' | 'CASH' };
type EditArtist = { user: { id: number; name: string; nickname?: string | null; email?: string }; galleryRatio: number; works: EditWork[] };

function artistTotals(a: EditArtist) {
  const total = a.works.filter(w => w.sold).reduce((s, w) => s + (w.soldPrice || 0), 0);
  const galleryAmount = Math.round(total * a.galleryRatio / 100);
  return { total, galleryAmount, artistAmount: total - galleryAmount };
}

// 작가 본인 정산 내역 (전시종료 후) — 확인 요청 시 수락/문제제기
function MyArtistSettlementSection({ exhibitionId }: { exhibitionId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ exhibitionTitle: string; ended: boolean; requested?: boolean; settled?: boolean; artist: SettlementArtist | null; myApproval?: { status: string; comment?: string | null } | null }>({
    queryKey: ['operation-my-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/my-settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [downloading, setDownloading] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [comment, setComment] = useState('');

  const respondMutation = useMutation({
    mutationFn: (body: { approve: boolean; comment?: string }) => api.post(`/operations/${exhibitionId}/settlement/respond`, body),
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? '정산을 확인(수락)했습니다.' : '문제를 갤러리에 전달했습니다.');
      setIssueOpen(false); setComment('');
      qc.invalidateQueries({ queryKey: ['operation-my-settlement', exhibitionId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '처리에 실패했습니다.'),
  });

  if (isLoading) return <div className="h-24 bg-gray-100 animate-pulse rounded-xl mb-10" />;
  const requested = !!data?.requested, settled = !!data?.settled;
  // 확인 요청/완료 전에는 작가에게 내역 비공개
  if ((!requested && !settled) || !data?.artist) {
    return (
      <section className="mb-10">
        <h2 className="text-lg font-medium text-gray-900 mb-3">내 정산 내역</h2>
        <div className="border border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
          갤러리가 정산 확인을 요청하면 내 정산 내역이 공개됩니다.
        </div>
      </section>
    );
  }
  const a = data.artist;
  const sold = a.works.filter(w => w.sold);
  const myStatus = data.myApproval?.status;

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

      {/* 확인 요청 중 — 수락 / 문제 제기 */}
      {requested && !settled && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">갤러리가 정산 내역 확인을 요청했습니다.</p>
          <p className="text-xs text-amber-800/80 mt-0.5">아래 내역을 확인하고 <b>수락</b>하거나, 문제가 있으면 갤러리에 알려주세요. 모든 작가가 수락하면 정산이 완료됩니다.</p>
          {myStatus === 'APPROVED' && <p className="text-sm font-medium text-green-700 mt-2">✓ 수락함 — 갤러리의 정산 완료를 기다리는 중입니다.</p>}
          {myStatus === 'ISSUE' && (
            <p className="text-sm text-red-600 mt-2">문제 제기함: “{data.myApproval?.comment}”<br/><span className="text-xs text-gray-500">갤러리가 수정 후 다시 요청하면 재확인할 수 있어요.</span></p>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={() => respondMutation.mutate({ approve: true })} disabled={respondMutation.isPending}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">{myStatus === 'APPROVED' ? '수락됨' : '정산 확인(수락)'}</button>
            <button onClick={() => setIssueOpen(v => !v)}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50">문제 제기</button>
          </div>
          {issueOpen && (
            <div className="mt-2">
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                placeholder="어떤 점이 문제인지 적어주세요 (예: 판매가/정산 비율 오류)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              <button onClick={() => comment.trim() ? respondMutation.mutate({ approve: false, comment: comment.trim() }) : toast.error('문제 내용을 입력해주세요.')}
                disabled={respondMutation.isPending}
                className="mt-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">갤러리에 전달</button>
            </div>
          )}
        </div>
      )}
      {settled && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">정산이 완료되었습니다.</div>}

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

function SettlementSection({ exhibitionId, isAdmin }: { exhibitionId: string; isAdmin?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Omit<Settlement, 'artists'> & {
    settled?: boolean; settledAt?: string | null; settlementRequested?: boolean; allApproved?: boolean;
    artists: (SettlementArtist & { approval?: { status: string; comment?: string | null } | null })[];
  }>({
    queryKey: ['operation-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [artists, setArtists] = useState<EditArtist[]>([]);
  const [exTitle, setExTitle] = useState('');
  const [zipping, setZipping] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const settled = !!data?.settled;
  const requested = !!data?.settlementRequested;
  const allApproved = !!data?.allApproved;
  const locked = (settled || requested) && !isAdmin;   // 정산 입력 잠금 (관리자는 완료 후에도 수정 가능)
  const approvalOf = (uid: number) => data?.artists.find(x => x.user.id === uid)?.approval ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['operation-settlement', exhibitionId] });
    qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] });
  };
  const completeMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/complete`),
    onSuccess: () => { toast.success('정산이 완료되었습니다. 참여 작가에게 공유됩니다.'); setConfirmOpen(false); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '정산 완료 실패'),
  });
  const requestMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/request`),
    onSuccess: () => { toast.success('참여 작가에게 정산 확인을 요청했습니다.'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '요청 실패'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/request/cancel`),
    onSuccess: () => { toast.success('정산 확인 요청을 취소했습니다.'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '취소 실패'),
  });

  useEffect(() => {
    if (data) {
      setExTitle(data.exhibitionTitle);
      setArtists(data.artists.map(a => ({
        user: a.user,
        galleryRatio: a.galleryRatio,
        works: a.works.map(w => ({ index: w.index, title: w.title, image: w.image, size: w.size, medium: w.medium, year: w.year, listPrice: w.listPrice, sold: w.sold, soldPrice: w.soldPrice, paymentMethod: (w.paymentMethod || 'CARD') as 'CARD' | 'CASH' })),
      })));
    }
  }, [data]);

  const updWork = (ai: number, wi: number, patch: Partial<EditWork>) =>
    setArtists(prev => prev.map((a, i) => i !== ai ? a : { ...a, works: a.works.map((w, j) => j === wi ? { ...w, ...patch } : w) }));
  const updRatio = (ai: number, ratio: number) =>
    setArtists(prev => prev.map((a, i) => i === ai ? { ...a, galleryRatio: Math.min(100, Math.max(0, ratio)) } : a));

  const saveMutation = useMutation({
    mutationFn: () => {
      const sales = artists.flatMap(a => a.works.filter(w => w.sold).map(w => ({ artistUserId: a.user.id, artworkIndex: w.index, title: w.title, soldPrice: w.soldPrice || 0, paymentMethod: w.paymentMethod || 'CARD' })));
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

  const downloadOverall = async (method?: 'CARD' | 'CASH') => {
    setZipping(true);
    try {
      const { downloadOverallSettlementPdf } = await import('@/lib/operationPdf');
      await downloadOverallSettlementPdf(buildSettlement(), method);
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };
  const downloadArtist = async (ai: number, method?: 'CARD' | 'CASH') => {
    setZipping(true);
    try {
      const s = buildSettlement();
      const { downloadArtistSettlementPdf } = await import('@/lib/operationPdf');
      await downloadArtistSettlementPdf(s.exhibitionTitle, s.artists[ai], method);
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };

  if (isLoading) return <div className="h-32 bg-gray-100 animate-pulse rounded-xl mb-10" />;

  const grand = buildSettlement().grand;
  // ArtLook 홍보용: 판매 체크 + 이미지가 있는 작품들
  const soldWorks = artists.flatMap(a => a.works.filter(w => w.sold && w.image).map(w => ({ url: w.image as string, title: w.title || '', artist: displayName(a.user), exhibition: exTitle })));

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-medium text-gray-900">정산</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 저장: 편집 가능할 때(미잠금). 관리자는 완료 후에도 저장 가능 */}
          {!locked && (
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">{saveMutation.isPending ? '저장 중...' : '정산 저장'}</button>
          )}
          {!settled && !requested && (
            <button onClick={() => requestMutation.mutate()} disabled={requestMutation.isPending} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">정산 확인 요청</button>
          )}
          {requested && !settled && (
            <>
              <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50">요청 취소</button>
              <button onClick={() => setConfirmOpen(true)} disabled={!allApproved || completeMutation.isPending} title={allApproved ? '' : '모든 작가가 수락해야 완료할 수 있습니다'} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">정산 완료</button>
            </>
          )}
          <button onClick={() => downloadOverall()} disabled={zipping} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"><FileDown size={13} /> 전체 정산 PDF</button>
          <button onClick={() => downloadOverall('CASH')} disabled={zipping} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">현금 정산서</button>
          <button onClick={() => downloadOverall('CARD')} disabled={zipping} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">카드 정산서</button>
        </div>
      </div>

      {settled && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <b>정산 완료됨</b>{data?.settledAt ? ` · ${new Date(data.settledAt).toLocaleDateString('ko-KR')}` : ''} · 참여 작가에게 정산 내역이 공유되었습니다. {isAdmin ? '관리자는 완료 후에도 수정할 수 있습니다.' : '더 이상 수정할 수 없습니다.'}
        </div>
      )}

      {requested && !settled && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>정산 확인 요청 중</b> · 작가 {(data?.artists.filter(x => x.approval?.status === 'APPROVED').length ?? 0)}/{data?.artists.length ?? 0}명 수락.
          {allApproved ? ' 전원 수락 — [정산 완료]를 누를 수 있습니다.' : ' 전원 수락 시 [정산 완료]가 활성화됩니다.'} 내역을 고치려면 [요청 취소] 후 수정하세요.
        </div>
      )}

      {/* 판매작 홍보 CTA — ArtLook 연결 */}
      {soldWorks.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#c4302b]/25 bg-[#fff5f4] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">판매한 작품들을 홍보해보세요</p>
            <p className="text-xs text-gray-500 mt-0.5">판매된 {soldWorks.length}점을 액자·전시 공간에 담아 SNS 홍보 이미지를 만들 수 있어요.</p>
          </div>
          <button onClick={() => openArtLook(soldWorks)} className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-[#c4302b] rounded-lg hover:bg-[#a82822] cursor-pointer">
            <Megaphone size={15} /> ArtLook으로 홍보 이미지 만들기
          </button>
        </div>
      )}

      {artists.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">수락된 작가가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {artists.map((a, ai) => {
            const t = artistTotals(a);
            const appr = approvalOf(a.user.id);
            return (
              <div key={a.user.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm text-gray-900 flex items-center gap-1.5">
                    {displayName(a.user)}
                    {requested && appr?.status === 'APPROVED' && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">수락</span>}
                    {requested && appr?.status === 'ISSUE' && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">문제 제기</span>}
                    {requested && (!appr || appr.status === 'PENDING') && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">대기중</span>}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button onClick={() => downloadArtist(ai)} disabled={zipping} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"><FileDown size={12} /> 정산 PDF</button>
                    <button onClick={() => downloadArtist(ai, 'CASH')} disabled={zipping} className="text-xs text-gray-400 hover:text-gray-900 disabled:opacity-50">현금</button>
                    <button onClick={() => downloadArtist(ai, 'CARD')} disabled={zipping} className="text-xs text-gray-400 hover:text-gray-900 disabled:opacity-50">카드</button>
                  </div>
                </div>
                {requested && appr?.status === 'ISSUE' && appr.comment && (
                  <div className="mb-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">문제 제기: {appr.comment}</div>
                )}

                {a.works.length === 0 ? (
                  <p className="text-xs text-gray-400">등록된 출품작이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {a.works.map((w, wi) => (
                      <div key={wi} className={`flex items-center gap-3 p-2 rounded-lg border ${w.sold ? 'border-gray-300 bg-gray-50' : 'border-gray-100'}`}>
                        <input type="checkbox" checked={w.sold} disabled={locked} onChange={e => updWork(ai, wi, { sold: e.target.checked })} className="shrink-0 disabled:opacity-50" />
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
                        {/* 판매가 + 결제수단(카드/현금) */}
                        {w.sold && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
                              <button type="button" disabled={locked} onClick={() => updWork(ai, wi, { paymentMethod: 'CARD' })}
                                className={`px-2 py-1 disabled:opacity-60 ${w.paymentMethod !== 'CASH' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}>카드</button>
                              <button type="button" disabled={locked} onClick={() => updWork(ai, wi, { paymentMethod: 'CASH' })}
                                className={`px-2 py-1 disabled:opacity-60 ${w.paymentMethod === 'CASH' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}>현금</button>
                            </div>
                            <input type="text" inputMode="numeric" disabled={locked} value={w.soldPrice ? w.soldPrice.toLocaleString('ko') : ''}
                              onChange={e => updWork(ai, wi, { soldPrice: parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0 })}
                              placeholder="판매가" className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right disabled:bg-gray-100" />
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
                    <input type="number" min={0} max={100} disabled={locked} value={a.galleryRatio} onChange={e => updRatio(ai, parseInt(e.target.value) || 0)} className="w-14 px-1.5 py-0.5 border border-gray-200 rounded text-sm text-right disabled:bg-gray-100" />%
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
      {!settled && !requested && (
        <p className="text-xs text-gray-400 mt-2">* 비율·판매가 변경 후 [정산 저장]을 눌러 보관하세요. <b>[정산 확인 요청]</b>을 누르면 참여 작가 전원에게 확인 요청이 가고, <b>전원 수락 시 [정산 완료]</b>가 가능합니다.</p>
      )}
      {requested && !settled && (
        <p className="text-xs text-gray-400 mt-2">* 작가가 검토 중입니다. 내역을 수정하려면 [요청 취소] 후 변경하고 다시 요청하세요.</p>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">정산을 완료할까요?</h3>
            <ul className="text-sm text-gray-600 space-y-1.5 mb-5 list-disc pl-4">
              <li>모든 참여 작가가 정산을 <b className="text-gray-900">확인(수락)</b>했습니다.</li>
              <li>완료하면 <b className="text-gray-900">더 이상 운영 페이지를 수정할 수 없습니다.</b></li>
              <li>정산 내역이 참여 작가에게 최종 공유되며, 이 작업은 <b className="text-gray-900">되돌릴 수 없습니다.</b></li>
            </ul>
            <div className="flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">취소</button>
              <button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="flex-1 py-2.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50">{completeMutation.isPending ? '처리 중...' : '동의하고 정산 완료'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ============ 에디터들 ============

// 출품작 이미지 셀 (compact 업로드)
function ArtworkImageCell({ value, onChange }: { value?: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find(file => file.type.startsWith('image/'));
    if (f) handle(f);
    else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };
  return (
    <button type="button" onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      title="클릭 또는 이미지를 끌어다 놓기"
      className={`w-16 h-16 shrink-0 rounded border border-dashed overflow-hidden flex items-center justify-center bg-gray-50 transition-colors ${dragOver ? 'border-gray-600 text-gray-600 bg-gray-100' : 'border-gray-300 text-gray-400 hover:border-gray-400'}`}>
      {uploading ? <Loader2 size={16} className="animate-spin" /> : value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <Upload size={16} />}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
    </button>
  );
}

// 크기 문자열 ↔ 가로/세로 분리 (size는 캡션·PDF용 단일 출처로 유지)
function splitSize(s: string): { w: string; h: string } {
  const m = String(s || '').match(/([\d.]+)\s*[x×X*]\s*([\d.]+)/);
  return m ? { w: m[1], h: m[2] } : { w: '', h: '' };
}
function composeSize(w: string, h: string): string {
  const ws = (w || '').trim(), hs = (h || '').trim();
  if (!ws && !hs) return '';
  if (ws && hs) return `${ws}×${hs} cm`;
  return `${ws || hs} cm`;
}

function ArtworkListEditor({ value, onChange }: { value: ArtworkItem[]; onChange: (v: ArtworkItem[]) => void }) {
  const add = () => onChange([...value, { image: '', title: '', size: '', width: '', height: '', medium: '', year: '', price: '' }]);
  const upd = (i: number, patch: Partial<ArtworkItem>) => onChange(value.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const rm = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const inputCls = "px-2 py-1.5 border border-gray-200 rounded text-sm";
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-xs text-gray-400">출품할 작품을 추가하세요.</p>}
      {value.map((a, i) => {
        const parsed = splitSize(a.size);
        const w = a.width !== undefined ? a.width : parsed.w;
        const h = a.height !== undefined ? a.height : parsed.h;
        const priceHint = koreanWon(a.price);
        return (
          <div key={i} className="flex gap-2 items-start border border-gray-100 rounded-lg p-2">
            <span className="text-xs text-gray-400 w-5 pt-1 text-center shrink-0">{i + 1}</span>
            <ArtworkImageCell value={a.image} onChange={url => upd(i, { image: url })} />
            <div className="flex-1 grid grid-cols-2 gap-1.5 min-w-0">
              <input value={a.title} onChange={e => upd(i, { title: e.target.value })} placeholder="작품명" className={`col-span-2 ${inputCls}`} />
              {/* 크기: 가로 × 세로 (cm) */}
              <div className="col-span-2 flex items-center gap-1.5">
                <input value={w} onChange={e => upd(i, { width: e.target.value, size: composeSize(e.target.value, h) })} placeholder="가로" inputMode="decimal" className={`w-0 flex-1 min-w-0 text-center ${inputCls}`} />
                <span className="text-gray-400 text-sm shrink-0">×</span>
                <input value={h} onChange={e => upd(i, { height: e.target.value, size: composeSize(w, e.target.value) })} placeholder="세로" inputMode="decimal" className={`w-0 flex-1 min-w-0 text-center ${inputCls}`} />
                <span className="text-xs text-gray-500 shrink-0">cm</span>
              </div>
              <input value={a.medium} onChange={e => upd(i, { medium: e.target.value })} placeholder="재료 (Acrylic on Canvas)" className={`col-span-2 ${inputCls}`} />
              <input value={a.year} onChange={e => upd(i, { year: e.target.value })} placeholder="제작년도" className={inputCls} />
              {/* 가격: 단위 '원' + 한글 금액 힌트 */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <input value={a.price} onChange={e => upd(i, { price: e.target.value })} placeholder="가격 (예: 230000)" className={`w-0 flex-1 min-w-0 text-right ${inputCls}`} />
                  <span className="text-xs text-gray-500 shrink-0">원</span>
                </div>
                {priceHint && <span className="text-[11px] text-gray-300 mt-0.5 text-right truncate">{priceHint}</span>}
              </div>
            </div>
            <button onClick={() => rm(i)} className="p-1 text-gray-400 hover:text-red-500 shrink-0" aria-label="삭제"><Minus size={16} /></button>
          </div>
        );
      })}
      <button onClick={add} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Plus size={15} /> 작품 추가</button>
    </div>
  );
}

// {year, content} 리스트 에디터
// 작가약력 경력 항목 — 자유 입력 칸(한 줄 = 한 건). 기존 [연도][내용] 데이터는 "연도 내용" 한 줄로 표시.
function EntryListEditor({ label, value, onChange }: { label: string; value: CvEntry[]; onChange: (v: CvEntry[]) => void }) {
  const toText = (entries: CvEntry[]) => entries.map(e => [e.year, e.content].filter(Boolean).join(' ')).join('\n');
  const [raw, setRaw] = useState(() => toText(value));
  useEffect(() => {
    const incoming = toText(value);
    // raw도 저장 시와 동일하게 줄별 trim 후 비교 — 안 그러면 입력 중 끝 공백이 즉시 지워짐(스페이스 안 먹힘)
    const currentNormalized = raw.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    if (incoming !== currentNormalized) setRaw(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const setText = (text: string) => {
    setRaw(text);
    onChange(text.split('\n').map(l => l.trim()).filter(Boolean).map(line => ({ year: '', content: line })));
  };
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <span className="text-sm font-medium text-gray-700 block mb-2">{label}</span>
      <textarea
        value={raw}
        onChange={e => setText(e.target.value)}
        placeholder={`예: 2025 ${label} 참여\n(한 줄에 한 건씩 자유롭게 입력하세요)`}
        rows={4}
        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm resize-y leading-relaxed focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder:text-gray-300"
      />
    </div>
  );
}

function CvEditor({ value, onChange }: { value: ArtistCv; onChange: (v: ArtistCv) => void }) {
  const set = (patch: Partial<ArtistCv>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <input value={value.nameKo} onChange={e => set({ nameKo: e.target.value })} placeholder="이름 (한글)" className="px-2 py-1.5 border border-gray-200 rounded text-sm" />
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
          <span className="text-sm font-medium text-gray-700">작품별 상세설명</span>
          <button onClick={addSection} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Plus size={13} /> 상세설명 추가</button>
        </div>
        {value.sections.length === 0 ? <p className="text-xs text-gray-400">작품별로 설명을 따로 적으려면 추가하세요. (선택)</p> : (
          <div className="space-y-2">
            {value.sections.map((s, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input value={s.title} onChange={e => updSection(i, { title: e.target.value })} placeholder="작품명 / 소제목" className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm" />
                  <button onClick={() => rmSection(i)} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0" aria-label="삭제"><Minus size={15} /></button>
                </div>
                <textarea value={s.body} onChange={e => updSection(i, { body: e.target.value })} placeholder="해당 작품에 대한 상세 설명" className="w-full h-24 px-2 py-1.5 border border-gray-200 rounded text-sm resize-y" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
