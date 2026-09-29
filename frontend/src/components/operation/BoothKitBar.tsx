import { useState } from 'react';
import toast from 'react-hot-toast';
import type { SubmissionRow } from '@/lib/operationPdf';

/**
 * 단체전 도록 — 갤러리 운영 화면 [출품 자료] 구역의 [내려받기 ▾] 안 한 항목 (2026-09-16, 메뉴로 옮김 2026-09-29).
 * 무거운 라이브러리(jspdf·html2canvas·포트폴리오 엔진)는 누를 때 동적으로 불러온다.
 *
 * 예전엔 작가 목록 위에 설명 상자 + 버튼으로 따로 있었다. 출품작이 0점일 때도 떠 있어 처음 온 갤러리가
 * "이걸 먼저 해야 하나?" 로 읽었다 — 지금은 출품작이 있을 때만 메뉴에 나온다.
 *
 * ⚠️ 엽서·가격표·QR 캡션은 없앴다(2026-09-16 사용자 결정) — 셋 다 작품 캡션(.hwp)이 이미 하는 일이다.
 *    `lib/boothKit.ts` 머리말 참고.
 */
export const CATALOGUE_LABEL = '단체전 도록 PDF (A5)';

export function useBoothCatalogue(exhibitionId: string, rows: SubmissionRow[]) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const totalWorks = rows.reduce((s, r) => s + (r.submission.artworkList?.length ?? 0), 0);

  const run = async () => {
    if (totalWorks === 0) { toast.error('등록된 출품작이 없습니다. 작가가 출품리스트를 제출해야 만들 수 있습니다.'); return; }
    setBusy(true); setProgress('');
    const t = toast.loading('도록을 만드는 중… 작가가 많으면 몇 분 걸립니다');
    try {
      const kit = await import('@/lib/boothKit');
      const ctx = await kit.loadBoothContext(exhibitionId);
      const { missing } = await kit.downloadCataloguePdf(ctx, rows, (phase, d, total) => setProgress(`${phase} ${d}/${total}`));
      // 못 받은 이미지는 조용히 빈 칸으로 두지 않는다 — 몇 장이 비었는지 알린다
      toast.success(missing.length ? `도록 다운로드 시작 (이미지 ${missing.length}장을 받지 못해 빈 칸입니다)` : '도록 다운로드를 시작합니다.', { id: t, duration: missing.length ? 8000 : 4000 });
    } catch (e) {
      console.error(e);
      toast.error('도록 생성에 실패했습니다.', { id: t });
    } finally { setBusy(false); setProgress(''); }
  };

  return { run, busy, progress: busy ? (progress || '도록 만드는 중…') : '' };
}
