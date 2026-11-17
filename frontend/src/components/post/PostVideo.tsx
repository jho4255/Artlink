import { videoFrameStyle, videoRatio } from '@/lib/postLayout';

/**
 * 글 안 동영상(파일, 2026-11-13) — 읽는 화면·편집기 공용 틀. 유튜브 대신 직접 올린 동영상(25MB, 서버 /upload/post-video).
 * - 틀 비율은 동영상의 실제 비율(올릴 때 화면이 잰 값). 모르면 16:9.
 * - 세로 동영상은 **화면 높이의 75% 안으로** 폭을 줄여 가운데 — 휴대폰 세로 영상이 글을 한 화면 넘게 덮지 않게.
 * - `preload="metadata"` — 누르기 전에는 첫 장면과 길이만 받는다(데이터 아끼기). 소리는 사용자가 켠다(자동 재생 없음).
 */
export default function PostVideo({ src, width, height, title = '동영상' }: { src: string; width?: number | null; height?: number | null; title?: string }) {
  const ratio = videoRatio(width, height);
  return (
    <div className="post-video-frame" style={videoFrameStyle(ratio)}>
      <video src={src} controls playsInline preload="metadata" aria-label={title} />
    </div>
  );
}
