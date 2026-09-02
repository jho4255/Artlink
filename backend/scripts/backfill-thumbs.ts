/**
 * 이미 올라간 이미지에 썸네일(t240 · t800)을 만들어 넣는다 — 1회성 백필.
 *
 * ## 왜
 * 썸네일 생성은 2026-08-11 업로드분부터 붙었다. 그 전에 올라간 것에는 썸네일이 없어
 * 화면이 **원본을 그대로** 받는다. 실측(2026-08-27, 작가A 작가 공개 홈페이지):
 *   작품 30장 · 평균 959KB · 합계 **28.1MB** — 표시 크기는 377px 인데 원본은 1456~1986px.
 *   t800 로 바꾸면 같은 페이지가 **4.3MB** 가 된다(화질 손실 없음, 아래 참고).
 * DB의 PortfolioImage 372장이 **전부** 썸네일 없는 상태였다.
 *
 * ## 무엇을 하나
 * 원본을 받아 t240·t800 을 만들어 **없는 것만** 올린다. 원본은 읽기만 하고 절대 건드리지 않는다.
 * 중간에 죽어도 다시 돌리면 이미 있는 것은 건너뛴다(멱등).
 *
 * ## 어디서 돌리나
 * R2 자격증명이 있어야 한다 → **Render 셸에서** 돌리는 게 맞다(로컬은 디스크 저장 모드라 R2 키가 없다).
 *   cd backend && npx tsx scripts/backfill-thumbs.ts            # 실제 실행
 *   cd backend && npx tsx scripts/backfill-thumbs.ts --dry-run  # 무엇을 할지만 출력
 *   cd backend && npx tsx scripts/backfill-thumbs.ts --limit 20 # 앞 20장만 (먼저 확인용)
 *
 * ⚠️ 원본 주소는 여러 개일 수 있다(R2_PUBLIC_URL 은 쉼표 목록, CLAUDE.md 17번).
 *    DB 에 옛 도메인이 남아 있어도 처리되도록 matchR2Base 로 판정한다.
 */
import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../src/lib/prisma';
import { matchR2Base } from '../src/lib/r2Urls';
import { makeThumb, thumbKey, THUMB_SPECS } from '../src/lib/thumb';

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] as const;
const missing = R2_VARS.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('R2 환경변수가 없습니다:', missing.join(', '));
  console.error('로컬은 디스크 저장 모드라 R2 키가 없습니다 — Render 셸에서 실행하세요.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME!;

/** 공개 주소 → 버킷 키. 어느 도메인으로 저장돼 있든 뒤쪽 경로만 취한다. */
function keyOf(url: string): string | null {
  const base = matchR2Base(url);
  if (!base) return null;
  const key = url.slice(base.length).replace(/^\//, '').split(/[?#]/)[0];
  return key || null;
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const images = await prisma.portfolioImage.findMany({
    select: { id: true, url: true },
    orderBy: { id: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`대상 ${images.length}장${DRY ? ' (dry-run — 아무것도 올리지 않습니다)' : ''}\n`);

  const stat = { done: 0, skipped: 0, notR2: 0, fetchFail: 0, makeFail: 0, bytesIn: 0, bytesOut: 0 };

  for (const [i, img] of images.entries()) {
    const key = keyOf(img.url);
    if (!key) { stat.notR2++; continue; }

    // 필요한 것만 고른다 (이미 있으면 건너뛴다 → 다시 돌려도 안전)
    const todo = [];
    for (const spec of THUMB_SPECS) {
      const tk = thumbKey(key, spec.dir);
      if (!(await exists(tk))) todo.push({ spec, tk });
    }
    if (todo.length === 0) { stat.skipped++; continue; }

    let buf: Buffer;
    try {
      const r = await fetch(img.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      stat.fetchFail++;
      console.warn(`  [${i + 1}] 원본 받기 실패 ${key}: ${(e as Error).message}`);
      continue;
    }
    stat.bytesIn += buf.length;

    for (const { spec, tk } of todo) {
      const thumb = await makeThumb(buf, spec);
      if (!thumb) { stat.makeFail++; console.warn(`  [${i + 1}] ${spec.dir} 생성 실패 ${key}`); continue; }
      stat.bytesOut += thumb.length;
      if (!DRY) {
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: tk, Body: thumb, ContentType: 'image/jpeg',
        }));
      }
    }
    stat.done++;
    if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${images.length}`);
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + 'MB';
  console.log('\n─ 결과 ─');
  console.log(`  처리 ${stat.done} · 이미 있음 ${stat.skipped} · R2 주소 아님 ${stat.notR2}`);
  if (stat.fetchFail) console.log(`  원본 받기 실패 ${stat.fetchFail}`);
  if (stat.makeFail) console.log(`  썸네일 생성 실패 ${stat.makeFail}`);
  console.log(`  읽은 원본 ${mb(stat.bytesIn)} → 만든 썸네일 ${mb(stat.bytesOut)}`);
  console.log(DRY ? '\n(dry-run 이라 업로드하지 않았습니다)' : '\n완료. 화면은 썸네일이 없으면 원본으로 되돌아가므로 실패분이 있어도 정상 동작합니다.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
