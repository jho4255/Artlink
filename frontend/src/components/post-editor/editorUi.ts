import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * 편집기 문서 도우미. (2026-11-13 — 표지 고르기를 없앴다: 표지는 늘 **첫 사진**이고 서버가 정한다. 예전엔 여기 표지 상태 저장소가 있었다)
 */

/** 문서 속 사진 주소(순서대로) — ProseMirror 문서를 바로 훑는다 */
export function pmImageSrcs(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'figure') { if (n.attrs.src) out.push(n.attrs.src as string); return false; }
    if (n.type.name === 'gallery') {
      for (const it of (n.attrs.items as { src?: string | null }[]) ?? []) if (it?.src) out.push(it.src);
      return false;
    }
    return true;
  });
  return out;
}
