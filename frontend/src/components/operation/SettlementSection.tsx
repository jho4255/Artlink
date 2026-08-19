/**
 * 정산 섹션 (갤러리 오너 / Admin) — 전시 종료 후 판매 기록 · 비율 · 작가 확인 · 완료
 *
 * ── 왜 공용 컴포넌트인가 ────────────────────────────────────
 * `OperationPage`(신규 뷰)와 `OperationClassicPage`(클래식 뷰)에 **완전히 같은 코드가 복붙**돼 있었다
 * (다른 곳은 바깥 `<section>` className 한 줄뿐). 정산은 돈을 다루는 화면이라 두 벌이 갈라지면
 * 한쪽에서만 금액 규칙이 어긋나도 조용히 지나간다. 그래서 한 벌로 합치고 `className` 만 받는다.
 *
 * ── 작가별 접기/열기 ────────────────────────────────────────
 * 단체전은 작가 10명 × 출품작 여러 점이라 다 펼치면 화면이 수십 개 행으로 덮인다.
 * 그래서 기본은 접고, 접힌 줄에 **판단에 필요한 것만**(상태 · 판매 점수 · 작가 지급액) 남긴다.
 *  · 작가가 2명 이하면 접을 이유가 없으므로 펼친 채로 시작한다
 *  · **문제를 제기한 작가는 항상 펼쳐서 시작한다** — 갤러리가 지금 봐야 하는 건 정확히 그 사람이다
 *
 * ── 부분 재확인 (backend/src/lib/settlementFingerprint.ts) ──
 * 예전엔 [요청 취소]가 작가 확인 기록을 통째로 지워서, 한 명이 문제를 제기하면 전원이 다시 확인해야 했다.
 * 이제 서버가 **금액이 바뀐 작가만** 재확인 대상으로 돌린다. 화면은 그 결과를 숫자로 알려준다
 * (저장 시 `resetCount`, 재요청 시 `requestedCount`/`keptCount`).
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileDown, ImageOff, Megaphone, ChevronDown, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import { nameWithNickname } from '@/lib/utils';
import { openArtLook, type ArtLookWork } from '@/lib/artlook';
import { won, artistTotals, initialOpenArtistIds, settlementFormSignature, type EditArtist, type EditWork } from '@/lib/settlement';
import type { Settlement, SettlementArtist } from '@/types';

type Approval = {
  status: string;
  comment?: string | null;
  /** 이 날짜까지 무응답이면 자동 수락 (PENDING 일 때만) */
  autoApproveAt?: string | null;
  /** 사람이 누른 수락이 아니라 무응답 자동 처리인가 */
  autoApproved?: boolean;
} | null;
type SettlementData = Omit<Settlement, 'artists'> & {
  settled?: boolean; settledAt?: string | null; settlementRequested?: boolean; allApproved?: boolean;
  artists: (SettlementArtist & { approval?: Approval })[];
};

/** 접힌 줄의 상태 배지 — 요청 중이 아니어도 '이미 수락함' 은 보여준다(재요청해도 유지되는 정보라 중요) */
function ApprovalBadge({ status, autoApproved }: { status?: string; autoApproved?: boolean }) {
  // shrink-0 + whitespace-nowrap 필수 — 좁은 화면에서 눌리면 '대 기 중' 처럼 세로로 쪼개진다
  const base = 'shrink-0 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded-full';
  // 자동 수락은 사람이 누른 수락과 반드시 구분해서 보여준다 — 나중에 다툼이 생기면 이 구분이 근거다
  if (status === 'APPROVED' && autoApproved) return <span className={`${base} bg-gray-100 text-gray-600`}>자동 수락</span>;
  if (status === 'APPROVED') return <span className={`${base} bg-green-100 text-green-700`}>수락</span>;
  if (status === 'ISSUE') return <span className={`${base} bg-red-100 text-red-700`}>문제 제기</span>;
  if (status === 'PENDING') return <span className={`${base} bg-gray-100 text-gray-500`}>대기중</span>;
  return null;
}

export default function SettlementSection({ exhibitionId, isAdmin, className = 'mb-10' }: { exhibitionId: string; isAdmin?: boolean; className?: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SettlementData>({
    queryKey: ['operation-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [artists, setArtists] = useState<EditArtist[]>([]);
  const [exTitle, setExTitle] = useState('');
  /** 카드 결제 수수료율(%) — 전시 하나에 하나. 입력 중 '2.' 같은 상태를 허용해야 해서 문자열로 들고 있다 */
  const [feeRate, setFeeRate] = useState('0');
  const [zipping, setZipping] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 펼친 작가 id 집합. 초기값은 데이터가 온 뒤 한 번만 정한다(사용자가 접은 걸 refetch 가 되돌리면 안 된다) */
  const [openIds, setOpenIds] = useState<Set<number> | null>(null);
  const settled = !!data?.settled;
  const requested = !!data?.settlementRequested;
  const allApproved = !!data?.allApproved;
  // 정산 입력 잠금은 **완료된 뒤에만**. 확인 요청 중에도 고칠 수 있어야 한다 —
  // 한 작가의 문제를 고치자고 요청 전체를 내리면 검토 중이던 다른 작가의 화면까지 닫힌다.
  // 고치면 서버가 그 작가만 다시 확인 대상으로 돌리고 그 사람에게만 알림을 보낸다.
  const locked = settled && !isAdmin;
  const approvalOf = (uid: number) => data?.artists.find(x => x.user.id === uid)?.approval ?? null;
  /** 확인 요청 중이 아니어도 남아 있는 수락 기록 — 재요청 시 그대로 유지된다 */
  const approvedCount = data?.artists.filter(x => x.approval?.status === 'APPROVED').length ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['operation-settlement', exhibitionId] });
    qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] });
  };
  // 입력 중인 문자열('', '2.')은 0으로 본다 — 계산·저장은 항상 숫자로만 한다
  const feeNum = Number(feeRate) || 0;
  /**
   * 화면에 입력된 내용을 서버에 쓴다.
   *
   * 함수 선언으로 둔 이유 — 아래 mutation 들보다 늦게 정의되지만 호이스팅돼 그 안에서 부를 수 있고,
   * 클릭 시점의 `artists` 를 읽는다. **보내는 동작은 전부 이걸 먼저 거친다**:
   * 예전엔 [이 작가에게 다시 확인 요청]이 저장을 안 해서, 금액을 고쳐도 작가에겐 옛 금액이 갔고
   * 목록을 다시 불러오면서 입력하던 값까지 조용히 사라졌다(실제로 겪음).
   */
  function persist() {
    const sales = artists.flatMap(a => a.works.filter(w => w.sold).map(w => ({ artistUserId: a.user.id, artworkIndex: w.index, title: w.title, soldPrice: w.soldPrice || 0, paymentMethod: w.paymentMethod || 'CARD' })));
    const ratios = artists.map(a => ({ artistUserId: a.user.id, galleryRatio: a.galleryRatio }));
    return api.put(`/operations/${exhibitionId}/settlement`, { sales, ratios, cardFeeRate: feeNum });
  }

  const completeMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/complete`),
    onSuccess: () => { toast.success('정산이 완료되었습니다. 참여 작가에게 공유됩니다.'); setConfirmOpen(false); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '정산 완료 실패'),
  });
  const requestMutation = useMutation({
    // 저장 안 된 변경이 있으면 **먼저 저장하고** 요청한다 — 안 그러면 작가가 옛 금액을 확인하게 된다
    mutationFn: async () => {
      const saved = dirtyRef.current ? await persist() : null;
      const res = await api.post(`/operations/${exhibitionId}/settlement/request`);
      return { res, savedFirst: !!saved };
    },
    onSuccess: ({ res, savedFirst }: any) => {
      const asked = res.data?.requestedCount ?? 0, kept = res.data?.keptCount ?? 0;
      const prefix = savedFirst ? '저장하고 ' : '';
      // 재요청에서 몇 명을 건너뛰었는지 말해주지 않으면, 갤러리는 전원에게 또 보낸 줄 안다
      if (asked === 0) toast.success(kept > 0 ? `이미 ${kept}명이 수락한 상태입니다. 새로 요청할 작가가 없습니다.` : '요청할 작가가 없습니다.');
      else toast.success(kept > 0 ? `${prefix}${asked}명에게 확인을 요청했습니다. (${kept}명은 기존 수락 유지)` : `${prefix}${asked}명에게 정산 확인을 요청했습니다.`);
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '요청 실패'),
  });
  // 작가 한 명만 다시 확인 대상으로 — 금액을 고쳐 보낼 때도, 고칠 게 없어 '문제 제기'만 풀 때도 이걸 쓴다
  const reaskMutation = useMutation({
    mutationFn: async (artistUserId: number) => {
      const saved = dirtyRef.current ? await persist() : null;
      // 저장이 이미 이 작가를 재확인 대상으로 돌리고 알림까지 보냈다면 또 부르지 않는다(알림 2번 방지)
      const resetIds: number[] = saved?.data?.resetIds ?? [];
      const already = resetIds.includes(artistUserId);
      if (!already) await api.post(`/operations/${exhibitionId}/settlement/request/artist/${artistUserId}`);
      return { savedFirst: !!saved };
    },
    onSuccess: ({ savedFirst }: any) => {
      toast.success(savedFirst ? '저장하고 이 작가에게 다시 확인을 요청했습니다.' : '이 작가에게만 다시 확인을 요청했습니다.');
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '요청 실패'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/request/cancel`),
    onSuccess: (res: any) => {
      const kept = res.data?.keptCount ?? 0;
      toast.success(kept > 0 ? `요청을 취소했습니다. 이미 수락한 ${kept}명의 기록은 유지됩니다.` : '정산 확인 요청을 취소했습니다.');
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '취소 실패'),
  });

  useEffect(() => {
    if (!data) return;
    setExTitle(data.exhibitionTitle);
    setFeeRate(String(data.cardFeeRate ?? 0));
    setArtists(data.artists.map(a => ({
      user: a.user,
      galleryRatio: a.galleryRatio,
      works: a.works.map(w => ({ index: w.index, title: w.title, image: w.image, size: w.size, medium: w.medium, year: w.year, listPrice: w.listPrice, sold: w.sold, soldPrice: w.soldPrice, paymentMethod: (w.paymentMethod || 'CARD') as 'CARD' | 'CASH' })),
    })));
    // 이미 한 번 정했으면 사용자의 접기/펼치기를 존중한다 (refetch 가 되돌리면 안 된다)
    setOpenIds(prev => prev ?? initialOpenArtistIds(data.artists));
  }, [data]);

  const isOpen = (uid: number) => !!openIds?.has(uid);
  const toggle = (uid: number) => setOpenIds(prev => {
    const next = new Set(prev ?? []);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  const allOpen = artists.length > 0 && artists.every(a => isOpen(a.user.id));
  const toggleAll = () => setOpenIds(allOpen ? new Set() : new Set(artists.map(a => a.user.id)));

  const updWork = (ai: number, wi: number, patch: Partial<EditWork>) =>
    setArtists(prev => prev.map((a, i) => i !== ai ? a : { ...a, works: a.works.map((w, j) => j === wi ? { ...w, ...patch } : w) }));
  const updRatio = (ai: number, ratio: number) =>
    setArtists(prev => prev.map((a, i) => i === ai ? { ...a, galleryRatio: Math.min(100, Math.max(0, ratio)) } : a));

  // 저장 안 된 변경이 있는가 — 화면 값과 서버 값을 같은 규칙으로 지문 비교.
  // ref 로도 들고 있는 이유: mutationFn 이 만들어질 때가 아니라 **클릭한 순간**의 값을 봐야 한다.
  const dirty = !!data && artists.length > 0
    && settlementFormSignature(artists, feeNum) !== settlementFormSignature(data.artists, data.cardFeeRate ?? 0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const saveMutation = useMutation({
    mutationFn: () => persist(),
    onSuccess: (res: any) => {
      const reset = res.data?.resetCount ?? 0, notified = res.data?.notified ?? 0;
      // 금액을 고치면 그 작가의 수락이 풀린다 — 말 안 해주면 갤러리는 왜 다시 대기중인지 모른다
      if (notified > 0) toast.success(`저장했습니다. 금액이 바뀐 ${notified}명에게 다시 확인해달라고 알렸습니다.`);
      else if (reset > 0) toast.success(`저장했습니다. 금액이 바뀐 ${reset}명은 다시 확인을 받아야 합니다.`);
      else toast.success('정산 정보가 저장되었습니다.');
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  // 현재 편집 상태로 정산 객체 구성 (PDF용)
  const buildSettlement = (): Settlement => {
    const built = artists.map(a => {
      const t = artistTotals(a, feeNum);
      return { user: a.user, galleryRatio: a.galleryRatio, artistRatio: 100 - a.galleryRatio, works: a.works, ...t };
    });
    return {
      exhibitionTitle: exTitle,
      cardFeeRate: feeNum,
      artists: built,
      grand: {
        total: built.reduce((s, a) => s + a.total, 0),
        cardTotal: built.reduce((s, a) => s + a.cardTotal, 0),
        cashTotal: built.reduce((s, a) => s + a.cashTotal, 0),
        cardFee: built.reduce((s, a) => s + a.cardFee, 0),
        settleBase: built.reduce((s, a) => s + a.settleBase, 0),
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
      const { missing } = await downloadOverallSettlementPdf(buildSettlement(), method);
      if (missing.length > 0) toast.error(`작품 이미지 ${missing.length}건이 빠졌습니다: ${missing.slice(0, 3).join(', ')}`, { duration: 8000 });
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };
  const downloadArtist = async (ai: number, method?: 'CARD' | 'CASH') => {
    setZipping(true);
    try {
      const s = buildSettlement();
      const { downloadArtistSettlementPdf } = await import('@/lib/operationPdf');
      const { missing } = await downloadArtistSettlementPdf(s.exhibitionTitle, s.artists[ai], method, undefined, { cardFeeRate: feeNum });
      if (missing.length > 0) toast.error(`작품 이미지 ${missing.length}건이 빠졌습니다: ${missing.slice(0, 3).join(', ')}`, { duration: 8000 });
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };

  if (isLoading) return <div className="h-32 bg-gray-100 animate-pulse rounded-xl mb-10" />;

  const grand = buildSettlement().grand;
  // ArtLook 홍보용: 판매 체크 + 이미지가 있는 작품들
  const soldWorks: ArtLookWork[] = artists.flatMap(a => a.works.filter(w => w.sold && w.image).map(w => ({ url: w.image as string, title: w.title || '', artist: nameWithNickname(a.user), exhibition: exTitle, kind: 'sold' as const })));

  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-medium text-gray-900">정산</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 저장: 편집 가능할 때(미잠금). 관리자는 완료 후에도 저장 가능 */}
          {/* 저장 안 된 변경은 눈에 보여야 한다 — 안 보이면 '저장했겠지' 하고 다음 버튼을 누른다 */}
          {dirty && !locked && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">저장 안 된 변경 있음</span>
          )}
          {!locked && (
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className={`px-3 py-1.5 text-white text-sm rounded-lg disabled:opacity-50 ${dirty ? 'bg-[#c4302b] hover:bg-[#a82822]' : 'bg-gray-900'}`}>{saveMutation.isPending ? '저장 중...' : '정산 저장'}</button>
          )}
          {!settled && !requested && (
            <button onClick={() => requestMutation.mutate()} disabled={requestMutation.isPending} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">정산 확인 요청</button>
          )}
          {requested && !settled && (
            <>
              {/* 취소·완료는 값을 보내는 게 아니라 확정/철회다. 저장 안 된 변경이 있으면
                  ①취소는 새로고침하며 입력을 날리고 ②완료는 옛 금액으로 확정된다 — 그래서 먼저 막는다 */}
              <button onClick={() => dirty ? toast.error('저장 안 된 변경이 있습니다. [정산 저장] 후 취소하세요.') : cancelMutation.mutate()} disabled={cancelMutation.isPending} className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50">요청 취소</button>
              <button onClick={() => dirty ? toast.error('저장 안 된 변경이 있습니다. [정산 저장] 후 완료하세요.') : setConfirmOpen(true)} disabled={!allApproved || completeMutation.isPending} title={allApproved ? '' : '모든 작가가 수락해야 완료할 수 있습니다'} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">정산 완료</button>
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
          <b>정산 확인 요청 중</b> · 작가 {approvedCount}/{data?.artists.length ?? 0}명 수락.
          {allApproved ? ' 전원 수락 — [정산 완료]를 누를 수 있습니다.' : ' 전원 수락 시 [정산 완료]가 활성화됩니다.'}
          {' '}요청 중에도 금액을 고칠 수 있습니다 — <b>고친 작가에게만</b> 다시 확인 요청이 갑니다.
        </div>
      )}

      {/* 요청은 끝났는데 수락 기록이 남아 있는 상태 — 다시 요청해도 이 사람들은 건너뛴다 */}
      {!requested && !settled && approvedCount > 0 && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          이미 <b>{approvedCount}명</b>이 정산을 수락한 상태입니다. 금액을 고치지 않은 작가는 <b>다시 요청해도 수락이 유지</b>되고, 금액이 바뀐 작가에게만 확인 요청이 갑니다.
        </div>
      )}

      {/*
        카드 수수료율 — 전시 하나에 하나. 카드로 팔린 금액에서 먼저 떼고 남은 금액을 비율로 나눈다.
        여기 값을 고치면 **카드 판매가 있는 작가만** 수락이 풀린다(현금으로만 판 작가는 금액이 안 변하므로 유지).
      */}
      {!locked && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="card-fee-rate" className="text-sm font-medium text-gray-900 shrink-0">카드 수수료</label>
            <input
              id="card-fee-rate" type="number" inputMode="decimal" step="0.01" min="0" max="100"
              value={feeRate}
              onChange={e => setFeeRate(e.target.value)}
              onBlur={() => setFeeRate(String(feeNum))}
              className="w-24 min-h-[36px] px-2 py-1 border border-gray-300 rounded-lg text-sm text-right tabular-nums"
            />
            <span className="text-sm text-gray-600 shrink-0">%</span>
            {grand.cardFee ? (
              <span className="text-xs text-gray-500 min-w-0">
                카드 {won(grand.cardTotal ?? 0)} 중 <b className="text-gray-900">{won(grand.cardFee)}</b> 공제
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            카드로 팔린 금액에서 먼저 뗀 뒤, 남은 금액을 갤러리:작가 비율로 나눕니다. 현금 판매에는 붙지 않습니다.
            {' '}0을 넣으면 수수료 없이 계산됩니다.
          </p>
        </div>
      )}

      {/* 판매작 홍보 CTA — ArtLook 연결 */}
      {soldWorks.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#c4302b]/25 bg-[#fff5f4] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">판매한 작품들을 홍보해보세요</p>
            <p className="text-xs text-gray-500 mt-0.5">판매된 {soldWorks.length}점을 액자·전시 공간에 담아 SNS 홍보 이미지를 만들 수 있어요.</p>
          </div>
          <button onClick={() => { if (openArtLook(soldWorks) === 0) toast.error('홍보할 판매 작품 이미지가 없습니다.'); }} className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-[#c4302b] rounded-lg hover:bg-[#a82822] cursor-pointer">
            <Megaphone size={15} /> ArtLook으로 홍보 이미지 만들기
          </button>
        </div>
      )}

      {artists.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">수락된 작가가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {artists.length > 1 && (
            <div className="flex justify-end">
              <button onClick={toggleAll} className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 min-h-[32px]">
                {allOpen ? '모두 접기' : '모두 펼치기'}
              </button>
            </div>
          )}
          {artists.map((a, ai) => {
            const t = artistTotals(a, feeNum);
            const appr = approvalOf(a.user.id);
            const open = isOpen(a.user.id);
            const soldCount = a.works.filter(w => w.sold).length;
            return (
              <div key={a.user.id} className="border border-gray-200 rounded-xl p-4">
                {/*
                  모바일에서는 토글이 **한 줄을 다 쓰고** PDF 버튼 묶음이 아래로 내려간다.
                  한 줄에 이름·배지·요약·버튼 3개를 다 밀어 넣었더니 375px 에서 이름이 '한' 한 글자로
                  뭉개지고 배지가 세로로 쪼개졌다(실측). 좁을 땐 줄을 나누는 게 맞다.
                */}
                <div className="flex items-center justify-between gap-x-2 gap-y-1 flex-wrap">
                  {/* 헤더 왼쪽 전체가 토글 — 접힌 상태에서 판단에 필요한 것만 남긴다 */}
                  <button
                    type="button"
                    onClick={() => toggle(a.user.id)}
                    aria-expanded={open}
                    className="flex w-full min-w-0 items-center gap-2 text-left min-h-[44px] cursor-pointer sm:w-auto sm:flex-1"
                  >
                    <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                    <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 truncate">{nameWithNickname(a.user)}</span>
                        <ApprovalBadge status={appr?.status} autoApproved={appr?.autoApproved} />
                      </span>
                      {!open && (
                        <span className="text-xs text-gray-500 truncate">
                          {soldCount > 0 ? `판매 ${soldCount}점 · ${won(t.total)} · 작가 ${won(t.artistAmount)}` : '판매 없음'}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
                    <button onClick={() => downloadArtist(ai)} disabled={zipping} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"><FileDown size={12} /> 정산 PDF</button>
                    <button onClick={() => downloadArtist(ai, 'CASH')} disabled={zipping} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50">현금</button>
                    <button onClick={() => downloadArtist(ai, 'CARD')} disabled={zipping} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50">카드</button>
                  </div>
                </div>

                {/* 언제까지 기다리면 되는지 — 갤러리도 알아야 [정산 완료] 시점을 잡는다 */}
                {appr?.status === 'PENDING' && appr.autoApproveAt && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    {new Date(appr.autoApproveAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}까지 무응답이면 자동 수락
                  </p>
                )}

                {/* 문제 제기는 접혀 있어도 보여준다 — 갤러리가 지금 조치해야 하는 유일한 항목 */}
                {appr?.status === 'ISSUE' && appr.comment && (
                  <div className="mt-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">문제 제기: {appr.comment}</div>
                )}

                {/*
                  요청이 열려 있는 동안 **상태와 무관하게** 항상 눌릴 수 있어야 한다.
                  금액을 고치면 저장만으로도 자동 재요청되지만, 고친 뒤에 한 번 더 확실히 알리고 싶을 때
                  (또는 고칠 게 없어 '문제 제기'만 풀어야 할 때) 갤러리가 직접 누를 수단이 필요하다.
                  상태별로 버튼을 감췄더니, 금액을 고쳐 PENDING 이 된 순간 버튼이 사라져 다시 보낼 길이 없었다.
                */}
                {requested && !settled && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => reaskMutation.mutate(a.user.id)}
                      disabled={reaskMutation.isPending}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw size={12} /> 이 작가에게 다시 확인 요청
                    </button>
                  </div>
                )}

                {open && (
                  <>
                    {a.works.length === 0 ? (
                      <p className="text-xs text-gray-500 mt-3">등록된 출품작이 없습니다.</p>
                    ) : (
                      <div className="space-y-2 mt-3">
                        {/* 모바일: 결제수단·판매가를 둘째 줄로 접기 — 한 줄이면 고정폭 컨트롤(~190px)만으로 375px 초과 */}
                        {a.works.map((w, wi) => (
                          <div key={wi} className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-2 rounded-lg border ${w.sold ? 'border-gray-300 bg-gray-50' : 'border-gray-100'}`}>
                            <input type="checkbox" checked={w.sold} disabled={locked} onChange={e => updWork(ai, wi, { sold: e.target.checked })} className="shrink-0 disabled:opacity-50" />
                            {/* 작품 사진 */}
                            {w.image ? (
                              <Thumb src={w.image} alt="" className="w-14 h-14 object-cover rounded shrink-0" />
                            ) : (
                              <div className="w-14 h-14 rounded bg-gray-100 flex items-center justify-center shrink-0"><ImageOff size={16} className="text-gray-300" /></div>
                            )}
                            {/* 작품 정보 */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{w.title || '(제목 없음)'}</p>
                              <p className="text-xs text-gray-500 truncate">{[w.size, w.medium, w.year].filter(Boolean).join(' · ')}{w.listPrice ? ` · 희망 ${w.listPrice}` : ''}</p>
                            </div>
                            {/* 판매가 + 결제수단(카드/현금) */}
                            {w.sold && (
                              <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto sm:shrink-0">
                                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
                                  <button type="button" disabled={locked} onClick={() => updWork(ai, wi, { paymentMethod: 'CARD' })}
                                    className={`px-2 py-1 disabled:opacity-60 ${w.paymentMethod !== 'CASH' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}>카드</button>
                                  <button type="button" disabled={locked} onClick={() => updWork(ai, wi, { paymentMethod: 'CASH' })}
                                    className={`px-2 py-1 disabled:opacity-60 ${w.paymentMethod === 'CASH' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}>현금</button>
                                </div>
                                <input type="text" inputMode="numeric" disabled={locked} value={w.soldPrice ? w.soldPrice.toLocaleString('ko') : ''}
                                  onChange={e => updWork(ai, wi, { soldPrice: parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0 })}
                                  placeholder="판매가" className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right disabled:bg-gray-100" />
                                <span className="text-xs text-gray-500">원</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100 text-sm">
                      <span className="text-gray-500">판매 합계 <b className="text-gray-900">{won(t.total)}</b></span>
                      {/* 수수료는 뗀 사실과 금액이 같이 보여야 한다 — 작가가 "왜 줄었냐" 물을 때 답이 화면에 있어야 한다 */}
                      {t.cardFee > 0 && (
                        <>
                          <span className="text-gray-500">카드 수수료 <b className="text-gray-900">-{won(t.cardFee)}</b></span>
                          <span className="text-gray-500">정산 대상 <b className="text-gray-900">{won(t.settleBase)}</b></span>
                        </>
                      )}
                      <span className="flex items-center gap-1">
                        갤러리
                        <input type="number" min={0} max={100} disabled={locked} value={a.galleryRatio} onChange={e => updRatio(ai, parseInt(e.target.value) || 0)} className="w-14 px-1.5 py-0.5 border border-gray-200 rounded text-sm text-right disabled:bg-gray-100" />%
                        <span className="text-gray-500">: 작가 {100 - a.galleryRatio}%</span>
                      </span>
                      <span className="text-gray-500">갤러리 <b className="text-gray-900">{won(t.galleryAmount)}</b></span>
                      <span className="text-gray-500">작가 <b className="text-gray-900">{won(t.artistAmount)}</b></span>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* 전체 합계 */}
          <div className="border border-gray-300 rounded-xl p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-900 mb-1">전체 정산</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
              <span>판매 작품 <b className="text-gray-900">{grand.soldCount}점</b></span>
              <span>판매 합계 <b className="text-gray-900">{won(grand.total)}</b></span>
              {(grand.cardFee ?? 0) > 0 && (
                <>
                  <span>카드 수수료 <b className="text-gray-900">-{won(grand.cardFee ?? 0)}</b></span>
                  <span>정산 대상 <b className="text-gray-900">{won(grand.settleBase ?? 0)}</b></span>
                </>
              )}
              <span>갤러리 합계 <b className="text-gray-900">{won(grand.galleryAmount)}</b></span>
              <span>작가 지급 합계 <b className="text-gray-900">{won(grand.artistAmount)}</b></span>
            </div>
          </div>
        </div>
      )}
      {!settled && !requested && (
        <p className="text-xs text-gray-500 mt-2">* 비율·판매가 변경 후 [정산 저장]을 눌러 보관하세요. <b>[정산 확인 요청]</b>을 누르면 아직 수락하지 않았거나 <b>금액이 바뀐 작가에게만</b> 요청이 가고, 전원 수락 시 <b>[정산 완료]</b>가 가능합니다.</p>
      )}
      {requested && !settled && (
        <p className="text-xs text-gray-500 mt-2">* 작가가 검토 중입니다. <b>요청을 내리지 않고 바로 고쳐도 됩니다</b> — 금액을 바꾼 작가만 다시 확인 대상이 되고 그 사람에게만 알림이 갑니다. 나머지 작가의 검토와 이미 받은 수락은 그대로 이어집니다. [요청 취소]는 정산 전체를 작가들에게서 다시 감출 때만 쓰세요.</p>
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
