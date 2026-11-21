import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { getDday } from '@/lib/utils';
import { recruitmentOver } from '@/lib/flowLabels';
import { md } from '@/lib/scheduleSummary';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { OperationAccess } from '@/types';

/**
 * 공모 단계 전환 — 모집 마감 → 전시 확정 → 전시 종료 (2026-11-20, 옛 `components/operation/StatusPanel.tsx` 에서 꺼냈다).
 *
 * 버튼은 이제 공모 한 건 화면의 **할 일 줄**(`TaskBar`)과 [⋯] 메뉴가 갖고, 확인창과 서버 호출은 여기 하나다.
 *  ① 단계를 넘기는 버튼은 전부 확인창을 거친다 — "정말?" 이 아니라 **무엇이 바뀌는지** 줄 목록(규칙 59)
 *  ② **모집 마감은 되돌릴 수 없다**(2026-11-21 사용자 결정, 규칙 90) — 확인창 맨 위에 빨간 한 줄로 알린다.
 *     **수락은 접수가 끝난 뒤에만**(모집 마감 또는 접수 마감일 경과) 한다 — 그때 작가의 지원서가 굳고 갤러리가 선정한다. 거절은 따로 없다.
 *     남은 검토 대기는 [선정 마치기](모든 공고 — 할 일 줄) · 정원을 다 뽑았을 때 · 선정 마감일이 지나면(새 공고) · 전시 확정 · 전시 종료 때
 *     미선정이 된다(서버) — **되돌릴 수 없다**. 확인창은 그 수만 말한다 — 작가에게 알림이 가는지는 갤러리가 알 필요 없다(사용자 지적).
 *     아무도 수락하지 않은 채 [선정 마치기]면 그걸 먼저 말하고 버튼이 빨갛다('아무도 뽑지 않고 마치기', 2026-11-21 사용자 확인).
 *  ③ 되돌리기([이전 단계로])는 전시 확정·전시 종료만 — 되돌릴 수 없는 때(시작일 경과 자동 확정 · 판매·정산 시작)엔 이유를 준다
 *
 * ⚠️ '정산 완료'는 여기 없다 — 작가 확인을 거쳐야 하므로 정산 탭의 [정산 완료]로만 간다(옛 StatusPanel 의 같은 규칙).
 * ⚠️ 공모만 진행(`recruitOnly`)이면 단계가 모집 마감 하나뿐이다 — 확정·종료는 서버도 400.
 */
export type LifecycleKind = 'close' | 'finish' | 'confirm' | 'end';

/**
 * 띄울 확인창. 줄 목록은 **그릴 때** 검토 대기·수락 수로 만든다(2026-11-20 S1 — 연 순간의 수를 박아 두면 지원자 목록보다 먼저 연 창에 0명이 남았다).
 * `view` 는 그 수에 따라 경고·버튼을 바꾼다 — [선정 마치기]에서 아무도 수락하지 않았으면 빨간 '아무도 뽑지 않고 마치기'.
 */
type DialogView = { warning?: ReactNode; confirmText?: string; variant?: 'default' | 'danger' };
type Pending = {
  kind: LifecycleKind | 'back'; body: Record<string, boolean>; title: string;
  details: (pendingCount: number, acceptedCount: number) => string[];
  confirmText: string; warning?: ReactNode;
  view?: (pendingCount: number, acceptedCount: number) => DialogView;
} | null;

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
/** 모집 마감은 되돌릴 수 없다(2026-11-21 사용자 결정, 규칙 90) — 확인창 맨 위 빨간 한 줄 */
export const CLOSE_WARNING = '모집 마감은 되돌릴 수 없어요.';

export function useLifecycle({ exhibitionId, access, exhibitStartDate = null, incompleteArtists = 0, pendingApplicants = 0, acceptedApplicants = 0, capacity = null, onChanged }: {
  exhibitionId: string;
  access: OperationAccess | undefined;
  exhibitStartDate?: string | null;
  incompleteArtists?: number;
  /** 아직 결정하지 않은 지원 — 확인창에 적는다(마감: 이제 선정할 수 · 선정 마치기·확정·종료: 미선정이 될 수) */
  pendingApplicants?: number;
  /** 수락한 지원 — [선정 마치기] 확인창(몇 명으로 마치나 · 아무도 안 뽑았나)과 모집 마감 때 정원이 이미 찼나 */
  acceptedApplicants?: number;
  /** 정원(뽑을 수 있는 수) — 마감하는 순간 이미 다 차 있으면 선정도 함께 끝난다(서버 closeOutIfFull) */
  capacity?: number | null;
  /** 전환이 끝난 뒤(목록·탭을 그 단계로 옮길 때) */
  onChanged?: (kind: LifecycleKind | 'back') => void;
}): Lifecycle {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const mutation = useMutation({
    mutationFn: (v: { kind: LifecycleKind | 'back'; body: Record<string, boolean> }) => v.kind === 'finish'
      ? api.post(`/operations/${exhibitionId}/finish-selection`)
      : api.patch(`/operations/${exhibitionId}/lifecycle`, v.body),
    onSuccess: (res, v) => {
      for (const queryKey of [['operation-access', exhibitionId], ['exhibitions'], ['my-operation-overview'], ['my-exhibitions'], ['exhibition', exhibitionId]]) {
        qc.invalidateQueries({ queryKey });
      }
      // 마감하면 지원자를 결정할 수 있게 되고, 선정을 마치면(확정·종료 포함) 남은 검토 대기가 미선정이 된다 — 지원자 목록을 다시 받는다
      qc.invalidateQueries({ queryKey: ['exhibition-applicants', Number(exhibitionId)] });
      const rejected = res.data?.rejectedCount ?? res.data?.closedOut ?? 0;
      if (v.kind !== 'back') {
        const base = v.kind === 'close' ? '모집을 마감했어요.'
          : v.kind === 'finish' ? '선정을 마쳤어요.'
            : v.kind === 'confirm' ? '전시를 확정했어요. 작가에게 알림이 가요.' : '전시를 종료했어요. 정산을 시작하세요.';
        toast.success(rejected > 0 ? `${base} 검토 대기 ${rejected}명은 미선정이 됐어요.` : base);
      }
      onChanged?.(v.kind);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '변경하지 못했습니다.'),
  });

  const recruitOnly = !!access?.recruitOnly;
  const settled = !!access?.settled;
  // 접수가 끝났나 — 모집 마감을 눌렀거나 접수 마감일이 지났다(규칙 90). 지났으면 [모집 마감]을 따로 누를 일이 없다
  const over = !!access && recruitmentOver(access);
  const selectionDeadline = access?.selectionDeadline ?? null;
  const locked = settled && !access?.isAdmin;
  const maxAdvance = recruitOnly ? 1 : 3;
  const stage = !access ? 0 : recruitOnly
    ? (over ? 1 : 0)
    : settled ? 4 : access.ended ? 3 : access.confirmed ? 2 : over ? 1 : 0;
  const cannotUndoConfirm = stage === 2 && !!access?.confirmed && !access?.manualConfirmed;
  const cannotUndoEnd = stage === 3 && !!access?.settlementStarted && !access?.isAdmin;
  const backBlocked = locked ? '정산이 끝난 공모예요.'
    : cannotUndoConfirm ? '전시 시작일이 지나 저절로 확정되었어요 — 되돌릴 수 없어요.'
      : cannotUndoEnd ? '판매·정산을 시작해서 전시 종료를 되돌릴 수 없어요.'
        : null;
  // 모집 마감(1단계)은 되돌릴 수 없다(규칙 90) — [⋯] 의 되돌리기는 전시 확정·전시 종료만. 공모만 진행이면 되돌릴 단계가 없다
  const canBack = !!access && stage > 1 && stage <= maxAdvance && !locked;
  const backLabel = stage > 0 && stage <= 3 ? `'${LABELS[stage - 1]}' 되돌리기` : '이전 단계로';
  const startDate = exhibitStartDate;
  const back = '잘못 눌렀으면 [⋯] 의 되돌리기로 돌아갈 수 있어요.';

  /** 선정을 마치는 전환(전시 확정 · 전시 종료) — 남은 검토 대기가 미선정이 된다(서버, 규칙 90) */
  const leftover = (n: number) => (n > 0 ? [`검토 대기 ${n}명은 미선정이 돼요.`] : []);

  const ask = (kind: LifecycleKind) => {
    if (!access || locked) return;
    if (kind === 'close') {
      if (over) return;
      setPending({
        kind, body: { recruitmentClosed: true }, title: '모집을 마감할까요?', confirmText: '모집 마감',
        warning: CLOSE_WARNING,
        // 수락은 접수가 끝난 뒤에만(규칙 90) — 마감이 무엇을 바꾸는지 차례로. 작가에게 알림이 가는지는 적지 않는다(갤러리가 알 필요 없다)
        details: (n, a) => {
          // 초대 코드로 정원이 이미 다 찼다 — 고를 자리가 없으니 마감과 함께 선정도 끝난다(서버 closeOutIfFull)
          const full = capacity != null && capacity > 0 && a >= capacity;
          return [
            '모집공고 목록에서 내려가고 더 이상 지원을 받지 않아요.',
            '작가는 낸 지원서를 더 고치거나 취소할 수 없어요.',
            ...(full
              ? (n > 0 ? [`정원이 이미 다 차 있어 검토 대기 ${n}명은 미선정이 돼요.`] : [])
              : [
                ...(n > 0 ? [`이제 지원자 ${n}명 가운데 수락할 작가를 고를 수 있어요.`] : []),
                ...(selectionDeadline ? [`선정 마감일(${md(selectionDeadline)})이 지나면 수락하지 않은 지원자는 미선정이 돼요.`] : []),
              ]),
            ...(recruitOnly ? ['이 공고는 선정에서 끝나요 — 출품 자료·전시·정산 단계가 없어요.'] : []),
          ];
        },
      });
      return;
    }
    if (kind === 'finish') {
      // 모든 공고(2026-11-21 사용자 결정) — 접수가 끝난 뒤에만(서버도 400). 선정 마감일이 있으면 그날을 기다리지 않고 지금 끝낸다
      if (!over) return;
      const beforeDeadline = !!selectionDeadline && getDday(selectionDeadline) >= 0;
      setPending({
        kind, body: {}, title: '선정을 마칠까요?', confirmText: '선정 마치기',
        warning: '선정을 마치면 되돌릴 수 없어요.',
        details: (n, a) => [
          ...(a > 0 ? [`수락한 ${a}명으로 선정을 마쳐요.`] : []),
          ...(n > 0 ? [a > 0 ? `수락하지 않은 ${n}명은 미선정이 돼요.` : `지원자 ${n}명이 모두 미선정이 돼요.`] : []),
          ...(beforeDeadline ? [`선정 마감일(${md(selectionDeadline!)})을 기다리지 않고 지금 끝내요.`] : []),
          '그 뒤로는 더 수락할 수 없어요.',
        ],
        // 아무도 안 뽑고 끝내면 그걸 먼저 말하고 버튼을 빨갛게(사용자 확인 — '아무도 뽑지 않고 마치기')
        view: (_n, a) => (a > 0 ? {} : {
          warning: <>아직 아무도 수락하지 않았어요.<br />선정을 마치면 되돌릴 수 없어요.</>,
          confirmText: '아무도 뽑지 않고 마치기',
          variant: 'danger',
        }),
      });
      return;
    }
    if (recruitOnly) return;
    if (kind === 'confirm') {
      if (access.confirmed) return;
      setPending({
        kind, body: access.recruitmentClosed ? { confirmed: true } : { recruitmentClosed: true, confirmed: true }, title: '전시를 확정할까요?', confirmText: '전시 확정',
        // 아직 접수 중이면 확정이 모집도 닫는다 — 그것도 되돌릴 수 없다(관리자가 순서를 건너뛸 때). 접수 마감일이 지났으면 이미 끝난 일이라 말하지 않는다
        warning: over ? undefined : `모집도 함께 마감돼요. ${CLOSE_WARNING}`,
        details: (n) => [
          '작가는 더 이상 출품 자료를 고칠 수 없어요. 갤러리는 [대신 입력]으로 계속 고칠 수 있어요.',
          '수락한 작가에게 확정 알림이 가요.',
          ...leftover(n),
          ...(incompleteArtists > 0 ? [`출품 자료를 아직 다 내지 않은 작가가 ${incompleteArtists}명 있어요.`] : []),
          ...(startDate ? [`전시 시작일(${md(startDate)})이 되면 어차피 저절로 확정돼요.`] : []),
          // 모집까지 함께 닫히면 되돌리기로 돌아갈 수 없다(모집 마감은 되돌릴 수 없다 — 위 경고)
          ...(over ? [back] : []),
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
      warning: over ? undefined : `모집도 함께 마감돼요. ${CLOSE_WARNING}`,
      details: (n) => [...early, ...leftover(n), '정산이 열려요 — 판매된 작품과 판매가를 입력하고 작가에게 확인을 요청하세요.', '작가의 출품 자료는 잠긴 채로 기록이 남아요.', '판매를 입력하면 전시 종료를 되돌릴 수 없어요.'],
    });
  };

  const askBack = () => {
    if (!canBack || backBlocked) return;
    // 모집 마감(1단계)은 되돌리지 않는다(규칙 90 — canBack 이 막고 서버도 400)
    if (stage < 2) return;
    const body: Record<string, boolean> = stage === 2 ? { confirmed: false } : { ended: false };
    const details = stage === 2
      ? ['작가가 출품 자료를 다시 고칠 수 있어요.']
      : ['정산 화면이 닫혀요. 입력해 둔 판매 내역은 그대로 남아요.'];
    setPending({ kind: 'back', body, title: `'${LABELS[stage - 1]}' 을 되돌릴까요?`, details: () => details, confirmText: '되돌리기' });
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

  // 창이 떠 있는 동안 지원자 목록이 오거나 바뀌면 그 수를 따른다(2026-11-20 S1)
  const view = pending?.view?.(pendingApplicants, acceptedApplicants) ?? {};
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title ?? ''}
      warning={view.warning ?? pending?.warning}
      details={pending ? pending.details(pendingApplicants, acceptedApplicants) : undefined}
      confirmText={view.confirmText ?? pending?.confirmText}
      variant={view.variant ?? 'default'}
      onConfirm={() => {
        if (pending) mutation.mutate({ kind: pending.kind, body: pending.body });
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { stage, ask, askBack, canBack, backBlocked, backLabel, busy: mutation.isPending, dialog, autoCloseNote };
}
