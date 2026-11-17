import prisma from './prisma';
import { endOfTodayKstAsUtc, startOfTodayKstAsUtc } from './kstDate';

/**
 * '전시 중' 띠 (2026-11-14, CLAUDE.md 규칙 82) — 홈페이지 첫 화면에 지금 하는(곧 할) 전시를 한 줄로.
 *
 * 날짜는 **KST 달력 날짜**로 가른다(규칙 14). 공모의 전시 기간은 `exhibitStartDate`(시작) ~ `exhibitDate`(**끝**) 다 —
 * 이름이 헷갈리지만 `exhibitDate` 가 종료일이다(schema 주석). 둘 다 `<input type="date">` 라 UTC 자정(=KST 09:00)으로 저장돼 있다.
 */
const DAY = 24 * 60 * 60 * 1000;
/** 시작 전인 전시는 이만큼 앞까지만 '전시 예정' 으로 알린다 */
export const UPCOMING_DAYS_ARTIST = 30;
export const UPCOMING_DAYS_GALLERY = 60;

export interface NowShowing {
  state: 'ongoing' | 'upcoming';
  exhibitionId: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  /** 주관 갤러리 — 아트링크가 갤러리 없이 연 공모면 null(그땐 화면이 공모 상세로 보낸다) */
  gallery: { id: number; name: string; handle: string | null } | null;
}

/**
 * 작가 홈페이지의 '전시 중' — 그 작가가 **선정된(ACCEPTED)** 공모 가운데 승인된 · 전시까지 진행하는(recruitOnly 아님) ·
 * 끝나지 않은(ended 아님) 것이 오늘 전시 기간 안이면 그것, 없으면 30일 안에 시작하는 것.
 * ⚠️ 갤러리가 [함께한 작가]에서 이 작가를 숨겼으면 그 공모는 뺀다 — 갤러리 페이지에서 감춘 관계를 작가 페이지가 드러내면 안 된다.
 */
export async function artistNowShowing(artistId: number, now: Date = new Date()): Promise<NowShowing | null> {
  const todayStart = startOfTodayKstAsUtc(now);
  const todayEnd = endOfTodayKstAsUtc(now);
  const soon = new Date(todayEnd.getTime() + UPCOMING_DAYS_ARTIST * DAY);
  const rows = await prisma.application.findMany({
    where: {
      userId: artistId,
      status: 'ACCEPTED',
      exhibition: {
        status: 'APPROVED', recruitOnly: false, ended: false,
        exhibitStartDate: { not: null, lte: soon },
        exhibitDate: { gte: todayStart },
      },
    },
    select: {
      exhibition: {
        select: {
          id: true, title: true, exhibitStartDate: true, exhibitDate: true,
          gallery: { select: { id: true, name: true, handle: true, status: true, hiddenArtistIds: true } },
        },
      },
    },
  });
  const cands = rows
    .map((r) => r.exhibition)
    .filter((e) => !e.gallery || (e.gallery.status === 'APPROVED' && !e.gallery.hiddenArtistIds.includes(artistId)));
  if (cands.length === 0) return null;
  const ongoing = cands
    .filter((e) => e.exhibitStartDate! <= todayEnd)
    .sort((a, b) => (a.exhibitDate!.getTime() - b.exhibitDate!.getTime()) || a.id - b.id);
  const pick = ongoing[0]
    ?? [...cands].sort((a, b) => (a.exhibitStartDate!.getTime() - b.exhibitStartDate!.getTime()) || a.id - b.id)[0]!;
  return {
    state: ongoing[0] ? 'ongoing' : 'upcoming',
    exhibitionId: pick.id,
    title: pick.title,
    startDate: pick.exhibitStartDate?.toISOString() ?? null,
    endDate: pick.exhibitDate?.toISOString() ?? null,
    gallery: pick.gallery ? { id: pick.gallery.id, name: pick.gallery.name, handle: pick.gallery.handle } : null,
  };
}

export interface GalleryNowShow {
  state: 'ongoing' | 'upcoming';
  id: number;
  title: string;
  posterImage: string;
  startDate: string;
  endDate: string;
}

/**
 * 갤러리 홈페이지의 '지금 전시' — 이 갤러리가 등록해 **승인된** 전시(Show) 가운데 오늘 진행 중인 것(곧 끝나는 것 먼저),
 * 없으면 60일 안에 시작하는 것. 진행 판정은 전시 목록의 `?showStatus=ongoing`(routes/show.ts)과 같다.
 */
export async function galleryNowShow(galleryId: number, now: Date = new Date()): Promise<GalleryNowShow | null> {
  return (await galleryNowShows([galleryId], now)).get(galleryId) ?? null;
}

/**
 * 여러 갤러리의 '지금 전시'를 한 번에 — 갤러리 목록 카드의 '전시 중' 한 줄(2026-11-15). 쿼리는 갤러리 수와 무관하게 하나.
 * 고르는 규칙은 위 `galleryNowShow` 그대로다(그 함수가 이걸 부른다): 진행 중(끝나는 날 → id 순) > 60일 안 시작(시작일 → id 순).
 */
export async function galleryNowShows(galleryIds: number[], now: Date = new Date()): Promise<Map<number, GalleryNowShow>> {
  const out = new Map<number, GalleryNowShow>();
  if (galleryIds.length === 0) return out;
  const todayStart = startOfTodayKstAsUtc(now);
  const todayEnd = endOfTodayKstAsUtc(now);
  const rows = await prisma.show.findMany({
    where: {
      galleryId: { in: galleryIds }, status: 'APPROVED',
      endDate: { gte: todayStart },
      startDate: { lte: new Date(todayEnd.getTime() + UPCOMING_DAYS_GALLERY * DAY) },
    },
    select: { id: true, title: true, posterImage: true, startDate: true, endDate: true, galleryId: true },
  });
  const byGallery = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byGallery.get(r.galleryId) ?? [];
    list.push(r);
    byGallery.set(r.galleryId, list);
  }
  for (const [gid, list] of byGallery) {
    const ongoing = list
      .filter((s) => s.startDate <= todayEnd)
      .sort((a, b) => (a.endDate.getTime() - b.endDate.getTime()) || a.id - b.id);
    const upcoming = list
      .filter((s) => s.startDate > todayEnd)
      .sort((a, b) => (a.startDate.getTime() - b.startDate.getTime()) || a.id - b.id);
    const s = ongoing[0] ?? upcoming[0];
    if (!s) continue;
    out.set(gid, {
      state: ongoing[0] ? 'ongoing' : 'upcoming',
      id: s.id, title: s.title, posterImage: s.posterImage,
      startDate: s.startDate.toISOString(), endDate: s.endDate.toISOString(),
    });
  }
  return out;
}

/** designConfig(JSON 문자열)의 `showNow` — 작가가 [꾸미기]에서 끈 경우만 false. 기본은 켜짐 */
export function showNowEnabled(designConfig: string | null | undefined): boolean {
  if (!designConfig) return true;
  try {
    const o = JSON.parse(designConfig);
    return !(o && typeof o === 'object' && o.showNow === false);
  } catch { return true; }
}
