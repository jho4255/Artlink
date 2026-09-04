/**
 * 하이라이트 줄 — 인스타그램처럼 프로필 위에 동그란 앨범이 늘어선다.
 *
 * ArtStory([소식])와 공개 작가 홈페이지가 **같은 것을 보여줘야** 하므로 한 컴포넌트다.
 * 다른 건 하나뿐 — 내 화면에서만 맨 앞에 [+ 추가]가 붙는다.
 *
 * ⚠️ **커버 사진은 서버가 정한다**(`coverImage`). 화면에서 스토리를 뒤져 고르지 말 것 —
 *    예전 코드가 *작품 사진*(`PortfolioImage`)에서 스토리 id 를 찾고 있었다. 둘은 아예 다른
 *    테이블이라 무엇을 넣어도 영영 안 맞는다(타입 오류로 빌드가 깨져 있었다).
 */
import type { StoryHighlight } from '@/types';

interface Props {
  highlights: StoryHighlight[];
  /** 주면 맨 앞에 [+ 추가]가 붙는다 (내 화면일 때만) */
  onCreate?: () => void;
  onOpen?: (h: StoryHighlight) => void;
}

export default function HighlightRail({ highlights, onCreate, onOpen }: Props) {
  // 남의 홈페이지에서 하이라이트가 하나도 없으면 줄째로 감춘다 (빈 줄은 고장으로 보인다)
  if (highlights.length === 0 && !onCreate) return null;

  return (
    <div className="flex flex-wrap items-start gap-4">
      {onCreate && (
        <button onClick={onCreate} className="flex w-16 flex-col items-center gap-1.5">
          <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-gray-300 text-2xl leading-none text-gray-400 transition hover:border-gray-400 hover:bg-gray-50">
            +
          </span>
          <span className="text-xs text-gray-500">추가</span>
        </button>
      )}
      {highlights.map((h) => (
        <button
          key={h.id}
          onClick={() => onOpen?.(h)}
          title={h.name}
          className="flex w-16 flex-col items-center gap-1.5"
        >
          <span className="block h-16 w-16 overflow-hidden rounded-full border-2 border-gray-200 bg-gray-100 transition hover:border-gray-400">
            {h.coverImage
              ? <img src={h.coverImage} alt="" className="h-full w-full object-cover" />
              : <span className="grid h-full w-full place-items-center bg-gradient-to-br from-gray-300 to-gray-400 text-xs font-bold text-white">
                  {h.name.slice(0, 2)}
                </span>}
          </span>
          <span className="w-full truncate text-center text-xs text-gray-600">{h.name}</span>
        </button>
      ))}
    </div>
  );
}
