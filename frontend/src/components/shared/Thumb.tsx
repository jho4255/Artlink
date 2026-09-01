import { useState } from 'react';

/**
 * 목록·그리드용 작은 이미지.
 *
 * ## 왜 필요한가
 * 목록이 **원본을 그대로** 받아 28×28px 자리에 그리고 있었다. 실측(2026-08-11):
 *   갤러리 운영 페이지 한 번 열 때 — 이미지 149건 · 평균 674KB · **합계 약 96MB**
 *   (원본은 2000px급. 표시 크기의 16~28배를 받고 있었다)
 * 240px 썸네일로 바꾸면 평균 629KB → 8KB, 같은 페이지가 96MB → 1.3MB가 된다.
 *
 * ## 없으면 원본으로 되돌린다
 * 썸네일은 **2026-08-11 이후 업로드분에만** 있다. 그 전에 올라간 이미지(약 785장)는 썸네일이 없고,
 * 업로드 시 생성이 실패한 것도 있을 수 있다. 그래서 404가 나면 조용히 원본으로 바꿔 그린다 —
 * 백필을 하지 않아도 화면은 항상 정상이다.
 *
 * ## 여기 쓰면 안 되는 곳
 * 확대·라이트박스·PDF는 **원본**을 써야 한다. 240px를 크게 늘리면 뭉개진다.
 *
 * ## lazy loading 은 넣지 않는다
 * 스크롤할 때 그림이 뒤늦게 뜨는 게 싫다는 판단(2026-08-11). 썸네일이 8KB라 한 번에 받아도 부담이 없다.
 * 필요하면 호출부에서 `loading="lazy"` 를 직접 넘길 수는 있다.
 */
/**
 * 이 시각(ms) 이후에 올라온 파일에만 썸네일이 있다.
 * 업로드 파일명이 `<Date.now()>-<난수>.확장자` 라서 시각을 그대로 읽을 수 있다.
 * 이걸 안 보면 기존 785장마다 **헛된 404를 한 번씩** 쏘고 나서 원본으로 되돌아간다(요청이 두 배).
 * 백필을 하게 되면 이 값을 0으로 낮추면 된다.
 */
export const THUMB_SINCE = Date.parse('2026-08-11T00:00:00+09:00');

/**
 * 크기 두 종. 백엔드 `lib/thumb.ts` 의 THUMB_SPECS 와 **폴더명이 같아야** 한다.
 *
 *  list(t240) — 목록·운영페이지의 작은 칸(28~120px)
 *  grid(t800) — 작가 홈페이지 작품 격자. 표시 크기가 PC 377px / 레티나 754px / 모바일3x 486px 이라
 *               240px 로는 0.32~0.64배로 늘어나 뭉개진다.
 *
 * `backfilled` — 그 폴더에 **옛 파일까지 채워 넣었는지**.
 *   t240 은 2026-08-11 이후 업로드분에만 있다 → 옛 파일은 시각으로 걸러 헛된 404를 피한다.
 *   t800 은 도입과 동시에 PortfolioImage 372장을 전부 백필했다 → 시각으로 거르면 오히려 전부 원본이 된다.
 *   ⚠️ t240 까지 백필하면 여기 `backfilled: true` 로 바꿀 것(그전엔 바꾸면 404가 두 배로 늘어난다).
 */
export const THUMB_SIZES = {
  list: { dir: 't240', backfilled: false },
  grid: { dir: 't800', backfilled: true },
} as const;

export type ThumbSize = keyof typeof THUMB_SIZES;

export function thumbUrl(url: string, size: ThumbSize = 'list'): string {
  if (!url) return url;
  const { dir, backfilled } = THUMB_SIZES[size];
  if (!backfilled) {
    const name = url.split(/[?#]/)[0]!.split('/').pop() ?? '';
    const stamp = Number(name.split('-')[0]);
    // 시각을 못 읽거나(옛 형식) 기능 도입 전 파일이면 썸네일이 없다 — 처음부터 원본을 쓴다
    if (!Number.isFinite(stamp) || stamp < THUMB_SINCE) return url;
  }
  // 마지막 파일명 앞에 tNNN/ 삽입 (backend/src/lib/thumb.ts 와 같은 규칙)
  //   https://img.artlink.cc/artlink/abc.jpg → https://img.artlink.cc/artlink/t800/abc.jpg
  //   /uploads/abc.jpg                      → /uploads/t800/abc.jpg
  return url.replace(/\/([^/?#]+)(\?[^#]*)?(#.*)?$/, `/${dir}/$1$2$3`);
}

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** 원본 주소 — 썸네일이 없으면 이걸로 되돌린다 */
  src: string;
  /** 어느 크기를 쓸지. 기본은 목록용 240px */
  size?: ThumbSize;
}

export default function Thumb({ src, size = 'list', ...rest }: Props) {
  const [fallback, setFallback] = useState(false);
  return (
    <img
      {...rest}
      src={fallback ? src : thumbUrl(src, size)}
      onError={(e) => {
        if (!fallback) setFallback(true);   // 썸네일 없음 → 원본
        rest.onError?.(e);
      }}
    />
  );
}
