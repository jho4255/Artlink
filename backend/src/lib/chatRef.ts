import prisma from './prisma';
import { AppError } from '../middleware/errorHandler';
import { ownFileUrl } from './safeUrl';
import { regionLabel } from './regions';

/**
 * ArtTalk **맥락 카드** (2026-11-19, ArtTalk 개편 WP5) — "이 말이 어느 작품·공모·전시·갤러리에 대한 것인가".
 *
 * 예전엔 작품 문의를 '작품 사진 첨부 + 글'로 보냈다. 받는 작가는 어느 작품인지 사진으로 짐작할 뿐 그 작품 페이지로 갈 수 없었고,
 * 공모 상세의 [갤러리에 문의]는 **어느 공모 얘기인지 없이** 빈 방만 열었다.
 *
 * ⚠️⚠️ **카드 내용은 서버만 만든다.** 화면은 `{ type, id }` 만 보내고, 여기서 그 대상이 있는지·공개인지 본 뒤
 *    제목·부제·그림·링크를 찍어 `ChatMessage.ref` 에 넣는다. 화면이 보낸 제목·링크를 그대로 저장하면
 *    남의 이름·바깥 주소를 단 카드를 상대 화면에 밀어 넣을 수 있다(첨부 주소를 우리 저장소로만 받는 것과 같은 이유).
 * ⚠️ 저장할 때의 값을 **찍어 둔다** — 나중에 작품 제목이 바뀌어도 그때 무엇을 물었는지가 기록으로 남는다.
 */
export const CHAT_REF_TYPES = ['WORK', 'EXHIBITION', 'SHOW', 'GALLERY'] as const;
export type ChatRefType = (typeof CHAT_REF_TYPES)[number];

export interface ChatRef {
  type: ChatRefType;
  id: number;
  /** 카드 첫 줄 — 작품은 `작품명, 연도`(홈페이지 캡션과 같은 순서) */
  title: string;
  /** 둘째 줄(없으면 null) — 작품: 재료 · 크기 / 공모: 주최 · 마감 / 전시: 갤러리 · 기간 / 갤러리: 지역 */
  sub: string | null;
  /** 우리 저장소 주소만(없거나 바깥 주소면 null) */
  image: string | null;
  /** 누르면 갈 곳 — 우리 사이트 경로만 */
  link: string;
}

/** 목록 미리보기·알림 글에 쓰는 이름(글·첨부 없이 카드만 보낸 메시지) */
export const CHAT_REF_LABELS: Record<ChatRefType, string> = {
  WORK: '[작품 문의]',
  EXHIBITION: '[공모 문의]',
  SHOW: '[전시 문의]',
  GALLERY: '[갤러리 문의]',
};

/** KST 'M.D' */
function kstMonthDay(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
}

const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/**
 * 화면이 보낸 `{ type, id }` → 서버가 만든 카드. 못 찾거나 볼 수 없으면 **400**(무엇이 틀렸는지 말한다).
 * @param participantIds 그 방 참여자 — 작품은 **그 방 사람의 작품**만 붙일 수 있다(남의 작품을 남의 방에 끌어오지 않게)
 */
export async function resolveChatRef(input: { type: string; id: number }, participantIds: number[]): Promise<ChatRef> {
  const id = Number(input.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('무엇에 대한 문의인지 알 수 없어요.', 400);

  switch (input.type) {
    case 'WORK': {
      const img = await prisma.portfolioImage.findUnique({
        where: { id },
        select: {
          id: true, url: true, title: true, year: true, medium: true, sizeText: true,
          portfolio: { select: { userId: true, user: { select: { deletedAt: true } } } },
        },
      });
      if (!img || img.portfolio.user.deletedAt || !participantIds.includes(img.portfolio.userId)) {
        throw new AppError('문의할 작품을 찾을 수 없어요.', 400);
      }
      const title = clean(img.title);
      const year = clean(img.year).replace(/년$/, '');
      const head = title ? (year ? `${title}, ${year}` : title) : (year ? `제목 없는 작품, ${year}` : '제목 없는 작품');
      const sub = [clean(img.medium), clean(img.sizeText)].filter(Boolean).join(' · ') || null;
      return {
        type: 'WORK', id: img.id, title: head, sub,
        image: ownFileUrl(img.url),
        // 작품 페이지 — 숫자 주소로 들어가도 홈페이지가 정식 주소(/@핸들)로 갈아끼운다(규칙 49)
        link: `/portfolio/${img.portfolio.userId}?work=${img.id}`,
      };
    }
    case 'EXHIBITION': {
      const ex = await prisma.exhibition.findUnique({
        where: { id },
        select: { id: true, title: true, status: true, imageUrl: true, deadline: true, hostType: true, gallery: { select: { name: true } } },
      });
      // 승인 전·반려 공모는 공개 화면에 없는 것이다(규칙 23) — 카드로도 내보내지 않는다
      if (!ex || ex.status !== 'APPROVED') throw new AppError('문의할 공모를 찾을 수 없어요.', 400);
      const host = ex.gallery?.name || (ex.hostType === 'ADMIN' ? '아트링크' : '');
      return {
        type: 'EXHIBITION', id: ex.id, title: clean(ex.title) || '공모',
        sub: [host, `${kstMonthDay(ex.deadline)} 마감`].filter(Boolean).join(' · '),
        image: ownFileUrl(ex.imageUrl),
        link: `/exhibitions/${ex.id}`,
      };
    }
    case 'SHOW': {
      const show = await prisma.show.findUnique({
        where: { id },
        select: { id: true, title: true, status: true, posterImage: true, startDate: true, endDate: true, gallery: { select: { name: true } } },
      });
      if (!show || show.status !== 'APPROVED') throw new AppError('문의할 전시를 찾을 수 없어요.', 400);
      return {
        type: 'SHOW', id: show.id, title: clean(show.title) || '전시',
        sub: [show.gallery?.name, `${kstMonthDay(show.startDate)} – ${kstMonthDay(show.endDate)}`].filter(Boolean).join(' · '),
        image: ownFileUrl(show.posterImage),
        link: `/shows/${show.id}`,
      };
    }
    case 'GALLERY': {
      const g = await prisma.gallery.findUnique({
        where: { id },
        select: { id: true, name: true, status: true, mainImage: true, region: true, handle: true },
      });
      if (!g || g.status !== 'APPROVED') throw new AppError('문의할 갤러리를 찾을 수 없어요.', 400);
      return {
        type: 'GALLERY', id: g.id, title: clean(g.name) || '갤러리',
        sub: regionLabel(g.region) || null,
        image: ownFileUrl(g.mainImage),
        link: g.handle ? `/@${g.handle}` : `/galleries/${g.id}`,
      };
    }
    default:
      throw new AppError('무엇에 대한 문의인지 알 수 없어요.', 400);
  }
}

/** DB 에서 읽은 ref(JSON)를 화면에 내보낼 모양으로 — 이상한 값은 null(던지지 않는다) */
export function readChatRef(raw: unknown): ChatRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!CHAT_REF_TYPES.includes(r.type as ChatRefType) || typeof r.id !== 'number' || typeof r.title !== 'string' || typeof r.link !== 'string') return null;
  // 링크는 우리 사이트 경로만(`/` 로 시작하되 `//`·`/\` 아님) — 서버가 만든 값이지만 읽을 때도 한 번 더 지킨다
  if (!/^\/(?![/\\])/.test(r.link)) return null;
  return {
    type: r.type as ChatRefType,
    id: r.id,
    title: r.title,
    sub: typeof r.sub === 'string' ? r.sub : null,
    image: typeof r.image === 'string' ? ownFileUrl(r.image) : null,
    link: r.link,
  };
}
