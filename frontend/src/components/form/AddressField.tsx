import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { formInputCls } from '@/lib/formStyles';
import { regionFromAddress } from '@/lib/listings';
import { loadPostcode, pickedAddress } from '@/lib/postcode';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * 주소 칸 — [주소 검색](카카오 우편번호) + 상세 주소(2026-11-15, 갤러리 등록 · 갤러리 정보 수정).
 * 검색으로 고르면 주소가 '서울 종로구 삼일대로 445' 처럼 정확해져, 갤러리 카드의 '서울 종로구'(lib/listings addressArea)와
 * 지역 칸(`regionFromAddress` → onRegion)이 저절로 맞는다. 검색을 못 쓰는 곳(스크립트 차단·인앱)도 있으니 **직접 입력도 늘 된다**.
 *
 * 저장 값은 지금처럼 문자열 하나다(`주소 + ' ' + 상세 주소`) — 서버·이미 등록된 갤러리를 바꾸지 않는다.
 * ⚠️ 주소 칸의 placeholder 는 '주소' 그대로(E2E 07 이 이 이름으로 찾는다).
 */
export default function AddressField({ base, detail, onChange, onRegion, error, idPrefix = 'addr', detailAside }: {
  base: string;
  detail: string;
  onChange: (next: { base: string; detail: string }) => void;
  /** 주소에서 지역을 알 수 있으면 알려 준다(검색으로 골랐거나, 친 주소가 '서울 …' 처럼 시·도로 시작하면) */
  onRegion?: (region: string) => void;
  error?: boolean;
  idPrefix?: string;
  /** 상세 주소 옆 — 갤러리 등록은 지역 칸 */
  detailAside?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailRef = useRef<HTMLInputElement>(null);
  // 입력칸 모양은 등록 폼과 같은 한 곳(lib/formStyles) — 칸 높이가 옆 칸과 어긋나지 않게
  const inputCls = (bad?: boolean) => formInputCls(bad);

  const pick = (address: string) => {
    onChange({ base: address, detail });
    const r = regionFromAddress(address);
    if (r) onRegion?.(r);
    setOpen(false);
    window.setTimeout(() => detailRef.current?.focus(), 50);
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          id={`${idPrefix}-base`}
          value={base}
          onChange={(e) => onChange({ base: e.target.value, detail })}
          onBlur={() => { const r = regionFromAddress(base); if (r) onRegion?.(r); }}
          placeholder="주소"
          aria-label="주소"
          aria-invalid={error || undefined}
          data-form-error={error || undefined}
          className={cn(inputCls(error), 'min-w-0 flex-1')}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-lg border border-gray-900 bg-white px-3.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          <Search size={15} aria-hidden /> 주소 검색
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          ref={detailRef}
          id={`${idPrefix}-detail`}
          value={detail}
          onChange={(e) => onChange({ base, detail: e.target.value })}
          placeholder="상세 주소 (층·호수, 선택)"
          aria-label="상세 주소"
          className={cn(inputCls(), 'min-w-0 flex-1')}
        />
        {detailAside}
      </div>
      {open && <PostcodeDialog query={base} onPick={pick} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** 우편번호 검색 창 — 우리 창 안에 끼워 넣는다(팝업 금지, lib/postcode.ts). 휴대폰은 화면 가득, PC 는 가운데 */
function PostcodeDialog({ query, onPick, onClose }: { query: string; onPick: (address: string) => void; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  useEscapeKey(onClose);

  useEffect(() => {
    let alive = true;
    loadPostcode()
      .then((Postcode) => {
        if (!alive || !boxRef.current) return;
        new Postcode({ oncomplete: (data) => onPick(pickedAddress(data)), width: '100%', height: '100%' })
          .embed(boxRef.current, { q: query.trim() || undefined, autoClose: false });
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        toast.error('주소 검색을 열지 못했어요. 주소를 직접 입력해 주세요.');
        onClose();
      });
    return () => { alive = false; };
    // 열 때 한 번만 — 검색어가 바뀌어도 창을 다시 만들지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="주소 검색"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88svh] w-full flex-col bg-white sm:h-[560px] sm:max-w-lg sm:rounded-lg"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 pl-5 pr-2">
          <p className="text-base font-semibold text-gray-900">주소 검색</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="grid h-11 w-11 place-items-center text-gray-700">
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {state === 'loading' && <p className="absolute inset-0 grid place-items-center text-sm text-gray-500">불러오는 중…</p>}
          <div ref={boxRef} className="h-full w-full" data-testid="postcode-box" />
        </div>
      </div>
    </div>
  );
}
