/**
 * 작품 크기 표기를 **가로×세로 → 세로×가로**(관례) 로 바꾼다 (2026-09-16, 사용자 결정).
 *
 * 대상
 *  - `PortfolioImage.sizeText`             — 사진 비율(width/height)이 있으면 그것으로 판정, 없으면 폼 관례였다고 보고 뒤집는다
 *  - `ExhibitionSubmission.artworkList[]`  — 항목의 width/height 칸으로 다시 합성(가장 확실), 없으면 문자열만 판정
 * 판정 규칙은 `src/lib/sizeOrder.ts`(테스트 있음). 이 스크립트는 읽고·판정하고·쓰는 일만 한다.
 *
 *   npx tsx scripts/migrate-size-order.ts --dry-run   # 무엇이 어떻게 바뀌는지만 출력
 *   npx tsx scripts/migrate-size-order.ts             # 실제 반영
 *   npx tsx scripts/migrate-size-order.ts --force     # 이미 돌린 DB 에 다시(아래 ⚠️)
 *
 * ⚠️⚠️ **두 번 돌리면 사진 비율이 없는 행이 다시 뒤집힌다.** 그래서 끝나면 `AppSetting.sizeOrderMigratedAt` 을 남기고,
 *      다음 실행은 그 키가 있으면 멈춘다(`--force` 로만 해제). 로컬에서 시험한 뒤 **Render 셸에서 한 번** 돌릴 것 —
 *      프론트(폼·캡션·ArtLook)가 세로×가로를 읽도록 바뀐 배포와 **같은 때**에 돌려야 한다. 한쪽만 바뀌면 그 사이 저장된 값이 뒤집힌다.
 * ⚠️ 사진 비율이 없는 옛 행이 많으면 먼저 `backfill-image-dims.ts` 를 돌려 근거를 만든 뒤 여기로 올 것.
 */
import { PrismaClient } from '@prisma/client';
import { toHeightFirst, artworkListSize } from '../src/lib/sizeOrder';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const FLAG = 'sizeOrderMigratedAt';

async function main() {
  const done = await prisma.appSetting.findUnique({ where: { key: FLAG } });
  if (done && !FORCE && !DRY) {
    console.log(`이미 ${done.value} 에 돌렸다. 다시 돌리면 비율 없는 행이 되뒤집힌다 — 정말 필요하면 --force.`);
    return;
  }

  // ① 포트폴리오 작품
  const images = await prisma.portfolioImage.findMany({
    where: { sizeText: { not: null } },
    select: { id: true, sizeText: true, width: true, height: true },
    orderBy: { id: 'asc' },
  });
  const tally: Record<string, number> = {};
  let changed = 0;
  for (const im of images) {
    const r = toHeightFirst(im.sizeText, im);
    tally[r.reason] = (tally[r.reason] ?? 0) + 1;
    if (!r.changed) continue;
    changed += 1;
    if (DRY) { if (changed <= 20) console.log(`  #${im.id} "${im.sizeText}" → "${r.text}" (${r.reason})`); continue; }
    await prisma.portfolioImage.update({ where: { id: im.id }, data: { sizeText: r.text } });
  }
  console.log(`작품 ${images.length}점 중 ${changed}점 변경 —`, tally);

  // ② 출품리스트
  const subs = await prisma.exhibitionSubmission.findMany({
    where: { artworkList: { not: null } },
    select: { id: true, artworkList: true },
    orderBy: { id: 'asc' },
  });
  let subChanged = 0, entries = 0, entryChanged = 0;
  for (const s of subs) {
    let list: unknown;
    try { list = JSON.parse(s.artworkList ?? '[]'); } catch { continue; }
    if (!Array.isArray(list)) continue;
    let touched = false;
    const next = list.map((e) => {
      if (!e || typeof e !== 'object') return e;
      entries += 1;
      const r = artworkListSize(e as { size?: unknown; width?: unknown; height?: unknown });
      if (!r.changed) return e;
      entryChanged += 1; touched = true;
      if (DRY && entryChanged <= 20) console.log(`  제출 #${s.id} "${(e as { size?: unknown }).size}" → "${r.text}" (${r.reason})`);
      return { ...(e as object), size: r.text };
    });
    if (!touched) continue;
    subChanged += 1;
    if (!DRY) await prisma.exhibitionSubmission.update({ where: { id: s.id }, data: { artworkList: JSON.stringify(next) } });
  }
  console.log(`출품리스트 ${subs.length}건(항목 ${entries}) 중 ${subChanged}건·항목 ${entryChanged}개 변경`);

  if (!DRY) {
    await prisma.appSetting.upsert({ where: { key: FLAG }, update: { value: new Date().toISOString() }, create: { key: FLAG, value: new Date().toISOString() } });
    console.log('완료 — 재실행 잠금(AppSetting) 기록');
  } else {
    console.log('(dry-run: 아무것도 쓰지 않았다)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
