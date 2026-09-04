/**
 * 마이페이지 메뉴 정의 (lib/myPageMenu.ts)
 *
 * 이 목록은 **세 곳**이 함께 쓴다 — 전 페이지 우측 사이드바(MyPageSideMenu),
 * lg↓ Navbar [메뉴] 안의 목록, 그리고 MyPage 본문의 탭 분기.
 * 그래서 "메뉴에는 있는데 눌러도 빈 화면" 같은 어긋남이 조용히 생길 수 있어 소스까지 대조한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { myPageTabs, myPageHref, resolveTab, tabHref, hiddenTabs, HOMEPAGE_EDIT_HREF, MYPAGE_FOOTER_LINKS, MYPAGE_PRIMARY_LINKS, tabNameParts } from '@/lib/myPageMenu';

const ROLES = ['ARTIST', 'GALLERY', 'ADMIN'] as const;

describe('myPageTabs — 역할별 메뉴', () => {
  it.each(ROLES)('%s 는 프로필로 시작한다 (기본 탭)', (role) => {
    expect(myPageTabs(role)[0].id).toBe('profile');
  });

  it.each(ROLES)('%s 메뉴에 id 중복이 없다', (role) => {
    const ids = myPageTabs(role).map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ROLES)('%s 메뉴는 모두 라벨과 아이콘을 갖는다', (role) => {
    for (const t of myPageTabs(role)) {
      expect(t.label.trim().length, `${t.id} 라벨 없음`).toBeGreaterThan(0);
      expect(t.icon, `${t.id} 아이콘 없음`).toBeTruthy();
    }
  });

  it('역할이 없거나 모르는 값이면 빈 배열 — 비로그인에게 사이드바를 띄우지 않기 위함', () => {
    expect(myPageTabs(undefined)).toEqual([]);
    expect(myPageTabs(null)).toEqual([]);
    expect(myPageTabs('SOMETHING_ELSE')).toEqual([]);
  });

  it('역할끼리 메뉴가 섞이지 않는다', () => {
    const artist = myPageTabs('ARTIST').map(t => t.id);
    const gallery = myPageTabs('GALLERY').map(t => t.id);
    const admin = myPageTabs('ADMIN').map(t => t.id);
    expect(artist).toContain('portfolio');
    expect(gallery).not.toContain('portfolio');
    expect(admin).not.toContain('portfolio');
    expect(admin).toContain('approvals');
    expect(artist).not.toContain('approvals');
    expect(gallery).not.toContain('approvals');
  });
});

describe('resolveTab — 잘못된 ?tab= 폴백', () => {
  it('역할에 있는 탭은 그대로 통과', () => {
    expect(resolveTab('ARTIST', 'portfolio')).toBe('portfolio');
    expect(resolveTab('ADMIN', 'todo')).toBe('todo');
  });

  it('★ 다른 역할의 탭으로 들어오면 프로필로 폴백한다 (빈 화면 방지)', () => {
    // 갤러리 계정이 ?tab=portfolio 로 들어오면 예전엔 아무것도 안 그려졌다
    expect(resolveTab('GALLERY', 'portfolio')).toBe('profile');
    expect(resolveTab('ARTIST', 'approvals')).toBe('profile');
  });

  it('없는 값·빈 값·null 도 프로필', () => {
    for (const v of ['', 'zzz', null, undefined]) {
      expect(resolveTab('ARTIST', v)).toBe('profile');
    }
  });

  it('역할을 모르면(비로그인) profile 을 돌려준다 — 사이드바는 어차피 안 뜬다', () => {
    expect(resolveTab(null, 'portfolio')).toBe('profile');
  });
});

describe('myPageHref — 메뉴 항목이 가리키는 주소', () => {
  it('프로필은 기본 탭이라 쿼리를 붙이지 않는다', () => {
    expect(myPageHref('profile')).toBe('/mypage');
  });

  it('나머지는 ?tab= 이 붙는다', () => {
    expect(myPageHref('favorites')).toBe('/mypage?tab=favorites');
    expect(myPageHref('dev-tools')).toBe('/mypage?tab=dev-tools');
  });

  it.each(ROLES)('%s 의 모든 메뉴가 /mypage 로 간다', (role) => {
    for (const t of myPageTabs(role)) {
      expect(myPageHref(t.id).startsWith('/mypage')).toBe(true);
    }
  });
});

describe('★ 메뉴와 MyPage 본문이 어긋나지 않는다', () => {
  // 메뉴에만 추가하고 MyPage 분기를 빼먹으면 **에러 없이 빈 화면**이 된다.
  // (역할 폴백에도 안 걸린다 — id 는 유효하니까.) 그래서 소스를 직접 대조한다.
  const source = readFileSync(resolve(__dirname, '../pages/MyPage.tsx'), 'utf-8');
  const hasBranch = (id: string) => source.includes(`currentTab === '${id}'`);

  it.each(ROLES)('%s 의 모든 탭에 대응하는 콘텐츠 분기가 MyPage.tsx 에 있다', (role) => {
    const missing = myPageTabs(role)
      .filter(t => !t.linkTo) // 바깥 링크(홈페이지)는 탭이 아니라 분기가 없는 게 맞다
      .map(t => t.id)
      .filter(id => !hasBranch(id));
    expect(missing, `MyPage.tsx 에 분기 없음 → 누르면 빈 화면: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(ROLES)('%s 의 숨은 탭(메뉴엔 없지만 버튼으로 들어가는 것)도 분기가 있다', (role) => {
    const missing = hiddenTabs(role).filter(id => !hasBranch(id));
    expect(missing, `숨은 탭인데 분기 없음: ${missing.join(', ')}`).toEqual([]);
  });

  it('★ 바깥 링크 항목(linkTo)에는 MyPage 분기가 없어야 한다', () => {
    // 분기가 생기면 그 id 로 /mypage?tab= 진입이 가능해져 '홈페이지'가 두 곳에 존재하게 된다
    const linkOuts = ROLES.flatMap(r => myPageTabs(r)).filter(t => t.linkTo).map(t => t.id);
    expect(linkOuts.length, '바깥 링크 항목이 하나는 있어야 한다(홈페이지)').toBeGreaterThan(0);
    expect(linkOuts.filter(hasBranch)).toEqual([]);
  });

  it('MyPage.tsx 의 분기 중 메뉴에도 숨은 탭에도 없는 것은 없다 (죽은 분기)', () => {
    const known = new Set([
      ...ROLES.flatMap(r => myPageTabs(r).filter(t => !t.linkTo).map(t => t.id)),
      ...ROLES.flatMap(r => hiddenTabs(r)),
    ]);
    const branched = [...source.matchAll(/currentTab === '([\w-]+)'/g)].map(m => m[1]);
    const orphan = [...new Set(branched)].filter(id => !known.has(id));
    expect(orphan, `메뉴에 없는데 분기만 남아 있음: ${orphan.join(', ')}`).toEqual([]);
  });
});

describe('홈페이지 항목 — 공개 작가 페이지로 나간다', () => {
  const homepage = myPageTabs('ARTIST').find(t => t.id === 'homepage')!;

  it('작가 메뉴에 [홈페이지]가 있고 바깥 링크다', () => {
    expect(homepage).toBeTruthy();
    expect(homepage.label).toBe('홈페이지');
    expect(homepage.linkTo).toBeTypeOf('function');
  });

  it('tabHref 가 공개 작가 페이지를 가리킨다', () => {
    expect(tabHref(homepage, 42)).toBe('/portfolio/42');
  });

  it('userId 를 모르면 마이페이지로 떨어뜨린다 (/portfolio/undefined 방지)', () => {
    expect(tabHref(homepage, null)).toBe('/mypage');
    expect(tabHref(homepage, undefined)).toBe('/mypage');
  });

  it('일반 탭은 그대로 마이페이지 주소', () => {
    const portfolio = myPageTabs('ARTIST').find(t => t.id === 'portfolio')!;
    expect(portfolio.label).toBe('포트폴리오');
    expect(tabHref(portfolio, 42)).toBe('/mypage?tab=portfolio');
  });

  it('★ resolveTab 은 바깥 링크 id 를 절대 돌려주지 않는다', () => {
    // ?tab=homepage 로 들어와도 열 화면이 없다 → 프로필로 보내야 한다
    expect(resolveTab('ARTIST', 'homepage')).toBe('profile');
  });

  it('숨은 탭 homepage-edit 는 유효한 탭이다 (공개페이지 [수정] 진입점)', () => {
    expect(resolveTab('ARTIST', 'homepage-edit')).toBe('homepage-edit');
    expect(HOMEPAGE_EDIT_HREF).toBe('/mypage?tab=homepage-edit');
    // 작가만 — 갤러리/Admin 이 그 주소로 들어오면 프로필로
    expect(resolveTab('GALLERY', 'homepage-edit')).toBe('profile');
    expect(resolveTab('ADMIN', 'homepage-edit')).toBe('profile');
  });
});

/*
 * ─────────────────────────────────────────────────────────────
 * 메뉴 구성 자체 — 최근에 크게 바뀐 자리라 내용을 못 박아 둔다.
 * (받은 초대 탭 삭제 → 내 전시로 통합 / 좋아요한 작품 → 찜 목록 안 / 내 리뷰 삭제 /
 *  홈페이지·포트폴리오 분리 / ArtLook 추가 / 로그아웃은 사이드바 맨 아래)
 * 여기 목록을 고칠 때는 CLAUDE.md 의 '마이페이지 및 권한' 절도 같이 고칠 것.
 * ─────────────────────────────────────────────────────────────
 */
describe('메뉴 구성 (2026-08-28 기준)', () => {
  it('작가 메뉴는 프로필·홈페이지·포트폴리오·찜 목록·내 전시·ArtLook·ArtStory 순', () => {
    expect(myPageTabs('ARTIST').map(t => t.id)).toEqual([
      'profile', 'homepage', 'portfolio', 'favorites', 'applications', 'artlook', 'artstory',
    ]);
  });

  it('★ 없앤 탭이 되살아나지 않는다 (받은 초대·좋아요한 작품·내 리뷰)', () => {
    const ids = myPageTabs('ARTIST').map(t => t.id);
    for (const gone of ['invites', 'received-invites', 'my-likes', 'likes', 'reviews', 'my-reviews']) {
      expect(ids, `${gone} 는 다른 곳으로 합쳐졌다`).not.toContain(gone);
    }
  });

  it('갤러리 메뉴는 프로필·내 갤러리·내 공모·내 전시·관심 작품', () => {
    expect(myPageTabs('GALLERY').map(t => t.id)).toEqual([
      'profile', 'my-galleries', 'my-exhibitions', 'my-shows', 'scraps',
    ]);
  });

  it('Admin 메뉴에 운영 도구가 모두 있다', () => {
    const ids = myPageTabs('ADMIN').map(t => t.id);
    for (const need of ['approvals', 'hosted-exhibitions', 'oversight', 'todo', 'dev-tools']) {
      expect(ids).toContain(need);
    }
  });
});

describe('브랜드 이름 규칙 (ArtLink 로고: 앞 검정 + 뒤 빨강)', () => {
  it('★ 메뉴에서 색을 쓰는 항목은 ArtLook·ArtStory (브랜드 이름)', () => {
    // 화면 이름(HomePage·PortFolio·MyPicks·ArtTalk)은 **화면 좌측 상단**에 찍는다.
    // 메뉴 라벨까지 전부 색을 넣으면 로고 규칙이 헐거워져 브랜드로 안 읽힌다.
    // ArtLook(액자), ArtStory(소식)만 브랜드 이름이라 메뉴에서도 색을 쓴다.
    const branded = (['ARTIST', 'GALLERY', 'ADMIN'] as const)
      .flatMap(r => myPageTabs(r))
      .filter(t => t.brand)
      .map(t => t.id);
    expect([...new Set(branded)]).toEqual(['artlook', 'artstory']);
  });

  it('ArtLook 은 Art + Look 으로 쪼개지고 무엇인지 옆에 적는다', () => {
    const artlook = myPageTabs('ARTIST').find(t => t.id === 'artlook')!;
    expect(tabNameParts(artlook)).toEqual(['Art', 'Look']);
    expect(artlook.note).toBe('액자 걸기');   // ArtLink 와 헷갈리므로
  });

  it('브랜드가 없는 항목은 라벨 그대로 (뒤 조각이 비어 있다)', () => {
    const favorites = myPageTabs('ARTIST').find(t => t.id === 'favorites')!;
    expect(tabNameParts(favorites)).toEqual(['찜 목록', '']);
  });

  it('★ 찜 목록 라벨은 한글이다 — MyPicks 는 화면 좌측 상단에 찍는다', () => {
    expect(myPageTabs('ARTIST').find(t => t.id === 'favorites')!.label).toBe('찜 목록');
  });
});

describe('사이드바 맨 아래 (로그아웃 바로 위)', () => {
  it('★ 1:1 문의가 있다 — Navbar 에서 [고객센터]를 뺐으므로 유일한 문의 경로다', () => {
    expect(MYPAGE_FOOTER_LINKS.map(l => l.to)).toContain('/support');
  });

  it('아래/위 링크는 역할별 메뉴와 겹치지 않는다', () => {
    const allIds = (['ARTIST', 'GALLERY', 'ADMIN'] as const).flatMap(r => myPageTabs(r).map(t => myPageHref(t.id)));
    for (const link of [...MYPAGE_FOOTER_LINKS, ...MYPAGE_PRIMARY_LINKS]) expect(allIds).not.toContain(link.to);
  });

  it('★ ArtStory(소식)는 메뉴 탭(ARTIST_TABS), 1:1 문의는 구분선 아래(footer)', () => {
    // ArtStory는 이제 ARTIST_TABS의 탭이라 PRIMARY_LINKS에는 없다.
    expect(MYPAGE_PRIMARY_LINKS.map(l => l.to)).not.toContain('/feed');
    expect(MYPAGE_FOOTER_LINKS.map(l => l.to)).not.toContain('/feed');
    expect(MYPAGE_FOOTER_LINKS.map(l => l.to)).toContain('/support');
  });
});
