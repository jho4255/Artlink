/**
 * 마무리 [요약] 탭 — 정산이 끝난 공모의 첫 탭 (2026-11-20, 규칙 88).
 *
 * 예전엔 정산 완료가 회색 배지 하나로 끝났다 — 끝났다는 것 말고는 무엇이 남았는지, 다음에 무엇을 할지 화면이 말하지 않았다.
 *  - 숫자 다섯 칸: 참여 작가 · 출품작 · 판매 · 판매 합계 · 작가 지급
 *  - 다음 할 일: [판매작 홍보 이미지 만들기](판매가 있을 때 · ArtLook) · [갤러리 홈페이지의 지난 전시 보기] · [새 공모 등록]
 *  - 기록 내려받기: 정산서 · 도록 · 캡션 · 출품 자료 · 지원서 (전부 있던 함수 — 출품 자료 넷은 `useSubmissionDownloads`)
 *  - 참여 작가 줄: 대표 그림 · 출품 · 판매 · 지급 · 작가 홈페이지
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { cn, nameWithNickname } from '@/lib/utils';
import { won, artistTotals } from '@/lib/settlement';
import { openArtLook } from '@/lib/artlook';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSubmissionDownloads } from '@/hooks/useSubmissionDownloads';
import Thumb from '@/components/shared/Thumb';
import MenuButton from '@/components/flow/MenuButton';
import MissingImagesBanner from '@/components/shared/MissingImagesBanner';
import type { SettlementController } from '@/components/operation/settlementController';
import type { CustomField, Exhibition, OperationSubmission } from '@/types';
import { FileDown } from 'lucide-react';
import GuestChip from '@/components/operation/GuestChip';

export default function WorkspaceSummary({ exhibitionId, detail, ctl, submissions, galleryId }: {
  exhibitionId: number;
  detail: Exhibition;
  ctl: SettlementController;
  submissions: { user: any; submission: OperationSubmission }[];
  galleryId: number | null;
}) {
  const id = String(exhibitionId);
  const wide = useMediaQuery('(min-width: 768px)');
  const role = useAuthStore((s) => s.user?.role);
  const dl = useSubmissionDownloads(id, detail.title, submissions);
  const { data: applicants = [] } = useQuery<any[]>({
    queryKey: ['exhibition-applicants', exhibitionId],
    queryFn: () => api.get(`/exhibitions/${exhibitionId}/applications`).then((r) => r.data),
  });
  const [appsBusy, setAppsBusy] = useState<string | null>(null);

  const artists = ctl.artists;
  const totalWorks = submissions.reduce((s, d) => s + (d.submission.artworkList?.length || 0), 0) || artists.reduce((s, a) => s + a.works.length, 0);
  const participants = Math.max(artists.length, submissions.length);

  const downloadApplications = async () => {
    if (applicants.length === 0) { toast.error('지원서가 없습니다.'); return; }
    setAppsBusy('만드는 중…');
    try {
      const { downloadAllApplicationsZip } = await import('@/lib/operationPdf');
      const { count, missing } = await downloadAllApplicationsZip(detail.title, applicants, detail.customFields as CustomField[] | null | undefined,
        (done, total, phase) => setAppsBusy(`${phase === 'pdf' ? 'PDF' : phase === 'retry' ? '재시도' : '사진'} ${done}/${total}`));
      toast.success(missing.length ? `${count}명의 지원서를 ZIP으로 받았습니다. (사진 누락 ${missing.length}명)` : `${count}명의 지원서를 ZIP으로 받았습니다.`);
    } catch { toast.error('ZIP 생성에 실패했습니다.'); } finally { setAppsBusy(null); }
  };

  const records = [
    { key: 'settle', label: '정산서 PDF', onSelect: () => ctl.downloadOverall() },
    ...dl.downloads.filter((d) => d.key !== 'images').map((d) => ({ key: d.key, label: d.key === 'zip' ? '출품 자료 PDF' : d.label, onSelect: d.onSelect })),
    { key: 'apps', label: '지원서 전체', onSelect: downloadApplications },
  ];
  const busyLabel = dl.busyLabel ?? appsBusy ?? (ctl.zipping ? '만드는 중…' : null);

  const stat = (label: string, value: string) => (
    <div className="py-5">
      <dt className="text-[12.5px] text-gray-500">{label}</dt>
      <dd className="mt-1 text-[19px] font-semibold tabular-nums text-gray-950 sm:text-[21px]">{value}</dd>
    </div>
  );

  return (
    <div data-workspace-summary>
      <dl className="grid grid-cols-2 gap-x-3 border-b border-gray-200 sm:grid-cols-5">
        {stat('참여 작가', `${participants}명`)}
        {stat('출품작', `${totalWorks}점`)}
        {stat('판매', `${ctl.grand.soldCount}점`)}
        {stat('판매 합계', won(ctl.grand.total))}
        {stat('작가 지급', won(ctl.grand.artistAmount))}
      </dl>

      {/* 다음 할 일 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 py-5">
        {ctl.soldWorks.length > 0 && (
          <button
            type="button"
            onClick={() => { if (openArtLook(ctl.soldWorks) === 0) toast.error('홍보할 판매 작품 이미지가 없습니다.'); }}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800"
          >
            판매작 홍보 이미지 만들기
          </button>
        )}
        {galleryId && (
          <Link to={`/galleries/${galleryId}?tab=history`} className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50">
            갤러리 홈페이지의 지난 전시 보기
          </Link>
        )}
        {role === 'GALLERY' && (
          <Link to="/exhibitions/new" className="inline-flex min-h-[44px] items-center px-1 text-sm text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline">새 공모 등록</Link>
        )}
      </div>

      {/* 기록 내려받기 */}
      <div className="flex min-h-[60px] flex-wrap items-center gap-x-5 gap-y-1 border-b border-gray-200 py-2 text-[13.5px]">
        {wide && !busyLabel ? (
          <>
            <span className="text-gray-500">기록 내려받기</span>
            {records.map((r) => (
              <button key={r.key} type="button" onClick={r.onSelect} className="min-h-[40px] text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline">{r.label}</button>
            ))}
          </>
        ) : (
          <MenuButton label="기록 내려받기" icon={<FileDown size={13} aria-hidden />} busyLabel={busyLabel} items={records.map((r) => ({ label: r.label, onSelect: r.onSelect }))} align="left" />
        )}
      </div>
      {dl.missing && <MissingImagesBanner items={dl.missing.items} what={dl.missing.what} busy={dl.busy} onRetry={dl.missing.retry} onDismiss={dl.clearMissing} />}

      {/* 참여 작가 */}
      {artists.length > 0 && (
        <>
          <h2 className="mt-8 border-b-2 border-gray-900 pb-2.5 text-sm font-semibold text-gray-950">참여 작가</h2>
          <ul>
            {artists.map((a) => {
              const t = artistTotals(a, ctl.feeNum);
              const sold = a.works.filter((w) => w.sold).length;
              const image = a.works.find((w) => w.sold && w.image)?.image ?? a.works.find((w) => w.image)?.image;
              const name = nameWithNickname(a.user);
              return (
                <li key={a.user.id} className={cn('border-b border-gray-200 text-[14.5px]', wide ? 'grid min-h-[80px] grid-cols-[56px_minmax(0,1fr)_96px_96px_170px_110px] items-center gap-x-4' : 'flex min-h-[80px] items-center gap-3.5 py-3')}>
                  {image ? <Thumb src={image} alt="" className="h-14 w-14 shrink-0 bg-white object-contain" /> : <span className="h-14 w-14 shrink-0 bg-gray-50" aria-hidden />}
                  {wide ? (
                    <>
                      <span className="truncate font-semibold text-gray-950">{name}</span>
                      <span className="text-gray-600">출품 {a.works.length}점</span>
                      <span className="text-gray-600">판매 {sold}점</span>
                      <span className="tabular-nums text-gray-900">지급 {won(t.artistAmount)}</span>
                      {/* 비회원 작가(규칙 91)는 홈페이지가 없다 */}
                      {a.guest
                        ? <span className="justify-self-end"><GuestChip /></span>
                        : <Link to={`/portfolio/${a.user.id}`} className="justify-self-end text-[13.5px] text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline">작가 홈페이지</Link>}
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-gray-950">{name}</span>
                        <span className="block text-[13px] text-gray-600">출품 {a.works.length}점 · 판매 {sold}점 · 지급 {won(t.artistAmount)}</span>
                      </span>
                      {a.guest
                        ? <GuestChip />
                        : <Link to={`/portfolio/${a.user.id}`} className="shrink-0 text-[13px] text-gray-700 underline underline-offset-4">홈페이지</Link>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
