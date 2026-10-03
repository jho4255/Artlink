/**
 * 정산 구역 (갤러리 오너 / Admin) — 전시 종료 후 판매 기록 · 비율 · 작가 확인 · 완료
 *
 * ── 왜 공용 컴포넌트인가 ────────────────────────────────────
 * `OperationPage`(신규 뷰)와 `OperationClassicPage`(클래식 뷰)에 **완전히 같은 코드가 복붙**돼 있었다.
 * 정산은 돈을 다루는 화면이라 두 벌이 갈라지면 한쪽에서만 금액 규칙이 어긋나도 조용히 지나간다.
 *
 * ── 2026-09-29 개편 ─────────────────────────────────────────
 * 머리 버튼이 최대 일곱 개(정산 저장·확인 요청·전체 PDF·현금·카드·요청 취소·정산 완료)였고, 같은 기능이 오른쪽
 * '운영 도우미'에 또 있었다. 절차 설명은 맨 아래 회색 작은 글씨에만 있었다. 그래서
 *  ① 맨 위에 **정산 단계**(판매 입력 → 작가 확인 → 정산 완료)와 지금 할 일 한 문장
 *  ② 버튼은 **상황별 주 버튼 하나**(확인 요청 / 변경 저장 / 정산 완료) + 보조
 *  ③ PDF 세 종류는 [정산서 ▾] 하나로
 *  ④ 요청 전 검사 — 판매가 있는데 갤러리 비율이 0% 인 작가가 있으면 확인창(기본값이 0% 라 그대로 요청되던 일)
 *  ⑤ 미응답 작가 재안내 DM 을 여기로(예전엔 운영 도우미 상자 안)
 *
 * ── 작가별 접기/열기 ────────────────────────────────────────
 * 단체전은 작가 10명 × 출품작 여러 점이라 다 펼치면 화면이 수십 개 행으로 덮인다.
 * 그래서 기본은 접고(`initialOpenArtistIds`), 접힌 줄에도 **[판매 입력]** 을 둔다 — 예전엔 접혀 있으면
 * 판매 체크박스가 보이지 않아 "어디서 판매를 입력하지?" 가 됐다.
 *  · 작가가 2명 이하면 펼친 채로 시작한다
 *  · **문제를 제기한 작가는 항상 펼쳐서 시작한다** — 갤러리가 지금 봐야 하는 건 정확히 그 사람이다
 *
 * ── 부분 재확인 (backend/src/lib/settlementFingerprint.ts) ──
 * 서버가 **금액이 바뀐 작가만** 재확인 대상으로 돌린다. 화면은 그 결과를 숫자로 알려준다
 * (저장 시 `resetCount`, 재요청 시 `requestedCount`/`keptCount`).
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileDown, ImageOff, ChevronDown, RotateCcw, Megaphone } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { nameWithNickname, cn } from '@/lib/utils';
import { openArtLook, type ArtLookWork } from '@/lib/artlook';
import { won, artistTotals, initialOpenArtistIds, settlementFormSignature, type EditArtist, type EditWork } from '@/lib/settlement';
import ProgressSteps from '@/components/flow/ProgressSteps';
import StatusChip from '@/components/flow/StatusChip';
import Notice from '@/components/flow/Notice';
import MenuButton from '@/components/flow/MenuButton';
import DmComposeModal from '@/components/operation/DmComposeModal';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import type { Settlement, SettlementArtist } from '@/types';

/** 정산 입력을 저장하지 않고 떠날 때 — 페이지 이동·카드 접기 모두 이 문구로 묻는다 */
const UNSAVED_SETTLEMENT = [
  '저장하지 않은 정산 입력이 있습니다.',
  '이 페이지를 벗어나면 작성 중인 내용이 사라집니다.',
  '',
  '그래도 나가시겠습니까?',
].join('\n');

/** 희망가 — 숫자만 적혀 있으면 '1,500,000원', 그 밖(비매·협의)은 적힌 그대로 */
function listPriceText(v: string): string {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? `${Number(t).toLocaleString('ko')}원` : t;
}

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

/** 작가 확인 상태 칩 — 요청 중이 아니어도 '이미 수락함' 은 보여준다(재요청해도 유지되는 정보라 중요) */
function ApprovalChip({ status, autoApproved }: { status?: string; autoApproved?: boolean }) {
  // 자동 수락은 사람이 누른 수락과 반드시 구분해서 보여준다 — 나중에 다툼이 생기면 이 구분이 근거다
  if (status === 'APPROVED' && autoApproved) return <StatusChip variant="done">자동 수락</StatusChip>;
  if (status === 'APPROVED') return <StatusChip variant="done">확인함</StatusChip>;
  if (status === 'ISSUE') return <StatusChip variant="attention">이의 있음</StatusChip>;
  if (status === 'PENDING') return <StatusChip>확인 대기</StatusChip>;
  return null;
}

const longDate = (v: string) => new Date(v).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

export default function SettlementSection({ exhibitionId, isAdmin, className = '' }: { exhibitionId: string; isAdmin?: boolean; className?: string }) {
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
  /** 판매가 있는데 갤러리 몫이 0% 인 작가 — 요청 전 확인창 */
  const [zeroRatio, setZeroRatio] = useState<string[] | null>(null);
  const [remindOpen, setRemindOpen] = useState(false);
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
  const unanswered = data?.artists.filter(x => (x.approval?.status || 'PENDING') === 'PENDING') ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['operation-settlement', exhibitionId] });
    qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] });
    qc.invalidateQueries({ queryKey: ['my-operation-overview'] });
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
  const reminderMutation = useMutation({
    mutationFn: (payload: { subject: string; content: string }) => api.post(`/operations/${exhibitionId}/settlement/reminders`, payload),
    onSuccess: (res: any) => { toast.success(`정산 확인 재안내를 ${res.data.sentCount}명에게 보냈습니다.`); setRemindOpen(false); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '재안내를 보내지 못했습니다.'),
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
  const setOpen = (uid: number, open: boolean) => setOpenIds(prev => {
    const next = new Set(prev ?? []);
    if (open) next.add(uid); else next.delete(uid);
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
  // 저장 전에 떠나면 묻는다(2026-10-03 점검 P1-2) — 예전엔 판매가를 적다가 카드의 다른 탭을 누르거나 메뉴로 가면 경고 없이 사라졌다
  useUnsavedChanges(dirty && !locked, UNSAVED_SETTLEMENT);

  /**
   * 판매에 체크했는데 판매가가 비었는가 — 0원으로 작가에게 확인 요청이 나가던 것(점검 P2-12). 서버도 400 으로 막는다.
   * 그 작가를 펼치고 칸을 빨갛게 보여 준다.
   */
  const [priceMissing, setPriceMissing] = useState<Set<string>>(new Set());
  const checkPrices = (): boolean => {
    const missing = new Set<string>();
    artists.forEach(a => a.works.forEach(w => { if (w.sold && !(w.soldPrice > 0)) missing.add(`${a.user.id}:${w.index}`); }));
    setPriceMissing(missing);
    if (missing.size === 0) return true;
    const ids = new Set([...missing].map(k => Number(k.split(':')[0])));
    setOpenIds(prev => new Set([...(prev ?? []), ...ids]));
    toast.error('판매에 체크한 작품의 판매가를 적어 주세요.');
    return false;
  };

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
      const { missing } = await downloadArtistSettlementPdf(s.exhibitionTitle, s.artists[ai]!, method, undefined, { cardFeeRate: feeNum });
      if (missing.length > 0) toast.error(`작품 이미지 ${missing.length}건이 빠졌습니다: ${missing.slice(0, 3).join(', ')}`, { duration: 8000 });
    } catch { toast.error('PDF 생성 실패'); } finally { setZipping(false); }
  };

  /** [작가에게 확인 요청] — 갤러리 몫 0% 로 판매가 잡힌 작가가 있으면 먼저 묻는다(기본값이 0% 라 모르고 요청되던 일) */
  const askRequest = () => {
    if (!checkPrices()) return;
    const zero = artists.filter(a => a.galleryRatio === 0 && a.works.some(w => w.sold)).map(a => nameWithNickname(a.user));
    if (zero.length) { setZeroRatio(zero); return; }
    requestMutation.mutate();
  };

  if (isLoading) return <div className={cn('h-32 animate-pulse rounded-xl bg-gray-100', className)} />;

  const grand = buildSettlement().grand;
  // ArtLook 홍보용: 판매 체크 + 이미지가 있는 작품들
  const soldWorks: ArtLookWork[] = artists.flatMap(a => a.works.filter(w => w.sold && w.image).map(w => ({ url: w.image as string, title: w.title || '', artist: nameWithNickname(a.user), exhibition: exTitle, kind: 'sold' as const })));

  const artistCount = data?.artists.length ?? 0;
  const issueCount = data?.artists.filter(x => x.approval?.status === 'ISSUE').length ?? 0;
  // 작가가 모두 확인했으면 '작가 확인' 단계는 끝난 것이다 — 예전엔 요청 중이기만 하면 '확인하고 있어요' 였다(2026-09-29 지적)
  const stepNow = settled ? 3 : requested && allApproved ? 2 : requested ? 1 : 0;
  const stepText = settled
    ? `정산이 끝났어요${data?.settledAt ? ` · ${longDate(data.settledAt)}` : ''}. 참여 작가에게 정산 내역이 공유되었어요.${isAdmin ? ' 관리자는 완료 뒤에도 고칠 수 있어요.' : ''}`
    : requested && allApproved
      ? (dirty
        ? `작가 ${artistCount}명 모두 확인했지만, 저장 안 된 변경이 있어요. 저장하면 금액이 바뀐 작가에게만 다시 확인 요청이 가요.`
        : `작가 ${artistCount}명 모두 금액을 확인했어요. [정산 완료]를 누르면 정산이 확정되고 작가에게 정산 내역이 공유돼요.`)
      : requested
        ? `${issueCount > 0 ? `작가 ${issueCount}명이 이의를 남겼어요 — 작가 줄의 사유를 보고 금액을 고치면 그 작가에게만 다시 확인 요청이 가요. ` : '작가들이 금액을 확인하고 있어요. '}지금 ${approvedCount}/${artistCount}명 확인. 요청 중에도 금액을 고칠 수 있고, 기한 안에 응답이 없으면 자동으로 수락돼요.`
        : '팔린 작품에 체크하고 판매가·결제 방법을 적은 뒤, 갤러리:작가 비율을 확인하고 작가에게 확인을 요청하세요. 판매가 없어도 요청해야 정산을 마칠 수 있어요.';

  // 상황별 주 버튼 하나
  const primary: { label: string; onClick: () => void; busy: boolean; disabled?: boolean } | null = locked ? null
    : settled ? (dirty ? { label: '변경 저장', onClick: () => { if (checkPrices()) saveMutation.mutate(); }, busy: saveMutation.isPending } : null)
      : !requested ? { label: '작가에게 확인 요청', onClick: askRequest, busy: requestMutation.isPending, disabled: artists.length === 0 }
        : dirty ? { label: '변경 저장', onClick: () => { if (checkPrices()) saveMutation.mutate(); }, busy: saveMutation.isPending }
          : allApproved ? { label: '정산 완료', onClick: () => setConfirmOpen(true), busy: completeMutation.isPending }
            : null;

  return (
    <section className={cn('space-y-5', className)}>
      <div>
        <ProgressSteps steps={['판매 입력', '작가 확인', '정산 완료']} current={stepNow} label="정산 단계" className="max-w-sm" />
        <p className="mt-4 text-sm leading-relaxed text-gray-600">{stepText}</p>
      </div>

      {/* 요청은 끝났는데 수락 기록이 남아 있는 상태 — 다시 요청해도 이 사람들은 건너뛴다 */}
      {!requested && !settled && approvedCount > 0 && (
        <Notice>
          이미 <b className="font-medium text-gray-900">{approvedCount}명</b>이 확인한 상태예요. 금액을 고치지 않은 작가는 다시 요청해도 확인이 유지되고, 금액이 바뀐 작가에게만 요청이 가요.
        </Notice>
      )}

      {/* 도구 줄 — 주 버튼 하나 · 보조 · 정산서 */}
      <div className="flex flex-wrap items-center gap-2">
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={primary.busy || primary.disabled}
            className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {primary.busy ? '처리 중…' : primary.label}
          </button>
        )}
        {!locked && !requested && !settled && dirty && (
          <button type="button" onClick={() => { if (checkPrices()) saveMutation.mutate(); }} disabled={saveMutation.isPending} className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            저장만 하기
          </button>
        )}
        {requested && !settled && !dirty && unanswered.length > 0 && (
          <button type="button" onClick={() => setRemindOpen(true)} className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-50">
            미응답 {unanswered.length}명에게 다시 알리기
          </button>
        )}
        {requested && !settled && (
          // 취소·완료는 값을 보내는 게 아니라 확정/철회다. 저장 안 된 변경이 있으면
          // ①취소는 새로고침하며 입력을 날리고 ②완료는 옛 금액으로 확정된다 — 그래서 먼저 막는다
          <button
            type="button"
            onClick={() => dirty ? toast.error('저장 안 된 변경이 있습니다. [변경 저장] 후 취소하세요.') : cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            title="정산 내역을 작가들에게서 다시 감춥니다"
            className="min-h-[44px] px-2 text-sm text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline disabled:opacity-50"
          >
            요청 취소
          </button>
        )}
        {dirty && !locked && <StatusChip variant="attention">저장 안 된 변경</StatusChip>}
        <MenuButton
          className="ml-auto"
          label="정산서"
          icon={<FileDown size={13} aria-hidden />}
          busyLabel={zipping ? '만드는 중…' : null}
          items={[
            { label: '전체 정산서 PDF', hint: '작가별 판매·정산 금액', onSelect: () => downloadOverall() },
            { label: '현금 정산서', hint: '현금으로 판 작품만', onSelect: () => downloadOverall('CASH') },
            { label: '카드 정산서', hint: '카드로 판 작품만', onSelect: () => downloadOverall('CARD') },
          ]}
        />
      </div>

      {/*
        카드 수수료율 — 전시 하나에 하나. 카드로 팔린 금액에서 먼저 떼고 남은 금액을 비율로 나눈다.
        여기 값을 고치면 **카드 판매가 있는 작가만** 수락이 풀린다(현금으로만 판 작가는 금액이 안 변하므로 유지).
      */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-gray-50 px-4 py-3">
          <label htmlFor={`card-fee-${exhibitionId}`} className="shrink-0 text-sm font-medium text-gray-900">카드 수수료</label>
          <span className="inline-flex items-center gap-1.5">
            <input
              id={`card-fee-${exhibitionId}`} type="number" inputMode="decimal" step="0.01" min="0" max="100"
              value={feeRate}
              onChange={e => setFeeRate(e.target.value)}
              onBlur={() => setFeeRate(String(feeNum))}
              className="min-h-[36px] w-20 rounded-lg border border-gray-300 bg-white px-2 text-right text-sm tabular-nums"
            />
            <span className="text-sm text-gray-600">%</span>
          </span>
          <span className="min-w-0 text-xs text-gray-500">
            {grand.cardFee ? <>카드 {won(grand.cardTotal ?? 0)} 중 <b className="text-gray-900">{won(grand.cardFee)}</b> 공제 · </> : null}
            카드 판매에서 먼저 떼고 남은 금액을 비율로 나눠요. 현금 판매엔 붙지 않아요.
          </span>
        </div>
      )}

      {artists.length === 0 ? (
        <p className="text-sm text-gray-400">수락된 작가가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {artists.length > 1 && (
            <div className="flex justify-end">
              <button type="button" onClick={toggleAll} className="min-h-[32px] px-1 text-xs text-gray-500 hover:text-gray-900">
                {allOpen ? '모두 접기' : '모두 펼치기'}
              </button>
            </div>
          )}
          <ul className="space-y-2">
            {artists.map((a, ai) => {
              const t = artistTotals(a, feeNum);
              const appr = approvalOf(a.user.id);
              const open = isOpen(a.user.id);
              const soldCount = a.works.filter(w => w.sold).length;
              const name = nameWithNickname(a.user);
              return (
                <li key={a.user.id} className="rounded-xl border border-gray-200">
                  {/*
                    모바일에서는 토글이 **한 줄을 다 쓰고** 정산서 메뉴가 아래로 내려간다.
                    한 줄에 이름·배지·요약·버튼을 다 밀어 넣었더니 375px 에서 이름이 '한' 한 글자로 뭉개졌다(실측).
                  */}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setOpen(a.user.id, !open)}
                      aria-expanded={open}
                      className="flex min-h-[44px] w-full min-w-0 items-center gap-2 text-left sm:w-auto sm:flex-1"
                    >
                      <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-gray-400 transition-transform', !open && '-rotate-90')} />
                      <span className="truncate text-sm font-medium text-gray-900">{name}</span>
                      <ApprovalChip status={appr?.status} autoApproved={appr?.autoApproved} />
                      {!open && (
                        <span className="min-w-0 truncate text-xs text-gray-500">
                          {soldCount > 0 ? `판매 ${soldCount}점 · ${won(t.total)} · 작가 ${won(t.artistAmount)}` : '판매 없음'}
                        </span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {!open && !locked && soldCount === 0 && a.works.length > 0 && (
                        <button type="button" onClick={() => setOpen(a.user.id, true)} className="min-h-[36px] px-1 text-xs font-medium text-gray-700 underline-offset-4 hover:underline">판매 입력</button>
                      )}
                      <MenuButton
                        label="정산서"
                        icon={<FileDown size={13} aria-hidden />}
                        busyLabel={zipping ? '만드는 중…' : null}
                        items={[
                          { label: `${name} 정산서 PDF`, onSelect: () => downloadArtist(ai) },
                          { label: '현금 정산서', onSelect: () => downloadArtist(ai, 'CASH') },
                          { label: '카드 정산서', onSelect: () => downloadArtist(ai, 'CARD') },
                        ]}
                      />
                    </div>
                  </div>

                  {(appr?.status === 'PENDING' && appr.autoApproveAt) || (appr?.status === 'ISSUE' && appr.comment) || (requested && !settled) ? (
                    <div className="space-y-2 px-4 pb-3">
                      {/* 언제까지 기다리면 되는지 — 갤러리도 알아야 [정산 완료] 시점을 잡는다 */}
                      {appr?.status === 'PENDING' && appr.autoApproveAt && (
                        <p className="text-xs text-gray-500">{longDate(appr.autoApproveAt)}까지 응답이 없으면 자동 수락돼요.</p>
                      )}
                      {/* 문제 제기는 접혀 있어도 보여준다 — 갤러리가 지금 조치해야 하는 유일한 항목 */}
                      {appr?.status === 'ISSUE' && appr.comment && (
                        <Notice tone="attention" title="작가가 남긴 이의">{appr.comment}</Notice>
                      )}
                      {/*
                        요청이 열려 있는 동안 **상태와 무관하게** 항상 눌릴 수 있어야 한다.
                        금액을 고치면 저장만으로도 자동 재요청되지만, 고친 뒤에 한 번 더 확실히 알리고 싶을 때
                        (또는 고칠 게 없어 '문제 제기'만 풀어야 할 때) 갤러리가 직접 누를 수단이 필요하다.
                      */}
                      {requested && !settled && (
                        <button
                          type="button"
                          onClick={() => { if (checkPrices()) reaskMutation.mutate(a.user.id); }}
                          disabled={reaskMutation.isPending}
                          className="inline-flex min-h-[32px] items-center gap-1 text-xs text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline disabled:opacity-50"
                        >
                          <RotateCcw size={12} aria-hidden /> 이 작가에게 다시 확인 요청
                        </button>
                      )}
                    </div>
                  ) : null}

                  {open && (
                    <div className="border-t border-gray-100 px-4 py-3">
                      {a.works.length === 0 ? (
                        <p className="text-xs text-gray-500">등록된 출품작이 없어요.</p>
                      ) : (
                        <ul className="space-y-2">
                          {/* 모바일: 결제수단·판매가를 둘째 줄로 접기 — 한 줄이면 고정폭 컨트롤(~190px)만으로 375px 초과 */}
                          {a.works.map((w, wi) => (
                            <li key={wi} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-2', w.sold ? 'border-gray-300 bg-gray-50' : 'border-gray-100')}>
                              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                                <input type="checkbox" checked={w.sold} disabled={locked} onChange={e => updWork(ai, wi, { sold: e.target.checked })} className="h-4 w-4 shrink-0 disabled:opacity-50" aria-label={`${w.title || '작품'} 판매됨`} />
                                {w.image ? (
                                  <Thumb src={w.image} alt="" className="h-14 w-14 shrink-0 rounded bg-white object-contain" />
                                ) : (
                                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded bg-gray-100"><ImageOff size={16} className="text-gray-300" aria-hidden /></span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-gray-900">{w.title || '(제목 없음)'}</span>
                                  <span className="block truncate text-xs text-gray-500">{[w.size, w.medium, w.year].filter(Boolean).join(' · ')}{w.listPrice ? ` · 희망가 ${listPriceText(w.listPrice)}` : ''}</span>
                                </span>
                              </label>
                              {/* 판매가 + 결제수단(카드/현금) — 누르는 곳 40px(2026-10-03 기하 하니스: 32px 였다) */}
                              {w.sold && (
                                <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto sm:shrink-0">
                                  <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs" role="group" aria-label="결제 방법">
                                    <button type="button" disabled={locked} onClick={() => updWork(ai, wi, { paymentMethod: 'CARD' })} aria-pressed={w.paymentMethod !== 'CASH'}
                                      className={cn('min-h-[40px] px-3 disabled:opacity-60', w.paymentMethod !== 'CASH' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500')}>카드</button>
                                    <button type="button" disabled={locked} onClick={() => updWork(ai, wi, { paymentMethod: 'CASH' })} aria-pressed={w.paymentMethod === 'CASH'}
                                      className={cn('min-h-[40px] px-3 disabled:opacity-60', w.paymentMethod === 'CASH' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500')}>현금</button>
                                  </div>
                                  <input type="text" inputMode="numeric" disabled={locked} value={w.soldPrice ? w.soldPrice.toLocaleString('ko') : ''}
                                    onChange={e => { updWork(ai, wi, { soldPrice: parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0 }); setPriceMissing(prev => { const k = `${a.user.id}:${w.index}`; if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; }); }}
                                    placeholder="판매가" aria-label="판매가" aria-invalid={priceMissing.has(`${a.user.id}:${w.index}`) || undefined}
                                    className={cn('min-h-[40px] w-28 rounded-lg border bg-white px-2 text-right text-sm tabular-nums disabled:bg-gray-100', priceMissing.has(`${a.user.id}:${w.index}`) ? 'border-accent bg-accent/5' : 'border-gray-300')} />
                                  <span className="text-xs text-gray-500">원</span>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3 text-sm">
                        <span className="text-gray-500">판매 합계 <b className="font-medium tabular-nums text-gray-900">{won(t.total)}</b></span>
                        {/* 수수료는 뗀 사실과 금액이 같이 보여야 한다 — 작가가 "왜 줄었냐" 물을 때 답이 화면에 있어야 한다 */}
                        {t.cardFee > 0 && (
                          <>
                            <span className="text-gray-500">카드 수수료 <b className="font-medium tabular-nums text-gray-900">-{won(t.cardFee)}</b></span>
                            <span className="text-gray-500">정산 대상 <b className="font-medium tabular-nums text-gray-900">{won(t.settleBase)}</b></span>
                          </>
                        )}
                        <span className="flex items-center gap-1 text-gray-500">
                          갤러리
                          <input type="number" min={0} max={100} disabled={locked} value={a.galleryRatio} onChange={e => updRatio(ai, parseInt(e.target.value) || 0)} aria-label="갤러리 비율(%)" className="min-h-[32px] w-16 rounded-lg border border-gray-300 px-1.5 text-right text-sm tabular-nums text-gray-900 disabled:bg-gray-100" />%
                          <span>: 작가 {100 - a.galleryRatio}%</span>
                        </span>
                        <span className="text-gray-500">갤러리 <b className="font-medium tabular-nums text-gray-900">{won(t.galleryAmount)}</b></span>
                        <span className="text-gray-500">작가 <b className="font-medium tabular-nums text-gray-900">{won(t.artistAmount)}</b></span>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* 전체 합계 */}
          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">전체</p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
              <span>판매 <b className="font-medium tabular-nums text-gray-900">{grand.soldCount}점</b></span>
              <span>판매 합계 <b className="font-medium tabular-nums text-gray-900">{won(grand.total)}</b></span>
              {(grand.cardFee ?? 0) > 0 && (
                <>
                  <span>카드 수수료 <b className="font-medium tabular-nums text-gray-900">-{won(grand.cardFee ?? 0)}</b></span>
                  <span>정산 대상 <b className="font-medium tabular-nums text-gray-900">{won(grand.settleBase ?? 0)}</b></span>
                </>
              )}
              <span>갤러리 <b className="font-medium tabular-nums text-gray-900">{won(grand.galleryAmount)}</b></span>
              <span>작가 지급 <b className="font-medium tabular-nums text-gray-900">{won(grand.artistAmount)}</b></span>
            </div>
          </div>
        </div>
      )}

      {/* 판매작 홍보 — ArtLook 연결 */}
      {soldWorks.length > 0 && (
        <button
          type="button"
          onClick={() => { if (openArtLook(soldWorks) === 0) toast.error('홍보할 판매 작품 이미지가 없습니다.'); }}
          className="inline-flex min-h-[40px] items-center gap-1.5 text-sm text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline"
        >
          <Megaphone size={15} aria-hidden /> 판매된 {soldWorks.length}점으로 ArtLook 홍보 이미지 만들기
        </button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="정산을 완료할까요?"
        details={[
          '모든 참여 작가가 정산을 확인했어요.',
          '완료하면 운영 화면을 더 이상 고칠 수 없어요.',
          '정산 내역이 참여 작가에게 최종 공유되며, 되돌릴 수 없어요.',
        ]}
        confirmText="동의하고 정산 완료"
        onConfirm={() => { setConfirmOpen(false); completeMutation.mutate(); }}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmDialog
        open={!!zeroRatio}
        title="갤러리 몫이 0%인 작가가 있어요"
        details={[
          `${(zeroRatio ?? []).join(', ')} — 판매 금액이 모두 작가 몫으로 계산돼요.`,
          '맞으면 그대로 요청하고, 아니면 작가를 펼쳐 갤러리 비율을 고친 뒤 요청하세요.',
        ]}
        cancelText="비율 고치기"
        confirmText="그대로 요청"
        onConfirm={() => { setZeroRatio(null); requestMutation.mutate(); }}
        onCancel={() => {
          // 고치러 가게 — 해당 작가들을 펼친다
          const names = new Set(zeroRatio ?? []);
          setOpenIds(prev => new Set([...(prev ?? []), ...artists.filter(a => names.has(nameWithNickname(a.user))).map(a => a.user.id)]));
          setZeroRatio(null);
        }}
      />
      {remindOpen && (
        <DmComposeModal
          open={remindOpen}
          title="정산 확인 다시 알리기"
          description="아직 응답하지 않은 작가에게 1:1 메시지로 보내요. 문구는 고쳐서 보낼 수 있어요."
          recipients={unanswered.map(a => ({ id: a.user.id, name: nameWithNickname(a.user), note: a.approval?.autoApproveAt ? `${longDate(a.approval.autoApproveAt)} 자동 수락` : undefined }))}
          defaultSubject={`[${exTitle}] 정산 확인 부탁드립니다`}
          defaultContent={[
            `안녕하세요. ${exTitle} 운영팀입니다.`,
            '',
            '정산 내역 확인 요청을 다시 안내드립니다.',
            '마이페이지 [내 전시]에서 정산 금액을 확인한 뒤 수락하거나 문제를 남겨 주세요.',
            '',
            `바로가기: ${window.location.origin}/mypage?tab=applications&ex=${exhibitionId}`,
          ].join('\n')}
          sending={reminderMutation.isPending}
          sendLabel={(n) => `${n}명에게 다시 알리기`}
          onSend={(v) => reminderMutation.mutate(v)}
          onClose={() => setRemindOpen(false)}
        />
      )}
    </section>
  );
}
