/**
 * 운영 페이지 — 작가 제출물 PDF/ZIP 일괄 생성 (클라이언트 사이드)
 *
 * 각 작가 × {출품리스트, 작가약력, 작가노트}를 HTML로 렌더 → html2canvas → jsPDF(A4) → JSZip.
 * 파일명: [공모명]_[작가명]_[문서종류].pdf, ZIP: [공모명]_전체제출물.zip
 * 무거운 라이브러리는 동적 import로 메인 번들에서 분리.
 */
import { displayName } from '@/lib/utils';
import type { OperationSubmission, ArtistCv, CvEntry, Settlement, SettlementArtist, Career, CustomField, CustomAnswer } from '@/types';

const won = (n: number) => `${(n || 0).toLocaleString('ko')}원`;

const CV_SECTIONS: { key: keyof Pick<ArtistCv, 'solo' | 'group' | 'artFair' | 'award'>; label: string }[] = [
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어 / 옥션' },
  { key: 'award', label: '수상 및 선정' },
];

export function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
// R2 등 외부(크로스오리진) 이미지는 동일출처 프록시 경유 → 캔버스/PDF taint 없이 렌더(CORS 불필요).
// 상대경로(로컬 /uploads·/images)는 이미 동일출처라 그대로 사용.
export function proxied(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/upload/image-proxy?url=${encodeURIComponent(url)}` : url;
}
// 파일명 안전화 (경로 구분자/제어문자 제거)
export function safeName(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim() || '무제';
}

export const BASE = `font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif;color:#111;font-size:13px;line-height:1.6;`;
const header = (exTitle: string, docLabel: string, artist: string, email?: string) => `
  <div style="margin-bottom:20px">
    <p style="font-size:12px;color:#888;margin:0">${esc(exTitle)}</p>
    <h1 style="font-size:22px;font-weight:700;margin:4px 0">${esc(docLabel)}</h1>
    <p style="font-size:13px;color:#444;margin:0">${esc(artist)}${email ? ` · ${esc(email)}` : ''}</p>
  </div>`;

function artworkHtml(sub: OperationSubmission, exTitle: string, artist: string, email?: string): string {
  const list = sub.artworkList || [];
  const rows = list.length === 0
    ? `<tr><td colspan="7" style="border:1px solid #ddd;padding:16px;text-align:center;color:#999">등록된 출품작이 없습니다.</td></tr>`
    : list.map((a, i) => `
      <tr data-pdf-atomic>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${a.image ? `<img src="${esc(proxied(a.image))}" crossorigin="anonymous" style="width:90px;height:90px;object-fit:cover"/>` : '<span style="color:#bbb;font-size:11px">-</span>'}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${esc(a.title)}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${esc(a.size)}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${esc(a.medium)}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${esc(a.year)}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${esc(a.price)}</td>
      </tr>`).join('');
  return `<div style="${BASE}">${header(exTitle, '출품리스트', artist, email)}
    <table style="width:100%;border-collapse:collapse">
      <thead><tr data-pdf-keep-next style="background:#f5f5f5">
        <th style="border:1px solid #ddd;padding:8px;width:30px">No</th>
        <th style="border:1px solid #ddd;padding:8px;width:110px">Image</th>
        <th style="border:1px solid #ddd;padding:8px">Title</th>
        <th style="border:1px solid #ddd;padding:8px;width:100px">Size</th>
        <th style="border:1px solid #ddd;padding:8px;width:130px">Medium</th>
        <th style="border:1px solid #ddd;padding:8px;width:50px">Year</th>
        <th style="border:1px solid #ddd;padding:8px;width:90px">Price</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function cvHtml(sub: OperationSubmission, exTitle: string, artist: string, email?: string): string {
  const cv = sub.cv;
  if (!cv) return `<div style="${BASE}">${header(exTitle, '작가약력', artist, email)}<p style="color:#999">등록된 약력이 없습니다.</p></div>`;
  const section = (label: string, items: CvEntry[]) => items.length === 0 ? '' : `
    <div style="margin-bottom:16px">
      <h2 data-pdf-keep-next style="font-size:14px;font-weight:700;color:#1a1a2e;margin:0 0 6px">${esc(label)}</h2>
      ${items.map(e => `<p style="margin:2px 0">${esc(e.year)} ${esc(e.content)}</p>`).join('')}
    </div>`;
  return `<div style="${BASE}">${header(exTitle, '작가약력', artist, email)}
    <div style="margin-bottom:20px">
      <p style="font-size:16px;font-weight:700;margin:0">${esc(cv.nameKo) || esc(artist)}</p>
      ${cv.tel ? `<p style="margin:2px 0">Tel  ${esc(cv.tel)}</p>` : ''}
      ${cv.email ? `<p style="margin:2px 0">email  ${esc(cv.email)}</p>` : ''}
    </div>
    ${CV_SECTIONS.map(({ key, label }) => section(label, cv[key])).join('')}
  </div>`;
}

function noteHtml(sub: OperationSubmission, exTitle: string, artist: string, email?: string): string {
  const note = sub.note;
  if (!note || (!note.statement && !(note.sections?.length))) return `<div style="${BASE}">${header(exTitle, '작가노트', artist, email)}<p style="color:#999">등록된 작가노트가 없습니다.</p></div>`;
  return `<div style="${BASE}">${header(exTitle, '작가노트', artist, email)}
    <h2 style="text-align:center;font-size:18px;font-weight:700;margin:0 0 4px">작가노트</h2>
    <p style="text-align:right;color:#666;margin:0 0 20px">${esc(artist)}</p>
    ${note.statement ? `<p style="white-space:pre-wrap;margin:0 0 20px">${esc(note.statement)}</p>` : ''}
    ${(note.sections || []).map(s => `
      <div style="margin-bottom:18px">
        ${s.title ? `<h3 data-pdf-keep-next style="font-size:15px;font-weight:700;background:#fdf3c4;display:inline-block;padding:2px 6px;margin:0 0 8px">${esc(s.title)}</h3>` : ''}
        <p style="white-space:pre-wrap;margin:0">${esc(s.body)}</p>
      </div>`).join('')}
  </div>`;
}

// 호스트 내부 이미지 로드 대기
function waitImages(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return new Promise(resolve => {
    let done = 0;
    const check = () => { done += 1; if (done >= imgs.length) resolve(); };
    imgs.forEach(im => {
      if (im.complete) check();
      else { im.addEventListener('load', check); im.addEventListener('error', check); }
    });
    setTimeout(resolve, 8000); // 안전장치
  });
}

/**
 * 페이지 컷 위치(CSS px) 계산 — 순수 함수라 단위 테스트 가능.
 * - 각 페이지 높이 ≤ pageHcss (내용 유실 없음)
 * - 컷 지점을 가로지르는 원자 블록(atomic)이 있으면 그 블록 top으로 컷을 당겨 블록을 통째로 다음 페이지로.
 *   (블록이 페이지보다 크거나 페이지 시작 지점부터 걸쳐 있으면 불가피하게 분할)
 * - blockTop 바로 위에 여백(직전 블록 bottom과의 간격)이 있으면, 렌더링 라운딩으로 인한 얇은 잘림(sliver)을
 *   막기 위해 컷을 그 여백 안쪽으로 최대 `guardPx`만큼 올린다(여백이 없는 표 행 등은 그대로 경계에서 컷).
 * - forcedBreaks: 반드시 새 페이지에서 시작해야 하는 위치(CSS px). 해당 지점에서 무조건 페이지를 끊는다
 *   (내용이 한 페이지에 다 들어가더라도). 예: 포트폴리오 '작품' 섹션을 경력 다음 페이지부터 시작.
 * 반환: [0, cut1, cut2, ..., totalCss] — 인접 쌍이 한 페이지 구간.
 */
export function computePageCuts(
  atomics: { top: number; bottom: number }[],
  totalCss: number,
  pageHcss: number,
  guardPx = 0,
  forcedBreaks: number[] = [],
): number[] {
  const forced = forcedBreaks.filter((b) => b > 0.5 && b < totalCss - 0.5).sort((a, b) => a - b);
  const cuts: number[] = [0];
  let start = 0;
  let iter = 0;
  while (iter++ < 4000) {
    let limit = start + pageHcss;
    // 이번 페이지 범위 안에 강제 나눔이 있으면 거기서 끊는다(한 페이지에 다 들어가도 강제로 다음 페이지).
    // 이미 guard만큼 당겨 페이지가 강제 나눔 바로 위에서 시작했다면(= start가 그 지점 근처) 소진된 것으로 보고 건너뛴다.
    const nextForced = forced.find((b) => b > start + guardPx + 1);
    const forcedHere = nextForced !== undefined && nextForced <= limit;
    if (forcedHere) limit = nextForced!;
    // 남은 내용이 이번 페이지에 다 들어가고 더 강제 나눔도 없으면 종료.
    if (limit >= totalCss - 0.5) break;
    let cut = limit;
    if (!forcedHere) {
      // 자연 분할: 컷을 가로지르는 원자 블록이 있으면 그 블록 top으로 당김(블록 통째로 다음 페이지).
      const straddleTops = atomics
        .filter((b) => b.top > start && b.top < cut && b.bottom > cut)
        .map((b) => b.top);
      if (straddleTops.length) cut = Math.min(...straddleTops);
    }
    // guard(강제/자연 공통): 컷이 원자 블록 top(=이미지 상단)에 정확히 맞으면 렌더링 라운딩으로 윗줄이
    // 이전 페이지에 얇게 남는다. 컷 위 여백(직전 블록 bottom과의 간격) 안쪽으로 최대 guardPx만큼 당겨 방지.
    {
      const aboveBottom = atomics.reduce((m, b) => (b.bottom <= cut && b.bottom > m ? b.bottom : m), start);
      const gap = cut - aboveBottom;
      const g = gap > 1 ? Math.min(guardPx, gap - 1) : 0; // 여백이 있을 때만, 여백 안쪽으로만
      cut = cut - g;
    }
    if (cut <= start) break; // 진행 보장(무한루프 방지)
    cuts.push(cut);
    start = cut;
  }
  cuts.push(totalCss);
  return cuts;
}

// HTML → A4 PDF Blob
// - 페이지가 넘어갈 때 이미지/표행/카드 등 "자르면 안 되는" 블록(data-pdf-atomic)이 경계에서 잘리지 않도록,
//   297mm 고정 간격이 아니라 블록 경계에 맞춰 페이지를 분할한다.
// - data-pdf-keep-next: 섹션 제목 등 "다음 내용과 함께 넘어가야 하는" 요소 — 아래 일부(56px)까지 원자 범위로
//   취급해 제목만 페이지 맨 아래 남는 고아(orphan)를 방지.
// - 4면 여백(MARGIN)을 PDF 배치 단계에서 "모든 페이지"에 일괄 적용 → 2페이지 이후에도 상/하단 여백 유지.
export async function htmlToPdfBlob(html: string, opts?: { pageNumbers?: boolean }): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const host = document.createElement('div');
  // 여백은 PDF 배치에서 4면 일괄 적용하므로 host에는 패딩을 주지 않는다(콘텐츠 폭만 지정).
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:760px;background:#fff;z-index:-1;';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await waitImages(host);

    // 원자 블록(이미지 행·첨부사진·카드 등)의 세로 범위(host 기준 CSS px) 수집.
    const hostTop = host.getBoundingClientRect().top;
    const rectOf = (el: HTMLElement, padBottom = 0) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - hostTop, bottom: r.bottom - hostTop + padBottom };
    };
    const atomics = [
      ...(Array.from(host.querySelectorAll('[data-pdf-atomic]')) as HTMLElement[]).map((el) => rectOf(el)),
      // 제목류: 아래 56px까지 묶어 "제목+내용 첫 줄"이 함께 다음 페이지로
      ...(Array.from(host.querySelectorAll('[data-pdf-keep-next]')) as HTMLElement[]).map((el) => rectOf(el, 56)),
    ].filter((b) => b.bottom > b.top);

    // 반드시 새 페이지에서 시작할 위치(요소 top) — 예: 포트폴리오 '작품' 섹션
    const forcedBreaks = (Array.from(host.querySelectorAll('[data-pdf-break-before]')) as HTMLElement[])
      .map((el) => el.getBoundingClientRect().top - hostTop);

    const canvas = await html2canvas(host, { scale: 2, useCORS: true, backgroundColor: '#fff' });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = 210, pageH = 297;
    // 4면 여백(mm). 페이지 번호를 찍을 땐 하단 여백을 조금 더 확보.
    const marginX = 14, marginTop = 14, marginBottom = opts?.pageNumbers ? 16 : 14;
    const contentWmm = pageW - marginX * 2;             // 본문 폭(mm)
    const contentHmm = pageH - marginTop - marginBottom; // 본문 높이(mm)
    const hostW = host.offsetWidth;                      // CSS px (콘텐츠 폭 = contentWmm에 대응)
    const ratio = canvas.width / hostW;                  // canvas px per CSS px
    const totalCss = canvas.height / ratio;              // 전체 문서 높이(CSS px)
    const pageHcss = hostW * contentHmm / contentWmm;    // 한 페이지 본문에 담기는 높이(CSS px)

    // 페이지 경계 계산 (순수 함수) — 각 페이지 ≤ pageHcss, 원자 블록은 통째로 다음 페이지로.
    // guard 6px: 위에 여백이 있는 블록(이미지 그리드·카드)은 여백 안쪽으로 컷을 올려 얇은 잘림 방지.
    const cuts = computePageCuts(atomics, totalCss, pageHcss, 6, forcedBreaks);

    // 컷 위치를 정수 캔버스 행으로 변환 → 페이지끼리 정확히 맞닿게 타일링(갭/겹침 없음).
    const rows = cuts.map((c) => Math.round(c * ratio));
    const slice = document.createElement('canvas');
    const sctx = slice.getContext('2d');
    let pageNo = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const sy = rows[i], sh = rows[i + 1] - sy;
      if (sh <= 0) continue;
      slice.width = canvas.width;
      slice.height = sh;
      if (sctx) {
        sctx.fillStyle = '#fff';
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
      }
      const imgHmm = (sh / ratio) * contentWmm / hostW; // mm (≤ contentHmm)
      if (pageNo > 0) pdf.addPage();
      pageNo += 1;
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', marginX, marginTop, contentWmm, imgHmm);
    }
    // 페이지 번호(하단 중앙) — 여러 장일 때만
    if (opts?.pageNumbers) {
      const total = pdf.getNumberOfPages();
      if (total > 1) {
        for (let p = 1; p <= total; p++) {
          pdf.setPage(p);
          pdf.setFontSize(9);
          pdf.setTextColor(160);
          pdf.text(`${p} / ${total}`, pageW / 2, pageH - 6, { align: 'center' });
        }
      }
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}

// ── 정산서 ──
// 결제수단(카드/현금)으로 필터해 합계를 재계산한 정산 객체 반환
function filterArtistByMethod(a: SettlementArtist, method: 'CARD' | 'CASH'): SettlementArtist {
  const works = a.works.filter(w => w.sold && (w.paymentMethod || 'CARD') === method);
  const total = works.reduce((s, w) => s + (w.soldPrice || 0), 0);
  const galleryAmount = Math.round(total * a.galleryRatio / 100);
  return { ...a, works, total, galleryAmount, artistAmount: total - galleryAmount };
}
function filterSettlementByMethod(s: Settlement, method: 'CARD' | 'CASH'): Settlement {
  const artists = s.artists.map(a => filterArtistByMethod(a, method));
  return {
    ...s,
    artists,
    grand: {
      total: artists.reduce((sum, a) => sum + a.total, 0),
      galleryAmount: artists.reduce((sum, a) => sum + a.galleryAmount, 0),
      artistAmount: artists.reduce((sum, a) => sum + a.artistAmount, 0),
      soldCount: artists.reduce((sum, a) => sum + a.works.length, 0),
    },
  };
}
const methodLabel = (m?: 'CARD' | 'CASH') => m === 'CASH' ? '현금' : m === 'CARD' ? '카드' : '';

function artistSettlementHtml(exTitle: string, a: SettlementArtist, docLabel = '정산서'): string {
  const artist = displayName(a.user);
  const sold = a.works.filter(w => w.sold);
  const rows = sold.length === 0
    ? `<tr><td colspan="3" style="border:1px solid #ddd;padding:10px;text-align:center;color:#999">판매된 작품이 없습니다.</td></tr>`
    : sold.map(w => `<tr data-pdf-atomic>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;width:90px">${w.image ? `<img src="${esc(proxied(w.image))}" crossorigin="anonymous" style="width:70px;height:70px;object-fit:cover"/>` : '<span style="color:#bbb;font-size:11px">-</span>'}</td>
        <td style="border:1px solid #ddd;padding:8px">${esc(w.title || '(제목 없음)')}${[w.size, w.medium, w.year].filter(Boolean).length ? `<br/><span style="color:#888;font-size:11px">${esc([w.size, w.medium, w.year].filter(Boolean).join(' · '))}</span>` : ''}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right">${won(w.soldPrice)}<br/><span style="font-size:10px;color:#999">${w.paymentMethod === 'CASH' ? '현금' : '카드'}</span></td>
      </tr>`).join('');
  return `<div style="${BASE}">${header(exTitle, docLabel, artist, a.user.email)}
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr data-pdf-keep-next style="background:#f5f5f5">
        <th style="border:1px solid #ddd;padding:8px">이미지</th>
        <th style="border:1px solid #ddd;padding:8px;text-align:left">판매 작품</th>
        <th style="border:1px solid #ddd;padding:8px;text-align:right;width:130px">판매가</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse">
      <tbody>
        <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa;width:160px">판매 합계</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${won(a.total)}</td></tr>
        <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa">정산 비율 (갤러리 : 작가)</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${a.galleryRatio}% : ${a.artistRatio}%</td></tr>
        <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa">갤러리 정산</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${won(a.galleryAmount)}</td></tr>
        <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa;font-weight:700">작가 정산 (지급액)</td><td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:700">${won(a.artistAmount)}</td></tr>
      </tbody>
    </table></div>`;
}

// 작가 1명의 판매작 내역 표 (이미지+제목+판매가) + 소계
function artistBlock(a: SettlementArtist): string {
  const sold = a.works.filter(w => w.sold);
  const rows = sold.length === 0
    ? `<tr><td colspan="3" style="border:1px solid #eee;padding:8px;text-align:center;color:#999">판매된 작품 없음</td></tr>`
    : sold.map(w => `<tr data-pdf-atomic>
        <td style="border:1px solid #eee;padding:6px;text-align:center;width:80px">${w.image ? `<img src="${esc(proxied(w.image))}" crossorigin="anonymous" style="width:60px;height:60px;object-fit:cover"/>` : '<span style="color:#bbb;font-size:11px">-</span>'}</td>
        <td style="border:1px solid #eee;padding:6px">${esc(w.title || '(제목 없음)')}${[w.size, w.medium, w.year].filter(Boolean).length ? `<br/><span style="color:#888;font-size:11px">${esc([w.size, w.medium, w.year].filter(Boolean).join(' · '))}</span>` : ''}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:right;width:120px">${won(w.soldPrice)}<br/><span style="font-size:10px;color:#999">${w.paymentMethod === 'CASH' ? '현금' : '카드'}</span></td>
      </tr>`).join('');
  return `<div style="margin-bottom:22px">
    <h2 data-pdf-keep-next style="font-size:15px;font-weight:700;margin:0 0 6px">${esc(displayName(a.user))} <span style="font-weight:400;color:#888;font-size:12px">(갤러리 ${a.galleryRatio}% : 작가 ${a.artistRatio}%)</span></h2>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr data-pdf-keep-next style="background:#f7f7f7">
        <th style="border:1px solid #eee;padding:6px">이미지</th>
        <th style="border:1px solid #eee;padding:6px;text-align:left">판매 작품</th>
        <th style="border:1px solid #eee;padding:6px;text-align:right">판매가</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:right;margin-top:4px;font-size:12px;color:#444">
      판매 합계 <b>${won(a.total)}</b> &nbsp;·&nbsp; 갤러리 <b>${won(a.galleryAmount)}</b> &nbsp;·&nbsp; 작가 <b>${won(a.artistAmount)}</b>
    </div>
  </div>`;
}

function overallSettlementHtml(s: Settlement, docLabel = '전체 정산서'): string {
  const blocks = s.artists.length === 0
    ? `<p style="color:#999">수락된 작가가 없습니다.</p>`
    : s.artists.map(artistBlock).join('');
  return `<div style="${BASE}">${header(s.exhibitionTitle, docLabel, '', '')}
    ${blocks}
    <div style="border-top:2px solid #333;padding-top:10px;margin-top:6px">
      <h2 style="font-size:15px;font-weight:700;margin:0 0 6px">전체 합계</h2>
      <table style="width:100%;border-collapse:collapse">
        <tbody>
          <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa;width:180px">판매 작품 수</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${s.grand.soldCount}점</td></tr>
          <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa">판매 합계</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${won(s.grand.total)}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa">갤러리 정산 합계</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${won(s.grand.galleryAmount)}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:8px;background:#fafafa;font-weight:700">작가 지급 합계</td><td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:700">${won(s.grand.artistAmount)}</td></tr>
        </tbody>
      </table>
    </div></div>`;
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 작가별 정산서 PDF (method 지정 시 현금/카드 정산서) */
export async function downloadArtistSettlementPdf(exTitle: string, artist: SettlementArtist, method?: 'CARD' | 'CASH'): Promise<void> {
  const target = method ? filterArtistByMethod(artist, method) : artist;
  const docLabel = method ? `${methodLabel(method)} 정산서` : '정산서';
  const blob = await htmlToPdfBlob(artistSettlementHtml(exTitle, target, docLabel));
  triggerDownload(blob, `${safeName(exTitle)}_${safeName(displayName(artist.user))}_${docLabel.replace(/\s/g, '')}.pdf`);
}

/** 전체 정산서 PDF (method 지정 시 현금/카드 정산서) */
export async function downloadOverallSettlementPdf(s: Settlement, method?: 'CARD' | 'CASH'): Promise<void> {
  const target = method ? filterSettlementByMethod(s, method) : s;
  const docLabel = method ? `${methodLabel(method)} 정산서` : '전체 정산서';
  const blob = await htmlToPdfBlob(overallSettlementHtml(target, docLabel));
  triggerDownload(blob, `${safeName(s.exhibitionTitle)}_${docLabel.replace(/\s/g, '')}.pdf`);
}

export interface SubmissionRow { user: { id: number; name: string; nickname?: string | null; email?: string }; submission: OperationSubmission; }

// ── 캡션 시트 (작품 네임택) ──
// hwp 양식: 한 칸 = 한 작품, [제목 / 크기 / 재료 / 제작년도 + 가격]. 작가명 미표기.
function captionCell(a: { title?: string; size?: string; medium?: string; year?: string; price?: string }): string {
  const yearPrice = `<div style="display:flex;justify-content:space-between;margin-top:2px">
      <span>${esc(a.year)}</span><span>${esc(a.price)}</span></div>`;
  return `<div data-pdf-atomic style="border:1px solid #333;box-sizing:border-box;width:330px;min-height:96px;padding:14px 16px;margin:0 8px 12px 0;page-break-inside:avoid">
    <p style="font-weight:700;font-size:15px;margin:0 0 8px">${esc(a.title) || '<span style="color:#bbb">(제목 없음)</span>'}</p>
    <p style="margin:1px 0;font-size:12px;color:#333">${esc(a.size)}</p>
    <p style="margin:1px 0;font-size:12px;color:#333">${esc(a.medium)}</p>
    <div style="font-size:12px;color:#333">${yearPrice}</div>
  </div>`;
}

/** 전체 출품작 캡션 시트 PDF (작가명 미표기, 한 칸 = 한 작품) */
export async function downloadCaptionSheetPdf(exTitle: string, rows: SubmissionRow[]): Promise<void> {
  const works: { title?: string; size?: string; medium?: string; year?: string; price?: string }[] = [];
  for (const { submission } of rows) {
    for (const a of (submission.artworkList || [])) works.push(a);
  }
  const cells = works.length === 0
    ? `<p style="color:#999">등록된 출품작이 없습니다.</p>`
    : works.map(captionCell).join('');
  const html = `<div style="${BASE}">
    <div style="margin-bottom:16px">
      <p style="font-size:12px;color:#888;margin:0">${esc(exTitle)}</p>
      <h1 style="font-size:20px;font-weight:700;margin:4px 0">작품 캡션 (${works.length})</h1>
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:flex-start">${cells}</div>
  </div>`;
  const blob = await htmlToPdfBlob(html);
  triggerDownload(blob, `${safeName(exTitle)}_작품캡션.pdf`);
}

// ── 작품 원본 이미지 일괄 다운로드 (jpg 통일) ──
// 이미지 URL → 캔버스 → jpeg Blob (png/webp 등도 jpg로 변환). CORS 불가 시 null.
function imageToJpegBlob(url: string): Promise<Blob | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1;
        canvas.height = img.naturalHeight || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.95);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = proxied(url);
  });
}

/** 전체 출품작 원본 이미지를 jpg로 변환해 ZIP 다운로드.
 *  파일명: 작가명_작품제목_작품크기_재료_제작년도_가격.jpg (동일명은 _2,_3 부여) */
export async function downloadAllArtworkImagesZip(exTitle: string, rows: SubmissionRow[]): Promise<{ ok: number; fail: number }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  let ok = 0, fail = 0;
  for (const { user, submission } of rows) {
    const artist = displayName(user);
    for (const a of (submission.artworkList || [])) {
      if (!a.image) continue;
      const blob = await imageToJpegBlob(a.image);
      if (!blob) { fail += 1; continue; }
      const parts = [artist, a.title, a.size, a.medium, a.year, a.price]
        .map(p => safeName(String(p ?? '')).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      let base = parts.join('_') || '작품';
      let name = `${base}.jpg`;
      let n = 2;
      while (used.has(name)) { name = `${base}_${n}.jpg`; n += 1; }
      used.add(name);
      zip.file(name, blob);
      ok += 1;
    }
  }
  if (ok > 0) {
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `${safeName(exTitle)}_작품원본.zip`);
  }
  return { ok, fail };
}

/** 전 작가 × 3문서 PDF를 ZIP으로 묶어 다운로드 */
export async function downloadAllSubmissionsZip(exTitle: string, rows: SubmissionRow[]): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const exSafe = safeName(exTitle);
  for (const { user, submission } of rows) {
    const artist = displayName(user);
    const aSafe = safeName(artist);
    const email = user.email;
    zip.file(`${exSafe}_${aSafe}_출품리스트.pdf`, await htmlToPdfBlob(artworkHtml(submission, exTitle, artist, email)));
    zip.file(`${exSafe}_${aSafe}_작가약력.pdf`, await htmlToPdfBlob(cvHtml(submission, exTitle, artist, email)));
    zip.file(`${exSafe}_${aSafe}_작가노트.pdf`, await htmlToPdfBlob(noteHtml(submission, exTitle, artist, email)));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exSafe}_전체제출물.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 지원서 (지원자 관리 페이지) ──
// 닉네임/전화/이메일 + 작가약력 + 경력 + 작품사진 + 포트폴리오 파일을 한 PDF로.
export interface ApplicantLike {
  user: { id?: number; name: string; nickname?: string | null; email?: string | null; phone?: string | null };
  biography?: string | null;
  career?: Career | null;
  artworkImages?: string[] | null;
  portfolioFileUrl?: string | null;
  customAnswers?: CustomAnswer[] | null;
  status?: string;
  createdAt?: string;
}

const APP_CAREER_SECTIONS: { key: keyof Career; label: string }[] = [
  { key: 'artFair', label: '아트페어' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
];

// export: 지원서 PDF의 HTML 빌더 (순수 함수) — 단위 테스트/미리보기용
export function applicationHtml(exTitle: string, app: ApplicantLike, customFields?: CustomField[] | null): string {
  const artist = displayName(app.user as any);
  const career: Career = { artFair: app.career?.artFair ?? [], solo: app.career?.solo ?? [], group: app.career?.group ?? [] };
  const careerEmpty = career.artFair.length === 0 && career.solo.length === 0 && career.group.length === 0;
  const images = (app.artworkImages || []).filter(Boolean);
  const appliedAt = app.createdAt ? new Date(app.createdAt).toLocaleDateString('ko') : '';

  // 갤러리 추가 질문(커스텀 필드) 답변 — 화면(ApplicationContent)과 동일 로직:
  // 필드 라벨+답변(다중선택은 콤마 조인), 질문 삭제/재생성으로 현재 필드에 없는 답변은 "삭제된 질문"으로 보존.
  // customAnswers는 (구) 하위호환 컬럼이라 배열이 아닌 레거시 데이터가 있을 수 있어 방어적으로 배열만 사용.
  const safeAnswers = Array.isArray(app.customAnswers) ? app.customAnswers : [];
  const answerMap = new Map(safeAnswers.map(a => [a.fieldId, a.value] as const));
  const fmtAnswer = (v?: string | string[]) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : (v ?? ''));
  const currentFieldIds = new Set((customFields ?? []).map(f => f.id));
  const orphanAnswers = safeAnswers.filter(a => !currentFieldIds.has(a.fieldId));
  // 질문 카드 하나 = 원자 블록 (페이지 경계에서 카드가 반으로 잘리지 않게)
  const qaRow = (label: string, value: string, muted = false) => `
    <div data-pdf-atomic style="border:1px solid #eee;border-radius:6px;padding:8px 10px;margin-bottom:6px">
      <p style="font-size:12px;font-weight:700;color:${muted ? '#999' : '#555'};margin:0 0 2px">${esc(label)}</p>
      <p style="white-space:pre-wrap;word-break:break-word;margin:0">${esc(value) || '<span style="color:#999">-</span>'}</p>
    </div>`;
  const customHtml = ((customFields?.length ?? 0) > 0 || orphanAnswers.length > 0)
    ? `<div style="margin-bottom:18px">
        <h2 data-pdf-keep-next style="font-size:15px;font-weight:700;color:#1a1a2e;margin:0 0 8px">갤러리 추가 질문</h2>
        ${(customFields ?? []).map(f => qaRow(f.label, fmtAnswer(answerMap.get(f.id)))).join('')}
        ${orphanAnswers.map(a => qaRow('삭제된 질문', fmtAnswer(a.value), true)).join('')}
      </div>`
    : '';

  const contactRows = `
    <table data-pdf-atomic style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tbody>
        <tr><td style="border:1px solid #ddd;padding:8px 10px;background:#f7f7f7;width:90px;font-weight:700">닉네임</td><td style="border:1px solid #ddd;padding:8px 10px">${esc(app.user.nickname || app.user.name)}</td></tr>
        <tr><td style="border:1px solid #ddd;padding:8px 10px;background:#f7f7f7;font-weight:700">전화번호</td><td style="border:1px solid #ddd;padding:8px 10px">${esc(app.user.phone || '-')}</td></tr>
        <tr><td style="border:1px solid #ddd;padding:8px 10px;background:#f7f7f7;font-weight:700">이메일</td><td style="border:1px solid #ddd;padding:8px 10px">${esc(app.user.email || '-')}</td></tr>
        <tr><td style="border:1px solid #ddd;padding:8px 10px;background:#f7f7f7;font-weight:700">지원일</td><td style="border:1px solid #ddd;padding:8px 10px">${esc(appliedAt)}</td></tr>
      </tbody>
    </table>`;

  const careerHtml = careerEmpty
    ? `<p style="color:#999;margin:0 0 16px">등록된 경력이 없습니다.</p>`
    : APP_CAREER_SECTIONS.map(({ key, label }) => career[key].length === 0 ? '' : `
        <div data-pdf-atomic style="margin-bottom:12px">
          <h3 style="font-size:13px;font-weight:700;color:#1a1a2e;margin:0 0 4px">${esc(label)}</h3>
          ${career[key].map(e => `<p style="margin:2px 0">${esc([e.year, e.content].filter(Boolean).join(' '))}</p>`).join('')}
        </div>`).join('');

  const imagesHtml = images.length === 0
    ? `<p style="color:#999;margin:0">첨부된 작품 사진이 없습니다.</p>`
    : `<div style="display:flex;flex-wrap:wrap;gap:8px">${images.map(u => `<img data-pdf-atomic src="${esc(proxied(u))}" crossorigin="anonymous" style="width:170px;height:170px;object-fit:cover;border:1px solid #eee"/>`).join('')}</div>`;

  return `<div style="${BASE}">
    ${header(exTitle, '지원서', artist)}
    ${contactRows}
    <div style="margin-bottom:18px">
      <h2 data-pdf-keep-next style="font-size:15px;font-weight:700;color:#1a1a2e;margin:0 0 6px">작가 약력</h2>
      <p style="white-space:pre-wrap;margin:0">${esc(app.biography) || '<span style="color:#999">등록된 약력이 없습니다.</span>'}</p>
    </div>
    <div style="margin-bottom:18px">
      <h2 data-pdf-keep-next style="font-size:15px;font-weight:700;color:#1a1a2e;margin:0 0 6px">경력</h2>
      ${careerHtml}
    </div>
    <div style="margin-bottom:18px">
      <h2 data-pdf-keep-next style="font-size:15px;font-weight:700;color:#1a1a2e;margin:0 0 8px">작품 사진 (${images.length})</h2>
      ${imagesHtml}
    </div>
    ${app.portfolioFileUrl ? `<div data-pdf-atomic style="margin-bottom:18px"><h2 style="font-size:15px;font-weight:700;color:#1a1a2e;margin:0 0 6px">포트폴리오 파일</h2><p style="margin:0;word-break:break-all;color:#444">${esc(app.portfolioFileUrl)}</p></div>` : ''}
    ${customHtml}
  </div>`;
}

/** 지원자 1명의 지원서 PDF — 파일명: 공모명_작가명_지원서.pdf */
export async function downloadApplicationPdf(exTitle: string, app: ApplicantLike, customFields?: CustomField[] | null): Promise<void> {
  const blob = await htmlToPdfBlob(applicationHtml(exTitle, app, customFields));
  triggerDownload(blob, `${safeName(exTitle)}_${safeName(displayName(app.user as any))}_지원서.pdf`);
}

/** 전체 지원자 지원서 PDF를 ZIP으로 묶어 다운로드 — 파일명: 공모명_지원서.zip */
export async function downloadAllApplicationsZip(exTitle: string, apps: ApplicantLike[], customFields?: CustomField[] | null): Promise<number> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const exSafe = safeName(exTitle);
  const used = new Set<string>();
  let count = 0;
  for (const app of apps) {
    const aSafe = safeName(displayName(app.user as any));
    let name = `${exSafe}_${aSafe}_지원서.pdf`;
    let n = 2;
    while (used.has(name)) { name = `${exSafe}_${aSafe}_${n}_지원서.pdf`; n += 1; }
    used.add(name);
    zip.file(name, await htmlToPdfBlob(applicationHtml(exTitle, app, customFields)));
    count += 1;
  }
  if (count > 0) {
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `${exSafe}_지원서.zip`);
  }
  return count;
}
