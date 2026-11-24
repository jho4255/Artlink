/**
 * OperationPage — 공모 운영 (/exhibitions/:id/operation/new) 과 그 부품들
 *
 * 접근: 갤러리 오너 / Admin / 수락(ACCEPTED)된 작가
 *  - 운영 공지: 모두 열람, 오너·Admin 작성/수정/삭제
 *  - 수락 작가: 본인 출품 자료(출품작·약력·작가노트) 작성·수정 — 마이페이지 [내 전시]의 전시 화면에서(`ArtistExhibitionWorkspace`, 2026-11-20)
 *  - 이 주소(/operation/new)는 옛 알림용 — 갤러리·작가는 마이페이지의 그 공모로 보내고, 관리자에게만 공모 화면을 단독으로 그린다(CLAUDE.md 규칙 88)
 *  - 오너·Admin: 전 작가 출품 자료 열람 + 문서별 PDF (타 작가끼리는 비공개)
 *
 * ── 2026-09-29 개편 (공모 프로세스 UX) ─────────────────────────
 * 처음 쓰는 사람이 "지금 무엇을 눌러야 하는지" 를 알 수 없던 곳들을 고쳤다.
 *  - 운영 화면: KPI 3칸 · 오렌지 안내 · 공지 · 출력 도구 · 스텝퍼 · '현재 운영 상태'(스텝퍼와 중복) · '운영 도우미'(대부분 비활성)가
 *    한꺼번에 떠 있었다 → **진행 단계 → (할 일) → 구역(운영 공지 · 출품 자료 · 정산)** 한 줄기로.
 *  - 출품 자료 편집기: 저장 버튼이 네다섯 개였고 [저장] → "대표작을 선택하세요" → 대표작은 "저장한 작품만" 이라 비활성 →
 *    작품 카드의 작은 [저장]을 먼저 눌러야 풀리는 순환이었다 → 버튼은 **[임시저장]·[갤러리에 제출] 둘**, 대표작은 작품 카드의 ☆,
 *    채울 것은 맨 위 체크리스트 네 줄(`lib/submissionChecklist.ts`).
 *  - 색은 흑백 + 빨강 하나(할 일). 이름은 `lib/flowLabels.ts` 한 곳.
 *
 * API: /api/operations/:id/(access|notices|me|submissions|submissions/:userId|lifecycle|settlement…)
 */
import { useState, useEffect, useRef, useId, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Edit3, FileDown, Loader2, Upload, ImageOff, Star, Check, RotateCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { composeSize, splitSize } from '@/lib/artwork';
import Thumb from '@/components/shared/Thumb';
import { nameWithNickname, compressImage, MAX_IMAGE_BYTES, formatPhoneNumber, koreanWon, formatArtworkPrice, cn } from '@/lib/utils';
import { STATE_UI, computeSaveState, isBlankArtwork, repOrdinal, type SaveState } from '@/lib/saveState';
import { artworkMissing, hasContent, hasNoteContent, serverStatus, submissionChecklist, submissionState, CV_SECTIONS } from '@/lib/submissionChecklist';
import { SUBMISSION_TERM } from '@/lib/flowLabels';
import { operatorWorkspace } from '@/lib/operationLinks';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { authStashKeys, stashKeys, takeAuthStash, useStashOnAuthLoss } from '@/lib/authStash';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useSubmissionDownloads } from '@/hooks/useSubmissionDownloads';
import DmComposeModal from '@/components/operation/DmComposeModal';
import Notice from '@/components/flow/Notice';
import MenuButton from '@/components/flow/MenuButton';
import PageTabBar from '@/components/shared/PageTabBar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import MissingImagesBanner from '@/components/shared/MissingImagesBanner';
import GuestArtistDialog from '@/components/operation/GuestArtistDialog';
import GuestChip from '@/components/operation/GuestChip';
import { GUEST_SUBMISSION_STATE_LABEL } from '@/lib/guestArtists';

import type {
  ExhibitionNotice, OperationSubmission,
  ArtworkItem, ArtistCv, CvEntry, ArtistNote, SettlementArtist,
} from '@/types';
import { EMPTY_CV, EMPTY_NOTE } from '@/types';

// 저장 전 이탈 경고 문구 (닫기·새로고침·뒤로가기·앱 내 링크 이동 시)
const UNSAVED_MESSAGE = [
  '저장하지 않은 출품 자료가 있습니다.',
  '[임시저장]을 누르면 작성 중인 내용을 보관할 수 있어요.',
  '',
  '저장하지 않고 나가시겠습니까?',
].join('\n');


type SubmissionTab = 'artwork' | 'cv' | 'note';

/** 한 작가의 출품 자료에서 비어 있는 부분 — 갤러리 목록·안내 메시지 대상 */
function submissionMissingParts(submission: OperationSubmission): string[] {
  const parts: string[] = [];
  if ((submission.artworkList?.length || 0) === 0) parts.push('출품작');
  if (!hasContent(submission.cv)) parts.push('약력');
  if (!hasNoteContent(submission.note)) parts.push('작가노트');
  return parts;
}

const longDate = (v: string) => new Date(v).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

/** 받침 있으면 a, 없으면 b — '약력이'·'작가노트가' (항목 이름을 이어 붙인 문장에서 조사가 틀리지 않게) */
const josa = (word: string, a: string, b: string) => {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? a : b;
};

/**
 * `/exhibitions/:id/operation/new` — 옛 알림·공모 상세 버튼이 가리키는 운영 주소(라우트 유지 필수 — 이미 나간 알림이 들고 있다).
 *
 * 2026-11-20 개편(규칙 88): 운영 화면 본문은 **공모 한 건 화면**(`components/workspace/ExhibitionWorkspace`) 하나다.
 *  - 갤러리 → 마이페이지 [내 공모]의 그 공모 화면으로(`?tab=my-exhibitions&ex=<id>` — 일하는 곳이 한 곳이게, `view=` 는 그대로)
 *  - 관리자 → 여기서 그 화면을 그린다(관리자에겐 [내 공모]가 없다 — 돌아갈 곳은 `operatorWorkspace` 가 정한다)
 *  - 작가 → [내 전시]의 그 전시(작가는 운영 화면에 오지 않는다)
 * 워크스페이스는 늦게 불러온다 — 그쪽이 이 파일의 구역들을 가져다 쓰므로(정적으로 서로 부르면 순환이 된다).
 */
const ExhibitionWorkspace = lazy(() => import('@/components/workspace/ExhibitionWorkspace'));

export default function OperationPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [search] = useSearchParams();
  const view = search.get('view');
  const viewQ = view ? `&view=${encodeURIComponent(view)}` : '';
  if (!id || !user) return null;
  if (user.role === 'GALLERY') {
    // 갤러리의 일터 — lib/operationLinks.ts 가 정한다(역할 전용 탭 주소를 손으로 적지 않는다)
    const workspace = operatorWorkspace(user.role, null, id);
    return <Navigate to={`${workspace?.listHref ?? `/exhibitions/${id}`}${viewQ}`} replace />;
  }
  if (user.role !== 'ADMIN') return <Navigate to={`/mypage?tab=applications&ex=${encodeURIComponent(id)}`} replace />;
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-6 py-10"><div className="h-40 animate-pulse rounded-xl bg-gray-100" /></div>}>
      {/* key — 관리자가 공모 A 를 보다 벨의 공모 B 알림을 누르면 같은 화면이 재사용돼, A 에서 쓰던 저장 안 한 정산 입력이
          B 화면에 남았다(2026-11-21 e2e 89 WS-09). 공모가 바뀌면 화면을 새로 시작한다(MyPage 두 곳과 같다) */}
      <ExhibitionWorkspace key={id} exhibitionId={Number(id)} standalone />
    </Suspense>
  );
}


// ============ 운영 공지 ============
export function NoticesSection({ exhibitionId, canManage }: { exhibitionId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: notices = [], isLoading } = useQuery<ExhibitionNotice[]>({
    queryKey: ['operation-notices', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/notices`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const reset = () => { setShowForm(false); setEditId(null); setTitle(''); setContent(''); };

  const saveMutation = useMutation({
    mutationFn: () => editId
      ? api.patch(`/operations/${exhibitionId}/notices/${editId}`, { title, content })
      : api.post(`/operations/${exhibitionId}/notices`, { title, content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-notices', exhibitionId] }); reset(); toast.success('공지가 저장되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (nid: number) => api.delete(`/operations/${exhibitionId}/notices/${nid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-notices', exhibitionId] }); toast.success('삭제되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제에 실패했습니다.'),   // 정산 완료 후 403 이 무음이었다(2026-09-19)
  });

  const startEdit = (n: ExhibitionNotice) => { setEditId(n.id); setTitle(n.title); setContent(n.content); setShowForm(true); };

  return (
    <div className="space-y-4">
      {canManage && !showForm && (
        <div className="flex justify-end pt-1">
          <button onClick={() => { reset(); setShowForm(true); }} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-300 px-3.5 text-sm font-medium text-gray-900 hover:bg-gray-50">
            <Plus size={14} aria-hidden /> 공지 쓰기
          </button>
        </div>
      )}

      {showForm && (
        <div className="space-y-2 rounded-xl border border-gray-200 p-4">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="제목" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="공지 내용" className="h-28 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="min-h-[40px] px-3 text-sm text-gray-500 hover:text-gray-900">취소</button>
            <button onClick={() => { if (!title.trim() || !content.trim()) { toast.error('제목과 내용을 입력해주세요.'); return; } saveMutation.mutate(); }} disabled={saveMutation.isPending} className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{editId ? '수정' : '올리기'}</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      ) : notices.length === 0 ? (
        <p className="py-6 text-sm text-gray-500">{canManage ? '아직 올린 공지가 없어요.' : '갤러리가 올린 공지가 없어요.'}</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-y border-gray-100">
          {notices.map(n => (
            <li key={n.id} className="py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-medium text-gray-900">{n.title}</h4>
                  <p className="mt-0.5 text-xs text-gray-400">{new Date(n.createdAt).toLocaleString('ko')}</p>
                </div>
                {canManage && (
                  <div className="-mr-2 flex shrink-0 items-center">
                    <button onClick={() => startEdit(n)} className="grid h-9 w-9 place-items-center text-gray-400 hover:text-gray-900" aria-label="수정"><Edit3 size={14} /></button>
                    <button onClick={() => setDeleting(n.id)} className="grid h-9 w-9 place-items-center text-gray-400 hover:text-accent" aria-label="삭제"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-keep text-sm leading-relaxed text-gray-700 [overflow-wrap:anywhere]">{n.content}</p>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="공지 삭제"
        message="이 공지를 삭제할까요? 작가 화면에서도 사라집니다."
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { if (deleting !== null) deleteMutation.mutate(deleting); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ============ 작가 본인 출품 자료 ============
/**
 * 출품 자료가 잠긴 이유와 다음 행동을 알려준다.
 * 예전엔 "확정되어 수정할 수 없습니다" 한 줄뿐이라, 작가 입장에서 **왜 잠겼는지·어떻게 해야 하는지**를 알 수 없었다.
 * 확정 경로가 둘(전시 시작일 경과 자동 확정 / 갤러리 수동 확정)이고 종료 후에는 기록 보존 목적이라 구분해서 안내한다.
 */
function lockedReason(ended?: boolean, manualConfirmed?: boolean): { title: string; detail: string } {
  if (ended) return {
    title: '전시가 끝나 출품 자료가 잠겼어요.',
    detail: '정산·기록 보존을 위해 종료 후에는 고칠 수 없어요. 고쳐야 할 내용이 있으면 갤러리에 문의해 주세요.',
  };
  if (manualConfirmed) return {
    title: '갤러리가 전시를 확정해 출품 자료가 잠겼어요.',
    detail: '확정 뒤에 출품 목록이 바뀌면 캡션·도록·정산 기준이 흔들리기 때문이에요. 고칠 게 있으면 갤러리에 문의해 주세요.',
  };
  return {
    title: '전시 시작일이 지나 자동으로 확정되었어요.',
    detail: '확정 뒤에 출품 목록이 바뀌면 캡션·도록·정산 기준이 흔들려 고칠 수 없게 잠겨요. 고칠 게 있으면 갤러리에 문의해 주세요.',
  };
}

/**
 * 작가 본인의 출품 자료 편집기 — `proxyFor` 를 주면 **갤러리/Admin 이 그 작가 대신** 쓰는 화면이 된다.
 *
 * 왜 같은 컴포넌트를 쓰나: 자료를 직접 못 올리는 작가(주로 고령)를 갤러리가 대신 입력해줘야 하는데,
 * 편집기를 따로 만들면 검증·임시저장·대표작 보정 규칙이 두 벌이 돼 반드시 갈라진다.
 * 서버도 같은 이유로 `submissionDataFrom` 하나를 공유한다.
 *
 * ── 저장은 두 가지뿐이다 (2026-09-29) ──
 *  - [임시저장]      다 못 채워도 보관. 새로 넣거나 고친 작품은 **갤러리에 안 보인다**(draft). 약력·노트는 서버에 draft 개념이
 *                    없어 저장되는 대로 갤러리에 보인다 — 그래서 '비공개 저장' 이라고 약속하지 않고 작품 기준으로만 말한다.
 *  - [갤러리에 제출]  작품마다 캡션 칸(작품명·크기·재료·연도·가격)과 대표작을 확인한 뒤 전부 공개한다.
 *                    약력·작가노트가 비어 있으면 막지 않고 "출품작만 먼저 보낼까요?" 를 묻는다.
 */
/** 로그인이 풀릴 때 남겨 두는 출품 자료 입력(lib/authStash) */
type SubmissionStash = { artworkList: ArtworkItem[]; cv: ArtistCv; note: ArtistNote; repIndex: number | null };

export function MySubmissionSection({ exhibitionId, myUserId, confirmed, ended, manualConfirmed, proxyFor, submissionDeadline }: {
  exhibitionId: string;
  myUserId: number;
  confirmed: boolean;
  ended?: boolean;
  manualConfirmed?: boolean;
  /** 갤러리/Admin 이 대신 쓰는 작가. `guest` = 비회원 작가(규칙 91) — 알림·홈페이지가 없다, 갤러리가 직접 채우는 사람 */
  proxyFor?: { id: number; name: string; guest?: boolean };
  /** 자료 제출 마감일 — 상태 줄에 함께 적는다 */
  submissionDeadline?: string | null;
}) {
  const qc = useQueryClient();
  const targetUserId = proxyFor?.id ?? myUserId;
  // 대신 입력은 **원본**을 읽는다 — 임시저장(draft)까지 보여야 작가가 쓰다 만 내용을 모르고 날리지 않는다
  const path = proxyFor ? `/operations/${exhibitionId}/submissions/${proxyFor.id}` : `/operations/${exhibitionId}/me`;
  const queryKey = proxyFor ? ['operation-submission-edit', exhibitionId, proxyFor.id] : ['operation-me', exhibitionId];
  const { data, isLoading } = useQuery<OperationSubmission>({
    queryKey,
    queryFn: () => api.get(proxyFor ? `${path}/edit` : path).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [artworkList, setArtworkList] = useState<ArtworkItem[]>([]);
  const [cv, setCv] = useState<ArtistCv>(EMPTY_CV);
  const [note, setNote] = useState<ArtistNote>(EMPTY_NOTE);
  const [repIndex, setRepIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<SubmissionTab>('artwork');
  // 마지막으로 서버에 저장된 스냅샷 — 작품별 상태·'저장 안 된 변경'·갤러리에 보이는 상태의 기준
  const [savedList, setSavedList] = useState<ArtworkItem[]>([]);
  const [savedNote, setSavedNote] = useState<ArtistNote>(EMPTY_NOTE);
  const [savedCv, setSavedCv] = useState<ArtistCv>(EMPTY_CV);
  const [savedRepIndex, setSavedRepIndex] = useState<number | null>(null);
  // [갤러리에 제출]을 한 번 눌러 빈 칸이 드러난 뒤로는 칸을 채우는 대로 빨간 표시가 사라진다(실시간 판정)
  const [validated, setValidated] = useState(false);
  const [askPartial, setAskPartial] = useState<string[] | null>(null);
  const [cvLoaded, setCvLoaded] = useState(false);
  /** 로그인이 풀리기 전에 쓰던 입력(lib/authStash) — 처음 받은 값(data 객체)에만 얹는다. 같은 값으로 effect 가 다시 돌면(StrictMode) 다시 얹는다 */
  const restore = useRef<{ data: OperationSubmission; stash: SubmissionStash | null } | null>(null);
  const stashKey = stashKeys.submission(exhibitionId, targetUserId);
  const idPrefix = useId();
  /** 그 구역으로 내려간다(2026-11-20 — 예전엔 탭 셋이라 탭을 바꿨다. 지금은 한 흐름의 번호 구역 1·2·3) */
  const goSection = (key: SubmissionTab) => {
    window.setTimeout(() => document.getElementById(`${idPrefix}-sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  useEffect(() => {
    if (data) {
      /*
        로그인이 풀리기 전에 쓰던 입력이 이 기기에 남아 있으면 그걸로 채운다(2026-11-21 O6, lib/authStash) — 기준선(saved*)은 서버 값이라
        저장 안 된 변경으로 보이고, 저장은 사람이 누른다. 잠긴 화면(확정 뒤 작가 본인)에서는 버린다.
      */
      if (!restore.current) {
        const taken = takeAuthStash<SubmissionStash>(myUserId, stashKey);
        restore.current = { data, stash: taken && !confirmed ? taken : null };
      }
      const stash = restore.current.data === data ? restore.current.stash : null;
      if (stash) toast(`로그인이 풀리기 전에 쓰던 ${SUBMISSION_TERM}를 되살렸어요. 저장해야 반영돼요.`, { id: `auth-stash-${stashKey}`, duration: 6000 });
      setArtworkList(stash?.artworkList ?? (data.artworkList || []));
      setCv(stash?.cv ?? (data.cv || EMPTY_CV));
      setNote(stash?.note ?? (data.note || EMPTY_NOTE));
      setRepIndex(stash ? stash.repIndex : (data.representativeIndex ?? null));
      setSavedList(data.artworkList || []);
      setSavedNote(data.note || EMPTY_NOTE);
      setSavedCv(data.cv || EMPTY_CV);
      setSavedRepIndex(data.representativeIndex ?? null);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- 되살리기(myUserId·stashKey·confirmed)는 처음 받은 값에서 한 번만 본다

  // 대표작 인덱스가 출품작 범위를 벗어나면 해제
  useEffect(() => {
    if (repIndex != null && repIndex >= artworkList.length) setRepIndex(null);
  }, [artworkList.length, repIndex]);

  // 작품 삭제 시 대표작 인덱스 보정 — 지운 것이 대표작이면 해제, 그보다 앞이면 한 칸 당긴다
  const handleArtworkRemoved = (removed: number) => {
    setRepIndex(prev => (prev == null ? null : prev === removed ? null : prev > removed ? prev - 1 : prev));
  };

  /*
    항상 전체를 보낸다(작품·약력·노트·대표작) — 서버가 한 행을 통째로 갈아끼운다.
    partial(임시저장)일 땐 refetch 를 하지 않는다 — 되받은 서버 값으로 폼을 덮으면 다른 작품에 입력 중이던 내용이 날아간다.
  */
  const saveMutation = useMutation({
    mutationFn: (v: { list: ArtworkItem[]; rep: number | null; msg: string; full?: boolean }) =>
      api.put(path, { artworkList: v.list, cv, note, representativeIndex: v.rep }),
    onSuccess: (res, v) => {
      // 기준선은 서버 응답(실제 저장된 값) — 요청이 나가는 동안 사용자가 더 입력한
      // 내용을 '저장됨'으로 잘못 표시하지 않기 위해 렌더 시점 값 대신 응답을 쓴다
      const srv = res.data || {};
      setSavedList(Array.isArray(srv.artworkList) ? srv.artworkList : v.list);
      setSavedNote(srv.note ?? EMPTY_NOTE);
      setSavedCv(srv.cv ?? EMPTY_CV);
      setSavedRepIndex(srv.representativeIndex ?? null);
      // 화면 목록은 자리 이동 없이 항목별로만 갱신 — 통째로 교체하면
      // ① 빈 칸이 뒤로 밀리며 repIndex 가 엉뚱한 칸을 가리키고 ② 저장 중에 다른 작품에 입력하던 내용이 날아간다.
      // draft 플래그만 다른(=이번 저장으로 플래그가 바뀐) 항목만 보낸 값으로 바꾼다.
      const sameArt = (a: ArtworkItem, b: ArtworkItem) => {
        const { draft: _a, ...x } = a; const { draft: _b, ...y } = b;
        return JSON.stringify(x) === JSON.stringify(y);
      };
      setArtworkList(prev => {
        let ord = 0;
        return prev.map(a => {
          if (isBlankArtwork(a)) return a;
          const sent = v.list[ord++];
          return sent && sameArt(a, sent) ? sent : a;
        });
      });
      if (v.full) { qc.invalidateQueries({ queryKey }); setValidated(false); }
      if (proxyFor) {
        // 대신 입력한 내용은 갤러리 목록(제출 완료 배지)·카드 숫자에도 바로 반영돼야 한다
        qc.invalidateQueries({ queryKey: ['operation-submissions', exhibitionId] });
        qc.invalidateQueries({ queryKey: ['my-operation-overview'] });
      } else {
        // 작가 카드의 '출품 자료를 제출해 주세요' 줄과 [내 전시] 분류가 이 값을 본다
        qc.invalidateQueries({ queryKey: ['my-applications'] });
      }
      toast.success(v.msg);
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error || '저장하지 못했습니다.');
      // 막힌 이유가 단계(확정·종료)면 화면을 그 단계로 다시 그린다 — 그대로 두면 고칠 수 있는 옛 화면에서 계속 403 을 받는다(2026-11-20 S5).
      // 쓰던 내용은 지우지 않는다(이 폼의 상태는 그대로 — 잠긴 화면은 위 단계 정보로 바뀐다)
      if (e.response?.status === 403) {
        for (const k of [['operation-access', exhibitionId], ['my-applications'], ['operation-submissions', exhibitionId]]) qc.invalidateQueries({ queryKey: k });
      }
    },
  });

  // 서버에 보낼 목록 — 갓 추가해 비어 있는 칸은 제외한다(빈 작품이 쌓이면 갤러리 카운트가 어긋난다).
  // 상태 비교도 이 목록 기준으로 해야 인덱스가 어긋나지 않는다.
  const filledList = artworkList.filter(a => !isBlankArtwork(a));
  const ordinalOf = new Map<number, number>();
  artworkList.forEach((a, i) => { if (!isBlankArtwork(a)) ordinalOf.set(i, ordinalOf.size); });

  const artworkState = (i: number): SaveState => {
    // 갓 추가해 비어 있는 칸은 경고하지 않는다 (저장할 것도, 잃을 것도 없음)
    if (isBlankArtwork(artworkList[i])) return 'empty';
    const ord = ordinalOf.get(i)!;
    return computeSaveState(artworkList[i], savedList[ord], artworkList[i]?.draft);
  };

  // 대표작 변경도 저장 대상 — 빼먹으면 대표작만 바꾼 경우 이탈 경고 없이 조용히 유실된다
  const anyDirty = JSON.stringify(filledList) !== JSON.stringify(savedList)
    || JSON.stringify(note) !== JSON.stringify(savedNote)
    || JSON.stringify(cv) !== JSON.stringify(savedCv)
    || repOrdinal(artworkList, repIndex, filledList.length) !== (savedRepIndex ?? null);
  // 저장 전 이탈 경고 (닫기·새로고침·뒤로가기·앱 내 링크)
  useUnsavedChanges(anyDirty, UNSAVED_MESSAGE);
  // 로그인이 풀리면 이 입력을 이 기기에 남긴다 — 다시 로그인해 이 화면이 뜨면 위에서 되살린다(lib/authStash)
  useStashOnAuthLoss(confirmed ? null : stashKey, (): SubmissionStash | null => (anyDirty ? { artworkList, cv, note, repIndex } : null));

  const checklist = submissionChecklist({ artworkList, repIndex, cv, note });
  const server = serverStatus({ artworkList: savedList, cv: savedCv, note: savedNote });

  // 빈 칸 표시(제출을 한 번 눌러 본 뒤로만) — 칸을 채우면 바로 사라진다
  const liveErrors: Record<number, string[]> = {};
  if (validated) artworkList.forEach((a, i) => { const m = artworkMissing(a); if (m.length) liveErrors[i] = m; });
  const repChosen = repIndex != null && !isBlankArtwork(artworkList[repIndex]);
  const repErrorLive = validated && filledList.length > 1 && !repChosen;
  const noteErrorAt = validated ? note.sections.findIndex(s => !s.title.trim()) : -1;

  // 임시저장 — 아직 다 채우지 못했어도 작성한 만큼 서버에 보관. 새로 넣거나 고친 작품은 draft 로 갤러리에서 감춘다.
  const saveDraft = () => {
    const list = filledList.map((a, ord) => (
      JSON.stringify(a) === JSON.stringify(savedList[ord]) && !a.draft ? a : { ...a, draft: true }
    ));
    saveMutation.mutate({ list, rep: repOrdinal(artworkList, repIndex, list.length), msg: '임시저장했어요. 임시저장한 작품은 갤러리에 보이지 않아요.' });
  };

  /** [갤러리에 제출] — 빈 칸을 보여 주고, 약력·노트가 비면 먼저 물어본다 */
  const submit = (allowPartial = false) => {
    const missingByArt: number[] = [];
    artworkList.forEach((a, i) => { if (artworkMissing(a).length) missingByArt.push(i); });
    // 작품이 한 점뿐이면 그게 대표작이다 — 고르라고 붙잡을 이유가 없다
    let rep = repIndex;
    if (!(rep != null && !isBlankArtwork(artworkList[rep])) && filledList.length === 1) rep = artworkList.findIndex(a => !isBlankArtwork(a));
    const repMissing = filledList.length > 0 && !(rep != null && !isBlankArtwork(artworkList[rep]));
    const badSection = note.sections.findIndex(s => !s.title.trim());

    if (filledList.length === 0 || missingByArt.length || repMissing) {
      setValidated(true);
      if (filledList.length === 0) toast.error('출품작을 1점 이상 넣어 주세요.');
      else if (missingByArt.length) toast.error('빨간 칸을 채워 주세요 — 캡션에 들어가는 내용이라 비워 둘 수 없어요.', { duration: 5000 });
      else toast.error('대표작을 골라 주세요 — 작품 카드의 [☆ 대표작]을 누르면 됩니다.', { duration: 5000 });
      const first = missingByArt[0];
      window.setTimeout(() => {
        const el = first != null ? document.getElementById(`${idPrefix}-art-${first}`) : document.getElementById(`${idPrefix}-rep`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }
    if (badSection >= 0) {
      setValidated(true);
      goSection('note');
      toast.error(`작품별 설명 ${badSection + 1}: 어느 작품의 설명인지 골라 주세요.`);
      return;
    }
    // 약력·작가노트가 비어 있으면 막지 않고 묻는다 — 출품작만 먼저 보내야 하는 경우가 있다(도록을 먼저 만드는 갤러리)
    if (!allowPartial && !proxyFor) {
      const empty = [!hasContent(cv) && '약력', !hasNoteContent(note) && '작가노트'].filter(Boolean) as string[];
      if (empty.length) { setAskPartial(empty); return; }
    }
    if (rep !== repIndex) setRepIndex(rep);
    // 제출 → 모든 작품의 draft 해제(갤러리에 공개)
    const list = filledList.map(a => ({ ...a, draft: false }));
    saveMutation.mutate({
      list,
      rep: repOrdinal(artworkList, rep, list.length),
      full: true,
      msg: proxyFor?.guest ? `${proxyFor.name} 출품 자료를 저장했어요.`
        : proxyFor ? `${proxyFor.name}님의 출품 자료를 저장했어요. 작가에게 알림이 갑니다.` : '갤러리에 제출했어요.',
    });
  };

  // 포트폴리오 경력 + 내 개인정보(이름/연락처/이메일)를 한 번에 약력으로 불러온다.
  // 대신 입력 중이면 **그 작가의 공개 포트폴리오**에서 가져온다 — 갤러리 자신의 것을 넣으면 안 되고,
  // 연락처·이메일은 공개 API 에 없으므로 갤러리가 직접 받아 적는다(없는 정보를 끌어오지 않는다).
  const loadFromPortfolio = async () => {
    try {
      const [{ data: p }, { data: me }] = await Promise.all([
        api.get(proxyFor ? `/portfolio/${proxyFor.id}` : '/portfolio'),
        proxyFor
          ? Promise.resolve({ data: { user: { name: proxyFor.name } } })
          : api.get('/auth/me').then(r => r).catch(() => ({ data: { user: null } })),
      ]);
      const c = p.career || {};
      const u = me?.user;
      setCv(prev => ({
        ...prev,
        nameKo: prev.nameKo || u?.name || '',
        tel: prev.tel || u?.phone || '',
        email: prev.email || u?.email || '',
        // ⚠️ 이미 손으로 적어 둔 항목은 덮지 않는다 — 비어 있는 칸만 포트폴리오에서 채운다. `award` 도 가져온다(2026-09-19), `education` 도(2026-10-03)
        education: prev.education?.length ? prev.education : (c.education || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        solo: prev.solo?.length ? prev.solo : (c.solo || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        group: prev.group?.length ? prev.group : (c.group || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        artFair: prev.artFair?.length ? prev.artFair : (c.artFair || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        award: prev.award?.length ? prev.award : (c.award || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
      }));
      setCvLoaded(true);
    } catch {
      toast.error('불러오지 못했습니다.');
    }
  };

  const openPrint = (doc: SubmissionTab) => {
    window.open(`/exhibitions/${exhibitionId}/operation/print/${targetUserId}/${doc}`, '_blank');
  };

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl bg-gray-100" />;

  const printItems = [
    { label: '출품리스트 PDF', onSelect: () => openPrint('artwork') },
    { label: '약력 PDF', onSelect: () => openPrint('cv') },
    { label: '작가노트 PDF', onSelect: () => openPrint('note') },
  ];

  // 확정됨 → 읽기 전용
  if (confirmed) {
    const r = lockedReason(ended, manualConfirmed);
    return (
      <section className="space-y-4">
        {proxyFor && <h3 className="text-base font-semibold text-gray-950">{proxyFor.name}님의 {SUBMISSION_TERM}</h3>}
        {!proxyFor && data?.proxyEdited && <Notice title="갤러리가 대신 입력한 자료예요">내용이 맞는지 확인해 주세요.</Notice>}
        <Notice title={r.title}>{r.detail}</Notice>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">제출한 내용이에요.</p>
          <MenuButton label="PDF로 받기" icon={<FileDown size={13} aria-hidden />} items={printItems} />
        </div>
        <PageTabBar
          sticky={false}
          idPrefix={`${idPrefix}-ro`}
          label={SUBMISSION_TERM}
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'artwork', label: '출품작', count: filledList.length },
            { id: 'cv', label: '약력' },
            { id: 'note', label: '작가노트' },
          ]}
        />
        <SubmissionReadonly submission={{ artworkList, cv, note, representativeIndex: repIndex }} activeTab={tab} />
      </section>
    );
  }

  // 임시저장해 둔 작품 — 서버엔 있지만 갤러리엔 안 보인다. 있으면 '제출 완료' 로 잠그면 안 된다(낼 길이 없어진다)
  const draftCount = filledList.filter(a => a.draft).length;
  const settledView = server.complete && !anyDirty && draftCount === 0;
  const statusText = proxyFor?.guest ? null
    : proxyFor
    ? '작가에게 받은 내용을 대신 입력해요. 저장하면 작가에게 알림이 가고 작가 화면에도 그대로 보여요.'
    : draftCount > 0 && !anyDirty
      ? `임시저장한 작품 ${draftCount}점은 아직 갤러리에 안 보여요.`
      : server.complete
        ? (settledView ? '갤러리에 제출했어요. 고칠 게 있으면 고친 뒤 다시 제출하세요.' : '고친 내용은 [변경 내용 제출]을 눌러야 갤러리에 보여요.')
        : server.any
          ? '일부만 갤러리에 보냈어요.'
          : null;
  const primaryLabel = saveMutation.isPending
    ? '저장 중…'
    : proxyFor ? '저장' : settledView ? '제출 완료' : server.complete ? '변경 내용 제출' : '갤러리에 제출';
  const primaryDisabled = saveMutation.isPending || (proxyFor ? !anyDirty && draftCount === 0 : settledView);
  const emptyNames = (askPartial ?? []).join('·');
  const titled = artworkList.filter(a => !isBlankArtwork(a) && a.title?.trim());
  const repTitle = repChosen ? (artworkList[repIndex!]!.title?.trim() || `작품 ${repIndex! + 1}`) : null;
  // 남은 것 — 하단 줄이 '남은 것 N · 칸 이름'(누르면 그 구역으로). 작품이 한 점이면 그게 대표작이다(제출 때 저절로 고른다)
  const remaining = checklist.filter(c => !c.done && !(c.key === 'representative' && filledList.length === 1));
  const sectionDone = { artwork: checklist[0]!.done && (checklist[1]!.done || filledList.length === 1), cv: checklist[2]!.done, note: checklist[3]!.done };
  const sectionHead = (n: number, key: SubmissionTab, title: string, doneText: string, print: SubmissionTab) => (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-base font-semibold text-gray-950"><span className="mr-2.5 font-medium text-gray-400">{n}</span>{title}</h3>
      <div className="flex items-center gap-3">
        <span className={cn('text-[13px]', sectionDone[key] ? 'text-gray-500' : validated ? 'font-semibold text-accent' : 'text-gray-500')}>{sectionDone[key] ? `${doneText} ✓` : '아직 없음'}</span>
        <button type="button" onClick={() => openPrint(print)} className="inline-flex min-h-[40px] items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} aria-hidden /> PDF</button>
      </div>
    </div>
  );

  return (
    <section className="space-y-6" data-my-submission>
      {proxyFor && <h3 className="text-base font-semibold text-gray-950">{proxyFor.guest ? `${proxyFor.name} ${SUBMISSION_TERM}` : `${proxyFor.name}님 ${SUBMISSION_TERM} 대신 입력`}</h3>}
      {!proxyFor && data?.proxyEdited && (
        <Notice title="갤러리가 대신 입력한 자료예요">내용이 맞는지 확인해 주세요. 직접 고쳐 제출하면 이 안내는 사라져요.</Notice>
      )}
      {(statusText || anyDirty) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
          {anyDirty && <span className="font-semibold text-accent">저장 안 된 변경</span>}
          {statusText && <span className="min-w-0">{statusText}</span>}
        </p>
      )}

      {/* 1 출품작 — 대표작은 작품 칸의 [☆ 대표작] */}
      <div id={`${idPrefix}-sec-artwork`} className="scroll-mt-24 space-y-4">
        {sectionHead(1, 'artwork', '출품작', `${filledList.length}점`, 'artwork')}
        <p id={`${idPrefix}-rep`} className={cn('flex min-w-0 items-center gap-1.5 text-sm', repErrorLive ? 'text-accent' : 'text-gray-500')}>
          <Star size={14} aria-hidden className={cn('shrink-0', repChosen ? 'fill-gray-900 text-gray-900' : '')} />
          {repTitle
            ? <span className="min-w-0 truncate">대표작 <b className="font-medium text-gray-900">{repTitle}</b> · 엽서·홍보물·도록 첫 장에 들어가요</span>
            : <span>대표작 1점을 골라 주세요 — 엽서·홍보물·도록 첫 장에 들어가요</span>}
        </p>
        <ArtworkListEditor
          value={artworkList}
          onChange={setArtworkList}
          onRemoved={handleArtworkRemoved}
          stateOf={artworkState}
          repIndex={repIndex}
          onRepChange={setRepIndex}
          errors={liveErrors}
          idPrefix={idPrefix}
        />
      </div>

      {/* 2 약력 */}
      <div id={`${idPrefix}-sec-cv`} className="scroll-mt-24 space-y-4 border-t border-gray-200 pt-6">
        {sectionHead(2, 'cv', '약력', '채움', 'cv')}
        {/* 비회원 작가는 홈페이지가 없다 — 불러올 곳이 없으니 칸을 그리지 않는다(규칙 91) */}
        {proxyFor?.guest ? null : !hasContent(cv) ? (
          <Notice action={<button type="button" onClick={loadFromPortfolio} className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50">홈페이지에서 불러오기</button>}>
            {proxyFor ? '작가 홈페이지(포트폴리오)의 이름·경력으로 채울 수 있어요.' : '홈페이지(포트폴리오)에 적은 이름·연락처·경력으로 채울 수 있어요.'}
          </Notice>
        ) : (
          <button type="button" onClick={loadFromPortfolio} className="inline-flex min-h-[40px] items-center gap-1 text-xs text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline">
            <RotateCw size={12} aria-hidden /> 비어 있는 칸을 홈페이지에서 채우기
          </button>
        )}
        {cvLoaded && <p className="text-xs text-gray-500">홈페이지 내용으로 채웠어요 — 확인하고 고쳐 주세요.</p>}
        <CvEditor value={cv} onChange={setCv} />
      </div>

      {/* 3 작가노트 */}
      <div id={`${idPrefix}-sec-note`} className="scroll-mt-24 space-y-4 border-t border-gray-200 pt-6">
        {sectionHead(3, 'note', '작가노트', '채움', 'note')}
        <NoteEditor value={note} onChange={setNote} artworkList={titled} errorAt={noteErrorAt} />
      </div>

      {/* 저장 줄 — 화면 아래에 붙어 따라온다. 휴대폰에선 하단 탭바 위(등록 화면의 StickySubmitBar 와 같은 자리·같은 모양)
          왼쪽 '남은 것 N · 칸 이름' 을 누르면 그 구역으로. 버튼은 [임시저장]·[갤러리에 제출] 둘뿐(규칙 59) */}
      <div data-submission-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] tabbar-hidden:bottom-0 z-30 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur lg:bottom-0">
        <div className="min-w-0 flex-1 text-[13px] text-gray-600 sm:text-sm">
          {settledView && !proxyFor ? (
            <span className="text-gray-700">✓ 갤러리에 제출했어요</span>
          ) : remaining.length > 0 ? (
            // 가장 먼저 채울 것 하나만(목업 — 여럿을 늘어놓으면 휴대폰에서 세 줄로 꺾였다). 마감은 위 진행 띠 아래 줄이 말한다
            <button type="button" onClick={() => goSection(remaining[0]!.tab)} className="min-h-[44px] text-left">
              남은 것 {remaining.length} · <span className="underline underline-offset-4">{remaining[0]!.label}</span>
            </button>
          ) : (
            <span className="text-gray-700">다 채웠어요</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={saveMutation.isPending || !anyDirty}
            title="다 채우지 않아도 지금까지 쓴 내용을 보관합니다. 임시저장한 작품은 갤러리에 보이지 않아요."
            className="min-h-[46px] rounded-lg border border-gray-300 bg-white px-4 text-[15px] text-gray-800 hover:bg-gray-50 disabled:opacity-40"
          >
            임시저장
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={primaryDisabled}
            className="inline-flex min-h-[46px] items-center gap-1.5 rounded-lg bg-gray-900 px-5 text-[15px] font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {!proxyFor && settledView && <Check size={15} aria-hidden />}
            {primaryLabel}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!askPartial}
        title={`${emptyNames}${josa(emptyNames, '이', '가')} 비어 있어요`}
        details={[
          '지금 채운 출품작만 먼저 갤러리에 보냅니다.',
          `${emptyNames}${josa(emptyNames, '은', '는')} 나중에 채워 다시 제출하면 돼요.`,
          ...(submissionDeadline ? [`출품 자료 제출 마감은 ${longDate(submissionDeadline)}이에요.`] : []),
        ]}
        cancelText="계속 작성"
        confirmText="출품작만 먼저 제출"
        onConfirm={() => { setAskPartial(null); submit(true); }}
        onCancel={() => { setAskPartial(null); goSection(!hasContent(cv) ? 'cv' : 'note'); }}
      />
    </section>
  );
}

// ============ 갤러리/Admin: 전 작가 출품 자료 ============
const SUBMISSION_STATE_LABEL = { complete: '제출 완료', partial: '작성 중', none: '시작 전' } as const;

/**
 * 출품 자료 안내 메시지 창 — 아직 다 내지 않은 작가에게 1:1 메시지(ArtTalk). 공모 한 건 화면 할 일 줄의 [N명에게 안내 보내기]가 연다.
 * (예전엔 출품 자료 구역 안의 버튼이었다 — 2026-11-20 부터 주 버튼은 할 일 줄 하나다)
 */
export function SubmissionRemindDialog({ exhibitionId, exhibitionTitle, rows, onClose }: {
  exhibitionId: string;
  exhibitionTitle: string;
  rows: { user: any; guest?: boolean; submission: OperationSubmission }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // 비회원 작가(규칙 91)는 받을 수 없다 — 서버도 회원에게만 보낸다
  const incomplete = rows.filter(({ guest, submission }) => !guest && submissionMissingParts(submission).length > 0);
  const mutation = useMutation({
    mutationFn: (payload: { subject: string; content: string }) => api.post(`/operations/${exhibitionId}/submission-reminders`, payload),
    onSuccess: (res) => { toast.success(`출품 자료 안내를 ${res.data.sentCount}명에게 보냈어요.`); onClose(); qc.invalidateQueries({ queryKey: ['chats'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '안내를 보내지 못했습니다.'),
  });
  return (
    <DmComposeModal
      open
      title="출품 자료 제출 안내"
      description="아직 다 내지 않은 작가에게 1:1 메시지로 보내요. 문구는 고쳐서 보낼 수 있어요."
      recipients={incomplete.map(({ user, submission }) => ({ id: user.id, name: nameWithNickname(user), note: submissionMissingParts(submission).join(' · ') }))}
      defaultSubject={`[${exhibitionTitle}] 출품 자료 제출 안내`}
      defaultContent={[
        `안녕하세요. ${exhibitionTitle} 운영팀입니다.`,
        '',
        '전시 준비를 위해 아직 내지 않은 출품 자료를 확인해 주세요.',
        '마이페이지 [내 전시]에서 비어 있는 항목을 채워 [갤러리에 제출]을 눌러 주시면 됩니다.',
        '',
        `바로가기: ${window.location.origin}/mypage?tab=applications&ex=${exhibitionId}`,
      ].join('\n')}
      sending={mutation.isPending}
      sendLabel={(n) => `${n}명에게 보내기`}
      onSend={(v) => mutation.mutate(v)}
      onClose={onClose}
    />
  );
}

/**
 * 갤러리/Admin — 작가별 출품 자료 취합 (2026-11-20 개편, 규칙 88).
 * 예전엔 작가마다 카드 한 장('출품작 2점 · 약력 — · 작가노트 —' 글자)이라 무엇이 빠졌는지 읽어야 했고, 취합의 결과물
 * (캡션 · 도록 · 원본 · 출품 자료 PDF)은 [내려받기] 메뉴 안에 숨어 있었다.
 *  - 위 한 줄: '제출 완료 n · 작성 중 n · 시작 전 n · 출품작 n점' | 내려받기 넷을 글자 링크로(휴대폰은 메뉴)
 *  - 표: 대표작 그림 · 작가 · 출품작 · 대표작 · 약력 · 작가노트 · 제출 — 빈 칸은 '—', 미제출은 빨강
 *  - 줄을 펼치면 작품 목록 + 약력 보기 · 작가노트 보기 · 대신 입력 · 이 작가 자료 받기
 * 안내 메시지·전시 확정은 할 일 줄(공모 한 건 화면)이 한다.
 */
export function AdminSubmissionsSection({ exhibitionId, exhibitionTitle, myUserId, confirmed, ended, isAdmin }: {
  exhibitionId: string;
  exhibitionTitle: string;
  myUserId: number;
  confirmed: boolean;
  ended?: boolean;
  isAdmin?: boolean;
}) {
  const wide = useMediaQuery('(min-width: 768px)');
  const qc = useQueryClient();
  // `guest` = 비회원 작가(규칙 91) — 갤러리가 이름만 넣고 자료를 직접 채운 사람. 회원 다음 순서로 온다
  const { data = [], isLoading, refetch, isFetching } = useQuery<{ user: any; guest?: boolean; submission: OperationSubmission }[]>({
    queryKey: ['operation-submissions', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/submissions`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [openId, setOpenId] = useState<number | null>(null);
  /** 펼친 작가의 아래 칸 — 작품(기본) · 약력 · 작가노트 */
  const [detailTab, setDetailTab] = useState<SubmissionTab>('artwork');
  const dl = useSubmissionDownloads(exhibitionId, exhibitionTitle, data);
  const { downloads, busyLabel, missing, totalArtworks, downloadArtistImages } = dl;
  /** 지금 대신 입력 중인 작가 (null = 보기 모드). 자료를 못 올리는 작가를 갤러리가 도와주는 경로 */
  const [proxyEditId, setProxyEditId] = useState<number | null>(null);
  // 한 번 열었던 대신입력 폼은 접어도 언마운트하지 않는다 — 입력 중인 내용이 통째로 사라졌다(2026-09-19)
  const [proxyOpened, setProxyOpened] = useState<Set<number>>(() => new Set());
  // 잠금 기준은 확정이 아니라 **전시종료**다. 확정 잠금은 *작가가* 인쇄 기준을 몰래 바꾸는 걸
  // 막는 장치라, 캡션·엽서를 만드는 갤러리까지 막으면 정작 도와줘야 할 때 못 돕는다.
  // 종료 후는 판매 기록이 출품목록 '위치'에 묶여 있어 반드시 막는다(Admin 만 예외).
  const canProxyEdit = !ended || !!isAdmin;
  /** 비회원 작가를 넣고 빼는 것도 같은 잠금(전시 종료 뒤엔 관리자만) — 판매가 출품 목록 '위치'에 묶인다 */
  const canManageGuests = canProxyEdit;
  const [guestDialog, setGuestDialog] = useState<{ mode: 'add' } | { mode: 'rename'; id: number; name: string } | null>(null);
  const [removeGuest, setRemoveGuest] = useState<{ id: number; name: string } | null>(null);
  const refreshGuests = () => {
    for (const queryKey of [['operation-submissions', exhibitionId], ['operation-settlement', exhibitionId], ['my-operation-overview']]) qc.invalidateQueries({ queryKey });
  };
  const openProxy = (uid: number) => {
    setOpenId(uid);
    setDetailTab('artwork');
    setProxyOpened((prev) => new Set(prev).add(uid));
    setProxyEditId(uid);
  };
  const errText = (e: unknown, fb: string) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fb;
  const addGuestMutation = useMutation({
    mutationFn: (name: string) => api.post(`/operations/${exhibitionId}/guest-artists`, { name }).then(r => r.data),
    onSuccess: async (res: { user: { id: number } }) => {
      setGuestDialog(null);
      await qc.invalidateQueries({ queryKey: ['operation-submissions', exhibitionId] });
      refreshGuests();
      // 넣자마자 그 작가의 입력 칸을 연다 — 넣은 이유가 자료를 채우려는 것이다
      openProxy(res.user.id);
      window.setTimeout(() => document.querySelector(`[data-submission-artist="${res.user.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    },
    onError: (e) => toast.error(errText(e, '추가하지 못했어요.')),
  });
  const renameGuestMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.patch(`/operations/${exhibitionId}/guest-artists/${id}`, { name }),
    onSuccess: () => { setGuestDialog(null); refreshGuests(); toast.success('이름을 바꿨어요.'); },
    onError: (e) => toast.error(errText(e, '이름을 바꾸지 못했어요.')),
  });
  const removeGuestMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/operations/${exhibitionId}/guest-artists/${id}`),
    onSuccess: (_r, id) => {
      setRemoveGuest(null);
      if (openId === id) { setOpenId(null); setProxyEditId(null); }
      refreshGuests();
      toast.success('뺐어요.');
    },
    onError: (e) => { setRemoveGuest(null); toast.error(errText(e, '빼지 못했어요.')); },
  });
  /*
    로그인이 풀리기 전에 어느 작가 자료를 대신 입력하던 중이었으면(이 기기에 남아 있으면) 그 작가를 펼치고 대신 입력을 연 채로 —
    거기서 편집기가 되살린다(2026-11-21 O6, lib/authStash). 처음 목록을 받았을 때 한 번만(렌더 중 상태 맞추기)
  */
  const [stashChecked, setStashChecked] = useState(false);
  if (!stashChecked && !isLoading) {
    setStashChecked(true);
    const prefix = stashKeys.submissionPrefix(exhibitionId);
    const target = canProxyEdit
      ? authStashKeys(myUserId, prefix).map((k) => Number(k.slice(prefix.length))).find((uid) => data.some((r) => r.user.id === uid))
      : undefined;
    if (target != null) {
      setOpenId(target);
      setProxyOpened((prev) => new Set(prev).add(target));
      setProxyEditId(target);
    }
  }

  const states = data.map(({ submission }) => submissionState(submission));
  const count = (k: 'complete' | 'partial' | 'none') => states.filter(s => s === k).length;

  const openPrint = (userId: number, doc: SubmissionTab) => {
    window.open(`/exhibitions/${exhibitionId}/operation/print/${userId}/${doc}`, '_blank');
  };

  const guestDialogs = (
    <>
      {guestDialog && (
        <GuestArtistDialog
          mode={guestDialog.mode}
          initialName={guestDialog.mode === 'rename' ? guestDialog.name : ''}
          busy={addGuestMutation.isPending || renameGuestMutation.isPending}
          onClose={() => setGuestDialog(null)}
          onSubmit={(name) => (guestDialog.mode === 'add' ? addGuestMutation.mutate(name) : renameGuestMutation.mutate({ id: guestDialog.id, name }))}
        />
      )}
      <ConfirmDialog
        open={!!removeGuest}
        title={`${removeGuest?.name ?? ''} 작가를 뺄까요?`}
        details={['넣어 둔 출품 자료도 함께 지워져요.', '판매 기록이 있으면 뺄 수 없어요.']}
        confirmText="빼기"
        variant="danger"
        onConfirm={() => removeGuest && removeGuestMutation.mutate(removeGuest.id)}
        onCancel={() => setRemoveGuest(null)}
      />
    </>
  );
  const addGuestButton = canManageGuests && (
    <button type="button" data-add-guest onClick={() => setGuestDialog({ mode: 'add' })} className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium text-gray-950 hover:underline hover:underline-offset-4">
      <Plus size={16} aria-hidden /> 비회원 작가 추가
    </button>
  );

  if (isLoading) return <div className="h-20 animate-pulse rounded-xl bg-gray-100" />;
  if (data.length === 0) {
    return (
      <div className="space-y-3 py-8" data-submissions-empty>
        <p className="text-[15px] font-semibold text-gray-950">아직 참여 작가가 없어요</p>
        <p className="text-sm leading-relaxed text-gray-500">[지원자]에서 수락한 작가가 여기 모여요.{canManageGuests && <><br />가입하지 않은 작가는 직접 추가할 수 있어요.</>}</p>
        {addGuestButton && <div className="pt-1">{addGuestButton}</div>}
        {guestDialogs}
      </div>
    );
  }

  const cols = 'grid grid-cols-[56px_minmax(0,1fr)_64px_64px_64px_72px_120px_84px] items-center gap-x-4';
  const mark = (on: boolean) => (on ? <span>✓<span className="sr-only">있음</span></span> : <span className="text-gray-400">—<span className="sr-only">없음</span></span>);

  return (
    <div className="space-y-1" data-submissions>
      {/* 위 한 줄 — 현황 | 내려받기 */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <p className="text-sm text-gray-600">
          <b className="font-semibold text-gray-950">제출 완료 {count('complete')}</b>
          {count('partial') > 0 && <> · 작성 중 {count('partial')}</>}
          {count('none') > 0 && <> · 시작 전 {count('none')}</>}
          <span className="text-gray-500"> · 출품작 {totalArtworks}점</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
          {totalArtworks > 0 && (wide && !busyLabel ? (
            <>
              <span className="text-gray-500">내려받기</span>
              {downloads.map(d => (
                <button key={d.key} type="button" onClick={d.onSelect} title={d.hint} className="min-h-[40px] text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline">{d.label}</button>
              ))}
            </>
          ) : (
            <MenuButton label="내려받기" icon={<FileDown size={13} aria-hidden />} busyLabel={busyLabel} items={downloads.map(d => ({ label: d.label, hint: d.hint, onSelect: d.onSelect }))} />
          ))}
          <button type="button" onClick={() => refetch()} disabled={isFetching} aria-label="새로고침" title="새로고침" className="grid h-10 w-10 place-items-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40">
            <RotateCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {missing && (
        <MissingImagesBanner items={missing.items} what={missing.what} busy={dl.busy} onRetry={missing.retry} onDismiss={dl.clearMissing} />
      )}

      <div role="table" aria-label={`작가별 ${SUBMISSION_TERM}`} className="border-t-2 border-gray-900">
        {wide && (
          <div role="row" className={cn(cols, 'min-h-[40px] border-b border-gray-200 text-[12.5px] text-gray-500')}>
            <span role="columnheader" />
            <span role="columnheader">작가</span>
            <span role="columnheader">출품작</span>
            <span role="columnheader">대표작</span>
            <span role="columnheader">약력</span>
            <span role="columnheader">작가노트</span>
            <span role="columnheader">제출</span>
            <span role="columnheader" />
          </div>
        )}
        {data.map((row, i) => {
          const { user, submission } = row;
          const guest = !!row.guest;
          const isOpen = openId === user.id;
          const artCount = submission.artworkList?.length || 0;
          const repIdx = submission.representativeIndex ?? (artCount === 1 ? 0 : null);
          const rep = repIdx != null ? submission.artworkList?.[repIdx] : submission.artworkList?.[0];
          const hasRep = repIdx != null && !!submission.artworkList?.[repIdx];
          const hasCv = hasContent(submission.cv);
          const hasNote = hasNoteContent(submission.note);
          const state = states[i]!;
          const name = nameWithNickname(user);
          // 비회원 작가는 펼치면 바로 입력 칸 — 볼 사람이 아니라 채울 사람이다(규칙 91)
          const toggle = () => {
            if (!isOpen && guest && canProxyEdit) { openProxy(user.id); return; }
            setOpenId(isOpen ? null : user.id); setDetailTab('artwork'); if (isOpen) setProxyEditId(null);
          };
          const repImg = rep?.image
            ? <Thumb src={rep.image} alt="" className="h-14 w-14 shrink-0 bg-white object-contain" />
            : <span className="grid h-14 w-14 shrink-0 place-items-center bg-gray-50"><ImageOff size={15} className="text-gray-300" aria-hidden /></span>;
          const stateText = (
            <span className={cn('text-[13.5px]', state === 'complete' ? 'text-gray-600' : 'font-semibold text-accent')}>
              {state === 'complete' && '✓ '}{(guest ? GUEST_SUBMISSION_STATE_LABEL : SUBMISSION_STATE_LABEL)[state]}
            </span>
          );
          return (
            <div key={user.id} role="rowgroup" data-submission-artist={user.id} className="border-b border-gray-200">
              {wide ? (
                <div role="row" className={cn(cols, 'min-h-[76px] py-2.5')}>
                  {repImg}
                  <span role="cell" className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-gray-950" title={name}>{name}</span>
                      {guest && <GuestChip />}
                    </span>
                    {guest
                      ? <span className="block text-[12.5px] text-gray-500">갤러리가 입력</span>
                      : (submission as any).proxyEdited && <span className="block text-[12.5px] text-gray-500">대신 입력함</span>}
                  </span>
                  <span role="cell" className="text-[14.5px] tabular-nums text-gray-800">{artCount > 0 ? `${artCount}점` : <span className="text-gray-400">—</span>}</span>
                  <span role="cell" className="text-[14.5px] text-gray-800">{mark(hasRep)}</span>
                  <span role="cell" className="text-[14.5px] text-gray-800">{mark(hasCv)}</span>
                  <span role="cell" className="text-[14.5px] text-gray-800">{mark(hasNote)}</span>
                  <span role="cell">{stateText}</span>
                  <button type="button" onClick={toggle} aria-expanded={isOpen} className="justify-self-end min-h-[44px] text-[13.5px] font-medium text-gray-900 underline underline-offset-4">
                    {isOpen ? '접기' : '펼치기'}<span className="sr-only"> {name}</span>
                  </button>
                </div>
              ) : (
                <button type="button" onClick={toggle} aria-expanded={isOpen} className="flex w-full min-h-[76px] items-center gap-3 py-2.5 text-left">
                  {repImg}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold text-gray-950">{name}</span>
                      {guest && <GuestChip />}
                    </span>
                    <span className="block truncate text-[12.5px] text-gray-500">
                      {guest && '갤러리가 입력 · '}출품작 {artCount} · 대표작 {hasRep ? '✓' : '—'} · 약력 {hasCv ? '✓' : '—'} · 작가노트 {hasNote ? '✓' : '—'}
                    </span>
                  </span>
                  {stateText}
                </button>
              )}

              {isOpen && (
                <div className={cn('space-y-3 pb-5', wide && 'pl-[72px]')}>
                  {/* 대신 입력 — 작가 본인이 쓰는 편집기를 그대로 띄운다(검증·임시저장 규칙이 갈라지면 안 된다) */}
                  {proxyOpened.has(user.id) && (
                    <div className={proxyEditId === user.id ? 'border-t border-gray-100 pt-4' : 'hidden'}>
                      {/* 확정 후에도 열어두되, 인쇄물이 이미 나갔을 수 있다는 건 반드시 알린다 */}
                      {confirmed && (
                        <Notice className="mb-4"><b className="font-medium text-gray-900">확정 이후예요.</b> 캡션·도록을 이미 만들었다면 고친 뒤 인쇄물도 다시 확인해 주세요.</Notice>
                      )}
                      <MySubmissionSection exhibitionId={exhibitionId} myUserId={myUserId} confirmed={false} proxyFor={{ id: user.id, name, guest }} />
                    </div>
                  )}
                  {proxyEditId !== user.id && (
                    <>
                      <SubmissionReadonly submission={submission} activeTab={detailTab} />
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-100 pt-2 text-[13.5px]">
                        {detailTab !== 'artwork' && <button type="button" onClick={() => setDetailTab('artwork')} className="min-h-[44px] text-gray-700 underline underline-offset-4 hover:text-gray-950">출품작 보기</button>}
                        {detailTab !== 'cv' && <button type="button" onClick={() => setDetailTab('cv')} className="min-h-[44px] text-gray-700 underline underline-offset-4 hover:text-gray-950">약력 보기</button>}
                        {detailTab !== 'note' && <button type="button" onClick={() => setDetailTab('note')} className="min-h-[44px] text-gray-700 underline underline-offset-4 hover:text-gray-950">작가노트 보기</button>}
                        {canProxyEdit && (
                          <button type="button" onClick={() => { setProxyOpened((prev) => new Set(prev).add(user.id)); setProxyEditId(user.id); }} className="min-h-[44px] text-gray-700 underline underline-offset-4 hover:text-gray-950">
                            {guest ? '자료 입력' : '대신 입력'}
                          </button>
                        )}
                        <MenuButton
                          label="이 작가 자료 받기"
                          icon={<FileDown size={13} aria-hidden />}
                          items={[
                            { label: '출품리스트 PDF', onSelect: () => openPrint(user.id, 'artwork') },
                            { label: '약력 PDF', onSelect: () => openPrint(user.id, 'cv') },
                            { label: '작가노트 PDF', onSelect: () => openPrint(user.id, 'note') },
                            { label: '작품 원본 (ZIP)', disabled: artCount === 0, onSelect: () => downloadArtistImages(row) },
                          ]}
                        />
                      </div>
                    </>
                  )}
                  {proxyEditId === user.id && (
                    <button type="button" onClick={() => setProxyEditId(null)} className="min-h-[44px] text-[13.5px] text-gray-700 underline underline-offset-4 hover:text-gray-950">{guest ? '입력 닫기' : '대신 입력 닫기'}</button>
                  )}
                  {/* 비회원 작가 — 이름 바꾸기 · 빼기(판매 기록이 생기면 서버가 막는다) */}
                  {guest && canManageGuests && (
                    <div className="flex flex-wrap items-center gap-x-5 text-[13.5px]" data-guest-actions>
                      <button type="button" onClick={() => setGuestDialog({ mode: 'rename', id: user.id, name: user.name })} className="min-h-[44px] text-gray-700 underline underline-offset-4 hover:text-gray-950">이름 바꾸기</button>
                      <button type="button" onClick={() => setRemoveGuest({ id: user.id, name: user.name })} className="min-h-[44px] text-gray-700 underline underline-offset-4 hover:text-gray-950">이 작가 빼기</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {addGuestButton && <div className="pt-1">{addGuestButton}</div>}
      {guestDialogs}
    </div>
  );
}

// 읽기 전용 출품 자료 (갤러리/Admin, 잠긴 작가 화면)
function SubmissionReadonly({ submission, activeTab = 'artwork' }: { submission: OperationSubmission; activeTab?: SubmissionTab }) {
  const { artworkList = [], cv, note } = submission;
  const repIndex = submission.representativeIndex ?? null;
  const empty = <p className="text-sm text-gray-400">비어 있어요.</p>;
  return (
    <div className="text-sm">
      {/* 출품작 — 제목/메타 2줄 + 가격 우측 정렬(제목 길이와 무관하게 컬럼 시작·끝점 고정) */}
      {activeTab === 'artwork' && (artworkList.length === 0 ? empty : (
        <ul className="divide-y divide-gray-100">
          {artworkList.map((a, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5">
              {a.image
                ? <Thumb src={a.image} alt="" className="h-16 w-16 shrink-0 bg-white object-contain" />
                : <div className="grid h-16 w-16 shrink-0 place-items-center bg-gray-50"><ImageOff size={14} className="text-gray-300" aria-hidden /></div>}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate font-medium text-gray-900" title={a.title || undefined}>{a.title || '(제목 없음)'}</span>
                  {repIndex === i && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-gray-500"><Star size={10} className="fill-gray-900 text-gray-900" aria-hidden /> 대표작</span>
                  )}
                </p>
                {[a.size, a.medium, a.year].some(Boolean) && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">{[a.size, a.medium, a.year].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              {a.price && <span className="shrink-0 tabular-nums text-gray-700">{formatArtworkPrice(a.price)}</span>}
            </li>
          ))}
        </ul>
      ))}
      {/* 약력 */}
      {activeTab === 'cv' && (!hasContent(cv) ? empty : (
        <div className="space-y-1.5 text-gray-700">
          <p>{cv!.nameKo}{cv!.tel ? ` · ${cv!.tel}` : ''}{cv!.email ? ` · ${cv!.email}` : ''}</p>
          {CV_SECTIONS.map(({ key, label }) => (cv![key]?.length > 0) && (
            <p key={key}><span className="text-gray-400">{label}: </span>{cv![key].map(e => `${e.year} ${e.content}`.trim()).join(' / ')}</p>
          ))}
        </div>
      ))}
      {/* 노트 — 전체 노트와 작품별 상세설명(썸네일 + 제목 + 본문)을 구분해서 보여준다 */}
      {activeTab === 'note' && (!hasNoteContent(note) ? empty : (
        <div className="space-y-4">
          {note!.statement && <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{note!.statement}</p>}
          {!!note!.sections?.length && (
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">작품별 설명 {note!.sections.length}</p>
              <ul className="space-y-3">
                {note!.sections.map((s, i) => {
                  const art = artworkList.find(a => a.title?.trim() === s.title);
                  return (
                    <li key={i} className="flex items-start gap-3">
                      {art?.image
                        ? <Thumb src={art.image} alt="" className="h-12 w-12 shrink-0 rounded bg-gray-50 object-contain" />
                        : <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-gray-100"><ImageOff size={14} className="text-gray-300" aria-hidden /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900">{s.title || '(작품 미선택)'}</p>
                        <p className={cn('mt-0.5 whitespace-pre-wrap', s.body ? 'text-gray-600' : 'text-gray-300')}>{s.body || '설명 없음'}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ 작가 본인 정산 확인 (전시 종료 후) — 확인 / 이의 ============
/**
 * 작가 본인 정산 확인 (2026-11-20 개편, 규칙 88).
 * 맨 위에 **내 정산액**을 가장 크게 · 기한(답이 없으면 자동 확인) · 판매된 작품 · 계산 · [내 정산서 PDF].
 * 하단 고정 줄 [이의 제기] [정산 확인] — 예전엔 '갤러리가 정산 확인을 요청했어요' 가 할 일 줄과 안내 상자에 두 번 적혔고,
 * 내 정산액이 합계 줄의 셋째 칸에 판매 합계와 같은 크기로 있었다.
 * 이의는 창에서 쓴다 — 무엇이 다른지 적어 보내면 갤러리 정산 표의 내 머리에 그대로 뜨고, 갤러리가 고쳐 다시 요청하면 알림이 온다.
 */
export function MyArtistSettlementSection({ exhibitionId }: { exhibitionId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ exhibitionTitle: string; ended: boolean; requested?: boolean; settled?: boolean; settledAt?: string | null; artist: SettlementArtist | null; myApproval?: { status: string; comment?: string | null; autoApproved?: boolean; respondedAt?: string | null } | null; fingerprint?: string; autoApproveAt?: string | null; cardFeeRate?: number }>({
    queryKey: ['operation-my-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/my-settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [downloading, setDownloading] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [comment, setComment] = useState('');

  const respondMutation = useMutation({
    // fingerprint: 지금 화면에 그린 금액의 지문. 갤러리가 검토 중에 금액을 고칠 수 있으므로
    // 서버가 이걸 대조해 **내가 본 적 없는 금액에 동의하는 사고**를 막는다(불일치 시 409).
    mutationFn: (body: { approve: boolean; comment?: string }) =>
      api.post(`/operations/${exhibitionId}/settlement/respond`, { ...body, fingerprint: data?.fingerprint }),
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? '정산을 확인했어요.' : '이의를 갤러리에 보냈어요.');
      setIssueOpen(false); setComment('');
      qc.invalidateQueries({ queryKey: ['operation-my-settlement', exhibitionId] });
      qc.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error || '처리에 실패했습니다.');
      // 최신 내역·단계를 바로 다시 그린다 — 금액이 바뀐 409 뿐 아니라 그 사이 정산이 끝났거나(400) 요청이 취소된 경우도
      // 옛 화면(답하는 줄)이 남아 있으면 같은 실패를 되풀이한다(2026-11-20 신뢰성 점검 REL-06). 이의 창에 쓴 글은 그대로 둔다
      for (const k of [['operation-my-settlement', exhibitionId], ['my-applications'], ['operation-access', exhibitionId]]) qc.invalidateQueries({ queryKey: k });
    },
    onSettled: () => { responding.current = false; },
  });
  /*
    연타 한 번은 한 번으로(2026-11-20 S12) — '처리 중' 은 요청이 시작된 다음 렌더에야 그려져서, 그 사이 두 번째 클릭이
    같은 응답을 또 보냈다(E2E 87 이 요청 수로 잡았다). 결과가 올 때까지 다음 응답을 받지 않는다
  */
  const responding = useRef(false);
  const respond = (body: { approve: boolean; comment?: string }) => {
    if (responding.current) return;
    responding.current = true;
    respondMutation.mutate(body);
  };

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-gray-100" />;
  const requested = !!data?.requested, settled = !!data?.settled;
  // 확인 요청/완료 전에는 작가에게 내역 비공개
  if ((!requested && !settled) || !data?.artist) {
    return <p className="py-8 text-sm text-gray-500">갤러리가 판매 내역을 정리해 확인을 요청하면 여기에 내 정산 내역이 보여요.</p>;
  }
  const a = data.artist;
  const sold = a.works.filter(w => w.sold);
  const myStatus = data.myApproval?.status;
  const open = requested && !settled;
  const answered = myStatus === 'APPROVED' || myStatus === 'ISSUE';

  // 이의를 다시 보낼 땐 지난번 글을 채워 둔다 — 고쳐서 보내는 경우가 대부분이다
  const openIssue = () => {
    if (!comment.trim() && myStatus === 'ISSUE' && data?.myApproval?.comment) setComment(data.myApproval.comment);
    setIssueOpen(true);
  };

  const downloadMine = async () => {
    setDownloading(true);
    try {
      const { downloadArtistSettlementPdf } = await import('@/lib/operationPdf');
      // forArtist: 작가 본인 문서라 갤러리 몫 금액은 찍지 않는다 (화면 표기와 맞춤)
      const { missing } = await downloadArtistSettlementPdf(data.exhibitionTitle, { ...a, approval: data.myApproval ?? null }, undefined, undefined, { forArtist: true, cardFeeRate: data.cardFeeRate ?? 0, exhibitionId });
      if (missing.length > 0) toast.error(`작품 이미지 ${missing.length}건이 빠졌습니다: ${missing.slice(0, 3).join(', ')}`, { duration: 8000 });
    } catch { toast.error('PDF 생성 실패'); } finally { setDownloading(false); }
  };

  return (
    <section className="space-y-6" data-my-settlement>
      {/* 맨 위 — 내 정산액. 상태 한 줄은 그 아래 */}
      <div>
        <p className="text-[13.5px] text-gray-500">{settled ? '정산 완료 · 내 정산액' : '내 정산액'}</p>
        <p className="mt-1 text-[34px] font-bold leading-tight tracking-tight text-gray-950 tabular-nums">
          {a.artistAmount.toLocaleString('ko')}<span className="ml-1 text-xl font-semibold">원</span>
        </p>
        <p className="mt-2.5 text-sm text-gray-600" data-settle-status>
          {settled
            ? `정산이 끝났어요${data.settledAt ? ` · ${longDate(data.settledAt)}` : ''}. 아래 내역이 최종이에요.`
            : myStatus === 'APPROVED'
              ? (data.myApproval?.autoApproved ? '✓ 기한 안에 답이 없어 자동으로 확인됐어요. 다르면 갤러리에 문의해 주세요.' : '✓ 확인했어요. 갤러리가 정산을 마무리하면 알려 드려요.')
              : myStatus === 'ISSUE'
                ? '이의를 보냈어요. 갤러리가 고쳐 다시 요청하면 알려 드려요.'
                // 침묵이 동의로 바뀌는 규칙이라, 기한은 반드시 눈에 보여야 한다
                : data.autoApproveAt
                  ? <><b className="font-semibold text-accent">{longDate(data.autoApproveAt)}</b>까지 답이 없으면 자동으로 확인돼요.</>
                  : '갤러리가 정산 확인을 요청했어요.'}
        </p>
        {myStatus === 'ISSUE' && data.myApproval?.comment && open && (
          <blockquote className="mt-3 break-keep text-[15px] leading-relaxed text-gray-950 [overflow-wrap:anywhere]">“{data.myApproval.comment}”</blockquote>
        )}
      </div>

      <div>
        <h3 className="border-b-2 border-gray-900 pb-2.5 text-[13.5px] font-semibold text-gray-950">판매된 작품 {sold.length}점</h3>
        {sold.length === 0 ? (
          <p className="border-b border-gray-200 py-4 text-sm text-gray-500">판매된 작품이 없어요.</p>
        ) : (
          <ul>
            {sold.map((w, i) => (
              <li key={i} className="flex min-h-[84px] items-center gap-3.5 border-b border-gray-100 text-[15px]">
                {w.image ? <Thumb src={w.image} alt="" className="h-[60px] w-[60px] shrink-0 bg-white object-contain" /> : <span className="grid h-[60px] w-[60px] shrink-0 place-items-center bg-gray-50"><ImageOff size={14} className="text-gray-300" aria-hidden /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-gray-950">{w.title || '(제목 없음)'}</span>
                  <span className="block text-[13px] text-gray-500">{w.paymentMethod === 'CASH' ? '현금' : '카드'}</span>
                </span>
                <span className="shrink-0 tabular-nums text-gray-900">{w.soldPrice.toLocaleString('ko')}원</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="text-sm">
          <div className="flex justify-between border-b border-gray-100 py-3"><dt className="text-gray-600">판매 합계</dt><dd className="tabular-nums text-gray-900">{a.total.toLocaleString('ko')}원</dd></div>
          {/* 수수료를 뗐으면 반드시 보여준다 — 작가가 수락 여부를 판단하는 근거다 */}
          {(a.cardFee ?? 0) > 0 && (
            <>
              <div className="flex justify-between border-b border-gray-100 py-3"><dt className="text-gray-600">카드 수수료{data.cardFeeRate ? ` (${data.cardFeeRate}%)` : ''}</dt><dd className="tabular-nums text-gray-900">-{(a.cardFee ?? 0).toLocaleString('ko')}원</dd></div>
              <div className="flex justify-between border-b border-gray-100 py-3"><dt className="text-gray-600">정산 대상</dt><dd className="tabular-nums text-gray-900">{(a.settleBase ?? 0).toLocaleString('ko')}원</dd></div>
            </>
          )}
          <div className="flex justify-between border-b border-gray-100 py-3"><dt className="text-gray-600">비율</dt><dd className="text-gray-900">갤러리 {a.galleryRatio}% : 작가 {a.artistRatio}%</dd></div>
          <div className="flex justify-between border-b border-gray-200 py-3"><dt className="font-semibold text-gray-950">내 정산액</dt><dd className="font-bold tabular-nums text-gray-950">{a.artistAmount.toLocaleString('ko')}원</dd></div>
        </dl>
        <button type="button" onClick={downloadMine} disabled={downloading} className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline disabled:opacity-50">
          {downloading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FileDown size={14} aria-hidden />} 내 정산서 PDF
        </button>
      </div>

      {/* 답하는 줄 — 아직 답하지 않았거나 이의를 낸 동안. 휴대폰은 하단 탭바 위 */}
      {open && myStatus !== 'APPROVED' && (
        <div data-settle-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] tabbar-hidden:bottom-0 z-30 -mx-1 grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur sm:flex sm:justify-end lg:bottom-0">
          {/* 보조 버튼은 글자 폭만큼(한 줄) — 1:2 칸이면 '이의 다시 보내기' 가 두 줄로 꺾였다(앱 확인) */}
          <button type="button" onClick={openIssue} className="min-h-[50px] whitespace-nowrap rounded-lg border border-gray-300 bg-white px-5 text-[15px] text-gray-900 hover:bg-gray-50">
            {myStatus === 'ISSUE' ? '이의 다시 보내기' : '이의 제기'}
          </button>
          <button
            type="button"
            onClick={() => respond({ approve: true })}
            disabled={respondMutation.isPending}
            className="min-h-[50px] rounded-lg bg-gray-900 px-6 text-[15px] font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
          >
            정산 확인
          </button>
        </div>
      )}
      {open && answered && myStatus === 'APPROVED' && (
        <button type="button" onClick={openIssue} className="min-h-[44px] text-[13.5px] text-gray-600 underline underline-offset-4 hover:text-gray-950">금액이 다르면 이의 제기</button>
      )}

      {issueOpen && (
        <SettlementIssueDialog
          busy={respondMutation.isPending}
          value={comment}
          onChange={setComment}
          onSend={() => (comment.trim() ? respond({ approve: false, comment: comment.trim() }) : toast.error('무엇이 다른지 적어 주세요.'))}
          onClose={() => setIssueOpen(false)}
        />
      )}
    </section>
  );
}

/** 이의 쓰기 창 — 휴대폰은 아래에서 올라오고 PC 는 가운데(등록 화면의 확인 창과 같은 모양). `role="dialog"`(앱 뒤로가기가 Esc 를 보낸다, 규칙 79) */
function SettlementIssueDialog({ value, onChange, onSend, onClose, busy }: { value: string; onChange: (v: string) => void; onSend: () => void; onClose: () => void; busy: boolean }) {
  useEscapeKey(onClose);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = window.setTimeout(() => ref.current?.focus(), 30); return () => window.clearTimeout(t); }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settle-issue-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-[14px] bg-white px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 sm:max-w-md sm:rounded-lg sm:pb-6"
      >
        <h2 id="settle-issue-title" className="text-lg font-semibold text-gray-950">어떤 점이 다른가요?</h2>
        <label htmlFor="settle-issue-text" className="sr-only">이의 내용</label>
        <textarea
          id="settle-issue-text"
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="예: '수평선' 판매가가 다릅니다. 150만 원에 팔렸어요."
          className="mt-4 w-full resize-none rounded-lg border border-gray-300 px-3.5 py-3 text-base leading-relaxed focus:border-gray-500 focus:outline-none"
        />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[50px] rounded-lg border border-gray-300 px-5 text-[15px] text-gray-700 hover:bg-gray-50">취소</button>
          <button type="button" onClick={onSend} disabled={busy} className="min-h-[50px] flex-1 rounded-lg bg-gray-900 text-[16px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            {busy ? '보내는 중…' : '이의 보내기'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}


// ============ 에디터들 ============

// 출품작 이미지 셀 (compact 업로드)
function ArtworkImageCell({ value, onChange, className = '' }: { value?: string; onChange: (url: string) => void; className?: string }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (raw: File) => {
    setUploading(true);
    try {
      const file = await compressImage(raw);
      if (file.size > MAX_IMAGE_BYTES) { toast.error('이미지 용량이 너무 큽니다.'); return; }
      const fd = new FormData(); fd.append('image', file);
      const res = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(res.data.url);
    } catch { toast.error('이미지 업로드 실패'); } finally { setUploading(false); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find(file => file.type.startsWith('image/'));
    if (f) handle(f);
    else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };
  return (
    <button type="button" onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      title="클릭 또는 이미지를 끌어다 놓기"
      className={`shrink-0 overflow-hidden rounded-lg border border-dashed flex items-center justify-center bg-gray-50 transition-colors ${className || 'w-32 h-32'} ${dragOver ? 'border-gray-600 text-gray-600 bg-gray-100' : 'border-gray-300 text-gray-400 hover:border-gray-400'}`}>
      {/* max-* + contain — 작품 비율은 자르지 않고, 이미지가 칸 높이를 밀어올리지도 않게 한다 */}
      {uploading ? <Loader2 size={20} className="animate-spin" /> : value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <span className="flex flex-col items-center gap-1 text-xs"><Upload size={20} aria-hidden />작품 사진</span>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
    </button>
  );
}

// 크기 문자열 ↔ 가로/세로 분리는 lib/artwork.ts로 옮겼다 (포트폴리오 작품 정보 입력과 표기를 하나로 맞추기 위해)

// 숫자 전용 입력 새니타이저 — 가로/세로는 소수점 1개 허용(72.7cm), 제작년도/가격은 정수만
const decimalOnly = (v: string) => { const t = v.replace(/[^0-9.]/g, ''); const i = t.indexOf('.'); return i === -1 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, ''); };
const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

/**
 * 작품 사진 일괄 업로드 — 여러 장을 한 번에 골라 빈 사진 칸부터 채우고, 모자라면 작품을 새로 추가한다.
 * 파일명을 작품명 기본값으로 넣어 어떤 사진인지 바로 알아볼 수 있게 한다(비어 있을 때만).
 */
function BulkImageUpload({ onAdd }: { onAdd: (items: { image: string; title: string }[]) => void }) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) { toast.error('이미지 파일만 업로드할 수 있습니다.'); return; }
    setBusy({ done: 0, total: images.length });
    const uploaded: { image: string; title: string }[] = [];
    let failed = 0;
    for (let i = 0; i < images.length; i++) {
      try {
        const file = await compressImage(images[i]!);
        if (file.size > MAX_IMAGE_BYTES) { failed++; continue; }
        const fd = new FormData(); fd.append('image', file);
        const res = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        uploaded.push({ image: res.data.url, title: images[i]!.name.replace(/\.[^.]+$/, '') });
      } catch { failed++; }
      setBusy({ done: i + 1, total: images.length });
    }
    setBusy(null);
    if (uploaded.length) onAdd(uploaded);
    if (failed) toast.error(`${failed}장은 올리지 못했습니다.`);
    if (uploaded.length) toast.success(`사진 ${uploaded.length}장을 넣었습니다. 작품 정보를 채워주세요.`);
  };
  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={!!busy}
        className="inline-flex min-h-[40px] items-center gap-1.5 text-sm text-gray-700 hover:text-gray-950 disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
        {busy ? `올리는 중 ${busy.done}/${busy.total}` : '사진 여러 장 한 번에 올리기'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) pick(fs); }} />
    </>
  );
}

function ArtworkListEditor({ value, onChange, onRemoved, stateOf, repIndex, onRepChange, errors, idPrefix }: {
  value: ArtworkItem[];
  onChange: (v: ArtworkItem[]) => void;
  onRemoved?: (i: number) => void;
  stateOf?: (i: number) => SaveState;
  repIndex: number | null;
  onRepChange: (i: number | null) => void;
  /** 작품 번호 → 빈 필수 칸 이름들 (제출을 눌러 본 뒤로만 채워진다) */
  errors: Record<number, string[]>;
  idPrefix: string;
}) {
  const add = () => onChange([...value, { image: '', title: '', size: '', width: '', height: '', medium: '', year: '', price: '' }]);
  // 일괄 업로드: 사진이 비어 있는 기존 작품부터 채우고, 남으면 새 작품으로 추가
  const addImages = (items: { image: string; title: string }[]) => {
    const next = value.map(a => ({ ...a }));
    const queue = [...items];
    for (const a of next) {
      if (queue.length === 0) break;
      if (!a.image) { const it = queue.shift()!; a.image = it.image; if (!a.title.trim()) a.title = it.title; }
    }
    queue.forEach(it => next.push({ image: it.image, title: it.title, size: '', width: '', height: '', medium: '', year: '', price: '' }));
    onChange(next);
  };
  const upd = (i: number, patch: Partial<ArtworkItem>) => onChange(value.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  // 삭제한 위치를 부모에 알린다 — 대표작보다 앞을 지우면 인덱스가 밀려 엉뚱한 작품이 대표작이 된다
  const rm = (i: number) => { onChange(value.filter((_, idx) => idx !== i)); onRemoved?.(i); };
  const inputCls = (bad: boolean) => cn('rounded-lg border px-2.5 py-2 text-sm focus:outline-none', bad ? 'border-accent/60 bg-accent/5 focus:border-accent' : 'border-gray-200 focus:border-gray-400');
  // 단위(cm·원)와 입력 칸의 오른쪽 끝이 같은 세로 열에 오도록 고정 폭
  const unitCol = 'w-7 shrink-0 flex items-center justify-center';
  // 입력 후에도 어느 칸인지 알 수 있도록 항상 보이는 라벨 (placeholder만으론 채우면 사라짐)
  const labelCls = 'mb-1 block text-xs text-gray-500';
  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
          출품할 작품을 넣어 주세요. 사진을 여러 장 한 번에 올리면 작품 칸이 알아서 생겨요.
        </p>
      )}
      {value.map((a, i) => {
        const parsed = splitSize(a.size);
        const w = a.width !== undefined ? a.width : parsed.w;
        const h = a.height !== undefined ? a.height : parsed.h;
        const priceHint = koreanWon(a.price);
        const st: SaveState = stateOf ? stateOf(i) : 'saved';
        const ui = STATE_UI[st];
        const missing = errors[i] ?? [];
        const miss = (label: string) => missing.includes(label);
        const isRep = repIndex === i;
        const blank = isBlankArtwork(a);
        return (
          <div key={i} id={`${idPrefix}-art-${i}`} className={cn('scroll-mt-28 rounded-xl border p-3 sm:p-4', missing.length ? 'border-accent/50' : 'border-gray-200')}>
            {/* 카드 머리 — 번호 · 대표작 · 상태 · 빼기 */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">작품 {i + 1}</span>
              <button
                type="button"
                onClick={() => onRepChange(isRep ? null : i)}
                disabled={blank}
                aria-pressed={isRep}
                title={blank ? '작품을 채우면 대표작으로 고를 수 있어요' : isRep ? '대표작 해제' : '이 작품을 대표작으로'}
                className={cn(
                  'inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  isRep ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900',
                )}
              >
                <Star size={12} aria-hidden className={isRep ? 'fill-white' : ''} /> 대표작
              </button>
              <span className={cn('ml-auto truncate text-xs', ui.text)}>{ui.label}</span>
              <button type="button" onClick={() => rm(i)} className="-my-2 -mr-2 grid h-11 w-11 shrink-0 place-items-center text-gray-400 hover:text-accent" aria-label={`작품 ${i + 1} 빼기`}>
                <Trash2 size={15} />
              </button>
            </div>
            {missing.length > 0 && <p className="mb-3 text-xs text-accent">채워 주세요: {missing.join(' · ')}</p>}
            {/* 모바일: 사진을 위로 쌓는다 (옆에 두면 입력 칸이 짜부라진다) / sm+: 좌측 사진 + 우측 입력 */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <div className="flex shrink-0 flex-col sm:w-40">
                {/* 사진 칸을 absolute로 띄워 레이아웃 높이에서 빼면, 카드 높이는 입력 칸들이 정하고
                    사진 아래선이 '제작년도' 박스 아래와 정확히 맞는다 (이미지가 높이를 밀어올리지 않음) */}
                <div className="relative h-40 w-full sm:h-auto sm:flex-1">
                  <ArtworkImageCell value={a.image} onChange={url => upd(i, { image: url })} className="absolute inset-0 h-full w-full" />
                </div>
              </div>
              {/* 입력 칸은 모두 같은 오른쪽 끝에서 멈추고, 단위(cm·원)는 그 오른쪽 고정 폭 열에 세로로 정렬 */}
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-end gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className={labelCls}>작품명</span>
                    <input value={a.title} onChange={e => upd(i, { title: e.target.value })} placeholder="예: 푸른 밤의 정원" className={cn('w-full', inputCls(miss('작품명')))} />
                  </label>
                  <span className={unitCol} />
                </div>
                {/* 크기: 세로 × 가로 (cm) — 관례가 높이 먼저다(2026-09-16). `size` 문자열은 캡션·hwp 의 단일 출처 */}
                <div className="flex items-end gap-1.5">
                  <label className="w-0 min-w-0 flex-1">
                    <span className={labelCls}>세로</span>
                    <input value={h} onChange={e => { const v = decimalOnly(e.target.value); upd(i, { height: v, size: composeSize(v, w) }); }} placeholder="0" inputMode="decimal" className={cn('w-full text-center', inputCls(miss('크기')))} />
                  </label>
                  <span className="shrink-0 pb-2 text-sm text-gray-400">×</span>
                  <label className="w-0 min-w-0 flex-1">
                    <span className={labelCls}>가로</span>
                    <input value={w} onChange={e => { const v = decimalOnly(e.target.value); upd(i, { width: v, size: composeSize(h, v) }); }} placeholder="0" inputMode="decimal" className={cn('w-full text-center', inputCls(miss('크기')))} />
                  </label>
                  <span className={`${unitCol} items-end pb-2 text-xs text-gray-500`}>cm</span>
                </div>
                <div className="flex items-end gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className={labelCls}>재료</span>
                    <input value={a.medium} onChange={e => upd(i, { medium: e.target.value })} placeholder="예: Acrylic on Canvas" className={cn('w-full', inputCls(miss('재료')))} />
                  </label>
                  <span className={unitCol} />
                </div>
                {/* 제작년도 | 가격(단위 '원' + 한글 금액 힌트) */}
                <div className="flex items-start gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className={`${labelCls} whitespace-nowrap`}>제작년도</span>
                    <input value={a.year} onChange={e => upd(i, { year: digitsOnly(e.target.value).slice(0, 4) })} placeholder="예: 2026" inputMode="numeric" className={cn('w-full', inputCls(miss('제작년도')))} />
                  </label>
                  <label className="relative min-w-0 flex-1">
                    <span className={labelCls}>가격</span>
                    <input value={a.price} onChange={e => upd(i, { price: digitsOnly(e.target.value) })} placeholder="예: 230000" inputMode="numeric" className={cn('w-full text-right', inputCls(miss('가격')))} />
                    {/* 힌트는 absolute — 이 줄이 높아지면 사진 아래선이 제작년도 박스 아래보다 내려간다 */}
                    {priceHint && <span className="absolute right-0 top-full mt-0.5 max-w-full truncate text-[11px] text-gray-400">{priceHint}</span>}
                  </label>
                  <span className={`${unitCol} items-start pt-[1.6rem] text-xs text-gray-500`}>원</span>
                </div>
              </div>
            </div>
            {/* 가격 칸 아래 한글 금액 힌트(absolute)가 들어갈 자리 */}
            <div className="h-4" aria-hidden />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
        <button type="button" onClick={add} className="inline-flex min-h-[40px] items-center gap-1 text-sm text-gray-700 hover:text-gray-950"><Plus size={15} aria-hidden /> 작품 추가</button>
        <BulkImageUpload onAdd={addImages} />
      </div>
    </div>
  );
}

// 작가약력 경력 항목 — 자유 입력 칸(한 줄 = 한 건). 기존 [연도][내용] 데이터는 "연도 내용" 한 줄로 표시.
function EntryListEditor({ label, value, onChange }: { label: string; value: CvEntry[]; onChange: (v: CvEntry[]) => void }) {
  const toText = (entries: CvEntry[]) => entries.map(e => [e.year, e.content].filter(Boolean).join(' ')).join('\n');
  const [raw, setRaw] = useState(() => toText(value));
  useEffect(() => {
    const incoming = toText(value);
    // raw도 저장 시와 동일하게 줄별 trim 후 비교 — 안 그러면 입력 중 끝 공백이 즉시 지워짐(스페이스 안 먹힘)
    const currentNormalized = raw.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    if (incoming !== currentNormalized) setRaw(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const setText = (text: string) => {
    setRaw(text);
    onChange(text.split('\n').map(l => l.trim()).filter(Boolean).map(line => ({ year: '', content: line })));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-800">{label}</span>
      <textarea
        value={raw}
        onChange={e => setText(e.target.value)}
        placeholder={`예: 2025 ${label} 참여\n(한 줄에 한 건씩 자유롭게 입력하세요)`}
        rows={4}
        className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}

function CvEditor({ value, onChange }: { value: ArtistCv; onChange: (v: ArtistCv) => void }) {
  const set = (patch: Partial<ArtistCv>) => onChange({ ...value, ...patch });
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs text-gray-500">이름 (한글)</span><input value={value.nameKo} onChange={e => set({ nameKo: e.target.value })} placeholder="예: 홍길동" className={inputCls} /></label>
        <label className="block"><span className="mb-1 block text-xs text-gray-500">연락처</span><input value={value.tel} onChange={e => set({ tel: formatPhoneNumber(e.target.value) })} placeholder="010-1234-5678" inputMode="numeric" className={inputCls} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs text-gray-500">이메일</span><input value={value.email} onChange={e => set({ email: e.target.value })} placeholder="name@example.com" className={inputCls} /></label>
      </div>
      {CV_SECTIONS.map(({ key, label }) => (
        <EntryListEditor key={key} label={label} value={value[key] ?? []} onChange={v => set({ [key]: v } as Partial<ArtistCv>)} />
      ))}
    </div>
  );
}

/**
 * 작가노트 — 전체 노트 + 작품별 상세설명.
 * 상세설명 대상은 출품작 — 자유 입력 대신 지금 채운 출품작(제목 있는 것)에서 고른다.
 * 저장 형식은 기존과 같은 작품명 문자열이라 PDF·갤러리 열람은 그대로 동작한다.
 * (2026-09-29: 예전엔 '저장한 작품만' 고를 수 있었다 — 저장 버튼이 하나가 되면서 그 제약이 필요 없어졌다)
 */
function NoteEditor({ value, onChange, artworkList = [], errorAt = -1 }: { value: ArtistNote; onChange: (v: ArtistNote) => void; artworkList?: ArtworkItem[]; errorAt?: number }) {
  const set = (patch: Partial<ArtistNote>) => onChange({ ...value, ...patch });
  const updSection = (i: number, patch: Partial<{ title: string; body: string }>) => set({ sections: value.sections.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const rmSection = (i: number) => set({ sections: value.sections.filter((_, idx) => idx !== i) });
  const titled = artworkList.filter(a => a.title?.trim());
  // 한 작품에 상세설명은 하나만 — 이미 쓴 작품은 다른 칸에서 선택 불가
  const usedElsewhere = (exceptIdx: number) => new Set(value.sections.filter((_, idx) => idx !== exceptIdx).map(s => s.title).filter(Boolean));
  const allUsed = titled.length > 0 && titled.every(a => value.sections.some(s => s.title === a.title.trim()));
  const addSection = () => {
    const used = new Set(value.sections.map(s => s.title).filter(Boolean));
    const next = titled.find(a => !used.has(a.title.trim()));
    set({ sections: [...value.sections, { title: next ? next.title.trim() : '', body: '' }] });
  };
  return (
    <div className="space-y-6">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-800">작가노트</span>
        <span className="mb-2 block text-xs text-gray-500">작품 세계 전반에 대한 글이에요. 도록·작가노트 PDF에 그대로 들어가요.</span>
        <textarea value={value.statement} onChange={e => set({ statement: e.target.value })} placeholder="작품 세계 전반에 대한 이야기를 자유롭게 작성하세요." className="h-44 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-gray-400 focus:outline-none" />
      </label>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-800">작품별 설명 <span className="font-normal text-gray-400">(선택)</span></span>
          <button type="button" onClick={addSection} disabled={titled.length === 0 || allUsed} title={allUsed ? '모든 출품작에 설명을 썼어요.' : ''} className="inline-flex min-h-[36px] items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} aria-hidden /> 설명 추가</button>
        </div>
        {titled.length === 0 ? (
          <p className="text-xs text-gray-400">[출품작] 탭에서 작품명을 적으면 여기서 그 작품을 골라 설명을 쓸 수 있어요.</p>
        ) : value.sections.length === 0 ? (
          <p className="text-xs text-gray-400">작품마다 따로 설명을 적고 싶을 때 추가하세요.</p>
        ) : (
          <div className="space-y-2">
            {value.sections.map((s, i) => {
              const matched = titled.find(a => a.title.trim() === s.title);
              const orphan = !!s.title && !matched; // 옛 데이터: 출품리스트에 없는 제목 — 선택지를 유지해 값이 사라지지 않게
              const used = usedElsewhere(i);
              const bad = errorAt === i;
              return (
                // 좌: 작품 이미지 / 우: 작품 선택 + 설명
                <div key={i} className={cn('flex gap-3 rounded-xl border p-3', bad ? 'border-accent/50' : 'border-gray-200')}>
                  {matched?.image ? (
                    <img src={matched.image} alt="" className="min-h-[7rem] w-24 shrink-0 self-stretch rounded bg-gray-50 object-contain sm:w-32" />
                  ) : (
                    <div className="grid min-h-[7rem] w-24 shrink-0 place-items-center self-stretch rounded bg-gray-100 sm:w-32"><ImageOff size={20} className="text-gray-300" aria-hidden /></div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-end gap-2">
                      <label className="min-w-0 flex-1">
                        <span className={cn('mb-1 block text-xs', bad ? 'text-accent' : 'text-gray-500')}>{bad ? '어느 작품의 설명인지 골라 주세요' : '작품'}</span>
                        <select value={s.title} onChange={e => updSection(i, { title: e.target.value })} className={cn('w-full rounded-lg border bg-white px-2.5 py-2 text-sm', bad ? 'border-accent/60' : 'border-gray-200')}>
                          <option value="">작품 선택…</option>
                          {titled.map((a, ai) => {
                            const t = a.title.trim();
                            return <option key={ai} value={t} disabled={used.has(t)}>{ai + 1}. {t}{used.has(t) ? ' (이미 작성됨)' : ''}</option>;
                          })}
                          {orphan && <option value={s.title}>{s.title} (출품작에 없음)</option>}
                        </select>
                      </label>
                      <button type="button" onClick={() => rmSection(i)} className="-mr-1 grid h-10 w-10 shrink-0 place-items-center text-gray-400 hover:text-accent" aria-label={`설명 ${i + 1} 빼기`}><Trash2 size={15} /></button>
                    </div>
                    <label className="flex min-h-0 flex-1 flex-col">
                      <span className="mb-1 block text-xs text-gray-500">설명</span>
                      <textarea value={s.body} onChange={e => updSection(i, { body: e.target.value })} placeholder="선택한 작품에 대한 설명" className="min-h-[5rem] w-full flex-1 resize-y rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-gray-400 focus:outline-none" />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
