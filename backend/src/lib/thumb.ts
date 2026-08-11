/**
 * 썸네일 — 목록·그리드에 쓰는 작은 이미지.
 *
 * ## 왜 만들었나
 * 목록 화면이 **원본을 그대로** 받아 28×28px 자리에 그리고 있었다. 실측(2026-08-11):
 *   갤러리 운영 페이지 1장 열 때  이미지 149건 · 평균 674KB · **합계 약 96MB**
 *   원본 2000px급 → 240px 썸네일로 줄이면 평균 629KB → 8KB (**76배**)
 * 갤러리 담당자가 모바일로 페이지 한 번 열면 100MB가 나가고, R2 egress 비용도 조회마다 붙는다.
 *
 * ## 규칙
 * 원본 키 옆에 `t240/` 한 단계를 끼운다. 프론트도 같은 규칙으로 주소를 만들 수 있다(문자열 치환 한 번).
 *   `https://img.artlink.cc/artlink/abc.jpg`  →  `https://img.artlink.cc/artlink/t240/abc.jpg`
 *   `/uploads/abc.jpg`                        →  `/uploads/t240/abc.jpg`
 *
 * ## 없으면 원본
 * 썸네일 생성은 **실패해도 업로드를 막지 않는다**(사진은 올라가는 게 우선). 그래서 썸네일이 없는 이미지가
 * 항상 존재한다 — 기존에 올라간 것 전부가 그렇다. 화면은 404면 원본으로 되돌린다(프론트 `thumbUrl` 주석 참고).
 */
import path from 'path';

/** 썸네일 최대 변 길이(px). 바꾸면 기존 썸네일과 섞이므로 폴더명(t240)도 함께 바꿀 것 */
export const THUMB_SIZE = 240;
export const THUMB_DIR = 't240';

/**
 * 원본 키/경로 → 썸네일 키/경로 (마지막 파일명 앞에 t240/ 삽입).
 *
 * ⚠️ 예전엔 `key.replace(...)`로 만들었는데, replace는 **매칭된 부분만** 바꾸므로 치환문에 디렉터리를
 * 다시 붙이면 앞부분이 남아 `artlinkartlink/t240/…` 가 됐다. R2에만 해당돼(로컬은 디스크 경로를 따로 씀)
 * **실서버에서만 조용히** 엉뚱한 키에 올라가고, 화면은 404 → 원본 폴백이라 아무도 눈치채지 못한다.
 * 그래서 문자열을 직접 조립한다.
 */
export function thumbKey(key: string): string {
  const i = key.lastIndexOf('/');
  const dir = i >= 0 ? key.slice(0, i) : '';
  const name = i >= 0 ? key.slice(i + 1) : key;
  return `${dir ? dir + '/' : ''}${THUMB_DIR}/${name}`;
}

/**
 * 썸네일 버퍼 생성. 실패하면 null — 호출부는 그냥 넘어가면 된다(원본은 이미 올라갔다).
 * 애니메이션 GIF 등은 첫 프레임만 쓴다. 결과는 항상 JPEG(용량이 가장 작고 어디서나 열린다).
 */
export async function makeThumb(buf: Buffer): Promise<Buffer | null> {
  try {
    // sharp는 네이티브 모듈이라 무겁다 — 업로드 때만 지연 로드
    const sharp = (await import('sharp')).default;
    return await sharp(buf, { failOn: 'none' })
      .rotate()                                   // EXIF 회전 반영 (안 하면 썸네일만 눕는다)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

/** 디스크 저장 모드에서 쓸 썸네일 파일 경로 */
export function thumbDiskPath(uploadsDir: string, filename: string): string {
  return path.join(uploadsDir, THUMB_DIR, filename);
}
