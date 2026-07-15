/**
 * TourDemoContent — 온보딩 투어 중 탭 콘텐츠 영역에 표시하는 '예시' 목업
 *
 * 신규 계정은 지원내역·리뷰·찜·포트폴리오가 비어 있어 감이 안 오므로,
 * 투어가 해당 탭 스텝일 때 실제 목록 자리(빈 상태 대신)에 채워진 예시를 보여준다.
 * MyPage에서 tourDemoKind가 일치할 때 실제 섹션 대신 이 컴포넌트를 렌더.
 */
import { Heart, Star } from 'lucide-react';

type DemoKind = 'portfolio' | 'favorites' | 'reviews' | 'applications';

// 예시임을 알리는 상단 배너 (실제 데이터로 오해하지 않도록)
function DemoBanner() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
      <span>👀</span>
      <span>예시 미리보기예요. 실제로 채우면 이렇게 보여요.</span>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={14} className={i < n ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-200 fill-gray-200'} />
      ))}
    </div>
  );
}

export default function TourDemoContent({ kind }: { kind: DemoKind }) {
  return (
    <div data-tour="tour-demo" className="pointer-events-none select-none">
      <DemoBanner />
      <DemoBody kind={kind} />
    </div>
  );
}

function DemoBody({ kind }: { kind: DemoKind }) {
  if (kind === 'applications') {
    const rows = [
      { title: '갤러리믹 8월 뱅크아트페어', gallery: '갤러리 믹', date: '2026. 7. 10.', label: '수락', cls: 'bg-green-100 text-green-600' },
      { title: '서울 현대 갤러리 신진작가 공모', gallery: '서울 현대 갤러리', date: '2026. 7. 8.', label: '검토중', cls: 'bg-amber-100 text-amber-700' },
      { title: '부산 아트페어 2026', gallery: '해운대 아트센터', date: '2026. 7. 5.', label: '접수', cls: 'bg-gray-100 text-gray-500' },
    ];
    return (
      <>
        <div className="flex gap-1.5 flex-wrap mb-3">
          <span className="px-2.5 py-1 text-xs rounded-full bg-gray-900 text-white">전체 (3)</span>
          <span className="px-2.5 py-1 text-xs rounded-full bg-gray-100 text-gray-600">진행중 (2)</span>
          <span className="px-2.5 py-1 text-xs rounded-full bg-gray-100 text-gray-600">정산완료</span>
        </div>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.title} className="border border-gray-100 rounded-xl p-4">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <h4 className="font-medium text-sm truncate">{r.title}</h4>
                  <p className="text-xs text-gray-500 mt-1">{r.gallery} · 지원일 {r.date}</p>
                </div>
                <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-full ${r.cls}`}>{r.label}</span>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (kind === 'reviews') {
    const rows = [
      { gallery: '갤러리 믹', n: 5, date: '2026. 6. 20.', text: '작가를 배려하는 운영이 인상적이었어요. 다음 전시에도 꼭 지원하고 싶습니다.' },
      { gallery: '서울 현대 갤러리', n: 4, date: '2026. 5. 11.', text: '전시 공간이 넓고 채광이 좋았습니다. 응대도 친절했어요.' },
    ];
    return (
      <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.gallery} className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{r.gallery}</p>
                <span className="text-xs text-gray-400">{r.date}</span>
              </div>
              <div className="my-1.5"><Stars n={r.n} /></div>
              <p className="text-sm text-gray-600">{r.text}</p>
            </div>
          ))}
      </div>
    );
  }

  if (kind === 'favorites') {
    const rows = [
      { name: '갤러리 믹', sub: '갤러리 · 경기 남부' },
      { name: '서울 현대 갤러리', sub: '갤러리 · 서울' },
      { name: '8월 뱅크아트페어', sub: '공모 · D-12' },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {rows.map((r) => (
            <div key={r.name} className="rounded-xl overflow-hidden border border-gray-100">
              <div className="aspect-[4/3] bg-gradient-to-br from-gray-200 to-gray-300 relative">
                <Heart size={16} className="absolute top-2 right-2 text-[#c4302b] fill-[#c4302b]" />
              </div>
              <div className="p-2.5">
                <p className="text-sm font-medium truncate">{r.name}</p>
                <p className="text-xs text-gray-400">{r.sub}</p>
              </div>
            </div>
          ))}
      </div>
    );
  }

  // portfolio
  return (
    <>
      <div className="mb-5">
        <p className="text-sm font-medium text-gray-700 mb-1">작가 약력</p>
        <p className="text-sm text-gray-600 leading-relaxed">
          2020 홍익대학교 회화과 졸업 · 2023 개인전 «빛의 결» (서울) · 2024 단체전 «여름의 감각» (부산)
        </p>
      </div>
      <p className="text-sm font-medium text-gray-700 mb-2">작품 사진</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-gray-200 to-gray-300" />
        ))}
      </div>
    </>
  );
}
