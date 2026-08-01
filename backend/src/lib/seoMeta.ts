/**
 * SEO 메타 주입 (프로그래매틱 SEO) — 2026-08
 *
 * ## 왜 필요한가
 * 프론트는 SPA라 서버가 내려주는 HTML이 모든 URL에서 동일하다. 그래서
 *  - 검색엔진: 공모/갤러리 수백 개가 전부 같은 title/description으로 보여 중복 페이지 취급
 *  - 카톡/페북 공유봇: **JS를 실행하지 않으므로** 어떤 링크를 공유해도 미리보기가 동일
 * 이 모듈은 상세 페이지 요청에 한해 `index.html`의 meta 블록만 서버에서 갈아끼운다.
 * (SSR 도입 아님 — React 렌더링 경로는 전혀 바뀌지 않는다.)
 *
 * ## 안전 설계 (실패는 전부 "원본 index.html"로 수렴)
 *  1) 인젝션: 값이 HTML이 되는 길목은 `buildMetaTags()` 하나뿐이고 전부 `escapeAttr()`를 통과한다.
 *     호출부에서 문자열을 직접 이어붙일 방법이 없으므로 이스케이프를 빠뜨릴 수 없다.
 *  2) DB 장애: 경로 allowlist(정수 id만) + 1.5초 타임아웃 + try/catch → 실패 시 next()
 *  3) 비공개 노출: APPROVED / deletedAt:null 조건을 쿼리에 못 박고, 노출 필드는 화이트리스트
 *  4) 부하: TTL 60초 인메모리 캐시(상한 500 — 열거 공격 시 메모리 무한증가 방지)
 *
 * ## 사용처
 *  `backend/src/index.ts` 프로덕션 블록에서 `/exhibitions/:id` 등 4개 라우트에 연결.
 *  기존 SPA 와일드카드(`/{*path}`)는 수정하지 않으며, 여기서 next()하면 그쪽이 원본을 내려준다.
 *
 * ## 마커
 *  `frontend/index.html`의 `<!--SEO_META_START-->` ~ `<!--SEO_META_END-->` 사이를 통째로 교체한다.
 *  마커가 없으면(구버전 빌드 등) 주입하지 않는다. → 프론트 테스트가 마커 존재를 검사한다.
 */
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import prisma from './prisma';
import logger from './logger';

export const SEO_MARKER_START = '<!--SEO_META_START-->';
export const SEO_MARKER_END = '<!--SEO_META_END-->';

const TITLE_MAX = 120;
const DESC_MAX = 200;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const DB_TIMEOUT_MS = 1500;

export type SeoKind = 'exhibition' | 'gallery' | 'show' | 'portfolio';

export interface SeoFields {
  title: string;
  description: string;
  image: string | null;
  /** 사이트 내 절대 경로 (서버가 직접 구성 — 사용자 입력이 섞이지 않는다) */
  path: string;
}

/** 공개 URL 기준값. Render 환경변수 PUBLIC_BASE_URL로 덮어쓸 수 있다. */
export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || 'https://artlink.cc').replace(/\/+$/, '');
}

/**
 * HTML 속성값 이스케이프.
 * 값이 들어가는 문맥은 `content="..."`(따옴표로 감싼 속성값) 하나뿐이므로
 * 아래 5글자 치환이면 이 문맥에서 이론적으로 완전하다. 제어문자/개행은 먼저 제거한다.
 */
export function escapeAttr(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 공백 정규화 + 길이 제한 (이스케이프 전에 자른다 — 엔티티가 반토막 나지 않도록) */
export function clampText(raw: unknown, max: number): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** 경로 파라미터 검증 — 모든 PK가 Int이므로 정수만 허용 (경로 조작·ReDoS 여지 없음) */
export function parseSeoId(raw: unknown): number | null {
  const s = String(raw ?? '');
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** og:image URL 화이트리스트 — https 절대경로 또는 /uploads/ 상대경로만 허용 */
export function safeImageUrl(raw: unknown): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (/^https:\/\/[^\s"'<>]+$/.test(v)) return v;
  if (/^\/uploads\/[\w./-]+$/.test(v)) return `${baseUrl()}${v}`;
  return null;
}

const REGION_LABEL: Record<string, string> = {
  SEOUL: '서울',
  GYEONGGI_NORTH: '경기 북부',
  GYEONGGI_SOUTH: '경기 남부',
  DAEJEON: '대전',
  BUSAN: '부산',
};
const regionLabel = (r?: string | null) => (r ? REGION_LABEL[r] || r : '');

/** KST 달력 날짜 표기 (날짜 경계는 KST 기준 — CLAUDE.md Critical Constraints 14) */
function fmtKst(d?: Date | null): string {
  if (!d) return '';
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, '0')}.${String(k.getUTCDate()).padStart(2, '0')}`;
}

const joinParts = (parts: (string | undefined | null)[]) => parts.filter(Boolean).join(' · ');

/** 메타 태그 블록 생성 — 값이 HTML이 되는 유일한 지점 */
export function buildMetaTags(fields: SeoFields): string {
  const title = escapeAttr(clampText(fields.title, TITLE_MAX)) || 'ArtLink';
  const description = escapeAttr(clampText(fields.description, DESC_MAX));
  const url = escapeAttr(`${baseUrl()}${fields.path}`);
  const rawImage = safeImageUrl(fields.image);
  const image = escapeAttr(rawImage || `${baseUrl()}/og-image.png`);

  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
  ];
  // 기본 OG 이미지일 때만 크기를 명시한다(실제 크기를 아는 경우이므로).
  if (!rawImage) {
    lines.push(`<meta property="og:image:width" content="1200" />`);
    lines.push(`<meta property="og:image:height" content="630" />`);
  }
  lines.push(`<meta name="twitter:card" content="summary_large_image" />`);
  return lines.join('\n    ');
}

/** 마커 사이를 교체. 마커가 없으면 null(= 주입 포기, 원본 사용) */
export function injectMeta(template: string, tags: string): string | null {
  const start = template.indexOf(SEO_MARKER_START);
  const end = template.indexOf(SEO_MARKER_END);
  if (start === -1 || end === -1 || end < start) return null;
  return (
    template.slice(0, start + SEO_MARKER_START.length) +
    `\n    ${tags}\n    ` +
    template.slice(end)
  );
}

/** 공개 노출 이름 — 닉네임 우선 (CLAUDE.md 공개 노출 정책) */
const displayName = (u?: { name?: string | null; nickname?: string | null } | null) =>
  (u?.nickname?.trim() || u?.name || '작가').trim();

/**
 * DB 조회 — 가시성 조건(승인/탈퇴)을 여기서 못 박는다.
 * 노출 필드는 화이트리스트: 제목·지역·기간·한줄소개·대표이미지. 연락처/주소상세/이메일은 제외.
 */
async function fetchSeoFields(kind: SeoKind, id: number): Promise<SeoFields | null> {
  if (kind === 'exhibition') {
    const ex = await prisma.exhibition.findFirst({
      where: { id, status: 'APPROVED', gallery: { status: 'APPROVED' } },
      select: {
        title: true,
        description: true,
        imageUrl: true,
        region: true,
        deadline: true,
        type: true,
        gallery: { select: { name: true } },
        images: { select: { url: true }, orderBy: { order: 'asc' }, take: 1 },
      },
    });
    if (!ex) return null;
    const typeLabel = ex.type === 'ART_FAIR' ? '아트페어' : ex.type === 'GROUP' ? '단체전' : '개인전';
    return {
      title: `${ex.title} | ${ex.gallery.name} 작가 모집 - ArtLink`,
      description: joinParts([regionLabel(ex.region), typeLabel, `마감 ${fmtKst(ex.deadline)}`, ex.description]),
      image: ex.imageUrl || ex.images[0]?.url || null,
      path: `/exhibitions/${id}`,
    };
  }

  if (kind === 'gallery') {
    const g = await prisma.gallery.findFirst({
      where: { id, status: 'APPROVED' },
      select: {
        name: true,
        description: true,
        region: true,
        rating: true,
        reviewCount: true,
        mainImage: true,
        images: { select: { url: true }, orderBy: { order: 'asc' }, take: 1 },
      },
    });
    if (!g) return null;
    const rating = g.reviewCount > 0 ? `별점 ${g.rating.toFixed(1)}(${g.reviewCount})` : undefined;
    return {
      title: `${g.name} | 갤러리 - ArtLink`,
      description: joinParts([regionLabel(g.region), rating, g.description]),
      image: g.mainImage || g.images[0]?.url || null,
      path: `/galleries/${id}`,
    };
  }

  if (kind === 'show') {
    const s = await prisma.show.findFirst({
      where: { id, status: 'APPROVED', gallery: { status: 'APPROVED' } },
      select: {
        title: true,
        description: true,
        region: true,
        location: true,
        startDate: true,
        endDate: true,
        posterImage: true,
        gallery: { select: { name: true } },
      },
    });
    if (!s) return null;
    return {
      title: `${s.title} | ${s.gallery.name} 전시 - ArtLink`,
      description: joinParts([
        regionLabel(s.region),
        `${fmtKst(s.startDate)}~${fmtKst(s.endDate)}`,
        s.location,
        s.description,
      ]),
      image: s.posterImage || null,
      path: `/shows/${id}`,
    };
  }

  // portfolio — userId 기준
  const p = await prisma.portfolio.findFirst({
    where: { userId: id, user: { deletedAt: null } },
    select: {
      biography: true,
      user: { select: { name: true, nickname: true } },
      images: { select: { url: true }, orderBy: { order: 'asc' }, take: 1 },
    },
  });
  if (!p) return null;
  const artist = displayName(p.user);
  return {
    title: `${artist} 작가 포트폴리오 - ArtLink`,
    description: p.biography?.trim() || `${artist} 작가의 작품과 이력을 ArtLink에서 확인하세요.`,
    image: p.images[0]?.url || null,
    path: `/portfolio/${id}`,
  };
}

// ── 인메모리 캐시 (TTL 60초, 상한 500) ────────────────────────────────
// 없는 id(null)도 캐시한다 — /exhibitions/1..9999 식 열거로 DB를 때리지 못하게.
const cache = new Map<string, { value: SeoFields | null; exp: number }>();

/** 테스트 전용 — 케이스 간 캐시 격리 */
export function clearSeoCache(): void {
  cache.clear();
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('seo-meta-timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getSeoFields(kind: SeoKind, id: number): Promise<SeoFields | null> {
  const key = `${kind}:${id}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.value;

  const value = await withTimeout(fetchSeoFields(kind, id), DB_TIMEOUT_MS);

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, exp: now + CACHE_TTL_MS });
  return value;
}

/**
 * index.html 템플릿 로더 — 기동 후 최초 1회만 읽어 메모리에 보관.
 * 읽기 실패 시 null을 캐싱해 주입 기능만 비활성화한다(사이트는 정상 동작).
 */
export function createTemplateLoader(filePath: string): () => string | null {
  let cached: string | null | undefined;
  return () => {
    if (cached !== undefined) return cached;
    try {
      cached = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      logger.warn('SEO', `index.html 템플릿 로드 실패 — 메타 주입 비활성화: ${(err as Error).message}`);
      cached = null;
    }
    return cached;
  };
}

/** rate limit 초과 표시 — 차단이 아니라 '주입만 생략'하기 위한 플래그 */
export const SEO_RATE_LIMITED = Symbol.for('artlink.seoRateLimited');

/**
 * 상세 페이지 핸들러. 조건 미달이면 next()로 흘려보내 기존 SPA 와일드카드가 처리한다.
 * → 최악의 경우가 "현재 동작(기본 meta)"이 되도록 설계.
 */
export function createSeoHandler(kind: SeoKind, loadTemplate: () => string | null) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (process.env.SEO_META === 'off') return next();
      if ((req as unknown as Record<symbol, unknown>)[SEO_RATE_LIMITED]) return next();

      const id = parseSeoId(req.params.id ?? req.params.userId);
      if (id === null) return next();

      const template = loadTemplate();
      if (!template) return next();

      const fields = await getSeoFields(kind, id);
      if (!fields) return next();

      const html = injectMeta(template, buildMetaTags(fields));
      if (!html) return next();

      res.set('Cache-Control', 'no-store');
      res.type('html').send(html);
    } catch (err) {
      logger.warn('SEO', `메타 주입 생략(${kind}): ${(err as Error).message}`);
      next();
    }
  };
}
