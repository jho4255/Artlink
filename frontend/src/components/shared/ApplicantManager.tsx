/**
 * ApplicantManager - 지원자 관리 (Gallery 오너 전용, 인라인 공용 컴포넌트)
 *
 * MyPage '내 공모'(운영/클래식 뷰) 안에서 창 이동 없이 지원자를 전부 관리한다.
 * 기능: 상태 필터 탭 / 일괄 선택·상태변경 / 수락 확인(되돌릴 수 없음) /
 *       지원자별 지원서 PDF + 전체 ZIP / 첫지원·N번째 뱃지 / 연락처(닉네임·전화·이메일) /
 *       작품 사진 클릭 확대(원본 비율) / 커스텀 추가질문 답변.
 *
 * API: GET /exhibitions/:id/applications, PATCH /exhibitions/:id/applications/:appId
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, FileText, FileArchive, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicationContent from '@/components/shared/ApplicationContent';
import { downloadApplicationPdf, downloadAllApplicationsZip } from '@/lib/operationPdf';
import type { CustomField } from '@/types';

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

interface Props {
  exhibitionId: number;
  exhibitionTitle: string;
  customFields?: CustomField[] | null;
}

export default function ApplicantManager({ exhibitionId, exhibitionTitle, customFields }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchStatus, setBatchStatus] = useState('');
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [pdfBusy, setPdfBusy] = useState<number | 'all' | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<{ type: 'single'; appId: number } | { type: 'batch' } | null>(null);

  const { data: applicants = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ['exhibition-applicants', exhibitionId],
    queryFn: () => api.get(`/exhibitions/${exhibitionId}/applications`).then(r => r.data),
  });

  // 상태 변경 후 목록/카운트(운영 오버뷰·공모 목록)까지 갱신
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['exhibition-applicants', exhibitionId] });
    queryClient.invalidateQueries({ queryKey: ['my-operation-overview'] });
    queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
  };

  const updateStatus = useMutation({
    mutationFn: ({ appId, status }: { appId: number; status: string }) =>
      api.patch(`/exhibitions/${exhibitionId}/applications/${appId}`, { status }),
    onSuccess: () => { invalidate(); toast.success('상태가 변경되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '상태 변경 실패'),
  });

  const batchUpdate = async (status: string) => {
    if (selectedIds.size === 0) return;
    const results = await Promise.allSettled(Array.from(selectedIds).map(appId =>
      api.patch(`/exhibitions/${exhibitionId}/applications/${appId}`, { status })));
    invalidate();
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(`${ok}명의 상태를 변경했습니다.`);
    else toast.error(`${ok}건 변경, ${fail}건 실패`);
    setSelectedIds(new Set());
    setBatchStatus('');
  };

  const handlePdf = async (app: any) => {
    setPdfBusy(app.id);
    try { await downloadApplicationPdf(exhibitionTitle, app, customFields); }
    catch { toast.error('PDF 생성에 실패했습니다.'); }
    finally { setPdfBusy(null); }
  };

  const handleZip = async () => {
    if (applicants.length === 0) return;
    setPdfBusy('all');
    try {
      const n = await downloadAllApplicationsZip(exhibitionTitle, applicants, customFields);
      toast.success(`${n}명의 지원서를 ZIP으로 받았습니다.`);
    } catch { toast.error('ZIP 생성에 실패했습니다.'); }
    finally { setPdfBusy(null); }
  };

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

  if (isLoading) return <div className="h-24 bg-gray-100 animate-pulse rounded-xl" />;
  if (isError) return <p className="text-sm text-gray-400 py-6 text-center">지원자 목록을 불러오지 못했습니다.</p>;
  if (applicants.length === 0) return <p className="text-sm text-gray-400 py-6 text-center">아직 지원자가 없습니다.</p>;

  return (
    <div className="space-y-3">
      {/* 상단: 필터 + 전체 ZIP */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
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
        <button
          onClick={handleZip}
          disabled={pdfBusy !== null}
          className="flex-none flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-800 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {pdfBusy === 'all' ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
          전체 지원서 ZIP
        </button>
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
                  <ApplicationContent app={app} customFields={customFields} onImageClick={(images, index) => setLightbox({ images, index })} />
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

      {/* 이미지 라이트박스 — 원본 비율 */}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox images={lightbox.images} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
