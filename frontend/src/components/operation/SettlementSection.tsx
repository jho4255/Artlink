/**
 * 정산 (갤러리 오너 / Admin) — 전시 종료 후 판매 기록 · 비율 · 작가 확인 · 이의 처리 · 완료
 *
 * ── 2026-11-20 개편 (공모 흐름, 규칙 88) ───────────────────────
 * 상태·동작은 `useSettlementController`, 그리기는 기본 export(표). 공모 한 건 화면이 컨트롤러를 쥐고
 * **할 일 줄의 주 버튼**(확인 요청 · 저장하고 ○○ 님에게 다시 요청 · 정산 완료 …)과 정산 탭에 같이 넘긴다.
 * 예전엔 정산 구역 안에 동그라미 3칸 + 안내 문단 + 버튼 줄이 입력 **위**에 있어, 판매가를 적고 다시 올라가 눌렀다.
 *  - 표(PC): 그림 · 작품 · 희망가 · 판매 · 결제 · 판매가 · 작가 몫. 작가별 머리에 상태(확인함 · 확인 대기 · **이의**)
 *  - 휴대폰: 카드 없이 납작한 목록 — 판매에 체크하면 그 아래 [카드|현금] + 판매가
 *  - 갤러리:작가 비율은 위 한 칸(작가마다 다르면 작가 머리에 칸이 생긴다)
 *  - **이의**: 할 일 줄이 '○○ 님이 정산에 이의를 남겼어요', 그 작가 머리에 이의 글(따옴표) · 금액을 고치면 주 버튼이
 *    [저장하고 ○○ 님에게 다시 요청], 고칠 게 없으면 [○○ 님에게 다시 요청](그 사람만 다시 확인 대상으로 — 남들은 그대로)
 *  - 열 이름 '판매'(2026-11-20 사용자 — 목업의 '팔림' 대신)
 *
 * ── 바꾸지 않은 것(규칙 26) ─────────────────────────────────
 * 지문 대조 · 금액이 바뀐 작가만 재확인 · 보내는 버튼은 먼저 저장(`persist`) · [정산 완료]/[요청 취소]는 미저장이면 막음 ·
 * `settlementFormSignature` · 요청 전 판매가 빈 칸 검사 · 갤러리 몫 0% 확인창 · 미응답 재안내 DM.
 */
import { FileDown, ImageOff, Megaphone } from 'lucide-react';
import toast from 'react-hot-toast';
import Thumb from '@/components/shared/Thumb';
import { cn, nameWithNickname } from '@/lib/utils';
import { openArtLook } from '@/lib/artlook';
import { won, artistTotals } from '@/lib/settlement';
import { shortDate } from '@/lib/listings';
import MenuButton from '@/components/flow/MenuButton';
import { listPriceText, type Approval, type SettlementController } from '@/components/operation/settlementController';
import GuestChip from '@/components/operation/GuestChip';

/* ─────────────────────────────────────────────────────────────
   그리기 — 위 한 줄(비율·수수료·정산서) · 작가별 표 · 합계
   ───────────────────────────────────────────────────────────── */

/** 작가 머리의 상태 — 확인함(✓) · 자동 확인 · 확인 대기(언제 자동 확인) · 이의(빨강) */
function ApprovalText({ approval }: { approval: Approval }) {
  if (!approval) return null;
  // 자동 수락은 사람이 누른 수락과 반드시 구분해서 보여준다 — 나중에 다툼이 생기면 이 구분이 근거다
  if (approval.status === 'APPROVED') return <span className="text-[13.5px] text-gray-500">✓ {approval.autoApproved ? '자동 확인' : '확인함'}</span>;
  if (approval.status === 'ISSUE') return <span className="text-[13.5px] font-semibold text-accent">이의</span>;
  if (approval.status === 'PENDING') {
    return <span className="text-[13.5px] text-gray-600">확인 대기{approval.autoApproveAt ? ` · ${shortDate(approval.autoApproveAt)} 자동 확인` : ''}</span>;
  }
  return null;
}

const RATIO_INPUT = 'h-10 w-[60px] rounded-lg border border-gray-300 bg-white px-2 text-right text-[15px] tabular-nums disabled:bg-gray-50';

export default function SettlementSection({ ctl, wide, isAdmin }: { ctl: SettlementController; wide: boolean; isAdmin?: boolean }) {
  const { artists, locked, requested, settled } = ctl;
  if (ctl.failed) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        정산 내역을 불러오지 못했어요.{' '}
        <button type="button" onClick={ctl.retry} className="font-medium text-gray-900 underline underline-offset-4">다시 시도</button>
      </p>
    );
  }
  if (!ctl.ready) return <div className="h-32 animate-pulse rounded-xl bg-gray-100" />;

  const cols = 'grid grid-cols-[56px_minmax(0,1fr)_110px_44px_116px_140px_110px] items-center gap-x-4';

  return (
    <section className="space-y-2" data-settlement>
      {/* 위 한 줄 — 비율 · 카드 수수료 | 정산서 · 요청 취소 */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 text-sm text-gray-600">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {ctl.perArtistRatio ? (
            <span className="inline-flex items-center gap-2">
              갤러리:작가 비율은 작가마다 달라요
              {!locked && ctl.uniformRatio != null && (
                <button type="button" onClick={() => ctl.setPerArtistRatio(false)} className="min-h-[40px] text-gray-900 underline underline-offset-4">한 칸으로</button>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <label htmlFor="settle-ratio">갤러리</label>
              <input
                id="settle-ratio" data-ratio-input type="number" inputMode="numeric" min={0} max={100} disabled={locked}
                value={ctl.uniformRatio ?? 0}
                onChange={(e) => ctl.setAllRatios(parseInt(e.target.value) || 0)}
                className={RATIO_INPUT}
              />
              <span>% : 작가 {100 - (ctl.uniformRatio ?? 0)}%</span>
              {!locked && artists.length > 1 && (
                <button type="button" onClick={() => ctl.setPerArtistRatio(true)} className="ml-1 min-h-[40px] text-[13px] text-gray-500 underline underline-offset-4 hover:text-gray-900">작가마다 다르게</button>
              )}
            </span>
          )}
          <span className="inline-flex items-center gap-2">
            <label htmlFor="settle-fee">카드 수수료</label>
            <input
              id="settle-fee" type="number" inputMode="decimal" step="0.01" min={0} max={100} disabled={locked}
              value={ctl.feeRate}
              onChange={(e) => ctl.setFeeRate(e.target.value)}
              onBlur={() => ctl.setFeeRate(String(ctl.feeNum))}
              className={RATIO_INPUT}
            />
            <span>%</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <MenuButton
            label="정산서 받기"
            icon={<FileDown size={13} aria-hidden />}
            busyLabel={ctl.zipping ? '만드는 중…' : null}
            items={[
              { label: '전체 정산서 PDF', hint: '작가별 판매·정산 금액', onSelect: () => ctl.downloadOverall() },
              { label: '현금 정산서', hint: '현금으로 판 작품만', onSelect: () => ctl.downloadOverall('CASH') },
              { label: '카드 정산서', hint: '카드로 판 작품만', onSelect: () => ctl.downloadOverall('CARD') },
            ]}
          />
          {requested && !settled && (
            <button type="button" onClick={ctl.cancelRequest} disabled={ctl.cancelling} title="정산 내역을 작가들에게서 다시 감춥니다" className="min-h-[40px] text-[13.5px] text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline disabled:opacity-50">
              요청 취소
            </button>
          )}
        </div>
      </div>
      {/* 요청을 취소했는데 수락 기록이 남아 있다 — 다시 요청해도 이 사람들은 건너뛴다 */}
      {!requested && !settled && ctl.approvedCount > 0 && (
        <p className="pb-2 text-[13px] text-gray-500">이미 {ctl.approvedCount}명이 확인했어요 — 금액을 고치지 않은 작가는 다시 요청해도 확인이 그대로예요.</p>
      )}
      {(ctl.grand.cardFee ?? 0) > 0 && (
        <p className="pb-2 text-[13px] text-gray-500">카드 {won(ctl.grand.cardTotal ?? 0)} 중 수수료 {won(ctl.grand.cardFee ?? 0)}를 먼저 빼고 비율로 나눠요.</p>
      )}

      {artists.length === 0 ? (
        <p className="border-t border-gray-200 py-8 text-sm text-gray-400">수락한 작가가 없어요.</p>
      ) : (
        <div role="table" aria-label="작가별 판매" className="border-t-2 border-gray-900">
          {wide && (
            <div role="row" className={cn(cols, 'min-h-[40px] border-b border-gray-200 text-[12.5px] text-gray-500')}>
              <span role="columnheader" />
              <span role="columnheader">작품</span>
              <span role="columnheader" className="text-right">희망가</span>
              <span role="columnheader">판매</span>
              <span role="columnheader">결제</span>
              <span role="columnheader" className="text-right">판매가</span>
              <span role="columnheader" className="text-right">작가 몫</span>
            </div>
          )}
          {artists.map((a, ai) => {
            const t = artistTotals(a, ctl.feeNum);
            const appr = ctl.approvalOf(a.user.id);
            const name = nameWithNickname(a.user);
            const issue = appr?.status === 'ISSUE';
            // 비회원 작가(규칙 91) — 확인 요청을 받을 수 없다. 머리엔 '확인 요청 없음'
            const guest = !!a.guest;
            const canReask = !guest && requested && !settled && !locked && (appr?.status === 'PENDING' || issue);
            return (
              <div key={a.user.id} role="rowgroup" data-settle-artist={a.user.id} className="border-b border-gray-200 pb-2">
                {/* 작가 머리 — 이름 | 상태 · 다시 요청 · 정산서 */}
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-4 pb-2">
                  <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold text-gray-950"><span className="truncate">{name}</span>{guest && <GuestChip />}</h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {guest ? <span className="text-[13.5px] text-gray-500">확인 요청 없음</span> : <ApprovalText approval={appr} />}
                    {canReask && (
                      <button type="button" onClick={() => ctl.reask([a.user.id])} disabled={ctl.reasking} className="min-h-[40px] text-[13px] text-gray-700 underline underline-offset-4 hover:text-gray-950 disabled:opacity-50">
                        {issue ? (ctl.dirty ? '저장하고 다시 요청' : '금액 그대로 다시 요청') : '다시 요청'}
                      </button>
                    )}
                    {ctl.perArtistRatio && (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
                        갤러리
                        <input type="number" inputMode="numeric" min={0} max={100} disabled={locked} value={a.galleryRatio} onChange={(e) => ctl.updRatio(ai, parseInt(e.target.value) || 0)} aria-label={`${name} 갤러리 비율(%)`} data-ratio-input className={RATIO_INPUT} />
                        % : 작가 {100 - a.galleryRatio}%
                      </span>
                    )}
                    <MenuButton
                      label="정산서"
                      icon={<FileDown size={13} aria-hidden />}
                      busyLabel={ctl.zipping ? '만드는 중…' : null}
                      items={[
                        { label: `${name} 정산서 PDF`, onSelect: () => ctl.downloadArtist(ai) },
                        { label: '현금 정산서', onSelect: () => ctl.downloadArtist(ai, 'CASH') },
                        { label: '카드 정산서', onSelect: () => ctl.downloadArtist(ai, 'CARD') },
                      ]}
                    />
                  </div>
                </div>
                {/* 이의 — 작가가 남긴 글을 그대로. 갤러리가 지금 봐야 하는 유일한 것 */}
                {issue && appr?.comment && (
                  <blockquote data-settle-issue className="mb-3 break-keep text-[15px] leading-relaxed text-gray-950 [overflow-wrap:anywhere]">“{appr.comment}”</blockquote>
                )}

                {a.works.length === 0 ? (
                  <p className="py-3 text-[13px] text-gray-500">등록된 출품작이 없어요.</p>
                ) : a.works.map((w, wi) => {
                  const k = `${a.user.id}:${w.index}`;
                  const missing = ctl.priceMissing.has(k);
                  const workShare = w.sold ? Math.round((artistTotals({ ...a, works: [w] }, ctl.feeNum).artistAmount)) : 0;
                  const img = w.image
                    ? <Thumb src={w.image} alt="" className="h-14 w-14 shrink-0 bg-white object-contain" />
                    : <span className="grid h-14 w-14 shrink-0 place-items-center bg-gray-50"><ImageOff size={16} className="text-gray-300" aria-hidden /></span>;
                  // 누르는 곳은 상자 둘레 44px — 20px 상자만 받으면 휴대폰에서 빗나간다
                  const soldBox = (
                    <label className={cn('-m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center', !locked && 'cursor-pointer')}>
                      <input type="checkbox" checked={w.sold} disabled={locked} onChange={(e) => ctl.updWork(ai, wi, { sold: e.target.checked })} aria-label={`${w.title || '작품'} 판매`} className="h-5 w-5 accent-gray-900 disabled:opacity-50" />
                    </label>
                  );
                  const payment = (
                    <div className="inline-flex" role="group" aria-label="결제 방법">
                      <button type="button" disabled={locked} onClick={() => ctl.updWork(ai, wi, { paymentMethod: 'CARD' })} aria-pressed={w.paymentMethod !== 'CASH'}
                        className={cn('min-h-[40px] rounded-l-lg border px-3 text-[13.5px] disabled:opacity-60', w.paymentMethod !== 'CASH' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-600')}>카드</button>
                      <button type="button" disabled={locked} onClick={() => ctl.updWork(ai, wi, { paymentMethod: 'CASH' })} aria-pressed={w.paymentMethod === 'CASH'}
                        className={cn('-ml-px min-h-[40px] rounded-r-lg border px-3 text-[13.5px] disabled:opacity-60', w.paymentMethod === 'CASH' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-600')}>현금</button>
                    </div>
                  );
                  const price = (
                    <input
                      type="text" inputMode="numeric" disabled={locked}
                      value={w.soldPrice ? w.soldPrice.toLocaleString('ko') : ''}
                      onChange={(e) => { ctl.updWork(ai, wi, { soldPrice: parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0 }); ctl.clearPriceMissing(k); }}
                      placeholder="판매가" aria-label={`${w.title || '작품'} 판매가`} aria-invalid={missing || undefined} data-price-missing={missing || undefined}
                      className={cn('h-10 w-full min-w-0 rounded-lg border bg-white px-2.5 text-right text-[15px] tabular-nums disabled:bg-gray-50', missing ? 'border-accent bg-accent/5' : issue && w.sold ? 'border-gray-900' : 'border-gray-300')}
                    />
                  );
                  if (wide) {
                    return (
                      <div key={wi} role="row" className={cn(cols, 'min-h-[68px] border-t border-gray-100 py-1.5 text-[14.5px]', !w.sold && 'text-gray-500')}>
                        {img}
                        <span role="cell" className="min-w-0">
                          <span className={cn('block truncate', w.sold ? 'font-medium text-gray-950' : '')}>{w.title || '(제목 없음)'}</span>
                          {[w.size, w.medium, w.year].some(Boolean) && <span className="block truncate text-[12.5px] text-gray-500">{[w.size, w.medium, w.year].filter(Boolean).join(' · ')}</span>}
                        </span>
                        <span role="cell" className="text-right tabular-nums text-gray-500">{w.listPrice ? listPriceText(w.listPrice) : '—'}</span>
                        <span role="cell">{soldBox}</span>
                        <span role="cell">{w.sold && payment}</span>
                        <span role="cell">{w.sold && price}</span>
                        <span role="cell" className="text-right font-semibold tabular-nums text-gray-950">{w.sold ? workShare.toLocaleString('ko') : '—'}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={wi} className="border-t border-gray-100">
                      <label className="flex min-h-[76px] cursor-pointer items-center gap-3">
                        {soldBox}
                        {img}
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-[15px]', w.sold ? 'font-semibold text-gray-950' : 'text-gray-800')}>{w.title || '(제목 없음)'}</span>
                          <span className="block truncate text-[12.5px] text-gray-500">{w.listPrice ? `희망가 ${listPriceText(w.listPrice)}` : [w.size, w.medium].filter(Boolean).join(' · ')}</span>
                        </span>
                      </label>
                      {w.sold && (
                        <div className="flex items-center gap-2.5 pb-4 pl-8">
                          {payment}
                          <div className="min-w-0 flex-1">{price}</div>
                          <span className="shrink-0 text-sm text-gray-600">원</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* 작가 합계 — 수수료를 뗐으면 반드시 보인다(작가가 "왜 줄었냐" 물을 때 답이 화면에 있어야 한다) */}
                <p className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[13px] text-gray-500">
                  <span>판매 {won(t.total)}</span>
                  {t.cardFee > 0 && <span>카드 수수료 -{won(t.cardFee)}</span>}
                  <span>갤러리 {won(t.galleryAmount)}</span>
                  <span className="font-medium text-gray-900">작가 {won(t.artistAmount)}</span>
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* 전체 합계 */}
      {artists.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-3 border-t-2 border-gray-900 sm:grid-cols-4">
          <div className="py-3.5"><dt className="text-[12.5px] text-gray-500">판매</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{ctl.grand.soldCount}점</dd></div>
          <div className="py-3.5"><dt className="text-[12.5px] text-gray-500">판매 합계</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{won(ctl.grand.total)}</dd></div>
          <div className="py-3.5"><dt className="text-[12.5px] text-gray-500">갤러리</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{won(ctl.grand.galleryAmount)}</dd></div>
          <div className="py-3.5"><dt className="text-[12.5px] text-gray-500">작가 지급</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{won(ctl.grand.artistAmount)}</dd></div>
        </dl>
      )}

      {/* 판매작 홍보 — ArtLook 연결 */}
      {ctl.soldWorks.length > 0 && (
        <button
          type="button"
          onClick={() => { if (openArtLook(ctl.soldWorks) === 0) toast.error('홍보할 판매 작품 이미지가 없습니다.'); }}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline"
        >
          <Megaphone size={15} aria-hidden /> 판매된 {ctl.soldWorks.length}점으로 ArtLook 홍보 이미지 만들기
        </button>
      )}
      {isAdmin && settled && <p className="text-[13px] text-gray-500">관리자는 정산 완료 뒤에도 고칠 수 있어요.</p>}
    </section>
  );
}
