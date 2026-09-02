/**
 * MissingImagesBanner — 일괄 다운로드에서 못 받은 이미지를 **사라지지 않게** 알리고 다시 받게 한다.
 *
 * 왜 토스트가 아닌가: 토스트는 성격상 사라진다. 작품이 하나 빠졌는데 그 안내마저 사라지면
 * 사용자는 빠진 사실 자체를 모른 채 넘어간다("하나 빠지면 어떡해", 2026-08 지적).
 * 그래서 ①자동 회수(lib/imageFetch.ts `recoverFailed`)로 최대한 되찾고
 * ②그래도 남으면 이 배너를 띄워 사용자가 원할 때 다시 받게 한다(무한 대기 금지)
 * ③ZIP 안에도 누락 목록을 넣어 파일만 봐도 알 수 있게 한다(lib/operationPdf.ts `missingNote`).
 *
 * [다시 받기]는 같은 다운로드를 그대로 다시 실행한다. 이미 받은 이미지는 캐시에 있어
 * 네트워크를 타지 않으므로, 실제로는 **못 받은 것만** 다시 받고 완전한 파일이 새로 나온다.
 */
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  /** 못 받은 항목 이름 (예: "한도윤 · 무제 3") */
  items: string[];
  /** 무엇을 받다 실패했는지 (예: "작품 원본", "PDF에 들어갈 작품 이미지") */
  what: string;
  onRetry: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

export default function MissingImagesBanner({ items, what, onRetry, onDismiss, busy }: Props) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={13} className="shrink-0" />
          {what} {items.length}건을 받지 못했습니다.
        </p>
        <p className="mt-1 break-keep text-amber-800">
          {shown.join(' / ')}{items.length > shown.length ? ` 외 ${items.length - shown.length}건` : ''}
        </p>
        <p className="mt-1 text-[11px] text-amber-700">
          다시 받기를 누르면 <b>받지 못한 것만</b> 다시 시도합니다. (이미 받은 파일은 그대로 재사용)
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onRetry}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          <RotateCw size={12} className={busy ? 'animate-spin' : ''} />
          다시 받기
        </button>
        <button onClick={onDismiss} className="px-2 py-2 text-amber-800 hover:underline">닫기</button>
      </div>
    </div>
  );
}
