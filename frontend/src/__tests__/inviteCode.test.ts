import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { formatInviteCode, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, joinPath, normalizeInviteCode } from '@/lib/inviteCode';

describe('초대 코드 (lib/inviteCode) — 백엔드와 같은 규칙의 거울', () => {
  it('입력은 대소문자·하이픈·공백을 무시하고, 형식이 아니면 null', () => {
    expect(normalizeInviteCode('k7m4-qx2p')).toBe('K7M4QX2P');
    expect(normalizeInviteCode(' K7M4 QX2P ')).toBe('K7M4QX2P');
    expect(normalizeInviteCode('K7M4QX2')).toBeNull();      // 7자리
    expect(normalizeInviteCode('K7M4QX20')).toBeNull();     // 0 은 쓰지 않는 글자
    expect(normalizeInviteCode('')).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
  });

  it('보여 줄 땐 XXXX-XXXX, 링크는 /join/코드', () => {
    expect(formatInviteCode('K7M4QX2P')).toBe('K7M4-QX2P');
    expect(joinPath('K7M4QX2P')).toBe('/join/K7M4QX2P');
  });

  it('⚠️ 글자 집합·길이가 백엔드와 같다 — 다르면 화면이 통과시킨 코드를 서버가 404 로 막는다', () => {
    const src = readFileSync(resolve(__dirname, '../../../backend/src/lib/inviteCode.ts'), 'utf8');
    expect(src).toContain(`INVITE_CODE_ALPHABET = '${INVITE_CODE_ALPHABET}'`);
    expect(src).toContain(`INVITE_CODE_LENGTH = ${INVITE_CODE_LENGTH}`);
  });

  it('참여 화면 라우트가 App.tsx 에 있다 — 갤러리가 돌리는 링크가 404 면 기능 전체가 죽는다', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(app).toContain('path="/join/:code"');
  });
});
