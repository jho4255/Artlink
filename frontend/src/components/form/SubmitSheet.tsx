import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * [등록 요청] 확인 창(2026-11-15 — 갤러리·공모·전시 등록 공통). 무엇이 올라가는지 요약 + 약관 동의 + [등록 요청].
 * 예전엔 약관 상자가 폼 맨 끝에 길게 있었고, 체크하기 전까지 [등록 요청]이 이유 없이 회색이었다(갤러리 등록).
 * 약관은 [약관 보기]로 펼쳐 읽는다. 동의 없이 누르면 그 줄을 빨갛게 — 창은 그대로.
 * 휴대폰은 아래에서 올라오고, PC 는 가운데. `role="dialog"`(소개 팝업이 위로 뜨지 않고 앱 뒤로가기가 Esc 를 보낸다, 규칙 79).
 */
export default function SubmitSheet({ title, rows, note, terms, confirmLabel, pending, onConfirm, onClose }: {
  title: string;
  rows: [string, ReactNode][];
  note?: ReactNode;
  /** 약관 — 없으면(아트링크 주최) 동의 줄을 그리지 않는다 */
  terms?: { url: string; label: string };
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [nag, setNag] = useState(false);
  useEscapeKey(onClose);

  useEffect(() => {
    if (!terms || !showTerms || termsText) return;
    fetch(terms.url)
      .then((r) => { if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error(); return r.text(); })
      .then((t) => setTermsText(t.trimStart().startsWith('<!') ? '약관을 불러올 수 없습니다.' : t))
      .catch(() => setTermsText('약관을 불러올 수 없습니다.'));
  }, [terms, showTerms, termsText]);

  const confirm = () => {
    if (terms && !agreed) { setNag(true); return; }
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92svh] w-full overflow-y-auto rounded-t-[14px] bg-white px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 sm:max-w-md sm:rounded-lg sm:pb-6"
      >
        <h2 id="submit-sheet-title" className="text-lg font-semibold text-gray-900">{title}</h2>
        <dl className="mt-4 text-sm">
          {rows.map(([k, v], i) => (
            <div key={i} className={cn('flex gap-3 border-t border-gray-100 py-2.5', i === rows.length - 1 && 'border-b')}>
              <dt className="w-14 shrink-0 text-gray-500">{k}</dt>
              <dd className="min-w-0 flex-1 text-gray-900 break-keep [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
        {note && <p className="mt-3 text-[13px] leading-relaxed text-gray-600 break-keep">{note}</p>}
        {terms && (
          <div className={cn('mt-4 rounded-lg border', nag && !agreed ? 'border-accent' : 'border-gray-200')}>
            <div className="flex items-center justify-between gap-3 px-3.5 py-2">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[15px] text-gray-900">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => { setAgreed(e.target.checked); setNag(false); }}
                  className="h-[18px] w-[18px] accent-gray-900"
                />
                {terms.label}에 동의합니다
              </label>
              <button type="button" onClick={() => setShowTerms((v) => !v)} aria-expanded={showTerms} className="inline-flex min-h-[44px] shrink-0 items-center gap-1 text-[13px] text-gray-600 hover:text-gray-900">
                약관 보기 <ChevronDown size={14} aria-hidden className={cn('transition-transform', showTerms && 'rotate-180')} />
              </button>
            </div>
            {showTerms && (
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-gray-100 px-3.5 py-3 text-xs leading-relaxed text-gray-600">
                {termsText || '불러오는 중…'}
              </div>
            )}
          </div>
        )}
        {nag && !agreed && <p className="mt-1.5 text-xs text-accent">약관에 동의해야 등록을 요청할 수 있어요.</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[50px] rounded-lg border border-gray-300 px-5 text-[15px] text-gray-700 hover:bg-gray-50">고치기</button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="min-h-[50px] flex-1 rounded-lg bg-gray-900 text-[16px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {pending ? '보내는 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
