/**
 * ApplicantsPage - 지원자 관리 (Gallery 오너 전용, 별도 페이지)
 *
 * 기능:
 *  - 공모별 지원자 목록 / 상태 필터 / 상태 변경 / 일괄 상태 변경
 *  - 지원자 카드 확장 → 지원서 내용(약력·경력·작품사진·포트폴리오) + 연락처(닉네임·전화·이메일)
 *  - 지원서 PDF 다운로드 (지원자별: 공모명_작가명_지원서.pdf)
 *  - 전체 지원서 ZIP 다운로드 (공모명_지원서.zip)
 *
 * API:
 *  - GET   /api/exhibitions/:id              - 공모 제목/소유 확인
 *  - GET   /api/exhibitions/:id/applications - 지원자 목록 (오너)
 *  - PATCH /api/exhibitions/:id/applications/:appId - 상태 변경
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, Users, ChevronDown, ChevronUp, FileText, FileArchive, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { displayName } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicationContent from '@/components/shared/ApplicationContent';
import { downloadApplicationPdf, downloadAllApplicationsZip } from '@/lib/operationPdf';
import type { Exhibition } from '@/types';

const STATUS_TABS = [
  { key: 'ALL', label: '전체' },
  { key: 'SUBMITTED', label: '접수' },
  { key: 'ACCEPTED', label: '수락' },
  { key: 'REJECTED', label: '거절' },
];
const statusColors: Record<string, string> = {
  SUBMITTED: 'bg-gray-100 text-gray-600',
  ACCEPTED: 'bg-green-100 text-green-600',
  REJECTED: 'bg-red-100 text-red-600',
};

export default function ApplicantsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchStatus, setBatchStatus] = useState('');
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [pdfBusy, setPdfBusy] = useState<number | 'all' | null>(null);
  // 수락 확인 (수락은 최종 — 변경 불가)
  const [acceptTarget, setAcceptTarget] = useState<{ type: 'single'; appId: number } | { type: 'batch' } | null>(null);

  const { data: exhibition } = useQuery<Exhibition>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: applicants = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ['exhibition-applicants', id],
    queryFn: () => api.get(`/exhibitions/${id}/applications`).then(r => r.data),
    enabled: !!id,
  });

  const updateStatus = useMutation({
    mutationFn: ({ appId, status }: { appId: number; status: string }) =>
      api.patch(`/exhibitions/${id}/applications/${appId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition-applicants', id] });
      toast.success('상태가 변경되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '상태 변경 실패'),
  });

  const batchUpdate = async (status: string) => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map(appId =>
        api.patch(`/exhibitions/${id}/applications/${appId}`, { status })));
      queryClient.invalidateQueries({ queryKey: ['exhibition-applicants', id] });
      toast.success(`${selectedIds.size}명의 상태를 변경했습니다.`);
      setSelectedIds(new Set());
      setBatchStatus('');
    } catch { toast.error('일괄 상태 변경 중 오류 발생'); }
  };

  const exTitle = exhibition?.title || '공모';

  const handlePdf = async (app: any) => {
    setPdfBusy(app.id);
    try { await downloadApplicationPdf(exTitle, app); }
    catch { toast.error('PDF 생성에 실패했습니다.'); }
    finally { setPdfBusy(null); }
  };

  const handleZip = async () => {
    if (applicants.length === 0) return;
    setPdfBusy('all');
    try {
      const n = await downloadAllApplicationsZip(exTitle, applicants);
      toast.success(`${n}명의 지원서를 ZIP으로 받았습니다.`);
    } catch { toast.error('ZIP 생성에 실패했습니다.'); }
    finally { setPdfBusy(null); }
  };

  // 권한: 갤러리 유저만 접근 (백엔드도 오너 검증)
  if (user && user.role !== 'GALLERY') {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <h1 className="text-xl font-semibold text-gray-900">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-gray-500">지원자 관리는 공모를 등록한 갤러리만 볼 수 있습니다.</p>
        <button onClick={() => navigate(-1)} className="mt-8 px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700">돌아가기</button>
      </div>
    );
  }

  const filtered = statusFilter === 'ALL' ? applicants : applicants.filter(a => a.status === statusFilter);
  const allFilteredSelected = filtered.length > 0 && filtered.every(a => selectedIds.has(a.id));
  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allFilteredSelected) filtered.forEach(a => next.delete(a.id));
    else filtered.forEach(a => next.add(a.id));
    setSelectedIds(next);
  };
  const toggleSelect = (appId: number) => {
    const next = new Set(selectedIds);
    next.has(appId) ? next.delete(appId) : next.add(appId);
    setSelectedIds(next);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-12 py-8 md:py-12">
      {/* 헤더 */}
      <button onClick={() => navigate(`/exhibitions/${id}`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={16} /> 공모 상세로
      </button>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium text-gray-900"><Users size={22} /> 지원자 관리</h1>
          <p className="text-sm text-gray-400 mt-1 line-clamp-1">{exTitle}</p>
        </div>
        {applicants.length > 0 && (
          <button
            onClick={handleZip}
            disabled={pdfBusy !== null}
            className="flex-none flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {pdfBusy === 'all' ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
            전체 지원서 ZIP
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="h-24 bg-gray-100 animate-pulse rounded-xl" />
      ) : isError ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-sm">지원자 목록을 불러오지 못했습니다. (권한이 없거나 공모가 존재하지 않습니다)</p>
        </div>
      ) : applicants.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">아직 지원자가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 상태 필터 */}
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_TABS.map(f => {
              const count = f.key === 'ALL' ? applicants.length : applicants.filter(a => a.status === f.key).length;
              return (
                <button
                  key={f.key}
                  onClick={() => { setStatusFilter(f.key); setSelectedIds(new Set()); }}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${statusFilter === f.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {f.label} {count > 0 ? `(${count})` : ''}
                </button>
              );
            })}
          </div>

          {/* 일괄 액션 */}
          <div className="flex items-center justify-between flex-wrap gap-2 bg-gray-50 rounded-xl px-3 py-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="rounded" />
              전체 선택 {selectedIds.size > 0 && <span className="text-gray-900 font-medium">({selectedIds.size}명)</span>}
            </label>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <select value={batchStatus} onChange={e => setBatchStatus(e.target.value)} className="text-xs p-1.5 border border-gray-200 rounded-lg">
                  <option value="">상태 변경</option>
                  <option value="SUBMITTED">접수</option>
                  <option value="ACCEPTED">수락</option>
                  <option value="REJECTED">거절</option>
                </select>
                <button onClick={() => { if (!batchStatus) return; batchStatus === 'ACCEPTED' ? setAcceptTarget({ type: 'batch' }) : batchUpdate(batchStatus); }} disabled={!batchStatus} className="px-2.5 py-1.5 text-xs bg-gray-900 text-white rounded-lg disabled:opacity-30">적용</button>
              </div>
            )}
          </div>

          {/* 목록 */}
          <div className="space-y-2">
            {filtered.map(app => {
              const isExpanded = expandedId === app.id;
              const isSelected = selectedIds.has(app.id);
              return (
                <div key={app.id} className={`border rounded-xl overflow-hidden transition-colors ${isSelected ? 'border-blue-300 bg-blue-50/30' : app.isFirstApplication ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
                  <div className="p-3 flex items-center gap-2">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(app.id)} className="rounded shrink-0" />
                    <div className="flex-1 flex justify-between items-center cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : app.id)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {app.user?.avatar && <img src={app.user.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />}
                        <span
                          className="text-sm font-medium text-gray-900 hover:underline cursor-pointer truncate"
                          onClick={e => { e.stopPropagation(); navigate(`/portfolio/${app.user?.id}`); }}
                        >
                          {displayName(app.user)}
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">{new Date(app.createdAt).toLocaleDateString('ko')}</span>
                        {app.isFirstApplication ? (
                          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">★ 첫 지원</span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">이 갤러리 {app.galleryApplicationOrder}번째</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {app.status === 'ACCEPTED' ? (
                          /* 수락은 최종 확정 — 변경 불가 */
                          <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-600 font-medium">수락 (확정)</span>
                        ) : (
                          <select
                            value={app.status}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); const v = e.target.value; v === 'ACCEPTED' ? setAcceptTarget({ type: 'single', appId: app.id }) : updateStatus.mutate({ appId: app.id, status: v }); }}
                            className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer ${statusColors[app.status] || ''}`}
                          >
                            {app.status !== 'REJECTED' && <option value="SUBMITTED">접수</option>}
                            <option value="ACCEPTED">수락</option>
                            <option value="REJECTED">거절</option>
                          </select>
                        )}
                        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-0 border-t border-gray-100 space-y-3 ml-7">
                      {/* 연락처 — 지원 시점부터 노출 */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-gray-600">
                        <span>🪪 {app.user?.nickname || app.user?.name}</span>
                        {app.user?.phone && <span>📞 {app.user.phone}</span>}
                        {app.user?.email && <span>📧 {app.user.email}</span>}
                      </div>
                      <ApplicationContent app={app} customFields={exhibition?.customFields} onImageClick={(images, index) => setLightbox({ images, index })} />
                      <button
                        onClick={() => handlePdf(app)}
                        disabled={pdfBusy !== null}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        {pdfBusy === app.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                        지원서 PDF
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 수락 확인 (되돌릴 수 없음) */}
      <ConfirmDialog
        open={acceptTarget !== null}
        title="지원자 수락"
        message={`수락하면 더 이상 상태를 변경할 수 없습니다.\n수락 시 지원자에게 알림이 전송되고 운영 페이지 참여가 활성화됩니다.\n\n정말 수락하시겠습니까?`}
        confirmText="수락하기"
        onConfirm={() => {
          if (acceptTarget?.type === 'single') updateStatus.mutate({ appId: acceptTarget.appId, status: 'ACCEPTED' });
          else if (acceptTarget?.type === 'batch') batchUpdate('ACCEPTED');
          setAcceptTarget(null);
        }}
        onCancel={() => setAcceptTarget(null)}
      />

      {/* 이미지 라이트박스 */}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox images={lightbox.images} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
