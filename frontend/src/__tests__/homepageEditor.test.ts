/**
 * 작가 홈페이지 편집 화면 — 되돌아가면 안 되는 것들을 소스로 고정한다 (2026-10-02)
 *
 * 전부 **에러 없이 조용히** 나빠지는 종류다. jsdom 은 레이아웃을 못 재고(가림·화면 밖), E2E 는 크롬만 돈다.
 * 눌러서 확인하는 건 e2e `62-homepage-editor.spec.ts`, 화면·사파리 엔진 실측은 `scratchpad/homepage-edit/walk.js`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');
/**
 * 주석을 뺀 코드 — 주석에 적힌 옛 이름·옛 클래스에 속지 않게.
 * ⚠️ 블록 주석은 **줄 머리에서 시작하는 것**만 지운다. 아무 데서나 `/*` 를 주석으로 보면 `accept="image/*"` 에서 시작해
 *    다음 `*​/` 까지 코드를 통째로 삼킨다(MyPage 에서 실제로 그랬다).
 */
const strip = (code: string) => code
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .replace(/^\s*\/\/.*$/gm, '');
const editorFiles = readdirSync(join(SRC, 'components/homepage-edit')).filter((f) => f.endsWith('.tsx')).map((f) => `components/homepage-edit/${f}`);
const editor = strip(read('components/homepage-edit/HomepageEditor.tsx'));
const works = strip(read('components/homepage-edit/WorksSection.tsx'));
const sections = strip(read('components/homepage-edit/sections.tsx'));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('저장 바 — 모바일에서 하단 탭바에 가리지 않는다', () => {
  it('★ 탭바 높이만큼 띄워 붙인다(lg 이상은 바닥) — `bottom-0` 이면 탭바(z-40) 밑에 깔린다', () => {
    const bar = editor.match(/<div data-save-bar className="([^"]+)"/)?.[1] ?? '';
    expect(bar).toContain('sticky');
    expect(bar).toContain('bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]');
    expect(bar).toContain('lg:bottom-0');
    expect(bar.split(/\s+/)).not.toContain('bottom-0');
    // 하단 탭바와 같은 값이어야 한다(Layout 의 본문 아래 여백)
    expect(read('components/layout/Layout.tsx')).toContain('pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))]');
  });

  it('한 줄이다 — 좁은 화면에서 글자와 버튼이 두 줄로 꺾이면 첫 화면의 버튼을 가린다', () => {
    // 안내 글자는 sm 이상에서만. 버튼은 줄바꿈하지 않는다
    expect(editor).toMatch(/'mr-auto hidden min-w-0 break-keep text-xs sm:block'/);
    expect(editor).toMatch(/btnPrimary = '[^']*whitespace-nowrap[^']*shrink-0|btnPrimary = '[^']*shrink-0[^']*whitespace-nowrap/);
    expect(editor).not.toMatch(/data-save-bar[\s\S]{0,400}flex-wrap/);
  });

  it('고친 것도 작품도 없으면 바를 그리지 않는다 · 고친 게 없으면 [저장] 대신 [내 홈페이지 보기]', () => {
    expect(editor).toContain('(dirty || images.length > 0) && (');
    // 고쳤으면 [취소]·[저장], 아니면 그 자리에 [내 홈페이지 보기] (버튼 속성에 `=>` 가 있어 `[^>]*` 로는 못 잡는다)
    expect(editor).toMatch(/\{dirty \? \(\s*<>[\s\S]{0,900}?저장[\s\S]{0,200}?<\/>\s*\) : \(\s*<button[\s\S]{0,160}?>내 홈페이지 보기<\/button>/);
  });
});

describe('약력은 필수가 아니다', () => {
  it('★ 저장을 막는 약력 검사가 없다 — 한 줄 소개만 써도 저장된다', () => {
    for (const f of [...editorFiles, 'pages/MyPage.tsx']) {
      const code = strip(read(f));
      expect(code, f).not.toContain('작가 약력을 입력해주세요');
      expect(code, f).not.toMatch(/if \(!biography\.trim\(\)\)/);
    }
    // 별표(필수 표시)도 없다
    expect(sections).not.toMatch(/약력[^<]*<span className="text-accent">\*/);
  });
});

describe("작품 노출 — '공개/비공개' 라고 부르지 않는다", () => {
  it("★ 단추 글자는 '작가 탭에도 / 홈페이지에만' — 비공개라 적힌 작품도 홈페이지엔 다 보였다", () => {
    expect(works).toContain("'작가 탭에도'");
    expect(works).toContain("'홈페이지에만'");
    expect(works).not.toMatch(/['">]\s*(비공개|공개)\s*['"<]/);
    for (const f of editorFiles) expect(strip(read(f)), f).not.toContain('둘러보기');
  });

  it('★ 원하는 상태를 적어 보낸다(PUT) — 토글(PATCH)을 여러 번 부르지 않는다', () => {
    expect(works).toContain("api.put('/portfolio/images/explore', { ids: v.ids, show: v.show })");
    expect(works).not.toMatch(/api\.patch\(`\/portfolio\/images\/\$\{[^}]+\}\/explore`/);
  });

  it('올린 직후 한 번 묻는다 — 말없이 내보내지도, 말없이 숨기지도 않는다', () => {
    expect(works).toContain('방금 올린 ${pendingAsk.length}점은 지금 내 홈페이지에만 보여요');
    expect(works).toContain('작가 탭에도 소개');
    expect(works).toContain('홈페이지에만 두기');
  });
});

describe('작품 정보 — 이어서 넣는다', () => {
  const modal = strip(read('components/shared/ArtworkMetaModal.tsx'));
  it('★ [저장하고 다음 작품] 이 있고, 다음 작품은 저장 전 목록으로 정한다', () => {
    expect(modal).toContain('저장하고 다음 작품');
    expect(modal).toMatch(/onSave\(d, hasNext\)/);          // 주 버튼 = 다음 작품이 있으면 이어서
    expect(works).toContain('nextUncaptionedId(images, v.imageId)');
  });

  it('★ Enter 는 저장이 아니라 다음 칸 — 작품명만 치고 Enter 를 눌러도 다음 작품으로 넘어가지 않는다', () => {
    // 제출 버튼이 하나라도 있으면 브라우저가 Enter 로 폼을 낸다(아이폰 자판의 [이동] 포함) → 주 버튼이 눌려 사진이 바뀐다
    expect(modal).not.toMatch(/type="submit"/);
    expect(modal).toContain('onSubmit={(e) => e.preventDefault()}');
    // 칸 순서 = 캡션 순서
    expect(modal).toContain("const MAIN_FIELDS = ['meta-title', 'meta-year', 'meta-medium', 'meta-size-h', 'meta-size-w']");
    // 한글 조합 중의 Enter 는 건드리지 않는다
    expect(modal).toContain('e.nativeEvent.isComposing');
  });

  it('올리는 중에 묶음을 바꿔도 [작품] 묶음은 살아 있다 — 떼어 내지 않고 감춘다', () => {
    const editor = strip(read('components/homepage-edit/HomepageEditor.tsx'));
    expect(editor).toContain("<div hidden={section !== 'works'}>");
    expect(editor).not.toMatch(/section === 'works' && <WorksSection/);
    expect(read('components/homepage-edit/WorksSection.tsx')).toContain('export default memo(WorksSection)');
  });

  it('홈페이지와 같은 함수로 캡션을 미리 보여 준다 · 전에 쓴 재료·연도를 권한다', () => {
    expect(modal).toContain('museumCaption(d)');
    expect(works).toContain("recentValues(images, 'medium', 3, metaImage.id)");
    expect(works).toContain("recentValues(images, 'year', 3, metaImage.id)");
  });

  it("칸 아래 글자는 '무제' 로 채우지 않는다 — 정보를 안 넣은 작품이 넣은 것처럼 보인다", () => {
    expect(works).toContain('tileLabel(img)');
    expect(works).not.toContain('artworkTitle(');
  });
});

describe('옛 편집 화면이 되살아나지 않았다', () => {
  const myPage = strip(read('pages/MyPage.tsx'));
  it('MyPage 에 옛 한 장짜리 폼·작품 격자가 없다', () => {
    expect(myPage).not.toContain('function PortfolioSection');
    expect(myPage).not.toContain('function PortfolioImageGrid');
    expect(myPage).toContain("currentTab === 'homepage-edit' && user.role === 'ARTIST' && <HomepageEditor />");
  });

  it('★ 편집 화면에서는 프로필 카드·가로 탭바를 그리지 않는다 — 첫 화면이 작품 올리기여야 한다', () => {
    expect(myPage).toContain('{!focused && <ProfileCard />}');
    expect(myPage).toContain("focused && 'hidden'");
  });

  it('읽기 화면(편집을 취소하면 나오던 옛 관리 화면)이 없다 — [취소] 는 공개 홈페이지로 간다', () => {
    for (const f of editorFiles) {
      const code = strip(read(f));
      expect(code, f).not.toContain('등록된 약력이 없습니다');
      expect(code, f).not.toContain('setEditing(');
    }
    expect(editor).toMatch(/onConfirm=\{\(\) => \{ setLeaveOpen\(false\); navigate\(home\); \}\}/);
  });
});

describe('★ 편집 화면으로 보내는 주소는 editHref 로만 만든다', () => {
  // 주소를 손으로 적으면 묶음 이름을 바꿀 때 한 곳만 남아 조용히 [작품] 묶음으로 떨어진다
  const ALLOW = new Set(['lib/homepageEdit.ts', 'lib/myPageMenu.ts', 'lib/postLoginRedirect.ts']);
  const files = walk(SRC).map((p) => p.slice(SRC.length + 1).replace(/\\/g, '/')).filter((f) => !ALLOW.has(f));

  it('`tab=homepage-edit` 뒤에 묶음·칸·#artworks 를 손으로 붙인 곳이 없다', () => {
    const hits: string[] = [];
    for (const f of files) {
      strip(read(f)).split('\n').forEach((line, i) => {
        if (/tab=homepage-edit[&#]/.test(line)) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('완성도 항목·프로필 탭의 한 줄·빈 홈페이지·공개 페이지의 [수정] 이 editHref 를 쓴다', () => {
    expect(strip(read('lib/completeness.ts'))).toContain("from './homepageEdit'");
    expect(strip(read('components/shared/ArtistHomepageLine.tsx'))).toContain("editHref('works')");
    const page = strip(read('pages/PortfolioPage.tsx'));
    expect(page).toContain('editHref(editSectionForTab(tabParam))');
    expect(page).toContain("editHref('works')");
  });
});

describe('홈페이지 완성도 안내 — 프로필 탭의 한 줄뿐 (2026-10-02 사용자 결정)', () => {
  // 예전엔 '홈페이지 완성도' 상자(진행 막대 + 5칸 목록)가 프로필·포트폴리오·ArtLook 세 탭 위에 붙어 있었다.
  // 로그인 팝업과 같은 말을 두 번 했고, PDF 를 만들러 온 [포트폴리오] 탭에서는 본 내용을 밀어냈다("지저분하다").
  const myPage = strip(read('pages/MyPage.tsx'));
  const line = strip(read('components/shared/CompletenessLine.tsx'));
  const profileLine = strip(read('components/shared/ArtistHomepageLine.tsx'));

  it('★ [프로필] 탭에만 붙는다 — [포트폴리오]·[ArtLook] 탭 위에는 없다', () => {
    expect(myPage).toContain("user.role === 'ARTIST' && currentTab === 'profile' && <ArtistHomepageLine />");
    expect(myPage.match(/<ArtistHomepageLine/g)).toHaveLength(1);
    expect(myPage).not.toMatch(/'portfolio'[^\n]*<ArtistHomepageLine|'artlook'[^\n]*<ArtistHomepageLine/);
  });

  it('★ 옛 상자(ArtistChecklist)가 되살아나지 않았다 — 진행 막대도, 5칸 목록도, 닫기 버튼도 없다', () => {
    const files = walk(SRC).map((p) => p.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(files).not.toContain('components/shared/ArtistChecklist.tsx');
    for (const f of files) expect(strip(read(f)), f).not.toMatch(/<ArtistChecklist|artlink-checklist-dismissed/);
    for (const code of [line, profileLine]) {
      expect(code).not.toContain('percent');        // 진행 막대
      expect(code).not.toContain('line-through');   // 끝낸 항목까지 늘어놓던 목록
      expect(code).not.toContain('sessionStorage'); // [나중에]
    }
  });

  it('프로필 탭과 편집 화면이 같은 한 줄(CompletenessLine)을 쓴다 — 편집 화면은 버튼, 프로필은 링크', () => {
    expect(profileLine).toContain('<CompletenessLine');
    expect(profileLine).not.toContain('onItem');                                  // 링크(다른 화면으로 간다)
    expect(editor).toContain('<CompletenessLine completeness={completeness} onItem={goItem}');   // 버튼(그 자리에서 묶음을 바꾼다)
    expect(line).toContain('<Link to={it.href}');
    expect(line).toContain('overflow-x-auto');   // 한 줄 — 넘치면 옆으로 민다
  });

  it('작품이 0점이면 칩 다섯을 늘어놓지 않는다 — 할 일은 하나(작품 올리기)', () => {
    expect(profileLine).toContain('images.length === 0');
    expect(profileLine).toContain("to={editHref('works')}");
    expect(profileLine).toContain("action: '작품 올리기'");
  });
});

describe('홈페이지 주소 칸은 하나다', () => {
  it('프로필 탭과 [꾸미기] 가 같은 부품(HomepageAddressField)을 쓴다 — 규칙은 lib/handle.ts 에서만 읽는다', () => {
    expect(strip(read('pages/MyPage.tsx'))).toContain('<HomepageAddressField');
    expect(sections).toContain('<HomepageAddressField');
    const field = strip(read('components/shared/HomepageAddressField.tsx'));
    expect(field).toContain("from '@/lib/handle'");
    expect(field).not.toMatch(/\/\^\[a-z0-9/);   // 정규식을 여기 다시 적지 않는다
  });
});
