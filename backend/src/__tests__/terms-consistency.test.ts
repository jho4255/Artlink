import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ARTIST_APPLY_TERMS_HASH, ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';

/**
 * 작가 지원 약관 — 원문·해시·버전이 한 몸인지 (2026-09-27).
 *
 * 동의 기록(`Application.termsVersion/termsTextHash`)은 '어떤 전문에 동의했는가'의 분쟁 근거다.
 * 2026-09-05 에 원문에 제7조(정산 무응답 3일 자동 수락)·제8조를 넣으면서 버전·해시를 그대로 둬서,
 * 그 뒤 동의 기록이 **제7조가 없던 7월 원문**을 가리켰다 — 아무 에러 없이 3주 동안. 파일을 고치면 여기서 깨진다.
 */
const root = resolve(__dirname, '../../..');
const text = readFileSync(resolve(root, 'frontend/public/terms/artist_apply_real.txt'));

describe('작가 지원 약관 일관성', () => {
  it('해시 = 원문 파일의 SHA-256 — 원문을 고쳤으면 해시와 버전을 함께 올릴 것', () => {
    expect(createHash('sha256').update(text).digest('hex')).toBe(ARTIST_APPLY_TERMS_HASH);
  });

  it('화면이 보내는 버전 = 서버 버전 (다르면 모든 지원이 400)', () => {
    for (const f of ['frontend/src/pages/ExhibitionDetailPage.tsx', 'frontend/src/components/shared/InviteApplyModal.tsx']) {
      const src = readFileSync(resolve(root, f), 'utf8');
      const m = src.match(/const ARTIST_APPLY_TERMS_VERSION = '([^']+)'/);
      expect(m?.[1], f).toBe(ARTIST_APPLY_TERMS_VERSION);
    }
  });

  it('제8조는 정원을 선정 인원으로 적는다 — 지원 자체를 막는다고 적혀 있으면 실제 동작과 다르다', () => {
    const s = text.toString('utf8');
    expect(s).toContain('모집 정원은 갤러리 회원이 선정(수락)할 수 있는 작가 수');
    expect(s).toContain('초대 코드');
    expect(s).not.toContain('모집 정원이 찬 공모');
  });

  it('제4조는 초대·초대 코드 참여 때 홈페이지 정보가 갤러리에 간다고 적는다 — 서버가 실제로 그걸 복사한다', () => {
    expect(text.toString('utf8')).toContain('초대를 수락하거나 초대 코드로 참여하는 경우에는 지원서 대신');
  });
});

/**
 * 옛 판본 보관소(`docs/terms-history/`) — 동의 기록의 버전·해시로 그 사람이 본 전문을 되찾는 곳.
 * 판본을 올리고 여기 추가를 잊으면 옛 전문이 git 속에만 남아 분쟁 때 찾기 어렵다.
 */
describe('작가 지원 약관 판본 보관', () => {
  const dir = resolve(root, 'docs/terms-history');
  const manifest = JSON.parse(readFileSync(resolve(dir, 'artist_apply.json'), 'utf8')) as {
    versions: { version: string | null; hash: string; file: string }[];
  };

  it('보관한 전문마다 적힌 해시와 파일 해시가 같다', () => {
    for (const v of manifest.versions) {
      const h = createHash('sha256').update(readFileSync(resolve(dir, v.file))).digest('hex');
      expect(h, v.file).toBe(v.hash);
    }
  });

  it('마지막 판본 = 지금 서버 버전·해시 = 공개 파일', () => {
    const last = manifest.versions[manifest.versions.length - 1];
    expect(last.version).toBe(ARTIST_APPLY_TERMS_VERSION);
    expect(last.hash).toBe(ARTIST_APPLY_TERMS_HASH);
  });
});
