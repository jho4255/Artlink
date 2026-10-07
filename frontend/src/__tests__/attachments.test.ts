/**
 * 공모 첨부파일 (2026-10-08) — lib/attachments.ts + 화면이 붙는 자리.
 * 서버 규칙(backend lib/exhibitionAttachments.ts · routes/upload.ts)과 같은 숫자·형식을 쓰는지 소스로 대조한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ATTACHMENT_EXTS, ATTACHMENT_MAX, ATTACHMENT_MAX_BYTES, attachmentFileProblem, attachmentKind, attachmentTypeLabel, formatFileSize, normalizeAttachments,
} from '@/lib/attachments';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

describe('서버와 같은 규칙', () => {
  it('개수 상한이 같다', () => {
    const src = read('backend/src/lib/exhibitionAttachments.ts');
    expect(src).toMatch(new RegExp(`export const ATTACHMENT_MAX = ${ATTACHMENT_MAX};`));
  });
  it('받는 형식(확장자)이 같다', () => {
    const src = read('backend/src/routes/upload.ts');
    const m = src.match(/const ATTACHMENT_EXTS = new Set\(\[([^\]]+)\]\)/);
    expect(m).toBeTruthy();
    const server = m![1]!.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect([...ATTACHMENT_EXTS].sort()).toEqual(server);
  });
  it('크기 상한이 같다(20MB)', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(read('backend/src/routes/upload.ts')).toMatch(/const attachmentUpload = multer\(\{\s*storage,\s*limits: \{ fileSize: 20 \* 1024 \* 1024 \}/);
  });
});

describe('올리기 전에 거르기', () => {
  it('형식·크기', () => {
    expect(attachmentFileProblem({ name: '요강.pdf', size: 1000 })).toBeNull();
    expect(attachmentFileProblem({ name: '양식.HWP', size: 1000 })).toBeNull();
    expect(attachmentFileProblem({ name: '도면.png', size: 1000 })).toBeNull();
    expect(attachmentFileProblem({ name: 'setup.exe', size: 10 })).toMatch(/첨부할 수 없는 형식/);
    expect(attachmentFileProblem({ name: '이름없음', size: 10 })).toMatch(/첨부할 수 없는 형식/);
    expect(attachmentFileProblem({ name: 'big.zip', size: ATTACHMENT_MAX_BYTES + 1 })).toMatch(/20MB/);
  });
});

describe('보여 주기', () => {
  it('종류·크기 글자', () => {
    expect(attachmentTypeLabel('a.hwpx')).toBe('한글');
    expect(attachmentTypeLabel('a.xlsx')).toBe('엑셀');
    expect(attachmentKind('a.JPG')).toBe('image');
    expect(formatFileSize(120_000)).toBe('117KB');
    expect(formatFileSize(3.4 * 1024 * 1024)).toBe('3.4MB');
    expect(formatFileSize(12 * 1024 * 1024)).toBe('12MB');
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(10)).toBe('1KB');
  });
  it('모양이 틀린 줄은 버리고, 이름이 없으면 첨부파일', () => {
    expect(normalizeAttachments(null)).toEqual([]);
    expect(normalizeAttachments([{ url: '/uploads/a.pdf', name: 'a.pdf', size: 3 }, { url: '' }, 'x', { url: '/uploads/b.zip', size: 'big' }])).toEqual([
      { url: '/uploads/a.pdf', name: 'a.pdf', size: 3 },
      { url: '/uploads/b.zip', name: '첨부파일', size: null },
    ]);
  });
});

describe('화면이 붙는 자리 — 되돌아가지 않게', () => {
  const myPage = read('frontend/src/pages/MyPage.tsx');
  const hosted = read('frontend/src/components/admin/HostedExhibitionsSection.tsx');
  const detail = read('frontend/src/pages/ExhibitionDetailPage.tsx');

  it('갤러리 공고 등록·아트링크 주최 등록 둘 다 첨부 칸이 있고, 함수형으로 붙인다(여러 파일이 이어 붙도록)', () => {
    for (const src of [myPage, hosted]) {
      expect(src).toMatch(/<AttachmentEditor[\s\S]{0,120}value=\{form\.attachments\}/);
      expect(src).toMatch(/setForm\(prev => \(\{ \.\.\.prev, attachments: update\(prev\.attachments/);
      // 올리는 중에는 등록을 막는다 — 다 올라가기 전에 보내면 그 파일이 빠진다
      expect(src).toMatch(/if \(attachBusy\)/);
    }
  });

  it('임시저장을 이어 쓸 때 첨부 목록을 다시 거른다(옛 초안엔 없다)', () => {
    expect(myPage).toMatch(/attachments: normalizeAttachments\(\(d as \{ attachments\?: unknown \}\)\.attachments\)/);
  });

  it('공고 상세 — 누구나 보는 목록 + 운영자의 [편집]. 버튼 이름에 \'수정\' 을 쓰지 않는다(공모 소개의 [수정]과 겹친다)', () => {
    expect(detail).toMatch(/<AttachmentsSection exhibitionId=\{id!\} items=\{normalizeAttachments\(exhibition\.attachments\)\} canEdit=\{canEdit\} \/>/);
    expect(detail).toMatch(/api\.patch\(`\/exhibitions\/\$\{exhibitionId\}\/attachments`/);
    const section = detail.slice(detail.indexOf('function AttachmentsSection'));
    expect(section).not.toMatch(/aria-label=\{?['"`][^'"`]*수정/);
  });

  it('관리자 승인 화면에서 첨부를 먼저 열어 본다', () => {
    expect(myPage).toMatch(/<AttachmentList items=\{normalizeAttachments\(item\.attachments\)\} \/>/);
  });
});
