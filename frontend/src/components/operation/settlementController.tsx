/**
 * 정산 상태·동작 — `useSettlementController` (2026-11-20, 규칙 88). 그리기는 `SettlementSection.tsx`.
 * 공모 한 건 화면이 이걸 쥐고 할 일 줄의 주 버튼과 정산 탭(표)에 같이 넘긴다.
 * 컴포넌트 파일과 나눠 둔다 — 한 파일에서 컴포넌트와 훅을 함께 내보내면 개발 중 빠른 새로고침이 파일째 다시 불러와
 * 적고 있던 판매가가 날아간다(lib/settlement.ts 와 같은 이유).
 * 바꾸지 않은 규칙(규칙 26)은 `SettlementSection.tsx` 머리말 참고.
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { thumbUrl } from '@/components/shared/Thumb';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { nameWithNickname } from '@/lib/utils';
import type { ArtLookWork } from '@/lib/artlook';
import { artistTotals, settlementFormSignature, type EditArtist, type EditWork } from '@/lib/settlement';
import type { ChipVariant } from '@/lib/flowLabels';
import DmComposeModal from '@/components/operation/DmComposeModal';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useAuthStore } from '@/stores/authStore';
import { stashKeys, takeAuthStash, useStashOnAuthLoss } from '@/lib/authStash';
import type { Settlement, SettlementArtist } from '@/types';

/** 정산 입력을 저장하지 않고 떠날 때 — 페이지 이동·탭 바꾸기 모두 이 문구로 묻는다 */
const UNSAVED_SETTLEMENT = [
  '저장하지 않은 정산 입력이 있습니다.',
  '이 페이지를 벗어나면 작성 중인 내용이 사라집니다.',
  '',
  '그래도 나가시겠습니까?',
].join('\n');

/** 희망가 — 숫자만 적혀 있으면 '1,500,000', 그 밖(비매·협의)은 적힌 그대로 */
export function listPriceText(v: string): string {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? Number(t).toLocaleString('ko') : t;
}

export type Approval = {
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

export const longDate = (v: string) => new Date(v).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

/** 할 일 줄의 버튼 하나 */
export interface SettlementAction { label: string; onClick: () => void; busy?: boolean; disabled?: boolean }

export interface SettlementController {
  /** 정산 내역을 받지 못했다 */
  failed: boolean;
  retry: () => void;
  ready: boolean;
  data: SettlementData | undefined;
  artists: EditArtist[];
  exTitle: string;
  feeRate: string;
  setFeeRate: (v: string) => void;
  feeNum: number;
  dirty: boolean;
  locked: boolean;
  settled: boolean;
  requested: boolean;
  allApproved: boolean;
  approvalOf: (uid: number) => Approval;
  unansweredCount: number;
  approvedCount: number;
  issueArtists: { id: number; name: string; comment: string }[];
  /** 비율이 모두 같으면 그 값, 다르면 null */
  uniformRatio: number | null;
  perArtistRatio: boolean;
  setPerArtistRatio: (v: boolean) => void;
  setAllRatios: (ratio: number) => void;
  updWork: (ai: number, wi: number, patch: Partial<EditWork>) => void;
  updRatio: (ai: number, ratio: number) => void;
  priceMissing: Set<string>;
  clearPriceMissing: (key: string) => void;
  grand: Settlement['grand'];
  soldWorks: ArtLookWork[];
  zipping: boolean;
  downloadOverall: (method?: 'CARD' | 'CASH') => void;
  downloadArtist: (ai: number, method?: 'CARD' | 'CASH') => void;
  reask: (artistUserIds: number[]) => void;
  reasking: boolean;
  cancelRequest: () => void;
  cancelling: boolean;
  /** 할 일 줄 — 정산 단계에서 공모 한 건 화면이 이걸 그린다 */
  task: { text: string; tone: ChipVariant } | null;
  primary: SettlementAction | null;
  secondary: SettlementAction | null;
  /** 목록에서 [정산 완료]를 눌러 왔을 때 — 도착하자마자 확인창 */
  openComplete: () => void;
  openRemind: () => void;
  /** 화면 어딘가에 한 번 그릴 확인창·메시지 창 */
  dialogs: ReactNode;
}

/** 로그인이 풀릴 때 남겨 두는 정산 입력(lib/authStash) — 고칠 수 있는 칸만 */
type SettlementStash = {
  feeRate: string;
  artists: { id: number; galleryRatio: number; works: Pick<EditWork, 'index' | 'listPrice' | 'sold' | 'soldPrice' | 'paymentMethod'>[] }[];
};

export function useSettlementController(exhibitionId: string, { isAdmin = false, enabled = true }: { isAdmin?: boolean; enabled?: boolean } = {}): SettlementController {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<SettlementData>({
    queryKey: ['operation-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
    enabled,
  });
  const userId = useAuthStore((st) => st.user?.id);
  const [artists, setArtists] = useState<EditArtist[]>([]);
  /**
   * 로그인이 풀리기 전에 쓰던 입력(lib/authStash) — **처음 받은 값**에만 얹는다. 그 값(data 객체)을 함께 기억해, 같은 값으로
   * effect 가 다시 돌면(개발 모드 StrictMode) 다시 얹고, 그 뒤 새로 받은 값에는 얹지 않는다.
   */
  const restore = useRef<{ data: SettlementData; stash: SettlementStash | null } | null>(null);
  /** 사람이 이 화면에서 값을 고쳤는가 — 서버 값으로 다시 채울 때 지운다(아래 동기화) */
  const edited = useRef(false);
  const [exTitle, setExTitle] = useState('');
  /** 카드 결제 수수료율(%) — 전시 하나에 하나. 입력 중 '2.' 같은 상태를 허용해야 해서 문자열로 들고 있다 */
  const [feeRate, setFeeRate] = useState('0');
  const [zipping, setZipping] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 판매가 있는데 갤러리 몫이 0% 인 작가 — 요청 전 확인창 */
  const [zeroRatio, setZeroRatio] = useState<string[] | null>(null);
  const [remindOpen, setRemindOpen] = useState(false);
  /** 작가마다 비율을 따로 적는가 — 처음엔 서버 값이 다를 때만 켠다 */
  const [perArtistRatio, setPerArtistRatio] = useState<boolean | null>(null);
  const settled = !!data?.settled;
  const requested = !!data?.settlementRequested;
  const allApproved = !!data?.allApproved;
  // 정산 입력 잠금은 **완료된 뒤에만**. 확인 요청 중에도 고칠 수 있어야 한다 —
  // 한 작가의 문제를 고치자고 요청 전체를 내리면 검토 중이던 다른 작가의 화면까지 닫힌다.
  // 고치면 서버가 그 작가만 다시 확인 대상으로 돌리고 그 사람에게만 알림을 보낸다.
  const locked = settled && !isAdmin;
  const approvalOf = (uid: number): Approval => data?.artists.find(x => x.user.id === uid)?.approval ?? null;
  /** 정산을 확인하는 사람 — 회원 작가만(비회원 작가는 확인 요청을 받을 수 없다, 규칙 91) */
  const memberRows = (data?.artists ?? []).filter(x => !x.guest);
  const guestRows = (data?.artists ?? []).filter(x => !!x.guest);
  /** 확인 요청 중이 아니어도 남아 있는 수락 기록 — 재요청 시 그대로 유지된다 */
  const approvedCount = memberRows.filter(x => x.approval?.status === 'APPROVED').length;
  const unanswered = memberRows.filter(x => (x.approval?.status || 'PENDING') === 'PENDING');
  const issueArtists = memberRows.filter(x => x.approval?.status === 'ISSUE')
    .map(x => ({ id: x.user.id, name: nameWithNickname(x.user), comment: x.approval?.comment ?? '' }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['operation-settlement', exhibitionId] });
    qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] });
    qc.invalidateQueries({ queryKey: ['my-operation-overview'] });
  };
  // 입력 중인 문자열('', '2.')은 0으로 본다 — 계산·저장은 항상 숫자로만 한다
  const feeNum = Number(feeRate) || 0;
  /**
   * 화면에 입력된 내용을 서버에 쓴다. **보내는 동작은 전부 이걸 먼저 거친다** —
   * 예전엔 [이 작가에게 다시 확인 요청]이 저장을 안 해서, 금액을 고쳐도 작가에겐 옛 금액이 갔다(실제로 겪음).
   */
  function persist() {
    const sales = artists.flatMap(a => a.works.filter(w => w.sold).map(w => ({ artistUserId: a.user.id, artworkIndex: w.index, title: w.title, soldPrice: w.soldPrice || 0, paymentMethod: w.paymentMethod || 'CARD' })));
    const ratios = artists.map(a => ({ artistUserId: a.user.id, galleryRatio: a.galleryRatio }));
    return api.put(`/operations/${exhibitionId}/settlement`, { sales, ratios, cardFeeRate: feeNum });
  }

  const completeMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/complete`),
    onSuccess: () => { toast.success('정산을 완료했어요. 참여 작가에게 정산 내역이 공유돼요.'); setConfirmOpen(false); invalidate(); },
    onError: (e: any) => { toast.error(e.response?.data?.error || '정산 완료 실패'); invalidate(); },
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
    onError: (e: any) => { toast.error(e.response?.data?.error || '요청 실패'); invalidate(); },
  });
  /**
   * 그 작가(들)만 다시 확인 대상으로 — 이의를 받고 금액을 고쳐 보낼 때도, 고칠 게 없어 이의만 풀 때도 이걸 쓴다.
   * 저장이 이미 그 작가를 재확인 대상으로 돌리고 알림까지 보냈다면 또 부르지 않는다(알림 2번 방지).
   */
  const reaskMutation = useMutation({
    mutationFn: async (artistUserIds: number[]) => {
      const saved = dirtyRef.current ? await persist() : null;
      const resetIds: number[] = saved?.data?.resetIds ?? [];
      for (const id of artistUserIds) {
        if (!resetIds.includes(id)) await api.post(`/operations/${exhibitionId}/settlement/request/artist/${id}`);
      }
      return { savedFirst: !!saved, count: artistUserIds.length };
    },
    onSuccess: ({ savedFirst, count }: any) => {
      toast.success(`${savedFirst ? '저장하고 ' : ''}${count > 1 ? `${count}명에게` : '그 작가에게'} 다시 확인을 요청했어요.`);
      invalidate();
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || '요청 실패'); invalidate(); },
  });
  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/operations/${exhibitionId}/settlement/request/cancel`),
    onSuccess: (res: any) => {
      const kept = res.data?.keptCount ?? 0;
      toast.success(kept > 0 ? `요청을 취소했습니다. 이미 수락한 ${kept}명의 기록은 유지됩니다.` : '정산 확인 요청을 취소했습니다.');
      invalidate();
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || '취소 실패'); invalidate(); },
  });
  const reminderMutation = useMutation({
    mutationFn: (payload: { subject: string; content: string }) => api.post(`/operations/${exhibitionId}/settlement/reminders`, payload),
    onSuccess: (res: any) => { toast.success(`정산 확인 재안내를 ${res.data.sentCount}명에게 보냈습니다.`); setRemindOpen(false); invalidate(); },
    onError: (e: any) => { toast.error(e.response?.data?.error || '재안내를 보내지 못했습니다.'); invalidate(); },
  });

  useEffect(() => {
    if (!data) return;
    /*
      저장 안 한 입력이 있으면 서버 값으로 덮지 않는다(2026-11-20 신뢰성 점검 S7). 휴대폰 망이 끊겼다 붙으면 화면이 정산을
      다시 받는데(재연결 시 다시 받기), 그 사이 다른 작가가 확인해 값이 바뀌었으면 입력 중이던 판매가가 말없이 사라졌다.
      확인 상태(approvalOf·allApproved)는 data 에서 바로 읽으므로 덮지 않아도 최신이다. 저장하면 같아져 다시 따라간다.
      ⚠️ '사람이 고친 게 있을 때만'(edited) — 그냥 dirty 로만 막으면 다른 운영자가 바꾼 값을 영영 못 따라가고 옛 값이 '미저장'으로 보인다
    */
    if (edited.current && dirtyRef.current) return;
    edited.current = false;
    let next: EditArtist[] = data.artists.map(a => ({
      user: a.user,
      guest: !!a.guest,
      galleryRatio: a.galleryRatio,
      works: a.works.map(w => ({ index: w.index, title: w.title, image: w.image, size: w.size, medium: w.medium, year: w.year, listPrice: w.listPrice, sold: w.sold, soldPrice: w.soldPrice, paymentMethod: (w.paymentMethod || 'CARD') as 'CARD' | 'CASH' })),
    }));
    let fee = String(data.cardFeeRate ?? 0);
    /*
      로그인이 풀리기 전에 쓰던 입력이 이 기기에 남아 있으면 서버 값 위에 다시 얹는다(2026-11-21 O6, lib/authStash).
      작가·작품은 지금 서버 목록을 기준으로 맞춰 얹는다(그사이 작가가 빠졌으면 그 작가 몫은 버린다). 저장은 사람이 누른다 — 저장 안 된 변경으로 보인다.
      정산이 끝나 잠겼으면 버린다.
    */
    if (!restore.current) {
      const taken = takeAuthStash<SettlementStash>(userId, stashKeys.settlement(exhibitionId));
      restore.current = { data, stash: taken && !(data.settled && !isAdmin) ? taken : null };
    }
    const stash = restore.current.data === data ? restore.current.stash : null;
    if (stash) {
      const byId = new Map(stash.artists.map(a => [a.id, a]));
      next = next.map(a => {
        const st = byId.get(a.user.id);
        if (!st) return a;
        const works = new Map(st.works.map(w => [w.index, w]));
        return {
          ...a,
          galleryRatio: st.galleryRatio,
          works: a.works.map(w => { const sw = works.get(w.index); return sw ? { ...w, listPrice: sw.listPrice, sold: sw.sold, soldPrice: sw.soldPrice, paymentMethod: sw.paymentMethod } : w; }),
        };
      });
      fee = stash.feeRate;
      edited.current = true;
      toast('로그인이 풀리기 전에 쓰던 정산 입력을 되살렸어요. 저장해야 반영돼요.', { id: 'auth-stash-settlement', duration: 6000 });
    }
    setExTitle(data.exhibitionTitle);
    setFeeRate(fee);
    setArtists(next);
    // 작가마다 비율이 다르게 저장돼 있으면 작가별 칸을 연 채로(한 칸으로 덮으면 다른 비율이 조용히 사라진다)
    setPerArtistRatio(prev => prev ?? new Set(next.map(a => a.galleryRatio)).size > 1);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- userId·isAdmin 은 처음 한 번 되살릴 때만 본다

  const updWork = (ai: number, wi: number, patch: Partial<EditWork>) => {
    edited.current = true;
    setArtists(prev => prev.map((a, i) => i !== ai ? a : { ...a, works: a.works.map((w, j) => j === wi ? { ...w, ...patch } : w) }));
  };
  const clampRatio = (r: number) => Math.min(100, Math.max(0, r));
  const updRatio = (ai: number, ratio: number) => {
    edited.current = true;
    setArtists(prev => prev.map((a, i) => i === ai ? { ...a, galleryRatio: clampRatio(ratio) } : a));
  };
  const setAllRatios = (ratio: number) => { edited.current = true; setArtists(prev => prev.map(a => ({ ...a, galleryRatio: clampRatio(ratio) }))); };
  const setFee = (v: string) => { edited.current = true; setFeeRate(v); };
  const uniformRatio = artists.length > 0 && artists.every(a => a.galleryRatio === artists[0]!.galleryRatio) ? artists[0]!.galleryRatio : null;

  // 저장 안 된 변경이 있는가 — 화면 값과 서버 값을 같은 규칙으로 지문 비교.
  // ref 로도 들고 있는 이유: mutationFn 이 만들어질 때가 아니라 **클릭한 순간**의 값을 봐야 한다.
  const dirty = !!data && artists.length > 0
    && settlementFormSignature(artists, feeNum) !== settlementFormSignature(data.artists, data.cardFeeRate ?? 0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // 저장 전에 떠나면 묻는다(2026-10-03 점검 P1-2)
  useUnsavedChanges(enabled && dirty && !locked, UNSAVED_SETTLEMENT);
  // 로그인이 풀리면 이 입력을 이 기기에 남긴다 — 다시 로그인해 이 화면이 뜨면 위에서 되살린다(lib/authStash)
  useStashOnAuthLoss(enabled && !locked ? stashKeys.settlement(exhibitionId) : null, (): SettlementStash | null => (dirtyRef.current ? {
    feeRate,
    artists: artists.map(a => ({ id: a.user.id, galleryRatio: a.galleryRatio, works: a.works.map(w => ({ index: w.index, listPrice: w.listPrice, sold: w.sold, soldPrice: w.soldPrice, paymentMethod: w.paymentMethod })) })),
  } : null));

  /**
   * 판매에 체크했는데 판매가가 비었는가 — 0원으로 작가에게 확인 요청이 나가던 것(점검 P2-12). 서버도 400 으로 막는다.
   */
  const [priceMissing, setPriceMissing] = useState<Set<string>>(new Set());
  const clearPriceMissing = (k: string) => setPriceMissing(prev => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
  const checkPrices = (): boolean => {
    const missing = new Set<string>();
    artists.forEach(a => a.works.forEach(w => { if (w.sold && !(w.soldPrice > 0)) missing.add(`${a.user.id}:${w.index}`); }));
    setPriceMissing(missing);
    if (missing.size === 0) return true;
    toast.error('판매에 체크한 작품의 판매가를 적어 주세요.');
    window.setTimeout(() => document.querySelector('[data-price-missing]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
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
    onError: (e: any) => { toast.error(e.response?.data?.error || '저장 실패'); invalidate(); },
  });

  // 현재 편집 상태로 정산 객체 구성 (합계 · PDF)
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
  const save = () => { if (checkPrices()) saveMutation.mutate(); };
  const reask = (ids: number[]) => { if (ids.length && checkPrices()) reaskMutation.mutate(ids); };
  // 취소·완료는 값을 보내는 게 아니라 확정/철회다. 저장 안 된 변경이 있으면 ①취소는 새로고침하며 입력을 날리고 ②완료는 옛 금액으로 확정된다
  const cancelRequest = () => (dirty ? toast.error('저장 안 된 변경이 있습니다. 먼저 저장한 뒤 취소하세요.') : cancelMutation.mutate());
  const openComplete = () => (dirty ? toast.error('저장 안 된 변경이 있습니다. 먼저 저장하세요.') : setConfirmOpen(true));

  const grand = buildSettlement().grand;
  // ArtLook 홍보용: 판매 체크 + 이미지가 있는 작품들
  const soldWorks: ArtLookWork[] = artists.flatMap(a => a.works.filter(w => w.sold && w.image).map(w => ({ url: w.image as string, thumb: thumbUrl(w.image as string, 'grid'), title: w.title || '', artist: nameWithNickname(a.user), exhibition: exTitle, kind: 'sold' as const })));
  // 확인 요청·확인 수는 회원 작가만 센다(규칙 91) — 비회원만 있으면 확인 요청 없이 [정산 완료]
  const artistCount = memberRows.length;
  const guestOnly = artistCount === 0 && guestRows.length > 0;

  // ── 할 일 줄(정산 단계) — 상황별 문장 하나 · 주 버튼 하나 · 보조 하나 ──
  // '강윤서 님' · '강윤서 님 외 1명' — 뒤에 '이 …남겼어요' · '에게 다시 요청' 이 붙는다(예전 '강윤서 외 1명 님이' 는 어색했다)
  const issueLabel = issueArtists.length === 0 ? ''
    : `${issueArtists[0]!.name} 님${issueArtists.length > 1 ? ` 외 ${issueArtists.length - 1}명` : ''}`;
  let task: { text: string; tone: ChipVariant } | null = null;
  let primary: SettlementAction | null = null;
  let secondary: SettlementAction | null = null;
  if (enabled && data && !isLoading) {
    if (settled) {
      task = { text: '정산까지 모두 끝났어요.', tone: 'done' };
      if (!locked && dirty) primary = { label: '변경 저장', onClick: save, busy: saveMutation.isPending };
    } else if (!requested && guestOnly) {
      // 비회원 작가만 — 확인해 줄 사람이 없다. 판매를 넣고 바로 마친다(서버도 요청 없이 받는다)
      task = dirty
        ? { text: '저장하지 않은 정산 입력이 있어요', tone: 'attention' }
        : { text: grand.soldCount > 0 ? `판매 ${grand.soldCount}점을 입력했어요. 정산을 마무리하세요.` : '판매된 작품을 입력하고 정산을 마무리하세요.', tone: 'attention' };
      primary = dirty
        ? { label: '변경 저장', onClick: save, busy: saveMutation.isPending }
        : { label: '정산 완료', onClick: openComplete, busy: completeMutation.isPending };
    } else if (!requested) {
      task = dirty
        ? { text: '저장하지 않은 정산 입력이 있어요', tone: 'attention' }
        : { text: grand.soldCount > 0 ? `판매 ${grand.soldCount}점을 입력했어요. 작가에게 정산 확인을 요청하세요.` : '판매된 작품을 입력하고 작가에게 정산 확인을 요청하세요.', tone: 'attention' };
      primary = { label: artistCount > 0 ? `작가 ${artistCount}명에게 확인 요청` : '작가에게 확인 요청', onClick: askRequest, busy: requestMutation.isPending, disabled: artistCount === 0 };
      if (dirty) secondary = { label: '저장만 하기', onClick: save, busy: saveMutation.isPending };
    } else if (issueArtists.length > 0) {
      task = { text: `${issueLabel}이 정산에 이의를 남겼어요`, tone: 'attention' };
      primary = { label: `${dirty ? '저장하고 ' : ''}${issueLabel}에게 다시 요청`, onClick: () => reask(issueArtists.map(x => x.id)), busy: reaskMutation.isPending };
    } else if (dirty) {
      task = { text: '저장하지 않은 정산 입력이 있어요', tone: 'attention' };
      primary = { label: '변경 저장', onClick: save, busy: saveMutation.isPending };
    } else if (allApproved) {
      task = { text: `작가 ${artistCount}명이 모두 정산을 확인했어요.`, tone: 'attention' };
      primary = { label: '정산 완료', onClick: openComplete, busy: completeMutation.isPending };
    } else {
      task = { text: `작가의 정산 확인을 기다리고 있어요 · ${approvedCount}/${artistCount}명`, tone: 'neutral' };
      if (unanswered.length > 0) secondary = { label: `미응답 ${unanswered.length}명에게 다시 알리기`, onClick: () => setRemindOpen(true) };
    }
  }

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirmOpen}
        title="정산을 완료할까요?"
        details={[
          // 비회원 작가(규칙 91)는 확인 요청 없이 끝난다 — 확인창이 한 줄로 말한다
          ...(guestRows.length === 0 ? ['모든 참여 작가가 정산을 확인했어요.']
            : artistCount > 0 ? [`회원 작가 ${artistCount}명이 모두 정산을 확인했어요.`] : []),
          ...(guestRows.length > 0
            ? [`비회원 작가 ${guestRows.length}명(${guestRows.slice(0, 3).map(x => nameWithNickname(x.user)).join(', ')}${guestRows.length > 3 ? ' 외' : ''})은 확인 요청 없이 끝나요.`]
            : []),
          '완료하면 정산 내역을 더 이상 고칠 수 없어요.',
          guestRows.length > 0 && artistCount === 0 ? '되돌릴 수 없어요.' : '정산 내역이 참여 작가에게 최종 공유되며, 되돌릴 수 없어요.',
        ]}
        confirmText="정산 완료"
        onConfirm={() => { setConfirmOpen(false); completeMutation.mutate(); }}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmDialog
        open={!!zeroRatio}
        title="갤러리 몫이 0%인 작가가 있어요"
        details={[
          `${(zeroRatio ?? []).join(', ')} — 판매 금액이 모두 작가 몫으로 계산돼요.`,
          '맞으면 그대로 요청하고, 아니면 갤러리 비율을 고친 뒤 요청하세요.',
        ]}
        cancelText="비율 고치기"
        confirmText="그대로 요청"
        onConfirm={() => { setZeroRatio(null); requestMutation.mutate(); }}
        onCancel={() => {
          setZeroRatio(null);
          window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-ratio-input]')?.focus(), 50);
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
            '마이페이지 [내 전시]에서 정산 금액을 확인한 뒤 확인하거나 이의를 남겨 주세요.',
            '',
            `바로가기: ${window.location.origin}/mypage?tab=applications&ex=${exhibitionId}`,
          ].join('\n')}
          sending={reminderMutation.isPending}
          sendLabel={(n) => `${n}명에게 다시 알리기`}
          onSend={(v) => reminderMutation.mutate(v)}
          onClose={() => setRemindOpen(false)}
        />
      )}
    </>
  );

  return {
    ready: !!data && !isLoading,
    // 받기에 실패했다(재시도까지) — 표·할 일 줄이 '불러오는 중' 모양으로 영원히 남지 않게 이유와 [다시 시도]를 그린다(2026-11-20 REL-04)
    failed: isError && !data,
    retry: () => { void refetch(); },
    data, artists, exTitle, feeRate, setFeeRate: setFee, feeNum, dirty, locked, settled, requested, allApproved,
    approvalOf, unansweredCount: unanswered.length, approvedCount, issueArtists,
    uniformRatio, perArtistRatio: !!perArtistRatio, setPerArtistRatio: (v) => setPerArtistRatio(v), setAllRatios,
    updWork, updRatio, priceMissing, clearPriceMissing, grand, soldWorks, zipping, downloadOverall, downloadArtist,
    reask, reasking: reaskMutation.isPending, cancelRequest, cancelling: cancelMutation.isPending,
    task, primary, secondary, openComplete, openRemind: () => setRemindOpen(true), dialogs,
  };
}

