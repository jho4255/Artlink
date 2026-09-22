/**
 * 업로드 이미지 정규화 — **PNG 로 온 사진을 JPEG(q90) 로 바꿔 저장한다** (2026-09-22, 사용자 결정).
 *
 * ## 왜
 * PNG 는 무손실이라 회화 촬영본에 쓰면 거의 안 줄어든다. 로컬 uploads 실측(2026-09-22, 100KB 초과 PNG 23장):
 *   PNG 30.2MB → JPEG q90(4:4:4) 4.6MB (**15%**) · 한 장 1.95MB → 0.44MB
 *   화질: PSNR 36~43dB, 가장 큰 픽셀 차이 46/255, 3배 확대 나란히 놓고도 구분 안 됨(`scratchpad` 비교 시트).
 * 목록·격자는 이미 JPEG 썸네일(t240·t800)을 쓰므로 영향이 없다. 이득은 **원본을 여는 곳** —
 * 라이트박스·ArtLook·**포트폴리오 PDF**(원본을 내장하는데 예산이 9.4MB 라 PNG 5장이면 이미 넘친다).
 *
 * 프론트 `compressImage` 가 2MB·2000px 을 넘는 것만 JPEG 로 다시 굽기 때문에, 그 아래 PNG(정확히 위 실측의
 * 1.9MB 짜리들)는 그대로 서버까지 온다. 그래서 서버가 마지막에 한 번 더 본다.
 *
 * ## 규칙 — 바꾸지 않는 것
 *  - **투명 픽셀이 실제로 있는 PNG** 는 그대로 둔다(JPEG 에 투명이 없다 — 흰색으로 깔면 로고·누끼 작품이 망가진다).
 *    알파 채널이 *있다*고 다 그런 건 아니다 — 캡처 도구가 불투명한데도 알파를 붙여 저장한다. 채널 최솟값으로 판정.
 *  - **여러 프레임(APNG)** 은 그대로(첫 프레임만 남는다).
 *  - JPEG·WebP·GIF 는 손대지 않는다. GIF 는 애니메이션이 깨지고, 나머지는 이미 손실 압축이라 다시 굽으면 화질만 깎인다.
 *  - JPEG 가 원본보다 **작아지지 않으면** PNG 유지(단색 도형·아주 작은 그림에서 드물게 그렇다).
 *  - 디코드 실패 등 무슨 일이 나도 **원본 그대로** 돌려준다 — 사진이 올라가는 게 우선(썸네일과 같은 원칙).
 *
 * ⚠️ 픽셀 크기는 바뀌지 않는다(`imageDims`·배치 비율에 영향 없음). EXIF 회전은 굽는 김에 반영한다(PNG 엔 보통 없다).
 * ⚠️ 색은 4:4:4(크로마 서브샘플링 없음) — 기본 4:2:0 이면 빨강·파랑 경계가 번진다. 용량 차이는 몇 % 뿐이다.
 */
export const JPEG_QUALITY = 90;

export interface NormalizedImage {
  buf: Buffer;
  /** 확장자(점 포함) — 바뀌면 `.jpg` */
  ext: string;
  mime: string;
  /** JPEG 로 바꿨는가 */
  converted: boolean;
}

function isPng(ext: string, mime: string): boolean {
  return ext.toLowerCase() === '.png' || mime === 'image/png';
}

/**
 * 원본 버퍼 + 원래 확장자·MIME → 저장할 버퍼·확장자·MIME.
 * PNG 가 아니면 그대로, PNG 라도 위 규칙에 걸리면 그대로 돌려준다.
 */
export async function normalizeUploadImage(buf: Buffer, ext: string, mime: string): Promise<NormalizedImage> {
  const keep: NormalizedImage = { buf, ext, mime, converted: false };
  if (!isPng(ext, mime)) return keep;
  try {
    const sharp = (await import('sharp')).default;
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    if ((meta.pages ?? 1) > 1) return keep;            // APNG
    if (meta.hasAlpha) {
      const stats = await img.stats();
      const alpha = stats.channels[stats.channels.length - 1];
      if (alpha && alpha.min < 255) return keep;      // 실제 투명 픽셀
    }
    const out = await img
      .rotate()
      .flatten({ background: '#ffffff' })              // 알파 채널만 있고 전부 불투명인 경우 — 채널만 뗀다
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    if (out.length >= buf.length) return keep;
    return { buf: out, ext: '.jpg', mime: 'image/jpeg', converted: true };
  } catch {
    return keep;
  }
}
