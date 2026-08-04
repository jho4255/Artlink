/**
 * 업로드 파일 정리(deleteUploadedFile) — 커스텀 도메인 전환 대응 (2026-08-04)
 *
 * 이미지 주소를 `pub-*.r2.dev` → `img.artlink.cc`로 옮기는 동안 DB에는 두 도메인이 섞인다.
 * 삭제 로직이 옛 주소를 "우리 것"으로 못 알아보면 **에러 없이 조용히** 건너뛰고
 * R2에 고아 파일이 계속 쌓인다. 그래서 신·구 모두에서 키가 정확히 뽑히는지 확인한다.
 *
 * storage.ts는 import 시점에 R2 환경변수를 읽으므로 env를 먼저 세팅한 뒤 동적 import 한다.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const NEW = 'https://img.test-artlink.cc';
const OLD = 'https://pub-teststorage.r2.dev';

/** 실제 S3 호출 대신 명령만 기록 */
const sent: any[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { async send(cmd: any) { sent.push(cmd.input); } },
  DeleteObjectCommand: class { constructor(public input: any) {} },
}));

const saved = { ...process.env };
let deleteUploadedFile: (url?: string | null) => Promise<void>;

beforeAll(async () => {
  process.env.R2_ACCOUNT_ID = 'acc';
  process.env.R2_ACCESS_KEY_ID = 'key';
  process.env.R2_SECRET_ACCESS_KEY = 'secret';
  process.env.R2_BUCKET_NAME = 'artlink-test';
  process.env.R2_PUBLIC_URL = `${NEW},${OLD}`;
  vi.resetModules();
  ({ deleteUploadedFile } = await import('../lib/storage'));
});

afterAll(() => {
  process.env = saved;
  vi.resetModules();
});

describe('deleteUploadedFile — 두 도메인 모두 인식', () => {
  it('새 도메인 파일을 삭제한다', async () => {
    sent.length = 0;
    await deleteUploadedFile(`${NEW}/artlink/1784-new.jpg`);
    expect(sent).toEqual([{ Bucket: 'artlink-test', Key: 'artlink/1784-new.jpg' }]);
  });

  it('★ 옛 도메인 파일도 삭제한다 (안 그러면 고아 파일이 쌓인다)', async () => {
    sent.length = 0;
    await deleteUploadedFile(`${OLD}/artlink/1780-old.jpg`);
    expect(sent).toEqual([{ Bucket: 'artlink-test', Key: 'artlink/1780-old.jpg' }]);
  });

  it('폴더가 있는 키도 그대로 보존한다', async () => {
    sent.length = 0;
    await deleteUploadedFile(`${OLD}/artlink/files/1780-doc.pdf`);
    expect(sent[0].Key).toBe('artlink/files/1780-doc.pdf');
  });

  it('남의 도메인·빈 값은 건드리지 않는다', async () => {
    sent.length = 0;
    await deleteUploadedFile('https://evil.example.com/artlink/a.jpg');
    await deleteUploadedFile('https://images.unsplash.com/photo-1');
    await deleteUploadedFile(null);
    await deleteUploadedFile('');
    expect(sent).toEqual([]);
  });
});
