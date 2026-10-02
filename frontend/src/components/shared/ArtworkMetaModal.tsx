import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { composeSize, museumCaption, splitSize } from '@/lib/artwork';
import type { ArtworkStatus, PortfolioImage } from '@/types';

export interface ArtworkMetaDraft {
  title: string;
  series: string;
  medium: string;
  sizeText: string;
  year: string;
  description: string;
  status: ArtworkStatus | '';
}

export function toDraft(img: PortfolioImage): ArtworkMetaDraft {
  return {
    title: img.title ?? '',
    series: img.series ?? '',
    medium: img.medium ?? '',
    sizeText: img.sizeText ?? '',
    year: img.year ?? '',
    description: img.description ?? '',
    status: img.status ?? '',
  };
}

const STATUSES: { value: ArtworkStatus | ''; label: string }[] = [
  { value: '', label: '표기 안 함' },
  { value: 'AVAILABLE', label: '판매 가능' },
  { value: 'SOLD', label: '판매 완료' },
  { value: 'NFS', label: '비매' },
];

/** 기본 칸(캡션에 들어가는 것) — Enter 는 이 순서로 **다음 칸**에 커서를 옮긴다 */
const MAIN_FIELDS = ['meta-title', 'meta-year', 'meta-medium', 'meta-size-h', 'meta-size-w'];
const isFinePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

const field = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400';
const label = 'text-sm font-medium text-gray-800 block mb-1.5';

interface Props {
  image: PortfolioImage;
  /** 이미 등록된 시리즈명 — 오타로 시리즈가 갈라지지 않게 자동완성으로 제시한다 */
  seriesOptions: string[];
  /** 이 작가가 다른 작품에 이미 쓴 재료·연도 — 칩을 누르면 채워진다(`lib/homepageEdit.ts recentValues`) */
  suggestions?: { medium: string[]; year: string[] };
  /** 이 작품 말고 정보가 없는 작품 수 — 머리에 '정보 없는 작품 N점 남음' */
  remaining?: number;
  /** 저장하고 이어서 열 작품이 있는가 — 있으면 주 버튼이 [저장하고 다음 작품] 이 된다 */
  hasNext?: boolean;
  saving?: boolean;
  /** `next` 가 true 면 저장한 뒤 창을 닫지 않고 다음 작품(정보 없는 것)을 연다 — 부모가 `image` 를 갈아끼운다 */
  onSave: (draft: ArtworkMetaDraft, next: boolean) => void;
  onClose: () => void;
}

/** 전에 쓴 값 — 누르면 그 칸에 채워진다 */
function Suggest({ values, current, onPick }: { values: string[]; current: string; onPick: (v: string) => void }) {
  const list = values.filter((v) => v !== current.trim());
  if (list.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-400">전에 쓴 값</span>
      {list.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="max-w-full truncate rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400"
        >{v}</button>
      ))}
    </div>
  );
}

/**
 * 작품 정보 입력 — 포트폴리오의 핵심 보강.
 *
 * 레퍼런스 포트폴리오는 예외 없이 작품마다 [제목/재료/크기/연도]를 붙인다. 우리 쪽엔 이 정보가
 * 아예 없어서 PDF를 만들면 캡션이 통째로 빠진 "이미지 더미"가 나왔다. 여기서 그 값을 받는다.
 * 크기는 **세로·가로** 숫자로만 받아 `composeSize`로 한 형식(90.9×72.7 cm)으로 합성한다 — 관례가 높이 먼저다(2026-09-16).
 *
 * ## 2026-10-02 — 이어서 넣게 했다
 * 실서버 작품 451점 중 작품명이 있는 건 80점(18%), 작품이 있는 작가 47명 중 38명은 작품 정보가 전부 비어 있었다.
 * 창이 한 점씩 열리고 **저장하면 닫혀서** 27점이면 27번 열고 닫아야 했다. 지금은:
 *  - **[저장하고 다음 작품]** — 저장한 뒤 창을 닫지 않고 정보 없는 다음 작품으로 넘어간다.
 *  - **전에 쓴 값** — 같은 재료·같은 해의 작품이 이어지므로 한 번 누르면 채워진다.
 *  - **홈페이지에 이렇게 나옵니다** — 넣는 대로 캡션이 보인다. 칸 순서도 캡션 순서(작품명 · 연도 · 재료 · 크기)다.
 *  - 그 아래는 '선택' — 시리즈·판매 상태·작품 설명. 일곱 칸이 같은 무게로 놓여 있어 어디까지 채워야 하는지 알 수 없었다.
 *
 * ⚠️ **Enter 는 저장이 아니라 '다음 칸'이다.** Enter 를 주 버튼(저장하고 다음 작품)으로 두면, 작품명만 치고 Enter 를 누른 사람은
 *    연도·재료·크기를 건너뛴 채 사진이 다음 작품으로 바뀐 화면을 본다(아이폰 자판의 [이동] 키도 Enter 다).
 *    그래서 버튼은 전부 `type="button"` 이고(제출 버튼이 없으면 브라우저가 Enter 로 폼을 내지 않는다) 칸 → 칸으로 옮긴다.
 *    마지막 칸(가로)에서만 주 버튼인데, 그것도 마우스·키보드 화면에서만 — 휴대폰 숫자 자판의 [완료] 는 자판을 내리는 키다.
 *    Ctrl/⌘+Enter 는 어느 칸에서든 주 버튼.
 */
export default function ArtworkMetaModal({ image, seriesOptions, suggestions, remaining = 0, hasNext = false, saving, onSave, onClose }: Props) {
  const [d, setD] = useState<ArtworkMetaDraft>(() => toDraft(image));
  const parsed = useMemo(() => splitSize(d.sizeText), [d.sizeText]);
  const [h, setH] = useState(parsed.h);
  const [w, setW] = useState(parsed.w);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // 다른 작품으로 갈아끼우면 폼도 그 작품 값으로 새로 채우고, 맨 위(작품명)에서 다시 시작한다
  /** 바로 앞에 보여 준 작품 — '다음 작품으로 넘어왔는가'를 이걸로 가린다 */
  const shownId = useRef<number | null>(null);
  useEffect(() => {
    const next = toDraft(image);
    setD(next);
    const p = splitSize(next.sizeText);
    setH(p.h); setW(p.w);
    bodyRef.current?.scrollTo({ top: 0 });
    // 처음 열 때 휴대폰에서는 커서를 두지 않는다 — 자판이 올라와 창의 절반(사진·캡션)을 가린다.
    // [저장하고 다음 작품] 으로 넘어올 땐 이미 자판이 올라와 있으므로 작품명에 커서를 이어 준다.
    // ⚠️ '처음인가'를 불리언 플래그로 두지 말 것 — 개발 모드(StrictMode)는 마운트 때 effect 를 두 번 돌려,
    //    두 번째에는 이미 '열린 적 있음'이 되어 휴대폰에서도 커서가 들어간다(E2E 가 잡았다). 작품 id 로 비교하면 두 번 돌아도 같다.
    const switched = shownId.current !== null && shownId.current !== image.id;
    shownId.current = image.id;
    if (switched || isFinePointer()) titleRef.current?.focus({ preventScroll: true });
  }, [image.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 값을 바꿨으면 ESC·바깥 클릭·[취소]에서 한 번 묻는다 — 설명은 2000자까지 쓰는 칸이라 확인 없이 닫히면 통째로 잃는다(감사 M23)
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(image));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const requestClose = () => {
    if (dirtyRef.current && !window.confirm('작성 중인 내용이 있습니다. 저장하지 않고 닫을까요?')) return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<ArtworkMetaDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const setSize = (nh: string, nw: string) => { setH(nh); setW(nw); set({ sizeText: composeSize(nh, nw) }); };

  // 넣는 대로 보이는 캡션 — 홈페이지와 **같은 함수**(museumCaption)라 실제와 어긋나지 않는다
  const cap = museumCaption(d);
  /** 주 버튼 — 다음 작품이 있으면 저장하고 이어서 넣는다 */
  const primary = () => { if (!saving) onSave(d, hasNext); };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    // ⚠️ 한글을 치는 중의 Enter 는 건드리지 않는다 — 조합 중인 마지막 글자가 두 번 들어간다
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); primary(); return; }
    const t = e.target as HTMLElement;
    const i = t.tagName === 'INPUT' ? MAIN_FIELDS.indexOf(t.id) : -1;
    if (i === -1) return;   // 설명(줄바꿈)·시리즈(자동완성 고르기)·버튼은 브라우저가 하던 대로
    e.preventDefault();
    if (i < MAIN_FIELDS.length - 1) document.getElementById(MAIN_FIELDS[i + 1]!)?.focus();
    else if (isFinePointer()) primary();
    else (t as HTMLInputElement).blur();   // 휴대폰: 자판만 내린다
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={requestClose}>
      <form
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        className="bg-white w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="작품 정보"
      >
        <div className="shrink-0 border-b border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-[15px]">작품 정보</h3>
            {remaining > 0 && <p data-testid="meta-remaining" className="text-xs text-gray-500">이 작품 말고 정보 없는 작품 {remaining}점</p>}
          </div>
          <button type="button" onClick={requestClose} className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center text-gray-400 hover:text-gray-900" aria-label="닫기"><X size={18} /></button>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex gap-4 items-center">
            <img src={image.url} alt="" className="w-24 h-24 object-contain bg-gray-50 rounded-lg flex-none" />
            <div className="flex-1 min-w-0" data-testid="meta-caption-preview">
              <p className="text-xs text-gray-400">홈페이지에 이렇게 나옵니다</p>
              {cap ? (
                <div className="mt-1 text-[13px] leading-snug text-gray-500 break-keep [overflow-wrap:anywhere]">
                  {cap.head && <p className="text-sm font-medium text-gray-900">{cap.head}</p>}
                  {cap.medium && <p>{cap.medium}</p>}
                  {cap.size && <p>{cap.size}</p>}
                </div>
              ) : (
                <p className="mt-1 text-[13px] leading-snug text-gray-400 break-keep">아래에 적는 대로 작품 아래에 붙습니다. 아는 것만 채워도 됩니다.</p>
              )}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="meta-title">작품명</label>
            <input id="meta-title" ref={titleRef} value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="예: 리본이 피는 나무" enterKeyHint="next" className={field} autoComplete="off" />
          </div>

          <div>
            <label className={label} htmlFor="meta-year">제작연도</label>
            <input id="meta-year" value={d.year} onChange={(e) => set({ year: e.target.value })} placeholder="예: 2025" inputMode="numeric" enterKeyHint="next" className={field} autoComplete="off" />
            <Suggest values={suggestions?.year ?? []} current={d.year} onPick={(v) => set({ year: v })} />
          </div>

          <div>
            <label className={label} htmlFor="meta-medium">재료</label>
            <input id="meta-medium" value={d.medium} onChange={(e) => set({ medium: e.target.value })} placeholder="예: 캔버스에 유채 · Acrylic on canvas" enterKeyHint="next" className={field} autoComplete="off" />
            <Suggest values={suggestions?.medium ?? []} current={d.medium} onPick={(v) => set({ medium: v })} />
          </div>

          <div role="group" aria-labelledby="meta-size-label">
            <p id="meta-size-label" className={label}>크기 <span className="font-normal text-gray-400">세로 × 가로</span></p>
            <div className="flex items-center gap-2">
              <input id="meta-size-h" value={h} onChange={(e) => setSize(e.target.value, w)} placeholder="세로" aria-label="세로" inputMode="decimal" enterKeyHint="next" className={`${field} text-center`} autoComplete="off" />
              <span className="text-gray-400 text-sm" aria-hidden>×</span>
              <input id="meta-size-w" value={w} onChange={(e) => setSize(h, e.target.value)} placeholder="가로" aria-label="가로" inputMode="decimal" enterKeyHint="done" className={`${field} text-center`} autoComplete="off" />
              <span className="text-xs text-gray-500 shrink-0">cm</span>
            </div>
          </div>

          {/* ── 선택 — 여기부터는 안 채워도 캡션이 완성된다 ── */}
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <p className="text-xs font-medium text-gray-400">선택</p>

            <div>
              <label className={label} htmlFor="meta-series">시리즈 <span className="font-normal text-gray-400">같은 시리즈끼리 묶여 보입니다</span></label>
              <input
                id="meta-series"
                value={d.series}
                onChange={(e) => set({ series: e.target.value })}
                list="artwork-series-options"
                placeholder="예: 산 시리즈 (없으면 비워두세요)"
                className={field}
                autoComplete="off"
              />
              <datalist id="artwork-series-options">
                {seriesOptions.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>

            <div>
              <p className={label}>판매 상태</p>
              <div className="flex gap-1.5 flex-wrap">
                {STATUSES.map((s) => (
                  <button
                    key={s.value || 'none'}
                    type="button"
                    onClick={() => set({ status: s.value })}
                    aria-pressed={d.status === s.value}
                    className={`min-h-[36px] px-3 rounded-full text-xs border transition-colors ${
                      d.status === s.value ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >{s.label}</button>
                ))}
              </div>
            </div>

            <div>
              <label className={label} htmlFor="meta-desc">작품 설명 <span className="font-normal text-gray-400">포트폴리오 PDF 에 작품과 함께 실립니다</span></label>
              <textarea
                id="meta-desc"
                value={d.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="이 작품에 담은 이야기를 적어보세요."
                rows={4}
                className={`${field} resize-y leading-relaxed`}
              />
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-2">
          {hasNext ? (
            <>
              <button type="button" onClick={primary} disabled={saving} className="flex-1 min-h-[44px] bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
                {saving && <Loader2 size={14} className="animate-spin" />}저장하고 다음 작품
              </button>
              <button type="button" disabled={saving} onClick={() => onSave(d, false)} className="min-h-[44px] px-4 text-sm border border-gray-200 rounded-lg text-gray-800 hover:bg-gray-50 disabled:opacity-50">저장</button>
            </>
          ) : (
            <button type="button" onClick={primary} disabled={saving} className="flex-1 min-h-[44px] bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving && <Loader2 size={14} className="animate-spin" />}저장
            </button>
          )}
          <button type="button" onClick={requestClose} className="min-h-[44px] px-3 text-sm text-gray-500">취소</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
