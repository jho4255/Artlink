import { useState } from 'react';
import { Play } from 'lucide-react';

/**
 * 유튜브 영상 — **누르기 전에는 그림만**(i.ytimg.com 미리보기). 누르면 그 자리에 youtube-nocookie 재생기를 싣는다.
 * 글을 열자마자 재생기 여러 개를 싣지 않는다(무겁고, 읽는 사람의 정보가 먼저 유튜브로 가지 않게).
 * 주소는 영상 id 로 여기서 만든다 — 저장된 값은 11자 id 뿐이다(서버가 검사).
 */
export function YoutubeFacade({ videoId, playable = true, title = '유튜브 영상' }: { videoId: string; playable?: boolean; title?: string }) {
  const [playing, setPlaying] = useState(false);
  const valid = /^[A-Za-z0-9_-]{11}$/.test(videoId ?? '');
  if (!valid) return <div className="post-youtube-frame flex items-center justify-center bg-gray-100 text-sm text-gray-500">영상을 불러올 수 없어요</div>;
  if (playing) {
    return (
      <div className="post-youtube-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-full w-full border-0"
        />
      </div>
    );
  }
  return (
    <div className="post-youtube-frame">
      <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      {playable ? (
        <button type="button" onClick={() => setPlaying(true)} aria-label={`${title} 재생`} className="post-youtube-play">
          <Play size={22} className="translate-x-[1px] fill-white" />
        </button>
      ) : (
        <span className="post-youtube-play" aria-hidden="true"><Play size={22} className="translate-x-[1px] fill-white" /></span>
      )}
    </div>
  );
}
