/**
 * 갤러리 결과물 PDF 빌더를 Node 에서 돌려 보는 시험 장치 (2026-11-24) — 데모 DB 전용(4001).
 *   cd <scratch>/pdfm && npx tsx --tsconfig tsconfig.json /home/jho4255/ArtLink/scratchpad/output-audit-2026-11/harness/docs.ts <공모번호> [only]
 * 결과: scratchpad/output-audit-2026-11/harness/out/*.pdf  (그림은 데모 원본 그대로 심는다 — 브라우저는 줄여 심는다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const pdfmake = createRequire(import.meta.url)('/home/jho4255/ArtLink/frontend/node_modules/pdfmake');
import { buildWorkListDoc } from '@/lib/galleryDocs/workList';
import { buildSubmissionDoc } from '@/lib/galleryDocs/submissionDoc';
import { collectFallbackChars, FONT, FB_CJK, FB_EMOJI } from '@/lib/galleryDocs/text';
import { numberWorks, kstDate, kstPeriod } from '@/lib/galleryDocs/format';
import { buildSettlementDoc, buildArtistSettlementDoc } from '@/lib/galleryDocs/settlementDoc';
import { buildApplicationDoc } from '@/lib/galleryDocs/applicationDoc';
import type { DocContext } from '@/lib/galleryDocs/types';

const API = 'http://localhost:4001/api';
const EX = Number(process.argv[2]);
const ONLY = process.argv[3] || '';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const FONTS = process.cwd() + '/fonts';
const PUB = '/home/jho4255/ArtLink/frontend/public';

pdfmake.setLocalAccessPolicy(() => true);
pdfmake.setUrlAccessPolicy(() => false);

async function googleFallback(family: string, weight: number, text: string, file: string): Promise<boolean> {
  if (!text) return false;
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const u = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css)?.[1];
  if (!u) return false;
  fs.writeFileSync(file, Buffer.from(await (await fetch(u)).arrayBuffer()));
  return true;
}

async function render(name: string, doc: any) {
  const extras = [typeof doc.header === 'function' ? doc.header(2, 3, { width: 595, height: 842 }) : doc.header, typeof doc.footer === 'function' ? doc.footer(1, 3, { width: 595, height: 842 }) : doc.footer];
  const { cjk, emoji } = collectFallbackChars(doc.content, extras);
  const fonts: any = { [FONT]: { normal: `${FONTS}/Pretendard-Regular.otf`, bold: `${FONTS}/Pretendard-Bold.otf`, italics: `${FONTS}/Pretendard-Regular.otf`, bolditalics: `${FONTS}/Pretendard-Bold.otf` } };
  const c4 = path.join(OUT, '_cjk400.ttf'), c7 = path.join(OUT, '_cjk700.ttf'), e4 = path.join(OUT, '_emoji.ttf');
  const okC = cjk ? await googleFallback('Noto Sans KR', 400, cjk, c4) : false;
  const okC7 = cjk ? await googleFallback('Noto Sans KR', 700, cjk, c7) : false;
  const okE = emoji ? await googleFallback('Noto Emoji', 400, emoji, e4) : false;
  const reg = fonts[FONT];
  fonts[FB_CJK] = okC ? { normal: c4, bold: okC7 ? c7 : c4, italics: c4, bolditalics: okC7 ? c7 : c4 } : reg;
  fonts[FB_EMOJI] = okE ? { normal: e4, bold: e4, italics: e4, bolditalics: e4 } : reg;
  pdfmake.setFonts(fonts);
  const t0 = Date.now();
  await pdfmake.createPdf(doc).write(path.join(OUT, name));
  console.log(`${name}  ${Date.now() - t0}ms  fallback cjk=${cjk.length} emoji=${emoji.length}`);
}

const img = (url: string | null | undefined) => {
  if (!url) return null;
  const p = url.startsWith('/demo-art/') ? path.join(PUB, url) : null;
  if (!p || !fs.existsSync(p)) return null;
  return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
};

(async () => {
  const login = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gallery@artlink.com' }) })).json();
  const H = { Authorization: `Bearer ${login.token}` };
  const rows = await (await fetch(`${API}/operations/${EX}/submissions`, { headers: H })).json();
  const ex = await (await fetch(`${API}/exhibitions/${EX}`, { headers: H })).json();
  const ctx: DocContext = { exTitle: ex.title, issuer: ex.gallery?.name ?? '아트링크', period: kstPeriod(ex.exhibitStartDate, ex.exhibitDate), issued: kstDate(new Date()), contact: '02-000-0000 · 서울 영등포구' };
  if (!ONLY || ONLY === 'list') await render('작품리스트.pdf', buildWorkListDoc(ctx, rows, img));
  if (!ONLY || ONLY === 'sub') {
    const { numberOf } = numberWorks(rows);
    for (const r of rows) await render(`출품자료_${r.user.name}.pdf`, buildSubmissionDoc(ex.title, r, numberOf, img));
  }
  if (!ONLY || ONLY === 'settle') {
    const st = await (await fetch(`${API}/operations/${EX}/settlement`, { headers: H })).json();
    const s = { ...st, artists: st.artists.map((a: any) => ({ ...a, approval: a.approval ? { ...a.approval, respondedAt: a.approval.respondedAt ?? (a.approval.status === 'APPROVED' ? new Date().toISOString() : null) } : null })) };
    if (s.artists[0]) s.artists[0].approval = { status: 'APPROVED', respondedAt: '2027-04-09T03:00:00Z' };
    if (s.artists[4]) s.artists[4].approval = { status: 'APPROVED', autoApproved: true, respondedAt: '2027-04-12T03:00:00Z' };
    await render('정산서_전체.pdf', buildSettlementDoc(ctx, s, undefined, img));
    await render('정산서_현금.pdf', buildSettlementDoc(ctx, s, 'CASH', img));
    await render('정산서_카드.pdf', buildSettlementDoc(ctx, s, 'CARD', img));
    const sold = s.artists.find((a: any) => a.works.filter((w: any) => w.sold).length >= 3) ?? s.artists[0];
    await render('정산서_작가.pdf', buildArtistSettlementDoc(ctx, sold, undefined, { cardFeeRate: s.cardFeeRate }, img));
    await render('정산서_내정산서.pdf', buildArtistSettlementDoc(ctx, sold, undefined, { cardFeeRate: s.cardFeeRate, forArtist: true }, img));
  }
  if (!ONLY || ONLY === 'app') {
    const apps = await (await fetch(`${API}/exhibitions/${EX}/applications`, { headers: H })).json();
    for (const a of apps.slice(0, 3)) await render(`지원서_${a.user.name}.pdf`, buildApplicationDoc(ex.title, { ...a, user: { ...a.user, phone: a.user.phone ?? '010-0000-1333', handle: a.user.handle ?? 'somin.bae' }, portfolioFileUrl: '/uploads/portfolio-sample.pdf' }, ex.customFields ? (typeof ex.customFields === 'string' ? JSON.parse(ex.customFields) : ex.customFields) : null, img, { origin: 'https://artlink.cc' }));
  }
})().catch((e) => { console.error(e); process.exit(1); });
