import { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { normalizeHandle, validateHandle } from '@/lib/handle';

/**
 * 홈페이지 주소(`artlink.cc/@handle`) 입력 칸 — 프로필 탭과 홈페이지 편집 › [꾸미기] 가 **같은 칸**을 쓴다 (2026-10-02).
 *
 * 예전엔 프로필 탭에만 있어서, 홈페이지를 만드는 화면에서는 주소를 정할 수 있다는 걸 알 길이 없었다
 * (실서버: 작품이 있는 작가 47명 중 주소가 있는 사람 20명 — 그나마 인스타 아이디로 자동 생성된 것).
 *
 * 이 칸은 **입력과 중복확인까지만** 한다. 저장은 부르는 쪽이 한다 —
 * 프로필 탭은 제 [주소 저장] 버튼으로, 편집 화면은 아래 [저장] 한 번에 글과 함께.
 * 규칙(소문자·숫자·마침표·밑줄 3~30자)은 `lib/handle.ts`(서버 `lib/handle.ts` 의 거울)에서만 읽는다.
 */
export default function HomepageAddressField({ value, onChange, current, suggestion, error, inputId }: {
  value: string;
  onChange: (next: string) => void;
  /** 지금 저장돼 있는 주소 (없으면 null) */
  current?: string | null;
  /** 인스타 아이디에서 뽑은 제안 — 칸이 비어 있을 때만 보여 준다 */
  suggestion?: string | null;
  /** 저장하다 서버가 돌려준 사유(이미 쓰는 주소 등) */
  error?: string | null;
  inputId?: string;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ handle: string; available: boolean; reason?: string } | null>(null);
  const seq = useRef(0);   // 늦게 도착한 응답이 최신 결과를 덮지 않게(감사 M2)

  const norm = normalizeHandle(value);
  const reason = norm ? validateHandle(norm) : null;
  const unchanged = norm === (current ?? '');
  // 확인 결과는 **그때 확인한 주소**에만 유효하다 — 글자를 고치면 사라진다
  const checked = result && result.handle === norm ? result : null;

  const check = async () => {
    if (!norm || checking) return;
    if (reason) { setResult({ handle: norm, available: false, reason }); return; }
    const mine = ++seq.current;
    setChecking(true);
    try {
      const res = await api.get('/auth/handle-check', { params: { handle: norm } });
      if (mine === seq.current) setResult({ handle: norm, available: !!res.data.available, reason: res.data.reason });
    } catch { toast.error('확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); }
    finally { if (mine === seq.current) setChecking(false); }
  };

  const bad = error || (norm && reason) || (checked && !checked.available ? (checked.reason || '이미 사용 중인 주소입니다.') : null);

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-gray-200 focus-within:border-gray-400">
          <span className="shrink-0 border-r border-gray-200 bg-gray-50 px-2.5 py-2.5 text-sm text-gray-500">artlink.cc/@</span>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={31}
            placeholder={suggestion ?? 'my_studio'}
            aria-label="홈페이지 주소"
            className="min-w-0 flex-1 px-3 py-2.5 text-sm focus:outline-none"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={check}
          disabled={!norm || unchanged || checking}
          className="whitespace-nowrap rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >{checking ? '확인 중…' : '중복확인'}</button>
      </div>
      {!norm && suggestion && (
        <button type="button" onClick={() => onChange(suggestion)} className="text-xs text-gray-600 underline underline-offset-2 hover:text-gray-900">
          인스타 아이디로 채우기: @{suggestion}
        </button>
      )}
      {/* 저장된 주소와 같으면 '지금 주소' 가 먼저다 — 방금 저장했는데 '쓸 수 있는 주소입니다' 가 남아 있으면 저장이 안 된 것처럼 읽힌다 */}
      {bad ? (
        <p className="text-xs text-accent">{bad}</p>
      ) : current && unchanged ? (
        <p className="text-xs text-gray-500">지금 주소: <span className="text-gray-800">artlink.cc/@{current}</span></p>
      ) : checked?.available ? (
        <p className="flex items-center gap-1 text-xs text-gray-700"><Check size={13} strokeWidth={2.5} /> 쓸 수 있는 주소입니다.</p>
      ) : null}
    </div>
  );
}
