import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { Completeness, CompletenessItem } from '@/lib/completeness';

/**
 * 홈페이지 완성도 **한 줄** — "N/5 완료 · 남은 것" + 남은 항목 칩 (2026-10-02)
 *
 * 두 곳이 같은 줄을 쓴다.
 *  - 홈페이지 편집 화면의 머리 — 칩이 **버튼**(`onItem`)이다. 그 자리에서 묶음을 바꾼다
 *    (링크면 쓰던 글 때문에 이탈 경고가 뜬다).
 *  - 마이페이지 [프로필] 탭(`ArtistHomepageLine`) — 칩이 **링크**다. 편집 화면의 그 묶음·그 칸으로 간다(`item.href` = `editHref`).
 *
 * 무엇이 남았는지는 `lib/completeness.ts` 하나가 정한다 — 로그인 팝업(`HomepageNudge`)과 같은 판정이라 세 곳이 다른 답을 내지 않는다.
 * 다 채웠으면 아무것도 그리지 않는다.
 * ⚠️ **한 줄**이다. 좁은 화면에서 칩이 넘치면 옆으로 민다 — 줄바꿈하면 그만큼 아래 내용이 밀린다(편집 화면에서는 첫 화면의 업로드 버튼이 밀렸다).
 */
const chip = 'inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:border-gray-500';

export default function CompletenessLine({ completeness, onItem, className }: {
  completeness: Completeness;
  /** 주면 칩이 버튼이 된다(그 자리에서 처리). 안 주면 칩은 `item.href` 로 가는 링크다 */
  onItem?: (item: CompletenessItem) => void;
  className?: string;
}) {
  const missing = completeness.items.filter((it) => !it.done);
  if (missing.length === 0) return null;
  return (
    <section aria-label="홈페이지 완성도" className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      <p className="text-sm text-gray-600">
        홈페이지 완성도 <b className="font-semibold text-gray-950">{completeness.done}/{completeness.total} 완료</b>
        <span className="text-gray-400"> · 남은 것</span>
      </p>
      <ul className="flex max-w-full gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {missing.map((it) => {
          // 보이는 글자는 짧은 이름(칩), 읽어 주는 이름은 긴 이름 — "작품 정보" ↔ "작품 정보 채우기 2/4"
          const name = `${it.label}${it.progress ? ` ${it.progress}` : ''}`;
          const body = <>{it.short}{it.progress && <span className="font-normal tabular-nums text-gray-500">{it.progress}</span>}</>;
          return (
            <li key={it.key} className="shrink-0">
              {onItem
                ? <button type="button" onClick={() => onItem(it)} title={it.label} aria-label={name} className={chip}>{body}</button>
                : <Link to={it.href} title={it.label} aria-label={name} className={chip}>{body}</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
