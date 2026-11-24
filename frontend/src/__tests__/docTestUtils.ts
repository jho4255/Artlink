/**
 * pdfmake 문서 정의를 읽는 테스트 도우미 — 갤러리 결과물 테스트들이 같이 쓴다(2026-11-24).
 * PDF 를 실제로 그리지 않고 정의(JSON 비슷한 나무)에서 글자·그림을 찾는다. 실제 PDF 는 하니스로 본다(scratchpad/output-audit-2026-11).
 */
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ImgFn } from '@/lib/galleryDocs/types';

/** 글자 — 줄 안 조각은 그대로 잇고, 덩어리(stack·칸·표 칸) 사이에는 줄바꿈 */
export function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean' || typeof node === 'function') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const o = node as Record<string, unknown>;
  if (o.text !== undefined) return textOf(o.text);
  const parts: unknown[] = [];
  for (const k of ['stack', 'columns', 'ul', 'ol']) if (Array.isArray(o[k])) parts.push(...(o[k] as unknown[]));
  const table = o.table as { body?: unknown[][] } | undefined;
  if (table?.body) parts.push(...table.body.flat());
  return parts.map(textOf).join('\n');
}

/** 나무의 모든 객체 */
export function nodesOf(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => nodesOf(n, out));
  else if (node && typeof node === 'object') {
    out.push(node as Record<string, unknown>);
    for (const v of Object.values(node)) nodesOf(v, out);
  }
  return out;
}

/** 본문 + 머리말·꼬리말(함수)까지의 글자 */
export function docText(doc: TDocumentDefinitions): string {
  const call = (f: unknown) => (typeof f === 'function' ? (f as (...a: unknown[]) => unknown)(2, 3, { width: 595, height: 842 }) : f);
  return [textOf(doc.content), textOf(call(doc.header)), textOf(call(doc.footer))].join('\n');
}

/** 그림 조각 — `image` 가 있는 객체 */
export const imagesOf = (doc: TDocumentDefinitions) => nodesOf(doc.content).filter((n) => typeof n.image === 'string');

/** 가짜 그림 — 주소마다 다른 data 문자열(정의만 본다) */
export const fakeImg: ImgFn = (url, cls) => (url ? `data:image/jpeg;${cls};${url}` : null);
