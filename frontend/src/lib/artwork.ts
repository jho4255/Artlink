/**
 * 작품 캡션 · 시리즈 그룹핑 · 경력 정규화 — 포트폴리오 전반의 공용 순수 함수.
 *
 * 실제 작가 포트폴리오(레퍼런스 5종)는 예외 없이 작품마다
 *   [제목] / [재료] / [크기] / [제작연도]
 * 를 붙인다. 이 조합이 미술계 표준 캡션이고, 빠지면 갤러리 쪽에서 "정보가 없는 이미지 더미"로 읽힌다.
 * 다만 작가가 전부 채우리라는 보장이 없으므로 **있는 항목만 조립**한다 —
 * 빈 값을 그대로 이어붙이면 " / /  / 2025" 같은 흉한 캡션이 나온다.
 */
import type { Career, CareerEntry, FullCareer, PortfolioImage, SeriesInfo } from '@/types';

// ── 경력 ──
// 기존에는 MyPage/PortfolioPage/ExhibitionDetailPage/ApplicationContent 4곳에 같은 함수가 복붙돼 있었다.
// 항목(학력·수상)이 늘어나면서 한 곳만 고치면 나머지가 조용히 옛 형태로 남으므로 여기로 합친다.
export function normalizeCareer(c?: Career | null): FullCareer {
  return {
    artFair: c?.artFair ?? [],
    solo: c?.solo ?? [],
    group: c?.group ?? [],
    education: c?.education ?? [],
    award: c?.award ?? [],
  };
}

export function isCareerEmpty(c?: Career | null): boolean {
  const f = normalizeCareer(c);
  return (Object.values(f) as CareerEntry[][]).every((list) => list.length === 0);
}

/** 경력 한 줄 텍스트 — 연도가 없으면 내용만 (작가마다 표기 방식이 자유롭다) */
export function careerLineText(e: CareerEntry): string {
  return [String(e.year ?? '').trim(), String(e.content ?? '').trim()].filter(Boolean).join(' ');
}

// ── 작품 캡션 ──
const trimmed = (v?: string | null) => String(v ?? '').trim();

/** 판매 상태 표기. AVAILABLE은 일부러 표기하지 않는다(기본값이라 굳이 알릴 필요가 없다). */
export function statusLabel(img: Pick<PortfolioImage, 'status'>): string {
  if (img.status === 'SOLD') return 'Sold';
  if (img.status === 'NFS') return '비매';
  return '';
}

/**
 * 화면용 판매상태 배지 — **판매중까지 전부** 표기한다.
 *
 * `statusLabel` 과 따로 두는 이유: 그쪽은 포맷 PDF 가 쓴다. 작가가 갤러리에 내는 문서라
 * 작품마다 '판매중'이 찍히면 시끄럽고, 실제 작가 포트폴리오 관례도 Sold/NFS 만 적는다.
 * 반면 공개 포트폴리오는 갤러리가 보는 화면이라 "살 수 있는가"가 정보가 된다.
 *
 * tone: 'sold' 는 강조색, 'muted' 는 회색 — 대부분이 판매중일 텐데 다 강조하면 화면이 시끄러워진다.
 */
export function statusBadge(img: Pick<PortfolioImage, 'status'>): { label: string; tone: 'sold' | 'muted' } | null {
  if (img.status === 'SOLD') return { label: '판매완료', tone: 'sold' };
  if (img.status === 'NFS') return { label: '비매', tone: 'muted' };
  if (img.status === 'AVAILABLE') return { label: '판매중', tone: 'muted' };
  return null;   // 미입력
}

/** 제목 — 없으면 '무제' (캡션 자리를 비워두면 페이지 정렬이 흔들린다) */
export function artworkTitle(img: Pick<PortfolioImage, 'title'>): string {
  return trimmed(img.title) || '무제';
}

/**
 * 캡션 보조 줄 — [재료, 크기, 연도] 중 채워진 것만.
 * 세로로 쌓는 포맷(화이트 갤러리·스토리)이 쓴다.
 */
export function captionLines(img: Pick<PortfolioImage, 'medium' | 'sizeText' | 'year'>): string[] {
  return [trimmed(img.medium), trimmed(img.sizeText), trimmed(img.year)].filter(Boolean);
}

/**
 * 캡션 한 줄 — "72.7 × 90.9 cm / Acrylic on canvas / 2025".
 * 그리드 포맷(스튜디오·아카이브)이 쓴다. 순서는 크기 → 재료 → 연도(레퍼런스 관례).
 */
export function captionInline(img: Pick<PortfolioImage, 'medium' | 'sizeText' | 'year'>): string {
  return [trimmed(img.sizeText), trimmed(img.medium), trimmed(img.year)].filter(Boolean).join('  /  ');
}

/** 캡션 정보가 하나라도 있는지 — "정보 미입력" 안내 배지를 띄울지 판단 */
export function hasCaption(img: Pick<PortfolioImage, 'title' | 'medium' | 'sizeText' | 'year'>): boolean {
  return !!(trimmed(img.title) || trimmed(img.medium) || trimmed(img.sizeText) || trimmed(img.year));
}

// ── 크기 입력 ──
// 작가에게 "72.7 × 90.9 cm"를 통째로 치게 하면 표기가 제각각이 된다(x/×/X, cm 유무, 공백).
// 가로·세로 숫자만 받아 한 형식으로 합성하고, 저장은 합성된 문자열 하나로만 한다(캡션·PDF의 단일 출처).
export function splitSize(s?: string | null): { w: string; h: string } {
  const m = String(s || '').match(/([\d.]+)\s*[x×X*]\s*([\d.]+)/);
  return m ? { w: m[1]!, h: m[2]! } : { w: '', h: '' };
}
export function composeSize(w: string, h: string): string {
  const ws = (w || '').trim(), hs = (h || '').trim();
  if (!ws && !hs) return '';
  if (ws && hs) return `${ws}×${hs} cm`;
  return `${ws || hs} cm`;
}

// ── 시리즈 ──
export interface SeriesGroup {
  /** 시리즈명. 빈 문자열이면 '시리즈 미지정' 묶음 */
  name: string;
  note: string;
  images: PortfolioImage[];
}

/**
 * 작품을 시리즈별로 묶는다.
 * - 등장 순서를 유지(작가가 정렬한 순서가 곧 편집 의도다)
 * - 시리즈 미지정 묶음은 **맨 뒤**로 — 이름 있는 묶음 사이에 끼면 문서 구조가 흐트러진다
 */
export function groupBySeries(images: PortfolioImage[], seriesInfo?: SeriesInfo[] | null): SeriesGroup[] {
  const notes = new Map((seriesInfo ?? []).map((s) => [s.name, s.note]));
  const byName = new Map<string, PortfolioImage[]>();
  for (const img of images) {
    const key = trimmed(img.series);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(img);
  }
  const groups = [...byName.entries()].map(([name, imgs]) => ({
    name,
    note: trimmed(notes.get(name)),
    images: imgs,
  }));
  return [...groups.filter((g) => g.name), ...groups.filter((g) => !g.name)];
}

/** 포트폴리오에 등록된 시리즈명 목록 (중복 제거, 등장 순서) */
export function seriesNames(images: PortfolioImage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const img of images) {
    const s = trimmed(img.series);
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}
