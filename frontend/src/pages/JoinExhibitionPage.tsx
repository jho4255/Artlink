import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, KeyRound, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AxiosError } from 'axios';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import { formatInviteCode, joinPath, normalizeInviteCode } from '@/lib/inviteCode';
import { exhibitionTypeLabels, regionLabels } from '@/lib/utils';
import Thumb from '@/components/shared/Thumb';
import JoinCodeInput from '@/components/shared/JoinCodeInput';

/**
 * 초대 코드로 공모 참여 — `/join/:code` (2026-09-27).
 *
 * 갤러리가 이미 선정을 끝낸 공모를 ArtLink 로 옮겨 오며 선정 작가들 단톡방에 이 링크를 돌린다.
 * **어떤 공모에 들어가는지 먼저 보여 주고** [참여하기]를 누르게 한다 — 잘못 받은 코드로 엉뚱한 공모에 수락되면 되돌릴 길이 없다.
 * 누르면 지원서 없이 곧바로 수락되고, 마이페이지 [내 전시]에서 자료 제출·전시·정산을 이어서 한다.
 *
 * - 비로그인도 공모는 본다. [로그인하고 참여하기] → 로그인(또는 가입) → 이 주소로 돌아온다(`setPostLoginRedirect`).
 * - 판정(참여할 수 있는가)은 서버 `GET /exhibitions/join/:code` 가 내려준 값으로만 한다 — 여기서 따로 계산하지 않는다.
 */
interface JoinPreview {
  exhibition: {
    id: number; title: string; imageUrl: string | null; type: string; region: string; capacity: number;
    deadlineStart: string | null; deadline: string; submissionDeadline: string | null;
    exhibitStartDate: string | null; exhibitDate: string | null; recruitOnly: boolean; galleryName: string | null; hostType: string;
  };
  selected: number;
  full: boolean;
  blocked: string | null;
  my: { status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' } | null;
}

const d = (s: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : null);
const range = (a: string | null, b: string | null) => [d(a), d(b)].filter(Boolean).join(' ~ ');

export default function JoinExhibitionPage() {
  const { code: raw = '' } = useParams();
  const code = normalizeInviteCode(raw);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuthStore();

  const { data, isLoading, error } = useQuery<JoinPreview>({
    queryKey: ['join-preview', code, user?.id ?? null],
    queryFn: () => api.get(`/exhibitions/join/${code}`).then((r) => r.data),
    enabled: !!code,
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => api.post('/exhibitions/join', { code }).then((r) => r.data as { exhibitionId: number; alreadyJoined?: boolean }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      queryClient.invalidateQueries({ queryKey: ['exhibition', String(r.exhibitionId)] });
      toast.success(r.alreadyJoined ? '이미 참여 중인 공모입니다.' : '공모에 참여했습니다. 내 전시에서 이어서 진행하세요.');
      navigate(`/mypage?tab=applications&ex=${r.exhibitionId}`);
    },
    onError: (e: AxiosError<{ error?: string }>) => {
      toast.error(e.response?.data?.error || '참여하지 못했습니다.');
      queryClient.invalidateQueries({ queryKey: ['join-preview', code] });   // 정원이 그새 찼으면 화면도 바뀌어야 한다
    },
  });

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-xl px-6 py-10 md:py-16">
      <p className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.2em] text-gray-400">
        <KeyRound size={13} /> 초대 코드{code ? ` · ${formatInviteCode(code)}` : ''}
      </p>
      {children}
    </div>
  );

  if (!code || error) {
    return shell(
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950">유효하지 않은 초대 코드입니다</h1>
          <p className="mt-2 text-sm text-gray-500">코드가 바뀌었거나 꺼졌을 수 있어요. 갤러리에 새 코드를 받아 다시 넣어 주세요.</p>
        </div>
        <JoinCodeInput />
      </div>,
    );
  }
  if (isLoading || !data) return shell(<div className="h-72 animate-pulse rounded-2xl bg-gray-100" />);

  const { exhibition: ex, my } = data;
  const isArtist = user?.role === 'ARTIST';
  const mineLink = `/mypage?tab=applications&ex=${ex.id}`;

  // 참여 칸 — 상태마다 한 가지만 보여 준다
  let action: React.ReactNode;
  if (my?.status === 'ACCEPTED') {
    action = (
      <>
        <p className="text-sm text-gray-600">이미 이 공모에 참여하고 있어요.</p>
        <button onClick={() => navigate(mineLink)} className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white hover:bg-gray-800">내 전시에서 보기</button>
      </>
    );
  } else if (my?.status === 'REJECTED') {
    action = <p className="text-sm text-accent">이 공모에서 선정되지 않은 지원이 있어 코드로 참여할 수 없습니다. 갤러리에 문의해주세요.</p>;
  } else if (data.blocked) {
    action = <p className="text-sm text-accent">{data.blocked}</p>;
  } else if (data.full) {
    action = <p className="text-sm text-accent">선정 인원({ex.capacity}명)이 모두 찼습니다. 갤러리에 문의해주세요.</p>;
  } else if (!isAuthenticated) {
    action = (
      <>
        <button
          onClick={() => { setPostLoginRedirect(joinPath(code)); navigate('/login'); }}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white hover:bg-gray-800"
        >
          로그인하고 참여하기
        </button>
        <p className="text-center text-xs text-gray-400">작가 계정으로 로그인하면 이 화면으로 돌아옵니다. 계정이 없으면 가입부터 하세요.</p>
      </>
    );
  } else if (!isArtist) {
    action = <p className="text-sm text-gray-600">작가 계정으로만 참여할 수 있어요. 작가 계정으로 다시 로그인해 주세요.</p>;
  } else {
    action = (
      <>
        <p className="text-sm leading-relaxed text-gray-600">
          참여하면 지원서 없이 바로 <b className="font-semibold text-gray-900">수락</b>됩니다.
          {ex.recruitOnly ? ' 이 공모는 선정까지만 진행합니다.' : ' 이후 [내 전시]에서 작품 자료 제출 → 전시 → 정산을 이어서 진행합니다.'}
          {my?.status === 'SUBMITTED' && ' 이미 낸 지원서가 수락으로 바뀝니다.'}
        </p>
        {/* 작가 지원 약관 제4조 ② — 지원서 대신 홈페이지 정보가 간다. 모르고 누르면 안 되므로 누르기 전에 적는다 */}
        <p className="text-xs leading-relaxed text-gray-500">
          {my?.status === 'SUBMITTED'
            ? '갤러리에는 이미 낸 지원서의 내용과 연락처가 전달되어 있습니다.'
            : '홈페이지에 등록한 약력·경력·작품 사진·포트폴리오 파일과 연락처(이름·이메일·휴대폰번호)가 갤러리에 전달됩니다.'}
        </p>
        <button
          onClick={() => join.mutate()}
          disabled={join.isPending}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {join.isPending ? '참여하는 중…' : '참여하기'}
        </button>
        <p className="text-center text-xs text-gray-400">
          참여하면 <a href="/terms/artist_apply_real.txt" target="_blank" rel="noreferrer" className="underline underline-offset-2">작가 지원 약관</a>에 동의한 것으로 봅니다.
        </p>
      </>
    );
  }

  return shell(
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {ex.imageUrl && (
        <div className="flex max-h-72 justify-center bg-gray-50">
          <Thumb src={ex.imageUrl} size="grid" alt={ex.title} className="max-h-72 w-auto object-contain" />
        </div>
      )}
      <div className="space-y-5 p-6">
        <div>
          <p className="text-xs text-gray-500">
            {ex.hostType === 'ADMIN' ? '아트링크 주최' : ex.galleryName ?? ''} · {exhibitionTypeLabels[ex.type] || ex.type} · {regionLabels[ex.region] || ex.region}
          </p>
          <h1 className="mt-1.5 break-keep text-2xl font-semibold leading-snug text-gray-950 [overflow-wrap:anywhere]">{ex.title}</h1>
        </div>
        <dl className="space-y-2 border-y border-gray-100 py-4 text-sm">
          <div className="flex gap-3"><dt className="flex w-24 shrink-0 items-center gap-1.5 text-gray-400"><CalendarDays size={14} /> 모집</dt><dd className="text-gray-800">{range(ex.deadlineStart, ex.deadline)}</dd></div>
          {!ex.recruitOnly && ex.submissionDeadline && (
            <div className="flex gap-3"><dt className="w-24 shrink-0 pl-5 text-gray-400">자료 제출</dt><dd className="text-gray-800">{d(ex.submissionDeadline)}까지</dd></div>
          )}
          {!ex.recruitOnly && (ex.exhibitStartDate || ex.exhibitDate) && (
            <div className="flex gap-3"><dt className="w-24 shrink-0 pl-5 text-gray-400">전시</dt><dd className="text-gray-800">{range(ex.exhibitStartDate, ex.exhibitDate)}</dd></div>
          )}
          <div className="flex gap-3"><dt className="flex w-24 shrink-0 items-center gap-1.5 text-gray-400"><Users size={14} /> 선정</dt><dd className="text-gray-800">{data.selected} / {ex.capacity}명</dd></div>
        </dl>
        <div className="space-y-3">{action}</div>
        <button onClick={() => navigate(`/exhibitions/${ex.id}`)} className="text-xs text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline">공모 상세 보기</button>
      </div>
    </article>,
  );
}
