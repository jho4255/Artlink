import { useState, useEffect, Suspense } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import BottomTabBar from './BottomTabBar';
import MyPageSideMenu from './MyPageSideMenu';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import HomepageNudge from '@/components/shared/HomepageNudge';
import GuestIntro from '@/components/shared/GuestIntro';
import PushBanner from '@/components/shared/PushBanner';
import { isHomepagePath } from '@/lib/siteMode';
import { useArtLookBare } from '@/hooks/useArtLookBare';

// 공통 레이아웃 - 모든 페이지에 Navbar + Footer 표시
export default function Layout() {
  const [companyInfo, setCompanyInfo] = useState<string[]>([]);
  /*
    '내 사이트' 모드(2026-11-14, 규칙 82) — 작가·갤러리 홈페이지에서는 ArtLink 상단바·하단 탭바·마이페이지 사이드바·회사 정보 푸터를
    그리지 않는다. 페이지가 그 주인의 이름으로 된 머리(SiteHeader)·꼬리말(SiteFooter)을 직접 그린다(lib/siteMode.ts).
    팝업(홈페이지 완성·소개·앱 알림 배너)은 그대로 — 소개 팝업은 원래 이 주소에서 안 뜬다(introAllowedAt).
  */
  const site = isHomepagePath(useLocation().pathname);
  /* ArtLook 편집 전용 화면(2026-11-17, 규칙 85) — 휴대폰(1024px 미만)에서 [ArtLook] 탭은 상단바·하단 탭바·푸터 없이 화면 가득.
     ArtLook 이 제 머리에 [닫기]·[저장]을 둔다. 팝업(홈페이지 완성·소개·앱 알림)은 그대로. */
  const bare = useArtLookBare();
  const chrome = !site && !bare;
  /* 홈페이지는 페이지가 제 `<main>`(머리·꼬리말 사이 본문)을 그린다 — 여기서도 main 이면 **두 겹**이 된다(main 은 한 문서에 하나,
     2026-11-14 E2E 62 가 잡았다). 그래서 사이트 모드에선 감싸개만 div 로 둔다. */
  const Shell = site ? 'div' : 'main';

  useEffect(() => {
    fetch('/terms/company-info.txt')
      .then(r => {
        if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error();
        return r.text();
      })
      .then(text => {
        if (!text.trimStart().startsWith('<!')) {
          setCompanyInfo(text.split('\n').filter(line => line.trim()));
        }
      })
      .catch(() => {});
  }, []);

  return (
    // pb — 모바일 하단 고정 탭바(BottomTabBar) 높이만큼 비워 본문·푸터가 가리지 않게 (iOS safe-area 포함)
    <div className={`min-h-screen bg-white flex flex-col ${chrome ? 'pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] lg:pb-0' : ''}`}>
      {chrome && <Navbar />}
      {/* 본문 + 우측 세로 메뉴(lg↑, 로그인 시에만).
          min-w-0 필수 — 없으면 안쪽 표·긴 제목의 min-content 가 폭을 밀어 메뉴를 화면 밖으로 낸다(CLAUDE.md 27번) */}
      <div className="flex-1 flex">
        <Shell className="flex-1 min-w-0">
          {/* ErrorBoundary: 배포 후 이전 청크 404 등으로 페이지 로딩 실패 시 흰 화면 대신 복구 UI */}
          <ErrorBoundary>
            <Suspense fallback={
              <div className="flex items-center justify-center py-24 text-gray-300">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-400" />
              </div>
            }>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </Shell>
        {chrome && <MyPageSideMenu />}
      </div>
      {chrome && <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-4">
          {companyInfo.length > 0 ? (
            <div className="space-y-0.5 text-[11px] text-gray-300 leading-relaxed">
              {companyInfo.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-300">&copy; 2026 ArtLink. All rights reserved.</p>
          )}
          {/* 터치 히트영역 확보(py-2) — 시각 간격은 네거티브 마진으로 유지 */}
          <div className="mt-2 flex gap-2">
            <Link to="/privacy" className="text-[11px] text-gray-300 hover:text-gray-500 min-h-[44px] -my-3 inline-flex items-center px-1.5 -ml-1.5">개인정보처리방침</Link>
            <Link to="/terms" className="text-[11px] text-gray-300 hover:text-gray-500 min-h-[44px] -my-3 inline-flex items-center px-1.5">이용약관</Link>
            {/* 고객센터 — 예전엔 로그인 사용자의 사이드바(lg↑ 전용) 푸터 링크가 유일해서 **모바일과 비로그인은 갈 길이 없었다**(2026-09-19) */}
            <Link to="/support" className="text-[11px] text-gray-300 hover:text-gray-500 min-h-[44px] -my-3 inline-flex items-center px-1.5">고객센터</Link>
          </div>
        </div>
      </footer>}
      {/* 모바일 전용 하단 탭바 — 상단 가운데 5메뉴를 아래로(catch 앱 방식). lg↑ 는 상단 네비 유지 */}
      {chrome && <BottomTabBar />}
      {/* 작가 로그인 뒤 '홈페이지에 빈 곳이 있어요' 팝업 — 어느 화면에 내려도 뜬다(lib/homepageNudge.ts) */}
      <HomepageNudge />
      {/* 비회원 소개 — 작가가 아트링크에서 하는 네 가지를 한 번 보여 준다(lib/guestIntro.ts). 어느 화면으로 들어와도 뜬다 */}
      <GuestIntro />
      {/* 앱을 보고 있을 때 온 알림 — 카카오톡처럼 위쪽 배너(lib/pushBanner.ts). 브라우저에서는 아무것도 그리지 않는다 */}
      <PushBanner />
    </div>
  );
}
