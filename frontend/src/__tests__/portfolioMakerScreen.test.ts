/**
 * 포트폴리오 PDF 만들기 화면 — 소스 가드 (2026-10-03 개편)
 *
 * jsdom 은 레이아웃을 못 재고 화면을 실제로 그리지도 않는다. 그래서 **되돌아가기 쉬운 것**을 소스로 막는다
 * (기하는 `scratchpad/portfolio-maker/walk.js`, 눌러서 무슨 일이 나는지는 e2e 64).
 *
 * 2026-10-02 조사에서 드러난 것들이다:
 *  - 첫 화면에 결과물도 저장 버튼도 없었다(프로필 카드 아래 y409 에서 시작, [PDF 저장] y856).
 *  - 휴대폰에서 아래 바가 하단 탭바 밑에 깔리면 눌리지 않는다(홈페이지 편집에서 실제로 겪었다 — 규칙 60).
 *  - [PDF 저장] 이 인쇄 창을 열었고, 안 열려도 성공 토스트가 떴다. 토스트는 아래에 떠서 버튼을 가렸다.
 *  - 디자인을 저장할 때마다 약력·경력·파일까지 통째로 다시 보냈다(다른 탭에서 고친 글이 되돌아갔다).
 *  - 표지 이름·마지막 장 연락처가 무엇으로 찍히는지 알 수 없었다.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');
/** 주석을 뺀 소스 — 주석에 적어 둔 옛 말(자동 편집·버전…)에 걸리지 않게 */
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([^:"'`])\/\/ .*$/gm, '$1');
const MAKER_DIR = 'components/portfolio-maker';
const makerFiles = readdirSync(join(SRC, MAKER_DIR)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${MAKER_DIR}/${f}`);
const makerCode = makerFiles.map(code).join('\n');

describe('화면 틀 — 미리보기가 주인공', () => {
  it('★ 마이페이지는 이 화면에서 프로필 카드·가로 탭바를 그리지 않는다(편집 화면과 같은 focused)', () => {
    const my = read('pages/MyPage.tsx');
    expect(my).toMatch(/const focused = \(currentTab === 'homepage-edit' \|\| currentTab === 'portfolio'( \|\| currentTab === 'artlook')?\) && user\.role === 'ARTIST'/);
    expect(my).toContain("{currentTab === 'portfolio' && user.role === 'ARTIST' && <PortfolioMaker />}");
  });

  it('옛 화면은 남아 있지 않다 — MyPage 안의 섹션·옛 피커 파일', () => {
    const my = read('pages/MyPage.tsx');
    expect(my).not.toContain('PortfolioFormatSection');
    expect(my).not.toContain('PortfolioFormatPicker');
    expect(existsSync(join(SRC, 'components/shared/PortfolioFormatPicker.tsx'))).toBe(false);
    expect(existsSync(join(SRC, 'components/shared/PortfolioWorkPicker.tsx'))).toBe(false);
  });

  it('★ 아래 바는 모바일에서 하단 탭바 위에 붙는다 — bottom-0 이면 탭바 밑에 깔려 눌리지 않는다', () => {
    const bar = read(`${MAKER_DIR}/MakerBar.tsx`);
    expect(bar).toContain('sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]');
    expect(bar).toContain('lg:bottom-0');
    expect(bar).toContain('z-30');
    // 하단 탭바는 z-40 — 바가 그 위로 올라가면 탭바를 덮는다
    expect(read('components/layout/BottomTabBar.tsx')).toMatch(/z-40/);
  });

  it('아래 바는 한 줄 — 좁은 화면에서는 아이콘을 빼고 저장 상태 글자를 감춘다', () => {
    const bar = code(`${MAKER_DIR}/MakerBar.tsx`);
    expect(bar).toContain("hidden min-[380px]:inline");
    expect(bar).toMatch(/role="status" className="[^"]*hidden[^"]*sm:flex/);
    expect(bar).not.toContain('flex-wrap');
  });

  it('검정 주 버튼은 [PDF 저장] 하나다 — 바 안에 bg-gray-900 버튼이 하나뿐', () => {
    const bar = code(`${MAKER_DIR}/MakerBar.tsx`);
    expect(bar.match(/bg-gray-900/g)?.length).toBe(1);
    expect(bar).toMatch(/bg-gray-900[^"]*"[^>]*>\s*<FileDown[^>]*\/> PDF 저장/);
  });

  it('미리보기 옆 열에 items-start 를 주지 않는다 — 꾸미기 패널(sticky)이 따라올 여지가 사라진다', () => {
    const m = code(`${MAKER_DIR}/PortfolioMaker.tsx`);
    expect(m).toContain('className="mt-3 sm:mt-4 lg:flex lg:gap-6"');
    expect(m).not.toMatch(/lg:flex[^"]*items-start/);
  });

  it('★ 편집은 처음부터 보인다 — 넓은 화면은 패널이 열린 채로, 좁은 화면은 아래 바에 탭 줄이 늘 있다(2026-10-03 사용자 지적 "못 찾을 수도")', () => {
    // 첫 판은 닫힌 채로 시작했다
    const m = code(`${MAKER_DIR}/PortfolioMaker.tsx`);
    expect(m).toContain('useState<CustomizeTab | null>(() => (window.innerWidth >= 1024 ? lastTab() : null))');
    const bar = code(`${MAKER_DIR}/MakerBar.tsx`);
    expect(bar).toMatch(/role="group" aria-label="편집" className="[^"]*lg:hidden/);
    expect(bar).toContain('CUSTOMIZE_TABS.map');
    expect(bar).toContain('onClick={() => onTab(t.id)}');
    // 넓은 화면의 [꾸미기](패널 열고 닫기)는 좁은 화면에서 숨는다 — 거기는 탭 줄이 그 일을 한다
    expect(bar).toMatch(/hidden lg:inline-flex[^>]*>\s*<SlidersHorizontal/);
  });

  it('좁은 화면의 꾸미기 시트는 뒤 화면을 잠그지 않는다 — 위쪽에 미리보기가 보이고 스크롤돼야 한다', () => {
    const p = code(`${MAKER_DIR}/CustomizePanel.tsx`);
    expect(p).not.toContain("document.body.style.overflow");
    expect(p).toContain('z-50');   // 하단 탭바(z-40)·아래 바(z-30)를 덮는다
  });
});

describe('말 — 처음 온 작가가 읽는 글자', () => {
  it("★ '자동 편집'·'버전'·'판형'·'세부'·'이미지형' 같은 옛 말이 화면에 없다", () => {
    for (const word of ['자동 편집', '판형', '이미지형', '+ 버전', '새 버전', '>세부<']) {
      expect(makerCode, word).not.toContain(word);
    }
    // '버전' 은 주소(`/portfolio/versions`)·타입 이름으로만 남는다 — 작가가 보는 글자로는 없다
    const visible = makerCode.replace(/\/portfolio\/versions/g, '').replace(/[A-Za-z]*[Vv]ersions?[A-Za-z]*/g, '');
    expect(visible).not.toContain('버전');
  });

  it("빈 화면에 '포맷' 이 없다 — 작품을 올리면 PDF 가 만들어진다고 말한다", () => {
    expect(makerCode).not.toContain('포맷');
    expect(makerCode).toContain('작품을 올리면 포트폴리오 PDF 가 바로 만들어집니다.');
  });

  it('작품 정보 안내는 누를 수 있다(작품 정보 입력 창으로) — 빨간 글씨 한 줄이 아니다', () => {
    const m = code(`${MAKER_DIR}/PortfolioMaker.tsx`);
    expect(m).toMatch(/<TaskLine[\s\S]*?to=\{editHref\('works', \{ info: true \}\)\}/);
  });

  it("편집 화면으로 가는 주소는 editHref 로 만든다 — 손으로 적은 'tab=homepage-edit' 가 없다", () => {
    expect(makerCode).not.toContain('tab=homepage-edit');
  });
});

describe('저장 — 바로 내려받기가 기본', () => {
  const dlg = code(`${MAKER_DIR}/SaveDialog.tsx`);

  it('★ 주 버튼은 [PDF 내려받기] 이고 인쇄 창은 접어 둔 "다른 형식" 안에 있다', () => {
    expect(dlg).toMatch(/onClick=\{download\}[^>]*>\s*<FileDown[^>]*\/> PDF 내려받기/);
    const other = dlg.slice(dlg.indexOf('title="다른 형식으로 저장"'));
    expect(other).toContain('onClick={print}');
    expect(other).toContain('onClick={pptx}');
    // 인쇄 창을 누르기 **전에** 순서를 보여 준다
    expect(dlg.indexOf("'PDF로 저장'")).toBeLessThan(dlg.indexOf('onClick={print}'));
  });

  it('★ 저장하기 전에 무엇이 실리는지 보여 준다(이름 · 마지막 장) — 저장 창과 꾸미기가 같은 함수를 쓴다', () => {
    expect(dlg).toContain('printedInfo(book, design)');
    expect(dlg).toContain('이렇게 실립니다');
    expect(code(`${MAKER_DIR}/customizeTabs.tsx`)).toContain('printedInfo(book, design)');
  });

  it('홈페이지에 올리기는 기본 꺼짐이고, 공개된다는 것을 그 자리에서 말한다', () => {
    expect(dlg).toContain('useState(false)');
    expect(dlg).toMatch(/const \[alsoUpload, setAlsoUpload\] = useState\(false\)/);
    expect(dlg).toContain('방문자 누구나 볼 수 있고');
  });

  it('빈 칸이 있는 파일은 공개 홈페이지에 올리지 않는다', () => {
    expect(dlg).toMatch(/if \(r\.missing\.length > 0\) up = 'skipped-missing'/);
  });

  it('★ 결과를 토스트로 알리지 않는다 — 토스트는 아래에 떠서 버튼을 가렸다', () => {
    expect(dlg).not.toContain('toast');
    expect(code(`${MAKER_DIR}/WorkPicker.tsx`)).not.toContain('toast');
    // 화면 전체에서도 성공 토스트는 쓰지 않는다(오류만)
    expect(makerCode).not.toContain('toast.success');
  });

  it('인쇄 창이 안 열렸으면 그렇게 말한다 — 성공이라고 하지 않는다', () => {
    expect(dlg).toContain('stage.opened ?');
    expect(dlg).toContain('이 브라우저에서는 인쇄 창이 열리지 않았어요');
    const print = code('lib/portfolioPrint.ts');
    expect(print).toContain("win.addEventListener('beforeprint'");
    expect(print).toMatch(/export async function printDocument\(html: string\): Promise<boolean>/);
  });

  it('저장한 뒤 다음 할 일을 보여 준다', () => {
    expect(dlg).toContain('to="/exhibitions"');
    expect(dlg).toContain('내 홈페이지에서 보기');
  });

  it('저장할 때마다 기록을 남긴다(관리자 통계) — 세 방식 모두', () => {
    for (const m of ["method: 'download'", "method: 'print'", "method: 'pptx'"]) expect(dlg, m).toContain(`logExport({ ${m}`);
  });

  it('쪽을 그릴 때 앱 화면 전체를 복제하지 않는다(ignoreElements) — 휴대폰에서 저장 시간이 절반이 된다', () => {
    const ex = code('lib/portfolioExport.ts');
    expect(ex).toContain('ignoreElements: (el: Element) => el.parentElement === document.body && el !== host');
  });
});

describe('디자인 저장 — 디자인만 보낸다', () => {
  it("★ 만들기 화면은 `PUT /portfolio` 전체 저장을 쓰지 않는다(다른 탭에서 고친 글을 되돌렸다)", () => {
    expect(makerCode).not.toMatch(/api\.put\('\/portfolio',/);
    expect(code(`${MAKER_DIR}/useDesignAutosave.ts`)).toContain("api.put('/portfolio/design', { designConfig })");
    expect(code('lib/portfolioExport.ts')).toContain("api.put('/portfolio/file', { portfolioFileUrl: url })");
  });

  it('웹 전용 키(홈페이지 대표작·웹 테마 표식)를 옮겨 싣는다 — 서버가 designConfig 를 통째로 갈아끼운다(규칙 49)', () => {
    expect(code(`${MAKER_DIR}/useDesignAutosave.ts`)).toContain('keepWebOnlyKeys(job.design, saved)');
  });

  it('★ 편집 화면은 포트폴리오 파일을 바꿨을 때만 보낸다 — 다른 탭에서 올린 PDF 를 옛 주소로 덮지 않는다', () => {
    const ed = code('components/homepage-edit/HomepageEditor.tsx');
    expect(ed).toContain('...(portfolioFileUrl !== loadedFileUrl.current ? { portfolioFileUrl } : {})');
    // 저장 요청 안에 파일을 조건 없이 싣는 줄이 없다
    const put = ed.slice(ed.indexOf("api.put('/portfolio', {"));
    const body = put.slice(0, put.indexOf('});'));
    expect(body).not.toMatch(/^\s*portfolioFileUrl,\s*$/m);
  });

  it('★ [처음 상태로] 는 그 탭만 되돌린다 — 이름·연락처 탭에는 아예 없다(꺼 둔 전화번호가 다시 실리면 안 된다)', () => {
    expect(code(`${MAKER_DIR}/PortfolioMaker.tsx`)).toContain('commit(resetTab(before, tab))');
    const panel = code(`${MAKER_DIR}/CustomizePanel.tsx`);
    expect(panel).toContain("(tab !== 'info' || undo)");
    expect(panel).toContain('onClick={() => onReset(tab)}');
  });
});

describe('이름 규칙은 한 곳 — 문서의 이름을 displayName 으로 다시 만들지 않는다', () => {
  it('엔진·인쇄·내보내기 어디에도 displayName( 이 없다', () => {
    for (const f of ['lib/portfolioFormats.ts', 'lib/portfolioPrint.ts', 'lib/portfolioExport.ts', 'lib/portfolioMaker.ts']) {
      expect(code(f), f).not.toMatch(/displayName\(/);
    }
  });
});

describe('알리는 곳', () => {
  it('★ 지원서의 [PDF 만들기] 는 새 탭으로 연다 — 지원서에는 임시저장이 없다', () => {
    const apply = read('pages/ApplyPage.tsx');
    expect(apply).toMatch(/<a href="\/mypage\?tab=portfolio" target="_blank" rel="noopener"/);
    expect(apply).toContain('홈페이지에 올린 파일 불러오기');
    // 파일이 비어 있을 때만 보인다
    expect(apply).toMatch(/\{!file && \(\s*<p[^>]*data-testid="apply-pdf-hint"/);
  });

  it('홈페이지 편집을 저장한 직후에만 한 번 — 평소 방문에는 띄우지 않는다', () => {
    expect(read('components/homepage-edit/HomepageEditor.tsx')).toContain('{ state: { savedHomepage: true } }');
    const page = read('pages/PortfolioPage.tsx');
    expect(page).toContain('savedHomepage');
    expect(page).toContain('isOwner && pdfHint && portfolio.images.length >= PDF_HINT_MIN_WORKS && !pdfHintDismissed(portfolio.user.id)');
  });

  it('마이페이지 메뉴에서 이 탭은 "PDF 만들기" 로 읽힌다', () => {
    expect(read('lib/myPageMenu.ts')).toMatch(/id: 'portfolio', label: '포트폴리오', icon: FileText, note: 'PDF 만들기'/);
  });
});

/**
 * 하니스(`scratchpad/portfolio-maker/walk.js`, 크롬+WebKit × 8화면)와 E2E 64 가 실제로 잡은 것들 — 전부 스크린샷으로는 "괜찮아 보였다".
 * 기하 자체는 하니스가 잰다. 여기서는 그 고침이 조용히 되돌아가지 않게 소스로 고정한다.
 */
describe('하니스·E2E 가 잡은 것', () => {
  it('★ Esc 는 맨 위의 것 하나만 닫는다 — 네 겹 모두 useEscapeKey 를 쓰고, 꾸미기 패널은 떠 있는 창에 양보한다', () => {
    // 예전: 창마다 `useEffect(() => addEventListener('keydown', …), [onClose])` — 부모가 매 렌더 새 onClose 를 준다.
    // 패널의 리스너가 먼저 불려 상태를 바꾸면 React 가 그 자리에서 다시 그리고, 저장 창의 리스너가 떼어졌다 다시 붙어
    // **지금 처리 중인 Esc 를 못 받았다** → 저장 창은 그대로이고 뒤의 패널만 닫혔다(E2E 64 E).
    for (const f of ['CustomizePanel', 'SaveDialog', 'WorkPicker', 'PageViewer']) {
      const src = code(`${MAKER_DIR}/${f}.tsx`);
      expect(src, f).toContain('useEscapeKey(onClose');
      expect(src, f).not.toMatch(/e\.key === 'Escape'/);
    }
    expect(code(`${MAKER_DIR}/CustomizePanel.tsx`)).toContain('useEscapeKey(onClose, { yieldToModal: true })');
    // 만드는 중·저장 중에는 닫히지 않는다
    expect(code(`${MAKER_DIR}/SaveDialog.tsx`)).toContain('useEscapeKey(onClose, { enabled: !working })');
    expect(code(`${MAKER_DIR}/WorkPicker.tsx`)).toContain('useEscapeKey(onClose, { enabled: !saving })');
    // 훅은 리스너를 한 번만 붙인다(의존성 없음) — 부를 함수는 ref 로 본다
    const hook = code('hooks/useEscapeKey.ts');
    expect(hook).toMatch(/window\.addEventListener\('keydown', onKey\);\s*return \(\) => window\.removeEventListener\('keydown', onKey\);\s*\}, \[\]\);/);
    expect(hook).toContain('[role="dialog"][aria-modal="true"]');
    // 양보의 근거 — 세 창은 모달로 표시돼 있고, 좁은 화면의 꾸미기 시트는 모달이 아니다(뒤 화면이 살아 있다)
    for (const f of ['SaveDialog', 'WorkPicker', 'PageViewer']) expect(code(`${MAKER_DIR}/${f}.tsx`), f).toContain('aria-modal="true"');
    expect(code(`${MAKER_DIR}/CustomizePanel.tsx`)).not.toContain('aria-modal');
  });

  it('★ 쪽 위 이름 줄은 쪽마다 같은 높이(40px) — 꾸미기를 연 동안의 쪽 높이가 그 값을 뺀다', () => {
    // 단추([표지 고치기])가 있는 쪽만 40px 이고 나머지가 28px 이었을 때, 휴대폰에서 표지 아랫부분이 시트에 12px 가렸다
    const pv = code(`${MAKER_DIR}/BookPreview.tsx`);
    expect(pv).toContain('export const PAGE_LABEL_H = 40;');
    expect(pv).toContain('className="flex h-10 items-center gap-2 text-xs text-gray-500"');
    const m = code(`${MAKER_DIR}/PortfolioMaker.tsx`);
    expect(m.match(/- PAGE_LABEL_H -/g)?.length).toBe(2);   // 넓은 화면 · 좁은 화면
    expect(m).toContain('vp.h * (1 - SHEET_VH)');
  });

  it('★ 머리의 할 일은 판 없는 한 줄(compact)로 상태 옆에 — 판을 깔면 좁은 화면에서 표지가 첫 화면 밖으로 밀린다', () => {
    // 아이폰 SE(320×568)에서 표지가 2px 만 보였다(표지 y441, 아래 바 y442)
    const m = code(`${MAKER_DIR}/PortfolioMaker.tsx`);
    expect(m).toMatch(/<TaskLine\s+compact\s+to=\{editHref\('works', \{ info: true \}\)\}/);
    // 설명 줄은 없앴다(2026-10-03 사용자 요청) — 미리보기가 곧 설명이다
    expect(m).not.toContain('포트폴리오 PDF 입니다');
    expect(m).not.toContain('아래가 지금 만들어진 모습이에요');
    // 디자인 줄·미리보기의 위 여백도 좁은 화면에서는 작게
    expect(code(`${MAKER_DIR}/DesignRow.tsx`)).toContain('border-y border-gray-200 py-2.5 sm:py-3');
    expect(code(`${MAKER_DIR}/BookPreview.tsx`)).toMatch(/data-book-preview className="[^"]*pt-1\.5[^"]*sm:pt-3/);
  });

  it('넓은 화면에서 꾸미기를 연 동안 마지막 쪽 아래를 받쳐 둔다 — 패널의 탭·닫기가 상단바 뒤로 숨지 않게', () => {
    // 1024px 폭: [이름·연락처] 가 마지막 장으로 데려가면 패널이 y=−48 로 밀려 올라갔다(마지막 쪽 385px < 패널 584px)
    expect(code(`${MAKER_DIR}/PortfolioMaker.tsx`)).toContain('tailRoom={!!customize && wide}');
    expect(code(`${MAKER_DIR}/BookPreview.tsx`)).toContain("minHeight: tailRoom && i === pages.length - 1 ? 'calc(100vh - 12.5rem)' : undefined");
    // 그 계산의 짝 — 패널의 높이 한계
    expect(code(`${MAKER_DIR}/CustomizePanel.tsx`)).toContain('max-h-[calc(100vh-11.5rem)]');
  });

  it('누르는 곳은 40px 이상 — 글자 폭 그대로인 탭·글자 단추에 최소 폭을 준다', () => {
    const p = code(`${MAKER_DIR}/CustomizePanel.tsx`);
    expect(p).toMatch(/role="tab"[\s\S]*?min-h-\[48px\] min-w-\[40px\]/);   // '표지' 탭이 24px 이었다
    expect(code(`${MAKER_DIR}/WorkPicker.tsx`)).toContain("grid h-11 w-10 place-items-center");   // 순서 화살표
    // 36px 짜리 단추가 남아 있지 않다
    expect(makerCode).not.toMatch(/min-h-\[3[0-9]px\]/);
  });

  it('화면 글자는 12px 이상 — 9~11px 을 쓰지 않는다(예전: 표지·배치 이름 9px, 글자의 47% 가 11px 이하)', () => {
    expect(makerCode).not.toMatch(/text-\[(8|9|10|11)px\]/);
  });

  it('좁은 화면에서도 디자인 저장 실패는 보인다 — 상태 글자는 sm 이상에만 있으므로 실패 줄을 따로 둔다', () => {
    const bar = code(`${MAKER_DIR}/MakerBar.tsx`);
    expect(bar).toMatch(/saveState === 'error' && \(\s*<p role="alert" className="[^"]*sm:hidden/);
  });
});

/** 사용자 검토 뒤 고친 것 (2026-10-03) */
describe('사용자 검토 — 이름 · 용지 · 쪽마다 따로', () => {
  const m = code(`${MAKER_DIR}/PortfolioMaker.tsx`);

  it("오른쪽 위 단추는 '작품·글 추가·수정' — '내용 고치기' 는 자료를 넣는 곳으로 안 읽혔다", () => {
    expect(m).not.toContain('내용 고치기');
    expect(m).toMatch(/<Link to=\{editHref\(\)\}[^>]*>\s*<Plus[^>]*\/> 작품·글 추가·수정/);
  });

  it('★ 용지는 맨 위에서 따로 고른다 — 상태 줄보다 위, [색·글꼴] 탭에는 없다', () => {
    expect(m.indexOf('<PaperPicker')).toBeGreaterThan(-1);
    expect(m.indexOf('<PaperPicker')).toBeLessThan(m.indexOf('data-testid="maker-status"'));
    expect(m).toContain('role="radiogroup" aria-labelledby="pfm-paper"');
    const tabs = code(`${MAKER_DIR}/customizeTabs.tsx`);
    expect(tabs).not.toMatch(/<Group title="용지"/);
    expect(tabs).not.toContain("patch({ page })");
  });

  it('★ 디자인 카드는 용지를 바꾸지 않는다 — applyDirection 을 거치고, 카드 그림도 지금 용지로 그린다', () => {
    expect(m).toContain('commit(applyDirection(before, d))');
    expect(m).not.toMatch(/commit\(\{ \.\.\.before, \.\.\.d\.design/);
    expect(code(`${MAKER_DIR}/DesignRow.tsx`)).toContain('page: design.page, auto: true');
  });

  it('★ 쪽마다 따로 — 글 정렬은 [작품]·[약력] 에 하나씩, 프로필 사진은 [약력]·[이름·연락처] 에 하나씩', () => {
    const tabs = code(`${MAKER_DIR}/customizeTabs.tsx`);
    expect(tabs).toContain('value={design.worksProseAlign}');
    expect(tabs).toContain('value={design.proseAlign}');
    expect(tabs).toContain('checked={design.artistPhoto}');
    expect(tabs).toContain('checked={design.contactPhoto}');
    // 엔진도 — 작품 쪽은 따로 만든 테마(worksTheme)로 그린다
    const eng = code('lib/portfolioFormats.ts');
    expect(eng).toContain('const worksTheme: PortfolioTheme = { ...theme, proseAlign: design.worksProseAlign }');
    expect(eng).toContain('worksPages(worksTheme,');
    expect(eng).toContain('const photo = design.contactPhoto ?');
  });

  it('[약력] 탭이 있다 — 싣는 항목 · 약력 자리 · 경력 배치 · 영문 머리말', () => {
    const tabs = code(`${MAKER_DIR}/customizeTabs.tsx`);
    for (const t of ['title="싣는 항목"', 'title="약력 자리"', 'title="경력 배치"', 'label="영문 머리말"']) expect(tabs, t).toContain(t);
    expect(code(`${MAKER_DIR}/CustomizePanel.tsx`)).toContain("{tab === 'cv' && <CvTab");
  });
});

describe('디자인 줄 — 여섯 다 보인다(2026-10-03 사용자 지적 "6종 중 3종밖에 안 보인다")', () => {
  const row = code(`${MAKER_DIR}/DesignRow.tsx`);
  it('★ 펼치기·접기 없이 여섯 다 — 휴대폰·태블릿 3×2, 넓은 화면 한 줄', () => {
    expect(row).toContain('grid-cols-3');
    expect(row).toContain('xl:grid-cols-6');
    expect(row).toContain('DESIGN_DIRECTIONS.filter((d) => !first.some((f) => f.key === d.key))');
    for (const gone of ['모두 보기', '더 보기', '접기', 'setAll']) expect(row, gone).not.toContain(gone);
  });
  it('설명 글(추천 이유)은 없다 — 이름과 표지 그림만', () => {
    expect(row).not.toMatch(/why\(|\.note\b/);
  });
});

