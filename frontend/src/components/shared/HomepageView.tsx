import { memo, useMemo } from 'react';
import { User, FileText, Calendar, Instagram } from 'lucide-react';
import { displayName, safeHttpUrl, instagramHandle } from '@/lib/utils';
import {
  artworkGridSignature, artworkTitle, captionInline, careerLineText, groupBySeries, hasTitle,
  isCareerEmpty, normalizeCareer, statusBadge,
} from '@/lib/artwork';
import { reflowProse } from '@/lib/prose';
import { splitIntoColumns } from '@/lib/careerColumns';
import Thumb from '@/components/shared/Thumb';
import type { PortfolioImage, Career, CareerKey, SeriesInfo } from '@/types';

/**
 * 작가 홈페이지 본문 — **공개 페이지(`/portfolio/:id`)와 편집 화면 미리보기가 함께 쓴다.**
 *
 * 따로 만들면 반드시 어긋난다. 미리보기가 실제와 다르면 미리보기를 볼 이유가 없으므로
 * 여기 하나만 두고 양쪽이 같은 것을 그린다. 페이지 껍데기(뒤로가기·[수정]·라이트박스)는 바깥에서 붙인다.
 *
 * ⚠️ **작가가 넣는 글에는 `break-keep` 만으로 부족하다.** `word-break: keep-all` 은 낱말 안에서 안 끊는데,
 *    공백 없이 이어 쓴 한글 한 덩어리는 통째로 한 낱말이라 아무 데서도 안 끊긴다.
 *    실측(2026-08-28, 작가A 작가노트 432자 무공백): 글상자가 **4848px 넘치고 페이지 전체가 가로로 4224px 밀렸다**.
 *    그래서 글이 들어가는 자리마다 `[overflow-wrap:anywhere]` 를 함께 준다 —
 *    평소엔 낱말 단위로 끊고, 한 줄에 못 담는 덩어리만 강제로 끊는다.
 *    (`break-words`(break-word)로는 min-content 가 안 줄어 부모를 계속 밀어낸다 → `anywhere` 여야 한다)
 */
const CAREER_LABELS: { key: CareerKey; label: string }[] = [
  { key: 'education', label: '학력' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어' },
  { key: 'award', label: '수상 및 선정' },
];

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[13px] font-semibold tracking-[0.14em] text-gray-900 border-l-2 border-[#c4302b] pl-2.5 mb-3">{children}</h3>
);

export interface HomepageViewData {
  user: { id?: number; name: string; nickname?: string | null; avatar?: string | null; instagramUrl?: string | null };
  tagline?: string | null;
  statement?: string | null;
  biography?: string | null;
  career?: Career | null;
  portfolioFileUrl?: string | null;
  // 서버가 null 로 내려주는 경우가 있어 null 도 받는다 (groupBySeries 가 알아서 빈 것으로 본다)
  seriesInfo?: SeriesInfo[] | null;
  images: PortfolioImage[];
}

interface Props {
  data: HomepageViewData;
  /** 작품을 눌렀을 때(공개 페이지=라이트박스). 없으면 작품은 클릭되지 않는다(미리보기). */
  onOpenImage?: (img: PortfolioImage) => void;
  /** 경력 열 수. 미리보기는 폭이 절반이라 공개 페이지보다 한 단계 적게 준다. */
  careerColumns?: number;
  /** 미리보기에서 '아직 비어 있다' 안내를 다르게 하고 싶을 때 */
  emptyText?: string;
}

/**
 * 작품 격자 — **타이핑할 때마다 다시 그리지 않는다.**
 *
 * 미리보기는 약력·작가노트를 한 글자 칠 때마다 부모가 다시 렌더된다. 작품이 30장이면
 * 그때마다 30개 figure + 30개 img 를 재조정하게 되어 입력이 눈에 띄게 밀린다.
 * 그래서 이 덩어리는 **내용 지문(artSignature)이 바뀔 때만** 다시 만든다(아래 useMemo).
 * 지문에 캡션·시리즈까지 넣는 이유: 작품 정보나 시리즈 소개를 고치면 화면에도 반영돼야 하기 때문.
 */
const ArtworkGrid = memo(function ArtworkGrid({
  groups, ordered, artistName, onOpenImage,
}: {
  groups: { name: string; note?: string; images: PortfolioImage[] }[];
  ordered: PortfolioImage[];
  artistName: string;
  onOpenImage?: (img: PortfolioImage) => void;
}) {
  return (
    <>
      {/* 예전엔 30장을 **전부 받은 뒤** 한꺼번에 보여줬다(masonry 는 높이를 미리 몰라 줄이 튀었다).
          칸이 정사각이라 높이가 정해졌으니 그 장치가 필요 없다 — 한 장씩 lazy 로 들어와도
          레이아웃이 움직이지 않고 첫 화면이 훨씬 빨리 뜬다. */}
      {groups.map((g, gi) => (
        <div key={g.name || `__${gi}`} className="mb-8 last:mb-0">
          {g.name && (
            <div className="mb-3">
              <p className="text-sm font-semibold text-gray-900">{g.name}</p>
              {g.note && <p className="text-[13px] text-gray-500 mt-1 leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere] max-w-3xl">{g.note}</p>}
            </div>
          )}
          {/* 정사각 칸이라 행이 맞는다. 캡션 자리를 위해 세로 간격을 가로보다 넉넉히 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 md:gap-x-6 md:gap-y-10">
            {g.images.map(img => (
              <ArtworkCard
                key={img.id}
                img={img}
                index={ordered.findIndex(o => o.id === img.id)}
                artistName={artistName}
                onOpen={onOpenImage}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
});

/**
 * 작품 카드 — 정사각 칸 안에 원본 비율 그대로(object-contain).
 *
 * 예전엔 masonry(columns) 라 폭만 맞고 높이가 제각각이어서 **줄이 어긋났다**.
 * 칸을 정사각으로 고정해 행렬을 맞춘다.
 *
 * ⚠️ 칸 배경은 흰색이다. 회색 타일을 깔면 작품마다 회색 여백이 눈에 띄어
 *    작품보다 타일이 먼저 읽힌다 — 칸은 정렬을 위한 보이지 않는 격자여야 한다.
 * ⚠️ contain 이라 비율은 그대로다. 자르지도 늘리지도 않는다(CLAUDE.md 18번).
 */
function ArtworkCard({
  img, index, artistName, onOpen,
}: { img: PortfolioImage; index: number; artistName: string; onOpen?: (img: PortfolioImage) => void }) {
  const st = statusBadge(img);
  const meta = captionInline(img);
  const titled = hasTitle(img);
  /* 제목 없는 작품이 대부분(372점 중 9점만 제목 있음)이라 alt 에 '무제' 를 그대로 쓰면
     스크린리더가 그것만 반복해 읽는다. 없을 땐 순번으로 구별해 준다. */
  const alt = titled ? artworkTitle(img) : `${artistName} 작품 ${index + 1}`;
  /* 격자에는 **원본이 아니라 t800** 을 쓴다.
     실측(2026-08-27): 표시 377px 자리에 1456~1986px 원본을 받아 30장이 28.1MB 였다 → t800 4.3MB.
     800px 이면 레티나(754px)·모바일3x(486px)까지 덮으므로 화질 손실이 없다.
     ⚠️ 라이트박스는 이 컴포넌트 밖이며 **원본을 그대로** 쓴다(키우면 뭉개진다, CLAUDE.md 21번).
     ⚠️ 썸네일이 없으면 Thumb 이 알아서 원본으로 되돌린다 — 백필이 실패한 장이 있어도 화면은 정상. */
  const image = (
    <div className="flex aspect-square items-center justify-center">
      <Thumb
        src={img.url}
        size="grid"
        alt={alt}
        loading="lazy"
        decoding="async"
        className="max-h-full max-w-full object-contain hover:opacity-90 transition-opacity"
      />
    </div>
  );
  return (
    <figure>
      {/* 미리보기에는 라이트박스가 없다 — 눌러도 아무 일 없는 버튼을 두지 않는다 */}
      {onOpen ? (
        <button onClick={() => onOpen(img)} className="block w-full">{image}</button>
      ) : image}
      {/* 제목을 안 넣은 작품에 '무제' 를 붙이지 않는다 — 정보가 아니라 소음이다.
          보여줄 게 하나도 없으면 figcaption 자체를 안 그린다(빈 요소가 8px 여백을 먹는다).
          판매상태는 제목이 없어도 알려야 하므로 따로 통과시킨다. */}
      {(titled || st || meta) && (
        <figcaption className="mt-2">
          {(titled || st) && (
            <p className="text-sm text-gray-900">
              {titled && artworkTitle(img)}
              {/* 판매중까지 전부 표기하되, 대부분이 판매중일 테니 강조는 '판매완료'에만 준다 */}
              {st && (
                <span className={`${titled ? 'ml-2' : ''} text-[11px] font-semibold ${st.tone === 'sold' ? 'text-[#c4302b]' : 'text-gray-400'}`}>
                  ● {st.label}
                </span>
              )}
            </p>
          )}
          {meta && <p className="text-xs text-gray-500 mt-0.5">{meta}</p>}
        </figcaption>
      )}
    </figure>
  );
}

export default function HomepageView({ data, onOpenImage, careerColumns = 3, emptyText }: Props) {
  const { user, images, seriesInfo } = data;
  const artistName = displayName(user);

  /* 작품 덩어리의 '내용 지문'. 부모가 몇 번을 다시 렌더하든 이 문자열이 그대로면
     아래 useMemo 가 이전 JSX 를 그대로 돌려줘 30장이 재조정되지 않는다.
     문자열 join 은 30개 기준 수십 µs 라 매 타이핑마다 만들어도 부담이 없다. */
  const artSignature = artworkGridSignature(images, seriesInfo);

  const artworks = useMemo(() => {
    const groups = groupBySeries(images, seriesInfo);
    const ordered = groups.flatMap(g => g.images);
    const total = ordered.length;
    if (total === 0) return null;
    return (
      <div className="mb-8">
        <SectionTitle>작품 ({total})</SectionTitle>
        <ArtworkGrid groups={groups} ordered={ordered} artistName={artistName} onOpenImage={onOpenImage} />
      </div>
    );
    // artSignature 가 images/seriesInfo 의 내용을 대표한다 (참조가 바뀌어도 내용이 같으면 재사용)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artSignature, artistName, onOpenImage]);

  const career = normalizeCareer(data.career);
  const careerEmpty = isCareerEmpty(data.career);
  const fileUrl = safeHttpUrl(data.portfolioFileUrl);
  const isEmpty = !data.biography && !data.statement && careerEmpty && !fileUrl && images.length === 0;

  return (
    <div>
      {/* 페이지 이름 — ArtLink 로고와 같은 색 규칙(앞은 검정, 뒤는 빨강 #dc3545).
          Art**Link** ↔ Artist **Homepage** 로 짝을 맞춰 한 서비스의 화면으로 읽히게 한다. */}
      <h2 className="text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900 mb-6">
        Home<span className="text-[#dc3545]">Page</span>
      </h2>

      {/* 작가 프로필 */}
      <div className="flex items-center gap-4 mb-8">
        {user.avatar ? (
          <img src={user.avatar} alt={artistName} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
            <User size={24} className="text-gray-400" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-medium">{artistName}</h1>
          {/* 한 줄 소개가 없으면 아무것도 쓰지 않는다 — 예전엔 '아티스트 포트폴리오' 라는
              누구에게나 해당되는 문구가 들어가 자리만 차지했다. */}
          {data.tagline && <p className="text-sm text-gray-600 mt-0.5 break-keep [overflow-wrap:anywhere]">{data.tagline}</p>}
          {/* 인스타는 이름 바로 아래 — 작가를 찾아가는 통로라 눈에 띄어야 한다 */}
          {safeHttpUrl(user.instagramUrl) && (
            <a
              href={safeHttpUrl(user.instagramUrl)!}
              target="_blank"
              rel="noreferrer"
              /* 높이가 20px 이라 WCAG 2.2 AA 의 24×24 를 못 넘겼다. 보이는 크기는 그대로 두고
                 세로 히트영역만 넓힌다 */
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-[#E4405F] hover:text-[#c13584] hover:underline"
            >
              {/* 'Instagram' 이라고만 쓰면 누구 계정인지 눌러보기 전엔 모른다 → 아이디를 보여준다.
                  주소에서 아이디를 못 뽑으면(형식이 이상하면) 종전대로 'Instagram' */}
              <Instagram size={14} /> {instagramHandle(user.instagramUrl) ?? 'Instagram'}
            </a>
          )}
        </div>
      </div>

      {/* 작가노트 */}
      {data.statement && (
        <div className="mb-8">
          <SectionTitle>작가노트</SectionTitle>
          {/* 작가가 문장마다 엔터를 친 글은 화면 폭과 안 맞아 문단 오른쪽이 계단처럼 들쭉날쭉해진다.
              이력(줄바꿈=정보)은 그대로 두고 산문만 이어 붙인다(lib/prose.ts). 저장값은 안 건드린다. */}
          {/* 양쪽 맞춤 — 작가노트는 통글이라 오른쪽이 들쭉날쭉하면 지저분하다.
              break-keep 과 함께 써야 낱말이 안 쪼개진다(한글은 낱말 단위로 끊어야 읽힌다). */}
          <p className="text-[15px] text-gray-700 leading-[1.9] whitespace-pre-wrap break-keep [overflow-wrap:anywhere] text-justify max-w-3xl">{reflowProse(data.statement)}</p>
        </div>
      )}

      {/* 약력 */}
      {data.biography && (
        <div className="mb-6">
          <SectionTitle>작가 약력</SectionTitle>
          {/* 양쪽 맞춤 — 약력도 통글이라 오른쪽이 들쭉날쭉하면 지저분하다(작가노트와 동일). */}
          <div className="text-sm text-gray-600 whitespace-pre-wrap break-keep [overflow-wrap:anywhere] text-justify max-w-3xl">{reflowProse(data.biography)}</div>
        </div>
      )}

      {/* 경력 */}
      {!careerEmpty && (
        <div className="mb-6">
          <SectionTitle>경력</SectionTitle>
          {/* 열마다 자기 높이만 쓰는 배치 (lib/careerColumns.ts).
              grid 로 하면 한 행의 높이가 제일 긴 칸(단체전 20줄)에 맞춰져 '수상 및 선정'이
              개인전에서 한참 떨어졌다 — items-start 로도 행 높이는 안 줄어든다.
              여백을 넓힌 이유: 긴 항목이 두 줄로 깨졌을 때 어디까지가 한 항목인지 읽히게 하려고
              ("2025.04 <ART 더불어전> 성남아트센터 808갤러리(성남)"). */}
          <div className="flex gap-x-14 max-w-6xl items-start">
            {splitIntoColumns(
              CAREER_LABELS.filter(({ key }) => (career[key] ?? []).length > 0),
              careerColumns,
              // 무게 = 그 항목의 줄 수. 긴 단체전 아래로 다른 항목이 밀리지 않게 한다
              ({ key }) => (career[key] ?? []).length,
            ).map((column, ci) => (
              <div key={ci} className="flex-1 min-w-0 space-y-9">
                {column.map(({ key, label }) => (
                  <div key={key}>
                    {/*
                      항목 이름(개인전·단체전…)은 **그 아래 줄들보다 확실히 커야 한다.**
                      예전엔 이름이 12px 회색이고 내용이 14px 이라 이름이 더 작았다 —
                      한 열에 두 덩어리가 들어가면 어디서 개인전이 끝나고 수상이 시작되는지 안 읽혔다.
                      이름 14px 진하게 + 밑줄, 내용 13px 회색으로 위아래를 벌린다.
                    */}
                    <p className="flex items-center gap-1.5 border-b border-gray-300 pb-1.5 text-sm font-semibold text-gray-900">
                      <Calendar size={12} className="text-gray-400" /> {label}
                    </p>
                    <ul className="mt-2.5 space-y-2">
                      {(career[key] ?? []).map((e, i) => (
                        /* gray-400 은 흰 배경에서 2.6:1 이라 WCAG AA(4.5) 미달 → gray-600 */
                        <li key={i} className="text-[13px] leading-[1.7] text-gray-600 break-keep [overflow-wrap:anywhere]">{careerLineText(e)}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 포트폴리오 파일 */}
      {fileUrl && (
        <div className="mb-8">
          <SectionTitle>포트폴리오 파일</SectionTitle>
          <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:underline">
            <FileText size={14} /> 파일 보기
          </a>
        </div>
      )}

      {/* 작품 — 시리즈별로 묶어서 (시리즈가 없으면 제목 없이 그대로) */}
      {artworks}

      {isEmpty && (
        <div className="text-center py-16 text-gray-400">{emptyText ?? '아직 포트폴리오가 등록되지 않았습니다.'}</div>
      )}
    </div>
  );
}
