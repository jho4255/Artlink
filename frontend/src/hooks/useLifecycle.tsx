import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { getDday } from '@/lib/utils';
import { md } from '@/lib/scheduleSummary';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { OperationAccess } from '@/types';

/**
 * 공모 단계 전환 — 모집 마감 → 전시 확정 → 전시 종료 (2026-11-20, 옛 `components/operation/StatusPanel.tsx` 에서 꺼냈다).
 *
 * 버튼은 이제 공모 한 건 화면의 **할 일 줄**(`TaskBar`)과 [⋯] 메뉴가 갖고, 확인창과 서버 호출은 여기 하나다.
 *  ① 단계를 넘기는 버튼은 전부 확인창을 거친다 — "정말?" 이 아니라 **무엇이 바뀌는지** 줄 목록(규칙 59)
 *  ② 모집 마감 때 검토 대기가 남아 있으면 그 수를 적고, '남은 N명을 미선정으로' 체크를 둔다(기본 꺼짐 — 2026-11-20 사용자 결정 D2)
 *  ③ 되돌리기([이전 단계로])는 되돌릴 수 없는 때(시작일 경과 자동 확정 · 판매·정산 시작)엔 이유를 준다
 *
 * ⚠️ '정산 완료'는 여기 없다 — 작가 확인을 거쳐야 하므로 정산 탭의 [정산 완료]로만 간다(옛 StatusPanel 의 같은 규칙).
 * ⚠️ 공모만 진행(`recruitOnly`)이면 단계가 모집 마감 하나뿐이다 — 확정·종료는 서버도 400.
 */
export type LifecycleKind = 'close' | 'confirm' | 'end';

type Pending = { kind: LifecycleKind | 'back'; body: Record<string, boolean>; title: string; details: string[]; confirmText: string } | null;

export interface Lifecycle {
  /** 0 모집 · 1 전시 준비(마감 뒤) · 2 확정 · 3 종료 · 4 정산 완료 */
  stage: number;
  ask: (kind: LifecycleKind) => void;
  askBack: () => void;
  /** 되돌릴 수 있는 단계인가 — [⋯] 의 [이전 단계로] */
  canBack: boolean;
  /** 되돌릴 수 없는 이유(있으면 메뉴 항목을 비활성 + 이 글) */
  backBlocked: string | null;
  /** [⋯] 의 '이전 단계로' 이름 — "'모집 마감' 되돌리기" */
  backLabel: string;
  busy: boolean;
  /** 화면에 그릴 확인창 */
  dialog: ReactNode;
  /** 전시가 끝나고 정산을 시작하지 않은 채 20일이 지나면 목록에서 정리된다 — 남은 날을 알린다 */
  autoCloseNote: string | null;
}

const LABELS = ['모집 마감', '전시 확정', '전시 종료'];

export function useLifecycle({ exhibitionId, access, exhibitStartDate = null, incompleteArtists = 0, pendingApplicants = 0, onChanged }: {
  exhibitionId: string;
  access: OperationAccess | undefined;
  exhibitStartDate?: string | null;
  incompleteArtists?: number;
  /** 아직 검토하지 않은 지원 — 모집 마감 확인창에 적는다 */
  pendingApplicants?: number;
  /** 전환이 끝난 뒤(목록·탭을 그 단계로 옮길 때) */
  onChanged?: (kind: LifecycleKind | 'back') => void;
}): Lifecycle {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const [rejectRest, setRejectRest] = useState(false);
  const mutation = useMutation({
    mutationFn: (v: { kind: LifecycleKind | 'back'; body: Record<string, boolean> }) => api.patch(`/operations/${exhibitionId}/lifecycle`, v.body),
    onSuccess: (res, v) => {
      for (const queryKey of [['operation-access', exhibitionId], ['exhibitions'], ['my-operation-overview'], ['my-exhibitions'], ['exhibition', exhibitionId]]) {
        qc.invalidateQueries({ queryKey });
      }
      const rejected = res.data?.rejectedCount ?? 0;
      if (rejected > 0) {
        qc.invalidateQueries({ queryKey: ['exhibition-applicants', Number(exhibitionId)] });
        toast.success(`모집을 마감하고 ${rejected}명을 미선정으로 처리했어요.`);
      } else if (v.kind !== 'back') {
        toast.success(v.kind === 'close' ? '모집을 마감했어요.' : v.kind === 'confirm' ? '전시를 확정했어요. 작가에게 알림이 가요.' : '전시를 종료했어요. 정산을 시작하세요.');
      }
      onChanged?.(v.kind);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '변경하지 못했습니다.'),
  });

  const recruitOnly = !!access?.recruitOnly;
  const settled = !!access?.settled;
  const locked = settled && !access?.isAdmin;
  const maxAdvance = recruitOnly ? 1 : 3;
  const stage = !access ? 0 : recruitOnly
    ? (access.recruitmentClosed ? 1 : 0)
    : settled ? 4 : access.ended ? 3 : access.confirmed ? 2 : access.recruitmentClosed ? 1 : 0;
  const cannotUndoConfirm = stage === 2 && !!access?.confirmed && !access?.manualConfirmed;
  const cannotUndoEnd = stage === 3 && !!access?.settlementStarted && !access?.isAdmin;
  const backBlocked = locked ? '정산이 끝난 공모예요.'
    : cannotUndoConfirm ? '전시 시작일이 지나 저절로 확정되었어요 — 되돌릴 수 없어요.'
      : cannotUndoEnd ? '판매·정산을 시작해서 전시 종료를 되돌릴 수 없어요.'
        : null;
  const canBack = !!access && stage > 0 && stage <= maxAdvance && !locked;
  const backLabel = stage > 0 && stage <= 3 ? `'${LABELS[stage - 1]}' 되돌리기` : '이전 단계로';
  const startDate = exhibitStartDate;
  const back = '잘못 눌렀으면 [⋯] 의 되돌리기로 돌아갈 수 있어요.';

  const ask = (kind: LifecycleKind) => {
    if (!access || locked) return;
    if (kind === 'close') {
      if (access.recruitmentClosed) return;
      setRejectRest(false);
      setPending({
        kind, body: { recruitmentClosed: true }, title: '모집을 마감할까요?', confirmText: '모집 마감',
        details: recruitOnly
          ? ['모집공고 목록에서 내려가고 더 이상 지원을 받지 않아요.', '이 공고는 여기서 끝나요 — 출품 자료·전시·정산 단계가 없어요.', back]
          : ['모집공고 목록에서 내려가고 더 이상 지원을 받지 않아요.', '받은 지원서와 수락 결과는 그대로예요.', '수락한 작가들이 출품 자료를 내기 시작해요.', back],
      });
      return;
    }
    if (recruitOnly) return;
    if (kind === 'confirm') {
      if (access.confirmed) return;
      setPending({
        kind, body: access.recruitmentClosed ? { confirmed: true } : { recruitmentClosed: true, confirmed: true }, title: '전시를 확정할까요?', confirmText: '전시 확정',
        details: [
          '작가는 더 이상 출품 자료를 고칠 수 없어요. 갤러리는 [대신 입력]으로 계속 고칠 수 있어요.',
          '수락한 작가에게 확정 알림이 가요.',
          ...(incompleteArtists > 0 ? [`출품 자료를 아직 다 내지 않은 작가가 ${incompleteArtists}명 있어요.`] : []),
          ...(startDate ? [`전시 시작일(${md(startDate)})이 되면 어차피 저절로 확정돼요.`] : []),
          back,
        ],
      });
      return;
    }
    // end — 확정 전이면 함께 확정한다(서버는 확정 뒤에만 종료를 받는다)
    if (access.ended) return;
    const endDay = access.exhibitDate ? getDday(access.exhibitDate) : null;
    const early = endDay != null && endDay > 0
      ? [`전시 기간(${startDate ? `${md(startDate)}–` : ''}${md(access.exhibitDate!)})이 아직 끝나지 않았어요.`]
      : [];
    setPending({
      kind, body: access.confirmed ? { ended: true } : { confirmed: true, ended: true }, title: '전시를 종료할까요?', confirmText: '전시 종료',
      details: [...early, '정산이 열려요 — 판매된 작품과 판매가를 입력하고 작가에게 확인을 요청하세요.', '작가의 출품 자료는 잠긴 채로 기록이 남아요.', '판매를 입력하면 전시 종료를 되돌릴 수 없어요.'],
    });
  };

  const askBack = () => {
    if (!canBack || backBlocked) return;
    const steps: Record<string, boolean>[] = [{ recruitmentClosed: false }, { confirmed: false }, { ended: false }];
    const body = steps[stage - 1]!;
    const details = stage === 1
      ? ['모집공고 목록에 다시 올라가고 지원을 다시 받아요.']
      : stage === 2
        ? ['작가가 출품 자료를 다시 고칠 수 있어요.']
        : ['정산 화면이 닫혀요. 입력해 둔 판매 내역은 그대로 남아요.'];
    setPending({ kind: 'back', body, title: `'${LABELS[stage - 1]}' 을 되돌릴까요?`, details, confirmText: '되돌리기' });
  };

  /*
    정산을 시작하지 않은 채 전시가 끝난 지 오래된 공모는 목록에서 '종료' 로 정리된다(lib/settlementReminder.ts — D+5·10·15 알림, 20일째 종료 통보).
    ⚠️ `access.ended` 로 거르면 안 된다 — 이 안내가 필요한 대표적인 대상이 [전시 종료]를 **누르지 않은** 갤러리다(옛 StatusPanel 과 같은 판정).
  */
  const autoCloseNote = (() => {
    if (!access || recruitOnly || settled || access.settlementStarted) return null;
    if (!access.exhibitDate || !access.autoCloseDays) return null;
    const passed = -getDday(access.exhibitDate);
    if (passed < 0) return null;
    const left = access.autoCloseDays - passed;
    return left > 0
      ? `${left}일 뒤 이 공모는 [종료]로 정리돼요 — 전시가 끝나고 ${access.autoCloseDays}일 동안 판매·정산 입력이 없으면 목록을 정돈하려고 내려요. 정리된 뒤에도 정산을 이어서 할 수 있어요.`
      : `전시가 끝나고 ${access.autoCloseDays}일이 지나 [종료]로 정리되었어요. 정산은 여기서 그대로 이어서 할 수 있어요.`;
  })();

  // 창이 떠 있는 동안 지원자 목록이 오거나 바뀌면 그 수를 따른다(2026-11-20 S1 — 연 순간의 수를 박아 두면 목록보다 먼저 연 창에 0명이 남았다)
  const pendingCount = pending?.kind === 'close' ? pendingApplicants : 0;
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title ?? ''}
      // 검토 대기 줄은 '되돌리기' 안내 앞에 — 바로 아래 체크(남은 N명을 미선정으로)와 붙어 읽히게
      details={pending ? (pending.kind === 'close' && pendingCount > 0
        ? [...pending.details.slice(0, -1), `아직 검토하지 않은 지원자가 ${pendingCount}명 있어요.`, ...pending.details.slice(-1)]
        : pending.details) : undefined}
      extra={pending?.kind === 'close' && pendingCount > 0 ? (
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-gray-800">
          <input type="checkbox" checked={rejectRest} onChange={(e) => setRejectRest(e.target.checked)} className="h-[18px] w-[18px] accent-gray-900" />
          남은 {pendingCount}명을 미선정으로 처리
        </label>
      ) : undefined}
      confirmText={pending?.confirmText}
      onConfirm={() => {
        if (pending) mutation.mutate({ kind: pending.kind, body: { ...pending.body, ...(pending.kind === 'close' && rejectRest && pendingCount > 0 ? { rejectPending: true } : {}) } });
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { stage, ask, askBack, canBack, backBlocked, backLabel, busy: mutation.isPending, dialog, autoCloseNote };
}
