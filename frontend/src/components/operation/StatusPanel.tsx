/**
 * 공모 진행 단계 — 모집마감 → 확정 → 전시종료 → 정산 완료
 *
 * ── 왜 공용 컴포넌트인가 ────────────────────────────────────
 * `OperationPage`(신규)와 `OperationClassicPage`(클래식)에 **완전히 같은 코드가 복붙**돼 있었다
 * (다른 곳은 바깥 `<section>` className 한 줄뿐). 정산 섹션과 같은 이유로 한 벌로 합친다.
 *
 * ── 4번째 단계 '정산 완료' ──────────────────────────────────
 * 예전엔 스텝퍼가 전시종료(3단계)에서 끝나고, 정산이 끝났는지는 머리말의 작은 배지로만 알 수 있었다.
 * 그래서 "이 공모 완전히 끝난 건가?"를 화면에서 바로 알 수 없었다. 마지막 노드를 하나 더 둔다.
 *
 * ⚠️ 앞 3단계와 성격이 다르다 — **버튼으로 넘어가는 단계가 아니다.**
 *    정산은 작가 확인을 거쳐야 하므로 아래 정산 섹션의 [정산 완료]로만 도달한다.
 *    그래서 `LIFECYCLE_STEPS`(버튼이 쓰는 배열)는 3개 그대로 두고, 그리기용 노드만 4개로 만든다.
 *    여기를 합치면 [다음 단계로] 버튼이 정산을 건너뛰고 마감시켜 버린다.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ArrowRight, Undo2, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import type { OperationAccess } from '@/types';

/** 버튼으로 진행하는 단계들 (정산 완료는 여기 넣지 말 것 — 위 주석 참고) */
const LIFECYCLE_STEPS: { label: string; desc: string; next: Record<string, boolean>; back: Record<string, boolean> }[] = [
  { label: '모집마감', desc: '모집공고가 목록에서 내려갑니다.', next: { recruitmentClosed: true }, back: { recruitmentClosed: false } },
  { label: '확정', desc: '작가의 전시정보 수정이 잠깁니다. (전시 시작일이 지나면 자동 확정)', next: { confirmed: true }, back: { confirmed: false } },
  { label: '전시종료', desc: '정산 단계로 전환되며 아래에 정산 입력이 나타납니다.', next: { ended: true }, back: { ended: false } },
];

/**
 * 전시 종료일로부터 며칠 지났는가 (KST 달력 날짜 기준).
 * 순수 시간 차이로 재면 자정 직후/직전에 하루가 어긋난다(CLAUDE.md 14).
 */
function daysSince(date: string): number {
  const KST = 9 * 60 * 60 * 1000, DAY = 24 * 60 * 60 * 1000;
  const kstDay = (t: number) => Math.floor((t + KST) / DAY);
  return kstDay(Date.now()) - kstDay(new Date(date).getTime());
}

/** 스텝퍼에 그릴 노드 — 마지막 '정산 완료'는 표시 전용 */
const STEP_NODES = [...LIFECYCLE_STEPS.map((s) => s.label), '정산 완료'];
const LAST = STEP_NODES.length;   // 4 = 완전히 마감

export default function StatusPanel({ exhibitionId, access, className = 'mb-8 border border-gray-200 rounded-xl p-5' }: { exhibitionId: string; access: OperationAccess; className?: string }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch(`/operations/${exhibitionId}/lifecycle`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-access', exhibitionId] }); qc.invalidateQueries({ queryKey: ['exhibitions'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '변경 실패'),
  });

  const settled = !!access.settled;
  const locked = settled && !access.isAdmin;   // 관리자는 완료 후에도 수정 가능
  // 현재 단계: 0=모집중, 1=모집마감, 2=확정, 3=전시종료, 4=정산 완료(마감)
  const stage = settled ? 4 : access.ended ? 3 : access.confirmed ? 2 : access.recruitmentClosed ? 1 : 0;
  const stageLabel = ['모집중', '모집마감', '확정', '전시종료', '정산 완료'][stage];

  const goNext = () => {
    if (stage >= 3) return;
    const step = LIFECYCLE_STEPS[stage]!;
    if (step.next.ended && !window.confirm('전시를 종료하고 정산 단계로 넘어갈까요?')) return;
    mutation.mutate(step.next);
  };
  // 전시 시작일 경과 등으로 자동 확정된 '확정' 단계는 되돌리기가 백엔드에서 거부됨 → 버튼 비활성
  const cannotUndoConfirm = stage === 2 && access.confirmed && !access.manualConfirmed;
  const goPrev = () => {
    if (stage <= 0 || stage > 3) return;
    if (cannotUndoConfirm) return;
    mutation.mutate(LIFECYCLE_STEPS[stage - 1]!.back);
  };

  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-medium text-gray-900">공모 진행 단계</h2>
        {settled && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            <Lock size={11} /> 마감됨
          </span>
        )}
      </div>

      {/* 스텝퍼 — 마지막 노드(정산 완료)는 settledAt 으로만 채워진다 */}
      <div className="flex items-center">
        {STEP_NODES.map((label, i) => {
          const idx = i + 1;                 // 이 노드가 나타내는 단계
          const done = stage >= idx;         // 도달 완료
          const target = stage + 1 === idx;  // 다음에 진행할 단계
          const isFinal = idx === LAST;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  done
                    ? (isFinal ? 'bg-green-600 text-white' : 'bg-gray-900 text-white')
                    : target ? 'bg-white text-gray-900 ring-2 ring-gray-900'
                    : 'bg-gray-100 text-gray-400'}`}>
                  {done ? <Check size={16} /> : idx}
                </div>
                <span className={`mt-1.5 text-xs whitespace-nowrap ${
                  done && isFinal ? 'text-green-700 font-medium'
                    : done || target ? 'text-gray-900 font-medium'
                    : 'text-gray-400'}`}>{label}</span>
              </div>
              {i < STEP_NODES.length - 1 && (
                <div className={`h-0.5 flex-1 mx-2 mb-5 rounded-full transition-colors ${stage >= idx + 1 ? (idx + 1 === LAST ? 'bg-green-600' : 'bg-gray-900') : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* 현재 상태 + 안내 */}
      <p className="text-xs text-gray-500 mt-4 leading-relaxed">
        현재 <b className={stage === LAST ? 'text-green-700' : 'text-gray-900'}>{stageLabel}</b> 단계입니다.
        {stage < 3 && <> 다음 단계: <b className="text-gray-900">{LIFECYCLE_STEPS[stage]!.label}</b> — {LIFECYCLE_STEPS[stage]!.desc}</>}
        {/* 전시종료 상태에서는 다음이 버튼이 아니라 정산 절차라는 걸 알려준다.
            이미 요청을 보낸 뒤인지에 따라 할 일이 다르므로 문구를 나눈다 —
            전원 수락해 놓고 "확인 요청을 보내세요" 라고 하면 뭘 더 해야 하는지 알 수 없다. */}
        {stage === 3 && (access.settlementRequested
          ? <> 다음 단계: <b className="text-gray-900">정산 완료</b> — 작가 확인이 끝나면 아래 정산에서 [정산 완료]를 누르면 마감됩니다.</>
          : <> 다음 단계: <b className="text-gray-900">정산 완료</b> — 아래 정산에서 [정산 확인 요청]을 보내고 작가 확인을 받으면 마감됩니다.</>)}
        {stage === 2 && access.confirmed && !access.manualConfirmed && <span className="text-gray-400"> (전시 시작일 경과로 자동 확정됨)</span>}
      </p>

      {/*
        정산을 시작하지 않은 채 전시가 끝난 지 오래된 공모는 목록에서 '종료된 공모' 로 정리된다.
        아무 말 없이 사라지면 갤러리는 자기 공모가 어디 갔는지 모르므로, 남은 기간을 여기서 알린다.
        (알림도 D+5·10·15 에 나가고, 20일째에 종료 통보가 간다 — lib/settlementReminder.ts)
        정산을 이미 시작했으면 정리 대상이 아니라 띄우지 않는다.
      */}
      {(() => {
        if (settled || access.settlementStarted) return null;
        if (!access.exhibitDate || !access.autoCloseDays) return null;
        // ⚠️ `access.ended` 로 거르면 안 된다 — 이 안내가 필요한 대표적인 대상이
        //    [전시종료] 를 **누르지 않은** 갤러리다. 그 사람들은 ended=false 라 안내를 못 본다
        //    (2026-08-20 E2E 에서 잡음). 판정은 자동 정리와 같은 기준인 **전시 종료일**로 한다.
        const passed = daysSince(access.exhibitDate);
        if (passed < 0) return null;   // 아직 전시가 안 끝났다
        const left = access.autoCloseDays - passed;
        return left > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 leading-relaxed">
            <b>{left}일 뒤</b>에 이 공모는 <b>종료된 공모</b>로 정리됩니다. 전시 종료 후 {access.autoCloseDays}일 동안
            판매·정산 입력이 없으면 목록을 정돈하기 위해 자동으로 내려갑니다.
            <span className="text-amber-800/80"> 정리된 뒤에도 [종료된 공모] 탭에서 정산을 이어서 하실 수 있습니다.</span>
          </p>
        ) : (
          <p className="mt-3 rounded-lg bg-gray-100 border border-gray-200 px-3 py-2 text-xs text-gray-700 leading-relaxed">
            전시 종료 후 {access.autoCloseDays}일이 지나 <b>종료된 공모</b>로 정리되었습니다.
            정산은 여기서 그대로 이어서 하실 수 있습니다.
          </p>
        );
      })()}

      {/* 액션 */}
      {locked ? (
        <p className="text-xs text-gray-500 mt-3">· <b className="text-green-700">정산이 완료되어 마감된 공모</b>입니다. 내용은 계속 열람할 수 있지만 수정할 수 없습니다.</p>
      ) : (
        <div className="flex items-center gap-2 mt-4">
          {stage < 3 && (
            <button
              onClick={goNext}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
            >
              다음 단계로 — {LIFECYCLE_STEPS[stage]!.label}
              <ArrowRight size={15} />
            </button>
          )}
          {stage > 0 && stage <= 3 && !cannotUndoConfirm && (
            <button
              onClick={goPrev}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
            >
              <Undo2 size={14} /> 이전 단계로
            </button>
          )}
          {settled && access.isAdmin && (
            <span className="text-xs text-gray-500">관리자는 마감 후에도 수정할 수 있습니다.</span>
          )}
        </div>
      )}
    </section>
  );
}
