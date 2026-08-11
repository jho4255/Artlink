/**
 * 작가 포트폴리오 포맷 — 실제 작가들이 쓰는 포트폴리오 4종을 그대로 만들어 주는 엔진.
 *
 * ## 왜 새로 만들었나
 * 기존 `portfolioPdf.ts`(이 커밋에서 삭제)는 A4 세로 **이력서**였다. 약력·경력 다음에 작품을 340px 정사각형으로
 * **크롭해서** 6장씩 붙였다. 실제 작가 포트폴리오(레퍼런스 5종)와 비교하면 세 가지가 결정적으로 달랐다.
 *   1) 작품마다 [제목/재료/크기/연도] 캡션이 있다 — 5종 전부. 없으면 "정보 없는 이미지 더미"로 읽힌다.
 *   2) 작품을 **자르지 않는다**. 중립 배경 위에 원본 비율 그대로 놓는다(회화를 정사각으로 자르는 건 금기).
 *   3) 시리즈 단위로 묶고, 시리즈마다 설명 페이지를 둔다. 표지와 연락처 페이지로 시작·끝을 맺는다.
 *
 * ## 엔진 구조 (operationPdf의 htmlToPdfBlob과 다른 점)
 * `htmlToPdfBlob`은 **긴 세로 한 장**을 렌더해 잘라내는 방식이라 페이지마다 다른 레이아웃을 못 준다.
 * 여기서는 반대로 **페이지 하나 = HTML 하나**를 정확한 판형 크기(px)로 렌더해 1:1로 넣는다.
 * 덕분에 표지·시리즈 표지·작품 페이지가 각각 다른 구성을 가질 수 있고, 미리보기 화면도
 * 같은 HTML을 그대로 축소해 보여주면 되므로 **미리보기와 PDF가 절대 어긋나지 않는다**.
 *
 * ## 이미지
 * `imageSrc()`(= proxied)로 blob: URL을 쓴다. 렌더 전에 반드시 prefetch를 돌려야 네트워크가 0이 된다.
 * 안 하면 페이지 수만큼 프록시 요청이 붙어 "안 끝나는" 상태가 된다(operationPdf 주석 참고).
 */
import { displayName } from '@/lib/utils';
import { esc, proxied, safeName, triggerDownload } from '@/lib/operationPdf';
import { prefetchImages, recoverFailed } from '@/lib/imageFetch';
import {
  artworkTitle, captionInline, captionLines, careerLineText,
  groupBySeries, normalizeCareer, statusLabel,
} from '@/lib/artwork';
import type { CareerKey, PortfolioImage, PublicPortfolio, SeriesInfo } from '@/types';

export type PortfolioThemeId = 'gallery' | 'studio' | 'story' | 'archive';

export interface PortfolioTheme {
  id: PortfolioThemeId;
  name: string;
  /** 선택 화면에 뜨는 한 줄 스타일 설명 */
  summary: string;
  /** 판형 라벨 (예: 와이드 16:9) */
  sizeLabel: string;
  /** 페이지 픽셀 크기 + PDF mm 크기 */
  page: { w: number; h: number; mmW: number; mmH: number };
  worksPerPage: 1 | 2 | 3;
  bg: string;
  ink: string;
  sub: string;
  accent: string;
  line: string;
  /** 표지·큰 제목용 글꼴 스택 */
  display: string;
}

const SANS = `'Pretendard Variable',Pretendard,system-ui,sans-serif`;
// 명조는 index.html에서 Nanum Myeongjo를 함께 받는다. 못 받은 환경에서도 무너지지 않게 시스템 명조로 폴백.
const SERIF = `'Nanum Myeongjo','Apple SD Gothic Neo',Georgia,'Times New Roman',serif`;

export const PORTFOLIO_THEMES: PortfolioTheme[] = [
  {
    id: 'gallery',
    name: '포맷 A',
    summary: '아이보리 배경에 명조체. 작품 1~2점을 크게',
    sizeLabel: '와이드 16:9',
    page: { w: 1600, h: 900, mmW: 297, mmH: 167 },
    worksPerPage: 2,
    bg: '#EDEBE6', ink: '#2E2A24', sub: '#7A7268', accent: '#8A7350', line: '#D6D2C8',
    display: SERIF,
  },
  {
    id: 'studio',
    name: '포맷 B',
    summary: '차콜·오렌지. 큰 시리즈 제목과 3점 그리드',
    sizeLabel: 'A4 가로',
    page: { w: 1414, h: 1000, mmW: 297, mmH: 210 },
    worksPerPage: 3,
    bg: '#FFFFFF', ink: '#1B1B1F', sub: '#8A8A93', accent: '#FF6A00', line: '#E4E4E8',
    display: SANS,
  },
  {
    id: 'story',
    name: '포맷 C',
    summary: '왼쪽에 작품, 오른쪽에 이야기. 매 장 하단에 연락처',
    sizeLabel: 'A4 가로',
    page: { w: 1414, h: 1000, mmW: 297, mmH: 210 },
    worksPerPage: 1,
    bg: '#FFFFFF', ink: '#1A1A1A', sub: '#8A8A8A', accent: '#c4302b', line: '#E8E8E8',
    display: SANS,
  },
  {
    id: 'archive',
    name: '포맷 D',
    summary: '흰 여백과 얇은 테두리. 명조체 문서형',
    sizeLabel: 'A4 세로',
    page: { w: 1000, h: 1414, mmW: 210, mmH: 297 },
    worksPerPage: 2,
    bg: '#FCFBF9', ink: '#232020', sub: '#8B8580', accent: '#5C5550', line: '#E2DED8',
    display: SERIF,
  },
];

export const themeById = (id?: string | null): PortfolioTheme =>
  PORTFOLIO_THEMES.find((t) => t.id === id) ?? PORTFOLIO_THEMES[0];

// ── 입력 데이터 ──
export interface PortfolioBookData {
  user: { name: string; nickname?: string | null; email?: string | null; phone?: string | null; instagramUrl?: string | null };
  tagline?: string | null;
  statement?: string | null;
  biography?: string | null;
  career?: PublicPortfolio['career'];
  seriesInfo?: SeriesInfo[] | null;
  images: PortfolioImage[];
  /** 표지에 찍히는 연도 (미지정 시 올해) */
  year?: string;
}

export interface PortfolioPage {
  /** 미리보기 썸네일 아래 라벨 */
  label: string;
  html: string;
}

const CV_ORDER: { key: CareerKey; label: string; en: string }[] = [
  { key: 'education', label: '학력', en: 'EDUCATION' },
  { key: 'solo', label: '개인전', en: 'SOLO EXHIBITIONS' },
  { key: 'group', label: '단체전', en: 'GROUP EXHIBITIONS' },
  { key: 'artFair', label: '아트페어', en: 'ART FAIRS' },
  { key: 'award', label: '수상 및 선정', en: 'AWARDS' },
];

// instagram.com/handle → @handle
function igLabel(url?: string | null): string {
  if (!url) return '';
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  return m ? `@${m[1]}` : url;
}

const contactList = (u: PortfolioBookData['user']) =>
  [u.email, u.phone, igLabel(u.instagramUrl)].map((s) => String(s ?? '').trim()).filter(Boolean);

/** 문단 → HTML. 빈 줄로 문단을 나눈다(작가가 엔터로 구분해 쓴 글이 한 덩어리로 뭉치지 않게). */
function paragraphs(text: string, style: string): string {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

// ── 긴 글 나누기 ──
// 페이지가 고정 크기라 글이 길면 **넘치는 만큼 그대로 잘려 나간다**(표시도 없이).
// 실서버에 작가노트 3,316자짜리 작가가 있었고, 4개 포맷 전부에서 최대 1,154px가 잘리고 있었다.
// 빌더가 DOM 없는 순수 함수라 실측이 불가능하므로 **넉넉하게 추정**한다 — 남는 건 괜찮고 넘치면 글이 사라진다.

/** 한글은 글자 하나가 거의 1em을 먹는다. 라틴/공백이 섞이면 더 좁아지므로 이 값이면 보수적이다. */
const CHAR_W_RATIO = 0.95;

/** 문단 하나의 높이 추정 (줄바꿈 포함) */
export function estimateParaH(text: string, fontPx: number, lineH: number, colW: number, gap: number): number {
  const perLine = Math.max(1, Math.floor(colW / (fontPx * CHAR_W_RATIO)));
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * lineH + gap;
}

/**
 * 문단들을 페이지 용량에 맞춰 나눈다.
 * 한 문단이 통째로 한 페이지보다 크면 그 문단은 줄 단위로 쪼갠다(안 그러면 영원히 안 들어간다).
 */
export function splitParagraphs(
  paras: string[], firstCap: number, restCap: number,
  fontPx: number, lineH: number, colW: number, gap: number,
): string[][] {
  const perLine = Math.max(1, Math.floor(colW / (fontPx * CHAR_W_RATIO)));
  const pages: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  let cap = firstCap;
  const flush = () => { if (cur.length) { pages.push(cur); cur = []; } used = 0; cap = restCap; };

  for (const raw of paras) {
    let text = raw;
    while (text) {
      const h = estimateParaH(text, fontPx, lineH, colW, gap);
      if (used + h <= cap) { cur.push(text); used += h; break; }
      // 남은 공간에 들어갈 만큼만 잘라 넣는다
      const room = cap - used - gap;
      const fitLines = Math.floor(room / lineH);
      if (fitLines >= 2) {
        const cut = fitLines * perLine;
        // 가능하면 공백에서 끊어 단어가 갈라지지 않게
        const slice = text.slice(0, cut);
        const sp = slice.lastIndexOf(' ');
        const at = sp > cut * 0.6 ? sp : cut;
        cur.push(text.slice(0, at).trimEnd());
        text = text.slice(at).trimStart();
      }
      flush();
      if (fitLines < 2 && used === 0 && cap <= gap) break; // 안전장치 (용량이 비정상)
    }
  }
  flush();
  return pages.length ? pages : [[]];
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/**
 * 작품 이미지 태그.
 *
 * ⚠️ **작품은 절대 자르거나 늘리지 않는다.** 회화에서 비율은 작품 그 자체다.
 * 그래서 여기서 `object-fit`을 강제로 `contain`으로 고정한다 — 호출부가 `cover`/`fill`을 적어도 무시된다.
 * (표지를 예쁘게 만들려다 `cover`로 깔아 그림이 잘린 적이 있다. 실수로도 못 하게 막는다.
 *  회귀 방지 테스트: `portfolioFormats.test.ts` — 모든 페이지 HTML에 cover/fill이 없어야 통과)
 * 크기는 반드시 `max-width`/`max-height`로만 주고, `width`/`height`를 함께 못 박지 말 것.
 */
/**
 * 이미지 주소 결정 방식. `buildPortfolioPages`가 시작할 때 정하고 그 **동기 실행 동안만** 유효하다.
 *  - 'display'(미리보기): 원본 주소를 그대로 쓴다. 화면에 그리는 것뿐이라 프록시가 필요 없다.
 *    예전엔 미리보기도 프록시를 태웠는데, 페이지 수만큼 백엔드 왕복이 생기고
 *    프록시가 설정 안 된 환경에서는 **사진이 통째로 깨졌다**(로컬에서 실서버 데이터 볼 때).
 *  - 'pdf': prefetch가 만들어 둔 blob(동일 출처 → canvas taint 없음), 없으면 프록시로 폴백.
 */
let imgMode: 'display' | 'pdf' = 'display';

const img = (url: string, style: string) => {
  const pdf = imgMode === 'pdf';
  // ⚠️ 미리보기에는 crossorigin을 붙이면 안 된다.
  // 같은 사진을 화면 어딘가(작품 그리드 등)에서 **crossorigin 없는 <img>** 로 먼저 그리면
  // 브라우저 캐시에 'CORS 정보 없는' 항목이 남는다. 그 뒤 crossorigin="anonymous" 로 같은 주소를
  // 요청하면 그 캐시 항목을 재사용하며 **차단**된다(서버 헤더는 정상인데도). 그러면 미리보기에서
  // 사진이 통째로 안 뜬다 — 실제로 그랬다. CLAUDE.md 제약 16의 <img> 버전.
  // 화면에 그리는 데는 CORS가 필요 없으므로 PDF 경로에서만 붙인다.
  return `<img src="${esc(pdf ? proxied(url) : url)}"${pdf ? ' crossorigin="anonymous"' : ''} style="${style};object-fit:contain"/>`;
};

// ── 페이지 껍데기 ──
// 모든 페이지는 정확히 판형 크기의 박스다. 여기서 배경·기본 글꼴·러닝 요소(머리말/꼬리말)를 씌운다.
interface Chrome {
  /** 좌상단 러닝 라벨 (시리즈명 등) */
  running?: string;
  /** 러닝 요소를 아예 끄는 페이지(표지 등) */
  bare?: boolean;
}

/**
 * 판형별 본문 영역(패딩). 페이지 안 내용의 세로 크기는 반드시 이 값에서 계산해야 한다 —
 * 상수를 각자 손으로 적었더니 아카이브에서 머리말과 작품이 겹치고, 스토리 전시전경이
 * 하단 연락처 줄을 뚫고 나갔다. 한 곳에서만 정의한다.
 */
const PAD: Record<PortfolioThemeId, { top: number; bottom: number; x: number }> = {
  gallery: { top: 76, bottom: 70, x: 96 },
  // 하단에 룰 + 러닝 푸터가 앉는다
  studio: { top: 72, bottom: 96, x: 78 },
  story: { top: 112, bottom: 108, x: 84 },
  // 상단 머리말(top:56 + 룰)을 반드시 지나야 한다
  archive: { top: 132, bottom: 92, x: 82 },
};
/** 본문에 실제로 쓸 수 있는 세로 크기 */
const availH = (theme: PortfolioTheme) => theme.page.h - PAD[theme.id].top - PAD[theme.id].bottom;
/** 캡션(제목 + 보조 줄들)이 차지하는 높이 — 이미지 높이를 정할 때 빼둔다 */
const captionH = (theme: PortfolioTheme) => (theme.worksPerPage === 3 ? 78 : 104);

function page(theme: PortfolioTheme, data: PortfolioBookData, inner: string, chrome: Chrome = {}): string {
  const { w, h } = theme.page;
  const shell = (content: string, bg = theme.bg) =>
    `<div style="position:relative;width:${w}px;height:${h}px;background:${bg};font-family:${SANS};color:${theme.ink};overflow:hidden;box-sizing:border-box">${content}</div>`;

  if (chrome.bare) return shell(inner);

  const name = displayName(data.user);
  const p = PAD[theme.id];
  let deco = '';
  let pad = `padding:${p.top}px ${p.x}px ${p.bottom}px`;

  if (theme.id === 'gallery') {
    // 무장식. 여백 자체가 이 포맷의 성격이다.
    deco = chrome.running
      ? `<div style="position:absolute;top:40px;left:${p.x}px;font-size:12px;letter-spacing:0.26em;color:${theme.sub}">${esc(chrome.running.toUpperCase())}</div>`
      : '';
  } else if (theme.id === 'studio') {
    // 하단 얇은 룰 + 러닝 푸터만. 시리즈 제목은 페이지 '내용'이 직접 그린다(worksPages) —
    // 머리말 장식에 시리즈명을 넣어두면 시리즈를 안 쓰는 작가에게 **내용 없는 빈 띠**만 남는다.
    deco = `
      <div style="position:absolute;left:${p.x}px;right:${p.x}px;bottom:44px">
        <div style="height:1px;background:${theme.line}"></div>
        <div style="margin-top:13px;display:flex;justify-content:space-between;align-items:center;
                    font-size:11.5px;letter-spacing:0.2em;color:${theme.sub}">
          <span style="display:flex;align-items:center;gap:9px">
            <span style="display:inline-block;width:9px;height:9px;background:${theme.accent}"></span>
            <span style="color:${theme.ink};font-weight:700;letter-spacing:0.06em">${esc(name)}</span>
          </span>
          <span>${esc((chrome.running || '').toUpperCase())}</span>
        </div>
      </div>`;
  } else if (theme.id === 'story') {
    // 좌상단 레드 대시 + 러닝 제목, 하단 연락처 스트립 — 어느 장을 캡처해 공유해도 연락처가 함께 남는다
    const cs = contactList(data.user);
    deco = `
      <div style="position:absolute;top:52px;left:${p.x}px;display:flex;align-items:center;gap:14px">
        <span style="display:inline-block;width:34px;height:7px;background:${theme.accent}"></span>
        <span style="font-size:26px;font-weight:800;letter-spacing:-0.01em">${esc(chrome.running || name)}</span>
      </div>
      <div style="position:absolute;bottom:0;left:0;width:${w}px;padding:0 ${p.x}px 34px;box-sizing:border-box">
        <div style="border-top:1px solid ${theme.line};padding-top:16px;display:flex;gap:34px;font-size:14px;color:${theme.sub}">
          <span style="color:${theme.ink};font-weight:700">${esc(name)}</span>
          ${cs.map((c) => `<span>${esc(c)}</span>`).join('')}
        </div>
      </div>`;
  } else {
    // archive — 얇은 상단 룰과 하단 러닝 라인. 문서다운 정숙함.
    deco = `
      <div style="position:absolute;top:56px;left:${p.x}px;right:${p.x}px;display:flex;justify-content:space-between;
                  border-bottom:1px solid ${theme.line};padding-bottom:12px;font-size:11.5px;letter-spacing:0.2em;color:${theme.sub}">
        <span>${esc((chrome.running || 'PORTFOLIO').toUpperCase())}</span>
        <span>${esc(name)}</span>
      </div>`;
  }

  return shell(`${deco}<div style="position:relative;width:${w}px;height:${h}px;box-sizing:border-box;${pad};display:flex;flex-direction:column">${inner}</div>`);
}

// ── 표지 ──
function coverHtml(theme: PortfolioTheme, data: PortfolioBookData): string {
  const { w, h } = theme.page;
  const name = displayName(data.user);
  const year = data.year || String(new Date().getFullYear());
  const hero = data.images[0]?.url;
  const tag = String(data.tagline ?? '').trim();

  if (theme.id === 'gallery') {
    // 위쪽에 이름, 아래쪽에 대표작 한 점을 '판(plate)'처럼 앉힌다.
    // 예전에는 아래를 작품으로 꽉 채웠는데(cover) 그러면 **그림이 잘린다** — 절대 금지(파일 상단 주석 참고).
    const plateTop = Math.round(h * 0.46);
    const plateH = h - plateTop - 64;
    const plateW = Math.round(w * 0.52);
    return page(theme, data, `
      <div style="position:absolute;inset:0;background:${theme.bg}"></div>
      ${hero ? `<div style="position:absolute;left:0;top:${plateTop}px;width:${w}px;height:${plateH}px;display:flex;align-items:center;justify-content:center">
        ${img(hero, `max-width:${plateW}px;max-height:${plateH}px;object-fit:contain;display:block`)}
      </div>` : ''}
      <div style="position:absolute;top:${Math.round(h * 0.11)}px;left:0;width:${w}px;text-align:center">
        <div style="font-family:${theme.display};font-size:84px;line-height:1;letter-spacing:0.07em;color:${theme.accent}">${esc(name)}</div>
        <div style="margin-top:30px;font-size:15px;letter-spacing:0.42em;color:${theme.ink}">ARTIST PORTFOLIO</div>
        <div style="margin-top:10px;font-size:15px;letter-spacing:0.42em;color:${theme.ink}">${esc(year)}</div>
        ${tag ? `<div style="margin-top:24px;font-family:${theme.display};font-size:21px;color:${theme.sub}">${esc(tag)}</div>` : ''}
      </div>`, { bare: true });
  }

  if (theme.id === 'studio') {
    // 전면 차콜 위에 왼쪽 텍스트 / 오른쪽 대표작 '타일'.
    // 작품을 꽉 채우지 않고 여백을 둘러 앉히는 게 이 포맷의 성격이다(작품이 배경이 아니라 전시물처럼 보이게).
    const colX = 86;
    const colW = Math.round(w * 0.42);
    const tileL = colX + colW + 56;
    const tileW = w - tileL - 86;
    const tileH = h - 200;
    return page(theme, data, `
      <div style="position:absolute;inset:0;background:${theme.ink}"></div>
      ${hero ? `<div style="position:absolute;left:${tileL}px;top:100px;width:${tileW}px;height:${tileH}px;display:flex;align-items:center;justify-content:center">
        ${img(hero, `max-width:${tileW}px;max-height:${tileH}px;object-fit:contain;display:block`)}</div>` : ''}
      <div style="position:absolute;left:${colX}px;top:${Math.round(h * 0.26)}px;width:${colW}px;color:#fff">
        <div style="display:flex;align-items:center;gap:11px">
          <span style="display:inline-block;width:11px;height:11px;background:${theme.accent}"></span>
          <span style="font-size:12px;letter-spacing:0.3em;color:#B9B9C2">ARTIST PORTFOLIO ${esc(year)}</span>
        </div>
        <div style="margin-top:26px;font-size:78px;font-weight:900;letter-spacing:-0.045em;line-height:1.02;word-break:keep-all">${esc(name)}</div>
        ${tag ? `<div style="margin-top:20px;font-size:17px;line-height:1.75;color:#A9A9B2;word-break:keep-all">${esc(tag)}</div>` : ''}
        <div style="margin-top:34px;width:104px;height:9px;background:${theme.accent}"></div>
      </div>`, { bare: true });
  }

  if (theme.id === 'story') {
    // 위 = 대표작(원본 비율 그대로), 아래 = 제목 블록.
    // 예전에는 작품을 전면 배경으로 깔았는데(cover) 그림이 잘려 나갔다 — 금지.
    const artH = Math.round(h * 0.6);
    return page(theme, data, `
      <div style="position:absolute;inset:0;background:#fff"></div>
      ${hero ? `<div style="position:absolute;left:0;top:56px;width:${w}px;height:${artH}px;display:flex;align-items:center;justify-content:center">
        ${img(hero, `max-width:${Math.round(w * 0.74)}px;max-height:${artH}px;object-fit:contain;display:block`)}
      </div>` : ''}
      <div style="position:absolute;left:84px;right:84px;bottom:74px">
        <div style="height:3px;background:${theme.accent};width:100%"></div>
        <div style="margin-top:26px;display:flex;align-items:flex-end;justify-content:space-between;gap:40px">
          <div style="min-width:0">
            <div style="font-size:62px;font-weight:900;letter-spacing:-0.03em;line-height:1.05;color:${theme.ink}">${esc(name)}</div>
            ${tag ? `<div style="margin-top:12px;font-size:19px;line-height:1.6;color:#555;word-break:keep-all;max-width:${Math.round(w * 0.6)}px">${esc(tag)}</div>` : ''}
          </div>
          <div style="flex:none;text-align:right;font-size:13px;letter-spacing:0.32em;color:${theme.sub};padding-bottom:8px">
            ARTIST PORTFOLIO<br/>${esc(year)}
          </div>
        </div>
      </div>`, { bare: true });
  }

  // archive — 인쇄 문서 표지. 얇은 겹테두리 안에 이름과 대표작 한 점.
  return page(theme, data, `
    <div style="position:absolute;inset:44px;border:1px solid ${theme.line}"></div>
    <div style="position:absolute;inset:52px;border:1px solid ${theme.line}"></div>
    <div style="position:absolute;left:0;top:${Math.round(h * 0.13)}px;width:${w}px;text-align:center">
      <div style="font-size:13px;letter-spacing:0.44em;color:${theme.sub}">ARTWORK PORTFOLIO</div>
      <div style="margin-top:26px;font-family:${theme.display};font-size:56px;letter-spacing:0.06em">${esc(name)}</div>
      ${tag ? `<div style="margin-top:18px;font-size:15px;color:${theme.sub};padding:0 130px;line-height:1.8">${esc(tag)}</div>` : ''}
    </div>
    ${hero ? `<div style="position:absolute;left:130px;right:130px;top:${Math.round(h * 0.36)}px;height:${Math.round(h * 0.4)}px;display:flex;align-items:center;justify-content:center">
      ${img(hero, `max-width:100%;max-height:${Math.round(h * 0.4)}px;object-fit:contain;display:block`)}</div>` : ''}
    <div style="position:absolute;left:0;bottom:96px;width:${w}px;text-align:center;font-size:13px;letter-spacing:0.3em;color:${theme.sub}">${esc(year)}</div>`,
    { bare: true });
}

// ── 글 페이지 (작가노트 / 시리즈 소개) ──
function prosePages(
  theme: PortfolioTheme, data: PortfolioBookData,
  eyebrow: string, title: string, body: string, label: string,
): PortfolioPage[] {
  const isSerif = theme.display === SERIF;
  const titleStyle = isSerif
    ? `font-family:${theme.display};font-size:38px;letter-spacing:0.04em`
    : `font-size:36px;font-weight:800;letter-spacing:-0.02em`;
  const fontPx = theme.id === 'archive' ? 15 : 17;
  const lineH = Math.round(fontPx * 2.05);
  const bodyStyle = `margin:0 0 20px;font-size:${fontPx}px;line-height:2.05;color:${theme.ink};word-break:keep-all`;
  const contentW = theme.page.w - PAD[theme.id].x * 2;
  const colW = theme.id === 'archive' ? contentW : Math.min(1080, contentW);
  const maxW = theme.id === 'archive' ? '100%' : '1080px';

  // 첫 장은 아이브로우 + 제목 + 룰이 자리를 먹는다. 이어지는 장은 작은 머리말만.
  // 여유분 24px — 추정이 맞아떨어져도 기기·글꼴 버전에 따라 몇 px씩 어긋난다. 마지막 줄이 가장자리에
  // 딱 붙으면 그런 오차에 바로 잘리므로 쿠션을 둔다(쪽수가 조금 늘어나는 건 감수).
  const SAFETY = 24;
  const firstCap = availH(theme) - (18 + 16 + 46 + 22 + 3 + 34) - SAFETY;
  const restCap = availH(theme) - (18 + 16 + 30 + 24) - SAFETY;
  const paras = String(body).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const pageParas = splitParagraphs(paras, firstCap, restCap, fontPx, lineH, colW, 20);
  const multi = pageParas.length > 1;

  return pageParas.map((ps, i) => ({
    label: i === 0 ? label : `${label} (${i + 1})`,
    html: page(theme, data, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:${multi ? 'flex-start' : 'center'}">
        <div style="max-width:${maxW};margin:0 auto;width:100%">
          <div style="font-size:12px;letter-spacing:0.34em;color:${theme.accent};font-weight:700">${esc(eyebrow)}${i > 0 ? ' (계속)' : ''}</div>
          ${i === 0
            ? `<div style="margin-top:16px;${titleStyle}">${esc(title)}</div>
               <div style="margin-top:22px;width:64px;height:3px;background:${theme.accent}"></div>`
            : `<div style="margin-top:16px;font-size:20px;font-weight:${isSerif ? 400 : 700};font-family:${isSerif ? theme.display : SANS};color:${theme.sub}">${esc(title)}</div>`}
          <div style="margin-top:34px">${ps.map((t) => `<p style="${bodyStyle}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}</div>
        </div>
      </div>`),
  }));
}

// ── 캡션 ──
function captionHtml(theme: PortfolioTheme, a: PortfolioImage, align: 'center' | 'left'): string {
  const st = statusLabel(a);
  const titleSize = theme.worksPerPage === 3 ? 15 : 18;
  const isSerif = theme.display === SERIF;
  const lines = captionLines(a);
  const meta = theme.worksPerPage === 3
    ? `<div style="margin-top:5px;font-size:11.5px;color:${theme.sub};letter-spacing:0.02em">${esc(captionInline(a))}</div>`
    : lines.map((l) => `<div style="margin-top:5px;font-size:13px;color:${theme.sub};letter-spacing:${isSerif ? '0.12em' : '0.02em'}">${esc(l)}</div>`).join('');
  return `
    <div style="text-align:${align};margin-top:18px">
      <div style="font-size:${titleSize}px;font-weight:${isSerif ? 400 : 700};font-family:${isSerif ? theme.display : SANS};letter-spacing:${isSerif ? '0.06em' : '-0.01em'}">
        ${esc(artworkTitle(a))}${st ? `<span style="margin-left:10px;font-size:12px;font-weight:700;color:${theme.accent};letter-spacing:0.06em">● ${esc(st)}</span>` : ''}
      </div>
      ${meta}
    </div>`;
}

// ── 작품 페이지 ──
/**
 * 스튜디오 볼드의 시리즈 제목 블록 — **페이지 내용**이지 머리말 장식이 아니다.
 * 시리즈가 없으면 아예 안 그린다(빈 띠가 남지 않게). 같은 시리즈가 여러 장 이어질 땐 축약형.
 */
function studioSeriesHead(theme: PortfolioTheme, series: string | undefined, first: boolean): { html: string; h: number } {
  if (!series) return { html: '', h: 0 };
  if (!first) {
    return {
      h: 46,
      html: `<div style="margin-bottom:26px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="display:inline-block;width:10px;height:10px;background:${theme.accent}"></span>
          <span style="font-size:13px;font-weight:700;letter-spacing:0.14em">${esc(series)}</span>
        </div>
        <div style="height:1px;background:${theme.line}"></div>
      </div>`,
    };
  }
  return {
    h: 132,
    html: `<div style="margin-bottom:30px">
      <div style="width:76px;height:9px;background:${theme.accent}"></div>
      <div style="margin-top:16px;display:flex;align-items:baseline;gap:14px">
        <span style="font-size:46px;font-weight:900;letter-spacing:-0.035em;line-height:1.05;word-break:keep-all">${esc(series)}</span>
        <span style="font-size:11px;letter-spacing:0.3em;color:${theme.sub}">SERIES</span>
      </div>
      <div style="margin-top:20px;height:1px;background:${theme.line}"></div>
    </div>`,
  };
}

function worksPages(theme: PortfolioTheme, data: PortfolioBookData, items: PortfolioImage[], label: string, running?: string, first = true): PortfolioPage[] {
  const { w } = theme.page;
  const avail = availH(theme);
  const capH = captionH(theme);

  // story — 좌: 작품 한 점, 우: 캡션 + 이야기
  // 작품 설명이 길면 오른쪽 칸을 넘어 위아래로 삐져나갔다(가운데 정렬이라 양쪽으로). 칸에 들어갈 만큼만 싣고
  // 나머지는 이어지는 글 페이지로 넘긴다 — 자르지 않는다.
  if (theme.id === 'story') {
    const a = items[0]!;
    const imgW = Math.round(w * 0.55);
    const colW = w - PAD.story.x * 2 - imgW - 56;
    const desc = String(a.description ?? '').trim();
    const CAP_BLOCK = 150;                       // 제목 + 캡션 줄 + 구분선 여백
    const room = avail - CAP_BLOCK;
    // 첫 덩어리만 오른쪽 칸 크기에 맞추고, 나머지는 통째로 뒤 페이지(prosePages)가 다시 나눈다.
    // 여기서 restCap을 0으로 두면 나머지를 담을 데가 없어 **조용히 버려진다**(테스트로 잡음).
    const parts = desc
      ? splitParagraphs(desc.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean), room, 1e9, 15, 30, colW, 14)
      : [[]];
    const head = parts[0] ?? [];

    const first = page(theme, data, `
      <div style="display:flex;gap:56px;align-items:center;height:${avail}px">
        <div style="width:${imgW}px;height:${avail}px;display:flex;align-items:center;justify-content:center">
          ${img(a.url, `max-width:${imgW}px;max-height:${avail}px;object-fit:contain;display:block`)}
        </div>
        <div style="flex:1;min-width:0">
          ${captionHtml(theme, a, 'left').replace('margin-top:18px', 'margin-top:0')}
          ${head.length ? `<div style="margin-top:26px;padding-top:24px;border-top:1px solid ${theme.line}">
            ${head.map((t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.95;color:#444;word-break:keep-all">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}
          </div>` : ''}
        </div>
      </div>`, { running: running || undefined });

    // 남은 이야기는 글 페이지로 (작품명을 제목으로) — 자르지 않는다
    const rest = parts.slice(1).flat();
    return rest.length
      ? [{ label, html: first }, ...prosePages(theme, data, 'STORY', artworkTitle(a), rest.join('\n\n'), `${artworkTitle(a)} 이야기`).slice(0, 99)]
      : [{ label, html: first }];
  }

  // studio — 시리즈 제목 블록 + 3점 그리드.
  // 3단이라 이미지는 폭에 먼저 걸린다(높이는 남는다). 칸 높이를 페이지 전체로 잡으면 그림이 아래로 몰리므로
  // 칸 높이를 적당히 고정하고 그 덩어리를 남은 공간의 세로 중앙에 둔다.
  // 칸 안에서는 아래 정렬 — 그래야 그림 높이가 달라도 캡션 줄이 한 선에 맞는다(레퍼런스 관례).
  if (theme.id === 'studio') {
    const head = studioSeriesHead(theme, running, first);
    const gridH = avail - head.h;
    const boxH = Math.min(gridH - capH, 520);
    return [{ label, html: page(theme, data, `
      ${head.html}
      <div style="height:${gridH}px;display:flex;gap:36px;align-items:center;justify-content:center;width:100%">
        ${items.map((a) => `
          <div style="flex:1 1 0;min-width:0">
            <div style="height:${boxH}px;display:flex;align-items:flex-end;justify-content:center">
              ${img(a.url, `max-width:100%;max-height:${boxH}px;object-fit:contain;display:block`)}
            </div>
            ${captionHtml(theme, a, 'center')}
          </div>`).join('')}
      </div>`, { running: running || undefined }) }];
  }

  // gallery(가로 2점) / archive(세로 2점)
  const isArchive = theme.id === 'archive';
  const gap = isArchive ? 40 : 72;
  // 세로로 쌓는 아카이브만 한 칸이 절반을 나눠 갖는다. 가로로 나란한 갤러리는 각 칸이 전체 높이를 쓴다.
  const imgH = isArchive
    ? Math.floor((avail - (items.length - 1) * gap - items.length * capH) / items.length)
    : avail - capH;

  const cell = (a: PortfolioImage) => `
    <div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="height:${imgH}px;display:flex;align-items:center;justify-content:center;width:100%">
        ${img(a.url, `max-width:100%;max-height:${imgH}px;object-fit:contain;display:block`)}
      </div>
      ${captionHtml(theme, a, 'center')}
    </div>`;

  return [{ label, html: page(theme, data, `
    <div style="display:flex;flex-direction:${isArchive ? 'column' : 'row'};gap:${gap}px;
                align-items:stretch;justify-content:center;width:100%;height:${avail}px">
      ${items.map(cell).join('')}
    </div>`, { running: running || undefined }) }];
}

// ── CV ──
// 경력은 작가마다 편차가 극심하다(실서버에 72건짜리 작가가 있다). 한 장에 다 넣으려 하면
// 페이지가 고정 크기라 **넘치는 만큼 그냥 잘려 나간다** — 게다가 잘렸다는 표시조차 없다.
// 그래서 넣기 전에 높이를 계산해 여러 장으로 나눈다.
//
// 실측이 아니라 추정이다(빌더가 DOM 없는 순수 함수라 잴 수가 없다). 그래서 넉넉하게 잡는다 —
// 좀 남는 건 괜찮지만 넘치면 글자가 사라진다.
const CV_LINE_H = 23;   // 항목 한 줄 (13px / line-height 1.75)
const CV_HEAD_H = 41;   // 섹션 제목 + 밑줄 + 여백
const CV_SEC_GAP = 26;  // 섹션 사이 여백

interface CvChunk { key: CareerKey; label: string; en: string; entries: string[]; cont: boolean }

/** 한 항목이 몇 줄로 접히는지 추정 (한글은 글자폭이 넓어 넉넉히 잡는다) */
function cvEntryLines(text: string, colW: number): number {
  const perChar = 11.5; // 13px 한글 기준 근사
  return Math.max(1, Math.ceil((text.length * perChar) / Math.max(colW, 120)));
}

/**
 * 경력 항목들을 페이지 → 단(column) 단위로 나눈다.
 * - 섹션 제목만 단 끝에 남는 고아를 막는다(제목 뒤에 최소 1줄은 붙인다)
 * - 섹션이 이어지면 다음 단에 제목을 다시 쓰고 `(계속)`을 붙인다 — 안 그러면 어느 섹션인지 알 수 없다
 */
export function splitCvColumns(
  sections: { key: CareerKey; label: string; en: string; entries: string[] }[],
  colH: number,
  colW: number,
  colsPerPage: number,
  firstPageColH: number,
): CvChunk[][][] {
  const pages: CvChunk[][][] = [];
  let page: CvChunk[][] = [];
  let col: CvChunk[] = [];
  let used = 0;
  let limit = firstPageColH;

  const pushCol = () => {
    page.push(col); col = []; used = 0;
    if (page.length >= colsPerPage) { pages.push(page); page = []; limit = colH; }
  };

  for (const sec of sections) {
    let cont = false;
    let i = 0;
    while (i < sec.entries.length) {
      const headH = CV_HEAD_H;
      // 제목만 들어가고 항목이 하나도 안 들어가면 이 단은 접는다(고아 방지)
      if (used + headH + CV_LINE_H > limit && used > 0) { pushCol(); continue; }
      const taken: string[] = [];
      let h = used + headH;
      while (i < sec.entries.length) {
        const eh = cvEntryLines(sec.entries[i]!, colW) * CV_LINE_H;
        if (h + eh > limit && taken.length > 0) break;
        taken.push(sec.entries[i]!); h += eh; i++;
      }
      col.push({ key: sec.key, label: sec.label, en: sec.en, entries: taken, cont });
      used = h + CV_SEC_GAP;
      cont = true;
      if (i < sec.entries.length) pushCol();
    }
  }
  if (col.length) page.push(col);
  if (page.length) pages.push(page);
  return pages;
}

function cvPages(theme: PortfolioTheme, data: PortfolioBookData): PortfolioPage[] {
  const c = normalizeCareer(data.career);
  const isSerif = theme.display === SERIF;
  const bio = String(data.biography ?? '').trim();
  const sections = CV_ORDER
    .filter(({ key }) => (c[key] ?? []).length > 0)
    .map(({ key, label, en }) => ({ key, label, en, entries: (c[key] ?? []).map(careerLineText).filter(Boolean) }));

  // 세로 판형은 한 단, 가로 판형은 두 단 (가로에서 한 단이면 줄이 지나치게 길어져 읽기 나쁘다)
  const twoCol = theme.page.w > theme.page.h;
  const cols = twoCol ? 2 : 1;
  const gap = twoCol ? 64 : 0;
  const contentW = theme.page.w - PAD[theme.id].x * 2;
  const colW = (contentW - gap * (cols - 1)) / cols;

  // 첫 장은 이름·약력이 자리를 먹는다
  const headBlock = 16 + 14 + (isSerif ? 40 : 38) + 30;
  const bioH = bio ? Math.ceil((bio.length * 8.5) / Math.max(twoCol ? 900 : contentW, 200)) * 27 + 16 : 0;
  const firstColH = availH(theme) - headBlock - bioH;
  const contColH = availH(theme) - (16 + 14 + 30 + 26);

  const laid = sections.length === 0 ? [] : splitCvColumns(sections, contColH, colW, cols, firstColH);

  const blockHtml = (b: CvChunk) => `
    <div style="margin-bottom:${CV_SEC_GAP}px">
      <div style="display:flex;align-items:baseline;gap:10px;border-bottom:1px solid ${theme.line};padding-bottom:7px">
        <span style="font-size:${isSerif ? 16 : 15}px;font-weight:${isSerif ? 400 : 800};font-family:${isSerif ? theme.display : SANS}">${esc(b.label)}${b.cont ? ' <span style="font-size:11px;font-weight:400;color:' + theme.sub + '">(계속)</span>' : ''}</span>
        <span style="font-size:10px;letter-spacing:0.22em;color:${theme.sub}">${esc(b.en)}</span>
      </div>
      <div style="margin-top:9px">
        ${b.entries.map((e) => `<div style="font-size:13px;line-height:1.75;color:#3a3a3a">${esc(e)}</div>`).join('')}
      </div>
    </div>`;

  return laid.map((cols2, pi) => ({
    label: pi === 0 ? 'CV' : `CV (${pi + 1})`,
    html: page(theme, data, `
      <div style="font-size:12px;letter-spacing:0.34em;color:${theme.accent};font-weight:700">CURRICULUM VITAE${pi > 0 ? ' (계속)' : ''}</div>
      ${pi === 0
        ? `<div style="margin-top:14px;font-size:${isSerif ? 34 : 32}px;font-weight:${isSerif ? 400 : 800};font-family:${isSerif ? theme.display : SANS}">${esc(displayName(data.user))}</div>
           ${bio ? `<div style="margin-top:16px;font-size:14px;line-height:1.9;color:#4a4a4a;max-width:${twoCol ? '900px' : '100%'};word-break:keep-all">${esc(bio).replace(/\n/g, '<br/>')}</div>` : ''}`
        : `<div style="margin-top:14px;font-size:18px;font-weight:${isSerif ? 400 : 700};font-family:${isSerif ? theme.display : SANS};color:${theme.sub}">${esc(displayName(data.user))}</div>`}
      <div style="margin-top:30px;display:flex;gap:${gap}px;align-items:flex-start">
        ${Array.from({ length: cols }, (_, ci) =>
          `<div style="flex:1;min-width:0">${(cols2[ci] ?? []).map(blockHtml).join('')}</div>`).join('')}
      </div>`),
  }));
}

// ── 연락처 (마지막 장) ──
function contactHtml(theme: PortfolioTheme, data: PortfolioBookData): string {
  const name = displayName(data.user);
  const isSerif = theme.display === SERIF;
  const rows = [
    ['E-mail', data.user.email],
    ['Phone', data.user.phone],
    ['Instagram', igLabel(data.user.instagramUrl)],
  ].filter(([, v]) => String(v ?? '').trim()) as [string, string][];

  return page(theme, data, `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      <div style="font-size:12px;letter-spacing:0.4em;color:${theme.accent};font-weight:700">CONTACT</div>
      <div style="margin-top:26px;font-size:${isSerif ? 52 : 46}px;font-weight:${isSerif ? 400 : 800};font-family:${isSerif ? theme.display : SANS};letter-spacing:${isSerif ? '0.06em' : '-0.02em'}">${esc(name)}</div>
      <div style="margin-top:30px;width:56px;height:3px;background:${theme.accent}"></div>
      <div style="margin-top:34px">
        ${rows.map(([k, v]) => `
          <div style="display:flex;gap:20px;justify-content:center;align-items:baseline;margin-bottom:12px">
            <span style="width:96px;text-align:right;font-size:11.5px;letter-spacing:0.2em;color:${theme.sub}">${esc(k.toUpperCase())}</span>
            <span style="font-size:17px;color:${theme.ink}">${esc(v)}</span>
          </div>`).join('')}
      </div>
      <div style="margin-top:52px;font-size:11.5px;letter-spacing:0.24em;color:${theme.sub}">MADE WITH ARTLINK · artlink.cc</div>
    </div>`);
  // ⚠️ bare를 쓰면 안 된다. bare는 패딩·flex 래퍼 없이 배경만 깐 껍데기라 안쪽의 `flex:1`이 먹지 않고
  //    내용이 위로 쏠린다(화이트 갤러리 마지막 장이 실제로 그랬다). 세로 중앙 정렬이 필요한 페이지는 일반 경로로.
}

/**
 * 포트폴리오 전체를 페이지 배열로 만든다 (순수 함수 — 미리보기와 PDF가 같은 결과를 쓴다).
 * 순서: 표지 → 작가노트 → [시리즈 소개 → 작품…]× → CV → 연락처
 */
export function buildPortfolioPages(
  data: PortfolioBookData,
  theme: PortfolioTheme,
  opts?: { forPdf?: boolean },
): PortfolioPage[] {
  imgMode = opts?.forPdf ? 'pdf' : 'display';
  const pages: PortfolioPage[] = [{ label: '표지', html: coverHtml(theme, data) }];

  const statement = String(data.statement ?? '').trim();
  if (statement) pages.push(...prosePages(theme, data, 'ARTIST STATEMENT', '작가노트', statement, '작가노트'));

  for (const g of groupBySeries(data.images, data.seriesInfo)) {
    if (g.name && g.note) pages.push(...prosePages(theme, data, 'SERIES', g.name, g.note, `${g.name} 소개`));
    // 같은 시리즈가 여러 장 이어지면 첫 장만 큰 제목, 이후는 축약형 (first)
    chunk(g.images, theme.worksPerPage).forEach((items, i) => {
      pages.push(...worksPages(theme, data, items, g.name || '작품', g.name || undefined, i === 0));
    });
  }


  const c = normalizeCareer(data.career);
  const hasCv = String(data.biography ?? '').trim() || CV_ORDER.some(({ key }) => (c[key] ?? []).length > 0);
  if (hasCv) pages.push(...cvPages(theme, data));

  pages.push({ label: '연락처', html: contactHtml(theme, data) });
  return pages;
}

/** PDF에 실릴 모든 이미지 주소 (prefetch 대상) */
export function bookImageUrls(data: PortfolioBookData): string[] {
  return data.images.map((i) => i.url).filter(Boolean);
}

export type BookPhase = 'images' | 'retry' | 'render';

/**
 * 페이지 HTML 배열 → PDF.
 * 페이지 하나를 판형 크기 그대로 렌더해 한 장에 꽉 채운다(여백은 각 페이지 HTML이 이미 갖고 있다).
 */
export async function renderPagesToPdf(
  pages: PortfolioPage[],
  theme: PortfolioTheme,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const { w, h, mmW, mmH } = theme.page;

  // 인쇄 품질 240dpi를 목표로 배율을 정한다(판형이 커질수록 배율은 낮아진다 — 파일이 무한정 커지지 않게).
  const scale = Math.max(1, Math.min(2.4, (mmW / 25.4) * 240 / w));

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;z-index:-1;background:#fff;`;
  document.body.appendChild(host);

  // 글꼴이 늦게 붙으면 폴백 글꼴로 렌더된 PDF가 나온다 — 표지 큰 글씨에서 바로 티가 난다.
  try { await document.fonts?.ready; } catch { /* 지원 안 하는 브라우저는 그대로 진행 */ }

  try {
    const pdf = new jsPDF({
      orientation: mmW > mmH ? 'l' : 'p',
      unit: 'mm',
      format: [Math.min(mmW, mmH), Math.max(mmW, mmH)],
    });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pages.length; i++) {
      host.innerHTML = pages[i].html;
      await waitPageImages(host);
      const canvas = await html2canvas(host, { scale, useCORS: true, backgroundColor: theme.bg, width: w, height: h });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pw, ph);
      // 큰 캔버스를 붙들고 있으면 30장 넘는 포트폴리오에서 메모리가 터진다
      canvas.width = 0; canvas.height = 0;
      onProgress?.(i + 1, pages.length);
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}

// 페이지 안 이미지가 다 뜰 때까지 대기 (decode까지 기다려야 캔버스에 빈 칸으로 찍히지 않는다)
function waitPageImages(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'));
  return Promise.all(
    imgs.map((im) =>
      im.complete && im.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((res) => {
            im.addEventListener('load', () => res(), { once: true });
            im.addEventListener('error', () => res(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

/**
 * 포맷 PDF 다운로드.
 * 반환값의 `missing`은 끝내 못 받은 이미지 주소 — 호출부가 "몇 장이 비었다"고 알려야 한다(조용한 빈 칸 금지).
 */
export async function downloadPortfolioBook(
  data: PortfolioBookData,
  themeId: PortfolioThemeId,
  onProgress?: (done: number, total: number, phase: BookPhase) => void,
): Promise<{ missing: string[]; pages: number }> {
  const theme = themeById(themeId);
  const urls = bookImageUrls(data);
  let failed = urls.length ? await prefetchImages(urls, (d, t) => onProgress?.(d, t, 'images')) : [];
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.(d, t, 'retry'));

  const pages = buildPortfolioPages(data, theme, { forPdf: true });
  const blob = await renderPagesToPdf(pages, theme, (d, t) => onProgress?.(d, t, 'render'));
  triggerDownload(blob, `${safeName(displayName(data.user))}_포트폴리오_${theme.name}.pdf`);
  return { missing: failed, pages: pages.length };
}
