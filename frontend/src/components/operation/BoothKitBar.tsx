import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SubmissionRow } from '@/lib/operationPdf';

/**
 * 단체전 도록 — 갤러리 운영 페이지의 [작가 제출 정보] 아래 (2026-09-16).
 * 무거운 라이브러리(jspdf·html2canvas·포트폴리오 엔진)는 누를 때 동적으로 불러온다.
 *
 * ⚠️ 엽서·가격표·QR 캡션 버튼은 없앴다(2026-09-16 사용자 결정) — 셋 다 작품 캡션(.hwp)이 이미 하는 일이다.
 *    `lib/boothKit.ts` 머리말 참고.
 */
const CATALOGUE = {
  name: '도록 PDF (A5)',
  loading: '도록을 만드는 중… 작가가 많으면 몇 분 걸립니다',
  hint: '표지 · 전시 소개 · 작가별 작품 · 약력',
};

export default function BoothKitBar({ exhibitionId, rows }: { exhibitionId: string; exhibitionTitle: string; rows: SubmissionRow[] }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const totalWorks = rows.reduce((s, r) => s + (r.submission.artworkList?.length ?? 0), 0);

  const run = async () => {
    if (totalWorks === 0) { toast.error('등록된 출품작이 없습니다. 작가가 출품리스트를 제출해야 만들 수 있습니다.'); return; }
    setBusy(true); setProgress('');
    const t = toast.loading(CATALOGUE.loading);
    try {
      const kit = await import('@/lib/boothKit');
      const ctx = await kit.loadBoothContext(exhibitionId);
      const { missing } = await kit.downloadCataloguePdf(ctx, rows, (phase, d, total) => setProgress(`${phase} ${d}/${total}`));
      // 못 받은 이미지는 조용히 빈 칸으로 두지 않는다 — 몇 장이 비었는지 알린다
      toast.success(missing.length ? `${CATALOGUE.name} 다운로드 시작 (이미지 ${missing.length}장을 받지 못해 빈 칸입니다)` : `${CATALOGUE.name} 다운로드를 시작합니다.`, { id: t, duration: missing.length ? 8000 : 4000 });
    } catch (e) {
      console.error(e);
      toast.error(`${CATALOGUE.name} 생성에 실패했습니다.`, { id: t });
    } finally { setBusy(false); setProgress(''); }
  };

  return (
    <div className="mb-4 border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">단체전 도록</p>
          <p className="mt-0.5 text-xs text-gray-500">
            수락 작가 {rows.length}명 · 출품작 {totalWorks}점의 제출자료로 A5 도록을 만듭니다.
            작가마다 대표작·작가노트·작품·약력이 들어가고, 대표작은 작가가 출품리스트에서 고른 것을 씁니다.
          </p>
        </div>
        <div className="shrink-0">
          <button
            onClick={run}
            disabled={busy}
            title={CATALOGUE.hint}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            {busy ? (progress || '생성 중…') : CATALOGUE.name}
          </button>
        </div>
      </div>
    </div>
  );
}
