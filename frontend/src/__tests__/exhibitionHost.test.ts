/**
 * 공모 주최자 규칙 — 화면에서 헷갈리기 쉬운 두 가지를 고정한다.
 *
 *   1. 운영 위임 ≠ 소유. 위임받은 갤러리는 운영은 하되 **삭제는 못 한다**(서버도 403).
 *   2. 운영 가능 판정은 서버가 내려주는 `canOperate` 를 따른다 — 프론트가 오너 비교를 다시 구현하면
 *      규칙이 두 벌이 되어 어긋난다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAdminHosted, canOperate, canManage, canDelete, canEditTitle, EXHIBITION_TITLE_MAX } from '../lib/exhibitionHost';

const gallery = { id: 7, role: 'GALLERY' };
const admin = { id: 1, role: 'ADMIN' };
const artist = { id: 9, role: 'ARTIST' };

describe('isAdminHosted', () => {
  it('hostType 이 ADMIN 일 때만 참', () => {
    expect(isAdminHosted({ hostType: 'ADMIN' })).toBe(true);
    expect(isAdminHosted({ hostType: 'GALLERY' })).toBe(false);
    expect(isAdminHosted({})).toBe(false);       // 옛 데이터(필드 없음)
    expect(isAdminHosted(undefined)).toBe(false);
  });
});

describe('canOperate', () => {
  it('서버가 내려준 canOperate 를 그대로 따른다', () => {
    expect(canOperate({ hostType: 'ADMIN', canOperate: true, gallery: { ownerId: 999 } }, gallery)).toBe(true);
    expect(canOperate({ hostType: 'ADMIN', canOperate: false, gallery: { ownerId: 7 } }, gallery)).toBe(false);
  });

  it('canOperate 가 없으면(목록 API) 오너 비교로 폴백', () => {
    expect(canOperate({ gallery: { ownerId: 7 } }, gallery)).toBe(true);
    expect(canOperate({ gallery: { ownerId: 8 } }, gallery)).toBe(false);
    expect(canOperate({ gallery: null }, gallery)).toBe(false);
  });

  it('갤러리 계정이 아니면 항상 false', () => {
    expect(canOperate({ canOperate: true }, artist)).toBe(false);
    expect(canOperate({ canOperate: true }, admin)).toBe(false); // Admin 은 운영자가 아니라 관리자
    expect(canOperate({ canOperate: true }, null)).toBe(false);
  });
});

describe('canManage', () => {
  // 서버(assertCanManageExhibition)와 짝. 화면 편집 버튼은 이걸로 판단한다.
  it('★ Admin 은 자기가 주최한 공고를 고칠 수 있다 (버튼이 사라지면 안 된다)', () => {
    const hosted = { hostType: 'ADMIN', canOperate: false };
    expect(canOperate(hosted, admin)).toBe(false);  // 운영 위임 대상은 아니지만
    expect(canManage(hosted, admin)).toBe(true);    // 편집은 된다
  });

  it('Admin 은 갤러리가 등록한 공고도 고칠 수 있다', () => {
    expect(canManage({ hostType: 'GALLERY', gallery: { ownerId: 99 } }, admin)).toBe(true);
  });

  it('운영 갤러리는 고칠 수 있다', () => {
    expect(canManage({ hostType: 'ADMIN', canOperate: true }, gallery)).toBe(true);
  });

  it('무관한 갤러리·작가·비로그인은 못 고친다', () => {
    expect(canManage({ hostType: 'ADMIN', canOperate: false }, gallery)).toBe(false);
    expect(canManage({ hostType: 'ADMIN', canOperate: true }, artist)).toBe(false);
    expect(canManage({ hostType: 'ADMIN' }, null)).toBe(false);
  });
});

describe('canDelete', () => {
  it('★ 아트링크 주최 공모는 운영 갤러리가 지울 수 없다', () => {
    const hosted = { hostType: 'ADMIN', canOperate: true };
    expect(canOperate(hosted, gallery)).toBe(true);  // 운영은 된다
    expect(canDelete(hosted, gallery)).toBe(false);  // 삭제는 안 된다
  });

  it('갤러리가 직접 등록한 공모는 오너가 지울 수 있다', () => {
    expect(canDelete({ hostType: 'GALLERY', canOperate: true }, gallery)).toBe(true);
    expect(canDelete({ gallery: { ownerId: 7 } }, gallery)).toBe(true);
  });

  it('Admin 은 무엇이든 지울 수 있다', () => {
    expect(canDelete({ hostType: 'ADMIN' }, admin)).toBe(true);
    expect(canDelete({ hostType: 'GALLERY' }, admin)).toBe(true);
  });

  it('무관한 갤러리·비로그인은 false', () => {
    expect(canDelete({ hostType: 'GALLERY', gallery: { ownerId: 8 } }, gallery)).toBe(false);
    expect(canDelete({ hostType: 'ADMIN' }, null)).toBe(false);
  });
});

describe('canEditTitle — 제목을 바로 고치는 것은 아트링크 주최 공모의 관리자만 (2026-10-26)', () => {
  it('관리자 × 아트링크 주최만 참 — 위임 갤러리·작가·비로그인·갤러리 주최 공모는 거짓', () => {
    expect(canEditTitle({ hostType: 'ADMIN' }, admin)).toBe(true);
    expect(canEditTitle({ hostType: 'ADMIN', canOperate: true }, gallery)).toBe(false);   // 위임 갤러리 — 운영만 맡았다
    expect(canEditTitle({ hostType: 'ADMIN' }, artist)).toBe(false);
    expect(canEditTitle({ hostType: 'ADMIN' }, null)).toBe(false);
    expect(canEditTitle({ hostType: 'GALLERY', gallery: { ownerId: 1 } }, admin)).toBe(false);   // 수정 요청 → 승인 길
    expect(canEditTitle(undefined, admin)).toBe(false);
  });

  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  it('글자 수 상한은 서버 스키마와 같은 값', () => {
    const route = readFileSync(resolve(__dirname, '../../../backend/src/routes/exhibition.ts'), 'utf8');
    const m = route.match(/const titleSchema = z\.object\(\{ title: z\.string\(\)\.trim\(\)\.min\(1, [^)]+\)\.max\((\d+),/);
    expect(m?.[1]).toBe(String(EXHIBITION_TITLE_MAX));
  });
  it('공고 상세는 canEditTitle 로 [수정]을 그리고, [주최 공모] 카드에 [제목·소개 수정]이 있다', () => {
    const detail = src('pages/ExhibitionDetailPage.tsx');
    expect(detail).toMatch(/canEditTitle\(exhibition, user\) && \(/);
    expect(detail).toMatch(/api\.patch\(`\/exhibitions\/\$\{id\}\/title`/);
    const hosted = src('components/admin/HostedExhibitionsSection.tsx');
    expect(hosted).toMatch(/onClick=\{\(\) => setEditContentEx\(ex\)\}[\s\S]{0,160}제목·소개 수정/);
    const modal = src('components/admin/HostedContentEditModal.tsx');
    // 바뀐 것만 보낸다 · 고친 게 있으면 닫기 전에 묻는다 · 여는 목록 캐시에 곧바로 써 넣는다
    expect(modal).toMatch(/if \(titleChanged\) out\.title =/);
    expect(modal).toMatch(/if \(descChanged\) out\.description =/);
    expect(modal).toMatch(/if \(dirty\) setAsking\(true\);/);
    expect(modal).toMatch(/setQueriesData\(\{ queryKey: \['hosted-exhibitions'\] \}/);
  });
});
