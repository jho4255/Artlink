import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { NoticesSection, MySubmissionSection, MyArtistSettlementSection } from '@/pages/OperationPage';
import Disclosure from '@/components/flow/Disclosure';
import Notice from '@/components/flow/Notice';
import { SUBMISSION_TERM, type TaskTarget } from '@/lib/flowLabels';

/**
 * 작가가 전시 하나를 처리하는 화면 — 마이페이지 [내 전시] 카드 안에 그대로 들어간다.
 *
 * ## 왜 여기로 옮겼나
 * 작가가 운영페이지에서 할 일은 **공지 읽기 · 출품 자료 · 정산 확인** 셋뿐이었다. 그것 때문에
 * 목록에서 카드를 누르고 → 운영페이지로 나가고 → 다시 돌아오는 왕복이 매번 생겼다.
 * 갤러리의 [내 공모]가 지원자 관리를 카드 안에서 하는 것과 같은 방식으로 맞췄다.
 *
 * ## 세 구역은 운영페이지와 **같은 컴포넌트**다
 * `pages/OperationPage` 가 export 하는 것을 그대로 쓴다. 복제하면 갈라진다 —
 * 특히 출품 자료 편집기는 갤러리의 '대신 입력'(proxyFor)과 같은 코드여야 한다(CLAUDE.md).
 * ⚠️ 페이지에서 컴포넌트를 가져오는 모양이 되지만, 반대 방향 import 가 없어 순환은 생기지 않는다.
 *
 * ## 접고 펴기 (`components/flow/Disclosure`)
 * **지금 할 일만 자동으로 펼친다** — 자료를 아직 안 냈으면 출품 자료, 갤러리가 정산 확인을 요청했으면 정산.
 * 전부 펼치면 카드 하나가 수천 px 이 되어 목록이 목록 구실을 못 한다.
 * 카드의 할 일 줄을 누르면(`focus`) 그 구역을 열고 스크롤한다.
 *
 * ## 공모만 진행하는 공고 (2026-09-10)
 * `exhibition.recruitOnly` 면 **공지 하나만** 남는다. 출품 자료·정산은 그 공고에 없는 단계라
 * 서버가 400 으로 막는다(`lib/exhibitionStage.ts`) — 구역을 남겨 두면 작가가 열자마자
 * 이유 없는 에러를 보고, 안 열더라도 **내지도 못할 자료를 기다리게** 된다.
 */
interface Props {
  exhibitionId: number;
  /** `/exhibitions/my-applications` 가 주는 exhibition 객체 */
  exhibition: {
    /** true = 공모만 진행(수락까지) — 출품 자료·정산 단계가 없다 */
    recruitOnly?: boolean;
    confirmed?: boolean;
    ended?: boolean;
    manualConfirmed?: boolean;
    settlementRequestedAt?: string | null;
    settledAt?: string | null;
    submissionDeadline?: string | null;
  };
  /** 출품작·약력·작가노트를 모두 냈는가 (서버 판정과 같은 값) */
  submissionComplete?: boolean;
  /** 카드의 할 일 줄을 눌렀을 때 열 구역 */
  focus?: { target: TaskTarget; seq: number } | null;
}

export default function ArtistOperationPanel({ exhibitionId, exhibition, submissionComplete, focus }: Props) {
  const { user } = useAuthStore();
  const id = String(exhibitionId);

  const recruitOnly = !!exhibition.recruitOnly;
  // 전시가 끝나기 전까지는 자료를 내는 게 할 일이다
  const needsSubmission = !recruitOnly && !submissionComplete && !exhibition.ended;
  // 갤러리가 확인을 요청했고 아직 정산이 확정되지 않았으면 작가가 답할 차례
  const needsSettlement = !!exhibition.settlementRequestedAt && !exhibition.settledAt;

  useEffect(() => {
    if (!focus?.target) return;
    const t = window.setTimeout(() => document.getElementById(`art-${id}-${focus.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => window.clearTimeout(t);
  }, [focus?.seq, focus?.target, id]);

  return (
    <div className="divide-y divide-gray-100">
      <Disclosure id={`art-${id}-notices`} title="운영 공지" defaultOpen={recruitOnly}>
        <NoticesSection exhibitionId={id} canManage={false} />
      </Disclosure>

      {/* 공모만 진행하는 공고엔 출품 자료 단계가 없다 — 여기까지가 끝이라고 말해 준다.
          아무 말 없이 구역만 사라지면 "자료를 언제 내나" 하고 기다리게 된다. */}
      {recruitOnly ? (
        <div className="py-4">
          <Notice>
            공모만 진행하는 공고예요. <b className="font-medium text-gray-900">선정(수락)으로 절차가 끝났고</b>, 출품 자료·전시·정산 단계는 없어요.
            이후 안내는 위 [운영 공지]로 전해져요.
          </Notice>
        </div>
      ) : (
        <Disclosure
          id={`art-${id}-submissions`}
          title={SUBMISSION_TERM}
          meta={submissionComplete ? '✓ 제출 완료' : exhibition.ended ? '제출 안 됨' : undefined}
          hint={needsSubmission ? '제출 필요' : undefined}
          defaultOpen={needsSubmission || focus?.target === 'submissions'}
          openSignal={focus?.target === 'submissions' ? focus.seq : null}
        >
          <MySubmissionSection
            exhibitionId={id}
            myUserId={user!.id}
            confirmed={!!exhibition.confirmed}
            ended={!!exhibition.ended}
            manualConfirmed={!!exhibition.manualConfirmed}
            submissionDeadline={exhibition.submissionDeadline ?? null}
          />
        </Disclosure>
      )}

      {/* 정산은 전시가 끝나야 생긴다 — 그전엔 구역 자리만 보여 준다(무엇이 남았는지 알게) */}
      {!recruitOnly && (exhibition.ended ? (
        <Disclosure
          id={`art-${id}-settlement`}
          title="정산 확인"
          meta={exhibition.settledAt ? '✓ 정산 완료' : undefined}
          hint={needsSettlement ? '확인 필요' : undefined}
          defaultOpen={needsSettlement || focus?.target === 'settlement'}
          openSignal={focus?.target === 'settlement' ? focus.seq : null}
        >
          <MyArtistSettlementSection exhibitionId={id} />
        </Disclosure>
      ) : (
        <Disclosure id={`art-${id}-settlement`} title="정산 확인" meta="전시가 끝나면 열려요" disabled />
      ))}
    </div>
  );
}
