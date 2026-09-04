/**
 * @멘션 자동완성 — 글쓰기 칸과 댓글 칸이 함께 쓴다.
 *
 * 부를 수 있는 사람은 **ArtLink(운영) + 서로 이웃**뿐이다. 그 판정은 전부 서버가 하고
 * (`GET /api/mentions`), 화면은 받은 목록을 그리기만 한다 — 규칙을 양쪽에 적으면 어긋난다.
 *
 * ⚠️ 목록이 비면 **아무것도 그리지 않는다**(빈 상자가 뜨면 고장으로 보인다).
 *    서로 이웃이 아직 없는 사람에게는 ArtLink 하나만 뜨는 게 정상이다.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { mentionQueryAt, applyMention, type MentionSpan } from '@/lib/mention';

export interface MentionOption { label: string; id: number | null; avatar: string | null; role: string }

type Field = HTMLTextAreaElement | HTMLInputElement;

/**
 * 입력칸 하나에 멘션을 붙인다.
 *
 * ```tsx
 * const m = useMention(text, setText);
 * <textarea ref={m.ref} value={text} onChange={m.onChange} onBlur={m.onBlur} />
 * <MentionSuggest {...m.suggest} />
 * ```
 */
export function useMention(value: string, setValue: (v: string) => void) {
  const ref = useRef<Field | null>(null);
  const [span, setSpan] = useState<MentionSpan | null>(null);

  const { data: options } = useQuery<MentionOption[]>({
    queryKey: ['mentions', span?.query ?? ''],
    queryFn: () => api.get('/mentions', { params: { q: span?.query ?? '' } }).then((r) => r.data),
    enabled: span != null,
    staleTime: 60_000,   // 이웃 목록은 자주 안 바뀐다 — 글자마다 새로 받지 않게
  });

  const onChange = (e: React.ChangeEvent<Field>) => {
    const el = e.target;
    setValue(el.value);
    setSpan(mentionQueryAt(el.value, el.selectionStart ?? el.value.length));
  };

  const pick = (label: string) => {
    const el = ref.current;
    if (!span || !el) return;
    const next = applyMention(value, span, el.selectionStart ?? value.length, label);
    setValue(next.text);
    setSpan(null);
    // 끼워 넣은 뒤 커서를 그 뒤로 — 안 하면 맨 끝으로 튄다
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.cursor, next.cursor); });
  };

  return {
    ref,
    onChange,
    /** 목록을 누르는 것도 blur 라 곧바로 닫으면 클릭이 죽는다 — 한 박자 뒤에 닫는다 */
    onBlur: () => setTimeout(() => setSpan(null), 150),
    suggest: { options: span ? options : undefined, onPick: pick },
  };
}

/** 입력칸 바로 아래 뜨는 목록. 부모에 `relative` 가 있어야 한다. */
export function MentionSuggest({ options, onPick }: { options?: MentionOption[]; onPick: (label: string) => void }) {
  if (!options || options.length === 0) return null;
  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onMouseDown={(e) => e.preventDefault()}   // blur 보다 먼저 — 안 그러면 목록이 닫히며 클릭이 사라진다
          onClick={() => onPick(o.label)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
        >
          {o.avatar
            ? <img src={o.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
            : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500">
                {o.label.slice(0, 1)}
              </span>}
          <span className="min-w-0 flex-1 truncate text-sm text-gray-800">@{o.label}</span>
          {o.id === null && <span className="shrink-0 text-[11px] font-medium text-[#dc3545]">운영</span>}
        </button>
      ))}
    </div>
  );
}
