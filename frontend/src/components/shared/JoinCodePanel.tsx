import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AxiosError } from 'axios';
import api from '@/lib/axios';
import { formatInviteCode, joinPath } from '@/lib/inviteCode';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

/**
 * 초대 코드 상자 (2026-09-27) — 운영자(갤러리·아트링크)의 [지원자 관리] 맨 위.
 *
 * 이미 선정이 끝난 공모를 ArtLink 로 옮겨 올 때 쓴다. 코드(또는 링크)를 선정 작가들 단톡방에 한 번 돌리면
 * 받은 작가는 지원서 없이 곧바로 수락된다. 공모는 그대로 공개되고 지원도 그대로 받는다 — 코드는 병행하는 통로다.
 *
 * - 공모당 코드 하나. [새로 발급]하면 옛 코드는 그 순간 죽는다(단톡방 밖으로 샜을 때). 이미 들어온 작가는 그대로.
 * - 선정 인원(정원)까지만 들어온다 — 서버가 막고, 여기엔 '선정 N/M명'을 보여 준다.
 * - 승인 전·전시 종료 뒤에는 만들 수 없다(서버 `joinBlockReason` 과 같은 기준) — 그땐 상자를 안 그린다.
 */
interface JoinCodeState { code: string | null; selected: number; capacity: number; blocked: string | null }

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}를 복사했습니다.`);
  } catch {
    toast.error('복사하지 못했습니다. 직접 선택해 복사해주세요.');
  }
}

export default function JoinCodePanel({ exhibitionId }: { exhibitionId: number }) {
  const queryClient = useQueryClient();
  const key = ['join-code', exhibitionId];
  const [confirm, setConfirm] = useState<'regenerate' | 'off' | null>(null);

  const { data } = useQuery<JoinCodeState>({
    queryKey: key,
    queryFn: () => api.get(`/exhibitions/${exhibitionId}/join-code`).then((r) => r.data),
  });

  const onError = (e: AxiosError<{ error?: string }>) => toast.error(e.response?.data?.error || '처리하지 못했습니다.');
  const generate = useMutation({
    mutationFn: () => api.post(`/exhibitions/${exhibitionId}/join-code`).then((r) => r.data as JoinCodeState),
    onSuccess: (next) => { queryClient.setQueryData(key, next); toast.success('초대 코드를 만들었습니다.'); },
    onError,
  });
  const turnOff = useMutation({
    mutationFn: () => api.delete(`/exhibitions/${exhibitionId}/join-code`),
    onSuccess: () => { queryClient.setQueryData<JoinCodeState | undefined>(key, (prev) => prev && { ...prev, code: null }); toast.success('초대 코드를 껐습니다.'); },
    onError,
  });

  if (!data) return null;
  // 만들 수 없는 공모(승인 전·전시 종료)에 코드가 없으면 상자 자체를 그리지 않는다 — 눌러서 400 을 받는 버튼이 된다
  if (!data.code && data.blocked) return null;

  const link = data.code ? `${window.location.origin}${joinPath(data.code)}` : '';
  const busy = generate.isPending || turnOff.isPending;

  return (
    <section className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4" aria-label="초대 코드">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <KeyRound size={16} className="mt-0.5 shrink-0 text-gray-500" />
          <div>
            <p className="text-sm font-medium text-gray-900">초대 코드</p>
            <p className="mt-0.5 text-xs text-gray-500">
              이미 선정한 작가에게 보내면 지원서 없이 바로 수락됩니다. 선정 인원({data.capacity}명)까지만 들어올 수 있어요.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
          선정 {data.selected}/{data.capacity}명
        </span>
      </div>

      {data.code ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-2 font-mono text-lg font-semibold tracking-[0.15em] text-gray-950 ring-1 ring-gray-200" data-testid="join-code">
              {formatInviteCode(data.code)}
            </code>
            <button type="button" onClick={() => copy(formatInviteCode(data.code!), '코드')}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50">
              <Copy size={13} /> 코드 복사
            </button>
            <button type="button" onClick={() => copy(link, '참여 링크')}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-800">
              <Link2 size={13} /> 참여 링크 복사
            </button>
          </div>
          <p className="break-all text-xs text-gray-400">{link}</p>
          <div className="flex gap-3 pt-1 text-xs">
            <button type="button" disabled={busy} onClick={() => setConfirm('regenerate')} className="text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-40">새로 발급</button>
            <button type="button" disabled={busy} onClick={() => setConfirm('off')} className="text-gray-500 underline-offset-2 hover:text-accent hover:underline disabled:opacity-40">끄기</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => generate.mutate()}
          className="mt-3 inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40">
          <KeyRound size={13} /> 초대 코드 만들기
        </button>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'off' ? '초대 코드 끄기' : '초대 코드 새로 발급'}
        message={confirm === 'off'
          ? '지금 코드와 링크로는 더 이상 참여할 수 없습니다. 이미 참여한 작가는 그대로입니다.'
          : '지금 코드와 링크는 더 이상 쓸 수 없고 새 코드가 만들어집니다. 이미 참여한 작가는 그대로입니다.'}
        confirmText={confirm === 'off' ? '끄기' : '새로 발급'}
        variant={confirm === 'off' ? 'danger' : 'default'}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c === 'off') turnOff.mutate(); else generate.mutate(); }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
