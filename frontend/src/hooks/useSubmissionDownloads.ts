import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { nameWithNickname } from '@/lib/utils';
import { useBoothCatalogue, CATALOGUE_LABEL } from '@/components/operation/BoothKitBar';
import type { OperationSubmission } from '@/types';

type Row = { user: any; submission: OperationSubmission };

/**
 * 출품 자료 내려받기 넷 — 작품 캡션(HWP) · 도록 PDF · 작품 원본(ZIP) · 출품 자료 PDF(ZIP).
 * 출품 자료 탭(`AdminSubmissionsSection`)과 마무리 요약 탭(`WorkspaceSummary` 의 '기록 내려받기')이 같이 쓴다(2026-11-20, 규칙 88).
 *
 *  - 진행률은 토스트가 아니라 **버튼 라벨**(`busyLabel`)에 — 토스트는 사라져 "멈춘 줄" 안다(2026-08)
 *  - 끝까지 못 받은 사진은 사라지는 토스트 대신 `missing` 으로 남겨 배너의 [다시 받기]로 잇는다
 */
export function useSubmissionDownloads(exhibitionId: string, exhibitionTitle: string, data: Row[]) {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [missing, setMissing] = useState<{ items: string[]; what: string; retry: () => void } | null>(null);
  const catalogue = useBoothCatalogue(exhibitionId, data);
  const totalArtworks = data.reduce((s, d) => s + (d.submission.artworkList?.length || 0), 0);

  const downloadAllZip = async () => {
    if (data.length === 0) { toast.error('수락된 작가가 없습니다.'); return; }
    setBusy('zip'); setMissing(null);
    const t = toast.loading('전체 출품 자료 PDF를 만드는 중입니다…');
    try {
      const { downloadAllSubmissionsZip } = await import('@/lib/operationPdf');
      const { missing: lost } = await downloadAllSubmissionsZip(exhibitionTitle, data, (done, total, phase) => {
        setProgress({ done, total, label: phase === 'images' ? '이미지' : phase === 'retry' ? '재시도' : 'PDF' });
      });
      if (lost.length > 0) {
        // 이미지가 빠진 채로 PDF가 나갔다는 걸 반드시 알린다(예전엔 조용히 넘어갔다). 배너로도 남겨 다시 받을 수 있게.
        toast.success(`ZIP 다운로드를 시작합니다. (이미지 ${lost.length}개 누락)`, { id: t });
        setMissing({ items: lost, what: 'PDF에 들어갈 작품 이미지', retry: downloadAllZip });
      } else {
        toast.success('ZIP 다운로드를 시작합니다.', { id: t });
      }
    } catch {
      toast.error('PDF 생성에 실패했습니다.', { id: t });
    } finally { setBusy(null); setProgress(null); }
  };

  // 캡션 HWP (한글 파일) — 서버에서 원본 양식 채워 생성, 작가명 미표기
  const downloadCaptions = async () => {
    if (totalArtworks === 0) { toast.error('등록된 출품작이 없습니다.'); return; }
    setBusy('caption');
    const t = toast.loading('캡션(한글 파일)을 만드는 중입니다…');
    try {
      const res = await api.get(`/operations/${exhibitionId}/caption.hwp`, { responseType: 'blob' });
      let fname = `${exhibitionTitle}_작품캡션.hwp`;
      const cd: string = res.headers['content-disposition'] || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      if (m) { try { fname = decodeURIComponent(m[1]!); } catch { /* keep default */ } }
      const { triggerDownload } = await import('@/lib/operationPdf'); // 앱에서는 공유 창으로(lib/native.ts)
      triggerDownload(res.data, fname);
      toast.success('캡션 한글 파일 다운로드를 시작합니다.', { id: t });
    } catch (e: any) {
      toast.error(e?.response?.status === 400 ? '등록된 출품작이 없습니다.' : '캡션 생성에 실패했습니다.', { id: t });
    } finally { setBusy(null); }
  };

  // 작품 원본 이미지 일괄 다운로드 (jpg ZIP) — rows 를 주면 그 작가만
  const downloadImages = async (rows: Row[] = data, zipName?: string) => {
    if (rows.reduce((s, d) => s + (d.submission.artworkList?.length || 0), 0) === 0) { toast.error('등록된 출품작이 없습니다.'); return; }
    setBusy('images'); setMissing(null);
    const t = toast.loading('작품 원본 이미지를 모으는 중입니다…');
    try {
      const { downloadAllArtworkImagesZip } = await import('@/lib/operationPdf');
      const { ok, fail, failed } = await downloadAllArtworkImagesZip(
        exhibitionTitle, rows, zipName,
        (done, total, phase) => setProgress({ done, total, label: phase === 'retry' ? '재시도' : '이미지' }),
      );
      if (ok === 0) toast.error('다운로드 가능한 작품 이미지가 없습니다.', { id: t });
      else if (fail > 0) {
        // 실패한 작품을 조용히 빠뜨리지 않고 명시한다 (+ 사라지지 않는 배너로 다시 받기 제공)
        toast.success(`원본 ${ok}개 ZIP 다운로드 시작 (실패 ${fail}개)`, { id: t });
        setMissing({ items: failed, what: '작품 원본', retry: () => downloadImages(rows, zipName) });
      } else toast.success(`원본 ${ok}개 ZIP 다운로드 시작`, { id: t });
    } catch { toast.error('이미지 ZIP 생성에 실패했습니다.', { id: t }); }
    finally { setBusy(null); setProgress(null); }
  };

  const downloadArtistImages = async (row: Row) => {
    const { safeName } = await import('@/lib/operationPdf');
    await downloadImages([row], `${safeName(exhibitionTitle)}_${safeName(nameWithNickname(row.user))}_작품원본.zip`);
  };
  const runCatalogue = () => { setBusy('catalogue'); catalogue.run().finally(() => setBusy(null)); };

  // 사진 모으기는 '장' 단위
  const busyLabel = busy === 'catalogue'
    ? catalogue.progress
    : busy === 'images'
      ? (progress ? `${progress.label} ${progress.done}/${progress.total}장` : '모으는 중…')
      : busy ? (progress ? `${progress.label} ${progress.done}/${progress.total}` : '만드는 중…') : catalogue.busy ? catalogue.progress : null;

  const downloads = [
    { key: 'caption', label: '작품 캡션(HWP)', hint: '전시장에 붙이는 캡션 — 작가명 없이', onSelect: downloadCaptions },
    { key: 'catalogue', label: '도록 PDF', hint: CATALOGUE_LABEL, onSelect: runCatalogue },
    { key: 'images', label: '작품 원본(ZIP)', hint: '작가별 폴더의 원본 이미지', onSelect: () => downloadImages() },
    { key: 'zip', label: '출품 자료 PDF(ZIP)', hint: '작가마다 출품리스트·약력·작가노트', onSelect: downloadAllZip },
  ];

  return { downloads, busy: !!busy, busyLabel, missing, clearMissing: () => setMissing(null), totalArtworks, downloadArtistImages };
}
