import { useState } from 'react';
import { ChevronDown, Megaphone, FileText, Wallet } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { NoticesSection, MySubmissionSection, MyArtistSettlementSection } from '@/pages/OperationPage';

/**
 * 작가가 전시 하나를 처리하는 화면 — 마이페이지 [내 전시] 카드 안에 그대로 들어간다.
 *
 * ## 왜 여기로 옮겼나
 * 작가가 운영페이지에서 할 일은 **공지 읽기 · 제출자료 · 정산 확인** 셋뿐이었다. 그것 때문에
 * 목록에서 카드를 누르고 → 운영페이지로 나가고 → 다시 돌아오는 왕복이 매번 생겼다.
 * 갤러리의 [내 공모]가 지원자 관리를 카드 안에서 하는 것과 같은 방식으로 맞췄다.
 *
 * ## 세 블록은 운영페이지와 **같은 컴포넌트**다
 * `pages/OperationPage` 가 export 하는 것을 그대로 쓴다. 복제하면 갈라진다 —
 * 특히 제출자료 편집기는 갤러리의 '대신 입력'(proxyFor)과 같은 코드여야 한다(CLAUDE.md).
 * ⚠️ 페이지에서 컴포넌트를 가져오는 모양이 되지만, 반대 방향 import 가 없어 순환은 생기지 않는다.
 *    (운영페이지는 이 패널을 쓰지 않는다 — 작가는 그 페이지에 오면 마이페이지로 되돌아간다)
 *
 * ## 접고 펴기
 * 세 블록 모두 접을 수 있고, **지금 할 일만 자동으로 펼친다**:
 *   - 자료를 아직 안 냈으면 → 제출자료
 *   - 갤러리가 정산 확인을 요청했으면 → 정산
 * 전부 펼치면 카드 하나가 수천 px 이 되어 목록이 목록 구실을 못 한다.
 */
interface Props {
  exhibitionId: number;
  /** `/exhibitions/my-applications` 가 주는 exhibition 객체 */
  exhibition: {
    confirmed?: boolean;
    ended?: boolean;
    manualConfirmed?: boolean;
    settlementRequestedAt?: string | null;
    settledAt?: string | null;
  };
  /** 출품리스트·약력·작가노트를 모두 냈는가 (서버 판정과 같은 값) */
  submissionComplete?: boolean;
}

function Block({
  icon, title, hint, defaultOpen, children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  /* 상자를 두르지 않는다 — 카드 안에 상자를 또 넣으면 테두리가 겹쳐 시끄럽다.
     구분선 + 작은 제목 줄만으로 나눈다(갤러리 운영 카드의 안쪽 구획과 같은 방식). */
  return (
    <div className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1 text-left cursor-pointer group"
      >
        <span className="text-gray-300 shrink-0">{icon}</span>
        <span className="text-sm font-medium text-gray-700 group-hover:text-gray-950">{title}</span>
        {/* 할 일이 있으면 접혀 있어도 알 수 있어야 한다 */}
        {hint && <span className="text-[11px] text-[#c4302b] whitespace-nowrap">{hint}</span>}
        <ChevronDown size={14} className={`ml-auto shrink-0 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  );
}

export default function ArtistOperationPanel({ exhibitionId, exhibition, submissionComplete }: Props) {
  const { user } = useAuthStore();
  const id = String(exhibitionId);

  // 전시가 끝나기 전까지는 자료를 내는 게 할 일이다
  const needsSubmission = !submissionComplete && !exhibition.ended;
  // 갤러리가 확인을 요청했고 아직 정산이 확정되지 않았으면 작가가 답할 차례
  const needsSettlement = !!exhibition.settlementRequestedAt && !exhibition.settledAt;

  return (
    <div>
      <Block icon={<Megaphone size={14} />} title="운영 공지" defaultOpen={false}>
        <NoticesSection exhibitionId={id} canManage={false} />
      </Block>

      <Block
        icon={<FileText size={14} />}
        title="제출 자료"
        hint={needsSubmission ? '아직 안 냈습니다' : undefined}
        defaultOpen={needsSubmission}
      >
        <MySubmissionSection
          exhibitionId={id}
          myUserId={user!.id}
          confirmed={!!exhibition.confirmed}
          ended={!!exhibition.ended}
          manualConfirmed={!!exhibition.manualConfirmed}
        />
      </Block>

      {/* 정산은 전시가 끝나야 생긴다 — 그전엔 블록 자체를 그리지 않는다 */}
      {exhibition.ended && (
        <Block
          icon={<Wallet size={14} />}
          title="정산 확인"
          hint={needsSettlement ? '확인이 필요합니다' : undefined}
          defaultOpen={needsSettlement}
        >
          <MyArtistSettlementSection exhibitionId={id} />
        </Block>
      )}
    </div>
  );
}
