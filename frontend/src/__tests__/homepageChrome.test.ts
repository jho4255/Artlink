/**
 * 홈페이지 '내 사이트' 모드 · 버튼 한 벌 — 소스 가드 (2026-11-14, CLAUDE.md 규칙 82).
 *
 * 사용자 지적: "웹에서 문의하기·이웃 추가·공유 디자인이 튄다, 일관성이 없다". 원인은 사이트 어디에도 없는 둥근 상자 셋이 나란히,
 * [문의]가 한 화면에 둘이었던 것. 버튼은 `components/homepage/Actions` 한 벌로만 — 주 버튼 하나(채움·각짐) + 글자 링크.
 * 색은 `var(--hp-…)` 만(작가가 고른 어두운 배경에서도 읽혀야 한다). 회색 클래스·둥근 알약·반투명 흰 바탕이 다시 들어오면 여기서 잡는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
/** 주석을 뺀 코드 — 설명 글에 적힌 클래스 이름은 검사하지 않는다 */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
/** `var(--hp-x, #fff)` 의 대체값은 허용 — 로딩 중(변수 없음) 머리가 흰 바탕으로 그려지게 */
const withoutVarFallbacks = (s: string) => s.replace(/var\(--hp-[a-z-]+,\s*#[0-9a-fA-F]{3,8}\)/g, 'var()');

const THEMED = [
  'components/homepage/Actions.tsx', 'components/homepage/SiteHeader.tsx', 'components/homepage/SiteFooter.tsx',
  'components/homepage/InquirySheet.tsx', 'components/homepage/WorkSheet.tsx', 'components/homepage/NewsTab.tsx',
  'components/homepage/NowStrip.tsx', 'components/shared/HomepageView.tsx',
];

describe('테마 색만 쓴다 — 어두운 배경에서도 읽히게', () => {
  for (const f of THEMED) {
    it(f, () => {
      const c = withoutVarFallbacks(code(f));
      expect(c, '회색 클래스').not.toMatch(/\b(text|bg|border)-gray-\d{2,3}\b/);
      expect(c, '반투명 흰 바탕').not.toMatch(/\bbg-white\/\d+/);
      expect(c, '16진수 색').not.toMatch(/#[0-9a-fA-F]{6}\b/);
    });
  }
  it('둥근 알약은 없다 — 홈페이지 본문의 둥근 것은 프로필 사진 하나뿐', () => {
    for (const f of THEMED.filter((x) => !x.endsWith('HomepageView.tsx'))) expect(code(f), f).not.toMatch(/\brounded-full\b/);
    expect(code('components/shared/HomepageView.tsx').match(/\brounded-full\b/g) ?? []).toHaveLength(1);
    expect(code('components/shared/HomepageView.tsx')).toMatch(/rounded-full object-cover[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*data-testid="homepage-avatar"|data-testid="homepage-avatar"/);
  });
});

describe('버튼 한 벌 — 탭 줄 오른쪽 묶음 · 문의하기는 강조 글자', () => {
  const actions = code('components/homepage/Actions.tsx');
  it('★ [문의하기]는 다른 버튼과 같은 아이콘 + 글자 모양 — 테마 강조색 · 굵은 글자로만 강조(채움 상자 아님, 2026-11-15)', () => {
    expect(actions).toMatch(/export const INQUIRY_ACTION =\s*'[^']*font-semibold[^']*text-\[var\(--hp-accent\)\][^']*'/);
    expect(actions).not.toMatch(/INQUIRY_ACTION =[^;]*\b(border|bg-)/);
    expect(actions).toMatch(/export const LINK_ACTION =\s*'[^']*text-\[var\(--hp-sub\)\][^']*hover:text-\[var\(--hp-ink\)\][^']*'/);
    expect(actions).not.toMatch(/LINK_ACTION =[^;]*\b(border|bg-)/);
    // 혼자 서는 주 버튼(문의 창의 [보내기] · 작품 페이지의 [작품 문의하기])은 그대로 채움
    expect(actions).toMatch(/export function PrimaryAction[\s\S]*bg-\[var\(--hp-ink\)\][\s\S]*text-\[var\(--hp-bg\)\]/);
  });
  it('★ PC 는 한 줄로, 휴대폰은 [문의하기] + [⋯] — useMediaQuery 로 하나만 그린다 · 목록은 Esc·바깥으로 닫힌다', () => {
    expect(actions).toMatch(/const wide = useMediaQuery\('\(min-width: 1024px\)'\);/);
    expect(actions).toMatch(/aria-label="더 보기"[\s\S]*aria-expanded=\{open\}/);
    expect(actions).toMatch(/useEscapeKey\(\(\) => setOpen\(false\)/);
    expect(actions).toMatch(/document\.addEventListener\('pointerdown', away\)/);
  });
  for (const [page, onInquiry] of [
    ['pages/PortfolioPage.tsx', 'canInquire ? () => openInquiry(null) : null'],
    ['pages/GalleryDetailPage.tsx', 'canInquire ? () => setInquiryOpen(true) : null'],
  ] as const) {
    it(`${page} — 버튼 묶음은 TabActions 하나(탭 줄 오른쪽) · 채움 [문의하기] 없음 · 옛 [메시지]도 없음`, () => {
      const c = code(page);
      expect(c.match(/<TabActions\b/g) ?? []).toHaveLength(1);
      expect(c).toContain(`<TabActions onInquiry={${onInquiry}}>`);
      expect(c).not.toMatch(/<PrimaryAction\b|<ActionRow\b/);
      expect(c).not.toMatch(/>\s*(<\w+[^>]*\/>\s*)?메시지\s*</);
      expect(c).not.toContain("'/chats/direct'");   // 대화방은 문의 창(InquirySheet)이 연다 — retiredApis.test.ts 가 길목을 고정한다
      // 이웃 추가는 글자 링크 모양(테마 색)
      expect(c).toMatch(/<FollowButton [^>]*variant="text" className="[^"]*text-\[var\(--hp-sub\)\][^"]*"/);
    });
  }
  it('탭 줄 오른쪽에 붙는다 — 작가는 HomepageView TabBar trailing · 갤러리는 PageTabBar trailing', () => {
    expect(code('components/shared/HomepageView.tsx')).toMatch(/<TabBar [^>]*trailing=\{actions\} \/>/);
    expect(code('pages/GalleryDetailPage.tsx')).toMatch(/<PageTabBar [^>]*trailing=\{tabActions\} \/>/);
    expect(code('components/shared/PageTabBar.tsx')).toMatch(/\{trailing\}/);
  });
});

describe("'내 사이트' 모드 — 상단바 대신 주인의 머리·꼬리말", () => {
  it('Layout 은 홈페이지 주소에서 Navbar·하단 탭바·마이페이지 사이드바·회사 푸터를 그리지 않는다', () => {
    const l = code('components/layout/Layout.tsx');
    expect(l).toContain('const site = isHomepagePath(pathname);');
    // 2026-11-17 — ArtLook 휴대폰 편집 전용 화면(규칙 85)도 틀을 뺀다 · 2026-11-19 — ArtTalk 휴대폰 대화 전용 화면도
    expect(l).toMatch(/const chrome = !site && !bare && !chatBare;/);
    expect(l).toContain('{chrome && <Navbar />}');
    expect(l).toContain('{chrome && <BottomTabBar />}');
    expect(l).toContain('{chrome && <MyPageSideMenu />}');
    expect(l).toMatch(/const footer = chrome && /);
    expect(l).toMatch(/\{footer && <footer/);
    expect(l).not.toMatch(/\{!site && <(Navbar|BottomTabBar|MyPageSideMenu|footer)/);   // 한쪽 조건만 남은 자리가 없다
    // 팝업·알림 배너는 그대로
    for (const keep of ['<HomepageNudge />', '<GuestIntro />', '<PushBanner />']) expect(l).toContain(keep);
  });
  for (const page of ['pages/PortfolioPage.tsx', 'pages/GalleryDetailPage.tsx']) {
    it(`${page} — 로딩·없음·본문 모두 SiteHeader, 본문은 SiteFooter 까지`, () => {
      const c = code(page);
      expect((c.match(/<SiteHeader\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
      expect(c).toMatch(/<SiteFooter\b/);
    });
  }
  it('★ `<main>` 은 한 겹 — Layout 은 홈페이지에서 div 로 감싸고, 두 페이지가 본문 하나만 main 으로 그린다', () => {
    // 2026-11-14 E2E 62 가 잡았다: Layout 의 main 안에 PortfolioPage 의 main 이 또 있었다(main 은 한 문서에 하나 — 화면 낭독기 '본문으로 가기'가 갈 곳을 모른다)
    const l = code('components/layout/Layout.tsx');
    expect(l).toContain("const Shell = site ? 'div' : 'main';");
    expect(l).not.toMatch(/<main\b/);
    expect((code('pages/PortfolioPage.tsx').match(/<main\b/g) ?? []).length).toBe(1);
    expect((code('pages/GalleryDetailPage.tsx').match(/<motion\.main\b|<main\b/g) ?? []).length).toBe(1);
    for (const f of ['components/shared/HomepageView.tsx', 'components/homepage/SiteHeader.tsx', 'components/homepage/SiteFooter.tsx', 'components/homepage/WorkSheet.tsx', 'components/homepage/NewsTab.tsx']) {
      expect(code(f), f).not.toMatch(/<main\b/);
    }
  });
  it('HandleRoute(`/@…`) 도 주인을 찾는 동안·못 찾았을 때 머리를 그린다', () => {
    const app = code('App.tsx');
    expect(app).toMatch(/if \(isLoading\) return <div className="min-h-screen bg-white"><SiteHeader \/>/);
    expect(app).toMatch(/if \(isError \|\| !data\) return <><SiteHeader \/><NotFoundPage \/><\/>/);
  });
  it('★ 탭 줄은 PC·휴대폰 모두 표지 아래 하나 — 머리에는 탭이 없다(2026-11-15 "탭이 우측 상단이라 잘 안 보인다")', () => {
    const header = code('components/homepage/SiteHeader.tsx');
    expect(header).not.toMatch(/role="tablist"/);
    expect(header).not.toMatch(/\btabs\b/);
    const view = code('components/shared/HomepageView.tsx');
    expect(view).not.toMatch(/tabsInHeader|hideOnLg/);
    expect(view).toMatch(/role="tablist" aria-label="홈페이지 메뉴"/);
    expect(code('pages/PortfolioPage.tsx')).not.toMatch(/tabsInHeader/);
    // 갤러리 — 같은 탭 줄(PageTabBar site)이 PC 에서도 보인다
    const bar = code('components/shared/PageTabBar.tsx');
    expect(bar).toContain("'sticky top-14 z-30 -mx-6 bg-[var(--hp-bg)] px-6 md:-mx-12 md:px-12 lg:top-[72px]'");
    expect(bar).not.toMatch(/lg:hidden/);
    expect(code('pages/GalleryDetailPage.tsx')).toMatch(/<PageTabBar [^>]*\bsite\b[^>]*\/>/);
    expect(code('pages/GalleryDetailPage.tsx')).toMatch(/<SiteHeader title=\{gallery\.name\} titleTo=\{homePath\} \/>/);
  });
  it('★ 탭을 누르면 그 탭 내용으로 내려간다 — 새 내용을 그린 뒤(useLayoutEffect) · 지금 탭을 또 눌러도 · 짧은 탭도 붙도록 최소 높이', () => {
    const view = code('components/shared/HomepageView.tsx');
    expect(view).toMatch(/if \(!compact && id === active\) \{ liftToHomepageTabs\(\); return; \}/);
    expect(view).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!liftPending\.current\) return;\s*liftPending\.current = false;\s*liftToHomepageTabs\(\);\s*\}, \[active\]\);/);
    expect(view).toContain('HOMEPAGE_PANEL_MIN_H');
    const gal = code('pages/GalleryDetailPage.tsx');
    expect(gal).toMatch(/if \(tab === activeTab\) \{ liftToHomepageTabs\('gallery-tabs'\); return; \}/);
    expect(gal).toMatch(/liftToHomepageTabs\('gallery-tabs'\);\s*\}, \[rawTabParam\]\);/);
    expect(gal).toContain('HOMEPAGE_PANEL_MIN_H');
  });
});

describe('작품 페이지 · 문의 창', () => {
  it('작품을 누르면 작품 페이지 — 목록에서 열면 기록을 쌓고(push) 넘길 땐 replace, 닫으면 뒤로', () => {
    const p = code('pages/PortfolioPage.tsx');
    expect(p).toContain("const openAt = useCallback((img: PortfolioImage) => setWorkParam(img.id, 'push'), [setWorkParam]);");
    expect(p).toMatch(/onIndex=\{\(i\) => \{ const w = ordered\[i\]; if \(w\) setWorkParam\(w\.id, 'replace'\); \}\}/);
    expect(p).toMatch(/workFromList\) navigate\(-1\)/);
    // 검은 작품 창은 [크게 보기] 로만 — 공유 주소는 그 작품
    expect(p).toMatch(/shareUrl=\{\(i\) => artistUrl\(portfolio\.user, ordered\[i\]\?\.id\)\}/);
  });
  it('작품 페이지·문의 창은 dialog(앱 뒤로가기가 Esc 를 보낸다, 규칙 79) · 위에 창이 있으면 Esc 를 양보한다', () => {
    const w = code('components/homepage/WorkSheet.tsx');
    expect(w).toMatch(/role="dialog"\s+aria-modal="true"/);
    expect(w).toContain('useEscapeKey(onClose, { enabled: !childOpen });');
    expect(code('components/homepage/InquirySheet.tsx')).toMatch(/role="dialog"\s+aria-modal="true"/);
  });
  it('작품은 자르지 않는다(규칙 18) — 작품 페이지·표지·같은 시리즈 모두 contain', () => {
    expect(code('components/homepage/WorkSheet.tsx')).not.toMatch(/object-cover/);
    expect(code('components/shared/HomepageView.tsx').match(/object-cover/g) ?? []).toHaveLength(1);   // 프로필 사진만
  });
  it('비회원 문의 — 동의 칸·숨은 칸을 보낸다 · 회원은 ArtTalk(맥락 카드 — 작품·공모·갤러리, 2026-11-19)', () => {
    const i = code('components/homepage/InquirySheet.tsx');
    expect(i).toContain("api.post('/homepage-inquiries'");
    expect(i).toMatch(/agree: true,\s*website: honeypot\.current\?\.value \?\? ''/);
    // 예전엔 작품 사진을 첨부로 붙였다 — 받는 작가가 그 작품 페이지로 갈 수 없었다. 이제 {type,id} 만 보내고 카드는 서버가 만든다
    expect(i).not.toMatch(/attachmentUrl: work\.url/);
    expect(i).toMatch(/work \? \{ type: 'WORK' as const, id: work\.id \}/);
    expect(i).toMatch(/\.\.\.\(ref \? \{ ref \} : \{\}\)/);
    // 보낸 뒤 대화 목록을 다시 받게 한다 — 안 하면 ArtTalk 목록이 5분 동안 옛 캐시(2026-11-19 신고)
    expect(i).toContain('chatsChanged(qc);');
    expect(i).toContain('[필수] 개인정보 수집·이용 및 제공 동의');
  });
});
