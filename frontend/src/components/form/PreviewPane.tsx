import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/** 미리보기 하나 — 어느 화면인지(공고 상세 · 갤러리 홈페이지 · 전시 상세)와 그 모습 */
export interface Preview { label: string; node: ReactNode }

/**
 * 등록 화면의 미리보기(2026-11-15). 그리는 건 **실제 상세 부품**이다(흉내 내면 화면이 바뀔 때 혼자 낡는다 —
 * 옛 갤러리 등록이 '실제 모습' 이라며 바뀌기 전 상세를 흉내 내고 있었다).
 * 상세 화면 하나만 보여 준다 — 목록(찾기) 카드 미리보기는 뺐다(2026-11-15 사용자 결정: "갤러리 홈페이지만 되면 된다, 전시·모집공고도 찾기는 안 해도 된다").
 *  · 넓은 화면(xl) — 폼 오른쪽에 붙어 따라오는 칸(`PreviewAside`, 300px)
 *    ⚠️ 칸을 넓히지 말 것 — 1280px 에서 입력 칸이 좁아져 일정 달력이 두 달에서 한 달로 줄어든다(달력은 칸 폭 560px 이상이면 두 달, e2e 77 A)
 *  · 좁은 화면 — 하단 줄의 [미리보기] → 화면 가득(`PreviewSheet`)
 */
export function PreviewAside({ preview }: { preview: Preview }) {
  return (
    <aside aria-label="미리보기" className="sticky top-28 self-start">
      <div className="rounded-lg border border-gray-200 px-5 pb-6 pt-5">
        <h2 className="text-[12px] font-semibold text-gray-600">{preview.label}</h2>
        <div className="mt-3">{preview.node}</div>
      </div>
    </aside>
  );
}

export function PreviewSheet({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  useEscapeKey(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label="미리보기" className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 pl-6 pr-3">
        <p className="text-base font-semibold text-gray-900">미리보기</p>
        <button type="button" onClick={onClose} aria-label="닫기" className="grid h-11 w-11 place-items-center text-gray-700">
          <X size={20} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
        <h2 className="text-[12px] font-semibold text-gray-600">{preview.label}</h2>
        <div className="mt-3">{preview.node}</div>
      </div>
    </div>
  );
}
