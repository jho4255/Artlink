import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

/**
 * 업로드 파일 정리 헬퍼.
 * 이미지/파일을 교체·삭제할 때 이전 파일이 스토리지에 영구히 남아 쌓이는(orphan) 문제 방지.
 * 우리가 저장한 파일만 대상: R2 공개 URL(R2_PUBLIC_URL 접두사) 또는 디스크 상대경로(/uploads/..).
 * 외부 URL 등은 무시하고, 실패해도 예외를 던지지 않는다(부가 작업이므로 본 요청에 영향 없음).
 */
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] as const;
const useR2 = R2_VARS.every((k) => !!process.env[k]);

let s3: S3Client | null = null;
if (useR2) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/** 단일 업로드 파일 제거 (best-effort). */
export async function deleteUploadedFile(url: string | null | undefined): Promise<void> {
  if (!url || typeof url !== 'string') return;
  try {
    const base = process.env.R2_PUBLIC_URL;
    if (useR2 && s3 && base && url.startsWith(base + '/')) {
      const key = url.slice(base.length + 1);
      if (key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }));
      return;
    }
    if (url.startsWith('/uploads/')) {
      // 경로 이탈 방지: 파일명만 사용
      const safe = path.basename(url.slice('/uploads/'.length));
      if (safe) await fs.promises.unlink(path.join(__dirname, '../../uploads', safe)).catch(() => { /* 이미 없음 */ });
    }
  } catch { /* best-effort: 정리 실패는 무시 */ }
}

/** 여러 업로드 파일 일괄 제거 (best-effort). null/빈 값은 건너뜀. */
export async function deleteUploadedFiles(urls: (string | null | undefined)[]): Promise<void> {
  await Promise.all(urls.map((u) => deleteUploadedFile(u)));
}
