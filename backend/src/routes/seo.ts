/**
 * robots.txt / sitemap.xml — 검색엔진 색인 진입로 (2026-08)
 *
 * 이전에는 두 경로가 SPA 와일드카드에 걸려 `index.html`을 200으로 반환했다.
 * (sitemap 자리에 HTML이 오면 Search Console 제출 시 파싱 에러)
 *
 * `NODE_ENV` 조건 밖에서 등록한다 — dist/가 필요 없는 순수 데이터 응답이라
 * 기존 supertest 스위트로 그대로 검증된다.
 *
 * 노출 대상: 승인(APPROVED)된 갤러리/공모/전시 + 탈퇴하지 않은 작가의 포트폴리오(이미지 1장 이상).
 * 실패 시에도 정적 URL만 담은 **유효한** sitemap을 반환한다(503로 죽이지 않음).
 */
import { Router } from 'express';
import prisma from '../lib/prisma';
import logger from '../lib/logger';
import { baseUrl } from '../lib/seoMeta';

const router = Router();

/** 로그인/개인 영역은 색인 제외 */
const DISALLOW = ['/mypage', '/messages', '/login', '/auth', '/api', '/operations'];

/** 공개 정적 페이지 */
const STATIC_PATHS = ['/', '/galleries', '/exhibitions', '/shows', '/explore', '/benefits', '/terms', '/privacy'];

const SITEMAP_TTL_MS = 10 * 60 * 1000;
const SITEMAP_FALLBACK_TTL_MS = 60 * 1000;
const MAX_URLS = 5000;

let sitemapCache: { xml: string; exp: number } | null = null;

/** 테스트 전용 — 케이스 간 캐시 격리 */
export function clearSitemapCache(): void {
  sitemapCache = null;
}

function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface SitemapEntry {
  loc: string;
  lastmod?: Date | null;
}

function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .slice(0, MAX_URLS)
    .map(({ loc, lastmod }) => {
      const mod = lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${mod}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

router.get('/robots.txt', (_req, res) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${baseUrl()}/sitemap.xml`,
    '',
  ].join('\n');
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(body);
});

router.get('/sitemap.xml', async (_req, res) => {
  const now = Date.now();
  if (sitemapCache && sitemapCache.exp > now) {
    res.set('Cache-Control', 'public, max-age=600');
    res.type('application/xml').send(sitemapCache.xml);
    return;
  }

  const base = baseUrl();
  const entries: SitemapEntry[] = STATIC_PATHS.map((p) => ({ loc: `${base}${p}` }));
  let degraded = false;

  try {
    const approved = { status: 'APPROVED' as const };
    const [galleries, exhibitions, shows, portfolios] = await Promise.all([
      prisma.gallery.findMany({
        where: approved,
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS,
      }),
      prisma.exhibition.findMany({
        where: { ...approved, gallery: approved },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS,
      }),
      prisma.show.findMany({
        where: { ...approved, gallery: approved },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS,
      }),
      prisma.portfolio.findMany({
        where: { user: { deletedAt: null }, images: { some: {} } },
        select: { userId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS,
      }),
    ]);

    for (const g of galleries) entries.push({ loc: `${base}/galleries/${g.id}`, lastmod: g.updatedAt });
    for (const e of exhibitions) entries.push({ loc: `${base}/exhibitions/${e.id}`, lastmod: e.updatedAt });
    for (const s of shows) entries.push({ loc: `${base}/shows/${s.id}`, lastmod: s.updatedAt });
    for (const p of portfolios) entries.push({ loc: `${base}/portfolio/${p.userId}`, lastmod: p.updatedAt });
  } catch (err) {
    degraded = true;
    logger.warn('SEO', `sitemap DB 조회 실패 — 정적 경로만 반환: ${(err as Error).message}`);
  }

  const xml = renderSitemap(entries);
  sitemapCache = { xml, exp: now + (degraded ? SITEMAP_FALLBACK_TTL_MS : SITEMAP_TTL_MS) };
  res.set('Cache-Control', 'public, max-age=600');
  res.type('application/xml').send(xml);
});

export default router;
