/**
 * 작가 포트폴리오 PDF — 마이페이지(Artist)에서 본인 포트폴리오를 문서로 저장.
 *
 * 디자인: 에디토리얼 미니멀 (DESIGN.md 무드 — 흰 배경 + 포인트 레드 #c4302b + Pretendard).
 *  [헤더] ARTIST PORTFOLIO 아이브로우 + 큰 이름 + 연락처 라인 (+ 프로필 사진)
 *  [약력] [경력(아트페어/개인전/단체전)] [작품(2열 그리드)] [푸터: 생성일 · ArtLink]
 *
 * 페이지 분할은 operationPdf의 공용 엔진(htmlToPdfBlob) 사용:
 *  - 작품 이미지·경력 블록은 data-pdf-atomic → 페이지 경계에서 잘리지 않음
 *  - 섹션 제목은 data-pdf-keep-next → 제목만 페이지 끝에 남는 고아 방지
 *  - pageNumbers 옵션으로 하단 중앙 "n / total"
 */
import { displayName } from '@/lib/utils';
import { htmlToPdfBlob, esc, proxied, safeName, triggerDownload, BASE } from '@/lib/operationPdf';
import type { Career } from '@/types';

export interface PortfolioPdfData {
  user: {
    name: string;
    nickname?: string | null;
    email?: string | null;
    phone?: string | null;
    avatar?: string | null;
    instagramUrl?: string | null;
  };
  biography?: string | null;
  career?: Career | null;
  images?: { url: string }[] | null;
}

const RED = '#c4302b';

const CAREER_GROUPS: { key: keyof Career; label: string }[] = [
  { key: 'artFair', label: '아트페어' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
];

// instagram.com/handle 형태면 @handle로 축약, 아니면 원문 그대로
function instagramLabel(url?: string | null): string {
  if (!url) return '';
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  return m ? `@${m[1]}` : url;
}

// 섹션 제목 — 레드 바 + 자간 넓은 소제목 (keep-next로 다음 내용과 함께 페이지 이동)
const sectionTitle = (label: string) =>
  `<h2 data-pdf-keep-next style="font-size:13px;font-weight:800;letter-spacing:0.16em;color:#111;margin:0 0 12px;padding-left:10px;border-left:3px solid ${RED}">${esc(label)}</h2>`;

/** 포트폴리오 문서 HTML (순수 함수 — 단위 테스트/미리보기용) */
export function portfolioHtml(data: PortfolioPdfData): string {
  const name = displayName(data.user as any);
  const career: Career = {
    artFair: data.career?.artFair ?? [],
    solo: data.career?.solo ?? [],
    group: data.career?.group ?? [],
  };
  const careerEmpty = CAREER_GROUPS.every(({ key }) => career[key].length === 0);
  const images = (data.images ?? []).map((i) => i.url).filter(Boolean);
  const contacts = [data.user.email, data.user.phone, instagramLabel(data.user.instagramUrl)]
    .filter(Boolean)
    .map((c) => esc(c))
    .join('<span style="color:#ccc;margin:0 8px">·</span>');

  // 헤더 — 이름/연락처(+프로필). 문서 첫머리라 분할 걱정 없음
  const headerHtml = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid #111;padding-bottom:20px;margin-bottom:28px">
      <div style="min-width:0">
        <p style="font-size:11px;letter-spacing:0.32em;color:${RED};font-weight:700;margin:0 0 12px">ARTIST PORTFOLIO</p>
        <h1 style="font-size:34px;font-weight:800;margin:0;line-height:1.15;word-break:keep-all">${esc(name)}</h1>
        ${contacts ? `<p style="font-size:12px;color:#666;margin:10px 0 0">${contacts}</p>` : ''}
      </div>
      ${data.user.avatar ? `<img src="${esc(proxied(data.user.avatar))}" crossorigin="anonymous" style="width:68px;height:68px;border-radius:50%;object-fit:cover;flex:none;border:1px solid #eee"/>` : ''}
    </div>`;

  // 약력
  const bioHtml = `
    <div style="margin-bottom:28px">
      ${sectionTitle('약력')}
      <p style="white-space:pre-wrap;word-break:break-word;margin:0;line-height:1.8">${esc(data.biography) || '<span style="color:#999">등록된 약력이 없습니다.</span>'}</p>
    </div>`;

  // 경력 — 그룹 단위 원자 블록.
  // 작가마다 표기 방식이 자유로우므로 연도(year)를 강제하지 않는다: 연도가 있으면 회색으로 앞에 붙이고,
  // 없으면 내용만 왼쪽 정렬로 표시(빈 연도 자리로 어색하게 들여쓰기 되지 않게).
  const careerLine = (year?: string, content?: string) => {
    const y = String(year ?? '').trim();
    const c = String(content ?? '').trim();
    if (!y && !c) return '';
    return `<p style="margin:3px 0;font-size:13px">${y ? `<span style="color:#999;margin-right:12px">${esc(y)}</span>` : ''}${esc(c)}</p>`;
  };
  const careerHtml = careerEmpty ? '' : `
    <div style="margin-bottom:28px">
      ${sectionTitle('경력')}
      ${CAREER_GROUPS.map(({ key, label }) => career[key].length === 0 ? '' : `
        <div data-pdf-atomic style="margin-bottom:14px">
          <p style="font-size:11px;font-weight:700;color:#999;letter-spacing:0.08em;margin:0 0 5px">${esc(label)}</p>
          ${career[key].map((e) => careerLine(e.year, e.content)).join('')}
        </div>`).join('')}
    </div>`;

  // 작품 — 정사각 썸네일 그리드(object-cover), 각 이미지 원자 블록이라 페이지 경계에서 안 잘림.
  // data-pdf-break-before: '작품' 섹션은 무조건 경력 다음 '새 페이지'부터 시작한다.
  const worksHtml = images.length === 0 ? '' : `
    <div data-pdf-break-before style="margin-bottom:4px">
      ${sectionTitle(`작품 (${images.length})`)}
      <div style="display:flex;flex-wrap:wrap;gap:12px">
        ${images.map((u) => `<img data-pdf-atomic src="${esc(proxied(u))}" crossorigin="anonymous" style="width:360px;height:360px;object-fit:cover;border:1px solid #f0f0f0"/>`).join('')}
      </div>
    </div>`;

  return `<div style="${BASE}">${headerHtml}${bioHtml}${careerHtml}${worksHtml}</div>`;
}

/** 포트폴리오 PDF 다운로드 — 파일명: {작가명}_포트폴리오.pdf */
export async function downloadPortfolioPdf(data: PortfolioPdfData): Promise<void> {
  const blob = await htmlToPdfBlob(portfolioHtml(data), { pageNumbers: true });
  triggerDownload(blob, `${safeName(displayName(data.user as any))}_포트폴리오.pdf`);
}
