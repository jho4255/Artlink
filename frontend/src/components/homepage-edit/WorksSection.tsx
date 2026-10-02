import { memo, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Heart, Loader2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { cn, compressImage, MAX_IMAGE_BYTES } from '@/lib/utils';
import { PORTFOLIO_IMAGE_MAX, seriesNames } from '@/lib/artwork';
import { nextUncaptionedId, recentValues, tileLabel, uncaptionedCount } from '@/lib/homepageEdit';
import { moveId } from '@/lib/portfolioVersions';
import Thumb from '@/components/shared/Thumb';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ArtworkMetaModal, { type ArtworkMetaDraft } from '@/components/shared/ArtworkMetaModal';
import { ArtworkLikersModal } from '@/components/shared/ArtworkDetailModal';
import Notice from '@/components/flow/Notice';
import TaskLine from '@/components/flow/TaskLine';
import type { Portfolio, PortfolioImage } from '@/types';

/**
 * 홈페이지 편집 › [작품] — 올리기 · 작품 정보 · [작가] 탭 소개 · 순서 (2026-10-02)
 *
 * 여기 있는 것은 전부 **누르는 즉시 저장**된다(글 묶음과 달리 아래 [저장]을 기다리지 않는다). 그래서 편집 화면의 저장 바가
 * "사진·작품 정보는 올리는 즉시 저장됩니다" 라고 말해 준다 — 예전엔 "4장 등록 완료" 옆에 "저장되지 않은 변경사항"이 같이 떴다.
 *
 * 예전 격자(`PortfolioImageGrid`)에서 바꾼 것:
 *  - **올리기가 맨 위, 큰 구역.** 점선 네모 한 칸에 "0/150" 만 적혀 있었고 그나마 격자 맨 끝이었다.
 *  - **'공개/비공개' → '작가 탭에도/홈페이지에만'.** 비공개라 적힌 작품도 공개 홈페이지엔 다 보였다(실측 4/4).
 *    그 단추가 정하는 건 [작가] 탭·홈 화면에 내보낼지뿐이다. 새 작품의 기본은 '홈페이지에만'이고,
 *    **올린 직후 한 번** 묻는다(사용자 결정) — 실서버 작가 47명 중 16명이 전부 꺼진 채라 작가 목록에 없었다.
 *  - 노출은 토글(PATCH)이 아니라 **상태를 적어 보낸다**(`PUT /portfolio/images/explore`) — 탭 둘에서 눌러도 거꾸로 꺼지지 않는다.
 *  - **사진 위에 겹치는 단추는 삭제·좋아요뿐.** 178px 칸에 단추 다섯(제목·◀▶·삭제·공개·좋아요)이 겹쳐 있었다.
 *    순서는 [순서 바꾸기]를 눌렀을 때만 사진 아래에 ◀ ▶ 가 나온다.
 *  - 작품 정보는 **이어서 넣는다**(`ArtworkMetaModal` 의 [저장하고 다음 작품]).
 *
 * ⚠️ 올리는 도중에도 이 컴포넌트는 살아 있어야 한다 — 편집 화면이 묶음을 바꿀 때 떼어 내지 않고 `hidden` 으로 감춘다.
 *    떼어 내면 `uploading`·`justUploaded` 가 사라져, 돌아왔을 때 올리던 사진이 없는 것처럼 보인다.
 */
interface Props {
  images: PortfolioImage[];
  /** 작품 정보 창이 열린 작품 — 편집 화면이 들고 있다(완성도 줄·주소의 `do=info` 가 밖에서 연다) */
  metaImageId: number | null;
  onMeta: (id: number | null) => void;
}

const btnSecondary = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50';
const btnPrimary = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';
const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

function WorksSection({ images, metaImageId, onMeta }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** 방금 올린 작품들 — "[작가] 탭에도 소개할까요?" 를 한 번 묻는다 */
  const [justUploaded, setJustUploaded] = useState<number[]>([]);
  /** 이번 방문에서 '홈페이지에만 두기'를 골랐다 → 곧바로 "소개한 작품이 없어요"를 다시 들이밀지 않는다 */
  const [keptPrivate, setKeptPrivate] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [removeId, setRemoveId] = useState<number | null>(null);
  const [likersId, setLikersId] = useState<number | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    queryClient.invalidateQueries({ queryKey: ['explore'] });
  };

  // ── 올리기 ──
  const upload = async (picked: File[]) => {
    if (uploading) return;
    const room = PORTFOLIO_IMAGE_MAX - images.length;
    if (room <= 0) { toast.error(`작품 사진은 최대 ${PORTFOLIO_IMAGE_MAX}장까지 올릴 수 있어요.`); return; }
    const list = picked.slice(0, room);
    if (picked.length > room) toast(`${PORTFOLIO_IMAGE_MAX}장까지라 ${room}장만 올립니다.`);
    setUploading({ done: 0, total: list.length });
    const created: number[] = [];
    // 한 장씩 차례로 — 파일 업로드가 아니라 **작품 등록(POST /portfolio/images)** 까지 끝나야 올린 것이다(감사 M12).
    // 순서대로 기다리므로 한도를 넘기는 동시 요청도 없고, 고른 순서가 곧 작품 순서가 된다.
    for (const [i, raw] of list.entries()) {
      try {
        const file = await compressImage(raw);
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${raw.name}: 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
          continue;
        }
        const form = new FormData();
        form.append('image', file);
        const up = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        const res = await api.post('/portfolio/images', { url: up.data.url });
        if (typeof res.data?.id === 'number') created.push(res.data.id);
      } catch (err) {
        toast.error(`${raw.name}: ${errText(err, '올리지 못했습니다.')}`);
      } finally {
        setUploading({ done: i + 1, total: list.length });
      }
    }
    setUploading(null);
    if (created.length > 0) {
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] });   // 장마다가 아니라 한 번만
      toast.success(`작품 ${created.length}점을 올렸어요.`);
      setJustUploaded(created);
      setKeptPrivate(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) upload(files);
    else if (e.dataTransfer.files.length) toast.error('이미지 파일만 올릴 수 있어요.');
  };

  // ── [작가] 탭·홈 화면 노출 — 원하는 상태를 적어 보낸다(몇 번 눌러도 결과가 같다) ──
  const exposure = useMutation({
    mutationFn: (v: { ids: number[]; show: boolean; quiet?: boolean }) => api.put('/portfolio/images/explore', { ids: v.ids, show: v.show }),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: ['portfolio'] });
      const prev = queryClient.getQueryData<Portfolio>(['portfolio']);
      if (prev) {
        const set = new Set(v.ids);
        queryClient.setQueryData<Portfolio>(['portfolio'], { ...prev, images: prev.images.map((i) => (set.has(i.id) ? { ...i, showInExplore: v.show } : i)) });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['portfolio'], ctx.prev);
      toast.error(errText(err, '바꾸지 못했습니다. 다시 눌러 주세요.'));
    },
    onSuccess: (_r, v) => {
      if (!v.quiet) toast.success(v.show ? `작품 ${v.ids.length}점을 [작가] 탭에도 소개했어요.` : `작품 ${v.ids.length}점을 내 홈페이지에만 두었어요.`);
    },
    onSettled: refresh,
  });

  // ── 순서 — 전체 순서를 통째로 보낸다(부분 갱신은 화면과 DB 가 어긋난다) ──
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.put('/portfolio/images/order', { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ['portfolio'] });
      const prev = queryClient.getQueryData<Portfolio>(['portfolio']);
      if (prev) {
        const byId = new Map(prev.images.map((i) => [i.id, i]));
        queryClient.setQueryData<Portfolio>(['portfolio'], { ...prev, images: ids.map((id) => byId.get(id)!).filter(Boolean) });
      }
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['portfolio'], ctx.prev);
      toast.error(errText(err, '순서를 바꾸지 못했습니다.'));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
  });

  // ── 삭제 — ⚠️ 반드시 확인을 거친다. × 가 늘 보이고 서버가 원본 파일까지 지운다(되돌릴 수 없다) ──
  const remove = useMutation({
    mutationFn: (imageId: number) => api.delete(`/portfolio/images/${imageId}`),
    onSuccess: (_r, imageId) => {
      setJustUploaded((cur) => cur.filter((id) => id !== imageId));
      refresh();
      toast.success('작품 사진을 지웠어요.');
    },
    onError: (err) => toast.error(errText(err, '지우지 못했습니다.')),
  });

  // ── 작품 정보 ──
  const saveMeta = useMutation({
    mutationFn: ({ imageId, draft }: { imageId: number; draft: ArtworkMetaDraft; next: boolean }) =>
      api.patch(`/portfolio/images/${imageId}`, { ...draft, status: draft.status || null }),
    onSuccess: (_r, v) => {
      // 다음 작품은 **저장 전 목록**으로 정한다 — 방금 저장한 작품은 빼고 찾으므로 재조회를 기다릴 필요가 없다
      const nextId = v.next ? nextUncaptionedId(images, v.imageId) : null;
      refresh();
      if (nextId != null) onMeta(nextId);
      else { onMeta(null); toast.success('작품 정보를 저장했어요.'); }
    },
    onError: (err) => toast.error(errText(err, '작품 정보를 저장하지 못했습니다.')),
  });

  const total = images.length;
  const noInfo = uncaptionedCount(images);
  const shownCount = images.filter((i) => i.showInExplore).length;
  const pendingAsk = justUploaded.filter((id) => images.some((i) => i.id === id && !i.showInExplore));
  const metaImage = images.find((i) => i.id === metaImageId) ?? null;
  const openFirstNoInfo = () => { const id = nextUncaptionedId(images, null); if (id != null) onMeta(id); };
  const full = total >= PORTFOLIO_IMAGE_MAX;
  const pick = () => inputRef.current?.click();
  const uploadLabel = uploading ? `올리는 중 ${Math.min(uploading.done + 1, uploading.total)}/${uploading.total}` : '작품 사진 올리기';

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}
      className="space-y-4"
    >
      {/* ── 지금 할 일: 작품 정보 — 묶음의 **맨 위**. 작품을 올린 작가가 다음에 할 일이 이것이다(실서버: 작품 있는 작가의 81%가 비워 뒀다).
          올리기 줄 아래에 두면 320px 화면에서 첫 화면 밖으로 밀린다(실측 WebKit y=492). ── */}
      {total > 0 && noInfo > 0 && (
        <TaskLine
          className="mt-0"
          task={{ tone: 'attention', text: `작품 ${noInfo}점에 정보가 없어요`, action: '작품 정보 입력하기' }}
          onClick={openFirstNoInfo}
        />
      )}

      {/* ── 올리기 ── */}
      {total === 0 ? (
        <div
          data-testid="works-upload"
          className={cn('rounded-2xl border border-dashed px-5 py-8 text-center md:py-10', dragOver ? 'border-gray-900 bg-gray-50' : 'border-gray-300')}
        >
          <h2 className="break-keep text-lg font-semibold tracking-tight text-gray-950">작품 사진을 올리면 홈페이지가 바로 생깁니다</h2>
          <p className="mx-auto mt-1.5 max-w-sm break-keep text-sm leading-relaxed text-gray-500">
            여러 장을 한 번에 고를 수 있어요. 작품명·크기 같은 정보는 올린 뒤에 채워도 됩니다.
          </p>
          <button type="button" onClick={pick} disabled={!!uploading} className={cn(btnPrimary, 'mt-5')}>
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {uploadLabel}
          </button>
          <p className="mt-3 hidden text-xs text-gray-400 lg:block">사진을 여기로 끌어다 놓아도 됩니다.</p>
        </div>
      ) : (
        <div
          data-testid="works-upload"
          className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed px-4 py-3', dragOver ? 'border-gray-900 bg-gray-50' : 'border-gray-300')}
        >
          <button type="button" onClick={pick} disabled={!!uploading || full} className={btnSecondary}>
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {uploadLabel}
          </button>
          <p className="text-sm text-gray-500">
            <span className="tabular-nums text-gray-900">{total}</span>/{PORTFOLIO_IMAGE_MAX}점
            {full ? ' · 더 올릴 수 없어요' : ' · 올리면 바로 저장돼요'}
          </p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="works-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) upload(files);
          e.target.value = '';
        }}
      />

      {total > 0 && (
        <>
          {/* ── 방금 올린 작품을 [작가] 탭에도 소개할까 (한 번만 묻는다) ── */}
          {pendingAsk.length > 0 ? (
            <Notice
              title={`방금 올린 ${pendingAsk.length}점은 지금 내 홈페이지에만 보여요`}
              action={(
                <>
                  <button type="button" disabled={exposure.isPending} onClick={() => exposure.mutate({ ids: pendingAsk, show: true }, { onSuccess: () => setJustUploaded([]) })} className={btnSecondary}>
                    작가 탭에도 소개
                  </button>
                  <button type="button" onClick={() => { setJustUploaded([]); setKeptPrivate(true); }} className="min-h-[40px] px-2 text-sm text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline">
                    홈페이지에만 두기
                  </button>
                </>
              )}
            >
              [작가] 탭과 홈 화면에도 소개할까요? 작품마다 나중에 바꿀 수 있어요.
            </Notice>
          ) : shownCount === 0 && !keptPrivate && (
            <Notice
              action={(
                <button type="button" disabled={exposure.isPending} onClick={() => exposure.mutate({ ids: images.map((i) => i.id), show: true })} className={btnSecondary}>
                  모두 소개하기
                </button>
              )}
            >
              <b className="font-medium text-gray-900">[작가] 탭에 소개한 작품이 없어요.</b> 지금은 내 홈페이지에만 보입니다.
            </Notice>
          )}

          {/* ── 격자 ── */}
          <div>
            <div className="mb-3 flex items-end justify-between gap-4">
              <p className="min-w-0 flex-1 break-keep text-xs leading-relaxed text-gray-500">
                {reordering
                  ? '앞에 있는 작품이 홈페이지에서 먼저 나옵니다.'
                  : <>사진을 누르면 작품 정보를 넣어요. ‘작가 탭에도’를 켠 작품만 [작가] 탭과 홈 화면에 나옵니다.</>}
              </p>
              {total > 1 && (
                <button
                  type="button"
                  onClick={() => setReordering((v) => !v)}
                  aria-pressed={reordering}
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
                >
                  {reordering ? <><Check size={15} /> 순서 바꾸기 끝</> : <><ArrowLeftRight size={15} /> 순서 바꾸기</>}
                </button>
              )}
            </div>

            <ul data-testid="works-grid" className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3 gap-y-5">
              {images.map((img, idx) => {
                const text = tileLabel(img);
                const likes = img._count?.likes ?? 0;
                return (
                  <li key={img.id} data-work-id={img.id} className="min-w-0">
                    <div className="relative">
                      {/* 작품은 자르지 않는다 — 정사각 칸에 contain(CLAUDE.md 18) */}
                      <button
                        type="button"
                        onClick={() => onMeta(img.id)}
                        aria-label={text ? `${text} — 작품 정보 수정` : '작품 정보 입력'}
                        className="block aspect-square w-full bg-gray-50"
                      >
                        <Thumb src={img.url} alt="" className="h-full w-full object-contain" />
                      </button>
                      {/* 삭제 — 눌리는 자리는 44px, 보이는 건 작은 동그라미 */}
                      <button
                        type="button"
                        onClick={() => setRemoveId(img.id)}
                        aria-label="작품 사진 삭제"
                        className="group/x absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1.5"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-700 ring-1 ring-black/10 group-hover/x:bg-accent group-hover/x:text-white">
                          <X size={13} />
                        </span>
                      </button>
                      {likes > 0 && (
                        <button
                          type="button"
                          onClick={() => setLikersId(img.id)}
                          aria-label={`좋아요 ${likes}개 — 누가 눌렀는지 보기`}
                          title="좋아요한 사람 보기"
                          className="absolute bottom-1 right-1 flex h-7 items-center gap-1 rounded-full bg-white/90 pl-2 pr-2.5 text-xs font-medium text-accent ring-1 ring-black/10"
                        >
                          <Heart size={12} className="fill-accent" /> {likes}
                        </button>
                      )}
                    </div>

                    <button type="button" onClick={() => onMeta(img.id)} tabIndex={-1} aria-hidden className="mt-1.5 block w-full truncate text-left text-[13px] leading-snug">
                      {text
                        ? <span className="text-gray-900">{text}</span>
                        : <span className="font-medium text-accent">작품 정보 입력</span>}
                    </button>

                    {reordering ? (
                      <div className="mt-1.5 flex gap-1.5">
                        <button type="button" disabled={idx === 0} onClick={() => reorder.mutate(moveId(images.map((i) => i.id), img.id, -1))} aria-label="앞으로" className="flex h-11 flex-1 items-center justify-center rounded-lg border border-gray-300 text-gray-900 disabled:opacity-30">
                          <ChevronLeft size={18} />
                        </button>
                        <button type="button" disabled={idx === total - 1} onClick={() => reorder.mutate(moveId(images.map((i) => i.id), img.id, 1))} aria-label="뒤로" className="flex h-11 flex-1 items-center justify-center rounded-lg border border-gray-300 text-gray-900 disabled:opacity-30">
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => exposure.mutate({ ids: [img.id], show: !img.showInExplore, quiet: true })}
                        aria-pressed={!!img.showInExplore}
                        aria-label={img.showInExplore ? '작가 탭에도 소개 중 — 누르면 내 홈페이지에만' : '내 홈페이지에만 보임 — 누르면 작가 탭에도 소개'}
                        className={cn(
                          'mt-1.5 inline-flex min-h-[32px] items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
                          img.showInExplore ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-600 hover:border-gray-500',
                        )}
                      >
                        {img.showInExplore && <Check size={12} strokeWidth={3} />}
                        {img.showInExplore ? '작가 탭에도' : '홈페이지에만'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <ConfirmDialog
        open={removeId !== null}
        title="작품 사진 삭제"
        message="이 작품 사진을 지웁니다. 원본 파일도 함께 삭제되어 되돌릴 수 없습니다."
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { if (removeId !== null) remove.mutate(removeId); setRemoveId(null); }}
        onCancel={() => setRemoveId(null)}
      />

      {likersId !== null && <ArtworkLikersModal imageId={likersId} onClose={() => setLikersId(null)} />}

      {metaImage && (
        <ArtworkMetaModal
          image={metaImage}
          seriesOptions={seriesNames(images)}
          suggestions={{ medium: recentValues(images, 'medium', 3, metaImage.id), year: recentValues(images, 'year', 3, metaImage.id) }}
          remaining={uncaptionedCount(images.filter((i) => i.id !== metaImage.id))}
          hasNext={nextUncaptionedId(images, metaImage.id) != null}
          saving={saveMeta.isPending}
          onSave={(draft, next) => saveMeta.mutate({ imageId: metaImage.id, draft, next })}
          onClose={() => onMeta(null)}
        />
      )}
    </div>
  );
}

/**
 * memo — 편집 화면은 이 묶음을 **감춘 채로 둔다**(올리는 중에 다른 묶음에서 글을 쓸 수 있게).
 * 그동안 글자를 칠 때마다 작품 150칸을 다시 그리면 입력이 밀린다. 넘어오는 값(작품 목록·열린 작품·setter)은 글을 쳐도 바뀌지 않는다.
 */
export default memo(WorksSection);
