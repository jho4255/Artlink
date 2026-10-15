/**
 * 작품 가격 (2026-10-15, 작가 요청 "포트폴리오나 홈페이지에 작품 금액도 원할 때 넣게") — 규칙은 여기 한 곳.
 *
 * - 가격은 **원 단위 정수**(사용자 결정: 숫자로 받아 '1,200,000원' 으로 통일). 0·음수·소수·상한 초과는 400.
 * - 저장은 별도 표 `ArtworkPrice` — PortfolioImage 컬럼이면 작품 행을 통째로 내려주는 공개 응답에 그대로 실린다(schema 주석).
 * - 보이는 곳은 작가가 **따로** 켠다(사용자 결정, 둘 다 기본 꺼짐):
 *     홈페이지 = `Portfolio.showPrice` → 공개 GET /portfolio/:id 가 이 파일의 `attachPublicPrices` 를 거쳐 싣는다.
 *     PDF = designConfig.showPrice → 작가 본인의 화면이 PDF 를 만드므로 서버는 본인 응답에만 가격을 싣는다.
 * - **판매완료·비매 작품은 가격을 내보내지 않는다**(`priceVisible`) — 팔린 그림의 값을 적어 두면 '얼마에 팔렸다' 로 읽힌다.
 * - 화면 거울: frontend `lib/artwork.ts`(PRICE_MAX·priceVisible·formatPrice). 상한이 다르면 화면이 통과시킨 값을 서버가 막는다.
 */
import prisma from './prisma';
import { AppError } from '../middleware/errorHandler';

/** 상한 — Postgres int(21억) 아래로. 20억 원을 넘는 작품은 이 플랫폼에서 아직 없다 */
export const PRICE_MAX = 2_000_000_000;

/**
 * 받은 값 → 저장할 금액. `undefined` = 안 보냈다(안 바꾼다) · `null` = 지운다.
 * 화면은 숫자를 보내지만, 손으로 친 '1,200,000' 같은 문자열도 쉼표·공백·'원' 을 떼고 받는다.
 */
export function parsePrice(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[,\s원]/g, '')) : NaN;
  if (!Number.isInteger(n) || n < 1) throw new AppError('가격은 1원 이상의 숫자로 적어 주세요.', 400);
  if (n > PRICE_MAX) throw new AppError('가격이 너무 큽니다.', 400);
  return n;
}

/** 이 작품의 가격을 남에게 보여도 되는가 — 판매완료·비매는 아니다 */
export function priceVisible(status: string | null | undefined): boolean {
  return status !== 'SOLD' && status !== 'NFS';
}

/** 작품 행 + 가격 관계 → 화면이 받는 모양(`price: number | null`). 작가 **본인**에게 주는 응답에만 쓴다 */
export function withPrice<T extends { price?: { amount: number } | null }>(img: T): Omit<T, 'price'> & { price: number | null } {
  const { price, ...rest } = img;
  return { ...rest, price: price?.amount ?? null };
}

/** 본인 응답용 include — 작품 행에 가격 관계를 붙인다 */
export const OWNER_PRICE_INCLUDE = { price: { select: { amount: true } } } as const;

/** 작품 하나의 가격을 정하거나 지운다 */
export async function setArtworkPrice(imageId: number, amount: number | null): Promise<void> {
  if (amount === null) {
    await prisma.artworkPrice.deleteMany({ where: { imageId } });
    return;
  }
  await prisma.artworkPrice.upsert({ where: { imageId }, update: { amount }, create: { imageId, amount } });
}

/**
 * 공개 홈페이지 응답에 가격을 붙인다 — 작가가 홈페이지 가격을 켰고(`showPrice`) 판매완료·비매가 아닌 작품만.
 * 꺼져 있으면 **아무것도 읽지 않는다**(가격이 응답에 섞일 길 자체가 없다).
 */
export async function attachPublicPrices<T extends { id: number; status?: string | null }>(images: T[], showPrice: boolean): Promise<(T & { price?: number })[]> {
  if (!showPrice || images.length === 0) return images;
  const visible = images.filter((i) => priceVisible(i.status)).map((i) => i.id);
  if (visible.length === 0) return images;
  const rows = await prisma.artworkPrice.findMany({ where: { imageId: { in: visible } }, select: { imageId: true, amount: true } });
  const byId = new Map(rows.map((r) => [r.imageId, r.amount]));
  return images.map((i) => (byId.has(i.id) ? { ...i, price: byId.get(i.id)! } : i));
}
