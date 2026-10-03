/**
 * 공모 흐름 점검 후속(2026-10-03, `scratchpad/flow-audit-2026-10-03.md`) — 화면 쪽 회귀 가드.
 *
 * 대부분 "버튼·칸이 어디에 있는가" 라서 jsdom 으로는 못 잰다(기하는 e2e `66-flow-fixes` 가 본다).
 * 여기서는 순수 함수와, **되돌리기 쉬운 한 줄**을 소스로 고정한다 — 고칠 때 한 번에 지워지기 쉬운 것들이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { safeHttpUrl, capacityError, CAPACITY_MAX } from '@/lib/utils';
import { CV_SECTIONS } from '@/lib/submissionChecklist';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('주소 검증 — `//외부` 는 같은 출처 경로가 아니다 (S3)', () => {
  it('프로토콜 상대 주소·역슬래시는 거절, 우리 경로·http(s) 는 통과', () => {
    expect(safeHttpUrl('//tracker.example/p.png')).toBeNull();
    expect(safeHttpUrl('/\\evil.example/x')).toBeNull();
    expect(safeHttpUrl('/uploads/a.png')).toBe('/uploads/a.png');
    expect(safeHttpUrl('https://img.artlink.cc/a.png')).toBe('https://img.artlink.cc/a.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('모집 인원 — 비었거나 0 이면 폼에서 바로 (서버 상한과 같은 값)', () => {
  it('1 ~ CAPACITY_MAX 만 통과', () => {
    expect(CAPACITY_MAX).toBe(1000);
    expect(capacityError(0)).not.toBeNull();
    expect(capacityError(Number(''))).not.toBeNull();
    expect(capacityError(1.5)).not.toBeNull();
    expect(capacityError(1001)).toContain('1000');
    expect(capacityError(1)).toBeNull();
    expect(capacityError(1000)).toBeNull();
  });
  it('서버의 상한과 같다(routes/exhibition.ts CAPACITY_MAX)', () => {
    const server = readFileSync(join(SRC, '../../backend/src/routes/exhibition.ts'), 'utf8');
    expect(server).toMatch(/const CAPACITY_MAX = 1000;/);
  });
});

describe('출품 자료 약력 — 학력을 포함한 5항목을 한 곳에서', () => {
  it('학력이 맨 앞, 다섯 항목', () => {
    expect(CV_SECTIONS.map((s) => s.key)).toEqual(['education', 'solo', 'group', 'artFair', 'award']);
  });
  it('목록을 따로 적은 파일이 없다(예전엔 네 군데에 복사돼 넷 다 학력이 빠졌다)', () => {
    const copies = walk(SRC).filter((p) => /const CV_SECTIONS\b/.test(readFileSync(p, 'utf8')));
    expect(copies.map((p) => p.slice(SRC.length + 1))).toEqual(['lib/submissionChecklist.ts']);
  });
});

describe('소스 가드 — 화면에서 되돌리기 쉬운 한 줄', () => {
  it('경로가 바뀌면 맨 위로 — 라우터 안, 앱보다 먼저', () => {
    const main = read('main.tsx');
    const open = main.indexOf('<BrowserRouter>');
    const scroll = main.indexOf('<ScrollToTop />');
    expect(open).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(open);
    expect(scroll).toBeLessThan(main.indexOf('<App />'));
  });

  it('정산 입력에도 이탈 경고 — 판매가를 적다 카드를 접으면 경고 없이 사라졌다(P1-2)', () => {
    expect(read('components/operation/SettlementSection.tsx')).toMatch(/useUnsavedChanges\(dirty && !locked/);
  });

  it('화면 안에서 입력을 떼어 내는 동작은 먼저 묻는다 — 갤러리 카드·작가 카드·탭', () => {
    const my = read('pages/MyPage.tsx');
    expect((my.match(/confirmDiscardUnsaved\(\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('지원서는 홈페이지와 같은 5항목을 그리고 보낸다(P2-7)', () => {
    const apply = read('pages/ApplyPage.tsx');
    expect(apply).toContain('categories={PORTFOLIO_CATEGORIES}');
    expect(apply).toMatch(/education: clean\(/);
    expect(apply).toMatch(/award: clean\(/);
  });

  it('공모 상세의 [지원하기]는 화면 아래 따라오는 줄 — 휴대폰은 하단 탭바 위', () => {
    const detail = read('pages/ExhibitionDetailPage.tsx');
    expect(detail).toMatch(/data-apply-bar className="sticky bottom-\[calc\(3\.5rem\+1px\+env\(safe-area-inset-bottom\)\)\][^"]*lg:bottom-0/);
    // 본문에 있던 큰 버튼은 없앴다 — 둘이면 어느 쪽을 눌러야 하는지 헷갈린다
    expect(detail).not.toMatch(/<Send size=\{16\} \/> 지원하기/);
  });

  it('공모 상세 홍보 사진은 자르지 않는다(정사각 칸 + contain)', () => {
    const detail = read('pages/ExhibitionDetailPage.tsx');
    expect(detail).toContain('<SquarePhotoGrid');
    expect(detail).not.toMatch(/h-24 object-cover/);
  });

  it('전시가 끝나면 지원자 결정을 잠근다(관리자 제외) · 초대 코드 줄도 감춘다', () => {
    const am = read('components/shared/ApplicantManager.tsx');
    expect(am).toMatch(/const decisionsLocked = ended && !isAdmin/);
    expect(am).toMatch(/!decisionsLocked && isPending\(app\.status\)/);
    expect(am).toMatch(/const joinCode = ended \|\| joinCodeState\?\.blocked \? null/);
  });

  it('운영 화면 본문은 <main> 을 만들지 않는다 — Layout 이 이미 하나 갖고 있다', () => {
    const op = read('pages/OperationPage.tsx');
    expect(op).not.toMatch(/'main' \| 'div'/);
    expect(op).toMatch(/const Body = 'div' as const;/);
  });
});
