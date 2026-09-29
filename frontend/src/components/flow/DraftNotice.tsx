import { useState } from 'react';
import Notice from '@/components/flow/Notice';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { savedAtLabel } from '@/lib/formDraft';

/**
 * 등록 폼 위의 "작성하던 ○○이 있어요" (2026-09-29) — 예전 `window.confirm('복원하시겠습니까?')` 를 대신한다.
 *
 * 브라우저 기본 창은 ①사이트 화면과 딴판이고 ②[취소]가 '나중에' 가 아니라 '버리기' 였다
 * (빈 폼에 입력하는 순간 자동저장이 옛 초안을 덮어썼다). 지금은 고를 때까지 폼 위에 남아 있고,
 * 고르기 전에는 아무것도 덮어쓰지 않는다(`lib/formDraft.ts`). [새로 쓰기]는 되돌릴 수 없어 한 번 더 묻는다.
 */
export default function DraftNotice({ title, summary, savedAt, onResume, onDiscard, className }: {
  /** '작성하던 공고가 있어요' — 조사까지 부르는 쪽이 적는다 */
  title: string;
  /** 초안의 제목 같은 것 — 무엇을 쓰다 말았는지 알아보게 */
  summary?: string | null;
  savedAt: number;
  onResume: () => void;
  onDiscard: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const when = savedAtLabel(savedAt);
  return (
    <>
      <Notice
        className={className}
        title={title}
        action={(
          <>
            <button type="button" onClick={onResume} className="min-h-[40px] rounded-lg bg-gray-900 px-3.5 text-sm font-medium text-white hover:bg-gray-800">
              이어서 쓰기
            </button>
            <button type="button" onClick={() => setAsking(true)} className="min-h-[40px] px-2 text-sm text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline">
              새로 쓰기
            </button>
          </>
        )}
      >
        {summary?.trim() ? <>“{summary.trim()}” · </> : null}{when} 저장
      </Notice>
      <ConfirmDialog
        open={asking}
        title="작성하던 내용을 지우고 새로 쓸까요?"
        details={[`${when}에 저장한 내용이 지워져요.`, '지운 내용은 되돌릴 수 없어요.']}
        confirmText="지우고 새로 쓰기"
        variant="danger"
        onConfirm={() => { setAsking(false); onDiscard(); }}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
