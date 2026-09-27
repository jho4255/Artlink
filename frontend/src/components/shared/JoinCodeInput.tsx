import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { joinPath, normalizeInviteCode } from '@/lib/inviteCode';

/**
 * 초대 코드 입력칸 (2026-09-27) — 작가 [내 전시] 맨 위와 공모 상세에 둔다.
 *
 * 갤러리가 보통 **링크**(`/join/코드`)를 돌리므로 이 칸은 '코드만 받은' 작가를 위한 보조 입구다.
 * 여기서 바로 참여시키지 않고 `/join/코드` 로 보낸다 — 어떤 공모에 들어가는지 먼저 보여 주고 [참여하기]를 누르게 하려고.
 * (코드를 잘못 받아 엉뚱한 공모에 수락되면 되돌릴 방법이 없다)
 */
export default function JoinCodeInput({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeInviteCode(value);
    if (!code) { setError('초대 코드 8자리를 확인해주세요.'); return; }
    navigate(joinPath(code));
  };

  return (
    <form onSubmit={submit} className={compact ? '' : 'rounded-xl border border-gray-200 bg-white p-4'}>
      {!compact && (
        <div className="mb-2 flex items-start gap-2">
          <KeyRound size={16} className="mt-0.5 shrink-0 text-gray-500" />
          <div>
            <p className="text-sm font-medium text-gray-900">초대 코드로 참여</p>
            <p className="mt-0.5 text-xs text-gray-500">이미 선정된 공모라면 갤러리에게 받은 코드를 넣으세요. 지원서 없이 바로 참여합니다.</p>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          placeholder="예: K7M4-QX2P"
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="초대 코드"
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-200 px-3 font-mono text-sm uppercase tracking-wider focus:border-gray-400 focus:outline-none"
        />
        <button type="submit" className="min-h-[44px] shrink-0 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">
          확인
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-accent">{error}</p>}
    </form>
  );
}
