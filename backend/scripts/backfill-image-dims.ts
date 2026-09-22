/**
 * 옛 작품 사진의 픽셀 크기(`PortfolioImage.width/height`)를 채운다 (2026-09-16).
 *
 * 업로드 때 재기 시작한 뒤에도 그 전에 올라간 사진은 null 이다. 화면은 로드 후 재는 폴백이 있어 멀쩡하지만
 * 첫 화면이 튄다. **Render 셸에서** 한 번 돌린다(R2 공개 주소를 받아 재므로 로컬에서도 돌 수는 있다).
 *
 *   npx tsx scripts/backfill-image-dims.ts            # width 가 null 인 행 전부
 *   npx tsx scripts/backfill-image-dims.ts --limit 50 # 앞에서 50장만(시험)
 *
 * 실패한 행은 그대로 둔다(null). 다시 돌리면 그것만 다시 시도한다 — 멱등.
 *
 * ⚠️ 받기 제한은 60초, 실패하면 한 번 더 (2026-09-22). 처음엔 readImageDims 기본값(업로드용 4초)을 그대로 써서
 *    실서버 451장 중 **37장이 시간 초과로 실패**했다 — 파일은 전부 200 이었고 R2 가 600KB 한 장에 8초 걸리는 때가 있었을 뿐이다.
 */
import { PrismaClient } from '@prisma/client';
import { readImageDims } from '../src/lib/imageDims';

const prisma = new PrismaClient();
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : undefined;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 60_000;

/** 한 번 실패하면 한 번 더 — 일시적으로 느린 응답을 실패로 남기지 않는다 */
async function readWithRetry(url: string) {
  return (await readImageDims(url, FETCH_TIMEOUT_MS)) ?? (await readImageDims(url, FETCH_TIMEOUT_MS));
}

async function main() {
  const rows = await prisma.portfolioImage.findMany({
    where: { width: null },
    select: { id: true, url: true },
    orderBy: { id: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`대상 ${rows.length}장`);
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (row) => {
      const dims = await readWithRetry(row.url);
      if (!dims) { fail += 1; console.log(`  ✗ #${row.id} ${row.url}`); return; }
      await prisma.portfolioImage.update({ where: { id: row.id }, data: dims });
      ok += 1;
    }));
    if ((i / CONCURRENCY) % 10 === 0) console.log(`  … ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}`);
  }
  console.log(`완료 — 채움 ${ok} · 실패 ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
