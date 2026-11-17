/**
 * ShowDetailPage — 전시 상세 (`/shows/:id`, 2026-11-15 개편 — 모집공고 상세와 같은 틀, 규칙 83)
 *
 * 고치기 전: 가운데 포스터(둥근 모서리 + 포스터 색 글로우 그림자) → 제목 → 아이콘 붙은 네 줄(기간·시간·입장료·위치) → 소개.
 * 갤러리로 가는 길이 이름 글자 하나뿐이었고, 다 읽고 갈 곳이 없었다.
 *
 *  · PC — 왼쪽 포스터(원본 비율, 화면 높이 상한, 따라온다) · 오른쪽 기간 → 제목 → 갤러리 → [찜 · 공유] → 기간 띠 → 관람 정보 → 장소 [지도]
 *    → 참여 작가 → 전시 소개 → 전시 사진 → 갤러리 카드. 아래 전체 폭 '다른 전시' 3건
 *  · 휴대폰 — 작은 포스터(누르면 크게) 옆에 기간·제목·갤러리(모집공고 상세 A안), 찜·공유는 '← 전시' 줄 오른쪽
 *  · 기간 표시는 목록 카드와 같은 `showView`, 기간 띠는 공모 상세와 같은 `ScheduleStrip`(`showSteps`)
 * 포스터의 둥근 모서리·글로우 그림자는 없앴다(DESIGN.md — 공모 상세와 같은 결정).
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, Camera, ChevronRight, Edit3, Heart, Share2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, canFavorite, cn } from '@/lib/utils';
import { addressArea, groupShows, openingHoursText, showSteps, showView } from '@/lib/listings';
import { mapHref } from '@/lib/homepageSite';
import { galleryPath } from '@/lib/handle';
import { shareLink } from '@/lib/shareLink';
import { DETAIL_ACTION, DETAIL_LABEL } from '@/lib/detailStyles';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import ImageLightbox from '@/components/shared/ImageLightbox';
import SkeletonImage from '@/components/shared/SkeletonImage';
import SquarePhotoGrid from '@/components/shared/SquarePhotoGrid';
import { MultiImageUpload } from '@/components/shared/ImageUpload';
import { HeroImageEdit } from '@/components/shared/EditableField';
import ViewCountBadge from '@/components/shared/ViewCountBadge';
import RichText from '@/components/shared/RichText';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { HeartButton } from '@/components/listing/ListControls';
import { ShowPeriodLine } from '@/components/listing/ShowCards';
import { DetailPoster, Fact, ScheduleStrip } from '@/components/exhibition/DetailBits';
import type { Gallery, Show } from '@/types';

export default function ShowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const wide = useMediaQuery('(min-width: 1024px)');

  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [photoMgrOpen, setPhotoMgrOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: show, isLoading } = useQuery<Show & { gallery: Show['gallery'] & Partial<Gallery> }>({
    queryKey: ['show', id],
    queryFn: () => api.get(`/shows/${id}`).then((r) => r.data),
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
  });
  // 다른 전시 — 전시 찾기와 **같은 캐시 키**(['shows','all','']): 목록에서 왔으면 다시 받지 않는다
  const { data: allShows = [] } = useQuery<Show[]>({
    queryKey: ['shows', 'all', ''],
    queryFn: () => api.get('/shows').then((r) => r.data),
  });

  const favMutation = useMutation({
    mutationFn: () => api.post('/favorites/toggle', { showId: Number(id) }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['show', id] });
      const prev = queryClient.getQueryData<Show>(['show', id]);
      if (prev) queryClient.setQueryData(['show', id], { ...prev, isFavorited: !prev.isFavorited });
      return { prev };
    },
    onError: (_err, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(['show', id], ctx.prev); },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['show', id] });
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const descMutation = useMutation({
    mutationFn: (desc: string) => api.patch(`/shows/${id}`, { description: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show', id] });
      setEditingDesc(false);
      toast.success('소개가 수정되었습니다.');
    },
    // 빈 소개·글자 수 초과는 서버가 400 으로 이유를 준다
    onError: (e: any) => toast.error(e.response?.data?.error || '수정에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/shows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      toast.success('전시가 삭제되었습니다.');
      navigate('/shows');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제에 실패했습니다.'),
  });

  // 사진 수정(주인) — 포스터 교체 / 추가 사진 등록·삭제
  const posterMutation = useMutation({
    mutationFn: (url: string) => api.patch(`/shows/${id}`, { posterImage: url }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['show', id] }); queryClient.invalidateQueries({ queryKey: ['shows'] }); toast.success('포스터가 변경되었습니다.'); },
    onError: () => toast.error('포스터 변경 실패'),
  });
  const addImageMutation = useMutation({
    mutationFn: (url: string) => api.post(`/shows/${id}/images`, { url }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['show', id] }); },
    onError: () => toast.error('사진 추가 실패'),
  });
  const removeImageMutation = useMutation({
    mutationFn: (imageId: number) => api.delete(`/shows/${id}/images/${imageId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['show', id] }); toast.success('사진이 삭제되었습니다.'); },
    onError: () => toast.error('사진 삭제 실패'),
  });

  if (isLoading) return <div className="mx-auto max-w-7xl px-6 py-10 md:px-12"><div className="h-64 animate-pulse bg-gray-100" /></div>;
  if (!show) return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-20 text-center">
      <h1 className="text-xl font-semibold text-gray-900">전시를 찾을 수 없습니다</h1>
      <p className="mt-2 text-sm text-gray-500">삭제되었거나 존재하지 않는 전시입니다.</p>
      <button onClick={() => navigate('/shows')} className="mt-8 cursor-pointer rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700">
        전시 목록으로
      </button>
    </div>
  );

  const isOwner = user?.id === show.gallery?.ownerId;
  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;
  const gallery = show.gallery;
  const images = [show.posterImage, ...(show.images?.map((img) => img.url) ?? [])].filter(Boolean);
  const extraPhotos = (show.images ?? []).map((img, i) => ({ url: img.url, key: img.id, index: i + (show.posterImage ? 1 : 0) }));
  const steps = showSteps(show);
  // 다른 전시 — 진행·예정 가운데 이 전시 말고 셋(전시 중 → 예정 순, 목록과 같은 순서)
  const others = groupShows(allShows.filter((s) => s.id !== show.id)).flatMap((g) => g.items).slice(0, 3);
  const goBack = () => { if ((window.history.state?.idx ?? 0) > 0) navigate(-1); else navigate('/shows'); };   // 공유 링크로 왔으면 뒤가 사이트 밖이다
  const onShare = async () => {
    const r = await shareLink(show.title, `${window.location.origin}/shows/${show.id}`);
    if (r === 'copied') toast.success('주소를 복사했어요');
  };
  const openImage = (index: number) => { if (images.length) setLightbox(index); };

  const headInfo = (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-3">
        <ShowPeriodLine show={show} className="text-[13px] lg:text-[15px]" />
        <ViewCountBadge count={show.viewCount} className="shrink-0" />
      </div>
      <h1 className="mt-1.5 text-[20px] font-semibold leading-snug tracking-tight text-gray-900 break-keep [overflow-wrap:anywhere] lg:mt-2 lg:text-[32px] lg:leading-tight">
        {show.title}
      </h1>
      {gallery && (
        <p className="mt-2 text-sm text-gray-600 lg:mt-3 lg:text-[15px]">
          <Link to={galleryPath(gallery)} className="font-medium text-gray-900 underline-offset-4 hover:underline">{gallery.name}</Link>
          <span className="ml-2">{addressArea(show.location, show.region)}</span>
        </p>
      )}
    </div>
  );

  // 주인 — 포스터 바꾸기 · 추가 사진(최대 10장)
  const photoManager = canEdit && (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setPhotoMgrOpen(!photoMgrOpen)}
        aria-expanded={photoMgrOpen}
        className="flex min-h-[40px] cursor-pointer items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <Camera size={14} aria-hidden /> 사진 관리
        <ChevronRight size={14} aria-hidden className={cn('transition-transform', photoMgrOpen && 'rotate-90')} />
      </button>
      {photoMgrOpen && (
        <div className="mt-2 space-y-4 rounded-lg border border-gray-200 p-3">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">포스터 바꾸기</p>
            <HeroImageEdit fit="contain" value={show.posterImage} onChange={(url) => posterMutation.mutate(url)} className="aspect-[210/297] w-28" label="포스터" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">전시 사진 (최대 10장)</p>
            <MultiImageUpload
              images={show.images || []}
              onAdd={(url) => addImageMutation.mutate(url)}
              onRemove={(index) => { const im = show.images?.[index]; if (im) removeImageMutation.mutate(im.id); }}
              maxCount={10}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="pb-4">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        {/* 목록으로 — 휴대폰은 같은 줄 오른쪽에 찜·공유 */}
        <div className="flex items-center justify-between pt-1 lg:pt-6">
          <Link
            to="/shows"
            onClick={(e) => { if ((window.history.state?.idx ?? 0) > 0) { e.preventDefault(); goBack(); } }}
            className="-ml-1 inline-flex min-h-[48px] items-center gap-1.5 pr-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} aria-hidden /> 전시
          </Link>
          {!wide && (
            <div className="-mr-3 flex">
              {canFavorite(user) && <HeartButton on={!!show.isFavorited} onToggle={() => favMutation.mutate()} size={20} />}
              <button type="button" onClick={onShare} aria-label="공유" className="grid h-11 w-11 place-items-center text-gray-700">
                <Share2 size={19} aria-hidden />
              </button>
            </div>
          )}
        </div>

        <div className={wide ? 'mt-3 grid grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-14 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)] xl:gap-20' : undefined}>
          {/* PC — 포스터는 원본 비율 그대로(화면 높이 상한). 고칠 사람이 아니면 내리는 동안 따라온다 */}
          {wide && (
            <aside className={cn('min-w-0', !canEdit && 'sticky top-28 self-start')}>
              {show.posterImage ? (
                <DetailPoster src={show.posterImage} alt={`${show.title} 포스터`} eager onOpen={() => openImage(0)} />
              ) : (
                <div className="grid aspect-[210/297] place-items-center bg-gray-100 px-3 text-center text-xs text-gray-500">{show.title}</div>
              )}
              {photoManager}
            </aside>
          )}

          <div className="min-w-0 lg:max-w-[720px]">
            {wide ? headInfo : (
              <div className="mt-1 flex gap-4">
                {/* 휴대폰 — 포스터는 작게, 누르면 크게. 첫 화면에 무슨 전시인지·언제까지인지가 들어온다 */}
                <button type="button" onClick={() => openImage(0)} disabled={!images.length} aria-label="포스터 크게 보기" className="relative w-[104px] shrink-0 cursor-zoom-in self-start">
                  <SkeletonImage src={show.posterImage} thumb="grid" alt="" fallbackLabel={show.title} className="aspect-[210/297]" imgClassName="object-contain" blurFill />
                  {images.length > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 bg-gray-900/75 px-1.5 py-0.5 text-[11px] tabular-nums text-white">1 / {images.length}</span>
                  )}
                </button>
                {headInfo}
              </div>
            )}

            {/* PC — 찜 · 공유(글자 단추 한 벌) */}
            {wide && (
              <div className="mt-5 flex flex-wrap items-center gap-x-6">
                {canFavorite(user) && (
                  <button type="button" onClick={() => favMutation.mutate()} aria-label={show.isFavorited ? '찜 해제' : '찜하기'} className={DETAIL_ACTION}>
                    <Heart size={16} aria-hidden className={show.isFavorited ? 'fill-accent text-accent' : ''} /> 찜
                  </button>
                )}
                <button type="button" onClick={onShare} className={DETAIL_ACTION}>
                  <Share2 size={16} aria-hidden /> 공유
                </button>
              </div>
            )}
            {!wide && photoManager}

            {/* 기간 — 전시 시작 → 전시 종료. 다음 것만 진하게(끝나기 7일 안이면 강조색) */}
            <section aria-labelledby="show-period" className="mt-8 lg:mt-10">
              <h2 id="show-period" className={DETAIL_LABEL}>기간</h2>
              <div className="mt-3"><ScheduleStrip steps={steps} /></div>
            </section>

            {/* 관람 정보 — 관람 시간 · 입장료 · 지역, 그 아래 장소 [지도] */}
            <section aria-labelledby="show-visit" className="mt-8">
              <h2 id="show-visit" className={DETAIL_LABEL}>관람 정보</h2>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 sm:grid-cols-3">
                <Fact label="관람 시간">{openingHoursText(show.openingHours) || '—'}</Fact>
                <Fact label="입장료">{show.admissionFee || '—'}</Fact>
                <Fact label="지역">{regionLabels[show.region] ?? show.region}</Fact>
              </dl>
              {show.location && (
                <div className="border-b border-gray-100 py-3" data-testid="show-location">
                  <p className="text-[12px] text-gray-500 lg:text-[13px]">장소</p>
                  <p className="mt-1 text-[15px] font-medium text-gray-900 break-keep [overflow-wrap:anywhere] lg:text-base">
                    {show.location}
                    <a href={mapHref(show.location)} target="_blank" rel="noopener noreferrer" className="ml-2 text-[13px] font-normal text-gray-500 underline underline-offset-4 hover:text-gray-900">지도</a>
                  </p>
                </div>
              )}
            </section>

            {/* 참여 작가 — 아트링크 작가면 그 홈페이지로 */}
            {show.artists && show.artists.length > 0 && (
              <section aria-labelledby="show-artists" className="mt-8">
                <h2 id="show-artists" className={DETAIL_LABEL}>참여 작가</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-gray-900 break-keep lg:text-base">
                  {show.artists.map((artist, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-gray-400"> · </span>}
                      {artist.userId ? (
                        <Link to={`/portfolio/${artist.userId}`} className="underline decoration-gray-300 underline-offset-4 hover:decoration-gray-900">{artist.name}</Link>
                      ) : artist.name}
                    </span>
                  ))}
                </p>
              </section>
            )}

            {/* 전시 소개(서식 있는 글 — 서버가 허용 목록으로 걸러 저장하고 화면도 한 번 더 거른다). ⚠️ div > div > h2 모양을 지킬 것(e2e 67) */}
            <div className="mt-10 lg:mt-12">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[19px] font-semibold tracking-tight text-gray-900 lg:text-[22px]">전시 소개</h2>
                {canEdit && !editingDesc && (
                  <button
                    onClick={() => { setEditDesc(show.description); setEditingDesc(true); }}
                    className="flex min-h-[40px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
                    aria-label="수정"
                  >
                    <Edit3 size={14} aria-hidden /> 수정
                  </button>
                )}
              </div>
              {editingDesc ? (
                <div className="space-y-3">
                  <LazyRichTextEditor value={editDesc} onChange={setEditDesc} placeholder="전시 소개" maxLength={20000} minHeight={200} />
                  <div className="flex gap-2">
                    <button onClick={() => descMutation.mutate(editDesc)} disabled={descMutation.isPending} className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-sm text-white disabled:opacity-50">저장</button>
                    <button onClick={() => setEditingDesc(false)} className="min-h-[40px] px-4 text-sm text-gray-500">취소</button>
                  </div>
                </div>
              ) : (
                <RichText value={show.description} className="text-[15px] leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere] lg:text-base" />
              )}
            </div>

            {/* 전시 사진 — 같은 크기 정사각 칸(자르지 않는다). 누르면 크게 */}
            {extraPhotos.length > 0 && (
              <section aria-labelledby="show-photos" className="mt-10">
                <h2 id="show-photos" className={DETAIL_LABEL}>전시 사진</h2>
                <SquarePhotoGrid className="mt-3" photos={extraPhotos.map((p) => ({ url: p.url, key: p.key }))} onOpen={(i) => openImage(extraPhotos[i].index)} />
              </section>
            )}

            {/* 갤러리 — 이 전시를 연 곳. 이름만 있던 링크를 카드로(공모 상세의 주최 카드와 같은 모양) */}
            {gallery && (
              <section aria-labelledby="show-gallery" className="mt-12 border-t border-gray-200 pt-6">
                <h2 id="show-gallery" className={DETAIL_LABEL}>갤러리</h2>
                <Link to={galleryPath(gallery)} className="group/host mt-3 flex items-center gap-4 lg:gap-5">
                  <SkeletonImage
                    src={gallery.mainImage || ''}
                    thumb="list"
                    alt=""
                    fallbackLabel={gallery.name}
                    className="aspect-[4/3] w-[112px] shrink-0 lg:w-[176px]"
                    imgClassName="object-contain"
                    blurFill
                    loading="lazy"
                  />
                  <span className="min-w-0">
                    <span className="block text-[17px] font-medium text-gray-900 group-hover/host:underline group-hover/host:underline-offset-4 lg:text-[19px]">{gallery.name}</span>
                    {gallery.description && <span className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-gray-600 break-keep [overflow-wrap:anywhere] lg:text-sm">{gallery.description}</span>}
                    <span className="mt-1.5 block text-xs text-gray-500">{addressArea(gallery.address, gallery.region ?? show.region)}</span>
                  </span>
                </Link>
              </section>
            )}

            {/* 삭제 — 주인·관리자. 오른쪽 아래 작게, 확인을 거친다 */}
            {canDelete && (
              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleteMutation.isPending}
                  className="flex min-h-[40px] cursor-pointer items-center gap-1 text-xs text-gray-500 hover:text-accent disabled:opacity-50"
                >
                  <Trash2 size={13} aria-hidden /> 전시 삭제
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 다른 전시 — 다 읽고 갈 곳. 전시 찾기와 같은 캐시라 목록에서 왔으면 다시 받지 않는다 */}
        {others.length > 0 && (
          <section aria-labelledby="show-more" className="mt-14 border-t border-gray-200 pt-8 lg:mt-20">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="show-more" className="text-[19px] font-semibold tracking-tight text-gray-900 lg:text-[22px]">다른 전시</h2>
              <Link to="/shows" className="text-sm text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline">전체 보기</Link>
            </div>
            <ul className="mt-3 grid gap-x-10 lg:mt-5 lg:grid-cols-3">
              {others.map((o) => <MoreShow key={o.id} show={o} />)}
            </ul>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="전시 삭제"
        message="이 전시를 삭제할까요? 되돌릴 수 없어요."
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
      />

      <AnimatePresence>
        {lightbox !== null && (
          <ImageLightbox images={images} initialIndex={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/** '다른 전시' 한 줄 — 작은 포스터 · 기간 · 제목 · 갤러리 */
function MoreShow({ show }: { show: Show }) {
  const v = showView(show);
  return (
    <li className="border-b border-gray-100 lg:border-0">
      <Link to={`/shows/${show.id}`} className="group/more flex gap-4 py-4 lg:py-0">
        <SkeletonImage
          src={show.posterImage}
          thumb="list"
          alt=""
          fallbackLabel={show.title}
          className="aspect-[210/297] w-[64px] shrink-0 lg:w-[76px]"
          imgClassName="object-contain"
          blurFill
          loading="lazy"
        />
        <span className="min-w-0">
          <span className="block text-xs text-gray-500">
            <b className={cn('font-bold', v.hot ? 'text-accent' : 'text-gray-900')}>{v.badge}</b>
            <span className="ml-1.5">{v.date}</span>
          </span>
          <span className="mt-1 line-clamp-2 text-[15px] font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere] group-hover/more:underline group-hover/more:underline-offset-2">{show.title}</span>
          <span className="mt-1 block truncate text-xs text-gray-600">{show.gallery?.name}</span>
        </span>
      </Link>
    </li>
  );
}
