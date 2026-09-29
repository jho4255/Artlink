/**
 * 공모 진행 단계 — 모집 마감 → 전시 확정 → 전시 종료 → 정산 완료 (운영 화면 맨 위)
 *
 * ── 왜 공용 컴포넌트인가 ────────────────────────────────────
 * `OperationPage`(신규)와 `OperationClassicPage`(클래식)에 **완전히 같은 코드가 복붙**돼 있었다.
 * 정산 섹션과 같은 이유로 한 벌로 합쳤다(클래식은 지금 라우트에 연결돼 있지 않다).
 *
 * ── 2026-09-29 개편 ─────────────────────────────────────────
 * ① **단계를 넘기는 버튼은 전부 확인창을 거친다.** 예전엔 [다음 단계로 — 모집마감] 이 누르는 즉시 공고를 목록에서
 *    내렸다(확인은 전시종료에만 있었다). 처음 쓰는 갤러리가 "다음이 뭐지?" 하고 누르면 모집이 끝났다.
 *    확인창은 "정말?" 이 아니라 **무엇이 바뀌는지**를 적는다(`ConfirmDialog details`).
 * ② 색을 뺐다 — 끝난 단계 초록 → 검정 ✓ (`components/flow/ProgressSteps`).
 * ③ 지금이 어떤 기간인지(`현재 단계`) 한 문장으로 먼저 말하고, 다음 버튼은 그 아래 하나만 둔다.
 *
 * ── 4번째 노드 '정산 완료' ──────────────────────────────────
 * ⚠️ 앞 3단계와 성격이 다르다 — **버튼으로 넘어가는 단계가 아니다.** 정산은 작가 확인을 거쳐야 하므로
 *    아래 정산 구역의 [정산 완료]로만 도달한다. 그래서 `LIFECYCLE_STEPS`(버튼이 쓰는 배열)는 3개 그대로 두고,
 *    그리기용 노드만 4개로 만든다. 여기를 합치면 다음 단계 버튼이 정산을 건너뛰고 마감시켜 버린다.
 *
 * ── 공모만 진행하는 공고 (2026-09-10) ───────────────────────
 * `access.recruitOnly` 면 단계가 **모집 중 → 모집 마감** 둘뿐이다. 확정·전시종료·정산은 그 공고에 없는 단계라
 * 서버도 400 으로 막는다(`lib/exhibitionStage.ts`). ⚠️ 단계 수를 상수(3·4)로 박지 말 것 — `steps`/`nodes` 로만 판정한다.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Lock, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { getDday } from '@/lib/utils';
import { md } from '@/lib/scheduleSummary';
import ProgressSteps from '@/components/flow/ProgressSteps';
import Notice from '@/components/flow/Notice';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { OperationAccess } from '@/types';

/** 버튼으로 진행하는 단계들 (정산 완료는 여기 넣지 말 것 — 위 주석 참고) */
const LIFECYCLE_STEPS: { label: string; action: string; next: Record<string, boolean>; back: Record<string, boolean> }[] = [
  { label: '모집 마감', action: '모집 마감하기', next: { recruitmentClosed: true }, back: { recruitmentClosed: false } },
  { label: '전시 확정', action: '전시 확정하기', next: { confirmed: true }, back: { confirmed: false } },
  { label: '전시 종료', action: '전시 종료하기', next: { ended: true }, back: { ended: false } },
];

/** 스텝퍼에 그릴 노드 — 마지막 '정산 완료'는 표시 전용 */
const STEP_NODES = [...LIFECYCLE_STEPS.map((s) => s.label), '정산 완료'];

/**
 * 전시 종료일로부터 며칠 지났는가 (KST 달력 날짜 기준).
 * 순수 시간 차이로 재면 자정 직후/직전에 하루가 어긋난다(CLAUDE.md 14).
 */
function daysSince(date: string): number {
  return -getDday(date);
}

type Pending = { kind: 'next' | 'back'; body: Record<string, boolean>; title: string; details: string[]; confirmText: string } | null;

export default function StatusPanel({ exhibitionId, access, incompleteArtists = 0, exhibitStartDate = null, settlement = null, className = '' }: {
  exhibitionId: string;
  access: OperationAccess;
  /**
   * 정산 확인 현황(확인 요청 뒤) — '작가들이 확인하고 있어요' 를 **모두 확인한 뒤에도** 띄우던 문제(2026-09-29 지적).
   * access 응답엔 없어 정산 조회에서 세어 넘긴다. 모르면(null) 예전 문구.
   */
  settlement?: { approved: number; total: number; issues: number } | null;
  /** 출품 자료를 다 내지 않은 수락 작가 수 — 전시 확정 확인창에 적는다 */
  incompleteArtists?: number;
  /** 전시 시작일 — 자동 확정 안내에 쓴다(access 응답엔 없어 공모 상세에서 받아 넘긴다) */
  exhibitStartDate?: string | null;
  className?: string;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const mutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch(`/operations/${exhibitionId}/lifecycle`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] });
      qc.invalidateQueries({ queryKey: ['exhibitions'] });
      // 카드의 단계 칩·할 일 줄도 같은 값을 본다
      qc.invalidateQueries({ queryKey: ['my-operation-overview'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '변경하지 못했습니다.'),
  });

  const settled = !!access.settled;
  const locked = settled && !access.isAdmin;   // 관리자는 완료 후에도 수정 가능
  const recruitOnly = !!access.recruitOnly;

  const steps = recruitOnly ? LIFECYCLE_STEPS.slice(0, 1) : LIFECYCLE_STEPS;
  const nodes = recruitOnly ? ['모집 마감'] : STEP_NODES;
  /** 버튼으로 도달할 수 있는 마지막 단계 (전시까지 진행=3 / 공모만=1) */
  const maxAdvance = steps.length;

  // 지금까지 지난 단계 수: 0=모집 중, 1=모집 마감 뒤, 2=확정 뒤, 3=전시 종료 뒤, 4=정산 완료
  // ⚠️ 공모만 진행하면 `access.confirmed` 가 전시 시작일 경과로 자동 true 가 된다 — 보면 안 된다.
  const stage = recruitOnly
    ? (access.recruitmentClosed ? 1 : 0)
    : settled ? 4 : access.ended ? 3 : access.confirmed ? 2 : access.recruitmentClosed ? 1 : 0;

  // 전시 시작일이 지나 자동 확정된 상태는 되돌리기가 서버에서 거부된다 → 버튼을 두지 않는다
  const cannotUndoConfirm = stage === 2 && access.confirmed && !access.manualConfirmed;
  const startDate = exhibitStartDate;
  const started = !!startDate && getDday(startDate) <= 0;

  /** 지금 어떤 기간인가 — 한 문장 */
  const now: { title: string; body: string } = (() => {
    if (recruitOnly) {
      return stage === 0
        ? { title: '모집 중', body: '지원을 받고 있어요. 선정을 마치면 모집을 마감하세요 — 이 공고는 모집 마감이 마지막 단계예요.' }
        : { title: '선정 완료', body: '지원자 선정까지 마쳤어요. 이 공고는 여기까지예요 — 출품 자료·전시·정산 단계는 없어요.' };
    }
    switch (stage) {
      case 0: return { title: '모집 중', body: '지원을 받고 있어요. 지원자를 수락하고, 선정을 마치면 모집을 마감하세요.' };
      case 1: return {
        title: '전시 준비',
        body: `수락한 작가들이 출품 자료를 내는 기간이에요. 자료가 모이면 전시를 확정하세요${startDate ? ` — 전시 시작일(${md(startDate)})이 되면 자동으로 확정돼요` : ''}.`,
      };
      case 2: return started
        ? { title: '전시 중', body: '작가의 출품 자료는 잠겨 있어요. 전시가 끝나면 전시를 종료하고 정산을 시작하세요.' }
        : { title: '전시 확정', body: '작가는 더 이상 출품 자료를 고칠 수 없어요(갤러리는 [대신 입력]으로 고칠 수 있어요). 전시가 끝나면 전시를 종료하세요.' };
      case 3: {
        if (!access.settlementRequested) {
          return { title: '전시 종료', body: '아래 정산에서 판매된 작품을 입력하고 작가에게 확인을 요청하세요. 작가가 모두 확인하면 정산을 완료합니다.' };
        }
        const st = settlement;
        if (st && st.total > 0 && st.approved >= st.total) {
          return { title: '정산 확인 완료', body: `작가 ${st.total}명 모두 금액을 확인했어요. 아래 정산에서 [정산 완료]를 누르면 끝나요.` };
        }
        if (st && st.issues > 0) {
          return { title: '정산 중', body: `작가 ${st.issues}명이 정산에 이의를 남겼어요. 아래 정산에서 사유를 보고 금액을 고치면 그 작가에게만 다시 확인 요청이 가요.` };
        }
        return { title: '정산 중', body: `작가들이 정산 내역을 확인하고 있어요${st ? ` · ${st.approved}/${st.total}명 확인` : ''}. 모두 확인하면 아래 정산에서 [정산 완료]를 누르세요.` };
      }
      default: return { title: '정산 완료', body: access.isAdmin ? '정산까지 끝난 공모예요. 관리자는 마감 뒤에도 고칠 수 있어요.' : '정산까지 끝나 마감된 공모예요. 내용은 계속 볼 수 있지만 고칠 수 없어요.' };
    }
  })();

  /** 다음 단계 확인창 — 누르면 무엇이 바뀌는지 */
  const askNext = () => {
    if (stage >= maxAdvance) return;
    const step = steps[stage]!;
    const back = '잘못 눌렀으면 [이전 단계로]로 되돌릴 수 있어요.';
    if (stage === 0) {
      setPending({
        kind: 'next', body: step.next, title: '모집을 마감할까요?', confirmText: '모집 마감',
        details: recruitOnly
          ? ['모집공고 목록에서 내려가고 더 이상 지원을 받지 않아요.', '이 공고는 여기서 끝나요 — 출품 자료·전시·정산 단계가 없어요.', back]
          : ['모집공고 목록에서 내려가고 더 이상 지원을 받지 않아요.', '받은 지원서와 수락 결과는 그대로예요.', '수락한 작가들이 출품 자료를 내기 시작해요.', back],
      });
    } else if (stage === 1) {
      setPending({
        kind: 'next', body: step.next, title: '전시를 확정할까요?', confirmText: '전시 확정',
        details: [
          '작가는 더 이상 출품 자료를 고칠 수 없어요. 갤러리는 [대신 입력]으로 계속 고칠 수 있어요.',
          ...(incompleteArtists > 0 ? [`출품 자료를 아직 다 내지 않은 작가가 ${incompleteArtists}명 있어요.`] : []),
          ...(startDate ? [`전시 시작일(${md(startDate)})이 되면 어차피 자동으로 확정돼요.`] : []),
          back,
        ],
      });
    } else {
      setPending({
        kind: 'next', body: step.next, title: '전시를 종료할까요?', confirmText: '전시 종료',
        details: ['정산이 열려요 — 판매된 작품과 판매가를 입력하고 작가에게 확인을 요청하세요.', '작가의 출품 자료는 잠긴 채로 기록이 남아요.', back],
      });
    }
  };

  const askBack = () => {
    if (stage <= 0 || stage > maxAdvance || cannotUndoConfirm) return;
    const body = steps[stage - 1]!.back;
    const details = stage === 1
      ? ['모집공고 목록에 다시 올라가고 지원을 다시 받아요.']
      : stage === 2
        ? ['작가가 출품 자료를 다시 고칠 수 있어요.']
        : ['정산 화면이 닫혀요. 입력해 둔 판매 내역은 그대로 남아요.'];
    setPending({ kind: 'back', body, title: `'${STEP_NODES[stage - 1]}' 을 되돌릴까요?`, details, confirmText: '되돌리기' });
  };

  /*
    정산을 시작하지 않은 채 전시가 끝난 지 오래된 공모는 목록에서 '종료된 공모' 로 정리된다.
    아무 말 없이 사라지면 갤러리는 자기 공모가 어디 갔는지 모르므로, 남은 기간을 여기서 알린다.
    (알림도 D+5·10·15 에 나가고, 20일째에 종료 통보가 간다 — lib/settlementReminder.ts)
    ⚠️ `access.ended` 로 거르면 안 된다 — 이 안내가 필요한 대표적인 대상이 [전시종료] 를 **누르지 않은** 갤러리다.
       판정은 자동 정리와 같은 기준인 **전시 종료일**로 한다(2026-08-20 E2E 에서 잡음).
  */
  const autoClose = (() => {
    if (recruitOnly || settled || access.settlementStarted) return null;
    if (!access.exhibitDate || !access.autoCloseDays) return null;
    const passed = daysSince(access.exhibitDate);
    if (passed < 0) return null;
    const left = access.autoCloseDays - passed;
    return left > 0
      ? `${left}일 뒤 이 공모는 [종료된 공모]로 정리돼요 — 전시가 끝나고 ${access.autoCloseDays}일 동안 판매·정산 입력이 없으면 목록을 정돈하려고 내려요. 정리된 뒤에도 거기서 정산을 이어서 할 수 있어요.`
      : `전시가 끝나고 ${access.autoCloseDays}일이 지나 [종료된 공모]로 정리되었어요. 정산은 여기서 그대로 이어서 할 수 있어요.`;
  })();

  return (
    <section className={className} aria-labelledby={`stage-${exhibitionId}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={`stage-${exhibitionId}`} className="text-base font-semibold text-gray-950">진행 단계</h3>
        {settled && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Lock size={12} aria-hidden /> 마감됨</span>
        )}
      </div>

      <ProgressSteps steps={nodes} current={stage} label="공모 진행 단계" className="mt-4 max-w-xl" />

      <p className="mt-5 text-sm leading-relaxed text-gray-600">
        <span className="font-semibold text-gray-950">지금 · {now.title}</span>
        <span className="mx-1.5 text-gray-300">|</span>
        {now.body}
      </p>

      {!locked && (stage < maxAdvance || (stage > 0 && stage <= maxAdvance && !cannotUndoConfirm)) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {stage < maxAdvance && (
            <button
              type="button"
              onClick={askNext}
              disabled={mutation.isPending}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {steps[stage]!.action}
              <ArrowRight size={15} aria-hidden />
            </button>
          )}
          {stage > 0 && stage <= maxAdvance && !cannotUndoConfirm && (
            <button
              type="button"
              onClick={askBack}
              disabled={mutation.isPending}
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline disabled:opacity-50"
            >
              <Undo2 size={14} aria-hidden /> 이전 단계로
            </button>
          )}
        </div>
      )}
      {stage === 2 && cannotUndoConfirm && !locked && (
        <p className="mt-2 text-xs text-gray-400">전시 시작일이 지나 자동으로 확정되었어요 — 되돌릴 수 없어요.</p>
      )}

      {autoClose && <Notice className="mt-4">{autoClose}</Notice>}

      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ''}
        details={pending?.details}
        confirmText={pending?.confirmText}
        onConfirm={() => { if (pending) mutation.mutate(pending.body); setPending(null); }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
